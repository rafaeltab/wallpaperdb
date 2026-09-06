"""Summarize bounded custom stages and process roles; does not open Chromium trace JSON."""

import argparse
from collections import defaultdict
import csv
import json
import math
from pathlib import Path
import statistics


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def percentile(values, q):
    if not values:
        return None
    where = (len(values) - 1) * q
    low, high = math.floor(where), math.ceil(where)
    return values[low] + (values[high] - values[low]) * (where - low)


def distribution(values):
    values = sorted(value for value in values if finite(value))
    return {
        "samples": len(values),
        "mean": statistics.mean(values) if values else None,
        "p50": percentile(values, 0.5),
        "p95": percentile(values, 0.95),
        "p99": percentile(values, 0.99),
        "max": max(values) if values else None,
    }


def read_stages(path, codes, stamp_key):
    rows, stages = [], defaultdict(list)
    with path.open() as handle:
        for row in csv.DictReader(handle):
            if len(rows) == 32768:
                raise ValueError("Custom trace exceeds its declared row bound")
            stage = codes.get(int(row["stage"]), "unknown")
            item = {
                "stage": stage,
                "id": int(float(row["id"])),
                "at_us": float(row[stamp_key]),
                "duration_ms": float(row["duration_us"]) / 1000,
            }
            if "value" in row:
                item["value"] = float(row["value"])
            if not finite(item["at_us"]) or not finite(item["duration_ms"]):
                raise ValueError("Nonfinite custom stage")
            rows.append(item)
            stages[stage].append(item["duration_ms"])
    return rows, {stage: distribution(values) for stage, values in stages.items()}


def process_roles(samples):
    groups = defaultdict(list)
    for snapshot in samples:
        for process in snapshot.get("processes", []):
            key = process["pid"], process.get("creationTime"), process.get("type", "Unknown")
            groups[key].append((snapshot["at_us"], snapshot.get("baseline", False), process))
    rows = []
    for (pid, created, role), points in groups.items():
        latest = points[-1][2]
        native = [
            p.get("cpu", {}).get("percentCPUUsage") for _, baseline, p in points if not baseline
        ]
        cumulative = [
            (at, p.get("cpu", {}).get("cumulativeCPUUsage"))
            for at, _, p in points
            if finite(p.get("cpu", {}).get("cumulativeCPUUsage"))
        ]
        cpu_seconds = elapsed = None
        if len(cumulative) > 1:
            elapsed = (cumulative[-1][0] - cumulative[0][0]) / 1e6
            cpu_seconds = cumulative[-1][1] - cumulative[0][1]
            if elapsed <= 0 or cpu_seconds < 0:
                elapsed = cpu_seconds = None
        rows.append(
            {
                "pid": pid,
                "creationTime": created,
                "role": role,
                "name": latest.get("name"),
                "serviceName": latest.get("serviceName"),
                "cpu_native_percent_samples": distribution(native),
                "cumulative_cpu_seconds_delta": cpu_seconds,
                "counter_window_seconds": elapsed,
                "counter_mean_percent_one_core": cpu_seconds / elapsed * 100 if elapsed else None,
            }
        )
    return rows


