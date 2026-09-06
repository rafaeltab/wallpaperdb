#!/usr/bin/env python3
"""Analyze saved native profile artifacts without importing desktop controls."""

import argparse
import csv
import json
import math
import statistics
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path


PRESENT, REDRAW, REPEAT, BLOCK_VSYNC = 1, 2, 4, 8
PROPERTY_NAMES = (
    "time-pos",
    "duration",
    "container-fps",
    "estimated-vf-fps",
    "decoder-frame-drop-count",
    "frame-drop-count",
)
COUNTERS = (
    "frames",
    "media_render_calls",
    "media_texture_updates",
    "media_texture_reuse_frames",
    "media_new_frame_renders",
    "media_redraw_renders",
    "media_repeat_renders",
    "media_submission_reports",
    "media_file_loaded_events",
    "media_end_file_events",
    "media_position_resets",
)
LIMITS = [
    "media_target compares a sampled mpv clock with the raw next-frame target at render-call entry; it does not measure when pixels become visible or decoding completes.",
    "Target values are interpreted as nanoseconds only after empirical magnitude, offset and clock-rate checks. This supports, but cannot prove, a shared timebase. mpv 0.41 source and header disagree about target units.",
    "Playback positions are asynchronous property snapshots, sampled between their request and reply. Reply timestamps are not decoded-frame timestamps.",
    "Loop candidates assume stable duration, no seeking, and at most one wrap per accepted interval. Gaps that could reach the duration are rejected. Faster hidden complete loops between samples cannot be ruled out by position sampling alone.",
    "Render calls, texture updates/reuses, media position, libmpv drop properties and per-output compositor presentations are separate measurements. None is an independent count of decoded frames.",
    "Property age includes cached-report delay at periodic polls. The final boundary uses measurement end as a lower bound for its poll time; exact boundary poll times are not saved. The initial snapshot cannot introduce warmup samples because complete request/reply windows must fall inside the measurement interval.",
    "A compatible realtime rate is conditional evidence, not proof of correct individual frame timing or HDR. This analyzer never changes the profiler's validity result.",
]


@dataclass(frozen=True)
class Options:
    max_property_age_ms: float = 2500
    max_property_latency_ms: float = 250
    early_tolerance_ms: float = 0.5
    max_target_clock_offset_seconds: float = 10
    realtime_tolerance: float = 0.10


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def quantiles(values):
    values = sorted(value for value in values if finite(value))
    if not values:
        return {"samples": 0}

    def at(fraction):
        index = (len(values) - 1) * fraction
        lo, hi = math.floor(index), math.ceil(index)
        return values[lo] + (values[hi] - values[lo]) * (index - lo)

    return {
        "samples": len(values),
        "min": values[0],
        "p01": at(0.01),
        "p50": at(0.5),
        "p95": at(0.95),
        "p99": at(0.99),
        "max": values[-1],
    }


def report_time(stats):
    estimates = [
        entry["replied_at_monotonic"] + entry["age_ms"] / 1000
        for entry in stats.get("media_properties", {}).values()
        if isinstance(entry, dict)
        and finite(entry.get("replied_at_monotonic"))
        and finite(entry.get("age_ms"))
        and entry["age_ms"] >= 0
    ]
    return statistics.median(estimates) if estimates else None


