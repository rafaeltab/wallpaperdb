"""Opt-in actual-video controls using the repository's existing guarded runner.

This temporary recipe adapter changes no repository source or default recipes.
It inherits stress.py's owned-output, process-group and assignment cleanup.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys


ENGINES = ["idle", "baseline", "gpu", "gpu-paced", "gpu-independent", "chromium"]


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prototype-root", required=True, type=Path)
    parser.add_argument("--rates", type=int, nargs="+", choices=[120, 360], default=[120, 360])
    parser.add_argument(
        "--with-contender",
        action="store_true",
        help="Opt into the existing DP-2 contender; default is a video-only control",
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--run", action="store_true")
    args, forwarded = parser.parse_known_args()
    if any(arg == "--stage" or arg.startswith("--stage=") for arg in forwarded):
        parser.error("This adapter supplies its own files recipe; do not pass --stage")
    root = args.prototype_root.resolve()
    rows = [
        {
            "name": f"video-file-{fps}",
            "source": f"stress-studio/background-4k-{fps}fps.mp4",
            "fps": fps,
            "seconds": 30,
            "repeats": 1,
            "contention": args.with_contender,
            "engines": ENGINES.copy(),
        }
        for fps in sorted(set(args.rates))
    ]
    if not args.run:
        print(
            json.dumps(
                {
                    "result": "plan_only",
                    "batches": rows,
                    "forwarded_stress_arguments": forwarded,
                    "note": "Forwarded --seconds/--repeats/--engines overrides are applied by stress.py only during --run or --run --list.",
                },
                indent=2,
            )
        )
        return
    if args.output_dir is None:
        parser.error("--run requires a dedicated --output-dir")
    provenance = {
        "recipe_sha256": digest(Path(__file__)),
        "stress_runner_sha256": digest(root / "scripts/stress.py"),
        "fixtures": [],
    }
    for row in rows:
        movie = root / "examples" / row["source"]
        sidecar = movie.with_suffix(".fixture.json")
        metadata = json.loads(sidecar.read_text())
        if (
            metadata.get("result") != "complete"
            or metadata.get("requested", {}).get("fps") != row["fps"]
            or metadata.get("file", {}).get("sha256") != digest(movie)
        ):
            parser.error(f"Fixture metadata or hash failed for {movie.name}")
        provenance["fixtures"].append(
            {
                "source": row["source"],
                "metadata_sha256": digest(sidecar),
                "file": metadata["file"],
                "validation": metadata["validation"],
            }
        )
    source = root / "scripts/stress.py"
    sys.path.insert(0, str(root / "scripts"))
    namespace = {"__name__": "wdb_video_controls", "__file__": str(source)}
    exec(compile(source.read_text(), str(source), "exec"), namespace)
    original_summary = namespace["write_summary"]

    def write_summary(folder, manifest, batches):
        manifest["video_fixture_recipe"] = provenance
        return original_summary(folder, manifest, batches)

    namespace["write_summary"] = write_summary
    namespace["recipe"] = lambda _stage: [dict(row) for row in rows]
    namespace["SUPPORTED_CASES"] |= {"gpu-independent", "gpu-independent-paused"}
    sys.argv = [
        str(source),
        "--stage",
        "files",
        "--output-dir",
        str(args.output_dir.resolve()),
        *forwarded,
    ]
    namespace["main"]()


if __name__ == "__main__":
    main()
