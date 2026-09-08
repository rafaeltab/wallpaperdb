"""Portable frame evidence for the disposable real-game benchmark."""

import csv
import math
import statistics


def parse_source2(source):
    reader = csv.DictReader(line for line in source if line.strip())
    required = {
        "demo tick",
        "frame start time",
        "frame start delta",
        "frame swap time",
        "frame swap delta",
    }
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("Not an individual-frame Source 2 capture")
    rows = []
    previous = None
    for raw in reader:
        row = {
            "tick": int(raw["demo tick"]),
            "engine_start_s": float(raw["frame start time"]),
            "engine_swap_s": float(raw["frame swap time"]),
            "start_ms": float(raw["frame start delta"]) * 1000,
            "frame_ms": float(raw["frame swap delta"]) * 1000,
        }
        if not all(math.isfinite(v) for v in row.values()):
            raise ValueError("Non-finite Source 2 frame")
        if previous is None:
            if row["frame_ms"] != 0 or row["start_ms"] != 0:
                raise ValueError("Missing first-frame clock anchor")
        else:
            if row["tick"] < previous["tick"] or row["frame_ms"] <= 0 or row["start_ms"] <= 0:
                raise ValueError("Invalid Source 2 frame/tick order")
            for absolute, delta in [("engine_swap_s", "frame_ms"), ("engine_start_s", "start_ms")]:
                difference = (row[absolute] - previous[absolute]) * 1000
                if difference <= 0 or abs(difference - row[delta]) > 0.003:
                    raise ValueError("Frame timestamps disagree with durations; incomplete capture")
            row["time_s"] = row["engine_swap_s"]
            rows.append(row)
        previous = row
    if not rows:
        raise ValueError("No game frames captured")
    return rows


def segment(frames, start_tick, end_tick):
    """A fixed tick interval (start,end]; repeated ticks retain every real hitch."""
    selected = [dict(row) for row in frames if start_tick < row["tick"] <= end_tick]
    ticks = {row["tick"] for row in selected}
    if ticks != set(range(start_tick + 1, end_tick + 1)):
        raise ValueError("Replay did not render every requested scene tick")
    origin = selected[0]["time_s"] - selected[0]["frame_ms"] / 1000
    for row in selected:
        row["time_s"] -= origin
        row["scene_s"] = (row["tick"] - start_tick) / 64
    elapsed = selected[-1]["time_s"]
    if abs(sum(row["frame_ms"] for row in selected) / 1000 - elapsed) > 0.002:
        raise ValueError("Scene frame coverage is incomplete")
    return selected


def parse_mangohud(source):
    reader = csv.reader(source)
    header = next((row for row in reader if "frametime" in row and "elapsed" in row), None)
    if header is None:
        raise ValueError("No individual-frame MangoHud header; summary CSVs are not captures")
    rows = []
    previous = -1
    for index, values in enumerate(reader, 1):
        if not values:
            continue
        if len(values) != len(header):
            raise ValueError(f"Incomplete frame row {index}")
        raw = dict(zip(header, values))
        frame = float(raw["frametime"])
        elapsed = float(raw["elapsed"]) / 1e9
        if (
            not math.isfinite(frame)
            or frame <= 0
            or not math.isfinite(elapsed)
            or elapsed <= previous
        ):
            raise ValueError(f"Invalid frame duration or timestamp at row {index}")
        previous = elapsed
        rows.append({"time_s": elapsed, "frame_ms": frame})
    if not rows:
        raise ValueError("No individual game frames recorded")
    if len(rows) > 1:
        coverage = sum(r["frame_ms"] for r in rows[1:]) / 1000
        elapsed = rows[-1]["time_s"] - rows[0]["time_s"]
        if abs(coverage - elapsed) > max(0.005, elapsed * 0.02):
            raise ValueError("Sparse or incomplete MangoHud capture; enable log_interval=0")
    return rows


def percentile(values, fraction):
    ordered = sorted(values)
    offset = (len(ordered) - 1) * fraction
    lower = int(offset)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (offset - lower)


def summarize(frames):
    values = [row["frame_ms"] for row in frames]
    if not values:
        raise ValueError("Cannot summarize an empty scene segment")
    descending = sorted(values, reverse=True)
    result = {
        "frames": len(values),
        "frame_duration_s": sum(values) / 1000,
        "average_fps": 1000 / statistics.mean(values),
        "low_1_percent_fps": 1000
        / statistics.mean(descending[: max(1, math.ceil(len(values) * 0.01))]),
        "low_01_percent_fps": 1000
        / statistics.mean(descending[: max(1, math.ceil(len(values) * 0.001))]),
        "p50_ms": percentile(values, 0.5),
        "p95_ms": percentile(values, 0.95),
        "p99_ms": percentile(values, 0.99),
        "p999_ms": percentile(values, 0.999),
        "worst_ms": max(values),
    }
    for threshold in (1000 / 120, 1000 / 60, 33.333333, 50, 100):
        label = f"{threshold:g}"
        result[f"over_{label}ms"] = sum(value > threshold for value in values)
    longest = current = clusters = 0
    for value in values:
        if value > 1000 / 60:
            clusters += current == 0
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    result.update(slow_frame_clusters=clusters, longest_slow_cluster_frames=longest)
    result["low_01_percent_frame_count"] = max(1, math.ceil(len(values) * 0.001))
    return result


def envelope(frames, buckets=600):
    if not frames:
        return []
    start, end = frames[0]["time_s"], frames[-1]["time_s"]
    width = max((end - start) / buckets, 1e-9)
    grouped = {}
    for row in frames:
        index = min(buckets - 1, int((row["time_s"] - start) / width))
        grouped.setdefault(index, []).append(row)
    return [
        {
            "time_s": rows[0]["time_s"],
            "end_s": rows[-1]["time_s"],
            "min_ms": min(r["frame_ms"] for r in rows),
            "max_ms": max(r["frame_ms"] for r in rows),
            "mean_ms": statistics.mean(r["frame_ms"] for r in rows),
            "count": len(rows),
            **({"scene_s": rows[0]["scene_s"]} if "scene_s" in rows[0] else {}),
        }
        for rows in grouped.values()
    ]


def paired_comparison(runs):
    if not runs or any(not run.get("valid") for run in runs):
        raise ValueError("Comparison requires valid runs; failed captures are not fast renderers")
    if any(run.get("identity") != runs[0].get("identity") for run in runs):
        raise ValueError("Build, scene, settings, display or collector changed between runs")
    pairs = []
    for repeat in sorted({run["repeat"] for run in runs}):
        pair = [run for run in runs if run["repeat"] == repeat]
        if len(pair) != 2 or {run["condition"] for run in pair} != {"control", "wallpaper"}:
            raise ValueError("Comparison requires exactly one control and wallpaper run per pair")
        control = next(run["summary"] for run in pair if run["condition"] == "control")
        wallpaper = next(run["summary"] for run in pair if run["condition"] == "wallpaper")
        pairs.append(
            {
                "repeat": repeat,
                "fps_change_percent": 100 * (wallpaper["average_fps"] / control["average_fps"] - 1),
                "p99_change_ms": wallpaper["p99_ms"] - control["p99_ms"],
            }
        )
    return {
        "pairs": pairs,
        "median_fps_change_percent": statistics.median(
            pair["fps_change_percent"] for pair in pairs
        ),
        "median_p99_change_ms": statistics.median(pair["p99_change_ms"] for pair in pairs),
        "note": "Paired scene observations; application present timing, not scanout or input latency.",
    }