def collect_properties(observations, start, end, options):
    """Deduplicate completed replies, retaining the earliest observation of each."""
    result = {}
    for name in PROPERTY_NAMES:
        entries, duplicates, rejected, conflicts = {}, 0, Counter(), set()
        last = None
        for observation in observations:
            stats = observation["stats"]
            entry = stats.get("media_properties", {}).get(name)
            if not isinstance(entry, dict):
                continue
            seen_at = observation.get("observed_at")
            estimated_report = report_time(stats)
            order = seen_at if finite(seen_at) else estimated_report
            if last is None or (finite(order) and (not finite(last[0]) or order >= last[0])):
                last = (order, entry)
            request = entry.get("sample_requested_at_monotonic")
            reply = entry.get("replied_at_monotonic")
            value = entry.get("value")
            if not finite(stats.get("pid")) or stats["pid"] <= 0:
                rejected["missing_renderer_identity"] += 1
                continue
            if not all(finite(v) for v in (request, reply, value)):
                rejected["missing_or_nonfinite_value_or_timestamp"] += 1
                continue
            key = (stats.get("pid"), request, reply)
            candidate = {
                "pid": stats.get("pid"),
                "requested_at": request,
                "replied_at": reply,
                "midpoint": (request + reply) / 2,
                "value": value,
                "paused": stats.get("paused"),
                "observed_at": seen_at,
                "reported_age_ms": entry.get("age_ms"),
                "error": entry.get("error"),
                "origin": observation.get("origin"),
            }
            if key in entries:
                duplicates += 1
                if entries[key]["value"] != value:
                    conflicts.add(key)
                previous_seen = entries[key]["observed_at"]
                if finite(seen_at) and (not finite(previous_seen) or seen_at < previous_seen):
                    entries[key] = candidate
            else:
                entries[key] = candidate

        samples = []
        for key, sample in entries.items():
            request, reply = sample["requested_at"], sample["replied_at"]
            reported_age = sample["reported_age_ms"]
            observed_age = (
                (sample["observed_at"] - reply) * 1000 if finite(sample["observed_at"]) else None
            )
            reason = None
            if key in conflicts:
                reason = "conflicting_duplicate_reply"
            elif sample["error"]:
                reason = "property_error"
            elif request > reply or request <= 0:
                reason = "invalid_timestamp_order"
            elif not (start <= request <= reply <= end):
                reason = "outside_measurement_window"
            elif (reply - request) * 1000 > options.max_property_latency_ms:
                reason = "request_reply_latency"
            elif not finite(reported_age) or reported_age < 0:
                reason = "missing_or_invalid_reported_age"
            elif finite(observed_age) and observed_age < -0.01:
                reason = "observation_precedes_reply"
            elif max(reported_age, observed_age or 0) > options.max_property_age_ms:
                reason = "stale_at_observation"
            if reason:
                rejected[reason] += 1
                continue
            sample["freshness_at_observation_ms"] = max(reported_age, observed_age or 0)
            sample["request_reply_ms"] = (reply - request) * 1000
            samples.append(sample)
        samples.sort(key=lambda sample: sample["midpoint"])
        values = [sample["value"] for sample in samples]
        resets = sum(b < a for a, b in zip(values, values[1:]))
        last_entry = last[1] if last else {}
        pending_since = last_entry.get("request_pending_since_monotonic")
        result[name] = {
            "samples": samples,
            "unique_completed_replies": len(entries),
            "accepted_samples": len(samples),
            "duplicate_observations": duplicates,
            "rejected_samples": dict(rejected),
            "value_distribution": quantiles(values),
            "first_value": values[0] if values else None,
            "last_value": values[-1] if values else None,
            "observed_value_decreases": resets,
            "endpoint_delta": values[-1] - values[0] if len(values) >= 2 else None,
            "sampled_counter_delta_if_no_observed_reset": (
                values[-1] - values[0]
                if name.endswith("drop-count") and len(values) >= 2 and not resets
                else None
            ),
            "request_reply_ms": quantiles([sample["request_reply_ms"] for sample in samples]),
            "freshness_at_observation_ms": quantiles(
                [sample["freshness_at_observation_ms"] for sample in samples]
            ),
            "last_reply_before_end_ms": (
                (end - samples[-1]["replied_at"]) * 1000 if samples else None
            ),
            "last_observation_pending": last_entry.get("pending"),
            "last_observation_pending_age_ms": (
                max(0, (last[0] - pending_since) * 1000)
                if last and finite(last[0]) and finite(pending_since)
                else None
            ),
            "last_observation_error": last_entry.get("error"),
        }
    return result


