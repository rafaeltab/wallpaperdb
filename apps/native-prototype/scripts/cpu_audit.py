"""Read-only retrospective CPU-evidence audit; run after report writers stop.

Reads one report.json at a time and streams each process.csv. Writes JSON only to
stdout. Never starts a sampler, renderer, desktop command, or GPU workload.
"""

import argparse
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "wallpaper_cpu_profile", Path(__file__).with_name("profile.py")
)
profile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(profile)
ROLES = ("wallpaper", "contender", "compositor", "profiler")


def audit_run(run, folder, sample_hz):
    start, end = float(run.get("start", 0)), float(run.get("end", 0))
    name = run.get("name", "")
    if not isinstance(name, str) or not name or name in (".", "..") or Path(name).name != name:
        return {
            "name": name,
            "status": "unknown",
            "errors": ["Unsafe or missing run artifact name"],
        }
    period = 1 / sample_hz if sample_hz > 0 else 0
    timeline = {
        float(row["monotonic"]): row
        for row in run.get("cpu_timeline", [])
        if isinstance(row, dict) and start <= row.get("monotonic", -math.inf) <= end
    }
    coverage = profile.cpu_window_evidence(list(timeline), start, end, period)
    result = {
        "name": name,
        "source_valid": run.get("valid"),
        "process_csv": f"{name}/process.csv",
        "coverage": coverage,
        "status": coverage["status"],
        "mean_valid": coverage["mean_valid"],
        "tails_valid": coverage["tails_valid"],
        "errors": [],
        "limitations": "A complete historical CSV establishes observed frozen-PID membership and sweep coverage, not accounting for short-lived processes outside that membership. Older CSV lacks raw per-PID clock timestamps; complete membership rules out the identified skipped-read recovery failure path but cannot reconstruct the counters independently.",
    }
    if sample_hz <= 0:
        return result
    expected = {int(pid) for pid in run.get("process_topology", {}) if int(pid) > 0}
    result["expected_positive_pid_count"] = len(expected)
    result["excluded_nonpositive_sentinels"] = sum(
        int(pid) <= 0 for pid in run.get("process_topology", {})
    )
    if not expected:
        result["errors"].append("Expected frozen process membership unavailable")
    observed_stamps = set()
    details = []
    issue_count = 0
    row_count = 0
    counter_rows = 0
    max_pid_timestamp_offset = 0
    previous_counters = {}
    current_stamp = None
    sample_pids = set()
    sample_totals = {role: 0.0 for role in ROLES}

    def issue(message, **fields):
        nonlocal issue_count
        issue_count += 1
        if len(details) < 20:
            details.append({"error": message, **fields})

    def finish_sample():
        if current_stamp is None:
            return
        if current_stamp in observed_stamps:
            issue("Repeated noncontiguous sample timestamp", monotonic=current_stamp)
        observed_stamps.add(current_stamp)
        missing, unexpected = expected - sample_pids, sample_pids - expected
        if missing or unexpected:
            issue(
                "Sample process membership incomplete",
                monotonic=current_stamp,
                missing_positive_pids=sorted(missing),
                unexpected_positive_pids=sorted(unexpected),
            )
        summary = timeline.get(current_stamp)
        if summary is None:
            issue("CSV sample has no corresponding CPU timeline sample", monotonic=current_stamp)
        else:
            for role, total in sample_totals.items():
                recorded = summary.get(role + "_cpu")
                if (
                    recorded is None
                    or not math.isfinite(recorded)
                    or not math.isclose(recorded, total, rel_tol=1e-7, abs_tol=1e-5)
                ):
                    issue(
                        "CSV role total differs from recorded CPU timeline",
                        monotonic=current_stamp,
                        role=role,
                    )

    path = Path(folder) / name / "process.csv"
    try:
        with path.open(newline="") as handle:
            for row in csv.DictReader(handle):
                try:
                    stamp = float(row["monotonic"])
                    pid = int(row["pid"])
                    if not math.isfinite(stamp):
                        raise ValueError("Nonfinite sample timestamp")
                    if not start <= stamp <= end:
                        continue
                    if stamp != current_stamp:
                        finish_sample()
                        if current_stamp is not None and stamp <= current_stamp:
                            issue("CSV sample timestamps moved backwards", monotonic=stamp)
                        current_stamp = stamp
                        sample_pids = set()
                        sample_totals = {role: 0.0 for role in ROLES}
                    if pid <= 0:
                        issue("CSV contains a nonpositive sentinel PID", monotonic=stamp)
                        continue
                    if pid in sample_pids:
                        issue("Duplicate PID in one sample", monotonic=stamp, pid=pid)
                    sample_pids.add(pid)
                    cpu = float(row["cpu_percent_one_core"])
                    role = row["role"]
                    if not math.isfinite(cpu) or cpu < 0 or role not in ROLES:
                        raise ValueError("Invalid CPU rate or role")
                    sample_totals[role] += cpu
                    row_count += 1
                    if row.get("sample_monotonic") and row.get("cpu_total_ns"):
                        sample_at = float(row["sample_monotonic"])
                        ns = int(row["cpu_total_ns"])
                        elapsed = float(row["sample_elapsed_seconds"])
                        if not math.isfinite(sample_at) or not math.isfinite(elapsed) or ns < 0:
                            raise ValueError("Invalid raw process clock evidence")
                        old = previous_counters.get(pid)
                        if old is not None:
                            computed, interval = profile.cpu_interval(old, (ns, sample_at))
                            if not math.isclose(
                                computed, cpu, rel_tol=1e-7, abs_tol=1e-5
                            ) or not math.isclose(interval, elapsed, abs_tol=1e-8):
                                issue(
                                    "Per-PID counter/elapsed evidence disagrees with CPU rate",
                                    monotonic=stamp,
                                    pid=pid,
                                )
                        previous_counters[pid] = (ns, sample_at)
                        max_pid_timestamp_offset = max(
                            max_pid_timestamp_offset, abs(sample_at - stamp)
                        )
                        counter_rows += 1
                except (KeyError, ValueError, TypeError, RuntimeError) as error:
                    issue(f"Malformed process CSV evidence: {error}")
            finish_sample()
    except (OSError, csv.Error) as error:
        issue(f"Process CSV unavailable or unreadable: {error}")
    missing_groups = len(set(timeline) - observed_stamps)
    if missing_groups:
        issue("CPU timeline samples missing entirely from process CSV", count=missing_groups)
    result.update(
        observed_sample_groups=len(observed_stamps),
        process_csv_rows=row_count,
        report_sample_groups=len(timeline),
        missing_sample_groups=missing_groups,
        raw_per_pid_counter_rows=counter_rows,
        maximum_pid_timestamp_offset_seconds=max_pid_timestamp_offset if counter_rows else None,
        sampling_issue_count=issue_count,
        sampling_issue_examples=details,
    )
    native_evidence = run.get("cpu_evidence", {})
    if native_evidence:
        result["recorded_worker_exit"] = native_evidence.get("worker_exit")
        if (
            native_evidence.get("worker_completed") is not True
            or native_evidence.get("worker_exit") not in ("requested_stop", "disabled")
            or native_evidence.get("read_errors")
            or native_evidence.get("missing_clocks")
        ):
            result["errors"].append("Recorded CPU worker completion/read evidence failed")
    else:
        result["recorded_worker_exit"] = (
            "unavailable in historical report; assess coverage from CSV/timeline"
        )
    if issue_count:
        result["errors"].append(
            f"CPU CSV has {issue_count} membership/counter/coverage inconsistencies"
        )
    if result["errors"]:
        result.update(status="unknown", mean_valid=False, tails_valid=False)
    result["errors"].extend(coverage["errors"])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--max-report-mib", type=float, default=256)
    args = parser.parse_args(argv)
    if not math.isfinite(args.max_report_mib) or not 0 < args.max_report_mib <= 1024:
        parser.error("Report size limit must be in (0, 1024] MiB")
    audits = []
    for path in args.reports:
        if path.stat().st_size > args.max_report_mib * 1024 * 1024:
            audits.append({"report": str(path), "error": "Report exceeds bounded read size"})
            continue
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        with path.open() as handle:
            report = json.load(handle)
        hz = float(report.get("manifest", {}).get("arguments", {}).get("sample_hz", 0))
        audits.append(
            {
                "report": str(path),
                "sha256": digest.hexdigest(),
                "runs": [audit_run(run, path.parent, hz) for run in report.get("runs", [])],
            }
        )
        del report
    print(
        json.dumps(
            {
                "method": "Sequential read-only report and streamed process-CSV audit",
                "reports": audits,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
