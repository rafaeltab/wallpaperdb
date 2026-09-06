"""Publish portable comparisons after captures have finished; never starts a renderer.

Example: --study virtual=verification/stress-... --study physical=verification/...
         --output-dir results/stress

Paths are relative to the caller. Each study contains child*/report.json; a single
profile directory with report.json is also accepted. Only summary.json/index.html
are written. Raw reports remain in their original directories and are linked
relative to the publication directory. Run this after the writers have stopped.
"""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import statistics
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
BIN_SECONDS = 0.1
OMIT_KEYS = {
    "process_topology",
    "original_assignments",
    "intervals_ms",
    "pid",
    "ppid",
    "start_ticks",
    "serial",
    "serialNumber",
    "serial_number",
    "address",
    "frames_file",
}
CPU_FIELDS = ("wallpaper_cpu", "contender_cpu", "compositor_cpu", "profiler_cpu")
RESOURCE_FIELDS = (
    "gpu_percent",
    "memory_percent",
    "watts",
    "graphics_mhz",
    "temperature_c",
    "cpu_temperature_c",
    "decoder_percent",
    "decoder_sample_us",
    "vram_total_mib",
    "vram_free_mib",
    "vram_used_mib",
    "ram_available_mib",
    "cpu_scaling_mhz_min",
    "cpu_scaling_mhz_mean",
    "cpu_scaling_mhz_max",
)
MIN_FIELDS = {"vram_free_mib", "ram_available_mib"}
METHOD = {
    "cpu": "Percent of one logical core: 100% is one fully occupied core. Aggregate CPU is the median of valid runs' supported time-weighted process CPU-counter means, not a mean of instantaneous samples. Native evidence or a retrospective audit matched by raw-report SHA-256 and run name must support each mean. Sampled peaks/tails need their own coverage evidence. Unsupported CPU metrics and plots stay null; presentation/resource measurements may remain valid. Each CPU metric reports its contributing run count.",
    "groups": "Group by study, batch, build and engine/case. Invalid and zero-measurement runs are retained but excluded from aggregates. Each aggregate median/range describes per-run values; a median of per-run p99 values is not a pooled/global p99.",
    "presentations": "Delivered FPS and interval distributions come from compositor presentation feedback. Missing WebKit feedback stays null; browser callback snapshots are retained separately and never substituted for delivered FPS.",
    "missed_target_slots": "Estimated missed target slots per minute are derived from sum((sequence increment - 1) * count) only for a conventional physical connector in monitor evidence, positive sequence increments, and a target within 1% of recorded refresh. This estimates unfilled refresh slots between observed presentations, not individually traced lost frames. Virtual/zero sequences and other target-to-refresh ratios remain null.",
    "browser_callbacks": "Initial telemetry is captured before warmup, final telemetry after measurement. Newer reports also retain a post-warmup measurement-initial snapshot, sampled before the timed interval starts. These snapshots do not provide exactly aligned counter endpoints for measurement-window FPS. Reported browser FPS values are snapshots only. Native mpv telemetry FPS is container metadata and is excluded from browser callbacks.",
    "video_progress": "Playback progress evidence is copied from the profiler, including its method, status and limits. Native media-update counts describe libmpv render-update submissions; browser playback-quality counters describe video display accounting. Neither is a compositor-presentation or independently measured decoder count. Presentations can reuse a retained media texture, so a high delivered FPS need not mean equally frequent media updates. Media render-update rate is shown only for a native media path with recorded update evidence; static images, scenes without media and uninstrumented browser/mpvpaper media paths remain unavailable.",
    "content_behavior": "A retained static image may remain visible with zero new presentations after warmup. Recorded zero is preserved; absent feedback stays null. A paused case records a pause request, whose verification and scope come from pause_evidence. Zero frames or browser callbacks alone do not prove pause, decoder inactivity or stationary pixels.",
    "plots": "Presentation plots retain the MAXIMUM interval in each 100 ms bin. CPU and activity/resource plots retain sampled maxima; free RAM/VRAM plots retain minima. Empty bins are absent, not zero. Plots cannot recover exact hitch timing or event order inside a bin; the original statistics and relative raw-report links remain available.",
    "gpu": "GPU activity, memory activity, power, temperatures and graphics clocks describe the whole sampled NVIDIA device/desktop, not a single process. NVML activity integrates its native coarse sampling window. OS CPU-frequency descriptors are not proof of throttling.",
    "resources": "Free VRAM and MemAvailable minima are derived from measured-window gpu_timeline samples before discarding that timeline. They do not describe unobserved between-sample minima or pre-measurement guard activity.",
    "comparison": "Read output, source, requested/effective FPS, renderer, recorder, pointer, background-activity and source/binary hash evidence together. A virtual display measures rendering/compositor feedback, not physical scanout. Lower CPU at a lower delivered rate does not establish higher efficiency.",
    "portability": "summary.json contains statistics and provenance without plot traces. index.html embeds the same records plus 100 ms binned plots and remains standalone. Neither artifact includes full-resolution timelines. Raw links are relative to this output directory; keep the original study folders in that relative position to use them. Machine-local paths and process IDs are removed from copied provenance.",
}


def number(value):
    return (
        value
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        else None
    )


def mapping(value):
    return value if isinstance(value, dict) else {}


def sequence(value):
    return value if isinstance(value, list) else []


def portable(value, prefixes):
    if isinstance(value, dict):
        return {
            key: portable(item, prefixes)
            for key, item in value.items()
            if key not in OMIT_KEYS
            and not re.search(
                r"(?:^|_)(?:pids?|ppids?|process_ids?|thread_ids?)$",
                re.sub(r"([a-z])([A-Z])", r"\1_\2", str(key)).lower(),
            )
        }
    if isinstance(value, list):
        return [portable(item, prefixes) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, str):
        text = value
        # Relative report links may traverse a directory named home or tmp. They
        # must remain resolvable, even when the preview is outside the repository.
        if text.startswith("../") or text.startswith("./"):
            return text
        for source, replacement in prefixes:
            text = replacement if text == source else text.replace(source + "/", replacement + "/")
        text = re.sub(
            r"/(?:home|run/user|tmp|var/tmp|nix/store)/[^\s\"'<>\]\)]+",
            lambda match: "<local-path>/" + match.group(0).rstrip("/").rsplit("/", 1)[-1],
            text,
        )
        if text.startswith("file://"):
            text = text[7:]
        if text.startswith("/"):
            text = "<local-path>/" + text.rstrip("/").rsplit("/", 1)[-1]
        text = re.sub(r"\b((?:P|PP)ID)\s*[:=]?\s+\d+\b", r"\1 <redacted>", text, flags=re.I)
        return text
    return value


def relative_url(path, output):
    return quote(Path(os.path.relpath(path, output)).as_posix(), safe="/.")


def read_json(path):
    contents = path.read_bytes()
    return json.loads(contents), hashlib.sha256(contents).hexdigest()


def duration_of(run):
    duration = number(run.get("measured_seconds"))
    if duration is None:
        start, end = number(run.get("start")), number(run.get("end"))
        duration = end - start if start is not None and end is not None else 0
    return max(0, duration)


def bin_index(seconds, duration):
    if number(seconds) is None or duration <= 0 or seconds < 0 or seconds > duration:
        return None
    return min(int(seconds / BIN_SECONDS), max(0, math.ceil(duration / BIN_SECONDS) - 1))


def interval_bins(points, duration):
    slots, accepted, rejected = {}, 0, 0
    for point in sequence(points):
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            rejected += 1
            continue
        index, value = bin_index(point[0], duration), number(point[1])
        if index is None or value is None or value < 0:
            rejected += 1
            continue
        slots[index] = max(slots.get(index, value), value)
        accepted += 1
    return {
        "samples": accepted,
        "rejected_samples": rejected,
        "max_ms": [
            [round(index * BIN_SECONDS, 6), round(value, 6)]
            for index, value in sorted(slots.items())
        ],
    }