def analyze_positions(streams, options, start, end):
    samples = streams["time-pos"]["samples"]
    durations = streams["duration"]["samples"]
    duration_values = [sample["value"] for sample in durations if sample["value"] > 0]
    duration = statistics.median(duration_values) if duration_values else None
    result = {
        "status": "insufficient_evidence",
        "position_samples": len(samples),
        "duration_seconds": duration,
        "duration_samples": len(duration_values),
        "accepted_intervals": 0,
        "rejected_intervals": {},
        "single_wrap_candidates": 0,
        "observed_wall_seconds": 0,
        "position_advance_seconds": 0,
        "rate_media_seconds_per_wall_second": None,
        "rate_bounds_from_async_timing": None,
        "measurement_coverage_fraction": 0,
        "intervals": [],
        "assumptions": "Stable source duration; no seeking; at most one wrap in accepted gaps. Loop counts are candidates under those assumptions.",
    }
    if len({sample["pid"] for sample in samples + durations}) > 1:
        result["status"] = "renderer_restarted"
        return result
    if duration is None:
        result["status"] = "duration_unavailable"
        return result
    if max(duration_values) - min(duration_values) > max(0.001, duration * 0.0001):
        result["status"] = "duration_changed"
        return result
    rejected, intervals = Counter(), []
    for before, after in zip(samples, samples[1:]):
        wall = after["midpoint"] - before["midpoint"]
        wall_min = after["requested_at"] - before["replied_at"]
        wall_max = after["replied_at"] - before["requested_at"]
        reason = None
        if before["paused"] is True or after["paused"] is True:
            reason = "paused_or_pause_transition"
        elif before["paused"] is not False or after["paused"] is not False:
            reason = "pause_state_unavailable"
        elif wall_min <= 0:
            reason = "overlapping_or_reordered_sample_windows"
        elif wall_max >= duration:
            reason = "gap_at_least_source_duration"
        elif not all(0 <= sample["value"] <= duration + 0.001 for sample in (before, after)):
            reason = "position_outside_source_duration"
        elif any(
            not any(
                abs(sample["midpoint"] - d["midpoint"]) * 1000 <= options.max_property_age_ms
                for d in durations
            )
            for sample in (before, after)
        ):
            reason = "no_recent_duration_sample"
        if reason:
            rejected[reason] += 1
            continue
        delta = after["value"] - before["value"]
        wrapped = delta < -0.001
        advance = delta + duration if wrapped else max(0, delta)
        intervals.append(
            {
                "from_monotonic": before["midpoint"],
                "to_monotonic": after["midpoint"],
                "wall_seconds": wall,
                "wall_min_seconds": wall_min,
                "wall_max_seconds": wall_max,
                "position_from": before["value"],
                "position_to": after["value"],
                "single_wrap_candidate": wrapped,
                "advance_seconds": advance,
                "rate": advance / wall,
            }
        )
    wall = sum(interval["wall_seconds"] for interval in intervals)
    advance = sum(interval["advance_seconds"] for interval in intervals)
    bounds = (
        [
            advance / sum(interval[key] for interval in intervals)
            for key in ("wall_max_seconds", "wall_min_seconds")
        ]
        if intervals
        else None
    )
    result.update(
        {
            "accepted_intervals": len(intervals),
            "rejected_intervals": dict(rejected),
            "single_wrap_candidates": sum(
                interval["single_wrap_candidate"] for interval in intervals
            ),
            "observed_wall_seconds": wall,
            "position_advance_seconds": advance,
            "rate_media_seconds_per_wall_second": advance / wall if wall else None,
            "rate_bounds_from_async_timing": bounds,
            "interval_rate_distribution": quantiles([interval["rate"] for interval in intervals]),
            "measurement_coverage_fraction": wall / (end - start) if end > start else 0,
            "intervals": intervals,
        }
    )
    if len(intervals) >= 3 and wall >= 3:
        result["status"] = (
            "faster_than_realtime_or_seeking"
            if bounds[0] > 1 + options.realtime_tolerance
            else (
                "slower_than_realtime_or_paused"
                if bounds[1] < 1 - options.realtime_tolerance
                else "compatible_with_realtime"
            )
        )
    return result


