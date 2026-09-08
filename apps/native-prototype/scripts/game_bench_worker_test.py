import unittest
import tempfile
from pathlib import Path

from game_bench_worker import verify_wallpaper, verify_game, configure_video, observed_msaa
from game_bench import vdf


class VideoSettingsTests(unittest.TestCase):
    def test_live_render_targets_distinguish_msaa_and_ignore_other_dimensions(self):
        high = "[RenderPipelineCsgo] RT 1600x900 RGBA16161616F 4xMSAA : 46080000 Bytes"
        low = "[RenderPipelineCsgo] RT 1600x900 RGBA16161616F  : 11520000 Bytes"
        self.assertEqual(observed_msaa(high, [1600, 900]), 4)
        self.assertEqual(
            observed_msaa(low + "\nRT 800x450 RGBA8888 4xMSAA : 50 Bytes", [1600, 900]), 1
        )
        with self.assertRaises(ValueError):
            observed_msaa("unrelated log", [1600, 900])

    def test_presets_and_current_always_start_from_saved_preferences(self):
        original = (Path(__file__).parent / "fixtures/cs2-video.txt").read_text()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cs2_video.txt"
            path.write_text(original)
            info = {"cfg_dirs": [directory]}
            for preset in ("low", "high", "low", "current"):
                configure_video(info, [1600, 900], preset, original)
                settings = vdf(path.read_text())["video.cfg"]
                self.assertEqual(settings["setting.msaa_samples"], "0" if preset == "low" else "4")
                self.assertEqual(
                    settings["setting.videocfg_shadow_quality"], "0" if preset == "low" else "2"
                )
                self.assertEqual(settings["setting.videocfg_fsr_detail"], "0")


class WallpaperEvidenceTests(unittest.TestCase):
    def rows(self, renderer="gpu", paused=False, frames=(10, 20)):
        return [
            {
                "monotonic": stamp,
                "covered_outputs": ["DP-5"],
                "surfaces": [
                    {
                        "output": "DP-5",
                        "paused": paused,
                        "telemetry": {
                            "renderer": renderer,
                            "state": "ready",
                            "frames": frame,
                            "paused": paused,
                        },
                    }
                ],
            }
            for stamp, frame in zip((1, 2), frames)
        ]

    def test_active_and_normal_policies_require_observed_state(self):
        request = {"outputs": ["DP-5"], "game_output": "DP-5", "policy": "active"}
        verify_wallpaper(self.rows(), "wallpaper", request, 0, 3)
        for rows in (self.rows(paused=True), self.rows(frames=(10, 10))):
            with self.assertRaises(RuntimeError):
                verify_wallpaper(rows, "wallpaper", request, 0, 3)
        request["policy"] = "normal"
        verify_wallpaper(self.rows(paused=True, frames=(10, 10)), "wallpaper", request, 0, 3)
        with self.assertRaises(RuntimeError):
            verify_wallpaper(self.rows(), "wallpaper", request, 0, 3)

    def test_stationary_image_is_valid_without_animation_or_pause_events(self):
        request = {"outputs": ["DP-5"], "game_output": "DP-5", "policy": "normal"}
        verify_wallpaper(
            self.rows(renderer="native image", frames=(0, 0)), "wallpaper", request, 0, 3
        )

    def test_control_cannot_contain_a_wallpaper(self):
        with self.assertRaises(RuntimeError):
            verify_wallpaper(self.rows(), "control", {}, 0, 3)

    def test_shared_span_keeps_producing_when_one_output_is_visible(self):
        rows = self.rows(paused=True)
        for row in rows:
            surface = row["surfaces"][0]
            surface["telemetry"]["paused"] = False
            row["surfaces"].append(surface | {"output": "DP-2", "paused": False})
        request = {
            "outputs": ["DP-5", "DP-2"],
            "policy": "normal",
            "span": True,
            "experiment": "gpu",
        }
        verify_wallpaper(rows, "wallpaper", request, 0, 3)
        for row in rows:
            for surface in row["surfaces"]:
                surface["telemetry"]["paused"] = True
        with self.assertRaises(RuntimeError):
            verify_wallpaper(rows, "wallpaper", request, 0, 3)

    def test_normal_policy_uses_other_fullscreen_windows_too(self):
        rows = self.rows(paused=True, frames=(40, 40))
        request = {"outputs": ["DP-5"], "game_output": "DP-2", "policy": "normal"}
        verify_wallpaper(rows, "wallpaper", request, 0, 3)
        rows[-1]["covered_outputs"] = []
        with self.assertRaises(RuntimeError):
            verify_wallpaper(rows, "wallpaper", request, 0, 3)

    def test_retained_gpu_image_needs_no_continuing_frames(self):
        request = {"outputs": ["DP-5"], "policy": "active", "kind": "image"}
        verify_wallpaper(self.rows(frames=(40, 40)), "wallpaper", request, 0, 3)

    def test_paused_flag_cannot_hide_a_producer_that_keeps_running(self):
        request = {"outputs": ["DP-5"], "policy": "normal"}
        with self.assertRaisesRegex(RuntimeError, "continued"):
            verify_wallpaper(self.rows(paused=True), "wallpaper", request, 0, 3)
        rows = self.rows(renderer="mpv", paused=True)
        for index, row in enumerate(rows):
            row["surfaces"][0]["telemetry"]["time"] = 2 + index / 10
        with self.assertRaisesRegex(RuntimeError, "continued"):
            verify_wallpaper(rows, "wallpaper", request, 0, 3)

    def test_scene_frames_cannot_hide_a_frozen_independent_video(self):
        rows = self.rows()
        for row in rows:
            row["surfaces"][0]["telemetry"]["media_new_frame_renders"] = 3
        with self.assertRaisesRegex(RuntimeError, "Independent video"):
            verify_wallpaper(
                rows, "wallpaper", {"outputs": ["DP-5"], "policy": "active", "kind": "video"}, 0, 3
            )

    def test_game_workspace_must_be_visible_but_need_not_be_focused(self):
        row = {
            "monotonic": 1,
            "game_focused": False,
            "game_window": {"fullscreen": 2, "visible": True, "monitor": 2, "workspace": {"id": 7}},
            "game_monitor": {
                "name": "DP-5",
                "id": 2,
                "dpmsStatus": True,
                "activeWorkspace": {"id": 7},
            },
        }
        verify_game([row], "DP-5", 0, 3)
        row["startup_adjustment"] = True
        with self.assertRaises(RuntimeError):
            verify_game([row], "DP-5", 0, 3)
        row["startup_adjustment"] = False
        row["game_window"]["visible"] = False
        with self.assertRaises(RuntimeError):
            verify_game([row], "DP-5", 0, 3)
        row["game_window"]["visible"] = True
        row["game_monitor"]["activeWorkspace"]["id"] = 8
        with self.assertRaises(RuntimeError):
            verify_game([row], "DP-5", 0, 3)

    def test_renderer_error_is_not_a_fast_result(self):
        rows = self.rows()
        rows[1]["surfaces"][0]["telemetry"]["error"] = "failed texture import"
        with self.assertRaises(RuntimeError):
            verify_wallpaper(
                rows,
                "wallpaper",
                {"outputs": ["DP-5"], "game_output": "DP-2", "policy": "active"},
                0,
                3,
            )