def load(path):
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    producer = load(directory / "producer-diagnostic.json")
    presenter = load(directory / "presenter-diagnostic.json")
    provenance = load(directory / "provenance.json")
    prows, pstages = read_stages(
        directory / "producer-stages.csv",
        {value: key for key, value in producer["event_codes"].items()},
        "at_us",
    )
    nrows, nstages = read_stages(
        directory / "presenter-stages.csv",
        {value: key for key, value in presenter["codes"].items()},
        "at_monotonic_us",
    )
    active_seconds = (
        producer.get("stop_requested_us", 0) - producer.get("start_acknowledged_us", 0)
    ) / 1e6
    paints = [row for row in prows if row["stage"] == "paint"]
    intervals = [(b["at_us"] - a["at_us"]) / 1000 for a, b in zip(paints, paints[1:])]
    accepted = [row for row in prows if row["stage"] == "submit" and row.get("value") == 1]
    acknowledged = [row for row in prows if row["stage"] == "ack"]
    native_received = {row["id"] for row in nrows if row["stage"] == "receive_header_cpu"}
    submitted_ids = {row["id"] for row in accepted}
    ack_ids = {row["id"] for row in acknowledged}
    incomplete = (
        producer.get("overflow", 0)
        or presenter.get("overflow", 0)
        or provenance.get("result") != "complete"
    )
    result = {
        "diagnostic_only": True,
        "comparison_capture": False,
        "source_result": provenance.get("result"),
        "custom_events_incomplete": bool(incomplete),
        "producer_active_seconds": active_seconds if active_seconds > 0 else None,
        "producer_counts": producer.get("counters"),
        "paint_callback_hz": (
            len(paints) / active_seconds
            if active_seconds > 0 and not producer.get("overflow")
            else None
        ),
        "paint_interval_ms": distribution(intervals),
        "accepted_submission_count": len(accepted),
        "observed_ack_count": len(acknowledged),
        "accepted_ids_missing_native_receive": sorted(submitted_ids - native_received),
        "accepted_ids_missing_observed_ack": sorted(submitted_ids - ack_ids),
        "producer_stage_ms": pstages,
        "presenter_stage_ms": nstages,
        "process_roles": process_roles(producer.get("metrics", [])),
        "limits": [
            "Stages overlap: paint_total includes extraction, write and submit; native import_total includes upload. Do not add these means together.",
            "Ack and observed-fence durations include scheduling/polling. They are not isolated GPU or IPC execution times.",
            "An unmatched ID can occur at start/stop boundaries; it is not automatically a dropped frame.",
            "Paint arrival rate is diagnostic callback throughput, not browser draw or compositor-delivered FPS.",
            "A hot process role identifies where CPU time was spent, not the cause of a wait or GPU slowdown.",
            "Chromium trace is retained for a separate local inspection of work before paint arrival. Missing readback events mean that attribution remains unresolved.",
        ],
        "trace": {
            "path": "chromium-trace.json",
            "categories": producer.get("categories"),
            "unavailable_categories": producer.get("unavailable_categories"),
            "buffer_usage": producer.get("bufferUsage"),
            "errors": producer.get("errors"),
        },
        "provenance": provenance,
    }

    def text(value):
        return f"{value:.3f}" if finite(value) else "unavailable"

    lines = [
        "# Chromium diagnostic stages",
        "",
        "Instrumented diagnostic; excluded from comparison results.",
        "",
        f"Source result: **{result['source_result']}**. Custom event data incomplete: **{bool(incomplete)}**.",
        "",
        f"Paint arrivals: **{text(result['paint_callback_hz'])}/s** during the observed diagnostic window. "
        f"Accepted submissions: **{len(accepted)}**; observed acknowledgements: **{len(acknowledged)}**.",
        "",
        "Stages overlap; totals must not be summed. Native upload is CPU call time; fence/ack includes waiting and scheduling.",
        "",
        "| Process / stage | Samples | Mean ms | p50 ms | p95 ms | p99 ms | Worst ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for owner, stages in [("Producer", pstages), ("Presenter", nstages)]:
        for stage, stats in stages.items():
            lines.append(
                f"| {owner}: {stage} | {stats['samples']} | "
                + " | ".join(text(stats[key]) for key in ["mean", "p50", "p95", "p99", "max"])
                + " |"
            )
    lines += [
        "",
        "| Electron process role | PID | CPU counter mean, % of one core¹ | Native API mean² |",
        "| --- | ---: | ---: | ---: |",
    ]
    for process in result["process_roles"]:
        lines.append(
            f"| {process['role']} | {process['pid']} | {text(process['counter_mean_percent_one_core'])} | "
            f"{text(process['cpu_native_percent_samples']['mean'])} |"
        )
    lines += [
        "",
        "¹ Only available when cumulative CPU counters were reported over a usable interval. "
        "² Native Electron CPU sample units/windows; the first baseline observation is excluded.",
        "",
        "[Complete diagnostic summary](diagnostic-summary.json) · [Chromium trace](chromium-trace.json) · "
        "[Producer stages](producer-stages.csv) · [Presenter stages](presenter-stages.csv)",
        "",
    ]
    (directory / "diagnostic-summary.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n"
    )
    (directory / "diagnostic-summary.md").write_text("\n".join(lines))
    print(directory / "diagnostic-summary.md")


if __name__ == "__main__":
    main()