def analyze_targets(rows, options):
    eligible, excluded = [], Counter()
    for row in rows:
        try:
            flags = int(row["flags"])
            target, clock = float(row["value"]), float(row["value2"])
            stamp = float(row["monotonic"])
            if not all(math.isfinite(v) for v in (target, clock, stamp)):
                raise ValueError("nonfinite target row")
        except (ValueError, TypeError, KeyError, OverflowError):
            excluded["malformed"] += 1
            continue
        reason = (
            "redraw_or_repeat"
            if flags & (REDRAW | REPEAT)
            else (
                "no_present_flag"
                if not flags & PRESENT
                else (
                    "vsync_or_unknown_flags"
                    if flags & ~(PRESENT | REDRAW | REPEAT)
                    else (
                        "zero_target"
                        if target == 0
                        else "nonpositive_clock_or_target" if clock <= 0 or target < 0 else None
                    )
                )
            )
        )
        if reason:
            excluded[reason] += 1
            continue
        eligible.append(
            {
                "monotonic": stamp,
                "frame": row.get("frame"),
                "target": int(target),
                "clock": int(clock),
                "lead_ms": (target - clock) / 1e6,
            }
        )
    eligible.sort(key=lambda row: row["monotonic"])
    lead = [row["lead_ms"] for row in eligible]
    ratios = [row["target"] / row["clock"] for row in eligible]
    incompatible = sum(
        not (0.5 <= row["target"] / row["clock"] <= 2)
        or abs(row["lead_ms"]) > options.max_target_clock_offset_seconds * 1000
        for row in eligible
    )
    span = eligible[-1]["monotonic"] - eligible[0]["monotonic"] if eligible else 0
    clock_delta = (eligible[-1]["clock"] - eligible[0]["clock"]) / 1e9 if eligible else 0
    clock_rate = clock_delta / span if span > 0 else None
    target_rate = (
        (eligible[-1]["target"] - eligible[0]["target"]) / 1e9 / clock_delta
        if clock_delta > 0
        else None
    )
    regressions = sum(b["clock"] < a["clock"] for a, b in zip(eligible, eligible[1:]))
    if not eligible:
        timebase = "unavailable"
    elif incompatible:
        timebase = "incompatible_or_large_clock_offset"
    elif span < 1:
        timebase = "insufficient_span"
    elif (
        regressions
        or not 0.95 <= clock_rate <= 1.05
        or target_rate is None
        or not 0.95 <= target_rate <= 1.05
    ):
        timebase = "inconsistent_clock_progression"
    else:
        timebase = "consistent_with_nanosecond_clock"
    comparable = timebase == "consistent_with_nanosecond_clock"
    early = (
        [row for row in eligible if row["lead_ms"] > options.early_tolerance_ms]
        if comparable
        else []
    )
    classification = (
        "unavailable_timebase"
        if not comparable
        else (
            "no_early_requests_observed"
            if not early
            else (
                "systematic_early_requests"
                if len(early) > len(eligible) / 2
                else "early_requests_observed"
            )
        )
    )
    return {
        "rows": len(rows),
        "eligible_rows": len(eligible),
        "excluded_rows": dict(excluded),
        "timebase_status": timebase,
        "classification": classification,
        "incompatible_rows": incompatible,
        "sampled_clock_regressions": regressions,
        "span_seconds": span,
        "raw_target_to_clock_ratio": quantiles(ratios),
        "sampled_clock_seconds_per_log_second": clock_rate,
        "target_progress_per_clock_progress": target_rate,
        "sampled_clock_minus_log_monotonic_seconds": quantiles(
            [row["clock"] / 1e9 - row["monotonic"] for row in eligible]
        ),
        "target_lead_ms": quantiles(lead),
        "target_age_ms": quantiles([-value for value in lead]),
        "quantile_units_validated": comparable,
        "early_tolerance_ms": options.early_tolerance_ms,
        "early_requests": len(early) if comparable else None,
        "early_fraction": len(early) / len(eligible) if comparable else None,
        "early_examples": early[:8],
        "first_pair": eligible[0] if eligible else None,
        "last_pair": eligible[-1] if eligible else None,
        "csv_float64_max_ulp_ns": max(
            (math.ulp(float(row[key])) for row in eligible for key in ("target", "clock")),
            default=None,
        ),
    }


