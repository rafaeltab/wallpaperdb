"""Publication regressions with synthetic captures only; no desktop or GPU work."""

from contextlib import redirect_stderr, redirect_stdout
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote


SPEC = importlib.util.spec_from_file_location(
    "wallpaper_stress_results", Path(__file__).with_name("stress-results.py")
)
results = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(results)


def cpu_stats(mean=40):
    return {
        "samples": 20,
        "mean": mean,
        "mean_method": "time-weighted process CPU-counter deltas",
        "sample_mean": mean + 1,
        "p50": mean,
        "p95": mean + 5,
        "p99": mean + 10,
        "p999": mean + 15,
        "max": mean + 20,
    }


def evidence(mean=True, tails=True):
    return {
        "status": "verified" if tails else "partial" if mean else "unknown",
        "mean_valid": mean,
        "tails_valid": tails,
        "errors": [] if tails else ["Synthetic CPU sample coverage gap"],
    }


def frame_stats(fps=120):
    return {
        "available": True,
        "presented_frames": fps,
        "presented_hz": fps,
        "presentation_ms": {"samples": fps - 1, "p99": 12, "p999": 15, "max": 20},
        "sequence_gaps": {"1": 117, "2": 1},
        "media_updates": 0,
        "media_update_hz": 0,
        "last_media_update": None,
    }


def fixture(name="1-gpu", mean=40):
    return {
        "name": name,
        "valid": True,
        "completed": True,
        "errors": [],
        "start": 10,
        "end": 11,
        "measured_seconds": 1,
        "cpu": cpu_stats(mean),
        "cpu_by_role": {
            role: cpu_stats(mean) for role in ("wallpaper", "contender", "compositor", "profiler")
        },
        "cpu_evidence": evidence(),
        "cpu_timeline": [
            {
                "monotonic": stamp,
                "wallpaper_cpu": value,
                "contender_cpu": 10,
                "compositor_cpu": 5,
                "profiler_cpu": 2,
                "rss_mib": 200,
            }
            for stamp, value in ((10, 0), (10.5, mean), (11, mean))
        ],
        "wallpaper": frame_stats(),
        "contender": frame_stats(144),
        "wallpaper_timeline": [[0.01, 5], [0.08, 90], [0.11, 8]],
        "timeline": [[0.02, 7], [0.1, 10]],
        "resources": {},
        "gpu_timeline": [
            {"monotonic": 9.9, "vram_free_mib": 1, "ram_available_mib": 1},
            {
                "monotonic": 10.01,
                "vram_free_mib": 7000,
                "ram_available_mib": 16000,
                "temperature_c": 55,
            },
            {
                "monotonic": 10.08,
                "vram_free_mib": 6800,
                "ram_available_mib": 15000,
                "temperature_c": 56,
            },
        ],
        "initial_telemetry": {"renderer": "Lua / OpenGL", "state": "ready", "frames": 100},
        "measurement_initial_telemetry": {"renderer": "Lua / OpenGL", "frames": 200},
        "final_telemetry": {"renderer": "Lua / OpenGL", "frames": 320},
        "background_activity_flag": False,
    }


def manifest(source="stress-studio/shader-heavy"):
    return {
        "binary_sha256": "a" * 64,
        "runtime_sha256": "b" * 64,
        "arguments": {
            "source": source,
            "wallpaper_output": "WDB-STRESS",
            "wallpaper_fps": 120,
            "contender_output": "DP-2",
            "contender_fps": 144,
            "sample_hz": 20,
        },
        "monitors": [
            {"name": "WDB-STRESS", "refreshRate": 360},
            {"name": "DP-2", "refreshRate": 144},
        ],
    }


def compact(run, source="stress-studio/shader-heavy", index=1):
    return results.compact_run(
        "synthetic", "paired", run, manifest(source), "synthetic/paired", index
    )


