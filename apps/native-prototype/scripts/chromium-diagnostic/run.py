"""Explicit, isolated bitmap Chromium diagnostic. No monitor or assignment changes."""

import argparse
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

TERMINATION_SIGNALS = (signal.SIGINT, signal.SIGTERM)


@contextlib.contextmanager
def termination_cleanup():
    """First signal requests cleanup; later signals cannot interrupt the bounded drain."""
    previous = {sig: signal.getsignal(sig) for sig in TERMINATION_SIGNALS}
    state = {"signal": None, "defer": False, "spawning": False}

    def interrupt(signum, _frame):
        if state["signal"] is not None:
            return
        # During Popen keep caught dispositions: the new exec must not inherit
        # SIG_IGN. Repeated signals return until the child handle is published.
        if not state["spawning"]:
            for sig in TERMINATION_SIGNALS:
                signal.signal(sig, signal.SIG_IGN)
        state["signal"] = signal.Signals(signum).name
        if not state["defer"]:
            raise KeyboardInterrupt(state["signal"])

    try:
        for sig in TERMINATION_SIGNALS:
            signal.signal(sig, interrupt)
        yield state
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def wait_child(child, deadline):
    """Observe without reaping, pinning the session leader's PID until group drain."""
    while True:
        result = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        if result is not None:
            return result.si_status if result.si_code == os.CLD_EXITED else -result.si_status
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(child.args, 20)
        time.sleep(min(0.05, remaining))


def assert_owned_group(child):
    """Same WNOWAIT ownership proof used by scripts/stress.py."""
    try:
        os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError as error:
        raise RuntimeError(
            "Diagnostic leader is no longer waitable; refusing group signal"
        ) from error
    if os.getpgid(child.pid) != child.pid or os.getsid(child.pid) != child.pid:
        raise RuntimeError("Diagnostic leader left its owned session; refusing group signal")


def owned_group_members(child):
    assert_owned_group(child)
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


def stop_child(child, hard_deadline):
    if child is None:
        return {"drained": True, "signals": []}
    if child.returncode is not None:
        raise RuntimeError("Diagnostic leader was reaped before owned-group cleanup")
    signals = []
    assert_owned_group(child)
    # At the hard deadline, signal before the /proc membership scan so scanning
    # cannot become an extra grace period for Chromium's asynchronous flush.
    killed = time.monotonic() >= hard_deadline
    kill_sent = None
    if killed:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGKILL)
        signals.append("SIGKILL")
        kill_sent = time.monotonic()
    members = owned_group_members(child)
    # A short graceful stop may flush inside the original 20-second budget only.
    if members and not killed and time.monotonic() < hard_deadline:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGTERM)
        signals.append("SIGTERM")
        grace_end = min(hard_deadline, time.monotonic() + 0.5)
        while members and time.monotonic() < grace_end:
            time.sleep(min(0.025, max(0, grace_end - time.monotonic())))
            members = owned_group_members(child)
    if members:
        # No asynchronous trace flushing or graceful wait is allowed past deadline.
        if not killed:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGKILL)
            signals.append("SIGKILL")
            kill_sent = time.monotonic()
        drain_end = kill_sent + 1.0
        while members and time.monotonic() < drain_end:
            members = owned_group_members(child)
            if members:
                time.sleep(min(0.025, max(0, drain_end - time.monotonic())))
        if members:
            raise RuntimeError(f"Owned diagnostic processes survived SIGKILL: {members}")
    # Only now may Popen reap the leader. There are no later killpg calls.
    child.wait(timeout=0.1)
    return {"drained": True, "signals": signals}


