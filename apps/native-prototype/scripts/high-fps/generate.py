"""Opt-in, guarded 4K120/360 NVENC fixtures; existing 4K60 assets are read-only.

No workload runs without --run. The 180-second deadline includes preflight,
rasterization, encoding and demux-only verification. This proposal is Linux-only.
"""

import argparse
import contextlib
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace


HERE = Path(__file__).resolve().parent
MIB = 1024 * 1024
SIGNALS = (signal.SIGINT, signal.SIGTERM)
LEGACY = ("background-4k.mp4", "background-4k.png", "fixture.json")


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


@contextlib.contextmanager
def interruption_cleanup():
    previous = {sig: signal.getsignal(sig) for sig in SIGNALS}
    state = {"signal": None, "defer": False, "spawning": False}

    def interrupt(signum, _frame):
        if state["signal"] is not None:
            return
        state["signal"] = signal.Signals(signum).name
        if not state["spawning"]:
            for sig in SIGNALS:
                signal.signal(sig, signal.SIG_IGN)
        if not state["defer"]:
            raise KeyboardInterrupt(state["signal"])

    try:
        for sig in SIGNALS:
            signal.signal(sig, interrupt)
        yield state
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def owned_members(child):
    # Keep the leader waitable until its owned session is drained. There is no
    # killpg after Popen.wait(), and no monitor is given permission to reap it.
    try:
        os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError as error:
        raise RuntimeError("Fixture leader was reaped before group cleanup") from error
    if os.getpgid(child.pid) != child.pid or os.getsid(child.pid) != child.pid:
        raise RuntimeError("Fixture process left its owned session")
    members = []
    for path in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = path.read_text().rsplit(")", 1)[1].split()
            if (
                fields[0] not in ("Z", "X")
                and int(fields[2]) == child.pid
                and int(fields[3]) == child.pid
            ):
                members.append(int(path.parent.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return members


def kill_owned(child):
    # This short-lived encoder has no useful graceful flush after a failure:
    # incomplete media must never be published. Kill before the membership scan.
    os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    if os.getpgid(child.pid) != child.pid or os.getsid(child.pid) != child.pid:
        raise RuntimeError("Refusing to signal an unowned fixture process group")
    with contextlib.suppress(ProcessLookupError):
        os.killpg(child.pid, signal.SIGKILL)
    deadline = time.monotonic() + 1
    while members := owned_members(child):
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Fixture processes survived SIGKILL: {members}")
        time.sleep(0.02)
    child.wait(timeout=0.1)


class Runner:
    def __init__(self, monitor, evidence, deadline, interruption, manifest):
        self.monitor = monitor
        self.evidence = evidence
        self.deadline = deadline
        self.interruption = interruption
        self.manifest = manifest

    def check(self):
        if self.interruption["signal"]:
            raise KeyboardInterrupt(self.interruption["signal"])
        if time.monotonic() >= self.deadline:
            raise TimeoutError("Fixture's total 180-second work deadline exceeded")
        self.monitor.snapshot()

    def run(self, name, command, cwd):
        self.check()
        output = self.evidence / (name + ".stdout")
        errors = self.evidence / (name + ".stderr")
        record = {"name": name, "argv": command, "status": "incomplete"}
        self.manifest["commands"].append(record)
        child = None
        started = time.monotonic()
        with output.open("wb") as stdout, errors.open("wb") as stderr:
            try:
                # Do not inherit ignored signals across a Popen interrupted
                # before publishing its handle. Replay that first signal after.
                self.interruption["defer"] = True
                self.interruption["spawning"] = True
                try:
                    child = subprocess.Popen(
                        [sys.executable, str(HERE / "bounded-child.py"), *command],
                        cwd=cwd,
                        stdin=subprocess.DEVNULL,
                        stdout=stdout,
                        stderr=stderr,
                        start_new_session=True,
                    )
                finally:
                    self.interruption["spawning"] = False
                    self.interruption["defer"] = False
                if self.interruption["signal"]:
                    for sig in SIGNALS:
                        signal.signal(sig, signal.SIG_IGN)
                    raise KeyboardInterrupt(self.interruption["signal"])
                while True:
                    self.check()
                    state = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                    if state is not None:
                        code = (
                            state.si_status if state.si_code == os.CLD_EXITED else -state.si_status
                        )
                        record["returncode"] = code
                        if code:
                            raise RuntimeError(
                                f"{name} failed with status {code}; see {errors.name}"
                            )
                        record["status"] = "complete"
                        break
                    time.sleep(min(0.05, max(0, self.deadline - time.monotonic())))
            finally:
                self.interruption["defer"] = True
                try:
                    if child is not None:
                        # Even successful leaders remain waitable until all
                        # same-session descendants are gone; then reap once.
                        if time.monotonic() >= self.deadline:
                            kill_owned(child)
                        elif owned_members(child):
                            kill_owned(child)
                        else:
                            child.wait(timeout=0.1)
                finally:
                    record["elapsed_seconds"] = time.monotonic() - started
                    self.interruption["defer"] = False
        self.check()
        if output.stat().st_size > 2 * MIB or errors.stat().st_size > 2 * MIB:
            raise RuntimeError(f"Unexpectedly large tool output from {name}")
        return output.read_text()


def media_commands(assets, fps, video):
    crop = "crop=3840:2160:x='128+96*sin(2*PI*t/8)':y='72+48*cos(2*PI*t/8)':exact=1"
    counter = "drawtext=fontfile=counter-font.ttf:textfile=counter.txt:expansion=normal:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.9:boxborderw=12:x=48:y=48"
    return [
        (
            "raster",
            [
                "rsvg-convert",
                "--width",
                "4096",
                "--height",
                "2304",
                "-o",
                "source.png",
                "source.svg",
            ],
        ),
        (
            "encode",
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-nostdin",
                "-y",
                "-threads",
                "4",
                "-loop",
                "1",
                "-framerate",
                str(fps),
                "-i",
                "source.png",
                "-filter_threads",
                "4",
                "-vf",
                crop
                + ","
                + counter
                + ",scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p",
                "-an",
                "-sn",
                "-dn",
                "-frames:v",
                str(fps * 8),
                "-t",
                "8",
                "-r",
                str(fps),
                *assets.encoder_options("h264_nvenc"),
                "-gpu",
                "0",
                "-threads",
                "4",
                "-g",
                str(fps * 2),
                "-pix_fmt",
                "yuv420p",
                "-color_primaries",
                "bt709",
                "-colorspace",
                "bt709",
                "-color_trc",
                "13",
                "-color_range",
                "tv",
                "-bsf:v",
                assets.COLOR_FILTER,
                "-movflags",
                "+faststart",
                "-fs",
                str(99 * MIB),
                video,
            ],
        ),
        (
            "probe",
            [
                "ffprobe",
                "-v",
                "error",
                "-threads",
                "4",
                "-select_streams",
                "v:0",
                "-count_packets",
                "-show_packets",
                "-show_entries",
                "stream=codec_name,profile,level,width,height,pix_fmt,avg_frame_rate,r_frame_rate,nb_frames,nb_read_packets,duration,time_base,color_space,color_transfer,color_primaries,color_range:packet=pts,duration,size,flags",
                "-of",
                "json",
                video,
            ],
        ),
    ]


def verify(probe, fps):
    streams = probe.get("streams", [])
    if len(streams) != 1:
        raise RuntimeError("Expected one selected video stream")
    stream = streams[0]
    frames = fps * 8
    expected = {
        "codec_name": "h264",
        "width": 3840,
        "height": 2160,
        "pix_fmt": "yuv420p",
        "color_primaries": "bt709",
        "color_transfer": "iec61966-2-1",
        "color_space": "bt709",
        "color_range": "tv",
    }
    if any(stream.get(key) != value for key, value in expected.items()):
        raise RuntimeError(f"Encoded format differs from the requested fixture: {stream}")
    if (
        Fraction(stream.get("avg_frame_rate", "0")) != fps
        or Fraction(stream.get("r_frame_rate", "0")) != fps
        or int(stream.get("nb_frames", 0)) != frames
        or int(stream.get("nb_read_packets", 0)) != frames
        or abs(float(stream.get("duration", 0)) - 8) > 0.02
        or not isinstance(stream.get("level"), int)
        or stream["level"] <= 0
    ):
        raise RuntimeError(f"Encoded frame rate, count, duration or level is invalid: {stream}")
    packets = probe.get("packets", [])
    tick = Fraction(stream["time_base"])
    timestamps = sorted(int(packet["pts"]) * tick for packet in packets)
    if len(timestamps) != frames or any(
        stamp != Fraction(index, fps) for index, stamp in enumerate(timestamps)
    ):
        raise RuntimeError(
            "Encoded presentation timestamps do not contain every requested frame slot"
        )
    if any(int(packet.get("duration", 0)) * tick != Fraction(1, fps) for packet in packets):
        raise RuntimeError("Encoded packet durations do not match the requested frame period")
    return {
        "probe": stream,
        "packets": {
            "count": len(packets),
            "first_pts_seconds": float(timestamps[0]),
            "last_pts_seconds": float(timestamps[-1]),
            "period_seconds": 1 / fps,
            "all_presentation_slots_verified": True,
        },
        "verification_scope": "MP4 sample count plus demuxed H.264 packet count and every presentation timestamp; no full decoded-pixel comparison or real-time decode guarantee",
    }


def main(interruption):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prototype-root", required=True, type=Path)
    parser.add_argument("--fps", type=int, required=True, choices=[120, 360])
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Defaults to examples/stress-studio; never overwrites any file",
    )
    parser.add_argument(
        "--evidence-dir",
        required=True,
        type=Path,
        help="New local directory for logs, raw probe and failed attempts",
    )
    parser.add_argument(
        "--font", type=Path, help="Optional explicit font; otherwise fc-match resolves monospace"
    )
    parser.add_argument(
        "--run",
        action="store_true",
        help="Actually rasterize and encode, only at a coordinated capture boundary",
    )
    args = parser.parse_args()
    root = args.prototype_root.resolve()
    sys.path.insert(0, str(root / "scripts"))
    output = (args.output_dir or root / "examples/stress-studio").resolve()
    evidence = args.evidence_dir.resolve()
    assets_source = root / "scripts/stress-assets.py"
    profile_source = root / "scripts/profile.py"
    # Both trusted source files have __main__ guards. run_path avoids writing
    # __pycache__ next to the active sources and never invokes their CLIs.
    assets = SimpleNamespace(**runpy.run_path(str(assets_source)))
    video = f"background-4k-{args.fps}fps.mp4"
    metadata = f"background-4k-{args.fps}fps.fixture.json"
    plan = {
        "schema": 1,
        "result": "incomplete",
        "fixture": video,
        "metadata": metadata,
        "requested": {
            "width": 3840,
            "height": 2160,
            "fps": args.fps,
            "frames": args.fps * 8,
            "duration_seconds": 8,
            "encoder": "h264_nvenc",
            "gpu_index": 0,
            "gop_frames": args.fps * 2,
        },
        "limits": {
            "work_deadline_seconds": 180,
            "max_video_bytes": 100 * MIB,
            "ffmpeg_fs_bytes": 99 * MIB,
            "ffmpeg_threads": 4,
            "max_affinity_cpus": 4,
            "gpu_temperature_c": 82,
            "cpu_temperature_c": 96,
            "cpu_hot_grace_seconds": 3,
            "min_vram_free_mib": 1024,
            "min_ram_available_mib": 8192,
            "start_gpu_temperature_c": 70,
            "start_cpu_temperature_c": 95.5,
        },
        "source": "Original seeded 4096×2304 vector raster, integer-pixel crop to 3840×2160, no upscaling; frame counter is composited at each requested input timestamp",
        "seed": assets.SEED,
        "color": "SDR BT.709 primaries/matrix, sRGB transfer (13), limited-range YUV420P",
        "counter": {"text": "FRAME %{n}", "font_size": 56, "position": [48, 48], "required": True},
        "commands": [],
        "provenance": {
            "generator_sha256": digest(Path(__file__)),
            "bounded_child_sha256": digest(HERE / "bounded-child.py"),
            "artwork_generator_sha256": digest(assets_source),
            "guard_source_sha256": digest(profile_source),
        },
        "comparability": "New high-rate encoded sources, not an unchanged 4K60 fixture played at a higher requested rate. Same artwork and encoder controls across the two new rates; two-second GOP, per-frame counter and temporal sampling differ from the legacy fixture.",
    }
    if not args.run:
        plan["result"] = "plan_only"
        plan["commands"] = [
            {"name": name, "argv": command}
            for name, command in media_commands(assets, args.fps, video)
        ]
        print(json.dumps(plan, indent=2))
        return
    if evidence.exists():
        parser.error("Evidence directory already exists; use a new path")
    if any((output / name).exists() for name in (video, metadata)):
        parser.error("Fixture or metadata already exists; refusing to overwrite")
    for tool in ["ffmpeg", "ffprobe", "rsvg-convert"] + ([] if args.font else ["fc-match"]):
        if not shutil.which(tool):
            parser.error(f"Required tool missing: {tool}")
    output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < 512 * MIB:
        parser.error("At least 512 MiB free disk space is required")
    evidence.mkdir(parents=True, mode=0o700)
    started = time.monotonic()
    deadline = started + 180
    plan["started_utc"] = datetime.now(timezone.utc).isoformat()
    write_json(evidence / "generation.json", plan)
    monitor = None
    published = []
    try:
        profile = SimpleNamespace(**runpy.run_path(str(profile_source)))
        monitor = profile.SafetyMonitor(profile.SafetyGuard())
        runner = Runner(monitor, evidence, deadline, interruption, plan)
        initial = monitor.snapshot()
        if initial["temperature_c"] > 70 or initial["cpu_temperature_c"] > 95.5:
            raise RuntimeError(
                "Initial temperature exceeds generation start gate; wait for a separate boundary"
            )
        plan["legacy_before"] = {
            name: digest(root / "examples/stress-studio" / name)
            for name in LEGACY
            if (root / "examples/stress-studio" / name).is_file()
        }
        plan["versions"] = {}
        with tempfile.TemporaryDirectory(prefix=f".high-fps-{args.fps}-", dir=output) as temporary:
            scratch = Path(temporary)
            for tool in ["ffmpeg", "ffprobe"]:
                version = runner.run(tool + "-version", [tool, "-version"], scratch)
                plan["versions"][tool] = version.splitlines()[0]
            filters = runner.run("filters", ["ffmpeg", "-hide_banner", "-filters"], scratch)
            if not any(" drawtext " in line for line in filters.splitlines()):
                raise RuntimeError(
                    "This FFmpeg has no drawtext filter; no counter-free fallback is generated"
                )
            encoders = runner.run("encoders", ["ffmpeg", "-hide_banner", "-encoders"], scratch)
            if not any(" h264_nvenc " in line for line in encoders.splitlines()):
                raise RuntimeError(
                    "This FFmpeg has no h264_nvenc; no software fallback is generated"
                )
            font = (
                args.font.resolve()
                if args.font
                else Path(
                    runner.run(
                        "font", ["fc-match", "-f", "%{file}\n", "monospace"], scratch
                    ).splitlines()[0]
                )
            )
            if not font.is_file() or font.stat().st_size > 16 * MIB:
                raise RuntimeError("The selected font is unavailable or exceeds 16 MiB")
            shutil.copyfile(font, scratch / "counter-font.ttf")
            plan["counter"]["font"] = {"file": font.name, "sha256": digest(font)}
            (scratch / "counter.txt").write_text("FRAME %{n}")
            (scratch / "source.svg").write_text(assets.artwork())
            shutil.copyfile(scratch / "source.svg", evidence / "source.svg")
            plan["provenance"]["source_svg_sha256"] = digest(scratch / "source.svg")
            raw_probe = None
            for name, command in media_commands(assets, args.fps, video):
                response = runner.run(name, command, scratch)
                if name == "raster":
                    plan["provenance"]["source_raster_sha256"] = digest(scratch / "source.png")
                if name == "probe":
                    raw_probe = json.loads(response)
            plan["validation"] = verify(raw_probe, args.fps)
            movie = scratch / video
            if not 0 < movie.stat().st_size <= 100 * MIB:
                raise RuntimeError("Encoded file exceeds the 100 MiB cap or is empty")
            plan["file"] = {"name": video, "bytes": movie.stat().st_size, "sha256": digest(movie)}
            plan["legacy_after"] = {
                name: digest(root / "examples/stress-studio" / name)
                for name in plan["legacy_before"]
            }
            if plan["legacy_before"] != plan["legacy_after"]:
                raise RuntimeError("Legacy asset changed during generation; refusing to publish")
            runner.check()
            monitor.stop()
            if monitor.failure:
                raise RuntimeError(f"Resource monitor failed: {monitor.failure}")
            if interruption["signal"]:
                raise KeyboardInterrupt(interruption["signal"])
            # Hard-link publication is atomic and fails if a target appeared in
            # the meantime. No replacement of existing files is possible.
            os.link(movie, output / video)
            published.append(output / video)
            plan["result"] = "complete"
            plan["elapsed_seconds"] = time.monotonic() - started
            plan["finished_utc"] = datetime.now(timezone.utc).isoformat()
            (scratch / metadata).write_text(json.dumps(plan, indent=2) + "\n")
            os.link(scratch / metadata, output / metadata)
            published.append(output / metadata)
    except (Exception, KeyboardInterrupt) as error:
        interruption["defer"] = True
        plan["result"] = "incomplete"
        plan["error"] = f"{type(error).__name__}: {error}"
        for path in reversed(published):
            path.unlink(missing_ok=True)
        raise
    finally:
        interruption["defer"] = True
        if monitor:
            monitor.stop()
            write_json(evidence / "guard.json", monitor.rows)
            if monitor.failure:
                plan["guard_error"] = monitor.failure
        plan["elapsed_seconds"] = time.monotonic() - started
        plan["finished_utc"] = datetime.now(timezone.utc).isoformat()
        write_json(evidence / "generation.json", plan)
        interruption["defer"] = False
    print(
        json.dumps(
            {
                "result": plan["result"],
                "video": str(output / video),
                "metadata": str(output / metadata),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    with interruption_cleanup() as state:
        main(state)