class CpuPublicationTests(unittest.TestCase):
    def test_retrospective_overlay_leaves_raw_capture_and_audit_unchanged(self):
        raw, audit = fixture(), evidence(True, False)
        before, audit_before = copy.deepcopy(raw), copy.deepcopy(audit)
        overlaid = results.apply_cpu_audit(raw, audit)
        published = compact(overlaid)
        self.assertEqual(raw, before)
        self.assertEqual(audit, audit_before)
        self.assertEqual(published["recorded_cpu_evidence"], before["cpu_evidence"])
        self.assertTrue(published["cpu_evidence"]["retrospective"])

    def test_partial_tail_failure_keeps_mean_and_other_measurements(self):
        row = compact(results.apply_cpu_audit(fixture(), evidence(True, False)))
        self.assertTrue(row["valid"])
        self.assertEqual(row["weighted_cpu_mean_percent_one_core"], 40)
        self.assertEqual(row["wallpaper"]["presented_hz"], 120)
        self.assertEqual(
            row["cpu_metrics_available"], {"weighted_mean": True, "sample_tails": False}
        )
        for values in [row["cpu"], *row["cpu_by_role"].values()]:
            self.assertEqual(values["mean"], 40)
            for key in ("p50", "p95", "p99", "p999", "max", "sample_mean"):
                self.assertIsNone(values[key])
        plot = row["plots"]["resources"]
        for point in plot["rows"]:
            for field in results.CPU_FIELDS:
                self.assertIsNone(point[plot["columns"].index(field)])
        self.assertTrue(
            any(point[plot["columns"].index("rss_mib")] == 200 for point in plot["rows"])
        )

    def test_native_failure_also_gates_nested_statistics_without_an_overlay(self):
        raw = fixture()
        raw["cpu_evidence"] = evidence(False, False)
        before = copy.deepcopy(raw)
        row = compact(raw)
        self.assertTrue(row["valid"])
        self.assertIsNone(row["weighted_cpu_mean_percent_one_core"])
        self.assertIsNone(row["cpu"]["mean"])
        self.assertIsNone(row["cpu_by_role"]["contender"]["max"])
        self.assertEqual(raw, before)

    def test_unverified_historical_cpu_is_unknown_even_when_a_mean_was_recorded(self):
        raw = fixture()
        del raw["cpu_evidence"]
        row = compact(raw)
        self.assertEqual(row["cpu_evidence"]["status"], "unverified")
        self.assertIsNone(row["weighted_cpu_mean_percent_one_core"])
        self.assertIsNone(row["cpu"]["p99"])
        self.assertTrue(row["valid"])
        self.assertTrue(row["evidence_warnings"])

    def test_tail_claim_cannot_survive_a_failed_mean_coverage_gate(self):
        raw = fixture()
        raw["cpu_evidence"] = evidence(False, True)
        row = compact(raw)
        self.assertFalse(row["cpu_metrics_available"]["sample_tails"])
        self.assertIsNone(row["cpu"]["max"])

    def test_reconstructed_mean_uses_only_the_measured_window(self):
        raw = fixture()
        del raw["cpu"]["mean_method"]
        raw["cpu_timeline"].insert(0, {"monotonic": 0, "wallpaper_cpu": 9000})
        raw["cpu_timeline"].append({"monotonic": 20, "wallpaper_cpu": 9000})
        mean, method = results.weighted_cpu_mean(raw)
        self.assertEqual(mean, 40)
        self.assertIn("reconstructed", method)


