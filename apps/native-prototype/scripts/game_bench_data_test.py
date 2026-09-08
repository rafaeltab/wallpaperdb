import io
import unittest

from game_bench_data import (
    parse_mangohud,
    parse_source2,
    segment,
    summarize,
    envelope,
    paired_comparison,
    Source2Stream,
    completed_comparison,
)


class FrameEvidenceTests(unittest.TestCase):
    def test_live_stream_waits_for_complete_rows_and_preserves_repeated_tick_hitches(self):
        stream = Source2Stream()
        stream.feed(
            "demo tick,frame start time,frame start delta,frame swap time,frame swap delta,FPS variability\n1,8,0,8.002,0,0\n2,8.004,0.004,"
        )
        self.assertEqual(stream.partial(1, 4), [])
        stream.feed("8.006,0.004,0\n2,8.204,0.2,8.256,0.25,0\n3,8.260,0.056,8.266,0.01,0\n")
        selected = stream.partial(1, 4)
        self.assertEqual([row["tick"] for row in selected], [2, 2, 3])
        self.assertEqual([row["frame_ms"] for row in selected], [4, 250, 10])
        self.assertAlmostEqual(selected[-1]["time_s"], 0.264)
        self.assertEqual(stream.last_tick, 3)

    def test_stopping_does_not_turn_an_incomplete_pair_into_a_comparison(self):
        runs = [
            dict(
                repeat=1,
                condition="control",
                valid=True,
                summary={"average_fps": 200, "p99_ms": 10},
            )
        ]
        self.assertIsNone(completed_comparison(runs))
        runs.append(
            dict(
                repeat=1,
                condition="wallpaper",
                valid=True,
                summary={"average_fps": 180, "p99_ms": 12},
            )
        )
        runs.append(
            dict(
                repeat=2,
                condition="wallpaper",
                valid=True,
                summary={"average_fps": 170, "p99_ms": 14},
            )
        )
        result = completed_comparison(runs)
        self.assertEqual(len(result["pairs"]), 1)
        self.assertAlmostEqual(result["median_fps_change_percent"], -10)

    def test_source2_keeps_repeated_tick_hitches_and_uses_swap_time(self):
        frames = parse_source2(
            io.StringIO(
                "demo tick,frame start time,frame start delta,frame swap time,frame swap delta,FPS variability\n"
                "1,8,0,8.002,0,0\n2,8.004,0.004,8.006,0.004,0\n"
                "2,8.204,0.2,8.256,0.25,0\n3,8.260,0.056,8.266,0.01,0\n"
            )
        )
        self.assertEqual([r["tick"] for r in frames], [2, 2, 3])
        self.assertEqual([r["frame_ms"] for r in frames], [4, 250, 10])
        self.assertEqual([r["start_ms"] for r in frames], [4, 200, 56])
        self.assertEqual(summarize(frames)["over_50ms"], 1)

    def test_segment_rejects_missing_ticks_and_keeps_exact_boundaries(self):
        frames = [dict(tick=i, time_s=i / 100, frame_ms=10) for i in range(1, 101)]
        selected = segment(frames, 10, 90)
        self.assertEqual(len(selected), 80)
        self.assertEqual(selected[0]["tick"], 11)
        self.assertEqual(selected[-1]["tick"], 90)
        self.assertAlmostEqual(selected[0]["time_s"], 0.01)
        with self.assertRaises(ValueError):
            segment(frames[:50], 10, 90)
        with self.assertRaises(ValueError):
            segment(frames[:30] + frames[31:], 10, 90)

    def test_sparse_mangohud_log_is_not_individual_frames(self):
        with self.assertRaises(ValueError):
            parse_mangohud(io.StringIO("frametime,elapsed\n4,1000000\n4,1001000000\n"))

    def test_raw_frames_survive_parser_including_a_long_hitch(self):
        source = io.StringIO(
            "os,cpu,gpu\nLinux,CPU,GPU\nfps,frametime,gpu_load,elapsed\n100,10,30,10000000\n5,200,90,210000000\n100,10,40,220000000\n"
        )
        frames = parse_mangohud(source)
        self.assertEqual([r["frame_ms"] for r in frames], [10, 200, 10])
        self.assertAlmostEqual(frames[-1]["time_s"], 0.22)
        self.assertEqual(summarize(frames)["over_50ms"], 1)

    def test_reject_aggregate_or_nonmonotonic_capture(self):
        for source in [
            "Average FPS,1% Min FPS\n200,150\n",
            "fps,frametime,elapsed\n100,10,20\n100,10,10\n",
        ]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                parse_mangohud(io.StringIO(source))

    def test_reject_invalid_frame_instead_of_silently_discarding_it(self):
        for value in ["nan", "inf", "0", "-10", "broken"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_mangohud(io.StringIO(f"fps,frametime,elapsed\n100,{value},10000000\n"))

    def test_average_fps_is_frames_over_time_not_average_instantaneous_fps(self):
        frames = [{"time_s": 0.01, "frame_ms": 10}, {"time_s": 0.1, "frame_ms": 90}]
        result = summarize(frames)
        self.assertAlmostEqual(result["average_fps"], 20)
        self.assertEqual(result["worst_ms"], 90)

    def test_plot_buckets_preserve_isolated_spikes(self):
        frames = [{"time_s": i / 1000, "frame_ms": 100 if i == 521 else 1} for i in range(1000)]
        points = envelope(frames, 10)
        self.assertEqual(len(points), 10)
        self.assertEqual(max(row["max_ms"] for row in points), 100)
        self.assertEqual(sum(row["count"] for row in points), len(frames))

    def test_comparison_requires_complete_valid_pairs(self):
        runs = [
            dict(
                condition="control",
                repeat=1,
                valid=True,
                summary={"average_fps": 200, "p99_ms": 10},
            ),
            dict(
                condition="wallpaper",
                repeat=1,
                valid=False,
                summary={"average_fps": 180, "p99_ms": 12},
            ),
        ]
        with self.assertRaises(ValueError):
            paired_comparison(runs)
        runs[1]["valid"] = True
        result = paired_comparison(runs)
        self.assertAlmostEqual(result["pairs"][0]["fps_change_percent"], -10)
        self.assertEqual(result["pairs"][0]["p99_change_ms"], 2)
        runs[0]["identity"] = {"build": "a", "width": 1600}
        runs[1]["identity"] = {"build": "a", "width": 2560}
        with self.assertRaises(ValueError):
            paired_comparison(runs)


if __name__ == "__main__":
    unittest.main()
