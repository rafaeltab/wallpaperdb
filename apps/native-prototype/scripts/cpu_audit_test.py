"""Retrospective CPU-auditor checks with synthetic files only."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "wallpaper_cpu_audit", Path(__file__).with_name("cpu_audit.py")
)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


class RetrospectiveCpuTests(unittest.TestCase):
    def run_audit(self, missing=None, end=1.1):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "1-gpu").mkdir()
            rows, timeline = [], []
            for stamp in (1.0, 1.05, 1.1):
                timeline.append(
                    {
                        "monotonic": stamp,
                        "wallpaper_cpu": 40,
                        "contender_cpu": 0,
                        "compositor_cpu": 0,
                        "profiler_cpu": 0,
                    }
                )
                for pid in (10, 11):
                    if (stamp, pid) != missing:
                        rows.append(f"{stamp},{pid},renderer,wallpaper,20,1\n")
            (folder / "1-gpu" / "process.csv").write_text(
                "monotonic,pid,name,role,cpu_percent_one_core,rss_mib\n" + "".join(rows)
            )
            return audit.audit_run(
                {
                    "name": "1-gpu",
                    "valid": True,
                    "start": 1,
                    "end": end,
                    "process_topology": {"10": {}, "11": {}, "-1": {}},
                    "cpu_timeline": timeline,
                },
                folder,
                20,
            )

    def test_complete_historical_membership_excludes_the_absent_contender_sentinel(self):
        result = self.run_audit()
        self.assertTrue(result["mean_valid"])
        self.assertTrue(result["tails_valid"])
        self.assertEqual(result["expected_positive_pid_count"], 2)
        self.assertEqual(result["excluded_nonpositive_sentinels"], 1)
        self.assertEqual(result["raw_per_pid_counter_rows"], 0)

    def test_one_missing_pid_read_makes_historical_cpu_tails_unknown(self):
        result = self.run_audit(missing=(1.05, 11))
        self.assertFalse(result["tails_valid"])
        self.assertFalse(result["mean_valid"])
        self.assertGreater(result["sampling_issue_count"], 0)

    def test_complete_csv_membership_cannot_hide_an_early_sampler_stop(self):
        result = self.run_audit(end=10)
        self.assertFalse(result["mean_valid"])
        self.assertEqual(result["coverage"]["last_sample_before_end_seconds"], 8.9)


if __name__ == "__main__":
    unittest.main()
