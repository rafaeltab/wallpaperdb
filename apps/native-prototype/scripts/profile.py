"""Sustained paired experiments with frame-level presentation and a fixed GPU contender.

The contender is a synthetic graphics workload, not a game benchmark. Missing
counters stay null. NVML utilization has a coarser averaging window than polling.
"""

import argparse, csv, ctypes, hashlib, json, math, os, shutil, socket, statistics, struct, subprocess, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = {}
RESOURCE_MAX_AGE_SECONDS = 2


def load_controls():
    # Unit tests and --help must not require a desktop session.
    global RUNTIME, CONTROL, ENV, api, assign, ready, hypr, saved_assignments
    from lab_common import RUNTIME, CONTROL, ENV, api, assign, ready, hypr, saved_assignments


def percentile(xs, p):
    if not xs:
        return None
    a = sorted(xs)
    x = (len(a) - 1) * p
    lo = int(x)
    hi = min(lo + 1, len(a) - 1)
    return a[lo] + (a[hi] - a[lo]) * (x - lo)


def distribution(xs, period=None, duration=False):
    result = {
        "samples": len(xs),
        "mean": statistics.mean(xs) if xs else None,
        "p50": percentile(xs, 0.5),
        "p95": percentile(xs, 0.95),
        "p99": percentile(xs, 0.99),
        "p999": percentile(xs, 0.999),
        "max": max(xs) if xs else None,
    }
    if period:
        result.update(
            {
                f"over_{factor:g}x": sum(x > period * factor + 0.1 for x in xs)
                for factor in [1.5, 2, 3]
            }
        )
    if duration or period:
        result["over_50ms"] = sum(x > 50 for x in xs)
    return result


class GPU:
    """NVML in-process avoids spawning nvidia-smi on every sample."""

    class Util(ctypes.Structure):
        _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]

    class Memory(ctypes.Structure):
        _fields_ = [
            ("total", ctypes.c_ulonglong),
            ("free", ctypes.c_ulonglong),
            ("used", ctypes.c_ulonglong),
        ]

    def __init__(self):
        try:
            self.lib = ctypes.CDLL("libnvidia-ml.so.1")
            self.handle = ctypes.c_void_p()
            if (
                self.lib.nvmlInit_v2() != 0
                or self.lib.nvmlDeviceGetHandleByIndex_v2(0, ctypes.byref(self.handle)) != 0
            ):
                raise RuntimeError("NVML unavailable")
        except Exception:
            self.lib = None

    def read(self):
        if not self.lib:
            return {}
        u = self.Util()
        power = ctypes.c_uint()
        clock = ctypes.c_uint()
        temp = ctypes.c_uint()
        decoder = ctypes.c_uint()
        period = ctypes.c_uint()
        memory = self.Memory()
        r = {}
        if self.lib.nvmlDeviceGetUtilizationRates(self.handle, ctypes.byref(u)) == 0:
            r.update(gpu_percent=u.gpu, memory_percent=u.memory)
        if self.lib.nvmlDeviceGetMemoryInfo(self.handle, ctypes.byref(memory)) == 0:
            r.update(
                vram_total_mib=memory.total / 1048576,
                vram_free_mib=memory.free / 1048576,
                vram_used_mib=memory.used / 1048576,
            )
        if self.lib.nvmlDeviceGetPowerUsage(self.handle, ctypes.byref(power)) == 0:
            r["watts"] = power.value / 1000
        if self.lib.nvmlDeviceGetClockInfo(self.handle, 0, ctypes.byref(clock)) == 0:
            r["graphics_mhz"] = clock.value
        if self.lib.nvmlDeviceGetTemperature(self.handle, 0, ctypes.byref(temp)) == 0:
            r["temperature_c"] = temp.value
        if (
            self.lib.nvmlDeviceGetDecoderUtilization(
                self.handle, ctypes.byref(decoder), ctypes.byref(period)
            )
            == 0
        ):
            r.update(decoder_percent=decoder.value, decoder_sample_us=period.value)
        return r


RESOURCE_FIELDS = [
    "gpu_percent",
    "memory_percent",
    "watts",
    "graphics_mhz",
    "temperature_c",
    "decoder_percent",
    "decoder_sample_us",
    "vram_total_mib",
    "vram_free_mib",
    "vram_used_mib",
    "cpu_temperature_c",
    "ram_available_mib",
    "cpu_scaling_mhz_min",
    "cpu_scaling_mhz_mean",
    "cpu_scaling_mhz_max",
]


class ResourceReader:
    def __init__(self):
        self.gpu = GPU()
        self.cpu_sensor = None
        for directory in sorted(Path("/sys/class/hwmon").glob("hwmon*")):
            try:
                if (directory / "name").read_text().strip() in ("k10temp", "coretemp"):
                    candidate = directory / "temp1_input"
                    if candidate.exists():
                        self.cpu_sensor = candidate
                        break
            except OSError:
                pass
        self.frequency_paths = list(
            Path("/sys/devices/system/cpu/cpufreq").glob("policy*/scaling_cur_freq")
        )
        self.frequency = {}
        self.frequency_due = 0.0

    def read(self):
        now = time.monotonic()
        values = self.gpu.read()
        try:
            if self.cpu_sensor:
                values["cpu_temperature_c"] = float(self.cpu_sensor.read_text()) / 1000
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemAvailable:"):
                    values["ram_available_mib"] = int(line.split()[1]) / 1024
                    break
        except (OSError, ValueError):
            pass
        if now >= self.frequency_due:
            frequencies = []
            for path in self.frequency_paths:
                try:
                    frequencies.append(float(path.read_text()) / 1000)
                except (OSError, ValueError):
                    pass
            self.frequency = (
                {
                    "cpu_scaling_mhz_min": min(frequencies),
                    "cpu_scaling_mhz_mean": statistics.mean(frequencies),
                    "cpu_scaling_mhz_max": max(frequencies),
                }
                if frequencies
                else {}
            )
            self.frequency_due = now + 1
        return values | self.frequency | {"monotonic": now}


class GuardViolation(RuntimeError):
    pass


class SafetyGuard:
    def __init__(
        self,
        max_gpu_temp=82,
        max_cpu_temp=96,
        min_vram_free_mib=1024,
        min_ram_free_mib=8192,
        cpu_grace=3,
    ):
        self.max_gpu_temp = max_gpu_temp
        self.max_cpu_temp = max_cpu_temp
        self.min_vram_free_mib = min_vram_free_mib
        self.min_ram_free_mib = min_ram_free_mib
        self.cpu_grace = cpu_grace
        self.cpu_hot_since = None

    def check(self, values, now):
        for key in ["temperature_c", "cpu_temperature_c", "vram_free_mib", "ram_available_mib"]:
            value = values.get(key)
            if value is None or not math.isfinite(value):
                raise GuardViolation(f"Required guard counter unavailable: {key}")
        if values["temperature_c"] >= self.max_gpu_temp:
            raise GuardViolation(f"GPU temperature reached {values['temperature_c']:.1f} C")
        if values["vram_free_mib"] < self.min_vram_free_mib:
            raise GuardViolation(f"Free VRAM fell below {self.min_vram_free_mib:g} MiB")
        if values["ram_available_mib"] < self.min_ram_free_mib:
            raise GuardViolation(f"Available RAM fell below {self.min_ram_free_mib:g} MiB")
        if values["cpu_temperature_c"] >= self.max_cpu_temp:
            if self.cpu_hot_since is None:
                self.cpu_hot_since = now
            if now - self.cpu_hot_since >= self.cpu_grace:
                raise GuardViolation(
                    f"CPU temperature remained at least {self.max_cpu_temp:g} C for {self.cpu_grace:g} seconds"
                )
        else:
            self.cpu_hot_since = None


def wait_for_cooldown(
    read,
    seconds=120,
    start_cpu_temp=95.5,
    start_gpu_temp=70,
    clock=time.monotonic,
    sleep=time.sleep,
):
    deadline = clock() + seconds
    while True:
        values = read()
        if (
            values.get("cpu_temperature_c", math.inf) <= start_cpu_temp
            and values.get("temperature_c", math.inf) <= start_gpu_temp
        ):
            return values
        if clock() >= deadline:
            raise GuardViolation("Initial cooldown deadline exceeded; no workload launched")
        sleep(min(0.25, deadline - clock()))


