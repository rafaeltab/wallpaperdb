"""Cleanup guarantees for the runner that creates a compositor output."""

import contextlib
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import stress


class CleanupTests(unittest.TestCase):
    def test_decoder_drop_variant_is_opt_in_and_supports_paused_controls(self):
        for engine in ("gpu-independent-drop", "gpu-independent-drop-paused"):
            argv = [
                "stress.py",
                "--stage",
                "media",
                "--only",
                "media-360",
                "--engines",
                engine,
                "--list",
            ]
            with self.subTest(engine=engine), patch.object(stress.sys, "argv", argv), patch(
                "builtins.print"
            ) as output, patch.object(stress, "saved_assignments") as saved:
                stress.main()
            rows = json.loads(output.call_args.args[0])
            self.assertEqual(rows[0]["engines"], [engine])
            saved.assert_not_called()
        for batch in stress.recipe("all"):
            self.assertNotIn("gpu-independent-drop", batch["engines"])

    def test_cleanup_failure_cannot_publish_a_completed_study(self):
        for failing in ["output removal", "assignment restoration"]:

            @contextlib.contextmanager
            def assignments():
                yield {"groups": []}
                if failing == "assignment restoration":
                    raise RuntimeError(failing)

            @contextlib.contextmanager
            def output(*_args):
                yield {"name": "owned"}
                if failing == "output removal":
                    raise RuntimeError(failing)

            with self.subTest(failing=failing), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory) / "report"
                with patch.object(
                    stress.sys, "argv", ["stress.py", "--output-dir", str(folder)]
                ), patch.object(stress, "recipe", return_value=[]), patch.object(
                    stress, "saved_assignments", assignments
                ), patch.object(
                    stress, "virtual_output", output
                ), patch(
                    "builtins.print"
                ):
                    with self.assertRaisesRegex(RuntimeError, failing):
                        stress.main()
                manifest = json.loads((folder / "summary.json").read_text())["manifest"]
                self.assertFalse(manifest["complete"])
                self.assertEqual(manifest["error"], failing)

    def test_creation_timeout_reconciles_and_removes_only_the_attempted_output(self):
        timeout = subprocess.TimeoutExpired(["hyprctl", "output", "create"], 10)
        with patch.object(
            stress, "hypr", side_effect=[[], timeout, [{"name": "owned"}], "ok"]
        ) as hypr, patch.object(stress, "api") as api:
            with self.assertRaises(subprocess.TimeoutExpired):
                with stress.virtual_output("owned", 360):
                    self.fail("Timed-out creation cannot start a workload")
        api.assert_called_once_with("clear", outputs=["owned"])
        self.assertEqual(hypr.call_args_list[-2].args, ("-j", "monitors", "all"))
        self.assertEqual(hypr.call_args.args, ("output", "remove", "owned"))

    def test_failed_creation_does_not_remove_an_unrelated_output(self):
        with patch.object(
            stress, "hypr", side_effect=[[], RuntimeError("create failed"), [{"name": "other"}]]
        ) as hypr, patch.object(stress, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "create failed"):
                with stress.virtual_output("owned", 360):
                    self.fail("Failed creation cannot start a workload")
        api.assert_not_called()
        self.assertEqual(hypr.call_count, 3)

    def test_unavailable_creation_reconciliation_is_reported_without_a_blind_remove(self):
        with patch.object(
            stress, "hypr", side_effect=[[], RuntimeError("create failed"), OSError("IPC gone")]
        ) as hypr, patch.object(stress, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "creation outcome.*owned"):
                with stress.virtual_output("owned", 360):
                    pass
        api.assert_not_called()
        self.assertEqual(hypr.call_count, 3)

    def test_spawn_signals_are_delivered_only_after_the_child_handle_is_published(self):
        handlers, events = {}, []
        child = None
        spawned = Mock(pid=1234, returncode=None)

        def spawn():
            events.append("spawning")
            # Caught dispositions reset normally on exec; SIG_IGN must not leak.
            self.assertTrue(callable(handlers[stress.signal.SIGTERM]))
            handlers[stress.signal.SIGTERM](stress.signal.SIGTERM, None)
            handlers[stress.signal.SIGINT](stress.signal.SIGINT, None)
            events.append("returned")
            return spawned

        with patch.object(
            stress.signal,
            "getsignal",
            side_effect=lambda sig: handlers.get(sig, stress.signal.SIG_DFL),
        ), patch.object(
            stress.signal,
            "signal",
            side_effect=lambda sig, handler: handlers.__setitem__(sig, handler),
        ):
            with stress.termination_cleanup():
                with self.assertRaisesRegex(KeyboardInterrupt, "SIGTERM"):
                    try:
                        with stress.deferred_spawn_signals():
                            child = spawn()
                            events.append("published")
                        self.fail("Pending signal must initiate cleanup")
                    finally:
                        self.assertIs(child, spawned)
                        self.assertEqual(handlers[stress.signal.SIGTERM], stress.signal.SIG_IGN)
                        events.append("cleanup")
        self.assertEqual(events, ["spawning", "returned", "published", "cleanup"])
        self.assertEqual(handlers[stress.signal.SIGTERM], stress.signal.SIG_DFL)

    def test_successful_spawn_restores_handlers_without_inventing_an_interruption(self):
        old = Mock()
        handlers = {sig: old for sig in (stress.signal.SIGTERM, stress.signal.SIGINT)}
        with patch.object(
            stress.signal, "getsignal", side_effect=lambda sig: handlers[sig]
        ), patch.object(
            stress.signal,
            "signal",
            side_effect=lambda sig, handler: handlers.__setitem__(sig, handler),
        ):
            with stress.deferred_spawn_signals():
                self.assertIsNot(handlers[stress.signal.SIGTERM], old)
            self.assertIs(handlers[stress.signal.SIGTERM], old)
        old.assert_not_called()

    def test_does_not_remove_an_existing_output(self):
        with patch.object(stress, "hypr", return_value=[{"name": "taken"}]) as hypr:
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                with stress.virtual_output("taken", 360):
                    self.fail("Must not replace an existing output")
            hypr.assert_called_once_with("-j", "monitors", "all")

    def test_removes_created_output_after_configuration_failure(self):
        with patch.object(
            stress, "hypr", side_effect=[[], "ok", RuntimeError("bad mode"), "ok"]
        ) as hypr, patch.object(stress, "api") as api:
            with self.assertRaisesRegex(RuntimeError, "bad mode"):
                with stress.virtual_output("owned", 360):
                    self.fail("Bad configuration cannot start the benchmark")
            api.assert_called_once_with("clear", outputs=["owned"])
            self.assertEqual(hypr.call_args.args, ("output", "remove", "owned"))

    def test_output_removal_is_attempted_even_if_daemon_is_unreachable(self):
        with patch.object(
            stress, "hypr", side_effect=[[], "ok", RuntimeError("bad mode"), "ok"]
        ) as hypr, patch.object(stress, "api", side_effect=OSError("daemon gone")):
            with self.assertRaises(OSError):
                with stress.virtual_output("owned", 360):
                    pass
            self.assertEqual(hypr.call_args.args, ("output", "remove", "owned"))

    def test_exited_leader_keeps_its_id_reserved_until_survivor_is_killed(self):
        child = Mock(pid=1234, returncode=None)
        now = [0.0]
        events = []
        members = [1235]  # The leader is a zombie; its contender still runs.

        def kill_group(pid, signum):
            events.append((pid, signum))
            if signum == stress.signal.SIGKILL:
                members.clear()

        child.wait.side_effect = lambda **kwargs: events.append("reaped")
        with patch.object(
            stress, "owned_group_members", side_effect=lambda _: list(members)
        ), patch.object(stress.os, "killpg", side_effect=kill_group), patch.object(
            stress.time, "monotonic", side_effect=lambda: now[0]
        ), patch.object(
            stress.time, "sleep", side_effect=lambda seconds: now.__setitem__(0, now[0] + seconds)
        ):
            stress.stop_child(child, grace=0.25)
        self.assertEqual(
            events, [(1234, stress.signal.SIGTERM), (1234, stress.signal.SIGKILL), "reaped"]
        )
        self.assertLessEqual(now[0], 0.5)
        child.poll.assert_not_called()

    def test_wait_observes_exit_without_reaping_the_process_group_leader(self):
        child = Mock(pid=1234, returncode=None)
        result = SimpleNamespace(si_code=stress.os.CLD_EXITED, si_status=7)
        with patch.object(stress.os, "waitid", return_value=result) as wait:
            self.assertEqual(stress.wait_child(child, timeout=1), 7)
        wait.assert_called_once_with(
            stress.os.P_PID, 1234, stress.os.WEXITED | stress.os.WNOHANG | stress.os.WNOWAIT
        )
        child.poll.assert_not_called()
        child.wait.assert_not_called()

    def test_group_cleanup_remains_bounded_after_sigkill(self):
        child = Mock(pid=1234, returncode=None)
        now = [0.0]
        with patch.object(stress, "owned_group_members", return_value=[1234]), patch.object(
            stress.os, "killpg"
        ), patch.object(stress.time, "monotonic", side_effect=lambda: now[0]), patch.object(
            stress.time, "sleep", side_effect=lambda seconds: now.__setitem__(0, now[0] + seconds)
        ):
            with self.assertRaisesRegex(RuntimeError, "survived SIGKILL"):
                stress.stop_child(child, grace=0.25)
        self.assertLessEqual(now[0], 0.5)
        child.wait.assert_not_called()

    def test_reaped_child_is_never_signalled(self):
        child = Mock(returncode=0)
        with patch.object(stress.os, "killpg") as kill:
            stress.stop_child(child)
        kill.assert_not_called()

    def test_group_identity_must_match_the_owned_session(self):
        child = Mock(pid=1234, returncode=None)
        with patch.object(stress.os, "waitid", return_value=None), patch.object(
            stress.os, "getpgid", return_value=1234
        ), patch.object(stress.os, "getsid", return_value=999), patch.object(
            stress.os, "killpg"
        ) as kill:
            with self.assertRaisesRegex(RuntimeError, "owned session"):
                stress.stop_child(child)
        kill.assert_not_called()

    def test_member_scan_excludes_zombies_other_groups_and_other_sessions(self):
        child = Mock(pid=1234, returncode=None)
        paths = []
        with tempfile.TemporaryDirectory() as directory:
            for pid, state, group, session in [
                (1234, "Z", 1234, 1234),
                (1235, "S", 1234, 1234),
                (1236, "S", 4444, 1234),
                (1237, "S", 1234, 4444),
            ]:
                path = Path(directory) / str(pid) / "stat"
                path.parent.mkdir()
                path.write_text(f"{pid} (name with ) spaces) {state} 1 {group} {session} 0\n")
                paths.append(path)
            with patch.object(stress.os, "waitid", return_value=None), patch.object(
                stress.os, "getpgid", return_value=1234
            ), patch.object(stress.os, "getsid", return_value=1234), patch.object(
                stress.Path, "glob", return_value=paths
            ):
                self.assertEqual(stress.owned_group_members(child), [1235])

    def test_external_reaping_prevents_signalling_a_reused_id(self):
        child = Mock(pid=1234, returncode=None)
        with patch.object(stress.os, "waitid", side_effect=ChildProcessError), patch.object(
            stress.os, "killpg"
        ) as kill:
            with self.assertRaisesRegex(RuntimeError, "no longer waitable"):
                stress.stop_child(child)
        kill.assert_not_called()

    def test_sigterm_stops_child_before_output_and_assignments_are_restored(self):
        events, handlers = [], {}
        child = Mock(pid=1234, returncode=None)

        @contextlib.contextmanager
        def assignments():
            events.append("saved")
            try:
                yield {"groups": []}
            finally:
                events.append("restored")

        @contextlib.contextmanager
        def output(*args):
            events.append("created")
            try:
                yield {"name": "owned"}
            finally:
                # Repeated termination signals cannot interrupt cleanup.
                self.assertEqual(handlers[stress.signal.SIGTERM], stress.signal.SIG_IGN)
                events.append("removed")

        def interrupt(*args, **kwargs):
            handlers[stress.signal.SIGTERM](stress.signal.SIGTERM, None)

        def stop(value):
            if value is not None:
                events.append("stopped")

        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "report"
            argv = [
                "stress.py",
                "--only",
                "screen-120",
                "--engines",
                "idle",
                "--output-dir",
                str(folder),
            ]
            with patch.object(stress.sys, "argv", argv), patch.object(
                stress.signal,
                "getsignal",
                side_effect=lambda sig: handlers.get(sig, stress.signal.SIG_DFL),
            ), patch.object(
                stress.signal,
                "signal",
                side_effect=lambda sig, handler: handlers.__setitem__(sig, handler),
            ), patch.object(
                stress, "saved_assignments", assignments
            ), patch.object(
                stress, "virtual_output", output
            ), patch.object(
                stress.subprocess, "Popen", return_value=child
            ), patch.object(
                stress, "wait_child", side_effect=interrupt
            ), patch.object(
                stress, "stop_child", side_effect=stop
            ), patch(
                "builtins.print"
            ):
                with self.assertRaisesRegex(KeyboardInterrupt, "SIGTERM"):
                    stress.main()
            self.assertEqual(
                json.loads((folder / "summary.json").read_text())["manifest"]["error"], "SIGTERM"
            )
        self.assertEqual(events, ["saved", "created", "stopped", "removed", "restored"])
        self.assertEqual(handlers[stress.signal.SIGTERM], stress.signal.SIG_DFL)