def read_frame_csv(path, start, end, options, required=True):
    targets, counts, outputs, errors = [], Counter(), {}, []
    malformed = 0
    try:
        with path.open(newline="") as handle:
            reader = csv.DictReader(handle)
            if not {"monotonic", "event", "frame", "output", "value", "value2", "flags"}.issubset(
                reader.fieldnames or []
            ):
                raise csv.Error("missing required frame CSV columns")
            for line, row in enumerate(reader, 2):
                try:
                    event = row["event"]
                    stamp = float(row["value"] if event == "presented" else row["monotonic"])
                    if not math.isfinite(stamp):
                        raise ValueError("nonfinite event timestamp")
                    if not start <= stamp <= end:
                        continue
                    counts[event] += 1
                    if event == "media_target":
                        targets.append(row)
                    elif event == "presented":
                        output = outputs.setdefault(row["output"], {"presented_frames": 0})
                        output["presented_frames"] += 1
                except (ValueError, TypeError, KeyError) as error:
                    malformed += 1
                    if len(errors) < 8:
                        errors.append(f"{path}:{line}: {error}")
    except (OSError, csv.Error) as error:
        if required or not isinstance(error, FileNotFoundError):
            errors.append(f"{path}: {error}")
    seconds = end - start
    available = path.is_file()
    for output in outputs.values():
        output["presented_hz"] = output["presented_frames"] / seconds if seconds > 0 else None
    return {
        "path": str(path),
        "available": available,
        "errors": errors,
        "malformed_rows": malformed,
        "event_counts": dict(counts),
        "outputs": outputs,
        "scene_submission_rows": counts["cpu"] if available else None,
        "scene_submission_hz": counts["cpu"] / seconds if available and seconds > 0 else None,
        "media_render_rows": counts["media"] if available else None,
        "media_render_call_hz": counts["media"] / seconds if available and seconds > 0 else None,
        "target_timing": analyze_targets(targets, options),
    }


def counter_evidence(observations, start, end):
    snapshots, excluded = {}, Counter()
    for observation in observations:
        stats = observation["stats"]
        stamp = report_time(stats)
        if not finite(stamp):
            excluded["no_internal_report_time"] += 1
        elif not start <= stamp <= end:
            excluded["outside_measurement_window"] += 1
        else:
            snapshots[(stats.get("pid"), stamp)] = stats
    ordered = sorted(snapshots.items(), key=lambda item: item[0][1])
    sessions = {key[0] for key, _ in ordered}
    result = {
        "status": "unavailable",
        "report_samples": len(ordered),
        "excluded_snapshots": dict(excluded),
        "scope": "Differences between internally timed reports within the measurement window; excludes unsampled edges. Report time estimated from reply timestamp + reported property age.",
        "interval": None,
        "counts": {},
    }
    if len(sessions) > 1:
        result["status"] = "renderer_restarted"
        return result
    if len(ordered) < 2:
        return result
    first, last = ordered[0], ordered[-1]
    seconds = last[0][1] - first[0][1]
    result.update(
        status="observed",
        interval={
            "start_monotonic": first[0][1],
            "end_monotonic": last[0][1],
            "seconds": seconds,
            "measurement_coverage_fraction": seconds / (end - start) if end > start else 0,
        },
    )
    for name in COUNTERS:
        values = [stats[name] for _, stats in ordered if finite(stats.get(name))]
        if len(values) != len(ordered):
            continue
        decreases = sum(b < a for a, b in zip(values, values[1:]))
        delta = values[-1] - values[0] if not decreases else None
        result["counts"][name] = {
            "first": values[0],
            "last": values[-1],
            "delta": delta,
            "rate_per_second": delta / seconds if delta is not None and seconds > 0 else None,
            "decreases": decreases,
        }
    return result