class SafetyMonitor:
    """Always active, including recorder-off controls; never kills unrelated processes."""

    def __init__(self, guard, reader=None, clock=time.monotonic):
        self.guard = guard
        self.reader = reader or ResourceReader()
        self.clock = clock
        self.rows = []
        self.failure = None
        self.child = None
        self.done = threading.Event()
        self.prepared = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def fail(self, message):
        if self.failure is None:
            self.failure = str(message)
            # The sampler/main thread can detect a stalled resource reader too.
            if self.child and self.child.poll() is None:
                try:
                    self.child.terminate()
                except ProcessLookupError:
                    pass
        self.done.set()
        self.prepared.set()

    def check_freshness(self, values):
        stamp = values.get("monotonic")
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            raise GuardViolation("Resource observation has no valid monotonic timestamp")
        age = self.clock() - stamp
        if age < 0 or age > RESOURCE_MAX_AGE_SECONDS:
            raise GuardViolation(f"Resource observation is stale or invalid ({age:.2f}s old)")

    def run(self):
        while not self.done.is_set():
            try:
                values = self.reader.read()
                self.rows.append(values)
                self.check_freshness(values)
                self.guard.check(values, values["monotonic"])
            except Exception as error:
                self.fail(error)
                return
            self.prepared.set()
            self.done.wait(0.25)

    def snapshot(self):
        if not self.prepared.wait(2):
            self.fail("Resource monitor did not initialize within two seconds")
        if self.failure:
            raise GuardViolation(self.failure)
        values = dict(self.rows[-1])
        try:
            self.check_freshness(values)
        except GuardViolation as error:
            self.fail(error)
            raise
        return values

    def wait(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.snapshot()
            if self.child and self.child.poll() is not None:
                raise RuntimeError("Contender exited during guarded wait")
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
        self.snapshot()

    def stop(self):
        self.done.set()
        self.thread.join(timeout=2)
        if self.thread.is_alive() and not self.failure:
            self.failure = "Resource monitor did not stop within two seconds"


def wallpaper_errors(kind, paused, initial, final):
    if not final:
        return ["Wallpaper telemetry missing at end of run"]
    errors = []
    if (
        final.get("state") not in (None, "ready")
        or final.get("error")
        or final.get("browser", {}).get("error")
    ):
        errors.append("Wallpaper reported an error at end of run")
    if kind == "live" and not paused and final.get("frames", 0) <= initial.get("frames", 0):
        errors.append("Animated wallpaper stopped producing frames")
    return errors


def validate_renderer_policy(engine, stats):
    """Reject an old helper or unapplied policy for the opt-in dropping variant."""
    if engine != "gpu-independent-drop":
        return
    if (
        stats.get("media_decoder_drop_enabled") is not True
        or stats.get("media_framedrop_requested") != "decoder+vo"
        or type(stats.get("media_active")) is not bool
        or (
            stats["media_active"]
            and (
                stats.get("media_framedrop") != "decoder+vo"
                or stats.get("media_framedrop_verified_at_init") is not True
            )
        )
    ):
        raise WallpaperFailure("Decoder-drop experiment lacks verified decoder+vo policy", stats)


def video_progress(kind, paused, observations, frames):
    """Assess supported playback evidence without treating it as compositor FPS."""
    result = {"status": "unavailable", "method": None, "videos": [], "errors": []}
    if kind == "image":
        result["status"] = "not_applicable"
        return result
    if paused:
        result.update(status="pause_requested", method="See separate pause_evidence validation")
        return result

    def finite(value):
        return isinstance(value, (int, float)) and math.isfinite(value)

    tracks = {}
    for stamp, stats in observations:
        browser = stats.get("browser", stats)
        videos = browser.get("videos", [])
        if kind == "video" and stats.get("renderer") == "mpv":
            # Native mpvpaper exposes playback position, not decoded/presented counts.
            videos = [{key: stats.get(key) for key in ("time", "duration", "paused")}]
        for index, video in enumerate(videos):
            tracks.setdefault(index, []).append((stamp, video))
    for index, points in tracks.items():
        last = points[-1][1]
        recent = [(t, v) for t, v in points if t >= points[-1][0] - 5]
        positions = [(t, v["time"]) for t, v in recent if finite(v.get("time"))]
        quality = [
            (t, v["total_video_frames"] - v["dropped_video_frames"])
            for t, v in recent
            if finite(v.get("total_video_frames"))
            and finite(v.get("dropped_video_frames"))
            and v["total_video_frames"] >= v["dropped_video_frames"] >= 0
        ]
        moved = any(abs(b[1] - a[1]) > 0.001 for a, b in zip(positions, positions[1:]))
        displayed = sum(max(0, b[1] - a[1]) for a, b in zip(quality, quality[1:]))
        duration = last.get("duration")
        # Initial/end polls can repeat the same cached telemetry a few ms apart.
        spacings = [b[0] - a[0] for a, b in zip(positions, positions[1:]) if b[0] - a[0] >= 0.25]
        # Equal positions sampled once per complete loop are ambiguous unless
        # playback-quality counters also establish whether video frames advanced.
        position_can_show_stall = (
            len(positions) >= 3
            and positions[-1][0] - positions[0][0] >= 1.5
            and (
                not finite(duration)
                or duration <= 0
                or (spacings and duration > min(spacings) + 0.1)
            )
        )
        quality_can_show_stall = len(quality) >= 3 and max(v for _, v in quality) > 0
        errors = []
        if last.get("error") or last.get("paused") is True:
            errors.append(f"Video {index} is paused or reports a playback error")
        if ("ready" in last and (not finite(last["ready"]) or last["ready"] < 2)) or any(
            key in last and (not finite(last[key]) or last[key] <= 0) for key in ("width", "height")
        ):
            errors.append(f"Video {index} has no ready decoded dimensions")
        if not moved and not displayed and (position_can_show_stall or quality_can_show_stall):
            errors.append(f"Video {index} stopped advancing in the final telemetry window")
        result["videos"].append(
            {
                "index": index,
                "status": (
                    "failed" if errors else "observed" if moved or displayed else "unavailable"
                ),
                "position_samples": len(positions),
                "position_changed": moved if len(positions) >= 2 else None,
                "playback_quality_samples": len(quality),
                "displayed_frame_increments": displayed if len(quality) >= 2 else None,
                "note": "Playback-quality total minus dropped frames is browser video display accounting, not a decoder or compositor-presentation count.",
            }
        )
        result["errors"].extend(errors)
    if tracks:
        result["method"] = "video playback telemetry"
        result["status"] = (
            "failed"
            if result["errors"]
            else (
                "observed"
                if all(video["status"] == "observed" for video in result["videos"])
                else "unavailable"
            )
        )
        return result

    hwdec_active = any(
        stats.get("hwdec") not in (None, "", "none", "no", False) for _, stats in observations
    )
    if frames.get("available") and (
        kind == "video" or hwdec_active or frames.get("media_updates", 0)
    ):
        updates = frames.get("media_updates", 0)
        last_update = frames.get("last_media_update")
        result.update(method="native media render updates", media_updates=updates)
        if not updates or (
            observations and finite(last_update) and observations[-1][0] - last_update > 5
        ):
            result["errors"].append("Native video stopped producing media render updates")
            result["status"] = "failed"
        else:
            result["status"] = "observed"
        result["note"] = (
            "libmpv render-update submissions are observed; they are not decoded-frame or compositor-presentation counts."
        )
    elif kind != "video" and not any("hwdec" in stats for _, stats in observations):
        result["status"] = "not_applicable"
    return result


def pause_evidence(kind, requested, observations, frames, start, end):
    """Validate sampled cooperative pause behavior, not arbitrary visual stillness."""
    result = {
        "status": "not_requested",
        "checks": {},
        "videos": [],
        "errors": [],
        "scope": "Native render submissions/presentations, host-delivered browser scene frame events, and observable video state after warmup. Independent JS timers, CSS animation, decoder work and visual pixels are not proven stationary; rAF/OSR callback counts alone do not imply content animation.",
    }
    if kind == "image":
        result.update(
            status="not_applicable",
            scope="Retained static image; zero presentations after warmup do not indicate an animation failure.",
        )
        return result
    if not requested:
        return result
    failures, unknown = [], []
    checks = result["checks"]

    def finite(value):
        return (
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        )

    def pause_flags(label, values):
        checks[label] = {
            "samples": len(values),
            "first": values[0] if values else None,
            "last": values[-1] if values else None,
            "true_samples": sum(value is True for value in values),
        }
        if any(value is False for value in values):
            failures.append(f"{label}: pause flag was false during measurement")
        if not values or any(value is not True and value is not False for value in values):
            unknown.append(f"{label}: pause flag unavailable")

    def stationary(label, values):
        valid = [value for value in values if finite(value) and value >= 0]
        checks[label] = {
            "samples": len(valid),
            "first": valid[0] if valid else None,
            "last": valid[-1] if valid else None,
            "range": max(valid) - min(valid) if valid else None,
        }
        if not values or len(valid) != len(values):
            unknown.append(f"{label}: counter unavailable")
        if valid and max(valid) != min(valid):
            failures.append(f"{label}: counter changed after pause warmup")

    points = sorted(
        (
            (stamp, stats)
            for stamp, stats in observations
            if finite(stamp) and isinstance(stats, dict)
        ),
        key=lambda point: point[0],
    )
    stamps = [stamp for stamp, _ in points]
    gaps = [b - a for a, b in zip(stamps, stamps[1:])]
    checks["telemetry_observations"] = len(points)
    checks["maximum_poll_gap_seconds"] = max(gaps, default=None)
    if (
        len(points) < 3
        or not stamps
        or stamps[0] > start + 0.5
        or stamps[-1] < end - 1.5
        or max(gaps, default=0) > 3.5
    ):
        unknown.append("Pause evidence lacks measurement-boundary and periodic telemetry coverage")
    stats = [value for _, value in points]
    if any(value.get("error") or value.get("state") not in (None, "ready") for value in stats):
        failures.append("Wallpaper reported an error or non-ready state during paused measurement")
    native = any(
        str(value.get("renderer", "")).startswith(("Lua / OpenGL", "Chromium")) for value in stats
    )
    browser = any(
        "browser" in value or "videos" in value or "report_sequence" in value for value in stats
    )
    if native:
        pause_flags("native_pause_flags", [value.get("paused") for value in stats])
        stationary("native_render_frames", [value.get("frames") for value in stats])
        if not frames.get("available"):
            unknown.append("Native paused rendering has no frame trace")
        else:
            for label, count in (
                ("native_presentations", frames.get("presented_frames")),
                ("native_render_submissions", frames.get("cpu_submit_ms", {}).get("samples")),
                ("native_media_render_updates", frames.get("media_updates")),
            ):
                checks[label] = count
                if not finite(count) or count < 0:
                    unknown.append(f"{label}: frame trace count unavailable")
                elif count != 0:
                    failures.append(f"{label}: work continued after pause warmup")
    if browser:
        browser_points = [(stamp, value.get("browser", value)) for stamp, value in points]
        browser_points = [
            (stamp, value if isinstance(value, dict) else {}) for stamp, value in browser_points
        ]
        values = [value for _, value in browser_points]
        pause_flags("browser_pause_flags", [value.get("paused") for value in values])
        # The runtime increments frames only when it emits a scene "frame" event.
        # Electron received/OSR counters and arbitrary rAF callbacks are not this counter.
        stationary("browser_scene_frame_events", [value.get("frames") for value in values])
        fresh_stamps, previous = [], None
        for stamp, value in browser_points:
            sequence = value.get("report_sequence")
            if not finite(sequence) or sequence < 1 or int(sequence) != sequence:
                unknown.append(
                    "Browser report freshness is unavailable (paused heartbeat sequence missing)"
                )
                continue
            if previous is not None and sequence < previous:
                failures.append("Browser telemetry report sequence reset during measurement")
            if sequence != previous:
                fresh_stamps.append(stamp)
            previous = sequence
        fresh_gaps = [b - a for a, b in zip(fresh_stamps, fresh_stamps[1:])]
        checks["browser_fresh_reports"] = len(fresh_stamps)
        checks["browser_maximum_fresh_report_gap_seconds"] = max(fresh_gaps, default=None)
        if (
            len(fresh_stamps) < 3
            or not fresh_stamps
            or fresh_stamps[-1] < end - 3.5
            or max(fresh_gaps, default=0) > 3.5
        ):
            unknown.append(
                "Browser pause cannot be verified from stale or insufficient fresh reports"
            )
        if any(value.get("error") for value in values):
            failures.append("Browser reported an error during paused measurement")
        video_lists = [value.get("videos") for value in values]
        if any(not isinstance(videos, list) for videos in video_lists):
            unknown.append("Browser paused video inventory is unavailable")
        video_lists = [videos if isinstance(videos, list) else [] for videos in video_lists]
        counts = [len(videos) for videos in video_lists]
        if counts and min(counts) != max(counts):
            unknown.append("Browser video inventory changed during paused measurement")
        if kind == "video" and not any(counts):
            unknown.append("Paused video has no observable browser media state")
        for index in range(max(counts, default=0)):
            track = [
                videos[index]
                for videos in video_lists
                if len(videos) > index and isinstance(videos[index], dict)
            ]
            pause_flags(f"video_{index}_pause_flags", [video.get("paused") for video in track])
            positions = [video["time"] for video in track if finite(video.get("time"))]
            position_range = max(positions) - min(positions) if positions else None
            if len(positions) != len(values):
                unknown.append(f"Video {index} paused playback position is unavailable")
            if position_range is not None and position_range > 0.001:
                failures.append(f"Video {index} playback position changed after pause warmup")
            display = [
                video["total_video_frames"] - video["dropped_video_frames"]
                for video in track
                if finite(video.get("total_video_frames"))
                and finite(video.get("dropped_video_frames"))
                and video["total_video_frames"] >= video["dropped_video_frames"] >= 0
            ]
            display_range = max(display) - min(display) if len(display) >= 2 else None
            if display_range:
                failures.append(
                    f"Video {index} browser video display accounting changed after pause warmup"
                )
            if any(
                video.get("error")
                or ("ready" in video and (not finite(video["ready"]) or video["ready"] < 2))
                or any(
                    key in video and (not finite(video[key]) or video[key] <= 0)
                    for key in ("width", "height")
                )
                for video in track
            ):
                failures.append(f"Video {index} has an error or lacks ready decoded dimensions")
            result["videos"].append(
                {
                    "index": index,
                    "position_samples": len(positions),
                    "position_range_seconds": position_range,
                    "display_accounting_samples": len(display),
                    "display_accounting_range": display_range,
                    "note": "Optional total-minus-dropped is browser video display accounting, not a decoder or compositor-presentation counter.",
                }
            )
    elif any(str(value.get("renderer", "")).startswith("Chromium") for value in stats):
        unknown.append("Chromium pause lacks browser scene/video telemetry")
    if not native and not browser:
        unknown.append(
            "Renderer lacks independent paused-work evidence; an echoed pause request or cached mpvpaper position is insufficient"
        )
    result["errors"] = list(dict.fromkeys(failures + unknown))
    result["status"] = "failed" if failures else "unknown" if unknown else "verified"
    return result


def source_kind(source):
    path = ROOT / "examples" / source
    if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg", ".bmp"):
        return "image"
    if path.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov", ".m4v", ".avi"):
        return "video"
    return "live"


def source_evidence(source):
    selected = (ROOT / "examples" / source).resolve()
    studio = (ROOT / "examples" / "stress-studio").resolve()
    shared_studio = selected.is_relative_to(studio)
    scope = studio if shared_studio else selected
    paths = (
        sorted(path for path in scope.rglob("*") if path.is_file()) if scope.is_dir() else [scope]
    )
    digest = hashlib.sha256()
    files = []
    for path in paths:
        name = path.relative_to(scope).as_posix() if scope.is_dir() else path.name
        encoded = name.encode()
        size = path.stat().st_size
        if shared_studio:
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
            digest.update(size.to_bytes(8, "big"))
        file_hash = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(1048576):
                digest.update(chunk)
                file_hash.update(chunk)
        files.append({"path": name, "bytes": size, "sha256": file_hash.hexdigest()})
    return {
        "sha256": digest.hexdigest(),
        "scope": (
            scope.relative_to(ROOT.resolve()).as_posix()
            if scope.is_relative_to(ROOT.resolve())
            else str(scope)
        ),
        "algorithm": (
            "sha256(sorted(relative pathname length, pathname, file length, file bytes)); 8-byte big-endian lengths"
            if shared_studio
            else "sha256(sorted file contents), compatible with historical profiler; file manifest records names"
        ),
        "files": files,
    }


def pointer_summary(telemetry):
    values = {}
    for entry in telemetry:
        for surface in entry["surfaces"]:
            stats = surface.get("telemetry", {})
            browser = stats.get("browser", stats)
            pointer = browser.get("pointer", {})
            x = pointer.get("x", stats.get("pointer_x"))
            y = pointer.get("y", stats.get("pointer_y"))
            if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                values.setdefault(surface["output"], []).append((x, y))
    return {
        output: {
            "samples": len(points),
            "changed": len(set(points)) > 1,
            **{
                axis: {
                    "first": points[0][index],
                    "last": points[-1][index],
                    "min": min(p[index] for p in points),
                    "max": max(p[index] for p in points),
                }
                for index, axis in enumerate(("x", "y"))
            },
        }
        for output, points in values.items()
    }


def processes():
    found = {}
    for p in Path("/proc").glob("[0-9]*/stat"):
        try:
            text = p.read_text()
            end = text.rfind(")")
            parts = text[end + 2 :].split()
            pid = int(p.parent.name)
            runtime = (int(parts[11]) + int(parts[12])) * 1e9 / os.sysconf("SC_CLK_TCK")
            found[pid] = {
                "ppid": int(parts[1]),
                "name": text[text.find("(") + 1 : end],
                "runtime": runtime,
                "start_ticks": int(parts[19]),
                "rss": int(parts[21]) * os.sysconf("SC_PAGE_SIZE"),
            }
        except (OSError, ValueError, IndexError):
            pass
    return found


def family(table, roots):
    members = set(roots)
    for _ in range(10):
        more = {p for p, v in table.items() if v.get("ppid") in members}
        if more <= members:
            break
        members |= more
    return members


def sample_membership(table, roots):
    wallpaper = {pid for pid in family(table, roots[:1]) if pid > 0}
    contender = {pid for pid in family(table, roots[1:2]) if pid > 0}
    return wallpaper, contender, wallpaper | contender | {pid for pid in roots[2:] if pid > 0}


def cpu_interval(previous, current):
    """A PID's counter delta belongs to its own elapsed interval, including gaps."""
    if previous is None:
        return 0.0, 0.0
    before_ns, before_stamp = previous
    ns, stamp = current
    elapsed = stamp - before_stamp
    if elapsed <= 0 or ns < before_ns:
        raise RuntimeError("Process CPU counter or monotonic time moved backwards")
    return (ns - before_ns) / elapsed / 1e7, elapsed


def cpu_window_evidence(stamps, start, end, period):
    """Coverage of retained sample intervals; missing-PID checks are separate."""
    if period <= 0:
        return {"status": "disabled", "mean_valid": False, "tails_valid": False, "errors": []}
    stamps = sorted(stamp for stamp in stamps if start <= stamp <= end)
    duration = end - start
    span = stamps[-1] - stamps[0] if len(stamps) >= 2 else 0
    first_gap = stamps[0] - start if stamps else None
    last_gap = end - stamps[-1] if stamps else None
    gaps = [b - a for a, b in zip(stamps, stamps[1:])]
    largest_gap = max(gaps, default=None)
    edge_limit = max(0.25, period * 3)
    gap_limit = max(0.25, period * 5)
    coverage = span / duration if duration > 0 else 0
    mean_valid = (
        len(stamps) >= 3
        and duration > 0
        and coverage >= 0.98
        and first_gap <= edge_limit
        and last_gap <= edge_limit
        and all(gap > 0 for gap in gaps)
    )
    tails_valid = bool(mean_valid and largest_gap <= gap_limit)
    errors = []
    if not mean_valid:
        errors.append(
            "CPU samples do not cover at least 98% of the measured window and both boundaries"
        )
    if mean_valid and not tails_valid:
        errors.append(
            "CPU sample gap exceeds the tail-coverage limit; interval-integrated mean remains available"
        )
    return {
        "status": "verified" if tails_valid else "partial" if mean_valid else "unknown",
        "mean_valid": bool(mean_valid),
        "tails_valid": tails_valid,
        "samples": len(stamps),
        "covered_seconds": span,
        "coverage_fraction": coverage,
        "first_sample_delay_seconds": first_gap,
        "last_sample_before_end_seconds": last_gap,
        "maximum_sample_gap_seconds": largest_gap,
        "boundary_limit_seconds": edge_limit,
        "tail_gap_limit_seconds": gap_limit,
        "errors": errors,
    }


class Sampler:
    def __init__(self, folder, roots, period=0.05, monitor=None):
        self.folder = folder
        self.roots = roots
        self.period = period
        self.monitor = monitor
        self.failure = None
        self.missing_clocks = []
        self.read_errors = []
        self.expected_pids = []
        self.worker_completed = False
        self.worker_exit = None
        self.worker_started_at = None
        self.worker_finished_at = None
        self.done = threading.Event()
        self.rows = []
        self.gpu_rows = []
        self.lateness = []
        self.prepared = threading.Event()
        self.begin = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        self.worker_started_at = time.monotonic()
        try:
            self._run()
            self.worker_exit = "disabled" if self.period <= 0 else "requested_stop"
            if self.period > 0 and not self.done.is_set():
                raise RuntimeError("CPU sampler returned without a stop request")
        except BaseException as error:
            self.failure = f"CPU sampler {type(error).__name__}: {error}"
            self.worker_exit = "error"
        finally:
            self.worker_finished_at = time.monotonic()
            self.worker_completed = True
            self.prepared.set()

    def _run(self):
        gpu = ResourceReader() if self.period > 0 and self.monitor is None else None
        before = {}
        table = processes()
        wallpaper_members, contender_members, members = sample_membership(table, self.roots)
        self.expected_pids = sorted(members)
        self.topology = {pid: table.get(pid, {}) for pid in members}
        clocks = {}
        if self.period > 0:
            libc = ctypes.CDLL(None)
            for pid in self.expected_pids:
                cid = ctypes.c_int()
                error = libc.clock_getcpuclockid(pid, ctypes.byref(cid))
                if error:
                    self.missing_clocks.append({"pid": pid, "error_code": error})
                else:
                    clocks[pid] = cid.value
            if self.missing_clocks:
                raise RuntimeError(
                    f"Process CPU clocks unavailable for {len(self.missing_clocks)} expected PIDs"
                )
        self.prepared.set()
        self.begin.wait()
        if self.period <= 0:
            return
        next_due = time.monotonic()
        resource_stamp = None
        page_mib = os.sysconf("SC_PAGE_SIZE") / 1048576
        with (self.folder / "process.csv").open("w", buffering=65536) as f, (
            self.folder / "gpu.csv"
        ).open("w", buffering=65536) as gf:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "monotonic",
                    "pid",
                    "name",
                    "role",
                    "cpu_percent_one_core",
                    "rss_mib",
                    "sample_monotonic",
                    "cpu_total_ns",
                    "sample_elapsed_seconds",
                ]
            )
            gw = csv.writer(gf)
            gw.writerow(["monotonic", *RESOURCE_FIELDS])
            while not self.done.is_set():
                now = time.monotonic()
                self.lateness.append(max(0, now - next_due) * 1000)
                totals = {
                    "monotonic": now,
                    "wallpaper_cpu": 0.0,
                    "contender_cpu": 0.0,
                    "compositor_cpu": 0.0,
                    "profiler_cpu": 0.0,
                    "rss_mib": 0.0,
                }
                for pid in self.expected_pids:
                    try:
                        ns = time.clock_gettime_ns(clocks[pid])
                        stamp = time.monotonic()
                        stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                        if int(stat[19]) != table.get(pid, {}).get("start_ticks"):
                            raise RuntimeError("Process identity changed")
                        rss = int(stat[21]) * page_mib
                        cpu, elapsed = cpu_interval(before.get(pid), (ns, stamp))
                    except (OSError, ValueError, IndexError, KeyError, RuntimeError) as error:
                        self.read_errors.append(
                            {
                                "monotonic": now,
                                "pid": pid,
                                "error": f"{type(error).__name__}: {error}",
                            }
                        )
                        raise RuntimeError(
                            f"Expected PID {pid} CPU sample unavailable: {error}"
                        ) from error
                    before[pid] = (ns, stamp)
                    name = table.get(pid, {}).get("name", "unknown")
                    role = "wallpaper"
                    if pid in contender_members:
                        role = "contender"
                    elif name == "Hyprland":
                        role = "compositor"
                    elif pid == os.getpid():
                        role = "profiler"
                    writer.writerow([now, pid, name, role, cpu, rss, stamp, ns, elapsed])
                    totals[role + "_cpu"] += cpu
                    if role == "wallpaper":
                        totals["rss_mib"] += rss
                self.rows.append(totals)
                values = self.monitor.snapshot() if self.monitor else gpu.read()
                if values["monotonic"] != resource_stamp:
                    resource_stamp = values["monotonic"]
                    self.gpu_rows.append(values)
                    gw.writerow([resource_stamp, *[values.get(k) for k in RESOURCE_FIELDS]])
                next_due += self.period
                if next_due < now:
                    next_due = now + self.period
                self.done.wait(max(0, next_due - time.monotonic()))

    def stop(self):
        self.done.set()
        self.thread.join(timeout=2)
        if self.thread.is_alive():
            self.failure = "CPU sampler did not stop within two seconds"

    def evidence(self, start, end):
        result = cpu_window_evidence(
            [row["monotonic"] for row in self.rows], start, end, self.period
        )
        result.update(
            expected_pids=self.expected_pids,
            missing_clocks=self.missing_clocks,
            read_errors=self.read_errors,
            worker_completed=self.worker_completed,
            worker_exit=self.worker_exit,
            worker_started_at=self.worker_started_at,
            worker_finished_at=self.worker_finished_at,
            interval_method="Each process CPU delta uses that PID's monotonic interval; CSV retains timestamps and raw counters. Aggregate rate samples use one sweep timestamp, so per-PID sampling offsets remain observable.",
        )
        if self.failure or not self.worker_completed:
            result.update(status="unknown", mean_valid=False, tails_valid=False)
            result["errors"].append(self.failure or "CPU worker completion evidence unavailable")
        return result