def measured_resource_rows(run):
    start, duration = number(run.get("start")), duration_of(run)
    if start is None:
        return []
    return [
        row
        for row in sequence(run.get("gpu_timeline"))
        if isinstance(row, dict)
        and number(row.get("monotonic")) is not None
        and bin_index(row["monotonic"] - start, duration) is not None
    ]


def resource_bins(run, gpu_rows):
    columns = [*CPU_FIELDS, "rss_mib", *RESOURCE_FIELDS]
    start, duration, slots = number(run.get("start")), duration_of(run), {}
    if start is not None:
        for rows, fields in [
            (sequence(run.get("cpu_timeline")), [*CPU_FIELDS, "rss_mib"]),
            (gpu_rows, RESOURCE_FIELDS),
        ]:
            for row in rows:
                if not isinstance(row, dict) or number(row.get("monotonic")) is None:
                    continue
                index = bin_index(row["monotonic"] - start, duration)
                if index is None:
                    continue
                target = slots.setdefault(index, {})
                for field in fields:
                    value = number(row.get(field))
                    if value is not None:
                        combine = min if field in MIN_FIELDS else max
                        target[field] = combine(target.get(field, value), value)
    return {
        "columns": ["seconds", *columns],
        "reductions": {field: "min" if field in MIN_FIELDS else "max" for field in columns},
        "rows": [
            [
                round(index * BIN_SECONDS, 6),
                *[round(values[field], 6) if field in values else None for field in columns],
            ]
            for index, values in sorted(slots.items())
        ],
    }


def cpu_evidence_for(run):
    evidence = dict(mapping(run.get("cpu_evidence")))
    if not evidence:
        return {
            "status": "unverified",
            "mean_valid": False,
            "tails_valid": False,
            "errors": [
                "CPU coverage and worker evidence unavailable; no matching audit was supplied"
            ],
        }
    evidence["mean_valid"] = evidence.get("mean_valid") is True
    evidence["tails_valid"] = evidence["mean_valid"] and evidence.get("tails_valid") is True
    evidence["status"] = (
        "verified"
        if evidence["tails_valid"]
        else (
            "partial"
            if evidence["mean_valid"]
            else (
                evidence.get("status")
                if evidence.get("status") in ("disabled", "unverified")
                else "unknown"
            )
        )
    )
    return evidence


def gated_cpu_metrics(values, evidence):
    result = dict(mapping(values))
    result["evidence_status"] = evidence["status"]
    if evidence.get("mean_valid") is not True:
        result["mean"] = None
    if evidence.get("tails_valid") is not True:
        for key in ("min", "p50", "p95", "p99", "p999", "max", "sample_mean"):
            result[key] = None
    return result


def weighted_cpu_mean(run):
    evidence = cpu_evidence_for(run)
    if evidence["mean_valid"] is not True:
        return None, "unavailable; CPU sampling coverage or worker evidence failed"
    cpu = mapping(run.get("cpu"))
    if "time-weighted" in str(cpu.get("mean_method", "")):
        return number(cpu.get("mean")), cpu["mean_method"]
    # Older captures may retain the counter samples but omit the method label.
    total, seconds = 0.0, 0.0
    start, duration = number(run.get("start")), duration_of(run)
    rows = [
        row
        for row in sequence(run.get("cpu_timeline"))
        if isinstance(row, dict)
        and number(row.get("monotonic")) is not None
        and (start is None or start <= row["monotonic"] <= start + duration)
    ]
    for previous, current in zip(rows, rows[1:]):
        a, b, value = (
            number(previous.get("monotonic")),
            number(current.get("monotonic")),
            number(current.get("wallpaper_cpu")),
        )
        if a is not None and b is not None and value is not None and b > a:
            seconds += b - a
            total += (b - a) * value
    if seconds:
        return (
            total / seconds,
            "time-weighted process CPU-counter deltas, reconstructed from retained samples",
        )
    return None, "unavailable; no time-weighted mean or usable counter-time samples"


def apply_cpu_audit(run, audit):
    """Add hash-matched retrospective evidence without rewriting raw captures."""
    result = dict(run)
    if run.get("cpu_evidence") is not None:
        result["recorded_cpu_evidence"] = run["cpu_evidence"]
    result["cpu_evidence"] = dict(audit) | {"retrospective": True}
    evidence = cpu_evidence_for(result)
    result["cpu"] = gated_cpu_metrics(run.get("cpu"), evidence)
    result["cpu_by_role"] = {
        role: gated_cpu_metrics(values, evidence)
        for role, values in mapping(run.get("cpu_by_role")).items()
    }
    return result


def callback_snapshot(stats):
    stats = mapping(stats)
    browser = mapping(stats.get("browser")) if "browser" in stats else stats
    # In particular, renderer="mpv" reports container-fps rather than browser
    # callbacks. Keep that native metadata only in the original telemetry.
    if not browser or ("browser" not in stats and stats.get("renderer")):
        return {"frames": None, "reported_fps": None, "scene": None}
    return {
        "frames": number(browser.get("frames")),
        "reported_fps": number(browser.get("fps")),
        "scene": browser.get("scene"),
    }


def frame_stats(value):
    raw = mapping(value)
    available = raw.get("available") is True
    return {
        "available": available,
        "presented_frames": number(raw.get("presented_frames")) if available else None,
        "presented_hz": number(raw.get("presented_hz")) if available else None,
        "media_updates": number(raw.get("media_updates")) if available else None,
        "media_update_hz": number(raw.get("media_update_hz")) if available else None,
        "last_media_update": number(raw.get("last_media_update")) if available else None,
        "presentation_ms": raw.get("presentation_ms") if available else None,
        "gpu_command_ms": raw.get("gpu_command_ms") if available else None,
        "cpu_submit_ms": raw.get("cpu_submit_ms") if available else None,
        "sequence_gaps": raw.get("sequence_gaps") if available else None,
        "discarded": raw.get("discarded") if available else None,
        "feedback_flags": raw.get("feedback_flags") if available else None,
        "outputs": raw.get("outputs") if available else None,
    }


def media_render_update_rate(run, frame, engine, behavior, source, telemetry):
    """Count libmpv render submissions only where that media path is instrumented."""
    if (
        behavior in ("idle", "retained_static")
        or engine.removesuffix("-paused")
        not in ("gpu", "gpu-paced", "gpu-independent", "gpu-independent-drop")
        or not frame.get("available")
    ):
        return None
    progress = mapping(run.get("video_progress"))
    if progress.get("status") == "not_applicable":
        return None
    media_present = (
        (number(frame.get("media_updates")) or 0) > 0
        or progress.get("method") == "native media render updates"
        or Path(str(source)).suffix.lower()
        in (".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi", ".mpg", ".mpeg")
        or any("hwdec" in stats for stats in telemetry)
    )
    rate = number(frame.get("media_update_hz"))
    return rate if media_present and rate is not None and rate >= 0 else None


