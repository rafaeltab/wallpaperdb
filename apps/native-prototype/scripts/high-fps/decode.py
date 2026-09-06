"""Opt-in diagnostic; no player, display surface, encoder, or existing-process control.

Reuses the repository's guarded fixture child runner; --run explicitly starts work.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import runpy
import shutil
import sys
import time
from types import SimpleNamespace


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def background_identity(pid):
    if pid is None:
        return None
    try:
        text = Path(f"/proc/{pid}/stat").read_text()
        fields = text.rsplit(")", 1)[1].split()
        return {
            "pid": pid,
            "name": text.split("(", 1)[1].rsplit(")", 1)[0],
            "start_ticks": int(fields[19]),
            "cpu_ticks": int(fields[11]) + int(fields[12]),
        }
    except (FileNotFoundError, ProcessLookupError):
        return None


def ffmpeg_command(movie, fps, mode, folder):
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "info",
        "-nostdin",
        "-nostats",
        "-xerror",
        "-benchmark",
        "-stats_period",
        "0.5",
        "-progress",
        "pipe:1",
        "-threads",
        "4",
        "-err_detect",
        "explode",
    ]
    if mode.startswith("nvdec"):
        command += ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]
    else:
        command += ["-hwaccel", "none"]
    command += [
        "-c:v",
        "h264",
        "-i",
        str(movie),
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-dn",
        "-fps_mode",
        "passthrough",
        "-threads",
        "4",
        "-filter_threads",
        "4",
    ]
    if mode == "nvdec-null":
        command += ["-c:v", "wrapped_avframe", "-f", "null", "-"]
    else:
        if mode == "nvdec-hash":
            command += ["-vf", "hwdownload,format=nv12,format=yuv420p"]
        command += [
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "rawvideo",
            "-hash",
            "sha256",
            "-f",
            "framehash",
            str(folder / f"{fps}-{mode}.framehash"),
        ]
    return command


def parse_progress(text):
    record = {}
    completed = []
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        record[key] = value.strip()
        if key == "progress":
            completed.append(record)
            record = {}
    if not completed or completed[-1].get("progress") != "end":
        raise RuntimeError("No complete final FFmpeg progress record")
    last = completed[-1]
    if int(last.get("dup_frames", "0")) or int(last.get("drop_frames", "0")):
        raise RuntimeError("Output frame duplication/dropping makes cardinality ambiguous")
    return {"final": last, "records": completed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prototype-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--rates", nargs="+", choices=[120, 360], type=int, default=[120, 360])
    parser.add_argument(
        "--mode", choices=["nvdec-null", "software-hash", "nvdec-hash"], default="nvdec-null"
    )
    parser.add_argument("--deadline", type=int, choices=range(10, 121), default=60)
    parser.add_argument(
        "--preserved-pid",
        type=int,
        help="Optionally record an existing background process identity without controlling it",
    )
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    root = args.prototype_root.resolve()
    evidence = args.output_dir.resolve()
    generator_path = root / "scripts/high-fps/generate.py"
    profile_path = root / "scripts/profile.py"
    commands = []
    files = {}
    for fps in dict.fromkeys(args.rates):
        movie = root / f"examples/stress-studio/background-4k-{fps}fps.mp4"
        sidecar_path = movie.with_suffix(".fixture.json")
        sidecar = json.loads(sidecar_path.read_text())
        actual_hash = digest(movie)
        if sidecar.get("result") != "complete" or actual_hash != sidecar.get("file", {}).get(
            "sha256"
        ):
            raise RuntimeError(f"Fixture completion/hash mismatch: {movie.name}")
        if sidecar.get("requested", {}).get("fps") != fps:
            raise RuntimeError(f"Fixture requested rate mismatch: {movie.name}")
        files[str(fps)] = {
            "path": str(movie),
            "sha256": actual_hash,
            "expected_frames": fps * 8,
            "duration_seconds": 8,
            "sidecar_sha256": digest(sidecar_path),
        }
        commands.append((fps, ffmpeg_command(movie, fps, args.mode, evidence)))
    plan = {
        "schema": 1,
        "status": "plan_only",
        "mode": args.mode,
        "commands": [{"fps": fps, "argv": command} for fps, command in commands],
        "fixtures": files,
        "deadline_seconds": args.deadline,
        "scope": "Decode throughput/cardinality with the existing background unchanged; no rendering, scanout, frame pacing, or exclusive-device claim.",
        "limits": {
            "affinity_logical_cpus": 4,
            "threads": 4,
            "max_file_mib": 100,
            "gpu_c": 82,
            "cpu_c_sustained_3s": 96,
            "min_free_vram_mib": 1024,
            "min_available_ram_mib": 8192,
            "initial_gpu_c": 70,
            "initial_cpu_c": 95.5,
        },
        "preserved_pid": args.preserved_pid,
    }
    if not args.run:
        print(json.dumps(plan, indent=2))
        return
    if evidence.exists():
        parser.error("Output directory exists; use a fresh path")
    if not shutil.which("ffmpeg"):
        parser.error("ffmpeg unavailable")
    evidence.mkdir(parents=True, mode=0o700)
    sys.path.insert(0, str(root / "scripts"))
    generator = SimpleNamespace(**runpy.run_path(str(generator_path)))
    profile = SimpleNamespace(**runpy.run_path(str(profile_path)))
    plan["provenance"] = {
        "diagnostic_sha256": digest(Path(__file__)),
        "runner_sha256": digest(generator_path),
        "bounded_child_sha256": digest(generator_path.with_name("bounded-child.py")),
        "guard_sha256": digest(profile_path),
    }
    plan["status"] = "incomplete"
    plan["planned_commands"] = plan.pop("commands")
    plan["commands"] = []
    plan["results"] = []
    plan["started_utc"] = datetime.now(timezone.utc).isoformat()
    plan["background_before"] = background_identity(args.preserved_pid)
    monitor = None
    began = time.monotonic()
    with generator.interruption_cleanup() as interruption:
        try:
            monitor = profile.SafetyMonitor(profile.SafetyGuard())
            runner = generator.Runner(monitor, evidence, began + args.deadline, interruption, plan)
            initial = monitor.snapshot()
            if initial["temperature_c"] > 70 or initial["cpu_temperature_c"] > 95.5:
                raise RuntimeError("Initial temperature gate exceeded; no workload started")
            plan["initial_resource"] = initial
            runner.check()
            plan["ffmpeg_version"] = runner.run(
                "version", ["ffmpeg", "-version"], evidence
            ).splitlines()[0]
            baseline_end = time.monotonic() + 3
            while time.monotonic() < baseline_end:
                runner.check()
                time.sleep(0.05)
            plan["baseline_end_monotonic"] = time.monotonic()
            for fps, command in commands:
                name = f"{fps}-{args.mode}"
                started = time.monotonic()
                output = runner.run(name, command, evidence)
                finished = time.monotonic()
                progress = parse_progress(output)
                actual_frames = int(progress["final"]["frame"])
                if actual_frames != files[str(fps)]["expected_frames"]:
                    raise RuntimeError(f"{name}: {actual_frames} frames, expected {fps * 8}")
                stderr = (evidence / f"{name}.stderr").read_text()
                if args.mode == "nvdec-null" and not re.search(
                    r"Video: wrapped_avframe[^\n]*\bcuda\b", stderr
                ):
                    raise RuntimeError("NVDEC diagnostic did not prove GPU-resident CUDA output")
                bench = re.search(
                    r"bench: utime=([0-9.]+)s stime=([0-9.]+)s rtime=([0-9.]+)s", stderr
                )
                result = {
                    "fps": fps,
                    "decoded_output_frames": actual_frames,
                    "expected_frames": fps * 8,
                    "started_monotonic": started,
                    "finished_monotonic": finished,
                    "outer_wall_seconds": finished - started,
                    "outer_frames_per_second_including_startup": actual_frames
                    / (finished - started),
                    "progress": progress,
                    "stderr": f"{name}.stderr",
                }
                if bench:
                    user, system, real = map(float, bench.groups())
                    result["ffmpeg_benchmark"] = {
                        "user_seconds": user,
                        "system_seconds": system,
                        "real_seconds": real,
                        "frames_per_second": actual_frames / real if real else None,
                    }
                plan["results"].append(result)
                generator.write_json(evidence / "decode.json", plan)
            runner.check()
            for fixture in files.values():
                if digest(Path(fixture["path"])) != fixture["sha256"]:
                    raise RuntimeError("Fixture changed during decode diagnostic")
            monitor.stop()
            if monitor.failure:
                raise RuntimeError(monitor.failure)
            plan["status"] = "complete"
        except (Exception, KeyboardInterrupt) as error:
            interruption["defer"] = True
            plan["error"] = f"{type(error).__name__}: {error}"
            raise
        finally:
            interruption["defer"] = True
            if monitor:
                monitor.stop()
                generator.write_json(evidence / "guard.json", monitor.rows)
                if monitor.failure:
                    plan["guard_error"] = monitor.failure
                    plan["status"] = "incomplete"
            plan["background_after"] = background_identity(args.preserved_pid)
            before, after = plan["background_before"], plan["background_after"]
            plan["preserved_pid_identity_matches"] = (
                bool(before and after and before["start_ticks"] == after["start_ticks"])
                if args.preserved_pid is not None
                else None
            )
            plan["elapsed_seconds"] = time.monotonic() - began
            plan["finished_utc"] = datetime.now(timezone.utc).isoformat()
            generator.write_json(evidence / "decode.json", plan)
    print(json.dumps({"status": plan["status"], "evidence": str(evidence)}, indent=2))


if __name__ == "__main__":
    main()