def contender_config(folder, passes, fps, record=True, output="DP-2", black=False, monitor=None):
    """Separate fixed offscreen GPU work from the requested presentation surface."""
    view = {"name": output, "width": 1280, "height": 720}
    if black:
        if not isinstance(monitor, dict) or monitor.get("name") != output:
            raise ValueError(f"Black contender requires current metadata for output {output}")
        try:
            width = float(monitor["width"])
            height = float(monitor["height"])
            scale = float(monitor["scale"])
            transform = float(monitor.get("transform", 0))
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Invalid black contender geometry for output {output}") from error
        if (
            not all(math.isfinite(value) for value in (width, height, scale, transform))
            or min(width, height, scale) <= 0
            or not width.is_integer()
            or not height.is_integer()
            or not transform.is_integer()
            or not 0 <= transform <= 7
        ):
            raise ValueError(f"Invalid black contender geometry for output {output}")
        pixel_width, pixel_height = int(width), int(height)
        if int(transform) % 2:
            pixel_width, pixel_height = pixel_height, pixel_width
        # Match Monitor.logical(): positive dimensions round to the nearest integer.
        logical_width = math.floor(pixel_width / scale + 0.5)
        logical_height = math.floor(pixel_height / scale + 0.5)
        if min(logical_width, logical_height) < 1:
            raise ValueError(f"Invalid black contender logical size for output {output}")
        view.update(
            width=logical_width,
            height=logical_height,
            pixel_width=pixel_width,
            pixel_height=pixel_height,
        )
    return {
        "experiment": "gpu",
        "width": 1280,
        "height": 720,
        "fps": fps,
        "hdr": False,
        "stress": passes,
        "black_output": black,
        "script": str(ROOT / "examples/prism/scene.lua"),
        "outputs": [view],
        "frames": str(folder / "contender-frames.csv") if record else "",
    }


