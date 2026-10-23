import importlib.util
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "turbo_telemetry", Path(__file__).with_name("turbo-telemetry.py")
)
telemetry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(telemetry)


def summary(run_id="run-1", cached=False):
    return {
        "id": run_id,
        "version": "1",
        "execution": {"startTime": 1000, "endTime": 3000, "exitCode": 0},
        "tasks": [{
            "package": "@wallpaperdb/example", "task": "build",
            "command": "do-not-export-command", "hash": "do-not-export-hash",
            "cache": {"status": "HIT" if cached else "MISS", "local": cached},
            "execution": {
                "startTime": 1100, "endTime": 1100 if cached else 2600,
                "exitCode": 0,
            },
        }],
        "environmentVariables": {"SECRET": "do-not-export-secret"},
    }


class TelemetryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = telemetry.Store(self.root / "state.sqlite")
        self.addCleanup(self.store.close)

    def metric(self, name, payload=None):
        payload = payload or self.store.payload(now_ns=10_000_000_000)
        metrics = payload["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
        return next(item for item in metrics if item["name"] == name)

    def test_deduplicates_summaries_across_restart_and_worktrees(self):
        self.assertTrue(self.store.ingest(summary()))
        self.assertFalse(self.store.ingest(summary()))
        other = telemetry.Store(self.root / "state.sqlite")
        self.addCleanup(other.close)
        self.assertFalse(other.ingest(summary()))
        self.assertTrue(other.ingest(summary("run-2", cached=True)))
        runs = self.metric("wallpaperdb.turbo.runs", other.payload())
        self.assertEqual(runs["sum"]["dataPoints"][0]["asInt"], "2")

    def test_keeps_cache_restoration_separate_from_execution(self):
        self.store.ingest(summary())
        self.store.ingest(summary("run-2", cached=True))
        points = self.metric("wallpaperdb.turbo.task.duration")["histogram"]["dataPoints"]
        indexed = {
            next(a["value"]["stringValue"] for a in p["attributes"] if a["key"] == "cache_status"): p
            for p in points
        }
        self.assertEqual(indexed["miss"]["sum"], 1.5)
        self.assertEqual(indexed["hit"]["sum"], 0)
        self.assertEqual(indexed["hit"]["count"], "1")
        run = self.metric("wallpaperdb.turbo.run.duration")["histogram"]["dataPoints"][0]
        self.assertEqual(run["sum"], 4)
        self.assertEqual(sum(map(int, run["bucketCounts"])), 2)

    def test_exports_only_numeric_metrics_and_allowed_metadata(self):
        self.store.ingest(summary())
        encoded = json.dumps(self.store.payload())
        self.assertNotIn("do-not-export", encoded)
        self.assertNotIn("run-1", encoded)
        self.assertIn("@wallpaperdb/example", encoded)
        metric = self.metric("wallpaperdb.turbo.tasks")
        self.assertEqual(metric["sum"]["aggregationTemporality"], 2)
        self.assertTrue(metric["sum"]["isMonotonic"])

    def test_new_series_emit_a_zero_baseline_before_the_first_observation(self):
        self.store.ingest(summary())
        baseline = self.metric("wallpaperdb.turbo.tasks", self.store.payload(bootstrap=True))
        self.assertEqual(baseline["sum"]["dataPoints"][0]["asInt"], "0")
        self.store.exported()
        actual = self.metric("wallpaperdb.turbo.tasks", self.store.payload(bootstrap=True))
        self.assertEqual(actual["sum"]["dataPoints"][0]["asInt"], "1")
        self.store.ingest(summary("run-2", cached=True))
        points = self.metric("wallpaperdb.turbo.tasks", self.store.payload(bootstrap=True))["sum"]["dataPoints"]
        self.assertEqual(sorted(p["asInt"] for p in points), ["0", "1"])

    def test_dry_runs_and_incomplete_files_are_not_counted(self):
        self.assertFalse(self.store.ingest({"id": "dry", "tasks": []}))
        broken = summary()
        broken["execution"]["endTime"] = 999
        self.assertFalse(self.store.ingest(broken))
        self.assertTrue(self.store.ingest(summary()))

    def test_graph_nodes_without_execution_are_not_attempts(self):
        data = summary()
        data["tasks"].append({"package": "unused", "task": "build", "cache": {"status": "MISS"}})
        self.store.ingest(data)
        points = self.metric("wallpaperdb.turbo.tasks")["sum"]["dataPoints"]
        self.assertEqual(sum(int(p["asInt"]) for p in points), 1)

    def test_ingests_complete_files_from_multiple_worktrees_and_retries_partial_json(self):
        a, b = self.root / "a", self.root / "b"
        for path in (a, b):
            (path / ".turbo/runs").mkdir(parents=True)
        (a / ".turbo/runs/a.json").write_text(json.dumps(summary()))
        partial = b / ".turbo/runs/b.json"
        partial.write_text("{")
        telemetry.scan(self.store, [a, b])
        partial.write_text(json.dumps(summary("run-2", cached=True)))
        telemetry.scan(self.store, [a, b])
        telemetry.scan(self.store, [a, b])
        runs = self.metric("wallpaperdb.turbo.runs")
        self.assertEqual(runs["sum"]["dataPoints"][0]["asInt"], "2")

    def test_install_scopes_mise_to_git_repository_and_linked_worktrees(self):
        repository = self.root / "repository"
        repository.mkdir()
        subprocess.run(["git", "init", "-q", str(repository)], check=True)
        subprocess.run(["git", "-C", str(repository), "-c", "user.name=Test",
                        "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "initial"], check=True)
        linked = self.root / "linked"
        subprocess.run(["git", "-C", str(repository), "worktree", "add", "-qb", "linked", str(linked)], check=True)
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        systemctl = fake_bin / "systemctl"
        systemctl.write_text("#!/bin/sh\nexit 0\n")
        systemctl.chmod(0o755)
        user_directory = self.root / "user"
        with patch.dict(os.environ, {"PATH": str(fake_bin) + ":" + os.environ["PATH"]}):
            telemetry.install(repository, "http://127.0.0.1:4318/v1/metrics", user_directory)
        config = next((user_directory / ".config/mise/conf.d").glob("*.toml"))
        environment = dict(os.environ)
        environment.pop("TURBO_RUN_SUMMARY", None)
        environment.update(MISE_GLOBAL_CONFIG_FILE=str(config), MISE_TRUSTED_CONFIG_PATHS=str(self.root))
        for cwd, expected in [(repository, "true"), (linked, "true"), (self.root, "unset")]:
            result = subprocess.run(
                ["mise", "exec", "--", sys.executable, "-c",
                 'import os; print(os.environ.get("TURBO_RUN_SUMMARY", "unset"))'],
                cwd=cwd, env=environment, check=True, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.stdout.strip(), expected)

    def test_running_collector_retries_exports_and_preserves_totals_on_restart(self):
        repository = self.root / "real-repository"
        repository.mkdir()
        subprocess.run(["git", "init", "-q", str(repository)], check=True)
        received = queue.Queue()
        responses = [503]

        class Handler(BaseHTTPRequestHandler):
            def do_POST(handler):
                payload = json.loads(handler.rfile.read(int(handler.headers["Content-Length"])))
                status = responses.pop(0) if responses else 200
                received.put((status, payload))
                handler.send_response(status)
                handler.end_headers()
                handler.wfile.write(b"{}")

            def log_message(handler, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        command = [sys.executable, str(Path(telemetry.__file__)), "collect",
                   "--git-dir", str(repository / ".git"), "--state", str(self.root / "service-state"),
                   "--interval", "0.1", "--endpoint", f"http://127.0.0.1:{server.server_port}/v1/metrics"]

        def start():
            log = (self.root / "collector.log").open("a")
            self.addCleanup(log.close)
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=log)

            def stop():
                process.terminate()
                process.wait(timeout=10)

            self.addCleanup(stop)
            return process

        def wait_for_count(expected):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                status, payload = received.get(timeout=max(0.01, deadline - time.monotonic()))
                if status != 200:
                    continue
                try:
                    metric = self.metric("wallpaperdb.turbo.runs", payload)
                except StopIteration:
                    continue
                if metric["sum"]["dataPoints"][0]["asInt"] == str(expected):
                    return payload
            self.fail(f"Collector did not publish {expected} runs")

        process = start()
        self.assertEqual(received.get(timeout=10)[0], 503)
        runs = repository / ".turbo/runs"
        runs.mkdir(parents=True)
        (runs / "one.json").write_text(json.dumps(summary()))
        first = wait_for_count(0)
        start_ns = self.metric("wallpaperdb.turbo.runs", first)["sum"]["dataPoints"][0]["startTimeUnixNano"]
        wait_for_count(1)
        self.assertIn("operation=export error=HTTPError http_status=503", (self.root / "collector.log").read_text())
        process.terminate()
        process.wait(timeout=10)
        process = start()
        (runs / "two.json").write_text(json.dumps(summary("run-2", cached=True)))
        restarted = wait_for_count(2)
        self.assertEqual(
            self.metric("wallpaperdb.turbo.runs", restarted)["sum"]["dataPoints"][0]["startTimeUnixNano"], start_ns,
        )


if __name__ == "__main__":
    unittest.main()
