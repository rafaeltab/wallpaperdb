"""Read-only host/cgroup observations for the isolated favorite performance run."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import time


def read_text(filename):
    try:
        return filename.read_text().strip()
    except (FileNotFoundError, PermissionError) as error:
        return {"error": type(error).__name__}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--interval", type=float, default=1)
    parser.add_argument("--samples", type=int, default=0)
    parser.add_argument("--max-seconds", type=float, default=21600)
    args = parser.parse_args()
    if args.pid <= 0 or args.interval <= 0 or args.samples < 0 or args.max_seconds <= 0:
        parser.error("PID, interval and duration must be positive; samples nonnegative")
    proc = Path("/proc") / str(args.pid)
    line = next(line for line in (proc / "cgroup").read_text().splitlines() if line.startswith("0::"))
    group = Path("/sys/fs/cgroup") / line[3:].lstrip("/")
    if not (group / "cpu.stat").is_file():
        raise RuntimeError("Expected readable cgroup v2 CPU statistics")
    args.directory.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).read_bytes()
    metadata = {
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pid": args.pid, "cgroup": str(group), "intervalSeconds": args.interval,
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "limitations": [
            "Read-only kernel counters; sampled memory is not an instantaneous peak.",
            "memory.peak is the cgroup lifetime peak, not a reset per query block.",
            "Counters include all activity in this isolated container, including indexing and merges.",
            "Host pressure may reflect unrelated applications on this shared machine.",
        ],
    }
    # Refuse accidental overwrites of prior observations or their source.
    with (args.directory / "observer-source.py").open("xb") as stream:
        stream.write(source)
    with (args.directory / "observer.json").open("x") as stream:
        json.dump(metadata, stream, indent=2)
    count = 0
    started = time.monotonic()
    reason = "duration limit"
    print(json.dumps({"observerStarted": str(args.directory), "pid": args.pid}), flush=True)
    with (args.directory / "resources.jsonl").open("x") as stream:
        try:
            while True:
                row = {
                    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "elapsedSeconds": time.monotonic() - started,
                    "cgroup": {name: read_text(group / name) for name in [
                        "cpu.stat", "cpu.max", "cpu.pressure", "memory.current", "memory.peak",
                        "memory.max", "memory.swap.current", "memory.events", "memory.stat",
                        "memory.pressure", "io.stat", "io.pressure",
                    ]},
                    "processMemory": {line.split(":", 1)[0]: line.split(":", 1)[1].strip()
                        for line in (proc / "status").read_text().splitlines()
                        if line.startswith(("VmRSS:", "VmHWM:", "VmSwap:", "RssAnon:", "RssFile:"))},
                    "hostMeminfo": read_text(Path("/proc/meminfo")),
                    "hostPressure": {name: read_text(Path("/proc/pressure") / name)
                        for name in ["cpu", "memory", "io"]},
                }
                stream.write(json.dumps(row) + "\n")
                stream.flush()
                count += 1
                if (args.directory / "STOP").exists():
                    reason = "requested stop"
                    break
                if args.samples and count >= args.samples:
                    reason = "sample limit"
                    break
                if time.monotonic() - started >= args.max_seconds:
                    break
                time.sleep(args.interval)
        except KeyboardInterrupt:
            reason = "interrupted"
        except FileNotFoundError:
            reason = "observed process ended"
    completion = {"finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "samples": count, "elapsedSeconds": time.monotonic() - started, "reason": reason}
    with (args.directory / "completion.json").open("x") as stream:
        json.dump(completion, stream, indent=2)
    print(json.dumps(completion), flush=True)


if __name__ == "__main__":
    main()