def contender(folder, passes, fps, record=True, output="DP-2", black=False, monitor=None):
    config = contender_config(folder, passes, fps, record, output, black, monitor)
    path = folder / "contender.json"
    path.write_text(json.dumps(config, indent=2))
    log = (folder / "contender.log").open("w")
    child = subprocess.Popen(
        [str(ROOT / "lab/build/presenter"), str(path)],
        env=ENV,
        stdin=subprocess.PIPE,
        stdout=log,
        stderr=log,
    )
    return child, log


def read_contender_telemetry(path):
    for line in reversed(path.read_text().splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and "state" in value:
            return value
    raise RuntimeError("Contender did not produce JSON initialization telemetry")


def validate_contender_telemetry(stats, config):
    if stats.get("state") != "ready" or stats.get("error"):
        raise RuntimeError("Contender did not report ready initialization")
    if "NVIDIA" not in stats.get("adapter", "") or stats.get("presentation_clock") != 1:
        raise RuntimeError("Contender did not report NVIDIA rendering and CLOCK_MONOTONIC")
    if not config["black_output"]:
        return
    if stats.get("black_output") is not True:
        raise RuntimeError("Contender did not acknowledge black_output=true")
    if stats.get("canvas") != {"width": config["width"], "height": config["height"]}:
        raise RuntimeError("Black contender changed the fixed offscreen workload dimensions")
    for requested in config["outputs"]:
        actual = next(
            (o for o in stats.get("outputs", []) if o.get("output") == requested["name"]), {}
        )
        dimensions = {
            "logical_width": requested["width"],
            "logical_height": requested["height"],
            "buffer_width": requested["pixel_width"],
            "buffer_height": requested["pixel_height"],
        }
        if actual.get("hidden") is not False or any(
            actual.get(key) != value for key, value in dimensions.items()
        ):
            raise RuntimeError(
                "Black contender configured dimensions do not match the full panel; fractional scaling is not assumed equivalent"
            )


def frame_summary(path, start, end, period):
    if not path.exists():
        return {"available": False}, []
    stamps = {}
    sequences = {}
    sequence_gaps = {}
    intervals = []
    gpu = []
    cpu = []
    discarded = 0
    flags = {}
    timeline = []
    presented_frames = 0
    media_updates = 0
    last_media_update = None
    output_data = {}
    with path.open() as f:
        for row in csv.DictReader(f):
            try:
                t = float(row["monotonic"])
                a = float(row["value"])
                event = row["event"]
                if event == "presented":
                    t = a
                if not start <= t <= end:
                    continue
                if event == "presented":
                    output = row["output"]
                    presented_frames += 1
                    output_data.setdefault(output, {"presented_frames": 0, "intervals": []})[
                        "presented_frames"
                    ] += 1
                    seq = int(row["sequence"])
                    if output in sequences:
                        gap = seq - sequences[output]
                        sequence_gaps[str(gap)] = sequence_gaps.get(str(gap), 0) + 1
                    sequences[output] = seq
                    flag = row["flags"]
                    flags[flag] = flags.get(flag, 0) + 1
                    if output in stamps:
                        interval = (a - stamps[output]) * 1000
                        intervals.append(interval)
                        output_data[output]["intervals"].append(interval)
                        timeline.append([t - start, interval])
                    stamps[output] = a
                elif event == "gpu":
                    gpu.append(a)
                elif event == "cpu":
                    cpu.append(a)
                elif event == "discarded":
                    discarded += 1
                elif event == "media":
                    media_updates += 1
                    last_media_update = t
            except (ValueError, KeyError):
                continue
    return {
        "available": True,
        "presented_frames": presented_frames,
        "last_presentation": max(stamps.values(), default=None),
        "sequence_gaps": sequence_gaps,
        "presented_hz": presented_frames / (end - start) if end > start else None,
        "media_updates": media_updates,
        "media_update_hz": media_updates / (end - start) if end > start else None,
        "last_media_update": last_media_update,
        "outputs": {
            name: {
                "presented_frames": values["presented_frames"],
                "presented_hz": values["presented_frames"] / (end - start) if end > start else None,
                "presentation_ms": distribution(values["intervals"], period),
            }
            for name, values in output_data.items()
        },
        "presentation_ms": distribution(intervals, period),
        "gpu_command_ms": distribution(gpu, duration=True),
        "cpu_submit_ms": distribution(cpu, duration=True),
        "discarded": discarded,
        "feedback_flags": flags,
    }, timeline


def atomic_write(path, contents):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_report(folder, manifest, runs):
    data = {"manifest": manifest, "runs": runs}
    atomic_write(folder / "report.json", json.dumps(data, indent=2))
    payload = json.dumps(data).replace("</", "<\\/")
    html = """<!doctype html><meta charset="utf-8"><title>WallpaperDB · Frame-time laboratory</title><style>
body{background:#151217;color:#eee4ef;font:15px system-ui;margin:40px auto;max-width:1250px;padding:0 24px}h1{font-size:36px}p{color:#bbadbd;line-height:1.6}select,input{background:#302330;color:white;border:1px solid #684563;padding:9px;border-radius:8px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #463344;font-size:13px}svg{width:100%;height:300px;background:#201924;border-radius:14px}.accent{color:#efa8d4}pre{white-space:pre-wrap}label{margin-right:20px}</style>
<h1>Frame-time laboratory</h1><p>Guarded renderer measurements with an optional synthetic GPU contender. Requested output, canvas workload and physical refresh are recorded separately in the manifest. Presentation timing measures compositor feedback; this is not a benchmark of any particular game. CPU samples use nanosecond process clocks at the selected rate; NVIDIA utilization averages a coarser native window. Startup warmup is excluded.</p>
<p id="contender-description"></p><div id="summary"></div><label>Run <select id="run"></select></label><label>Trace <select id="trace"><option value="contender">Contender</option><option value="wallpaper">Wallpaper</option></select></label><label>From <input id="from" type="number" value="0" min="0" step="5"> seconds</label><label>Window <input id="window" type="number" value="30" min="1"> seconds</label><p class="accent">Selected trace: actual presentation intervals (ms). Dashed line: twice the intended frame period.</p><svg id="chart" viewBox="0 0 1200 300"></svg><p>Aligned resource samples: pink = wallpaper CPU, blue = compositor CPU, gray = profiler CPU (percent of one core); green = total NVIDIA utilization (percent, coarsely averaged). Correlation alone does not establish cause.</p><svg id="resources" viewBox="0 0 1200 300"></svg><p id="detail"></p><details><summary>Method, hardware, and measurement limits</summary><pre id="manifest"></pre></details><script>const data=PAYLOAD;
const n=x=>x==null?'unavailable':x.toFixed(2);document.querySelector('#manifest').textContent=JSON.stringify(data.manifest,null,2);
const settings=data.manifest.arguments;document.querySelector('#contender-description').textContent=settings.no_contender?'No synthetic contender was active.':`${data.manifest.contender_mode} on ${settings.contender_output}, target ${settings.contender_fps} FPS. Fixed 1280 × 720 offscreen workload, ${settings.passes} passes. ${settings.contender_black?'Opaque black is requested across the full panel; per-run configuration records the requested surface dimensions.':'The visible contender uses a 1280 × 720 logical window.'}`;
document.querySelector('#summary').innerHTML='<table><tr><th>Run</th><th>Median ms</th><th>p99 ms</th><th>p99.9 ms</th><th>Worst ms</th><th>Over 2× budget</th><th>Wallpaper CPU p99</th></tr>'+data.runs.map(r=>{const p=r.contender.presentation_ms||{};return `<tr><td>${r.name}${r.valid?'':' (INVALID)'}</td><td>${n(p.p50)}</td><td>${n(p.p99)}</td><td>${n(p.p999)}</td><td>${n(p.max)}</td><td>${p.over_2x??'n/a'}</td><td>${n(r.cpu.p99)}%</td></tr>`}).join('')+'</table>';
const select=document.querySelector('#run');select.innerHTML=data.runs.map((r,i)=>`<option value="${i}">${r.name}</option>`).join('');
function draw(){const r=data.runs[+select.value],a=+document.querySelector('#from').value,w=+document.querySelector('#window').value;if(!r)return;const wall=document.querySelector('#trace').value==='wallpaper',points=(wall?r.wallpaper_timeline:r.timeline).filter(p=>p[0]>=a&&p[0]<=a+w);const period=wall?1000/(r.effective_wallpaper_fps_limit||data.manifest.arguments.wallpaper_fps):data.manifest.contender_period_ms;const max=points.reduce((m,p)=>Math.max(m,p[1]),25);const y=v=>280-v/max*255;document.querySelector('#chart').innerHTML=`<text x="15" y="20" fill="#bbadbd">${max.toFixed(1)} ms</text><path d="M40 ${y(period*2)}H1180" stroke="#86617d" stroke-dasharray="8 5"/><polyline points="${points.map(p=>`${40+(p[0]-a)/w*1140},${y(p[1])}`).join(' ')}" fill="none" stroke="#efa8d4" stroke-width="1.4"/>`;const cpu=r.cpu_timeline.filter(p=>p.monotonic-r.start>=a&&p.monotonic-r.start<=a+w),gpu=r.gpu_timeline.filter(p=>p.monotonic-r.start>=a&&p.monotonic-r.start<=a+w);const cap=cpu.reduce((m,p)=>Math.max(m,p.wallpaper_cpu,p.compositor_cpu,p.profiler_cpu),100);const line=(rows,key,color)=>`<polyline points="${rows.map(p=>`${40+(p.monotonic-r.start-a)/w*1140},${280-(p[key]||0)/cap*255}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`;document.querySelector('#resources').innerHTML=`<text x="15" y="20" fill="#bbadbd">${cap.toFixed(0)}%</text>`+line(cpu,'wallpaper_cpu','#efa8d4')+line(cpu,'compositor_cpu','#89b4fa')+line(cpu,'profiler_cpu','#888888')+line(gpu,'gpu_percent','#a6e3a1');document.querySelector('#detail').textContent=JSON.stringify({case:r.name,content_behavior:r.content_behavior,pause_evidence:r.pause_evidence,contender_configuration:r.contender_configuration,cpu:r.cpu,gpu:r.gpu,sampling_lateness_ms:r.sampling_lateness_ms},null,2);}
for(const id of ['run','trace','from','window'])document.getElementById(id).oninput=draw;draw();</script>""".replace(
        "PAYLOAD", payload
    )
    atomic_write(folder / "report.html", html)


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=120)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--warmup", type=float, default=10)
    parser.add_argument("--cases", default="idle,baseline,gpu,chromium")
    parser.add_argument("--passes", type=int, default=400)
    parser.add_argument("--contender-fps", type=int, default=144)
    parser.add_argument("--contender-output", default="DP-2")
    parser.add_argument(
        "--contender-black",
        action="store_true",
        help="Present opaque black across the selected output while preserving fixed offscreen GPU work",
    )
    parser.add_argument("--wallpaper-fps", type=int, default=30)
    parser.add_argument("--wallpaper-output", default="DP-2")
    parser.add_argument("--source", default="prism")
    parser.add_argument("--audio", action="store_true")
    parser.add_argument("--no-contender", action="store_true")
    parser.add_argument("--sample-hz", type=float, default=20)
    parser.add_argument("--output-dir")
    parser.add_argument("--max-gpu-temp", type=float, default=82)
    parser.add_argument("--max-cpu-temp", type=float, default=96)
    parser.add_argument("--min-vram-free-mib", type=float, default=1024)
    parser.add_argument("--min-ram-free-mib", type=float, default=8192)
    parser.add_argument("--start-cpu-temp", type=float, default=95.5)
    parser.add_argument("--start-gpu-temp", type=float, default=70)
    parser.add_argument("--cooldown", type=float, default=120)
    args = parser.parse_args(argv)
    numbers = [value for value in vars(args).values() if isinstance(value, (float, int))]
    if not all(math.isfinite(value) for value in numbers):
        parser.error("Numeric arguments must be finite")
    if (
        args.seconds < 1
        or args.repeats < 1
        or args.warmup < 2
        or not 0 <= args.sample_hz <= 100
        or not 1 <= args.contender_fps <= 360
        or not 1 <= args.wallpaper_fps <= 360
        or not 1 <= args.passes <= 10000
        or not 0 <= args.cooldown <= 120
    ):
        parser.error("Invalid duration, FPS, sample rate, pass count or cooldown")
    if (
        min(
            args.max_gpu_temp,
            args.max_cpu_temp,
            args.min_vram_free_mib,
            args.min_ram_free_mib,
            args.start_cpu_temp,
            args.start_gpu_temp,
        )
        <= 0
        or args.start_gpu_temp >= args.max_gpu_temp
        or args.start_cpu_temp >= args.max_cpu_temp
    ):
        parser.error("Positive guards and startup thresholds below abort thresholds are required")
    if not args.cases or any(not case.strip() for case in args.cases.split(",")):
        parser.error("At least one nonempty case is required")
    return args