def write_manifest(path, value):
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, indent=2, default=str) + "\n")
    temporary.replace(path)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def main(interruption):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", required=True, type=Path)
    parser.add_argument(
        "--config", required=True, type=Path, help="Reviewed existing presenter configuration"
    )
    parser.add_argument(
        "--evidence-root",
        required=True,
        type=Path,
        help="Complete local scene bundle, including shared assets",
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--electron", default="electron42")
    parser.add_argument("--seconds", type=float, default=12)
    parser.add_argument(
        "--run", action="store_true", help="Explicitly launch the isolated diagnostic"
    )
    args = parser.parse_args()
    if not 1 <= args.seconds <= 15:
        parser.error("Trace window must be 1–15 seconds; subprocess deadline is 20 seconds")
    build, output = args.build_dir.resolve(), args.output_dir.resolve()
    if output.exists():
        parser.error("Output directory must not already exist")
    if len(str(output / "producer.sock").encode()) >= 104:
        parser.error("Choose a shorter local output path for the Unix socket")
    config = json.loads(args.config.read_text())
    if config.get("experiment") != "chromium":
        parser.error("This bounded diagnostic targets the measured bitmap-copy Chromium path")
    if not isinstance(config.get("outputs"), list) or len(config["outputs"]) != 1:
        parser.error("Use one explicitly selected existing output")
    if not 1 <= float(config.get("fps", 0)) <= 360:
        parser.error("Configuration FPS must be within the existing 1–360 application limit")
    if not (1 <= int(config.get("width", 0)) <= 3840 and 1 <= int(config.get("height", 0)) <= 2160):
        parser.error("Canvas must be no larger than 3840×2160")
    source = Path(config["source"])
    if not source.is_absolute():
        source = args.config.resolve().parent / source
    source = source.resolve()
    evidence = args.evidence_root.resolve()
    if not source.is_file() or not source.is_relative_to(evidence):
        parser.error("Source must be a local file inside the complete evidence root")
    required = [
        build / "lab/build/presenter",
        build / "lab/build/dmabuf.node",
        build / "lab/electron.cjs",
        build / "lab/diagnostic.cjs",
        build / "lab/diagnostic.h",
        build / "runtime/wallpaper.js",
        build / "lab/presenter.c",
        build / "lab/pacing.h",
        build / "lab/dmabuf.c",
        build / "lab/Makefile",
        build / "lab/protocols/wlr-layer-shell.xml",
        build / "source-provenance.json",
    ]
    if not all(path.is_file() for path in required):
        parser.error("Prepare and explicitly build the isolated lab first")
    executable = shutil.which(args.electron)
    if not executable:
        parser.error("Electron executable was not found; nothing is installed automatically")
    if not args.run:
        print(
            json.dumps(
                {
                    "diagnostic_only": True,
                    "would_launch": executable,
                    "output": config["outputs"],
                    "canvas": [config["width"], config["height"]],
                    "requested_fps": config["fps"],
                    "trace_seconds": args.seconds,
                    "deadline_seconds": 20,
                    "trace_buffer_mib": 32,
                    "message": "Add --run only after comparison captures have stopped",
                },
                indent=2,
            )
        )
        return
    files = [path for path in evidence.rglob("*") if path.is_file()]
    if len(files) > 256 or sum(path.stat().st_size for path in files) > 128 * 1024**2:
        parser.error("Evidence bundle exceeds this diagnostic's bounded hashing scope")
    os.umask(0o077)
    output.mkdir(parents=True, mode=0o700)
    manifest = {
        "diagnostic_only": True,
        "comparison_capture": False,
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "arguments": vars(args)
        | {
            "build_dir": str(build),
            "config": str(args.config.resolve()),
            "evidence_root": str(evidence),
            "output_dir": str(output),
        },
        "launcher_path": executable,
        "limits": {
            "trace_buffer_kib": 32768,
            "js_event_bytes": 32768 * 5 * 8,
            "native_event_bytes_expected": 32768 * 32,
            "subprocess_deadline_seconds": 20,
            "grace_seconds_within_deadline": 0.5,
            "post_sigkill_drain_seconds": 1,
        },
        "note": "Trace buffers are bounded; this is not a limit on total Electron process RSS. Launcher may be a distribution wrapper; process.versions records the running Electron/Chromium versions.",
        "result": "incomplete",
        "phase": "preparing",
        "errors": [],
    }
    manifest_path = output / "provenance.json"
    child = None
    began = deadline = None
    code = None
    timed_out = False
    try:
        write_manifest(manifest_path, manifest)
        config.update(
            source=str(source),
            socket=str(output / "producer.sock"),
            frames=str(output / "presentations.csv"),
        )
        config_path = output / "config.json"
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        manifest.update(
            source_provenance=json.loads((build / "source-provenance.json").read_text()),
            actual_files={str(path.relative_to(build)): digest(path) for path in required},
            scene_files={str(path.relative_to(evidence)): digest(path) for path in sorted(files)},
            launcher_sha256=digest(Path(executable)),
        )
        write_manifest(manifest_path, manifest)
        env = os.environ | {
            "WDB_CHROMIUM_DIAG_DIR": str(output),
            "WDB_CHROMIUM_DIAG_SECONDS": str(args.seconds),
        }
        env.pop("ELECTRON_RUN_AS_NODE", None)
        command = [
            executable,
            "--ozone-platform=wayland",
            str(build / "lab/electron.cjs"),
            str(config_path),
        ]
        with (output / "telemetry.ndjson").open("w") as stdout, (output / "stderr.log").open(
            "w"
        ) as stderr:
            manifest["phase"] = "launching"
            began = time.monotonic()
            deadline = began + 20
            # Publish ownership before a first signal can raise from Popen's return
            # boundary. Caught signal handlers reset on exec; no blocked mask is inherited.
            interruption["defer"] = True
            interruption["spawning"] = True
            try:
                child = subprocess.Popen(
                    command,
                    stdin=subprocess.PIPE,
                    stdout=stdout,
                    stderr=stderr,
                    env=env,
                    start_new_session=True,
                )
            finally:
                interruption["spawning"] = False
                interruption["defer"] = False
            if interruption["signal"]:
                for sig in TERMINATION_SIGNALS:
                    signal.signal(sig, signal.SIG_IGN)
                raise KeyboardInterrupt(interruption["signal"])
            manifest.update(phase="recording_or_flushing", child_pid=child.pid)
            # Keep stdin open. Only waitid(WNOWAIT) observes completion here.
            code = wait_child(child, deadline)
    except subprocess.TimeoutExpired as error:
        timed_out = True
        manifest["errors"].append(f"20-second process deadline: {error}")
    except (Exception, KeyboardInterrupt) as error:
        manifest["errors"].append(f"{manifest['phase']}: {type(error).__name__}: {error}")
    finally:
        # A first signal during cleanup is recorded but deferred; later signals
        # stay ignored until ownership has drained and the manifest is finalized.
        interruption["defer"] = True
        if interruption["signal"]:
            for sig in TERMINATION_SIGNALS:
                signal.signal(sig, signal.SIG_IGN)
        try:
            try:
                manifest["cleanup"] = stop_child(child, deadline or time.monotonic())
            except Exception as error:
                manifest["errors"].append(f"cleanup: {type(error).__name__}: {error}")
                manifest["cleanup"] = {"drained": False}
            finally:
                if child is not None and child.stdin is not None:
                    try:
                        child.stdin.close()
                    except OSError as error:
                        manifest["errors"].append(f"stdin close: {error}")
            manifest.update(
                returncode=child.returncode if child is not None else code,
                observed_leader_exitcode=code,
                wall_seconds=time.monotonic() - began if began is not None else None,
                deadline_reached=timed_out,
                interrupted=bool(interruption["signal"]),
                interrupt_signal=interruption["signal"],
            )
            expected = [
                "producer-diagnostic.json",
                "presenter-diagnostic.json",
                "chromium-trace.json",
                "producer-stages.csv",
                "presenter-stages.csv",
            ]
            missing = [name for name in expected if not (output / name).is_file()]
            manifest["missing_artifacts"] = missing
            try:
                producer = (
                    json.loads((output / "producer-diagnostic.json").read_text())
                    if not missing
                    else {}
                )
                elapsed = (
                    producer.get("stop_requested_us", 0) - producer.get("start_requested_us", 0)
                ) / 1e6
                manifest["observed_trace_request_seconds"] = elapsed
                if (
                    manifest["returncode"] == 0
                    and not timed_out
                    and not missing
                    and not manifest["errors"]
                    and not interruption["signal"]
                    and manifest["cleanup"]["drained"]
                    and producer.get("trace_flushed")
                    and 0 < elapsed <= 20
                ):
                    manifest["result"] = "complete"
            except (OSError, ValueError, TypeError) as error:
                manifest["errors"].append(f"artifact inspection: {type(error).__name__}: {error}")
        finally:
            manifest.update(
                interrupted=bool(interruption["signal"]), interrupt_signal=interruption["signal"]
            )
            if interruption["signal"]:
                manifest["result"] = "incomplete"
            manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()
            manifest["phase"] = "finished"
            write_manifest(manifest_path, manifest)
            interruption["defer"] = False
    print(f"Diagnostic {manifest['result']}: {output}")
    raise SystemExit(0 if manifest["result"] == "complete" else 1)


if __name__ == "__main__":
    with termination_cleanup() as interruption:
        main(interruption)