class MeasurementPublicationTests(unittest.TestCase):
    def test_retained_static_zero_new_frames_is_valid_and_not_missing_feedback(self):
        raw = fixture()
        raw.update(
            cpu={},
            cpu_by_role={},
            cpu_evidence=evidence(False, False),
            cpu_timeline=[],
            gpu_timeline=[],
            resources={},
            contender={"available": False},
            wallpaper={
                "available": True,
                "presented_frames": 0,
                "presented_hz": 0,
                "presentation_ms": {"samples": 0, "p99": None},
            },
            wallpaper_timeline=[],
        )
        row = compact(raw, "stress-studio/background-4k.png")
        self.assertTrue(row["valid"])
        self.assertEqual(row["content_behavior"], "retained_static")
        self.assertEqual(row["wallpaper"]["presented_hz"], 0)
        group = results.aggregate([row])[0]
        self.assertEqual(
            group["wallpaper_presented_hz"], {"runs": 1, "median": 0, "min": 0, "max": 0}
        )
        self.assertEqual(group["cpu_mean_percent_one_core"]["runs"], 0)
        raw["wallpaper"] = {"available": False}
        missing = compact(raw, "stress-studio/background-4k.png")
        self.assertIsNone(missing["wallpaper"]["presented_hz"])
        self.assertFalse(missing["valid"])

    def test_pause_request_keeps_its_evidence_scope_and_unknown_warning(self):
        raw = fixture("1-gpu-independent-paused")
        raw["pause_evidence"] = {
            "status": "unknown",
            "scope": "Host counters only",
            "errors": ["Browser heartbeat unavailable"],
        }
        row = compact(raw)
        self.assertEqual(row["engine"], "gpu-independent-paused")
        self.assertEqual(row["content_behavior"], "paused")
        self.assertEqual(row["pause_evidence"]["scope"], "Host counters only")
        self.assertIn("Pause requested; pause evidence unknown", row["evidence_warnings"])
        self.assertEqual(results.aggregate([row])[0]["pause_unverified_valid_runs"], 1)
        static = compact(raw, "stress-studio/background-4k.png")
        self.assertEqual(static["content_behavior"], "retained_static")

    def test_invalid_and_zero_duration_runs_never_shift_aggregates(self):
        good = compact(fixture(mean=40))
        partial = compact(
            results.apply_cpu_audit(fixture("2-gpu", 80), evidence(True, False)), index=2
        )
        unknown = compact(
            results.apply_cpu_audit(fixture("3-gpu", 1000), evidence(False, False)), index=3
        )
        failed_raw = fixture("4-gpu", 9000)
        failed_raw.update(valid=False, errors=["Renderer exited"])
        failed_raw["wallpaper"] = frame_stats(9999)
        failed = compact(failed_raw, index=4)
        empty_raw = fixture("5-gpu", 8000)
        empty_raw.update(measured_seconds=0, end=10)
        empty = compact(empty_raw, index=5)
        group = results.aggregate([good, partial, unknown, failed, empty])[0]
        self.assertEqual((group["valid_runs"], group["invalid_runs"]), (3, 2))
        self.assertEqual(
            group["cpu_mean_percent_one_core"], {"runs": 2, "median": 60, "min": 40, "max": 80}
        )
        self.assertEqual(group["cpu_sample_tail_runs"], 1)
        self.assertEqual(group["wallpaper_presented_hz"]["max"], 120)
        self.assertEqual(group["wallpaper_presented_hz"]["runs"], 3)

    def test_missing_webkit_feedback_never_uses_browser_fps(self):
        raw = fixture("1-baseline")
        raw["wallpaper"] = {"available": False}
        raw["final_telemetry"] = {
            "frames": 1000,
            "fps": 359.5,
            "scene": {"webgl_renderer": "generic"},
        }
        row = compact(raw)
        self.assertIsNone(row["wallpaper"]["presented_hz"])
        self.assertEqual(row["browser_callbacks"]["final"]["reported_fps"], 359.5)
        self.assertIsNone(row["browser_callbacks"]["measurement_window_fps"])

    def test_native_media_render_update_rate_stays_separate_from_presentation_rate(self):
        raw = fixture("1-gpu-independent")
        raw["wallpaper"].update(
            presented_frames=358, presented_hz=358, media_updates=23, media_update_hz=23
        )
        row = compact(raw, "stress-studio/background-4k-360fps.mp4")
        self.assertEqual(row["wallpaper"]["presented_hz"], 358)
        self.assertEqual(row["media_render_update_hz"], 23)
        self.assertEqual(row["wallpaper"]["media_updates"], 23)
        # A native video with an observed zero count must not become unavailable:
        # zero updates is useful stall/pause evidence, distinct from no media.
        raw["wallpaper"].update(media_updates=0, media_update_hz=0)
        self.assertEqual(
            compact(raw, "stress-studio/background-4k-360fps.mp4")["media_render_update_hz"],
            0,
        )

    def test_decoder_drop_results_keep_video_updates_and_applied_policy_separate(self):
        raw = fixture("1-gpu-independent-drop")
        raw["wallpaper"].update(presented_hz=359, media_updates=2000, media_update_hz=200)
        raw["final_telemetry"] = {
            "media_decoder_drop_enabled": True,
            "media_framedrop_requested": "decoder+vo",
            "media_framedrop": "decoder+vo",
            "media_framedrop_verified_at_init": True,
            "media_framedrop_scope": "Source frames may be skipped",
        }
        row = compact(raw, "stress-studio/background-4k-360fps.mp4")
        self.assertEqual(row["engine"], "gpu-independent-drop")
        self.assertEqual(row["wallpaper"]["presented_hz"], 359)
        self.assertEqual(row["media_render_update_hz"], 200)
        self.assertEqual(row["media_drop_policy"]["applied"], "decoder+vo")
        self.assertTrue(row["media_drop_policy"]["verified_at_init"])
        previous = compact(fixture("1-gpu-independent"))
        self.assertIsNone(previous["media_drop_policy"]["applied"])

    def test_no_media_static_and_uninstrumented_paths_have_no_render_update_rate(self):
        for name, source in (
            ("1-gpu", "stress-studio/shader-heavy"),
            ("1-gpu-independent", "stress-studio/background-4k.png"),
            ("1-baseline", "stress-studio/background-4k-360fps.mp4"),
            ("1-chromium", "stress-studio/background-4k-360fps.mp4"),
        ):
            with self.subTest(engine=name, source=source):
                self.assertIsNone(compact(fixture(name), source)["media_render_update_hz"])
        raw = fixture()
        raw["video_progress"] = {"status": "not_applicable"}
        raw["wallpaper"].update(media_updates=25, media_update_hz=25)
        self.assertIsNone(compact(raw)["media_render_update_hz"])
        self.assertIsNone(compact(raw, "stress-studio/background-4k.png")["media_render_update_hz"])

    def test_mpv_container_fps_is_native_metadata_and_never_browser_callbacks(self):
        raw = fixture("1-baseline")
        mpv = {"renderer": "mpv", "fps": 360, "time": 2, "duration": 8, "state": "ready"}
        for key in ("initial_telemetry", "measurement_initial_telemetry", "final_telemetry"):
            raw[key] = mpv.copy()
        row = compact(raw, "stress-studio/background-4k-360fps.mp4")
        for key in ("initial", "measurement_initial", "final"):
            self.assertIsNone(row["browser_callbacks"][key]["reported_fps"])
            self.assertIsNone(row["browser_callbacks"][key]["frames"])
        self.assertEqual(row["final_telemetry"]["fps"], 360)
        nested = results.callback_snapshot(
            {"renderer": "Chromium SDR copy", "fps": 60, "browser": {"fps": 120, "frames": 42}}
        )
        self.assertEqual(nested["reported_fps"], 120)
        self.assertEqual(nested["frames"], 42)

    def test_plot_bins_retain_hitches_and_resource_minima_inside_the_window(self):
        raw = fixture()
        raw["wallpaper_timeline"] += [[-0.01, 999], [1.1, 999]]
        row = compact(raw)
        self.assertEqual(row["plots"]["wallpaper"]["max_ms"], [[0.0, 90], [0.1, 8]])
        self.assertEqual(row["plots"]["wallpaper"]["rejected_samples"], 2)
        self.assertEqual(row["minimum_free_vram_mib"], 6800)
        self.assertEqual(row["minimum_available_ram_mib"], 15000)
        self.assertEqual(row["resources"]["temperature_c"]["max"], 56)

    def test_portable_evidence_redacts_pid_arrays_but_preserves_counts_and_errors(self):
        original = {
            "expected_pids": [4101, 4102],
            "workerPids": [4103],
            "expected_positive_pid_count": 2,
            "raw_per_pid_counter_rows": 30,
            "sampling_issue_examples": [
                {
                    "missing_positive_pids": [4104],
                    "unexpected_positive_pids": [4105],
                    "pid": 4106,
                    "error": "Expected PID 4106 CPU sample unavailable",
                }
            ],
            "missing_clocks": [{"pid": 4107, "error_code": 3}],
            "sequence_gaps": {"1": 4108},
        }
        portable = results.portable(original, [])
        self.assertNotIn("expected_pids", portable)
        self.assertNotIn("workerPids", portable)
        self.assertEqual(portable["expected_positive_pid_count"], 2)
        self.assertEqual(portable["raw_per_pid_counter_rows"], 30)
        self.assertEqual(
            portable["sampling_issue_examples"],
            [{"error": "Expected PID <redacted> CPU sample unavailable"}],
        )
        self.assertEqual(portable["missing_clocks"], [{"error_code": 3}])
        self.assertEqual(portable["sequence_gaps"], {"1": 4108})