class WallpaperFailure(RuntimeError):
    def __init__(self, message, telemetry):
        super().__init__(message)
        self.telemetry = telemetry


def guarded_ready(output, monitor, kind, seconds=20):
    deadline = time.monotonic() + seconds
    last = {}
    while time.monotonic() < deadline:
        monitor.snapshot()
        status = api("status")
        last = next((s["telemetry"] for s in status["surfaces"] if s["output"] == output), {})
        if last.get("error") or last.get("state") == "failed":
            raise WallpaperFailure("Wallpaper failed during readiness", last)
        state_ready = last and last.get("state") in (None, "ready")
        if state_ready and (
            (
                kind != "live"
                and (last.get("renderer") in ("native image", "mpv") or last.get("frames", 0) > 0)
            )
            or (
                last.get("frames", 0) > 35
                and (last.get("renderer") != "Chromium DMA-BUF" or last.get("received", 0) > 10)
            )
        ):
            return last
        monitor.wait(0.2)
    raise WallpaperFailure("Wallpaper readiness timed out", last)


def background_cpu_summary(before, after, excluded, elapsed):
    rows = []
    if elapsed <= 0:
        return rows
    for pid, value in after.items():
        previous = before.get(pid)
        if (
            pid in excluded
            or previous is None
            or value.get("start_ticks") != previous.get("start_ticks")
        ):
            continue
        percent = max(0, value["runtime"] - previous["runtime"]) / elapsed / 1e7
        if percent >= 0.1:
            rows.append({"pid": pid, "name": value["name"], "cpu_percent_one_core": percent})
    return sorted(rows, key=lambda row: row["cpu_percent_one_core"], reverse=True)