class SamplingArgumentTests(unittest.TestCase):
    def test_no_contender_overrides_selected_recipe_without_changing_defaults(self):
        argv = ["stress.py", "--stage", "media", "--only", "media-360", "--no-contender", "--list"]
        with patch.object(stress.sys, "argv", argv), patch(
            "builtins.print"
        ) as output, patch.object(stress, "saved_assignments") as saved:
            stress.main()
        selected = json.loads(output.call_args.args[0])
        self.assertEqual(len(selected), 1)
        self.assertFalse(selected[0]["contention"])
        self.assertTrue(all(batch["contention"] for batch in stress.recipe("media")))
        saved.assert_not_called()

    def test_sampling_default_and_zero_are_forwarded_without_disabling_other_recording(self):
        for supplied, expected in (([], "20"), (["--sample-hz", "0"], "0.0")):
            with self.subTest(supplied=supplied), tempfile.TemporaryDirectory() as directory:
                argv = [
                    "stress.py",
                    "--only",
                    "screen-120",
                    "--engines",
                    "idle",
                    "--output-dir",
                    str(Path(directory) / "report"),
                    *supplied,
                ]
                child = Mock(pid=1234, returncode=None)
                with patch.object(stress.sys, "argv", argv), patch.object(
                    stress, "saved_assignments", return_value=contextlib.nullcontext({"groups": []})
                ), patch.object(
                    stress, "virtual_output", return_value=contextlib.nullcontext({"name": "owned"})
                ), patch.object(
                    stress.subprocess, "Popen", return_value=child
                ) as spawn, patch.object(
                    stress, "wait_child", return_value=0
                ), patch.object(
                    stress, "stop_child"
                ), patch.object(
                    stress, "write_summary"
                ), patch(
                    "builtins.print"
                ):
                    stress.main()
                command = spawn.call_args.args[0]
                self.assertEqual(command[command.index("--sample-hz") + 1], expected)
                self.assertIn("--no-contender", command)
                self.assertNotIn("--no-trace", command)

    def test_nonfinite_or_out_of_range_sampling_fails_before_desktop_work(self):
        for value in ("nan", "inf", "-1", "100.1"):
            with self.subTest(value=value), patch.object(
                stress.sys, "argv", ["stress.py", "--list", "--sample-hz", value]
            ), patch.object(stress.sys, "stderr"), patch.object(
                stress, "saved_assignments"
            ) as saved:
                with self.assertRaises(SystemExit):
                    stress.main()
                saved.assert_not_called()