class ArtifactPublicationTests(unittest.TestCase):
    def publish(self, folder, runs, audit_builder=None):
        study, output = folder / "study", folder / "publication"
        (study / "paired").mkdir(parents=True)
        report = study / "paired/report.json"
        report.write_text(json.dumps({"manifest": manifest(), "runs": runs}, indent=2))
        original = report.read_bytes()
        sha = hashlib.sha256(original).hexdigest()
        argv = ["stress-results.py", "--study", f"synthetic={study}", "--output-dir", str(output)]
        if audit_builder:
            audit = folder / "cpu-audit.json"
            audit.write_text(json.dumps(audit_builder(sha)))
            argv.extend(["--cpu-audit", str(audit)])
        with patch.object(sys, "argv", argv), redirect_stdout(io.StringIO()):
            results.main()
        self.assertEqual(report.read_bytes(), original)
        summary = json.loads((output / "summary.json").read_text())
        html = (output / "index.html").read_text()
        payload = json.loads(
            re.search(r'<script id="payload" type="application/json">(.*?)</script>', html, re.S)[1]
        )
        return summary, payload, html, output, report

    def test_hash_matched_audit_is_applied_without_rewriting_raw_or_duplicating_plots(self):
        raw = fixture()
        raw.pop("cpu_evidence")
        with tempfile.TemporaryDirectory() as directory:
            summary, payload, _html, output, report = self.publish(
                Path(directory),
                [raw],
                lambda sha: {
                    "reports": [
                        {"sha256": sha, "runs": [evidence(True, False) | {"name": "1-gpu"}]},
                        {"sha256": "0" * 64, "runs": [evidence(False, False) | {"name": "1-gpu"}]},
                        {
                            "report": "too-large/report.json",
                            "error": "Report exceeds bounded read size",
                        },
                    ]
                },
            )
            self.assertEqual(summary["cpu_audit_matched_runs"], 1)
            self.assertEqual(summary["cpu_audit_unmatched_runs"], 1)
            self.assertEqual(len(summary["cpu_audit_errors"]), 1)
            self.assertEqual(summary["runs"][0]["weighted_cpu_mean_percent_one_core"], 40)
            self.assertIsNone(summary["runs"][0]["cpu"]["p99"])
            self.assertNotIn("plots", summary["runs"][0])
            self.assertIn("plots", payload["runs"][0])
            without_plots = {
                key: value for key, value in payload["runs"][0].items() if key != "plots"
            }
            self.assertEqual(without_plots, summary["runs"][0])
            raw_link = summary["provenance"][0]["raw_json"]
            self.assertEqual((output / unquote(raw_link)).resolve(), report.resolve())
            self.assertEqual(
                summary["provenance"][0]["sha256"], hashlib.sha256(report.read_bytes()).hexdigest()
            )

    def test_matching_a_run_name_under_the_wrong_report_hash_never_authorizes_cpu(self):
        raw = fixture()
        raw.pop("cpu_evidence")
        with tempfile.TemporaryDirectory() as directory:
            summary, *_ = self.publish(
                Path(directory),
                [raw],
                lambda _sha: {
                    "reports": [{"sha256": "f" * 64, "runs": [evidence() | {"name": "1-gpu"}]}]
                },
            )
        self.assertEqual(summary["cpu_audit_matched_runs"], 0)
        self.assertIsNone(summary["runs"][0]["weighted_cpu_mean_percent_one_core"])

    def test_conflicting_audits_are_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
                self.publish(
                    Path(directory),
                    [fixture()],
                    lambda sha: {
                        "reports": [
                            {
                                "sha256": sha,
                                "runs": [
                                    evidence() | {"name": "1-gpu"},
                                    evidence(False, False) | {"name": "1-gpu"},
                                ],
                            }
                        ]
                    },
                )
            self.assertFalse((Path(directory) / "publication/index.html").exists())

    @unittest.skipUnless(
        shutil.which("node"), "Node is required for the report's browser-free UI check"
    )
    def test_interactive_report_explains_cpu_static_and_pause_evidence(self):
        static = fixture("1-gpu-independent")
        static.update(
            content_behavior="retained_static",
            cpu_evidence=evidence(False, False),
            wallpaper={"available": True, "presented_frames": 0, "presented_hz": 0},
            wallpaper_timeline=[],
        )
        paused = fixture("1-baseline-paused")
        paused["pause_evidence"] = {"status": "unknown", "scope": "Scene events only"}
        media = fixture("1-gpu")
        media["wallpaper"].update(
            presented_frames=358, presented_hz=358, media_updates=23, media_update_hz=23
        )
        with tempfile.TemporaryDirectory() as directory:
            _summary, payload, html, *_ = self.publish(Path(directory), [static, paused, media])
        script = re.search(r"<script>\s*(.*?)</script>", html, re.S)[1]
        harness = r"""
const fs=require('node:fs'),vm=require('node:vm');
const input=JSON.parse(fs.readFileSync(0,'utf8')),nodes=new Map();
class Element {
  constructor(id){this.id=id;this.value=id==='window'?'15':id==='from'||id==='pan'?'0':'';this.textContent='';this.html='';}
  set innerHTML(value){this.html=value;if(['study','engine','batch','run-select','resource'].includes(this.id)){const first=value.match(/<option value="([^"]*)"/);this.value=first?first[1]:'';}}
  get innerHTML(){return this.html;}
  addEventListener(){}
}
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);}};
document.getElementById('payload').textContent=JSON.stringify(input.payload);
const context=vm.createContext({document});
vm.runInContext(input.script,context,{timeout:1000});
const first={behavior:document.getElementById('behavior-detail').textContent,cpu:document.getElementById('cpu-detail').textContent,groups:document.getElementById('groups').innerHTML,engines:document.getElementById('engine').innerHTML,wall:document.getElementById('wall-detail').textContent};
vm.runInContext('choose(data.runs[1].id)',context,{timeout:1000});
const paused={behavior:document.getElementById('behavior-detail').textContent,warnings:document.getElementById('selection-errors').textContent};
vm.runInContext('choose(data.runs[2].id)',context,{timeout:1000});
const media={wall:document.getElementById('wall-detail').textContent,rows:document.getElementById('runs').innerHTML};
vm.runInContext('$("engine").value="gpu-independent";drawTables()',context,{timeout:1000});
const filtered=document.getElementById('count').textContent;
process.stdout.write(JSON.stringify({first,paused,media,filtered}));
"""
        executed = subprocess.run(
            [shutil.which("node"), "-e", harness],
            input=json.dumps({"payload": payload, "script": script}),
            text=True,
            capture_output=True,
            timeout=5,
            check=True,
        )
        rendered = json.loads(executed.stdout)
        self.assertIn("zero new presentations", rendered["first"]["behavior"])
        self.assertIn("0.00 delivered fps", rendered["first"]["wall"])
        self.assertIn("media render updates unavailable", rendered["first"]["wall"])
        self.assertIn("weighted mean: unknown", rendered["first"]["cpu"])
        self.assertIn("means 0/1", rendered["first"]["groups"])
        self.assertIn("independent media clock", rendered["first"]["engines"])
        self.assertIn("GTK · WebKit · mpvpaper", rendered["first"]["engines"])
        self.assertIn("evidence unknown", rendered["paused"]["behavior"])
        self.assertIn("Scene events only", rendered["paused"]["behavior"])
        self.assertIn("Pause requested; pause evidence unknown", rendered["paused"]["warnings"])
        self.assertIn("358.00 delivered fps", rendered["media"]["wall"])
        self.assertIn("media render updates 23.00/s (not decoded FPS)", rendered["media"]["wall"])
        self.assertIn("<td>358.00</td><td>23.00</td>", rendered["media"]["rows"])
        self.assertIn("1 runs shown", rendered["filtered"])
        self.assertIn("CPU means 0/1", rendered["filtered"])


if __name__ == "__main__":
    unittest.main()