def cpu_statistics(rows, role):
    if len(rows) < 2:
        return distribution([])
    measured = rows[1:]  # Initial process counters produce a synthetic zero.
    values = [row[role + "_cpu"] for row in measured]
    result = distribution(values)
    weights = [b["monotonic"] - a["monotonic"] for a, b in zip(rows, measured)]
    result["sample_mean"] = result["mean"]
    result["mean"] = sum(w * v for w, v in zip(weights, values)) / sum(weights)
    result["mean_method"] = "time-weighted process CPU-counter deltas"
    return result


def write_resource_csv(path, rows):
    with path.open("w") as handle:
        writer = csv.writer(handle)
        writer.writerow(["monotonic", *RESOURCE_FIELDS])
        for row in rows:
            writer.writerow([row["monotonic"], *[row.get(key) for key in RESOURCE_FIELDS]])


def run_case(args, folder, name, case, daemon, hypr_pids):
    out = folder / name
    out.mkdir()
    child = log = sampler = monitor = None
    contender_settings = {}
    initial_contender_stats = {}
    stats = {}
    initial_stats = {}
    measurement_initial_stats = {}
    measurement_initial_at = None
    final_stats = {}
    final_stats_at = None
    telemetry = []
    errors = []
    start = end = None
    before_table = after_table = {}
    background_start = background_end = None
    phase = "cooldown"
    completed = False
    interrupted = False
    guard_failure = None
    kind = source_kind(args.source)
    paused = case == "paused" or case.endswith("-paused")
    engine = "gpu" if case == "paused" else case.removesuffix("-paused")
    try:
        api("clear", outputs=[args.wallpaper_output])
        monitor = SafetyMonitor(
            SafetyGuard(
                args.max_gpu_temp, args.max_cpu_temp, args.min_vram_free_mib, args.min_ram_free_mib
            )
        )
        wait_for_cooldown(monitor.snapshot, args.cooldown, args.start_cpu_temp, args.start_gpu_temp)
        phase = "readiness"
        if case != "idle":
            assign(
                args.source,
                engine,
                [args.wallpaper_output],
                fps=args.wallpaper_fps,
                audio=args.audio,
                keep_playing=True,
                trace=True,
            )
            stats = guarded_ready(args.wallpaper_output, monitor, kind)
            initial_stats = dict(stats)
            validate_renderer_policy(engine, stats)
            if (
                engine.startswith("chromium")
                and kind == "live"
                and stats.get("probe_max_scrgb", 0) <= 0
            ):
                raise WallpaperFailure("Known nonblack live scene produced black pixels", stats)
            if stats.get("presentation_clock", 1) != 1:
                raise WallpaperFailure("Unsupported wallpaper presentation clock", stats)
            if paused:
                api("pause", outputs=[args.wallpaper_output], paused=True)
        monitor.snapshot()
        if not args.no_contender:
            contender_monitor = (
                next(
                    (m for m in hypr("-j", "monitors") if m["name"] == args.contender_output),
                    None,
                )
                if args.contender_black
                else None
            )
            contender_settings = contender_config(
                out,
                args.passes,
                args.contender_fps,
                output=args.contender_output,
                black=args.contender_black,
                monitor=contender_monitor,
            )
            child, log = contender(
                out,
                args.passes,
                args.contender_fps,
                output=args.contender_output,
                black=args.contender_black,
                monitor=contender_monitor,
            )
            monitor.child = child
        phase = "warmup"
        monitor.wait(args.warmup)
        if child:
            initial_contender_stats = read_contender_telemetry(out / "contender.log")
            validate_contender_telemetry(initial_contender_stats, contender_settings)
        if case != "idle":
            current_status = api("status")
            measurement_initial_at = time.monotonic()
            measurement_initial_stats = next(
                (
                    s["telemetry"]
                    for s in current_status["surfaces"]
                    if s["output"] == args.wallpaper_output
                ),
                {},
            )
            monitor.snapshot()
            validate_renderer_policy(engine, measurement_initial_stats)
        sampler = Sampler(
            out,
            [daemon, child.pid if child else -1, *hypr_pids, os.getpid()],
            1 / args.sample_hz if args.sample_hz else 0,
            monitor=monitor,
        )
        if not sampler.prepared.wait(10):
            raise RuntimeError("CPU sampler did not initialize within ten seconds")
        if sampler.failure:
            raise RuntimeError(sampler.failure)
        before_table = processes()
        background_start = time.monotonic()
        start = time.monotonic()
        sampler.begin.set()
        phase = "measurement"
        next_status = start
        print(f"PROFILE {name}: {args.seconds}s after {args.warmup}s warmup", flush=True)
        while time.monotonic() - start < args.seconds:
            monitor.snapshot()
            if child and child.poll() is not None:
                raise RuntimeError("Contender exited during measurement")
            if sampler.failure:
                raise RuntimeError(sampler.failure)
            if args.sample_hz and time.monotonic() >= next_status:
                status = api("status")
                telemetry.append({"monotonic": time.monotonic(), "surfaces": status["surfaces"]})
                if engine == "gpu-independent-drop":
                    observed = next(
                        (
                            s["telemetry"]
                            for s in status["surfaces"]
                            if s["output"] == args.wallpaper_output
                        ),
                        {},
                    )
                    validate_renderer_policy(engine, observed)
                next_status = time.monotonic() + 1
            monitor.wait(min(0.1, max(0, args.seconds - (time.monotonic() - start))))
        end = time.monotonic()
        completed = True
        after_table = processes()
        background_end = time.monotonic()
        if case != "idle":
            final_status = api("status")
            final_stats_at = time.monotonic()
            final_stats = next(
                (
                    s["telemetry"]
                    for s in final_status["surfaces"]
                    if s["output"] == args.wallpaper_output
                ),
                {},
            )
            validate_renderer_policy(engine, final_stats)
            errors.extend(wallpaper_errors(kind, paused, measurement_initial_stats, final_stats))
            if final_stats.get("frames_file"):
                stats["frames_file"] = final_stats["frames_file"]
        monitor.snapshot()
    except (Exception, KeyboardInterrupt) as error:
        interrupted = isinstance(error, KeyboardInterrupt)
        if isinstance(error, GuardViolation):
            guard_failure = str(error)
        if isinstance(error, WallpaperFailure):
            stats.update(error.telemetry)
        errors.append(f"{phase}: {type(error).__name__}: {error or 'interrupted'}")
    finally:
        end = end if end is not None else time.monotonic()
        start = start if start is not None else end
        if sampler:
            sampler.begin.set()  # Also releases a partially prepared sampler on failure.
            sampler.stop()
            if sampler.failure:
                errors.append(sampler.failure)
        if monitor:
            monitor.stop()
            if monitor.failure and monitor.failure not in errors:
                errors.append(monitor.failure)
        if child:
            try:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=3)
            except ProcessLookupError:
                pass
            except (OSError, subprocess.TimeoutExpired) as error:
                # Retain the failed-run evidence and continue wallpaper cleanup
                # even if the contender cannot be reaped within the kill deadline.
                errors.append(f"Contender cleanup failed: {type(error).__name__}: {error}")
        if log:
            log.close()
        try:
            api("clear", outputs=[args.wallpaper_output])
        except Exception as error:
            errors.append(f"Wallpaper cleanup failed: {error}")

    # Preserve artifacts and an INVALID row even when readiness/warmup/guarding failed.
    (out / "telemetry.json").write_text(json.dumps(telemetry))
    guard_rows = monitor.rows if monitor else []
    write_resource_csv(out / "guard.csv", guard_rows)
    if not (out / "gpu.csv").exists():
        write_resource_csv(out / "gpu.csv", [])
    if not (out / "process.csv").exists():
        (out / "process.csv").write_text("monotonic,pid,name,role,cpu_percent_one_core,rss_mib\n")
    frame_file = stats.get("frames_file")
    if frame_file and Path(frame_file).exists():
        try:
            shutil.copyfile(frame_file, out / "wallpaper-frames.csv")
        except OSError as error:
            errors.append(f"Wallpaper trace copy failed: {error}")
    effective_fps = initial_stats.get("target_fps", args.wallpaper_fps)
    wall, wall_timeline = frame_summary(
        out / "wallpaper-frames.csv", start, end, 1000 / effective_fps
    )
    cont, timeline = frame_summary(
        out / "contender-frames.csv", start, end, 1000 / args.contender_fps
    )
    video_observations = (
        [(measurement_initial_at, measurement_initial_stats)]
        if measurement_initial_at is not None and measurement_initial_stats
        else []
    )
    video_observations.extend(
        (entry["monotonic"], surface["telemetry"])
        for entry in telemetry
        if start <= entry["monotonic"] <= end
        for surface in entry["surfaces"]
        if surface["output"] == args.wallpaper_output
    )
    if final_stats and final_stats_at is not None and final_stats_at - end <= 1:
        video_observations.append((final_stats_at, final_stats))
    media_progress = video_progress(
        "image" if case == "idle" else kind, paused, video_observations, wall
    )
    pause_check = pause_evidence(
        "image" if case == "idle" else kind, paused, video_observations, wall, start, end
    )
    if completed:
        errors.extend(media_progress["errors"])
        errors.extend(pause_check["errors"])
    if (
        completed
        and child
        and (
            not cont.get("last_presentation")
            or end - cont["last_presentation"] > max(0.5, 3 / args.contender_fps)
        )
    ):
        errors.append("Missing recent contender presentation")
    if completed and kind == "live" and case != "idle" and not paused:
        if frame_file and (
            not wall.get("last_presentation")
            or end - wall["last_presentation"] > max(0.5, 3 / args.wallpaper_fps)
        ):
            errors.append("Missing recent wallpaper presentation")
        tail = [entry for entry in telemetry if end - entry["monotonic"] < 5]
        counts = [
            surface["telemetry"].get("frames", 0)
            for entry in tail
            for surface in entry["surfaces"]
            if surface["output"] == args.wallpaper_output
        ]
        if len(counts) > 2 and max(counts) == min(counts):
            errors.append("Wallpaper froze during the last five seconds")
    topology = sampler.topology if sampler and hasattr(sampler, "topology") else {}
    new_processes = (
        sorted(family(after_table, [daemon]) - family(topology, [daemon])) if after_table else []
    )
    if new_processes:
        errors.append("Process membership changed")
    cpu_rows = [
        row for row in (sampler.rows if sampler else []) if start <= row["monotonic"] <= end
    ]
    gpu_rows = [row for row in guard_rows if start <= row["monotonic"] <= end]
    excluded = (
        family(before_table, [daemon, child.pid if child else -1]) | set(hypr_pids) | {os.getpid()}
    )
    background = background_cpu_summary(
        before_table,
        after_table,
        excluded,
        (background_end - background_start) if background_end and background_start else 0,
    )
    background_total = sum(row["cpu_percent_one_core"] for row in background)
    cpu_evidence = (
        sampler.evidence(start, end)
        if sampler
        else cpu_window_evidence([], start, end, 1 / args.sample_hz if args.sample_hz else 0)
    )
    roles = {
        role: cpu_statistics(cpu_rows, role)
        for role in ("wallpaper", "contender", "compositor", "profiler")
    }
    for values in roles.values():
        values["evidence_status"] = cpu_evidence["status"]
        if not cpu_evidence["mean_valid"]:
            values["mean"] = None
        if not cpu_evidence["tails_valid"]:
            for key in ("p50", "p95", "p99", "p999", "max", "sample_mean"):
                values[key] = None
    return {
        "valid": completed and not errors,
        "completed": completed,
        "errors": list(dict.fromkeys(errors)),
        "phase": phase,
        "interrupted": interrupted,
        "valid_process_membership": not new_processes,
        "unexpected_processes": new_processes,
        "name": name,
        "start": start,
        "end": end,
        "measured_seconds": end - start,
        "requested_wallpaper_fps": args.wallpaper_fps,
        "effective_wallpaper_fps_limit": effective_fps,
        "initial_telemetry": initial_stats,
        "measurement_initial_telemetry": measurement_initial_stats,
        "final_telemetry": final_stats,
        "initial_contender_telemetry": initial_contender_stats,
        "contender_configuration": contender_settings,
        "video_progress": media_progress,
        "pause_evidence": pause_check,
        "content_behavior": (
            "idle"
            if case == "idle"
            else "retained_static" if kind == "image" else "paused" if paused else "animated"
        ),
        "contender": cont,
        "wallpaper": wall,
        "cpu": roles["wallpaper"],
        "cpu_by_role": roles,
        "cpu_evidence": cpu_evidence,
        "gpu": distribution([row["gpu_percent"] for row in gpu_rows if "gpu_percent" in row]),
        "resources": {
            key: distribution([row[key] for row in gpu_rows if key in row])
            for key in RESOURCE_FIELDS
        },
        "guard_failure": guard_failure or (monitor.failure if monitor else None),
        "guard_observations": len(guard_rows),
        "background_cpu": background[:20],
        "background_cpu_total_percent_one_core": background_total,
        "background_activity_flag": background_total > 50,
        "pointer": pointer_summary(telemetry),
        "process_topology": topology,
        "sampling_lateness_ms": distribution(sampler.lateness if sampler else [], duration=True),
        "timeline": timeline,
        "wallpaper_timeline": wall_timeline,
        "cpu_timeline": cpu_rows,
        "gpu_timeline": gpu_rows,
    }


