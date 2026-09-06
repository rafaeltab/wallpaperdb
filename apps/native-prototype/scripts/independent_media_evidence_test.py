"""Saved-artifact evidence tests; safe for unittest discovery without desktop access."""

import csv
import importlib.util
import json
import tempfile
import sys
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "wallpaper_independent_media_evidence",
    Path(__file__).with_name("independent_media_evidence.py"),
)
evidence = importlib.util.module_from_spec(SPEC)
# Register the module before execution so dataclass introspection is stable.
sys.modules[SPEC.name] = evidence
SPEC.loader.exec_module(evidence)


def observation(stamp, position, duration=8, age=0.02, latency=0.004, paused=False):
    def prop(value):
        return {
            "value": value,
            "sample_requested_at_monotonic": stamp - latency / 2,
            "replied_at_monotonic": stamp + latency / 2,
            "age_ms": age * 1000,
            "pending": True,
            "request_pending_since_monotonic": stamp + latency / 2 + age,
        }

    return {
        "observed_at": stamp + latency / 2 + age,
        "origin": "periodic",
        "stats": {
            "pid": 42,
            "paused": paused,
            "media_properties": {
                "time-pos": prop(position),
                "duration": prop(duration),
            },
        },
    }


def properties(observations, start=90, end=150):
    return evidence.collect_properties(observations, start, end, evidence.Options())