class SummaryTests(unittest.TestCase):
    def test_compact_cpu_means_preserve_weighted_profiler_results(self):
        run = {
            "name": "1-idle",
            "valid": True,
            "errors": [],
            "start": 10,
            "end": 11,
            "cpu": {"mean": 3},
            "cpu_by_role": {"compositor": {"mean": 9}},
            "cpu_timeline": [
                {"wallpaper_cpu": 0, "compositor_cpu": 0},
                {"wallpaper_cpu": 20, "compositor_cpu": 40},
            ],
        }
        compact = stress.compact_run(stress.recipe("screen")[0], run, Path("report.html"))
        self.assertEqual(compact["cpu_mean"], 3)
        self.assertEqual(compact["compositor_cpu_mean"], 9)

    def test_partial_report_does_not_mask_the_original_interruption(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            batch = stress.recipe("screen")[0]
            (folder / batch["name"]).mkdir()
            (folder / batch["name"] / "report.json").write_text('{"runs":[')
            manifest = {"error": "SIGTERM", "complete": False}
            stress.write_summary(folder, manifest, [batch])
            saved = json.loads((folder / "summary.json").read_text())
            self.assertEqual(saved["manifest"]["error"], "SIGTERM")
            self.assertEqual(saved["runs"], [])
            self.assertEqual(
                saved["manifest"]["report_errors"][0]["path"], batch["name"] + "/report.json"
            )
            self.assertTrue(saved["manifest"]["report_errors"][0]["error"])
            self.assertTrue((folder / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