def main(argv=None):
    args = parse_args(argv)
    load_controls()
    folder = (
        Path(args.output_dir)
        if args.output_dir
        else ROOT / "verification" / f"profile-{int(time.time())}"
    )
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / "report.json").exists():
        raise RuntimeError(f"Refusing to overwrite an existing report: {folder}")
    table = processes()
    hypr_pids = [pid for pid, value in table.items() if value["name"] == "Hyprland"]
    source = source_evidence(args.source)
    manifest = {
        "arguments": vars(args),
        "monitors": hypr("-j", "monitors"),
        "contender_mode": (
            "disabled"
            if args.no_contender
            else (
                "black synthetic GPU contender"
                if args.contender_black
                else "visible synthetic GPU contender"
            )
        ),
        "contender_workload": {
            "producer_width": 1280,
            "producer_height": 720,
            "offscreen_passes": args.passes,
            "black_output": args.contender_black,
            "surface_geometry": (
                "Full selected output" if args.contender_black else "1280 x 720 logical pixels"
            ),
            "geometry_limit": "Per-run contender_configuration records requested logical and pixel dimensions. The presenter reports actual configured buffers; fractional output scale may be compositor-resampled.",
        },
        "contender_period_ms": 1000 / args.contender_fps,
        "wallpaper_period_ms": 1000 / args.wallpaper_fps,
        "scanout": f"Contender output {args.contender_output}; wallpaper output {args.wallpaper_output}. Resolve physical/virtual output and adapter from monitor/renderer evidence; no 4K physical scanout is implied.",
        "gpu_utilization_limit": "NVML native utilization windows are approximately 1/6–1 second. Safety/resources poll at 4Hz even with sample-hz=0; GPU memory_percent is memory activity, vram_* fields are allocation.",
        "cpu_counter": f"Linux process clocks, {args.sample_hz:g}Hz with per-PID elapsed intervals and raw clock evidence; includes exited threads within sampled processes. Membership frozen after warmup; short-lived newly spawned children may escape accounting.",
        "cpu_frequency_limit": "scaling_cur_freq logical-policy min/mean/max sampled at 1Hz; descriptive OS frequency values, not per-process executed clocks or proof of thermal throttling.",
        "background_cpu_limit": "Two /proc snapshots per run estimate average CPU of surviving other processes, excluding measured families/compositor/profiler. Activity above 50% of one core is flagged, not automatically invalidated; short-lived background processes can be missed.",
        "feedback_clock": "CLOCK_MONOTONIC actual presentation timestamps. Per-output event counts define FPS. A sequence gap >=2 is not inherently late when target FPS is below physical refresh.",
        "pause_evidence_limit": "Paused dynamic cases require periodic and boundary pause flags, stopped native counters/trace work, and fresh browser heartbeat reports with stable host scene events and observed video positions. Unknown evidence invalidates the pause comparison. A paused-only 1 Hz browser report timer contributes to measured paused cost; rAF/OSR callbacks, arbitrary JS/CSS animation, decoder activity and pixel stillness are not equated with these observations. Retained static images do not require continuing presentation.",
        "video_evidence_limit": "Playback positions and optional browser total-minus-dropped video frame counters establish observable playback, not compositor FPS or decoder counts. Native CSV media events count libmpv render-update submissions. Unsupported evidence stays unavailable; event-driven images are exempt.",
        "guard_policy": {
            "resource_max_age_seconds": RESOURCE_MAX_AGE_SECONDS,
            "cpu_sustained_seconds": 3,
            "cpu_start_c": args.start_cpu_temp,
            "gpu_start_c": args.start_gpu_temp,
            "max_cpu_c": args.max_cpu_temp,
            "max_gpu_c": args.max_gpu_temp,
            "min_vram_free_mib": args.min_vram_free_mib,
            "min_ram_available_mib": args.min_ram_free_mib,
            "cooldown_max_seconds": args.cooldown,
            "note": "CPU boosting near 95C is normal for this 7950X; the default 96C sustained threshold is an anomaly guard.",
        },
        "source_sha256": source["sha256"],
        "source_evidence": source,
        "binary_sha256": hashlib.sha256((ROOT / "lab/build/presenter").read_bytes()).hexdigest(),
        "producer_sha256": hashlib.sha256((ROOT / "lab/electron.cjs").read_bytes()).hexdigest(),
        "daemon_sha256": hashlib.sha256(
            (ROOT / "target/release/wallpaperdb-native").read_bytes()
        ).hexdigest(),
        "profiler_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "runtime_sha256": hashlib.sha256((ROOT / "runtime/wallpaper.js").read_bytes()).hexdigest(),
        "baseline_processes": [
            value | {"pid": pid}
            for pid, value in table.items()
            if value["name"] in ("Hyprland", "swww-daemon", "mpvpaper")
        ],
    }
    runs = []
    write_report(folder, manifest, runs)
    failed = False
    with saved_assignments() as original:
        windows = [
            window for window in hypr("-j", "clients") if window["class"] == "wallpaperdb-native"
        ]
        manifest["closed_library_for_measurement"] = bool(windows)
        for window in windows:
            hypr("dispatch", "closewindow", "address:" + window["address"])
        owned = sorted({output for group in original["groups"] for output in group["outputs"]})
        manifest["original_assignments"] = original["groups"]
        if owned:
            api("clear", outputs=owned)
        with socket.socket(socket.AF_UNIX) as connection:
            connection.connect(str(CONTROL))
            daemon = struct.unpack(
                "3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            )[0]
        for repeat in range(args.repeats):
            cases = [case.strip() for case in args.cases.split(",")]
            if repeat % 2:
                cases.reverse()
            for case in cases:
                name = f"{repeat + 1}-{case}"
                row = run_case(args, folder, name, case, daemon, hypr_pids)
                runs.append(row)
                write_report(folder, manifest, runs)
                print(
                    json.dumps(
                        {
                            "run": name,
                            "valid": row["valid"],
                            "errors": row["errors"],
                            "contender": row["contender"],
                            "wallpaper": row["wallpaper"],
                            "cpu": row["cpu"],
                        }
                    ),
                    flush=True,
                )
                if not row["valid"]:
                    failed = True
                    break
            if failed:
                break
    print(folder / "report.html", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
