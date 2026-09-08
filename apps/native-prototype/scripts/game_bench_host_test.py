import tempfile
import unittest
from pathlib import Path

from game_bench_host import FileSnapshot, cleanup_all, validate_request


class HostTests(unittest.TestCase):
    def test_restore_removes_game_created_settings_and_recovers_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cfg = root / "cfg"
            cfg.mkdir()
            original = cfg / "video.txt"
            original.write_bytes(b"original\x00")
            saved = FileSnapshot(root / "backup", [cfg], [root / "console.log"])
            original.write_text("changed")
            (cfg / "created.vcfg").write_text("created by game")
            (root / "console.log").write_text("game output")
            saved.restore()
            self.assertEqual(original.read_bytes(), b"original\x00")
            self.assertFalse((cfg / "created.vcfg").exists())
            self.assertFalse((root / "console.log").exists())

    def test_one_failed_cleanup_does_not_skip_the_rest(self):
        actions = []

        def failure():
            raise OSError("device disappeared")

        errors = cleanup_all(
            [
                ("game", failure),
                ("settings", lambda: actions.append("settings")),
                ("desktop", lambda: actions.append("desktop")),
            ]
        )
        self.assertEqual(actions, ["settings", "desktop"])
        self.assertEqual(errors, ["game: device disappeared"])

    def test_invalid_job_is_rejected_before_mutation(self):
        request = dict(
            source="prism",
            outputs=["DP-2"],
            game_output="DP-5",
            experiment="gpu",
            fps=120,
            seconds=20,
            repeats=1,
            cap=240,
            preset="current",
            resolution="display",
            policy="active",
        )
        validate_request(request, {"DP-2", "DP-5"})
        for change in [
            dict(repeats=100),
            dict(outputs=["missing"]),
            dict(game_output="missing"),
            dict(experiment="chromium-dmabuf"),
            dict(seconds=-1),
            dict(cap=10000),
            dict(outputs=["DP-2", "DP-2"]),
            dict(fps=True),
            dict(demo="a.dem\nquit"),
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_request(request | change, {"DP-2", "DP-5"})
