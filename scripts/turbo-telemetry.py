"""Collect completed Turbo run summaries without exporting commands or inputs."""

import argparse
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

BOUNDS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600]
PREFIX = "wallpaperdb.turbo."


def duration(execution):
    if not isinstance(execution, dict):
        return None
    start, end = execution.get("startTime"), execution.get("endTime")
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in (start, end)):
        return None
    return (end - start) / 1000 if end >= start else None


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER);
            CREATE TABLE IF NOT EXISTS series (
                name TEXT, attributes TEXT, count INTEGER, total REAL,
                buckets TEXT, initialized INTEGER DEFAULT 0,
                PRIMARY KEY (name, attributes)
            );
        """)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO metadata VALUES ('start_ns', ?)", (time.time_ns(),))
        self.start_ns = self.db.execute("SELECT value FROM metadata WHERE key = 'start_ns'").fetchone()[0]

    def close(self):
        self.db.close()

    def observe(self, name, attributes, value=None):
        attributes = json.dumps(attributes, sort_keys=True)
        row = self.db.execute(
            "SELECT count, total, buckets FROM series WHERE name = ? AND attributes = ?",
            (name, attributes),
        ).fetchone()
        count, total, buckets = row if row else (0, 0, json.dumps([0] * (len(BOUNDS) + 1)))
        buckets = json.loads(buckets)
        if value is not None:
            buckets[next((i for i, bound in enumerate(BOUNDS) if value <= bound), len(BOUNDS))] += 1
        self.db.execute("""
            INSERT INTO series (name, attributes, count, total, buckets) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name, attributes) DO UPDATE SET
                count = excluded.count, total = excluded.total, buckets = excluded.buckets
        """, (name, attributes, count + 1, total + (value or 0), json.dumps(buckets)))

    def ingest(self, summary):
        if not isinstance(summary, dict) or summary.get("version") != "1":
            return False
        run_id, execution = summary.get("id"), summary.get("execution")
        run_duration = duration(execution)
        if not isinstance(run_id, str) or not run_id or run_duration is None:
            return False
        tasks = summary.get("tasks")
        if not isinstance(tasks, list):
            return False
        with self.db:
            if not self.db.execute("INSERT OR IGNORE INTO runs VALUES (?)", (run_id,)).rowcount:
                return False
            attributes = {"outcome": "success" if execution.get("exitCode") == 0 else "failure"}
            self.observe("runs", attributes)
            self.observe("run.duration", attributes, run_duration)
            for task in tasks:
                task_duration = duration(task.get("execution")) if isinstance(task, dict) else None
                if task_duration is None or not all(isinstance(task.get(key), str) for key in ("task", "package")):
                    continue
                cache = task.get("cache")
                cache = cache if isinstance(cache, dict) else {}
                attributes = {
                    "package": task["package"], "task": task["task"],
                    "cache_status": "hit" if cache.get("status") == "HIT" else "miss",
                    "cache_source": "local" if cache.get("local") else "remote" if cache.get("remote") else "none",
                }
                self.observe("tasks", attributes)
                self.observe("task.duration", attributes, task_duration)
        return True

    def payload(self, now_ns=None, bootstrap=False):
        now_ns = now_ns or time.time_ns()
        metrics = {}
        for name, attributes, count, total, buckets, initialized in self.db.execute("SELECT * FROM series ORDER BY name, attributes"):
            histogram = name.endswith(".duration")
            if bootstrap and not initialized:
                count, total, buckets = 0, 0, json.dumps([0] * (len(BOUNDS) + 1))
            point = {
                "attributes": [{"key": key, "value": {"stringValue": value}} for key, value in json.loads(attributes).items()],
                "startTimeUnixNano": str(self.start_ns), "timeUnixNano": str(now_ns),
            }
            if histogram:
                point.update(count=str(count), sum=total, explicitBounds=BOUNDS,
                             bucketCounts=[str(value) for value in json.loads(buckets)])
            else:
                point["asInt"] = str(count)
            kind = "histogram" if histogram else "sum"
            if name not in metrics:
                data = {"aggregationTemporality": 2, "dataPoints": []}
                if not histogram:
                    data["isMonotonic"] = True
                metrics[name] = {"name": PREFIX + name, "unit": "s" if histogram else "1", kind: data}
            metrics[name][kind]["dataPoints"].append(point)
        metrics["heartbeat"] = {
            "name": PREFIX + "collector.heartbeat", "unit": "s",
            "gauge": {"dataPoints": [{"timeUnixNano": str(now_ns), "asDouble": now_ns / 1e9}]},
        }
        return {"resourceMetrics": [{
            "resource": {"attributes": [
                {"key": "service.name", "value": {"stringValue": "wallpaperdb-turbo"}},
                {"key": "host.name", "value": {"stringValue": socket.gethostname()}},
            ]},
            "scopeMetrics": [{"scope": {"name": "wallpaperdb.turbo", "version": "1"}, "metrics": list(metrics.values())}],
        }]}

    def exported(self):
        with self.db:
            self.db.execute("UPDATE series SET initialized = 1")


def scan(store, worktrees, since_ms=0, seen=None):
    seen = seen if seen is not None else {}
    present = set()
    for worktree in worktrees:
        for path in (Path(worktree) / ".turbo/runs").glob("*.json"):
            present.add(path)
            try:
                stat = path.stat()
                fingerprint = (stat.st_mtime_ns, stat.st_size)
                if stat.st_mtime_ns < since_ms * 1_000_000 or seen.get(path) == fingerprint:
                    continue
                if stat.st_size > 64 * 1024 * 1024:
                    print("Turbo summary exceeds 64 MiB; skipping.", file=sys.stderr, flush=True)
                    continue
                store.ingest(json.loads(path.read_text()))
                seen[path] = fingerprint
            except (OSError, ValueError, TypeError):
                # Turbo may still be writing a summary, or a worktree may disappear.
                continue
    for path in set(seen) - present:
        del seen[path]


def worktrees(git_dir):
    result = subprocess.run(
        ["git", "--git-dir", str(git_dir), "worktree", "list", "--porcelain", "-z"],
        check=True, capture_output=True, text=True, timeout=10,
    )
    return [Path(item.removeprefix("worktree ")) for item in result.stdout.split("\0") if item.startswith("worktree ")]


def export(payload, endpoint):
    request = urllib.request.Request(
        endpoint, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        body = json.loads(response.read() or "{}")
        if int(body.get("partialSuccess", {}).get("rejectedDataPoints", 0)):
            raise ValueError("collector rejected metric points")


def collect(git_dir, state, endpoint, interval):
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state / "collector.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        store = Store(state / "state.sqlite")
        seen = {}
        stopping = False

        def stop(_signum, _frame):
            nonlocal stopping
            stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        try:
            while not stopping:
                try:
                    scan(store, worktrees(git_dir), store.start_ns // 1_000_000, seen)
                    export(store.payload(bootstrap=True), endpoint)
                    store.exported()
                except (OSError, ValueError, subprocess.SubprocessError):
                    print("Turbo telemetry collection/export failed; cumulative state retained for retry.", file=sys.stderr, flush=True)
                for _ in range(max(1, int(interval * 10))):
                    if stopping:
                        break
                    time.sleep(0.1)
        finally:
            store.close()


def install(root, endpoint, user_directory=None):
    git_dir = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=root, check=True, capture_output=True, text=True, timeout=10,
    ).stdout.strip()
    identity = hashlib.sha256(git_dir.encode()).hexdigest()[:12]
    home = user_directory or Path.home()
    directory = home / ".local/share/wallpaperdb/turbo-telemetry" / identity
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    program = directory / "turbo-telemetry.py"
    shutil.copyfile(Path(__file__), program)
    source = directory / "env.sh"
    source.write_text(
        f'if [ "$(git -C "$WALLPAPERDB_TURBO_CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = {shlex.quote(git_dir)} ]; then\n'
        '  export TURBO_RUN_SUMMARY="${TURBO_RUN_SUMMARY:-true}"\nfi\n'
        'unset WALLPAPERDB_TURBO_CWD\n'
    )
    fragment = home / ".config/mise/conf.d" / f"wallpaperdb-turbo-{identity}.toml"
    fragment.parent.mkdir(parents=True, exist_ok=True)
    fragment.write_text('[env]\nWALLPAPERDB_TURBO_CWD = "{{ cwd }}"\n_.source = ' + json.dumps(str(source)) + "\n")
    unit = home / ".config/systemd/user" / f"wallpaperdb-turbo-{identity}.service"
    unit.parent.mkdir(parents=True, exist_ok=True)
    # systemd ExecStart uses its own quoting rules, not shell parsing.
    command = [sys.executable, str(program), "collect", "--git-dir", git_dir,
               "--state", str(directory), "--endpoint", endpoint]
    quoted = " ".join(json.dumps(value.replace("%", "%%")) for value in command)
    unit.write_text(
        "[Unit]\nDescription=WallpaperDB Turbo build metrics\nAfter=network.target\n\n"
        f"[Service]\nExecStart={quoted}\nEnvironment={json.dumps('PATH=' + os.environ['PATH'])}\n"
        "Restart=on-failure\nRestartSec=5\nUMask=0077\n\n"
        "[Install]\nWantedBy=default.target\n"
    )
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", unit.name], check=True)
    subprocess.run(["systemctl", "--user", "restart", unit.name], check=True)
    print(f"Enabled {unit.name}. Project runs under mise now produce summaries across all worktrees.")
    print(f"State: {directory}. Endpoint: {endpoint}")
    print(f"Disable: systemctl --user disable --now {unit.name}; remove {fragment}")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "collect"])
    parser.add_argument("--endpoint", default="http://127.0.0.1:4318/v1/metrics")
    parser.add_argument("--git-dir", type=Path)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--interval", type=float, default=10)
    args = parser.parse_args()
    if args.action == "install":
        install(Path.cwd(), args.endpoint)
    elif args.git_dir and args.state and args.interval > 0:
        collect(args.git_dir, args.state, args.endpoint, args.interval)
    else:
        parser.error("collect requires --git-dir, --state and a positive interval")


if __name__ == "__main__":
    main()
