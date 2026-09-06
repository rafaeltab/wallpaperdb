"""Optional guarded orchestration for the isolated Chromium trace diagnostic.

--run is required for any desktop/GPU action. Uses the
existing assignment, virtual-output, configuration and resource-guard helpers.
Never removes the separate OLED cover or changes a physical output's mode/HDR.
Diagnostic artifacts must remain outside all performance comparison aggregates.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from types import SimpleNamespace


HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OwnedLoads:
    """Non-reaping SafetyMonitor adapter; ownership checks and reaping share a lock."""

    def __init__(self, diagnostic):
        self.diagnostic = diagnostic
        self.original_stop = diagnostic.stop_child
        self.lock = threading.RLock()
        self.children = {}

    def register(self, child):
        with self.lock:
            self.children[child.pid] = child
        return child

    def poll(self):
        # SafetyMonitor must never Popen.poll() and reap a reserved session leader.
        # The guarded foreground loop separately checks unexpected process exits.
        return None

    def terminate(self):
        with self.lock:
            for child in self.children.values():
                self.diagnostic.assert_owned_group(child)
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass

    def stop(self, child, deadline):
        if child is None:
            return {"drained": True, "signals": []}
        with self.lock:
            result = self.original_stop(child, deadline)
            if result["drained"]:
                self.children.pop(child.pid, None)
            return result

    def remaining(self):
        with self.lock:
            return list(self.children.values())


def leader_exit(child):
    result = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    if result is None:
        return None
    return result.si_status if result.si_code == os.CLD_EXITED else -result.si_status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd() / "apps/native-prototype")
    parser.add_argument("--build-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--output-name", default="WDB-TRACE")
    parser.add_argument("--seconds", type=float, default=12)
    parser.add_argument("--black-contender", action="store_true")
    parser.add_argument("--contender-output", default="DP-5")
    parser.add_argument("--contender-fps", type=int, default=360)
    parser.add_argument("--passes", type=int, default=100)
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 15:
        parser.error(
            "Trace duration must be 1–15 seconds; the existing runner enforces its 20-second process deadline"
        )
    if not 1 <= args.contender_fps <= 360 or not 1 <= args.passes <= 1200:
        parser.error("Contender target must be 1–360 FPS and 1–1200 passes")
    root, build, output = args.root.resolve(), args.build_dir.resolve(), args.output_dir.resolve()
    if output.exists() or len(str(output / "trace/producer.sock").encode()) >= 104:
        parser.error("Use a new, short local output path (for example /tmp/wdb-trace-guard-01)")
    for path in (
        root / "scripts/profile.py",
        root / "scripts/stress.py",
        root / "scripts/lab_common.py",
        build / "example-config.json",
        HERE / "run.py",
    ):
        if not path.is_file():
            parser.error(f"Required reviewed source/configuration missing: {path}")
    required_build = [
        "lab/build/presenter",
        "lab/build/dmabuf.node",
        "lab/electron.cjs",
        "lab/diagnostic.cjs",
        "lab/diagnostic.h",
        "runtime/wallpaper.js",
        "lab/presenter.c",
        "lab/pacing.h",
        "lab/dmabuf.c",
        "lab/Makefile",
        "lab/protocols/wlr-layer-shell.xml",
        "source-provenance.json",
    ]
    if not all((build / name).is_file() for name in required_build):
        parser.error(
            "Prepare, review and build the isolated diagnostic copy before using this harness"
        )
    if args.black_contender and not (root / "lab/build/presenter").is_file():
        parser.error("The reviewed native black-contender helper is missing")
    config = json.loads((build / "example-config.json").read_text())
    if (
        config.get("experiment") != "chromium"
        or config.get("width") != 3840
        or config.get("height") != 2160
    ):
        parser.error("This harness requires the reviewed 3840×2160 Chromium bitmap configuration")
    config["outputs"] = [
        {
            "name": args.output_name,
            "width": 3840,
            "height": 2160,
            "pixel_width": 3840,
            "pixel_height": 2160,
            "crop_x": 0,
            "crop_y": 0,
        }
    ]
    description = {
        "diagnostic_only": True,
        "comparison_capture": False,
        "virtual_output": args.output_name,
        "canvas": [3840, 2160],
        "trace_seconds": args.seconds,
        "trace_process_deadline_seconds": 20,
        "black_contender": args.black_contender,
        "contender_output": args.contender_output,
        "contender_fps": args.contender_fps,
        "passes": args.passes,
        "note": "No separate cover removal, physical-mode/HDR changes, UI launch, or screenshot. Guarded diagnostic cost is not comparison CPU/FPS.",
    }
    if not args.run:
        print(json.dumps(description, indent=2))
        return 0

    # Load only at the explicit execution boundary. Imports launch no renderer.
    sys.path.insert(0, str(root / "scripts"))
    common = load("trace_lab_common", root / "scripts/lab_common.py")
    profile = load("trace_wallpaper_profile", root / "scripts/profile.py")
    stress = load("trace_wallpaper_stress", root / "scripts/stress.py")
    diagnostic = load("trace_diagnostic_runner", HERE / "run.py")
    # This is a private imported module: forbid saved_assignments() from falling
    # back to ensure()'s automatic UI/controller bootstrap if the daemon exits.
    common.ensure = lambda: common.api("status")
    profile.ENV = common.ENV
    os.environ.update(common.ENV)
    common.api("status")  # Require the existing controller; do not bootstrap a UI.
    os.umask(0o077)
    output.mkdir(parents=True, mode=0o700)
    manifest = description | {
        "result": "incomplete",
        "errors": [],
        "cleanup": [],
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "arguments": vars(args),
        "orchestration_sha256": {
            str(path): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (
                Path(__file__),
                root / "scripts/profile.py",
                root / "scripts/stress.py",
                root / "scripts/lab_common.py",
                HERE / "run.py",
            )
        },
    }
    monitor = None
    black = None
    black_log = None
    loads = OwnedLoads(diagnostic)
    diagnostic.stop_child = loads.stop
    real_popen = subprocess.Popen

    def registered_spawn(*positional, **keywords):
        child = loads.register(real_popen(*positional, **keywords))
        if monitor is not None and monitor.failure:
            loads.terminate()
        return child

    # Only the copied runner sees this wrapper; avoid replacing subprocess.Popen
    # globally, which would also affect read-only compositor control commands.
    diagnostic.subprocess = SimpleNamespace(
        Popen=registered_spawn, PIPE=subprocess.PIPE, TimeoutExpired=subprocess.TimeoutExpired
    )

    def checked_wait(child, deadline):
        while True:
            monitor.snapshot()
            if black is not None and leader_exit(black) is not None:
                raise RuntimeError("Owned black contender exited during diagnostic")
            code = leader_exit(child)
            if code is not None:
                return code
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(child.args, 20)
            time.sleep(min(0.05, remaining))

    diagnostic.wait_child = checked_wait

    def publish():
        profile.atomic_write(
            output / "guarded-provenance.json", json.dumps(manifest, indent=2, default=str) + "\n"
        )

    with diagnostic.termination_cleanup() as interruption:
        try:
            publish()
            with common.saved_assignments() as original:
                manifest["original_assignments"] = original["groups"]
                owned = sorted({name for group in original["groups"] for name in group["outputs"]})
                if owned:
                    common.api("clear", outputs=owned)
                monitor = profile.SafetyMonitor(profile.SafetyGuard())
                profile.wait_for_cooldown(monitor.snapshot, seconds=120)
                with stress.virtual_output(args.output_name, 360) as virtual:
                    manifest["virtual_monitor"] = virtual
                    try:
                        if args.black_contender:
                            physical = next(
                                (
                                    m
                                    for m in common.hypr("-j", "monitors")
                                    if m["name"] == args.contender_output
                                ),
                                None,
                            )
                            if physical is None or args.contender_output == args.output_name:
                                raise RuntimeError(
                                    "Selected physical contender output is unavailable or equals the diagnostic output"
                                )
                            contender_dir = output / "contender"
                            contender_dir.mkdir()
                            settings = profile.contender_config(
                                contender_dir,
                                args.passes,
                                args.contender_fps,
                                output=args.contender_output,
                                black=True,
                                monitor=physical,
                            )
                            config_path = contender_dir / "contender.json"
                            config_path.write_text(json.dumps(settings, indent=2) + "\n")
                            black_log = (contender_dir / "contender.log").open("w")
                            monitor.snapshot()
                            interruption.update(defer=True, spawning=True)
                            try:
                                black = registered_spawn(
                                    [str(root / "lab/build/presenter"), str(config_path)],
                                    stdin=subprocess.PIPE,
                                    stdout=black_log,
                                    stderr=black_log,
                                    env=common.ENV,
                                    start_new_session=True,
                                )
                            finally:
                                interruption.update(defer=False, spawning=False)
                            if interruption["signal"]:
                                raise KeyboardInterrupt(interruption["signal"])
                            monitor.child = loads
                            ready_deadline = time.monotonic() + 8
                            while True:
                                monitor.snapshot()
                                if leader_exit(black) is not None:
                                    raise RuntimeError("Black contender exited before readiness")
                                try:
                                    stats = profile.read_contender_telemetry(
                                        contender_dir / "contender.log"
                                    )
                                except RuntimeError:
                                    stats = {}
                                if stats.get("state") == "ready":
                                    profile.validate_contender_telemetry(stats, settings)
                                    break
                                if stats.get("error") or time.monotonic() >= ready_deadline:
                                    raise RuntimeError(
                                        f"Black contender did not become ready: {stats}"
                                    )
                                monitor.wait(0.1)
                            manifest.update(
                                contender_configuration=settings,
                                initial_contender_telemetry=stats,
                                contender_monitor=physical,
                                contender_binary_sha256=hashlib.sha256(
                                    (root / "lab/build/presenter").read_bytes()
                                ).hexdigest(),
                            )
                            monitor.wait(2)
                        monitor.snapshot()
                        monitor.child = loads
                        config_path = output / "trace-config.json"
                        config_path.write_text(json.dumps(config, indent=2) + "\n")
                        publish()
                        before_argv = sys.argv
                        sys.argv = [
                            str(HERE / "run.py"),
                            "--build-dir",
                            str(build),
                            "--config",
                            str(config_path),
                            "--evidence-root",
                            str(root / "examples/stress-studio"),
                            "--output-dir",
                            str(output / "trace"),
                            "--seconds",
                            str(args.seconds),
                            "--run",
                        ]
                        try:
                            try:
                                diagnostic.main(interruption)
                            except SystemExit as status:
                                manifest["trace_exitcode"] = status.code
                                if status.code != 0:
                                    raise RuntimeError(
                                        f"Isolated trace was incomplete (exit {status.code}); inspect trace/provenance.json"
                                    )
                        finally:
                            sys.argv = before_argv
                        monitor.snapshot()
                        stats = profile.read_contender_telemetry(output / "trace/telemetry.ndjson")
                        if (
                            stats.get("state") != "ready"
                            or stats.get("error")
                            or "NVIDIA" not in stats.get("adapter", "")
                            or stats.get("presentation_clock") != 1
                            or stats.get("frames", 0) <= 35
                            or stats.get("probe_max_scrgb", 0) <= 0
                        ):
                            raise RuntimeError(
                                "Diagnostic lacks ready nonblack NVIDIA renderer evidence"
                            )
                        manifest["final_diagnostic_telemetry"] = stats
                        manifest["recording_complete"] = True
                    finally:
                        interruption["defer"] = True
                        for child in loads.remaining():
                            try:
                                manifest["cleanup"].append(
                                    {"pid": child.pid, **loads.stop(child, time.monotonic() + 0.5)}
                                )
                            except Exception as error:
                                manifest["errors"].append(f"Owned load cleanup failed: {error}")
                            finally:
                                if child.stdin is not None:
                                    try:
                                        child.stdin.close()
                                    except OSError as error:
                                        manifest["errors"].append(
                                            f"Owned load stdin close failed: {error}"
                                        )
                        if black_log is not None:
                            try:
                                black_log.close()
                            except OSError as error:
                                manifest["errors"].append(
                                    f"Black contender log close failed: {error}"
                                )
            manifest["assignments_restored"] = True
            manifest["virtual_output_removed"] = True
            if (
                manifest.get("recording_complete")
                and not manifest["errors"]
                and not loads.remaining()
            ):
                manifest["result"] = "complete"
        except (Exception, KeyboardInterrupt) as error:
            manifest["errors"].append(f"{type(error).__name__}: {error}")
        finally:
            interruption["defer"] = True
            if monitor is not None:
                monitor.stop()
                profile.write_resource_csv(output / "guard.csv", monitor.rows)
                manifest["guard_observations"] = len(monitor.rows)
                manifest["guard_failure"] = monitor.failure
                if monitor.failure:
                    manifest["errors"].append(monitor.failure)
            manifest["interrupted"] = bool(interruption["signal"])
            if manifest["errors"] or interruption["signal"] or loads.remaining():
                manifest["result"] = "incomplete"
            manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()
            publish()
    print(output / "guarded-provenance.json")
    return 0 if manifest["result"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