def missed_target_slots(frame, output, target, monitors, duration):
    result = {
        "estimated_count": None,
        "per_minute": None,
        "refresh_hz": None,
        "reason": "Presentation sequences or physical output evidence unavailable",
    }
    monitor = next(
        (row for row in sequence(monitors) if isinstance(row, dict) and row.get("name") == output),
        {},
    )
    description = " ".join(
        str(monitor.get(key, "")) for key in ("name", "make", "model", "description")
    ).lower()
    if "headless" in description or "virtual" in description or str(output).startswith("WDB-"):
        return result | {
            "reason": "Virtual output; sequence increments do not represent physical target slots"
        }
    if not monitor or not re.match(r"^(?:DP|HDMI-A|HDMI|eDP|DVI-D|DVI-I|VGA)-\d+$", str(output)):
        return result
    refresh = number(monitor.get("refreshRate", monitor.get("refresh_rate")))
    result["refresh_hz"] = refresh
    if target is None or refresh is None or refresh <= 0 or abs(target - refresh) / refresh > 0.01:
        return result | {
            "reason": "Target differs from physical refresh; normal sequence gaps need not be missed target frames"
        }
    if not mapping(frame).get("available") or duration <= 0:
        return result
    increments = []
    for gap, count in mapping(mapping(frame).get("sequence_gaps")).items():
        try:
            gap = int(gap)
        except (TypeError, ValueError):
            return result | {"reason": "Malformed sequence distribution"}
        if number(count) is None or count < 0 or int(count) != count:
            return result | {"reason": "Malformed sequence distribution"}
        if count:
            if gap <= 0:
                return result | {
                    "reason": "Zero/reset sequence increments; physical missed-target estimate unavailable"
                }
            increments.append((gap, count))
    if not increments:
        return result
    missed = sum((gap - 1) * count for gap, count in increments)
    return result | {
        "estimated_count": missed,
        "per_minute": missed * 60 / duration,
        "reason": "Positive physical-output sequences; target matches recorded refresh within 1%",
    }


def compact_run(study, batch, run, manifest, provenance_id, index):
    args = mapping(manifest.get("arguments"))
    name = str(run.get("name", f"unnamed-{index}"))
    match = re.match(r"^(\d+)-(.+)$", name)
    engine = str(run.get("engine") or (match.group(2) if match else name))
    duration = duration_of(run)
    raw_errors = run.get("errors", [])
    errors = [
        str(error) for error in (raw_errors if isinstance(raw_errors, list) else [raw_errors])
    ]
    if duration <= 0 and "No measured duration" not in errors:
        errors.append("No measured duration")
    initial = mapping(run.get("initial_telemetry", run.get("initial_stats")))
    measurement_initial = mapping(run.get("measurement_initial_telemetry"))
    final = mapping(run.get("final_telemetry", run.get("final_stats")))
    resources = {key: dict(mapping(value)) for key, value in mapping(run.get("resources")).items()}
    gpu_rows = measured_resource_rows(run)
    for field in RESOURCE_FIELDS:
        values = [number(row.get(field)) for row in gpu_rows if number(row.get(field)) is not None]
        stats = resources.setdefault(field, {})
        stats["min"] = min(values) if values else None
        if values and not stats.get("samples"):
            stats.update(samples=len(values), mean=statistics.mean(values), max=max(values))
        stats["minimum_method"] = "measured-window resource samples" if values else "unavailable"
    cpu_evidence = cpu_evidence_for(run)
    cpu = gated_cpu_metrics(run.get("cpu"), cpu_evidence)
    cpu_roles = {
        role: gated_cpu_metrics(values, cpu_evidence)
        for role, values in mapping(run.get("cpu_by_role")).items()
    }
    cpu_mean, mean_method = weighted_cpu_mean(run)
    build = {
        key: manifest.get(key)
        for key in (
            "binary_sha256",
            "producer_sha256",
            "daemon_sha256",
            "profiler_sha256",
            "runtime_sha256",
        )
    }
    build_id = (
        hashlib.sha256(json.dumps(build, sort_keys=True).encode()).hexdigest()[:12]
        if any(build.values())
        else "unrecorded"
    )
    requested = number(run.get("requested_wallpaper_fps", args.get("wallpaper_fps")))
    effective = number(
        run.get("effective_wallpaper_fps_limit", initial.get("target_fps", requested))
    )
    pointer = mapping(run.get("pointer"))
    wall, contender = frame_stats(run.get("wallpaper")), frame_stats(run.get("contender"))
    behavior = run.get("content_behavior")
    if behavior is None:
        behavior = (
            "idle"
            if engine == "idle"
            else (
                "retained_static"
                if Path(str(args.get("source", ""))).suffix.lower()
                in (".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg", ".bmp")
                else ("paused" if engine.endswith("-paused") else "animated")
            )
        )
    plots = resource_bins(run, gpu_rows)
    if cpu_evidence["tails_valid"] is not True:
        for row in plots["rows"]:
            for field in CPU_FIELDS:
                row[plots["columns"].index(field)] = None
    has_measurements = (
        cpu_mean is not None
        or bool(gpu_rows)
        or any((frame.get("presented_frames") or 0) > 0 for frame in (wall, contender))
        or (
            behavior in ("retained_static", "paused")
            and wall["available"]
            and wall["presented_frames"] == 0
        )
        or any((number(stats.get("samples")) or 0) > 0 for stats in resources.values())
    )
    if duration > 0 and not has_measurements:
        errors.append("No measured CPU, presentation or resource samples")
    cpu_metrics = {
        "weighted_mean": cpu_mean is not None,
        "sample_tails": cpu_evidence["tails_valid"]
        and any(number(cpu.get(key)) is not None for key in ("p99", "p999", "max")),
    }
    evidence_warnings = []
    if not cpu_metrics["weighted_mean"]:
        evidence_warnings.append(f"CPU mean unavailable; evidence {cpu_evidence['status']}")
    if not cpu_metrics["sample_tails"]:
        evidence_warnings.append("CPU sampled peaks and tails unavailable")
    evidence_warnings.extend(
        "CPU evidence: " + str(error) for error in sequence(cpu_evidence.get("errors"))
    )
    pause = mapping(run.get("pause_evidence"))
    pause_status = pause.get("status", "unavailable")
    if behavior == "paused" and pause_status != "verified":
        evidence_warnings.append(f"Pause requested; pause evidence {pause_status}")
    if behavior == "paused":
        evidence_warnings.extend(
            "Pause evidence: " + str(error) for error in sequence(pause.get("errors"))
        )
    wall["missed_target_slots"] = missed_target_slots(
        wall, args.get("wallpaper_output"), effective, manifest.get("monitors"), duration
    )
    contender["missed_target_slots"] = missed_target_slots(
        contender,
        args.get("contender_output"),
        number(args.get("contender_fps")),
        manifest.get("monitors"),
        duration,
    )
    return {
        "id": f"{study}/{batch}/{index}:{name}",
        "study": study,
        "batch": batch,
        "name": name,
        "engine": engine,
        "repeat": int(match.group(1)) if match else None,
        "build_id": build_id,
        "build": build,
        "source": args.get("source"),
        "wallpaper_output": args.get("wallpaper_output"),
        "contender_output": args.get("contender_output"),
        "contender_configuration": run.get("contender_configuration"),
        "initial_contender_telemetry": run.get("initial_contender_telemetry"),
        "contender_black": args.get("contender_black", False),
        "contention": not args.get("no_contender", False),
        "audio": args.get("audio", False),
        "passes": args.get("passes"),
        "sample_hz": args.get("sample_hz"),
        "provenance_id": provenance_id,
        "valid": run.get("valid") is True and not errors and duration > 0,
        "source_valid": run.get("valid"),
        "completed": run.get("completed"),
        "phase": run.get("phase"),
        "interrupted": run.get("interrupted", False),
        "errors": errors,
        "measured_seconds": duration,
        "requested_fps": requested,
        "effective_fps_limit": effective,
        "wallpaper_period_ms": 1000 / effective if effective and effective > 0 else None,
        "contender_period_ms": number(manifest.get("contender_period_ms")),
        "wallpaper": wall,
        "media_drop_policy": {
            "requested": final.get("media_framedrop_requested"),
            "applied": final.get("media_framedrop"),
            "verified_at_init": final.get("media_framedrop_verified_at_init"),
            "decoder_drop_enabled": final.get("media_decoder_drop_enabled"),
            "scope": final.get("media_framedrop_scope"),
        },
        "media_render_update_hz": media_render_update_rate(
            run, wall, engine, behavior, args.get("source"), (initial, measurement_initial, final)
        ),
        "contender": contender,
        "video_progress": run.get("video_progress"),
        "pause_evidence": run.get("pause_evidence"),
        "content_behavior": behavior,
        "cpu": cpu,
        "cpu_by_role": cpu_roles,
        "cpu_evidence": cpu_evidence,
        "recorded_cpu_evidence": run.get("recorded_cpu_evidence"),
        "cpu_metrics_available": cpu_metrics,
        "evidence_warnings": list(dict.fromkeys(evidence_warnings)),
        "weighted_cpu_mean_percent_one_core": cpu_mean,
        "cpu_mean_method": mean_method,
        "gpu": run.get("gpu"),
        "resources": resources,
        "minimum_free_vram_mib": resources["vram_free_mib"]["min"],
        "minimum_available_ram_mib": resources["ram_available_mib"]["min"],
        "guard_failure": run.get("guard_failure"),
        "guard_observations": run.get("guard_observations"),
        "background_activity_flag": run.get("background_activity_flag", False),
        "background_cpu": run.get("background_cpu"),
        "background_cpu_total_percent_one_core": run.get("background_cpu_total_percent_one_core"),
        "pointer": pointer,
        "pointer_changed": any(mapping(value).get("changed") for value in pointer.values()),
        "valid_process_membership": run.get("valid_process_membership"),
        "unexpected_process_count": len(sequence(run.get("unexpected_processes"))),
        "sampling_lateness_ms": run.get("sampling_lateness_ms"),
        "initial_telemetry": initial,
        "measurement_initial_telemetry": measurement_initial,
        "final_telemetry": final,
        "browser_callbacks": {
            "initial": callback_snapshot(initial),
            "measurement_initial": callback_snapshot(measurement_initial),
            "final": callback_snapshot(final),
            "measurement_window_fps": None,
        },
        "plots": {
            "bin_ms": 100,
            "wallpaper": interval_bins(run.get("wallpaper_timeline"), duration),
            "contender": interval_bins(run.get("timeline"), duration),
            "resources": plots,
        },
    }


