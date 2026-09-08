"""Profiler checks using synthetic observations and temporary CSV files only."""

import importlib.util
import tempfile
import unittest
import contextlib
import json
import struct
from pathlib import Path
from unittest.mock import MagicMock, patch


SPEC = importlib.util.spec_from_file_location(
    "wallpaper_profile", Path(__file__).with_name("profile.py")
)
profile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(profile)


def metrics(**changes):
    return {
        "temperature_c": 50.0,
        "cpu_temperature_c": 95.0,
        "vram_free_mib": 4096.0,
        "ram_available_mib": 16384.0,
        **changes,
    }


class GuardTests(unittest.TestCase):
    def test_stale_resource_values_stop_the_owned_contender(self):
        now = [10.0]
        reader = MagicMock()
        reader.read.return_value = {"monotonic": 10.0, **metrics()}
        monitor = profile.SafetyMonitor(profile.SafetyGuard(), reader, clock=lambda: now[0])
        child = MagicMock()
        child.poll.return_value = None
        try:
            self.assertEqual(monitor.snapshot()["monotonic"], 10.0)
            monitor.child = child
            now[0] = 12.1
            with self.assertRaisesRegex(profile.GuardViolation, "stale"):
                monitor.snapshot()
            child.terminate.assert_called_once()
            with self.assertRaises(profile.GuardViolation):
                monitor.snapshot()
            child.terminate.assert_called_once()
        finally:
            monitor.stop()

    def test_cpu_anomaly_must_persist_for_three_seconds(self):
        guard = profile.SafetyGuard()
        for now in [0.0, 1.0, 2.99]:
            guard.check(metrics(cpu_temperature_c=96.1), now)
        with self.assertRaisesRegex(profile.GuardViolation, "CPU"):
            guard.check(metrics(cpu_temperature_c=96.1), 3.0)

    def test_cpu_recovery_resets_sustained_threshold(self):
        guard = profile.SafetyGuard()
        guard.check(metrics(cpu_temperature_c=96.2), 0.0)
        guard.check(metrics(cpu_temperature_c=95.0), 2.0)
        guard.check(metrics(cpu_temperature_c=96.2), 3.0)
        guard.check(metrics(cpu_temperature_c=96.2), 5.99)
        with self.assertRaises(profile.GuardViolation):
            guard.check(metrics(cpu_temperature_c=96.2), 6.0)

    def test_disabled_cpu_check_allows_sustained_high_and_unavailable_cpu_readings(self):
        guard = profile.SafetyGuard(cpu_temperature_check=False)
        for now in [0.0, 3.0, 30.0]:
            guard.check(metrics(cpu_temperature_c=99.0), now)
        unavailable = metrics()
        del unavailable["cpu_temperature_c"]
        guard.check(unavailable, 31.0)
        guard.check(metrics(cpu_temperature_c=float("nan")), 32.0)

    def test_disabled_cpu_check_still_enforces_gpu_memory_and_required_counters(self):
        for changes, message in [
            ({"temperature_c": 82.0}, "GPU"),
            ({"vram_free_mib": 1023}, "VRAM"),
            ({"ram_available_mib": 8191}, "RAM"),
            ({"temperature_c": None}, "unavailable"),
            ({"vram_free_mib": None}, "unavailable"),
            ({"ram_available_mib": None}, "unavailable"),
        ]:
            with self.subTest(changes=changes), self.assertRaisesRegex(
                profile.GuardViolation, message
            ):
                profile.SafetyGuard(cpu_temperature_check=False).check(metrics(**changes), 0)

    def test_gpu_and_actual_memory_limits_fail_immediately(self):
        for values, message in [
            (metrics(temperature_c=82.0), "GPU"),
            (metrics(vram_free_mib=1023, memory_percent=0), "VRAM"),
            (metrics(ram_available_mib=8191), "RAM"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(
                profile.GuardViolation, message
            ):
                profile.SafetyGuard().check(values, 0)

    def test_unavailable_memory_is_not_treated_as_zero_usage(self):
        values = metrics()
        del values["vram_free_mib"]
        with self.assertRaisesRegex(profile.GuardViolation, "unavailable"):
            profile.SafetyGuard().check(values, 0)

    def test_cooldown_stops_at_its_deadline_without_launching_work(self):
        now = [0.0]
        with self.assertRaisesRegex(profile.GuardViolation, "cooldown"):
            profile.wait_for_cooldown(
                lambda: metrics(cpu_temperature_c=95.8),
                seconds=1.0,
                clock=lambda: now[0],
                sleep=lambda duration: now.__setitem__(0, now[0] + duration),
            )
        self.assertAlmostEqual(now[0], 1.0)

    def test_normal_7950x_temperature_can_start(self):
        values = profile.wait_for_cooldown(lambda: metrics(cpu_temperature_c=95.0), seconds=0)
        self.assertEqual(values["cpu_temperature_c"], 95.0)


class DecoderDropPolicyTests(unittest.TestCase):
    def telemetry(self, **changes):
        return {
            "media_decoder_drop_enabled": True,
            "media_framedrop_requested": "decoder+vo",
            "media_active": True,
            "media_framedrop": "decoder+vo",
            "media_framedrop_verified_at_init": True,
            **changes,
        }

    def test_new_variant_requires_read_back_policy_and_rejects_an_old_helper(self):
        profile.validate_renderer_policy("gpu-independent-drop", self.telemetry())
        for telemetry in [
            {},
            self.telemetry(media_decoder_drop_enabled=False),
            self.telemetry(media_framedrop_requested="vo"),
            self.telemetry(media_framedrop="vo"),
            self.telemetry(media_framedrop_verified_at_init=False),
            self.telemetry(media_active=None),
        ]:
            with self.subTest(telemetry=telemetry), self.assertRaises(profile.WallpaperFailure):
                profile.validate_renderer_policy("gpu-independent-drop", telemetry)

    def test_procedural_scene_without_video_does_not_invent_an_applied_mpv_option(self):
        profile.validate_renderer_policy(
            "gpu-independent-drop",
            self.telemetry(
                media_active=False, media_framedrop=None, media_framedrop_verified_at_init=False
            ),
        )

    def test_existing_independent_evidence_remains_accepted_without_new_fields(self):
        profile.validate_renderer_policy("gpu-independent", {})


class FrameEvidenceTests(unittest.TestCase):
    def summarize(self, rows, start=10, end=11):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "frames.csv"
            path.write_text("monotonic,event,frame,output,value,value2,sequence,flags\n" + rows)
            return profile.frame_summary(path, start, end, 1000 / 120)

    def test_single_presentation_counts_even_without_an_interval(self):
        result, timeline = self.summarize("10.4,presented,1,DP-2,10.3,0.00694,10,7\n")
        self.assertEqual(result["presented_frames"], 1)
        self.assertEqual(result["presented_hz"], 1)
        self.assertEqual(result["presentation_ms"]["samples"], 0)
        self.assertEqual(timeline, [])

    def test_window_uses_actual_presentation_and_separates_outputs(self):
        result, timeline = self.summarize(
            "10.4,presented,1,DP-2,9.9,0.00694,10,7\n"
            "10.6,presented,2,DP-2,10.1,0.00694,11,7\n"
            "12.0,presented,3,DP-2,10.2,0.00694,12,7\n"
            "10.8,presented,4,DP-5,10.3,0.00278,90,7\n"
        )
        self.assertEqual(result["presented_frames"], 3)
        self.assertEqual(result["outputs"]["DP-2"]["presented_hz"], 2)
        self.assertEqual(result["outputs"]["DP-5"]["presented_hz"], 1)
        self.assertAlmostEqual(timeline[0][1], 100)

    def test_zero_length_failed_window_has_no_invented_rate(self):
        result, _ = self.summarize("10.4,presented,1,DP-2,10.3,0.00694,10,7\n", 10, 10)
        self.assertIsNone(result["presented_hz"])

    def test_media_updates_are_counted_separately_from_presentations(self):
        result, _ = self.summarize(
            "9.9,media,1,,0,0,0,0\n"
            "10.2,media,2,,0,0,0,0\n"
            "10.3,presented,2,DP-2,10.25,0.00694,10,7\n"
            "10.8,media,3,,0,0,0,0\n"
        )
        self.assertEqual(result["media_updates"], 2)
        self.assertEqual(result["presented_frames"], 1)
        self.assertEqual(result["last_media_update"], 10.8)


class AtomicReportTests(unittest.TestCase):
    def test_interrupted_publication_preserves_the_previous_complete_report(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = {"arguments": {}}
            previous = [{"name": "completed"}]
            profile.write_report(folder, manifest, previous)
            before_json = (folder / "report.json").read_text()
            before_html = (folder / "report.html").read_text()
            with patch.object(profile.os, "replace", side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    profile.write_report(folder, manifest, previous + [{"name": "next"}])
            self.assertEqual((folder / "report.json").read_text(), before_json)
            self.assertEqual((folder / "report.html").read_text(), before_html)
            self.assertFalse(list(folder.glob("*.tmp")))

    def test_successful_publication_replaces_json_and_html(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            profile.write_report(folder, {"arguments": {}}, [{"name": "old"}])
            profile.write_report(folder, {"arguments": {}}, [{"name": "new"}])
            self.assertEqual(
                json.loads((folder / "report.json").read_text())["runs"], [{"name": "new"}]
            )
            self.assertIn('"name": "new"', (folder / "report.html").read_text())


class VideoEvidenceTests(unittest.TestCase):
    def browser(self, timestamp, position, **changes):
        video = {
            "time": position,
            "duration": 10,
            "width": 3840,
            "height": 2160,
            "ready": 4,
            "paused": False,
            **changes,
        }
        return timestamp, {"browser": {"videos": [video]}}

    def test_looping_live_media_has_observable_progress(self):
        result = profile.video_progress(
            "live", False, [self.browser(0, 1), self.browser(5, 6), self.browser(10, 1)], {}
        )
        self.assertEqual(result["status"], "observed")
        self.assertFalse(result["errors"])

    def test_live_media_that_stalls_while_the_scene_keeps_animating_is_rejected(self):
        result = profile.video_progress(
            "live", False, [self.browser(t, 1) for t in [0, 1, 2, 3]], {}
        )
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["errors"])

    def test_browser_video_counts_disambiguate_whole_loop_position_samples(self):
        result = profile.video_progress(
            "live",
            False,
            [
                self.browser(
                    t, 0, duration=1, total_video_frames=30 * (t + 1), dropped_video_frames=0
                )
                for t in [0, 1, 2]
            ],
            {},
        )
        self.assertEqual(result["status"], "observed")

    def test_whole_loop_alias_without_frame_counters_stays_unknown(self):
        result = profile.video_progress(
            "live",
            False,
            [self.browser(t, 0, duration=1) for t in [0, 0.01, 1.01, 2.01]],
            {},
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertFalse(result["errors"])

    def test_mpvpaper_position_can_show_progress_or_a_stall_without_frame_counts(self):
        for positions, expected in [([0, 1, 2], "observed"), ([1, 1, 1], "failed")]:
            with self.subTest(expected=expected):
                observations = [
                    (t, {"renderer": "mpv", "time": position, "duration": 10, "paused": False})
                    for t, position in enumerate(positions)
                ]
                result = profile.video_progress("video", False, observations, {})
                self.assertEqual(result["status"], expected)
                self.assertIsNone(result["videos"][0]["displayed_frame_increments"])

    def test_native_media_events_are_not_invented_presentation_or_decoder_counts(self):
        result = profile.video_progress(
            "live",
            False,
            [(0, {"hwdec": "nvdec"}), (3, {"hwdec": "nvdec"})],
            {"available": True, "media_updates": 90, "last_media_update": 2.99},
        )
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["method"], "native media render updates")
        stalled = profile.video_progress(
            "live",
            False,
            [(0, {"hwdec": "nvdec"}), (3, {"hwdec": "nvdec"})],
            {"available": True, "media_updates": 0},
        )
        self.assertEqual(stalled["status"], "failed")

    def test_static_paused_and_uninstrumented_video_paths_are_distinguished(self):
        self.assertEqual(profile.video_progress("image", False, [], {})["status"], "not_applicable")
        self.assertEqual(profile.video_progress("video", True, [], {})["status"], "pause_requested")
        self.assertEqual(
            profile.video_progress("video", False, [(0, {"renderer": "mpv"})], {})["status"],
            "unavailable",
        )


class PauseEvidenceTests(unittest.TestCase):
    def native(self, **changes):
        return {"renderer": "Lua / OpenGL", "paused": True, "frames": 40, **changes}

    def browser(self, sequence, **changes):
        return {
            "paused": True,
            "report_sequence": sequence,
            "frames": 50,
            "videos": [],
            **changes,
        }

    def trace(self, **changes):
        return {
            "available": True,
            "presented_frames": 0,
            "media_updates": 0,
            "cpu_submit_ms": {"samples": 0},
            **changes,
        }

    def evaluate(self, observations, frames=None, kind="live", paused=True):
        return profile.pause_evidence(
            kind, paused, observations, self.trace() if frames is None else frames, 0, 4
        )

    def test_native_pause_requires_stopped_post_warmup_work(self):
        result = self.evaluate([(t, self.native()) for t in range(5)])
        self.assertEqual(result["status"], "verified")
        self.assertFalse(result["errors"])
        self.assertEqual(result["checks"]["native_render_submissions"], 0)

    def test_periodic_false_pause_flag_cannot_hide_between_true_endpoints(self):
        result = self.evaluate([(t, self.native(paused=t != 2)) for t in range(5)])
        self.assertEqual(result["status"], "failed")
        self.assertTrue(any("pause flag" in error for error in result["errors"]))

    def test_native_counter_movement_and_reset_are_rejected(self):
        for last in (0, 41):
            with self.subTest(last=last):
                observations = [(t, self.native(frames=40 if t < 4 else last)) for t in range(5)]
                self.assertEqual(self.evaluate(observations)["status"], "failed")

    def test_native_submissions_presentations_and_media_updates_are_separate_checks(self):
        for changes in (
            {"presented_frames": 1},
            {"media_updates": 1},
            {"cpu_submit_ms": {"samples": 1}},
        ):
            with self.subTest(changes=changes):
                result = self.evaluate(
                    [(t, self.native()) for t in range(5)], self.trace(**changes)
                )
                self.assertEqual(result["status"], "failed")

    def test_missing_trace_or_periodic_evidence_is_unknown_and_invalid(self):
        for observations, frames in (
            ([(t, self.native()) for t in range(5)], {"available": False}),
            ([(0, self.native()), (4, self.native())], self.trace()),
        ):
            with self.subTest(observations=observations):
                result = self.evaluate(observations, frames)
                self.assertEqual(result["status"], "unknown")
                self.assertTrue(result["errors"])

    def test_fresh_browser_heartbeats_verify_host_scene_events_without_osr_or_raf_claims(self):
        result = self.evaluate(
            [(t, self.browser(t + 1, received=t * 60, raf_callbacks=t * 60)) for t in range(5)],
            {"available": False},
        )
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["checks"]["browser_scene_frame_events"]["range"], 0)
        self.assertEqual(result["checks"]["browser_fresh_reports"], 5)
        self.assertIn("Independent", result["scope"])

    def test_cached_browser_telemetry_cannot_verify_pause(self):
        result = self.evaluate([(t, self.browser(1)) for t in range(5)], {"available": False})
        self.assertEqual(result["status"], "unknown")
        self.assertTrue(any("fresh" in error for error in result["errors"]))

    def test_browser_heartbeat_stalling_mid_run_is_unknown(self):
        observations = [(t, self.browser(min(t, 2) + 1)) for t in range(11)]
        result = profile.pause_evidence("live", True, observations, {}, 0, 10)
        self.assertEqual(result["status"], "unknown")
        self.assertTrue(any("fresh" in error for error in result["errors"]))

    def test_browser_scene_event_counter_is_required_and_must_stay_still(self):
        for changed, expected in (({"frames": None}, "unknown"), ({"frames": 51}, "failed")):
            with self.subTest(changed=changed):
                observations = [
                    (t, self.browser(t + 1, **(changed if t == 2 else {}))) for t in range(5)
                ]
                self.assertEqual(self.evaluate(observations, {})["status"], expected)

    def test_browser_media_inside_live_scene_is_checked(self):
        video = {"time": 2.0, "paused": True, "ready": 4, "width": 3840, "height": 2160}
        stable = [(t, self.browser(t + 1, videos=[video])) for t in range(5)]
        result = self.evaluate(stable, {})
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["videos"][0]["position_range_seconds"], 0)
        for changes in ({"time": 2.1}, {"paused": False}, {"ready": 0}):
            with self.subTest(changes=changes):
                observations = [
                    (t, self.browser(t + 1, videos=[video | (changes if t == 2 else {})]))
                    for t in range(5)
                ]
                self.assertEqual(self.evaluate(observations, {})["status"], "failed")

    def test_video_display_accounting_detects_movement_despite_equal_loop_positions(self):
        observations = [
            (
                t,
                self.browser(
                    t + 1,
                    videos=[
                        {
                            "time": 0,
                            "paused": True,
                            "total_video_frames": 10 + t,
                            "dropped_video_frames": 0,
                        }
                    ],
                ),
            )
            for t in range(5)
        ]
        result = self.evaluate(observations, {})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["videos"][0]["display_accounting_range"], 4)

    def test_chromium_checks_both_browser_and_presenter_not_received_callbacks(self):
        observations = [
            (
                t,
                self.native(
                    renderer="Chromium SDR copy", received=t * 60, browser=self.browser(t + 1)
                ),
            )
            for t in range(5)
        ]
        self.assertEqual(self.evaluate(observations)["status"], "verified")
        observations[2][1]["browser"]["paused"] = False
        self.assertEqual(self.evaluate(observations)["status"], "failed")

    def test_retained_static_images_do_not_require_animated_output(self):
        result = self.evaluate([], {"available": True, "presented_frames": 0}, kind="image")
        self.assertEqual(result["status"], "not_applicable")
        self.assertFalse(result["errors"])
        self.assertIn("Retained static", result["scope"])
        self.assertEqual(self.evaluate([], paused=False)["status"], "not_requested")

    def test_mpvpaper_pause_has_no_invented_observation_freshness_or_decoder_count(self):
        observations = [(t, {"renderer": "mpv", "paused": True, "time": 2}) for t in range(5)]
        result = self.evaluate(observations, {}, kind="video")
        self.assertEqual(result["status"], "unknown")
        self.assertTrue(result["errors"])


class CpuEvidenceTests(unittest.TestCase):
    def test_per_pid_elapsed_time_does_not_turn_a_missing_interval_into_a_spike(self):
        cpu, elapsed = profile.cpu_interval((100_000_000, 1.0), (300_000_000, 1.2))
        self.assertAlmostEqual(cpu, 100)
        self.assertAlmostEqual(elapsed, 0.2)
        self.assertEqual(profile.cpu_interval(None, (100, 1.0)), (0.0, 0.0))
        with self.assertRaisesRegex(RuntimeError, "counter|time"):
            profile.cpu_interval((200, 1), (100, 2))

    def test_cpu_coverage_requires_both_measurement_boundaries(self):
        good = profile.cpu_window_evidence([t / 20 for t in range(201)], 0, 10, 0.05)
        self.assertTrue(good["mean_valid"])
        self.assertTrue(good["tails_valid"])
        for stamps in ([0, 0.05], [1 + t / 20 for t in range(181)]):
            result = profile.cpu_window_evidence(stamps, 0, 10, 0.05)
            self.assertFalse(result["mean_valid"])
            self.assertFalse(result["tails_valid"])

    def test_long_internal_gap_preserves_integrated_mean_but_not_tail_coverage(self):
        stamps = [t / 20 for t in range(201) if not 90 < t < 100]
        result = profile.cpu_window_evidence(stamps, 0, 10, 0.05)
        self.assertTrue(result["mean_valid"])
        self.assertFalse(result["tails_valid"])
        self.assertEqual(profile.cpu_window_evidence([], 0, 10, 0)["status"], "disabled")

    def test_nonpositive_absent_contender_is_not_an_expected_process(self):
        table = {10: {"ppid": 1}, 11: {"ppid": 10}, 22: {"ppid": 1}}
        wallpaper, contender, members = profile.sample_membership(table, [10, -1, 22, 0])
        self.assertEqual(wallpaper, {10, 11})
        self.assertEqual(contender, set())
        self.assertEqual(members, {10, 11, 22})

    def test_unexpected_worker_exception_sets_failure_and_releases_readiness(self):
        with patch.object(profile.threading, "Thread"):
            sampler = profile.Sampler(Path("/synthetic"), [10, -1], period=0.05)
        with patch.object(sampler, "_run", side_effect=OSError("synthetic write failure")):
            sampler.run()
        self.assertIn("synthetic write failure", sampler.failure)
        self.assertTrue(sampler.prepared.is_set())
        self.assertTrue(sampler.worker_completed)
        self.assertEqual(sampler.worker_exit, "error")

    def test_unexpected_worker_return_is_also_a_failure(self):
        with patch.object(profile.threading, "Thread"):
            sampler = profile.Sampler(Path("/synthetic"), [10, -1], period=0.05)
        with patch.object(sampler, "_run"):
            sampler.run()
        self.assertIn("without a stop request", sampler.failure)


class ContenderConfigurationTests(unittest.TestCase):
    def test_black_contender_requires_its_latest_mode_and_full_panel_acknowledgment(self):
        config = profile.contender_config(
            Path("/synthetic"),
            600,
            360,
            output="DP-5",
            black=True,
            monitor={"name": "DP-5", "width": 2560, "height": 1440, "scale": 1},
        )
        stats = {
            "state": "ready",
            "adapter": "NVIDIA RTX 4080",
            "presentation_clock": 1,
            "black_output": True,
            "canvas": {"width": 1280, "height": 720},
            "outputs": [
                {
                    "output": "DP-5",
                    "logical_width": 2560,
                    "logical_height": 1440,
                    "buffer_width": 2560,
                    "buffer_height": 1440,
                    "hidden": False,
                }
            ],
        }
        profile.validate_contender_telemetry(stats, config)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "contender.log"
            path.write_text(
                "startup notice\n"
                + json.dumps(stats)
                + "\n"
                + json.dumps(stats | {"black_output": False})
                + "\n"
            )
            latest = profile.read_contender_telemetry(path)
        with self.assertRaisesRegex(RuntimeError, "black_output"):
            profile.validate_contender_telemetry(latest, config)
        changed = stats | {"outputs": [stats["outputs"][0] | {"buffer_width": 1280}]}
        with self.assertRaisesRegex(RuntimeError, "dimensions"):
            profile.validate_contender_telemetry(changed, config)

    def test_black_output_covers_full_panel_without_enlarging_offscreen_work(self):
        config = profile.contender_config(
            Path("/synthetic"),
            600,
            360,
            output="DP-5",
            black=True,
            monitor={"name": "DP-5", "width": 2560, "height": 1440, "scale": 1, "transform": 0},
        )
        self.assertTrue(config["black_output"])
        self.assertEqual((config["width"], config["height"]), (1280, 720))
        self.assertEqual(config["stress"], 600)
        self.assertEqual(config["fps"], 360)
        self.assertEqual(
            config["outputs"],
            [
                {
                    "name": "DP-5",
                    "width": 2560,
                    "height": 1440,
                    "pixel_width": 2560,
                    "pixel_height": 1440,
                }
            ],
        )

    def test_black_output_separates_transformed_logical_and_pixel_dimensions(self):
        config = profile.contender_config(
            Path("/synthetic"),
            300,
            144,
            output="rotated",
            black=True,
            monitor={
                "name": "rotated",
                "width": 2560,
                "height": 1440,
                "scale": 1.25,
                "transform": 1,
            },
        )
        self.assertEqual(
            config["outputs"][0],
            {
                "name": "rotated",
                "width": 1152,
                "height": 2048,
                "pixel_width": 1440,
                "pixel_height": 2560,
            },
        )

    def test_black_output_requires_valid_current_metadata(self):
        valid = {"name": "DP-5", "width": 2560, "height": 1440, "scale": 1, "transform": 0}
        for monitor in [
            None,
            {},
            valid | {"name": "other"},
            valid | {"width": 0},
            valid | {"scale": 0},
            valid | {"scale": float("nan")},
            valid | {"transform": 8},
        ]:
            with self.subTest(monitor=monitor), self.assertRaisesRegex(
                ValueError, "Black contender|Invalid black contender"
            ):
                profile.contender_config(
                    Path("/synthetic"), 300, 360, output="DP-5", black=True, monitor=monitor
                )

    def test_default_contender_preserves_the_visible_window_without_monitor_queries(self):
        config = profile.contender_config(Path("/synthetic"), 400, 144)
        self.assertFalse(config["black_output"])
        self.assertEqual(config["outputs"], [{"name": "DP-2", "width": 1280, "height": 720}])
        self.assertFalse(profile.parse_args([]).contender_black)
        self.assertTrue(profile.parse_args(["--contender-black"]).contender_black)


class ValidationTests(unittest.TestCase):
    def test_static_and_native_video_do_not_require_a_scene_frame_counter(self):
        for kind, renderer in [("image", "native image"), ("video", "mpv")]:
            with self.subTest(kind=kind):
                self.assertEqual(
                    profile.wallpaper_errors(
                        kind, False, {}, {"state": "ready", "renderer": renderer}
                    ),
                    [],
                )

    def test_frozen_live_scene_is_invalid(self):
        errors = profile.wallpaper_errors("live", False, {"frames": 50}, {"frames": 50})
        self.assertTrue(any("frames" in error for error in errors))

    def test_missing_or_failed_wallpaper_is_invalid(self):
        self.assertTrue(profile.wallpaper_errors("image", False, {}, {}))
        self.assertTrue(profile.wallpaper_errors("video", False, {}, {"state": "failed"}))

    def test_argument_defaults_and_high_fps_configuration(self):
        args = profile.parse_args(["--wallpaper-fps", "360", "--contender-output", "DP-5"])
        self.assertEqual(args.wallpaper_fps, 360)
        self.assertEqual(args.contender_output, "DP-5")
        self.assertEqual(args.max_cpu_temp, 96)
        self.assertEqual(args.start_cpu_temp, 95.5)

    def test_nested_preset_hash_changes_with_shared_parent_or_renamed_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            profile, "ROOT", Path(directory)
        ):
            studio = Path(directory) / "examples" / "stress-studio"
            preset = studio / "shader-heavy"
            preset.mkdir(parents=True)
            (preset / "index.html").write_text("../shader.js")
            shared = studio / "shader.js"
            shared.write_text("version one")
            first = profile.source_evidence("stress-studio/shader-heavy")
            shared.write_text("version two")
            second = profile.source_evidence("stress-studio/shader-heavy")
            shared.rename(studio / "renamed.js")
            third = profile.source_evidence("stress-studio/shader-heavy")
            self.assertNotEqual(first["sha256"], second["sha256"])
            self.assertNotEqual(second["sha256"], third["sha256"])
            self.assertEqual(first["scope"], "examples/stress-studio")

    def test_startup_failure_preserves_an_invalid_row_and_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            monitor = MagicMock()
            monitor.failure = "Free VRAM fell below limit"
            monitor.rows = [{"monotonic": 1.0, **metrics(vram_free_mib=1)}]
            monitor.snapshot.side_effect = profile.GuardViolation(monitor.failure)
            with patch.object(profile, "SafetyMonitor", return_value=monitor), patch.object(
                profile, "api", create=True
            ), patch.object(profile, "assign", create=True) as assign, patch.object(
                profile, "contender"
            ) as contender:
                row = profile.run_case(
                    profile.parse_args([]), Path(directory), "1-gpu", "gpu", 123, []
                )
            self.assertFalse(row["valid"])
            self.assertFalse(row["completed"])
            self.assertEqual(row["measured_seconds"], 0)
            assign.assert_not_called()
            contender.assert_not_called()
            for filename in ["guard.csv", "gpu.csv", "process.csv", "telemetry.json"]:
                self.assertTrue((Path(directory) / "1-gpu" / filename).exists())

    def test_contender_cleanup_timeout_preserves_wallpaper_clear_and_invalid_artifacts(self):
        for final_error in (
            profile.subprocess.TimeoutExpired(["synthetic contender"], 3),
            OSError("synthetic final wait failure"),
        ):
            with self.subTest(
                final_error=type(final_error).__name__
            ), tempfile.TemporaryDirectory() as directory:
                monitor = MagicMock()
                monitor.failure = None
                monitor.rows = [{"monotonic": 1.0, **metrics()}]
                monitor.snapshot.return_value = metrics()
                monitor.wait.side_effect = RuntimeError("synthetic warmup failure")
                child = MagicMock(pid=456)
                child.wait.side_effect = [
                    profile.subprocess.TimeoutExpired(["synthetic contender"], 3),
                    final_error,
                ]
                log = MagicMock()
                with patch.object(profile, "SafetyMonitor", return_value=monitor), patch.object(
                    profile, "api", create=True
                ) as api, patch.object(profile, "assign", create=True), patch.object(
                    profile, "guarded_ready", return_value={"frames": 40}
                ), patch.object(
                    profile, "contender", return_value=(child, log)
                ):
                    row = profile.run_case(
                        profile.parse_args([]), Path(directory), "1-gpu", "gpu", 123, []
                    )
                self.assertFalse(row["valid"])
                self.assertFalse(row["completed"])
                self.assertTrue(any("Contender cleanup failed" in error for error in row["errors"]))
                child.terminate.assert_called_once()
                child.kill.assert_called_once()
                self.assertEqual(child.wait.call_count, 2)
                log.close.assert_called_once()
                self.assertEqual(api.call_args.args, ("clear",))
                self.assertEqual(api.call_args.kwargs, {"outputs": ["DP-2"]})
                for filename in ("guard.csv", "gpu.csv", "process.csv", "telemetry.json"):
                    self.assertTrue((Path(directory) / "1-gpu" / filename).is_file())
                profile.write_report(Path(directory), {"arguments": {}}, [row])
                published = json.loads((Path(directory) / "report.json").read_text())["runs"][0]
                self.assertFalse(published["valid"])
                self.assertTrue(
                    any("Contender cleanup failed" in error for error in published["errors"])
                )

    def test_black_scene_is_not_counted_and_does_not_start_contender(self):
        with tempfile.TemporaryDirectory() as directory:
            monitor = MagicMock()
            monitor.failure = None
            monitor.rows = [{"monotonic": 1.0, **metrics()}]
            monitor.snapshot.return_value = metrics()
            with patch.object(profile, "SafetyMonitor", return_value=monitor), patch.object(
                profile, "api", create=True
            ), patch.object(profile, "assign", create=True), patch.object(
                profile, "guarded_ready", return_value={"frames": 40, "probe_max_scrgb": 0}
            ), patch.object(
                profile, "contender"
            ) as contender:
                row = profile.run_case(
                    profile.parse_args([]), Path(directory), "1-chromium", "chromium", 123, []
                )
            self.assertFalse(row["valid"])
            self.assertEqual(row["measured_seconds"], 0)
            self.assertTrue(any("black" in error for error in row["errors"]))
            contender.assert_not_called()

    def test_main_retains_completed_rows_when_the_next_case_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for filename in [
                "examples/prism/index.html",
                "runtime/wallpaper.js",
                "lab/build/presenter",
                "lab/electron.cjs",
                "target/release/wallpaperdb-native",
            ]:
                path = root / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic fixture")
            good = {
                "name": "1-idle",
                "valid": True,
                "errors": [],
                "contender": {},
                "wallpaper": {},
                "cpu": {},
            }
            bad = {**good, "name": "1-gpu", "valid": False, "errors": ["guard stopped run"]}
            connection = MagicMock()
            connection.__enter__.return_value.getsockopt.return_value = struct.pack(
                "3i", 123, 1000, 1000
            )
            with patch.object(profile, "ROOT", root), patch.object(
                profile, "load_controls"
            ), patch.object(profile, "processes", return_value={}), patch.object(
                profile, "hypr", return_value=[], create=True
            ), patch.object(
                profile,
                "saved_assignments",
                return_value=contextlib.nullcontext({"groups": []}),
                create=True,
            ), patch.object(
                profile, "CONTROL", root / "fake.sock", create=True
            ), patch.object(
                profile.socket, "socket", return_value=connection
            ), patch.object(
                profile, "run_case", side_effect=[good, bad]
            ) as run_case:
                result = profile.main(["--output-dir", str(root / "report")])
            saved = json.loads((root / "report" / "report.json").read_text())
            self.assertEqual(result, 1)
            self.assertEqual(run_case.call_count, 2)
            self.assertEqual(saved["runs"], [good, bad])

    def test_pointer_summary_records_motion_without_moving_the_pointer(self):
        telemetry = [
            {"surfaces": [{"output": "DP-2", "telemetry": {"pointer": {"x": x, "y": 1}}}]}
            for x in [0.2, 0.5, 0.2]
        ]
        result = profile.pointer_summary(telemetry)["DP-2"]
        self.assertTrue(result["changed"])
        self.assertEqual(result["x"], {"first": 0.2, "last": 0.2, "min": 0.2, "max": 0.5})

    def test_process_family_tolerates_an_absent_contender_and_exited_members(self):
        topology = {10: {"ppid": 1}, 11: {"ppid": 10}, -1: {}, 12: {}}
        self.assertEqual(profile.family(topology, [10]), {10, 11})


if __name__ == "__main__":
    unittest.main()