def targets(lead_ms=0, flags=1, scale=1):
    return [
        {
            "monotonic": 20 + index / 60,
            "value": (1_000_000_000_000 + index * 1_000_000_000 // 60 + lead_ms * 1e6) / scale,
            "value2": 1_000_000_000_000 + index * 1_000_000_000 // 60,
            "flags": flags,
            "frame": index,
        }
        for index in range(181)
    ]


class PlaybackEvidenceTests(unittest.TestCase):
    def analyze(self, observations, start=90, end=150):
        streams = properties(observations, start, end)
        return evidence.analyze_positions(streams, evidence.Options(), start, end)

    def test_unwraps_observed_loop_candidates_at_realtime(self):
        result = self.analyze([observation(100 + i, (6.5 + i) % 8) for i in range(13)])
        self.assertEqual(result["single_wrap_candidates"], 2)
        self.assertEqual(result["accepted_intervals"], 12)
        self.assertAlmostEqual(result["position_advance_seconds"], 12)
        self.assertAlmostEqual(result["rate_media_seconds_per_wall_second"], 1)
        self.assertEqual(result["status"], "compatible_with_realtime")

    def test_duration_sized_gap_cannot_establish_loop_count_or_stall(self):
        result = self.analyze([observation(100, 2), observation(108, 2)])
        self.assertEqual(result["accepted_intervals"], 0)
        self.assertEqual(result["rejected_intervals"]["gap_at_least_source_duration"], 1)
        self.assertIsNone(result["rate_media_seconds_per_wall_second"])

    def test_uncertainty_can_make_a_nearly_duration_sized_gap_ambiguous(self):
        result = self.analyze([observation(100, 2), observation(107.999, 1.999)])
        self.assertEqual(result["rejected_intervals"]["gap_at_least_source_duration"], 1)

    def test_stale_samples_are_excluded_and_pending_new_request_is_not_stale(self):
        fresh = observation(100, 2)
        duplicate = json.loads(json.dumps(fresh))
        duplicate["observed_at"] += 4
        stale_unique = observation(105, 7, age=4)
        stream = properties([fresh, duplicate, stale_unique])["time-pos"]
        self.assertEqual(len(stream["samples"]), 1)
        self.assertEqual(stream["duplicate_observations"], 1)
        self.assertEqual(stream["rejected_samples"]["stale_at_observation"], 1)
        self.assertEqual(stream["samples"][0]["value"], 2)

    def test_slow_async_reply_is_rejected_despite_recent_delivery(self):
        stream = properties([observation(100, 2, latency=1)])["time-pos"]
        self.assertEqual(stream["rejected_samples"]["request_reply_latency"], 1)
        self.assertFalse(stream["samples"])

    def test_equal_values_with_new_timestamps_are_real_stationary_samples(self):
        result = self.analyze([observation(100 + i, 2) for i in range(5)])
        self.assertEqual(result["position_samples"], 5)
        self.assertEqual(result["status"], "slower_than_realtime_or_paused")

    def test_paused_intervals_do_not_become_slow_playback_findings(self):
        result = self.analyze([observation(100 + i, 2, paused=True) for i in range(5)])
        self.assertEqual(result["accepted_intervals"], 0)
        self.assertEqual(result["rejected_intervals"]["paused_or_pause_transition"], 4)

    def test_changed_duration_cannot_be_unwrapped(self):
        result = self.analyze(
            [observation(100 + i, i, duration=8 if i < 2 else 9) for i in range(5)]
        )
        self.assertEqual(result["status"], "duration_changed")

    def test_warmup_property_reply_is_excluded(self):
        stream = properties([observation(99, 7), observation(101, 1)], start=100)["time-pos"]
        self.assertEqual(len(stream["samples"]), 1)
        self.assertEqual(stream["rejected_samples"]["outside_measurement_window"], 1)

    def test_drop_property_reset_is_not_reported_as_a_drop_total(self):
        points = [observation(100 + i, i) for i in range(4)]
        for point, drops in zip(points, (4, 6, 0, 1)):
            point["stats"]["media_properties"]["frame-drop-count"] = dict(
                point["stats"]["media_properties"]["time-pos"], value=drops
            )
        stream = properties(points)["frame-drop-count"]
        self.assertEqual(stream["observed_value_decreases"], 1)
        self.assertIsNone(stream["sampled_counter_delta_if_no_observed_reset"])


class TargetEvidenceTests(unittest.TestCase):
    def test_due_requests_have_positive_age_and_no_early_classification(self):
        result = evidence.analyze_targets(targets(-2), evidence.Options())
        self.assertEqual(result["timebase_status"], "consistent_with_nanosecond_clock")
        self.assertEqual(result["classification"], "no_early_requests_observed")
        self.assertAlmostEqual(result["target_age_ms"]["p50"], 2)

    def test_50ms_early_requests_are_detected(self):
        result = evidence.analyze_targets(targets(50), evidence.Options())
        self.assertEqual(result["classification"], "systematic_early_requests")
        self.assertEqual(result["early_requests"], 181)
        self.assertAlmostEqual(result["target_lead_ms"]["p50"], 50)

    def test_wrong_units_never_receive_an_early_or_due_verdict(self):
        result = evidence.analyze_targets(targets(scale=1000), evidence.Options())
        self.assertEqual(result["timebase_status"], "incompatible_or_large_clock_offset")
        self.assertEqual(result["classification"], "unavailable_timebase")
        self.assertIsNone(result["early_requests"])

    def test_redraw_repeat_and_zero_targets_are_not_due_time_evidence(self):
        rows = targets(-1) + targets(50, flags=3) + targets(50, flags=5)
        rows.append(dict(targets()[0], value=0))
        result = evidence.analyze_targets(rows, evidence.Options())
        self.assertEqual(result["eligible_rows"], 181)
        self.assertEqual(result["excluded_rows"]["redraw_or_repeat"], 362)
        self.assertEqual(result["excluded_rows"]["zero_target"], 1)
        self.assertEqual(result["classification"], "no_early_requests_observed")

    def test_one_early_outlier_is_not_hidden_in_the_median(self):
        rows = targets(-1)
        rows[-1]["value"] = rows[-1]["value2"] + 50_000_000
        result = evidence.analyze_targets(rows, evidence.Options())
        self.assertEqual(result["classification"], "early_requests_observed")
        self.assertEqual(result["early_requests"], 1)


class ArtifactEvidenceTests(unittest.TestCase):
    def test_final_boundary_rejects_frozen_cached_reply_using_end_as_lower_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            (path / "telemetry.json").write_text("[]")
            observations, errors = evidence.load_observations(
                {"end": 140, "final_telemetry": observation(101, 2)["stats"]}, path, "A"
            )
            stream = properties(observations, 100, 140)["time-pos"]
            self.assertFalse(errors)
            self.assertEqual(stream["rejected_samples"]["stale_at_observation"], 1)

    def test_absent_idle_csv_is_unavailable_not_an_artifact_error(self):
        with tempfile.TemporaryDirectory() as folder:
            result = evidence.read_frame_csv(
                Path(folder) / "absent.csv", 100, 140, evidence.Options(), required=False
            )
            self.assertFalse(result["available"])
            self.assertFalse(result["errors"])

    def test_csv_counts_are_windowed_and_presentation_is_per_output(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "wallpaper-frames.csv"
            with path.open("w") as handle:
                writer = csv.writer(handle)
                writer.writerow(
                    [
                        "monotonic",
                        "event",
                        "frame",
                        "output",
                        "value",
                        "value2",
                        "sequence",
                        "flags",
                    ]
                )
                writer.writerow([9, "media", 0, "", 1, 0, 0, 1])
                writer.writerow([10.5, "media", 1, "", 2, 0, 0, 1])
                writer.writerow([11, "cpu", 1, "", 3, 0, 0, 0])
                writer.writerow([12.1, "presented", 1, "A", 11.9, 0, 1, 0])
                writer.writerow([12.1, "presented", 1, "B", 11.9, 0, 1, 0])
            result = evidence.read_frame_csv(path, 10, 12, evidence.Options())
            self.assertEqual(result["media_render_rows"], 1)
            self.assertEqual(result["scene_submission_rows"], 1)
            self.assertEqual(result["outputs"]["A"]["presented_frames"], 1)
            self.assertEqual(result["outputs"]["B"]["presented_hz"], 0.5)

    def test_new_drop_variant_preserves_applied_policy_without_inventing_fps(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.json"
            run_dir = Path(folder) / "1-gpu-independent-drop"
            run_dir.mkdir()
            (run_dir / "telemetry.json").write_text("[]")
            (run_dir / "wallpaper-frames.csv").write_text(
                "monotonic,event,frame,output,value,value2,sequence,flags\n"
                "101,media,1,,0.2,0,0,1\n"
            )
            path.write_text(
                json.dumps(
                    {
                        "manifest": {"arguments": {"wallpaper_output": "TARGET"}},
                        "runs": [
                            {
                                "name": run_dir.name,
                                "start": 100,
                                "end": 105,
                                "valid": True,
                                "final_telemetry": {
                                    "media_decoder_drop_enabled": True,
                                    "media_framedrop_requested": "decoder+vo",
                                    "media_framedrop": "decoder+vo",
                                    "media_framedrop_verified_at_init": True,
                                },
                            }
                        ],
                    }
                )
            )
            row = evidence.analyze_report(path, evidence.Options())["runs"][0]
            self.assertEqual(row["media_drop_policy"]["applied"], "decoder+vo")
            self.assertEqual(row["frame_csv"]["media_render_call_hz"], 0.2)
            self.assertIsNone(row["position_evidence"]["rate_media_seconds_per_wall_second"])

    def test_report_loading_does_not_substitute_other_output_telemetry(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.json"
            run_dir = Path(folder) / "1-gpu-independent"
            run_dir.mkdir()
            wrong = observation(101, 2)
            (run_dir / "telemetry.json").write_text(
                json.dumps(
                    [
                        {
                            "monotonic": wrong["observed_at"],
                            "surfaces": [{"output": "OTHER", "telemetry": wrong["stats"]}],
                        }
                    ]
                )
            )
            path.write_text(
                json.dumps(
                    {
                        "manifest": {"arguments": {"wallpaper_output": "TARGET"}},
                        "runs": [{"name": run_dir.name, "start": 100, "end": 105, "valid": True}],
                    }
                )
            )
            result = evidence.analyze_report(path, evidence.Options())
            self.assertEqual(result["runs"][0]["observations"], 0)


if __name__ == "__main__":
    unittest.main()