def range_of(values):
    values = [value for value in values if number(value) is not None]
    return {
        "runs": len(values),
        "median": statistics.median(values) if values else None,
        "min": min(values) if values else None,
        "max": max(values) if values else None,
    }


def at(value, *keys):
    for key in keys:
        value = mapping(value).get(key)
    return value


def aggregate(runs):
    grouped = defaultdict(list)
    for run in runs:
        grouped[run["study"], run["batch"], run["build_id"], run["engine"]].append(run)
    result = []
    for (study, batch, build_id, engine), members in sorted(grouped.items()):
        valid = [run for run in members if run["valid"]]
        metric = lambda *keys: range_of(at(run, *keys) for run in valid)
        result.append(
            {
                "study": study,
                "batch": batch,
                "engine": engine,
                "build_id": build_id,
                "build": members[0]["build"],
                "valid_runs": len(valid),
                "invalid_runs": len(members) - len(valid),
                "run_ids": [run["id"] for run in members],
                "requested_fps": sorted(
                    {run["requested_fps"] for run in members if run["requested_fps"] is not None}
                ),
                "effective_fps_limits": sorted(
                    {
                        run["effective_fps_limit"]
                        for run in members
                        if run["effective_fps_limit"] is not None
                    }
                ),
                "cpu_mean_percent_one_core": metric("weighted_cpu_mean_percent_one_core"),
                "cpu_sample_tail_runs": sum(
                    bool(run["cpu_metrics_available"]["sample_tails"]) for run in valid
                ),
                "cpu_evidence_status_counts": {
                    status: sum(run["cpu_evidence"]["status"] == status for run in valid)
                    for status in sorted({run["cpu_evidence"]["status"] for run in valid})
                },
                "content_behaviors": sorted({run["content_behavior"] for run in members}),
                "pause_unverified_valid_runs": sum(
                    run["content_behavior"] == "paused"
                    and mapping(run.get("pause_evidence")).get("status") != "verified"
                    for run in valid
                ),
                "wallpaper_presented_hz": metric("wallpaper", "presented_hz"),
                "wallpaper_per_run_p99_ms": metric("wallpaper", "presentation_ms", "p99"),
                "wallpaper_per_run_p999_ms": metric("wallpaper", "presentation_ms", "p999"),
                "wallpaper_per_run_worst_ms": metric("wallpaper", "presentation_ms", "max"),
                "wallpaper_missed_target_slots_per_minute": metric(
                    "wallpaper", "missed_target_slots", "per_minute"
                ),
                "contender_presented_hz": metric("contender", "presented_hz"),
                "contender_per_run_p99_ms": metric("contender", "presentation_ms", "p99"),
                "contender_per_run_p999_ms": metric("contender", "presentation_ms", "p999"),
                "contender_per_run_worst_ms": metric("contender", "presentation_ms", "max"),
                "contender_missed_target_slots_per_minute": metric(
                    "contender", "missed_target_slots", "per_minute"
                ),
                "gpu_mean_percent": metric("gpu", "mean"),
                "minimum_free_vram_mib": metric("minimum_free_vram_mib")["min"],
                "minimum_available_ram_mib": metric("minimum_available_ram_mib")["min"],
                "peak_gpu_temperature_c": metric("resources", "temperature_c", "max")["max"],
                "peak_cpu_temperature_c": metric("resources", "cpu_temperature_c", "max")["max"],
                "peak_power_watts": metric("resources", "watts", "max")["max"],
                "background_flagged_valid_runs": sum(
                    bool(run["background_activity_flag"]) for run in valid
                ),
                "pointer_changed_valid_runs": sum(bool(run["pointer_changed"]) for run in valid),
            }
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", action="append", required=True, metavar="NAME=DIRECTORY")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--title", default="WallpaperDB · Renderer measurements")
    parser.add_argument(
        "--cpu-audit",
        action="append",
        type=Path,
        default=[],
        help="Optional retrospective CPU audit, matched by raw report SHA-256 and run name",
    )
    args = parser.parse_args()
    audits, audit_sources, audit_errors, matched_audits = {}, [], [], set()
    for path in args.cpu_audit:
        try:
            document, digest = read_json(path)
            audit_sources.append({"file": path.name, "sha256": digest})
            if not isinstance(document, dict) or not isinstance(document.get("reports"), list):
                raise ValueError("CPU audit must contain a reports array")
        except (OSError, ValueError) as error:
            audit_errors.append({"file": path.name, "error": str(error)})
            continue
        for report in document["reports"]:
            report = mapping(report)
            sha = report.get("sha256")
            if (
                report.get("error")
                or not isinstance(sha, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", sha)
                or not isinstance(report.get("runs"), list)
            ):
                audit_errors.append(
                    {
                        "file": path.name,
                        "report": report.get("report"),
                        "error": report.get("error")
                        or "CPU audit report lacks a valid hash or runs array",
                    }
                )
                continue
            for run in report["runs"]:
                if (
                    not isinstance(run, dict)
                    or not isinstance(run.get("name"), str)
                    or not run["name"]
                ):
                    audit_errors.append(
                        {"file": path.name, "error": "CPU audit run has no valid name"}
                    )
                    continue
                key = (sha.lower(), run["name"])
                if key in audits and audits[key] != run:
                    parser.error("Conflicting CPU audits for the same report hash and run")
                audits[key] = run
    studies = []
    for entry in args.study:
        if "=" not in entry:
            parser.error("Each --study must be NAME=DIRECTORY")
        name, directory = entry.split("=", 1)
        if not name.strip() or not directory.strip() or any(name == old[0] for old in studies):
            parser.error("Study names must be nonempty and unique; directories must be nonempty")
        studies.append((name, Path(directory).expanduser().resolve()))
    output = args.output_dir.expanduser().resolve()
    prefixes = [(str(directory), "study/" + name) for name, directory in studies]
    prefixes.extend([(str(ROOT), "apps/native-prototype"), (str(ROOT.parent.parent), "repository")])
    prefixes.sort(key=lambda pair: len(pair[0]), reverse=True)
    data = {
        "schema_version": 1,
        "title": args.title,
        "schema_note": "Run records in summary.json omit the plots field. The standalone index.html embeds that field with 100 ms binned traces; all other statistics and provenance are shared.",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "method": METHOD,
        "studies": [],
        "provenance": [],
        "runs": [],
        "report_errors": [],
        "cpu_audit_sources": audit_sources,
        "cpu_audit_errors": audit_errors,
    }
    for name, directory in studies:
        study = {"name": name, "origin": relative_url(directory, output), "manifest": None}
        summary = directory / "summary.json"
        if summary.is_file():
            try:
                document, _ = read_json(summary)
                study["manifest"] = mapping(document).get("manifest")
            except (OSError, ValueError) as error:
                data["report_errors"].append(
                    {"study": name, "path": relative_url(summary, output), "error": str(error)}
                )
        data["studies"].append(study)
        reports = (
            [directory / "report.json"]
            if (directory / "report.json").is_file()
            else sorted(directory.glob("*/report.json"))
        )
        if not reports:
            reports = [
                directory / "report.json"
            ]  # Retain an explicit invalid row for an empty study.
        for path in reports:
            batch = path.parent.name if path.parent != directory else "profile"
            provenance_id = f"{name}/{batch}"
            record = {
                "id": provenance_id,
                "study": name,
                "batch": batch,
                "raw_json": relative_url(path, output) if path.is_file() else None,
                "raw_html": (
                    relative_url(path.with_suffix(".html"), output)
                    if path.with_suffix(".html").is_file()
                    else None
                ),
                "sha256": None,
                "manifest": {},
            }
            try:
                document, record["sha256"] = read_json(path)
                if not isinstance(document, dict) or not isinstance(document.get("runs"), list):
                    raise ValueError("Report must contain an object with a runs array")
                record["manifest"] = mapping(document.get("manifest"))
                source_runs = document["runs"]
                if not source_runs:
                    source_runs = [
                        {
                            "name": "no-measurements",
                            "engine": "unknown",
                            "valid": False,
                            "errors": ["Report contains no runs"],
                            "measured_seconds": 0,
                        }
                    ]
            except (OSError, ValueError) as error:
                issue = {
                    "study": name,
                    "batch": batch,
                    "path": relative_url(path, output),
                    "error": str(error),
                }
                data["report_errors"].append(issue)
                source_runs = [
                    {
                        "name": "unreadable-report",
                        "engine": "unknown",
                        "valid": False,
                        "errors": [str(error)],
                        "measured_seconds": 0,
                    }
                ]
            data["provenance"].append(record)
            for index, run in enumerate(source_runs, 1):
                if not isinstance(run, dict):
                    run = {
                        "name": f"malformed-run-{index}",
                        "engine": "unknown",
                        "valid": False,
                        "errors": ["Run is not an object"],
                        "measured_seconds": 0,
                    }
                audit_key = (
                    record["sha256"],
                    run.get("name") if isinstance(run.get("name"), str) else None,
                )
                audit = audits.get(audit_key)
                if audit is not None:
                    matched_audits.add(audit_key)
                    run = apply_cpu_audit(run, audit | {"matched_report_sha256": record["sha256"]})
                data["runs"].append(
                    compact_run(name, batch, run, record["manifest"], provenance_id, index)
                )
    data["cpu_audit_matched_runs"] = len(matched_audits)
    data["cpu_audit_unmatched_runs"] = len(audits) - len(matched_audits)
    data["groups"] = aggregate(data["runs"])
    data = portable(data, prefixes)
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False)
    embedded = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    summary_data = data | {
        "runs": [
            {key: value for key, value in run.items() if key != "plots"} for run in data["runs"]
        ]
    }
    output.mkdir(parents=True, exist_ok=True)
    for filename, contents in [
        (
            "summary.json",
            json.dumps(summary_data, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        ),
        ("index.html", HTML.replace("__PAYLOAD__", embedded)),
    ]:
        temporary = output / (filename + ".tmp")
        temporary.write_text(contents, encoding="utf-8")
        temporary.replace(output / filename)
    valid = sum(run["valid"] for run in data["runs"])
    print(
        f"Published {len(data['runs'])} runs ({valid} valid) and {len(data['groups'])} groups: {output / 'index.html'}"
    )


HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WallpaperDB · Renderer measurements</title>
<style>
:root{color-scheme:dark;--bg:#151117;--panel:#211922;--line:#493346;--text:#f2e9f1;--muted:#bcaabd;--pink:#f0a1cd;--blue:#96b9ee;--green:#a6d3b5;--warn:#ffc49e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif}main{max-width:1580px;margin:auto;padding:42px 28px 72px}.eyebrow{color:var(--pink);font-size:12px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:clamp(29px,4vw,48px);line-height:1.12;letter-spacing:-.035em;margin:12px 0 18px}h2{font-size:22px;font-weight:620;margin:32px 0 10px}h3{font-size:16px;margin:0}p{color:var(--muted);max-width:1100px;margin:9px 0 16px}a{color:var(--pink)}button,select,input{font:inherit;color:var(--text);background:#302330;border:1px solid #70506b;border-radius:7px;padding:8px 11px}button{cursor:pointer}button:hover{border-color:var(--pink)}button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--pink);outline-offset:3px}label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:12px}.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:end;margin:24px 0}.controls select{min-width:155px;max-width:440px}.controls input[type=number]{width:115px}.controls input[type=range]{width:250px;padding:8px 0}.note{font-size:13px;color:var(--muted)}.banner{padding:16px 20px;border:1px solid var(--line);border-left:3px solid var(--pink);border-radius:8px;margin:20px 0;background:var(--panel)}.scroll{overflow:auto;border:1px solid var(--line);border-radius:9px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:right;font-size:12px}th{font-weight:500;color:var(--muted);background:#271d29;white-space:normal;min-width:96px;vertical-align:bottom}td:first-child,th:first-child{text-align:left;min-width:245px}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#2c202e}td small{display:block;color:var(--muted);font-size:11px}.row-button{padding:0;background:none;border:none;color:var(--pink);text-align:left;font-size:13px}.invalid{color:var(--warn)}.badge{font-size:11px;border:1px solid #674262;border-radius:4px;padding:1px 5px;margin-left:5px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:18px;min-width:0}.card p{font-size:12px;margin:5px 0 10px}.card svg{width:100%;height:auto;display:block;overflow:visible}.legend{font-size:12px;display:flex;gap:15px;flex-wrap:wrap;color:var(--muted)}.swatch:before{content:' ';display:inline-block;width:10px;height:3px;vertical-align:middle;margin-right:5px;background:var(--c)}details{margin:16px 0;border:1px solid var(--line);padding:13px 17px;border-radius:8px}summary{cursor:pointer;color:var(--pink)}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);font-size:12px;max-height:550px;overflow:auto}.inline{display:inline-block}.muted{color:var(--muted)}#selected-context{max-width:none}#run-select{max-width:600px}#selection-errors{color:var(--warn)}footer{margin-top:35px;color:var(--muted);font-size:12px}@media(max-width:850px){main{padding:25px 15px}.grid{grid-template-columns:1fr}.controls{gap:10px}.controls select{min-width:120px;max-width:95vw}h2{margin-top:25px}}
</style></head><body><main>
<div class="eyebrow">WallpaperDB / measured rendering</div><h1 id="title">Renderer measurements</h1>
<p>Compare the cost of each renderer together with its delivered frame rate and the competing workload's hitches. Every run remains inspectable, including failures. No renderer is declared a winner by this report.</p>
<div class="banner">CPU is <strong>percent of one core</strong>. Unsupported CPU means and sampled peaks stay <strong>unknown</strong>; their absence does not erase other measurements. GPU activity and power cover the <strong>whole sampled device</strong>. Missing presentation data stays unavailable; browser callbacks are shown separately. Virtual-output feedback does not establish physical scanout.</div>
<div class="controls"><label>Study<select id="study"></select></label><label>Engine / case<select id="engine"></select></label><label>Batch<select id="batch"></select></label><a href="summary.json">Portable summary JSON</a></div>
<p id="count" class="note"></p>
<h2>Repeated-run comparison</h2><p class="note">Valid runs only. CPU shows the median of supported per-run time-weighted means, their range, and contributing mean/tail run counts. A capture with unsupported CPU can still contribute presentation or resource measurements. Other columns show ranges of per-run measurements. A range or median of per-run p99/p99.9 values is not a global percentile.</p>
<div class="scroll"><table><thead><tr><th>Study / batch / engine</th><th>Valid / invalid runs</th><th>Requested → effective fps</th><th>CPU mean median %<br>[range]</th><th>Wallpaper delivered fps</th><th>Wallpaper p99 ms</th><th>Contender delivered fps</th><th>Contender p99 ms</th><th>Contender p99.9 ms</th><th>Contender worst ms</th><th>Missed target slots/min*</th></tr></thead><tbody id="groups"></tbody></table></div>
<p class="note">*Only estimated where positive physical-output sequences and a target matching recorded refresh make this meaningful. Virtual/zero sequences and other refresh ratios remain unavailable. Background activity and pointer changes are retained as flags.</p>
<h2>Inspect a run</h2>
<div class="controls"><label>Run<select id="run-select"></select></label><label>Start (seconds)<input id="from" type="number" value="0" min="0" step="0.1"></label><label>Window (seconds)<input id="window" type="number" value="15" min="0.1" step="1"></label><label>Pan through run<input id="pan" type="range" value="0" min="0" max="1" step="0.1"></label></div>
<p id="selected-context"></p><p id="behavior-detail" class="note"></p><p id="selection-errors"></p><p id="raw-links" class="note"></p>
<div class="grid">
<section class="card"><h3>Wallpaper presentation intervals</h3><p>MAXIMUM observed interval per 100 ms bin. Dashed line: twice the effective producer budget.</p><svg id="wall-plot" viewBox="0 0 680 275" role="img" aria-label="Wallpaper presentation interval maxima"></svg><p id="wall-detail"></p></section>
<section class="card"><h3>Contender presentation intervals</h3><p>MAXIMUM observed interval per 100 ms bin. Dashed line: twice the contender target budget.</p><svg id="cont-plot" viewBox="0 0 680 275" role="img" aria-label="Contender presentation interval maxima"></svg><p id="cont-detail"></p></section>
<section class="card"><h3>Sampled CPU peaks</h3><p>Maximum sampled percent of one core per 100 ms bin, shown only with supported tail coverage. These peaks are separate from the weighted CPU mean.</p><svg id="cpu-plot" viewBox="0 0 680 275" role="img" aria-label="CPU sample maxima"></svg><p id="cpu-detail"></p><div class="legend"><span class="swatch" style="--c:#f0a1cd">Wallpaper</span><span class="swatch" style="--c:#e3bd7c">Contender</span><span class="swatch" style="--c:#96b9ee">Compositor</span><span class="swatch" style="--c:#a69cab">Profiler</span></div></section>
<section class="card"><h3>Device and system samples</h3><label class="inline">Metric <select id="resource"></select></label><p id="resource-note"></p><svg id="resource-plot" viewBox="0 0 680 275" role="img" aria-label="Selected device or system resource samples"></svg><p id="resource-detail"></p></section>
</div>
<p class="note">Bins preserve observed peaks but remove event order and exact timing within each 100 ms interval. Empty bins are not interpolated. Single sparse samples appear as dots. Use the raw report to inspect full-resolution traces.</p>
<details><summary>Selected run: statistics, input flags, resource extremes and provenance</summary><pre id="run-record"></pre></details>
<h2>All individual runs</h2><p class="note">Invalid runs remain here and are excluded from repeated-run aggregates. Media render updates count libmpv render submissions, not decoded FPS; presentations can reuse the same media texture. Static images, scenes without media and uninstrumented media paths show no media update rate. A retained static image can remain visible with zero new presentations after warmup; absent feedback remains unavailable. Pause requests have separate evidence. “Browser fps” is a final callback-rate snapshot, not delivered presentation rate or mpv container FPS.</p>
<div class="scroll"><table><thead><tr><th>Run / validation</th><th>Seconds</th><th>Weighted CPU mean %</th><th>Wallpaper delivered fps</th><th>Media render updates/s<br>(not decoded FPS)</th><th>Browser fps snapshot</th><th>Wallpaper p99.9 / worst ms</th><th>Contender p99 / p99.9 / worst ms</th><th>Free VRAM min MiB</th><th>RAM available min MiB</th></tr></thead><tbody id="runs"></tbody></table></div>
<details><summary>Method, study evidence and report-read errors</summary><pre id="method"></pre></details>
<footer id="footer"></footer>
<script id="payload" type="application/json">__PAYLOAD__</script>
<script>
"use strict";
const data = JSON.parse(document.getElementById("payload").textContent);
const $ = id => document.getElementById(id);
const finite = x => typeof x === "number" && Number.isFinite(x);
const fmt = (x, digits = 2) => finite(x) ? x.toFixed(digits) : "—";
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const engineName = e => {const paused=e.endsWith("-paused"), base=paused?e.slice(0,-7):e;return ({idle:"No wallpaper",baseline:"Baseline / GTK · WebKit · mpvpaper",gpu:"Native / fixed rate","gpu-paced":"Native / compositor paced","gpu-independent":"Native / independent media clock","gpu-independent-drop":"Native / independent video with frame dropping",chromium:"Chromium / bitmap","chromium-dmabuf":"Chromium / shared texture"}[base] || base)+(paused?" · pause requested":"");};
const range = x => !x || !x.runs ? "—" : x.min === x.max ? fmt(x.min) : `${fmt(x.min)}–${fmt(x.max)}`;
const limits = g => {const a=g.requested_fps.join(", ")||"—", b=g.effective_fps_limits.join(", ")||"—";return a===b?a:`${a} → ${b}`;};
const provenance = new Map(data.provenance.map(p => [p.id, p]));
const byId = new Map(data.runs.map(r => [r.id, r]));
const resources = {
  gpu_percent:["GPU activity", "% of sampled GPU"], memory_percent:["GPU memory activity", "% activity"],
  watts:["GPU device power", "watts"], graphics_mhz:["GPU graphics clock", "MHz"],
  temperature_c:["GPU temperature", "°C"], cpu_temperature_c:["CPU temperature", "°C"],
  decoder_percent:["Video decoder activity", "% of sampled GPU decoder"],
  vram_free_mib:["Free GPU memory", "MiB"], vram_used_mib:["Allocated GPU memory", "MiB"],
  ram_available_mib:["System MemAvailable", "MiB"], rss_mib:["Wallpaper family RSS", "MiB"],
  cpu_scaling_mhz_mean:["Mean OS CPU scaling frequency", "MHz"],
  cpu_scaling_mhz_min:["Minimum OS CPU scaling frequency", "MHz"],
  cpu_scaling_mhz_max:["Maximum OS CPU scaling frequency", "MHz"]
};
function options(id, values, label) {
  $(id).innerHTML = `<option value="">${esc(label)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(id==="engine"?engineName(v):v)}</option>`).join("");
}
options("study", data.studies.map(s=>s.name), "All studies");
options("engine", [...new Set(data.runs.map(r=>r.engine))].sort(), "All engines");
options("batch", [...new Set(data.runs.map(r=>r.batch))].sort(), "All batches");
$("resource").innerHTML = Object.entries(resources).map(([key, value])=>`<option value="${key}">${esc(value[0])}</option>`).join("");
$("title").textContent = data.title; document.title = data.title;
$("method").textContent = JSON.stringify({method:data.method, studies:data.studies, report_errors:data.report_errors, cpu_audit_sources:data.cpu_audit_sources, cpu_audit_errors:data.cpu_audit_errors, cpu_audit_matched_runs:data.cpu_audit_matched_runs, cpu_audit_unmatched_runs:data.cpu_audit_unmatched_runs}, null, 2);
$("footer").textContent = `Generated ${data.generated_utc}. All charts and data needed for this page are embedded; raw report links require the original study folders.`;
function matches(row) {return ["study","engine","batch"].every(key=>!$(key).value || row[key]===$(key).value);}
function badges(r) {const labels=[r.background_activity_flag?"background activity":"",r.pointer_changed?"pointer changed":"",!r.cpu_metrics_available.weighted_mean?"CPU mean unknown":"",!r.cpu_metrics_available.sample_tails?"CPU tails unknown":"",r.content_behavior==="retained_static"?"retained image":"",r.content_behavior==="paused"?"pause evidence "+(r.pause_evidence?.status||"unavailable"):""];return labels.filter(Boolean).map(label=>`<span class="badge">${esc(label)}</span>`).join("");}
function behaviorDetail(r) {
  if(r.content_behavior==="retained_static")return "Retained static image: it can remain visible with zero new presentations after warmup. Recorded zero means no new frames; missing feedback remains unavailable.";
  if(r.content_behavior==="paused")return `Pause requested · evidence ${r.pause_evidence?.status||'unavailable'}. ${r.pause_evidence?.scope||'No pause verification scope was recorded. Zero new frames alone does not prove that playback or all content stopped.'}`;
  if(r.content_behavior==="idle")return "Idle control: no wallpaper workload was assigned; background processes may still be active.";
  return "Animated content: delivered presentations, browser callbacks and media advancement describe different stages.";
}
function choose(id) {$("run-select").value=id;$("from").value=0;$("pan").value=0;drawSelected();}
function drawTables() {
  const rows=data.runs.filter(matches), groups=data.groups.filter(matches), old=$("run-select").value;
  const valid=rows.filter(r=>r.valid), seconds=valid.reduce((sum,r)=>sum+r.measured_seconds,0);
  const means=valid.filter(r=>r.cpu_metrics_available.weighted_mean).length, tails=valid.filter(r=>r.cpu_metrics_available.sample_tails).length;
  $("count").textContent=`${rows.length} runs shown · ${valid.length} valid · ${rows.length-valid.length} invalid · ${(seconds/60).toFixed(1)} measured minutes in valid runs · CPU means ${means}/${valid.length}, tails ${tails}/${valid.length} supported`;
  $("groups").innerHTML=groups.map(g=>{
    const selected=g.run_ids.find(id=>byId.get(id)?.valid)||g.run_ids[0];
    const cpu=g.cpu_mean_percent_one_core;
    const flags=[`build ${g.build_id}`,g.background_flagged_valid_runs?`${g.background_flagged_valid_runs} background flagged`:"",g.pointer_changed_valid_runs?`${g.pointer_changed_valid_runs} pointer changed`:"",g.pause_unverified_valid_runs?`${g.pause_unverified_valid_runs} pause evidence unverified`:""].filter(Boolean).join("; ");
    return `<tr><td><button class="row-button" data-run="${esc(selected)}">${esc(g.study)} / ${esc(g.batch)}<br>${esc(engineName(g.engine))}</button><small>${esc(flags)}</small></td><td>${g.valid_runs} / <span class="${g.invalid_runs?'invalid':''}">${g.invalid_runs}</span></td><td>${esc(limits(g))}</td><td>${cpu.runs?fmt(cpu.median):'unknown'}<small>[${range(cpu)}]</small><small>means ${cpu.runs}/${g.valid_runs} · tails ${g.cpu_sample_tail_runs}/${g.valid_runs}</small></td><td>${range(g.wallpaper_presented_hz)}</td><td>${range(g.wallpaper_per_run_p99_ms)}</td><td>${range(g.contender_presented_hz)}</td><td>${range(g.contender_per_run_p99_ms)}</td><td>${range(g.contender_per_run_p999_ms)}</td><td>${range(g.contender_per_run_worst_ms)}</td><td>${range(g.contender_missed_target_slots_per_minute)}</td></tr>`;
  }).join("") || '<tr><td colspan="11">No groups match these filters.</td></tr>';
  $("runs").innerHTML=rows.map(r=>{
    const w=r.wallpaper.presentation_ms||{}, c=r.contender.presentation_ms||{};
    return `<tr class="${r.valid?'':'invalid'}"><td><button class="row-button" data-run="${esc(r.id)}">${esc(r.study)} / ${esc(r.batch)} / ${esc(r.name)}</button><small>${r.valid?'VALID':'INVALID: '+esc(r.errors.join('; '))}</small>${badges(r)}</td><td>${fmt(r.measured_seconds)}</td><td>${r.cpu_metrics_available.weighted_mean?fmt(r.weighted_cpu_mean_percent_one_core):'unknown'}<small>${esc(r.cpu_evidence.status)}${r.cpu_evidence.retrospective?' · retrospective':''}</small></td><td>${fmt(r.wallpaper.presented_hz)}</td><td>${fmt(r.media_render_update_hz)}</td><td>${fmt(r.browser_callbacks.final.reported_fps)}</td><td>${fmt(w.p999)} / ${fmt(w.max)}</td><td>${fmt(c.p99)} / ${fmt(c.p999)} / ${fmt(c.max)}</td><td>${fmt(r.minimum_free_vram_mib,0)}</td><td>${fmt(r.minimum_available_ram_mib,0)}</td></tr>`;
  }).join("") || '<tr><td colspan="10">No runs match these filters.</td></tr>';
  $("run-select").innerHTML=rows.map(r=>`<option value="${esc(r.id)}">${esc(r.study)} / ${esc(r.batch)} / ${esc(r.name)}${r.valid?'':' · INVALID'}</option>`).join("");
  if(rows.some(r=>r.id===old)) $("run-select").value=old;
  else {$("from").value=0;$("pan").value=0;}
  drawSelected();
}
function resourcePoints(r, field) {
  const source=r.plots.resources, index=source.columns.indexOf(field);
  return index<0?[]:source.rows.filter(row=>finite(row[index])).map(row=>[row[0],row[index]]);
}
function plot(id, series, start, end, unit, threshold=null, empty="No recorded samples in this window.") {
  const selected=series.map(s=>({...s,points:s.points.filter(p=>finite(p[0])&&finite(p[1])&&p[0]>=start&&p[0]<=end)}));
  if(!selected.some(s=>s.points.length)) {$(id).innerHTML=`<text x="340" y="133" text-anchor="middle" fill="#bcaabd" font-size="13">${esc(empty)}</text>`;return;}
  const maximum=selected.reduce((max,s)=>s.points.reduce((m,p)=>Math.max(m,p[1]),max),Math.max(1,threshold||0))*1.08;
  const left=61,right=662,top=18,bottom=232,x=t=>left+(t-start)/Math.max(.001,end-start)*(right-left),y=v=>bottom-v/maximum*(bottom-top);
  let content="";
  for(let i=0;i<=4;i++){const value=maximum*i/4, position=y(value);content+=`<path d="M${left} ${position}H${right}" stroke="#493346"/><text x="52" y="${position+4}" text-anchor="end" fill="#bcaabd" font-size="10">${fmt(value,maximum>100?0:1)}</text>`;}
  for(let i=0;i<=4;i++){const t=start+(end-start)*i/4;content+=`<text x="${x(t)}" y="252" text-anchor="middle" fill="#bcaabd" font-size="10">${fmt(t,1)}s</text>`;}
  content+=`<text x="${left}" y="11" fill="#bcaabd" font-size="10">${esc(unit)}</text>`;
  if(finite(threshold)) content+=`<path d="M${left} ${y(threshold)}H${right}" stroke="#b781a7" stroke-dasharray="6 5"/>`;
  for(const s of selected){let path="",previous=null;for(const p of s.points){path+=(previous!==null&&p[0]-previous<=.151?"L":"M")+`${x(p[0]).toFixed(2)} ${y(p[1]).toFixed(2)} `;previous=p[0];}content+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.6"/>`;
    content+=s.points.map(p=>`<circle cx="${x(p[0]).toFixed(2)}" cy="${y(p[1]).toFixed(2)}" r="1.6" fill="${s.color}"><title>${esc(s.name)}: bin ${fmt(p[0],1)}–${fmt(p[0]+.1,1)}s, ${fmt(p[1],3)} ${esc(unit)}</title></circle>`).join("");}
  $(id).innerHTML=content;
}
function frameDetail(frame, mediaRate=undefined) {
  const d=frame.presentation_ms, missed=frame.missed_target_slots;
  if(!frame.available) return "Presentation feedback unavailable. Browser callback rates cannot replace it.";
  const media=mediaRate===undefined?'':` · media render updates ${finite(mediaRate)?fmt(mediaRate)+'/s (not decoded FPS)':'unavailable'}`;
  return `Whole-run values: ${fmt(frame.presented_hz)} delivered fps${media} · p99 ${fmt(d?.p99)} ms · p99.9 ${fmt(d?.p999)} ms · worst ${fmt(d?.max)} ms · missed target slots/min ${fmt(missed?.per_minute)}.`;
}
function drawSelected() {
  const r=byId.get($("run-select").value);
  if(!r){$("selected-context").textContent="No selected run.";$("selection-errors").textContent="";$("raw-links").textContent="";$("run-record").textContent="";for(const id of ["wall-plot","cont-plot","cpu-plot","resource-plot"])$(id).innerHTML="";for(const id of ["wall-detail","cont-detail","cpu-detail","behavior-detail","resource-detail","resource-note"])$(id).textContent="";return;}
  const duration=Math.max(0,r.measured_seconds), requestedStart=Number($("from").value), requestedWindow=Number($("window").value);
  const start=Math.min(Math.max(0,Number.isFinite(requestedStart)?requestedStart:0),Math.max(0,duration-.1));
  const windowSize=Number.isFinite(requestedWindow)&&requestedWindow>0?requestedWindow:15;
  const end=Math.max(start+.1,Math.min(duration,start+windowSize));
  $("from").value=start;$("from").max=Math.max(0,duration-.1);$("pan").max=Math.max(0,duration-.1);$("pan").value=start;
  $("selected-context").textContent=`${r.study} / ${r.batch} / ${engineName(r.engine)} · source ${r.source??'unknown'} · wallpaper ${r.wallpaper_output??'unknown'} · ${r.contention?'contender '+(r.contender_output??'unknown'):'no contender'} · target ${fmt(r.requested_fps,0)} → limit ${fmt(r.effective_fps_limit,0)} fps · audio ${r.audio?'on':'off'}`;
  $("selected-context").textContent+=` · build ${r.build_id}${r.contention?' · contender '+(r.contender_black?'black output':'visible output'):''}`;
  $("behavior-detail").textContent=behaviorDetail(r);
  const warnings=[...r.errors,...r.evidence_warnings,r.background_activity_flag?"Background CPU activity flagged":"",r.pointer_changed?"Pointer changed during capture":"",r.guard_failure||""].filter(Boolean);
  $("selection-errors").textContent=(r.valid?"VALID":"INVALID")+(warnings.length?" · "+warnings.join("; "):"");
  const p=provenance.get(r.provenance_id), links=[];
  if(p?.raw_html)links.push(`<a href="${esc(p.raw_html)}">Original interactive report</a>`);
  if(p?.raw_json)links.push(`<a href="${esc(p.raw_json)}">Full original JSON / traces</a>`);
  $("raw-links").innerHTML=links.join(" · ")||"No original report file is available.";
  plot("wall-plot",[{points:r.plots.wallpaper.max_ms,color:"#f0a1cd",name:"Wallpaper maximum interval"}],start,end,"ms",finite(r.wallpaper_period_ms)?r.wallpaper_period_ms*2:null,"No wallpaper presentation intervals recorded.");
  plot("cont-plot",[{points:r.plots.contender.max_ms,color:"#e3bd7c",name:"Contender maximum interval"}],start,end,"ms",finite(r.contender_period_ms)?r.contender_period_ms*2:null,"No contender presentation intervals recorded.");
  $("wall-detail").textContent=frameDetail(r.wallpaper,r.media_render_update_hz);$("cont-detail").textContent=frameDetail(r.contender);
  const cpuFields=[["wallpaper_cpu","#f0a1cd","Wallpaper"],["contender_cpu","#e3bd7c","Contender"],["compositor_cpu","#96b9ee","Compositor"],["profiler_cpu","#a69cab","Profiler"]];
  plot("cpu-plot",cpuFields.map(([field,color,name])=>({points:resourcePoints(r,field),color,name})),start,end,"% of one core",null,r.cpu_metrics_available.sample_tails?"No CPU samples in this window.":"CPU sampled peaks unavailable; inspect CPU evidence.");
  $("cpu-detail").textContent=`Whole-run weighted mean: ${r.cpu_metrics_available.weighted_mean?fmt(r.weighted_cpu_mean_percent_one_core)+'% of one core':'unknown'} · sampled peaks/tails ${r.cpu_metrics_available.sample_tails?'supported':'unknown'} · evidence ${r.cpu_evidence.status}${r.cpu_evidence.retrospective?' (retrospective, hash matched)':''}.`;
  const field=$("resource").value, [label,unit]=resources[field], reduction=r.plots.resources.reductions[field];
  plot("resource-plot",[{points:resourcePoints(r,field),color:"#a6d3b5",name:label}],start,end,unit);
  $("resource-note").textContent=`${reduction==='min'?'MINIMUM':'MAXIMUM'} sampled value per 100 ms bin. GPU values cover the sampled device; sparse dots retain the original coarse sampling.`;
  const stats=r.resources[field]||{};
  $("resource-detail").textContent=`Whole measured window: mean ${fmt(stats.mean)} · minimum ${fmt(stats.min)} · maximum ${fmt(stats.max)} ${unit}. These are sampled descriptors.`;
  const {plots,...record}=r;$("run-record").textContent=JSON.stringify({...record,provenance:p},null,2);
}
for(const id of ["study","engine","batch"])$(id).addEventListener("change",drawTables);
for(const id of ["groups","runs"])$(id).addEventListener("click",event=>{const button=event.target.closest("button[data-run]");if(button)choose(button.dataset.run);});
$("run-select").addEventListener("change",()=>choose($("run-select").value));
for(const id of ["from","window","resource"])$(id).addEventListener("input",drawSelected);
$("pan").addEventListener("input",()=>{$("from").value=$("pan").value;drawSelected();});
drawTables();
</script></main></body></html>"""


if __name__ == "__main__":
    main()