def load_observations(run, run_dir, output):
    observations, errors = [], []
    for key in ("measurement_initial_telemetry", "final_telemetry"):
        if isinstance(run.get(key), dict) and run[key]:
            observations.append(
                {
                    "observed_at": run.get("end") if key == "final_telemetry" else None,
                    "origin": key,
                    "stats": run[key],
                }
            )
    path = run_dir / "telemetry.json"
    try:
        entries = json.loads(path.read_text())
        if not isinstance(entries, list):
            raise ValueError("expected telemetry list")
        for entry in entries:
            if not isinstance(entry, dict) or not finite(entry.get("monotonic")):
                raise ValueError("telemetry entry lacks a finite monotonic timestamp")
            for surface in entry.get("surfaces", []):
                if surface.get("output") == output and isinstance(surface.get("telemetry"), dict):
                    observations.append(
                        {
                            "observed_at": entry["monotonic"],
                            "origin": "periodic",
                            "stats": surface["telemetry"],
                        }
                    )
    except (OSError, ValueError, TypeError, AttributeError) as error:
        errors.append(f"{path}: {error}")
    return observations, errors


def analyze_report(path, options):
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or not isinstance(data.get("runs"), list):
        raise ValueError("expected a profile report with a runs list")
    arguments = data.get("manifest", {}).get("arguments", {})
    output = arguments.get("wallpaper_output")
    result = {"path": str(path), "source": arguments.get("source"), "output": output, "runs": []}
    for run in data["runs"]:
        name, start, end = run["name"], run.get("start"), run.get("end")
        if not isinstance(name, str) or Path(name).name != name or name in (".", ".."):
            raise ValueError("run name must be one directory component")
        if not finite(start) or not finite(end) or end < start:
            raise ValueError(f"{name}: invalid measurement interval")
        observations, errors = load_observations(run, path.parent / name, output)
        if output is None:
            errors.append("Manifest lacks wallpaper_output; no periodic surface was selected")
        streams = collect_properties(observations, start, end, options)
        final = run.get("final_telemetry", {})
        expected_csv = bool(run.get("wallpaper", {}).get("available")) or (
            str(final.get("renderer", "")).startswith("Lua / OpenGL") or "gpu-independent" in name
        )
        frames = read_frame_csv(
            path.parent / name / "wallpaper-frames.csv", start, end, options, required=expected_csv
        )
        result["runs"].append(
            {
                "name": name,
                "profile_valid": run.get("valid"),
                "profile_completed": run.get("completed"),
                "profile_errors": run.get("errors", []),
                "errors": errors + frames["errors"],
                "start": start,
                "end": end,
                "measured_seconds": end - start,
                "requested_fps": run.get("requested_wallpaper_fps"),
                "effective_fps_limit": run.get("effective_wallpaper_fps_limit"),
                "media_drop_policy": {
                    "requested": final.get("media_framedrop_requested"),
                    "applied": final.get("media_framedrop"),
                    "verified_at_init": final.get("media_framedrop_verified_at_init"),
                    "decoder_drop_enabled": final.get("media_decoder_drop_enabled"),
                    "scope": final.get("media_framedrop_scope"),
                },
                "renderer": final.get("renderer"),
                "canvas": final.get("canvas"),
                "hdr": final.get("hdr"),
                "observations": len(observations),
                "frame_csv": frames,
                "position_evidence": analyze_positions(streams, options, start, end),
                "sampled_counters": counter_evidence(observations, start, end),
                "media_properties": streams,
                "drop_counter_note": "decoder-frame-drop-count and frame-drop-count are libmpv counters. Endpoint deltas are sampled, and decreases may be resets; never add them to render counts or infer a decoded-frame total.",
                "fps_property_note": "container-fps is metadata; estimated-vf-fps is a filter-chain estimate. Both may be inaccurate and are reported independently of scene presentation rate.",
            }
        )
    return result


