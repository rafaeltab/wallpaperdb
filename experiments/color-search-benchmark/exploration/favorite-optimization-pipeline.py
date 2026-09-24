"""Run a fixed list of Make experiments serially and preserve each result/log.

This driver performs no search, scoring, or indexing itself. A persistent user
systemd unit runs it so a conversation interruption cannot kill a measurement.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    plan_bytes = args.plan.read_bytes()
    plan = json.loads(plan_bytes)
    phases = plan["phases"]
    if not phases or len({phase["id"] for phase in phases}) != len(phases):
        raise ValueError("Require unique, nonempty phases")
    for phase in phases:
        if not phase["target"].startswith("color-") or "/" in phase["id"]:
            raise ValueError("Only color experiment Make targets are allowed")
    args.directory.mkdir(parents=True, exist_ok=False)
    (args.directory / "plan.json").write_bytes(plan_bytes)
    (args.directory / "pipeline-source.py").write_bytes(Path(__file__).read_bytes())
    state = {"startedAt": now(), "planSha256": hashlib.sha256(plan_bytes).hexdigest(), "phases": []}

    def save():
        temporary = args.directory / "status.json.tmp"
        temporary.write_text(json.dumps(state, indent=2))
        temporary.replace(args.directory / "status.json")

    save()
    for phase in phases:
        if args.plan.read_bytes() != plan_bytes:
            raise RuntimeError("Pipeline plan changed while running")
        command = ["make", phase["target"], *[key + "=" + value for key, value in phase.get("variables", {}).items()]]
        row = {"id": phase["id"], "startedAt": now(), "command": command}
        state["phases"].append(row)
        save()
        print(json.dumps({"started": phase["id"], "at": row["startedAt"]}), flush=True)
        with (args.directory / (phase["id"] + ".log")).open("xb") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=False)
        row.update({"finishedAt": now(), "exitCode": result.returncode})
        save()
        print(json.dumps({"finished": phase["id"], "exitCode": result.returncode}), flush=True)
        if result.returncode:
            state["stoppedAt"] = now()
            save()
            raise SystemExit(result.returncode)
    state["finishedAt"] = now()
    save()


if __name__ == "__main__":
    main()
