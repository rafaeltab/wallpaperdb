import unittest
from game_bench_live import FrameStats, MangoHudStream
from game_bench_data import summarize, completed_comparison


class LiveTests(unittest.TestCase):
    def test_long_live_plot_is_bounded_and_preserves_the_largest_hitch(self):
        stats = FrameStats()
        for i in range(20000):
            stats.append(i * 0.1, 250 if i == 17 else 10)
        self.assertLessEqual(len(stats.plot()), 1200)
        self.assertEqual(sum(point["count"] for point in stats.plot()), 20000)
        self.assertEqual(max(point["max_ms"] for point in stats.plot()), 250)
        self.assertEqual(stats.values.itemsize, 8)

    def test_exact_statistics_match_the_existing_frame_analyzer(self):
        values = [7.321, 8.987, 10.021, 99.98, 7.654] * 200
        stats = FrameStats()
        now = 0
        for value in values:
            now += value / 1000
            stats.append(now, value)
        expected = summarize([{"frame_ms": value} for value in values])
        result = stats.summary(exact=True)
        for key, value in expected.items():
            self.assertAlmostEqual(result[key], value, places=6, msg=key)

    def test_csv_stream_preserves_partial_lines_and_rejects_sparse_samples(self):
        stream = MangoHudStream()
        stream.feed("os,cpu\nLinux,CPU\nfps,frametime,elapsed\n100,10,10000000\n5,200,21000")
        self.assertEqual(len(stream.stats.values), 1)
        stream.feed("0000\n100,10,220000000\n")
        stream.validate()
        self.assertEqual(stream.stats.summary()["worst_ms"], 200)
        stream.feed("100,10,1220000000\n")
        with self.assertRaisesRegex(ValueError, "Sparse"):
            stream.validate()

    def test_manual_phases_can_have_different_lengths(self):
        runs = []
        for condition, count, duration in [("control", 200, 10), ("wallpaper", 75, 15)]:
            stats = FrameStats()
            for i in range(count):
                stats.append((i + 1) * duration / 1000, duration)
            runs.append(
                dict(
                    condition=condition,
                    repeat=1,
                    valid=True,
                    identity={"collector": "MangoHud", "mode": "manual"},
                    summary=stats.summary(exact=True),
                )
            )
        self.assertAlmostEqual(completed_comparison(runs)["median_fps_change_percent"], -100 / 3)


class ContinuousLogTests(unittest.TestCase):
    def test_loading_and_transition_rows_are_excluded_from_independent_phases(self):
        import tempfile
        from pathlib import Path
        from game_bench_live import MangoHudLog

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cs2_2026.csv"
            tail = MangoHudLog(Path(directory))
            path.write_text("system,info\nfps,frametime,elapsed\n1,1000,1000000000\n")
            tail.read()  # Loading is outside both phases.
            control = MangoHudStream()
            control.feed(tail.header + "\n")
            with path.open("a") as file:
                file.write("100,10,1010000000\n100,10,10200")
            control.feed(tail.read())
            self.assertEqual(len(control.stats.values), 1)
            with path.open("a") as file:
                file.write("00000\n")
            control.feed(tail.read())
            control.validate()
            with path.open("a") as file:
                file.write("1,1000,2020000000\n")
            tail.read()  # Wallpaper setup is also excluded.
            wallpaper = MangoHudStream()
            wallpaper.feed(tail.header + "\n")
            with path.open("a") as file:
                file.write("50,20,2040000000\n50,20,2060000000\n50,20,2080000000\n")
            wallpaper.feed(tail.read())
            wallpaper.validate()
            self.assertEqual(control.stats.summary()["frames"], 2)
            self.assertEqual(wallpaper.stats.summary()["frames"], 3)
            self.assertEqual(wallpaper.stats.summary()["worst_ms"], 20)
