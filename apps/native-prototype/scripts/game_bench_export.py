"""Export selected completed jobs without copying private settings/process receipts."""

import argparse
import copy
import io
import json
from pathlib import Path
import statistics

from game_bench_data import parse_source2, segment, summarize
from game_bench_host import atomic_json
from game_bench_worker import observed_msaa


def export_job(directory, destination):
    result = json.loads((directory / "result.json").read_text())
    desktop = json.loads((directory / "desktop-status.json").read_text())
    if desktop.get("state") != "complete" or not desktop.get("wallpapers_restored"):
        raise ValueError(f"{directory.name} did not finish restoration")
    target = destination / directory.name
    target.mkdir(parents=True, exist_ok=True)
    exported = {
        key: copy.deepcopy(result[key])
        for key in (
            "schema",
            "id",
            "game",
            "actual_resolution",
            "comparison",
            "scope",
            "limitations",
        )
    }
    exported["demo_sha256"] = result["demo"]["sha256"]
    exported["request"] = {
        key: value
        for key, value in result["request"].items()
        if key not in ("demo", "directory", "control", "bench_token", "op")
    }
    exported["wallpaper"] = {
        key: value
        for key, value in result.get("wallpaper", {}).items()
        if key in ("title", "kind", "id", "description")
    }
    exported["outputs"] = [
        {
            key: value
            for key, value in monitor.items()
            if key
            in (
                "name",
                "width",
                "height",
                "refreshRate",
                "scale",
                "transform",
                "currentFormat",
                "colorManagementPreset",
                "vrr",
            )
        }
        for monitor in result["outputs"]
    ]
    exported["runs"] = []
    for original in result["runs"]:
        folder = directory / f'{original["repeat"]}-{original["condition"]}'
        raw = (folder / "frames.csv").read_text()
        selected = segment(parse_source2(io.StringIO(raw)), *original["identity"]["ticks"])
        recalculated = summarize(selected)
        for metric in ("frames", "average_fps", "p99_ms", "worst_ms"):
            if abs(recalculated[metric] - original["summary"][metric]) > 1e-6:
                raise ValueError(f"{directory.name}: raw {metric} differs from saved analysis")
        filename = folder.name + ".csv"
        (target / filename).write_text(raw)
        run = {
            key: copy.deepcopy(original[key])
            for key in (
                "repeat",
                "condition",
                "valid",
                "summary",
                "plot",
                "resources",
                "identity",
                "actual_resolution",
                "scene_seconds",
                "wall_seconds",
                "clock_bridge",
            )
        }
        run["raw_frames"] = filename
        console = (folder / "console.log").read_text(errors="replace")
        msaa = observed_msaa(console, original["actual_resolution"])
        expected_msaa = max(
            1, int(original["identity"]["submitted_video_settings"]["setting.msaa_samples"])
        )
        if msaa != expected_msaa:
            raise ValueError(f"{directory.name}: observed MSAA differs from submitted settings")
        run["identity"]["observed_msaa_samples"] = msaa
        evidence_name = folder.name + "-render-targets.txt"
        (target / evidence_name).write_text(
            "\n".join(line for line in console.splitlines() if " RT " in line) + "\n"
        )
        run["render_target_evidence"] = evidence_name
        observations = json.loads((folder / "wallpaper.json").read_text())
        origin = selected[0]["engine_swap_s"] - selected[0]["frame_ms"] / 1000
        start = original["clock_bridge"]["offset_s"] + origin
        rows = [
            row for row in observations if start <= row["monotonic"] <= start + run["wall_seconds"]
        ]
        run["wallpaper_observations"] = []
        for output in exported["request"]["outputs"]:
            telemetry = [
                surface["telemetry"]
                for row in rows
                for surface in row["surfaces"]
                if surface["output"] == output
            ]
            if not telemetry:
                continue
            fps = [row["fps"] for row in telemetry if isinstance(row.get("fps"), (int, float))]
            run["wallpaper_observations"].append(
                {
                    "output": output,
                    "renderer": telemetry[0].get("renderer", "WebKit"),
                    "median_reported_fps": statistics.median(fps) if fps else None,
                    "first_frames": telemetry[0].get("frames"),
                    "last_frames": telemetry[-1].get("frames"),
                    "paused": sorted({bool(row.get("paused")) for row in telemetry}),
                }
            )
        exported["runs"].append(run)
    atomic_json(target / "comparison.json", exported)
    return {
        "id": exported["id"],
        "wallpaper": exported["wallpaper"].get("title"),
        "experiment": exported["request"]["experiment"],
        "policy": exported["request"]["policy"],
        "pairs": exported["request"]["repeats"],
        "comparison": exported["comparison"],
        "file": f"{directory.name}/comparison.json",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", type=Path, nargs="+")
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).resolve().parents[1] / "results/game-bench"
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    index = [export_job(job.resolve(), args.output) for job in args.jobs]
    atomic_json(args.output / "index.json", index)
    comparisons = [json.loads((args.output / row["file"]).read_text()) for row in index]
    (args.output / "data.js").write_text(
        "window.GAME_BENCH_RESULTS = "
        + json.dumps(comparisons, separators=(",", ":"), allow_nan=False)
        + ";\n"
    )
    print(f"Revalidated and exported {len(index)} completed comparisons to {args.output}")


if __name__ == "__main__":
    main()