def markdown(data):
    def number(value):
        return f"{value:.3f}" if finite(value) else "unavailable"

    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")

    lines = [
        "Independent media evidence",
        "",
        "All results are observations of saved artifacts; profiler validity is retained.",
        "",
    ]
    for report in data["reports"]:
        lines += [
            f"Report: `{report['path']}`",
            "",
            f"Source: `{report['source']}`; output: `{report['output']}`.",
            "",
            "| Run | Profile valid | Scene submissions/s | Media render calls/s | Target lead p50 / p99 ms | Early requests | Position rate | Wrap candidates |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for run in report["runs"]:
            frames, position = run["frame_csv"], run["position_evidence"]
            target = frames["target_timing"]
            lead = target["target_lead_ms"] if target["quantile_units_validated"] else {}
            lines.append(
                "| "
                + " | ".join(
                    map(
                        cell,
                        [
                            run["name"],
                            run["profile_valid"],
                            number(frames["scene_submission_hz"]),
                            number(frames["media_render_call_hz"]),
                            f"{number(lead.get('p50'))} / {number(lead.get('p99'))}",
                            f"{target['early_requests']} / {target['eligible_rows']}",
                            number(position["rate_media_seconds_per_wall_second"]),
                            position["single_wrap_candidates"],
                        ],
                    )
                )
                + " |"
            )
        lines.append("")
        for run in report["runs"]:
            target, position, counters = (
                run["frame_csv"]["target_timing"],
                run["position_evidence"],
                run["sampled_counters"],
            )
            reuse = counters["counts"].get("media_texture_reuse_frames", {}).get("delta")
            lines += [
                f"- `{run['name']}`: target `{target['classification']}` ({target['timebase_status']}); position `{position['status']}`, covering {position['measurement_coverage_fraction']:.1%} of measurement time. Sampled texture reuse delta: {reuse}. Rejected position intervals: {json.dumps(position['rejected_intervals'])}.",
            ]
            policy = run["media_drop_policy"]
            if policy["requested"] is not None:
                lines.append(
                    f"  Media drop policy: requested `{policy['requested']}`, applied `{policy['applied']}`; verified at initialization: {policy['verified_at_init']}. Source frames may be skipped; scene rates do not count unique video frames."
                )
            for name in ("decoder-frame-drop-count", "frame-drop-count"):
                prop = run["media_properties"][name]
                lines.append(
                    f"  {name}: {prop['first_value']} → {prop['last_value']}; sampled delta without observed reset {prop['sampled_counter_delta_if_no_observed_reset']}; decreases {prop['observed_value_decreases']}; {prop['accepted_samples']} fresh replies; last reply {number(prop['last_reply_before_end_ms'])} ms before measurement end."
                )
            if run["errors"]:
                lines.append(f"  Artifact errors: {json.dumps(run['errors'])}")
        lines.append("")
    lines += ["Limits", ""] + [f"- {limit}" for limit in data["limits"]]
    if data["errors"]:
        lines += ["", "Input errors", ""] + [f"- {error}" for error in data["errors"]]
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "reports",
        type=Path,
        nargs="+",
        help="profile report.json paths or their parent directories",
    )
    parser.add_argument(
        "--json", type=Path, help="write detailed analysis JSON; otherwise print it"
    )
    parser.add_argument("--markdown", type=Path, help="also write a compact human-readable report")
    for field, default in asdict(Options()).items():
        parser.add_argument("--" + field.replace("_", "-"), type=float, default=default)
    args = parser.parse_args(argv)
    options = Options(**{field: getattr(args, field) for field in asdict(Options())})
    if any(not math.isfinite(value) or value <= 0 for value in asdict(options).values()):
        parser.error("analysis thresholds must be finite and positive")
    if options.realtime_tolerance >= 1:
        parser.error("realtime tolerance must be less than one")
    data = {
        "schema_version": 1,
        "options": asdict(options),
        "reports": [],
        "errors": [],
        "limits": LIMITS,
    }
    for path in args.reports:
        path = (path / "report.json" if path.is_dir() else path).resolve()
        try:
            data["reports"].append(analyze_report(path, options))
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            data["errors"].append(f"{path}: {type(error).__name__}: {error}")
    serialized = json.dumps(data, indent=2, allow_nan=False) + "\n"
    if args.json:
        args.json.write_text(serialized)
    else:
        print(serialized, end="")
    if args.markdown:
        args.markdown.write_text(markdown(data))
    # Timing findings are evidence, not an automatic acceptance gate.
    # A nonzero exit signals unreadable/malformed inputs, including per-run artifacts.
    return (
        2
        if data["errors"]
        or any(run["errors"] for report in data["reports"] for run in report["runs"])
        else 0
    )


if __name__ == "__main__":
    raise SystemExit(main())
