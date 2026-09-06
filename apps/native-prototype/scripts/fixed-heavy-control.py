"""Opt-in, fixed-input heavy-shader control using the guarded stress runner."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


ENGINES = ["idle", "gpu", "gpu-paced", "chromium", "baseline"]
FIELDS = ("params", "pointer", "audio", "pulse", "bands", "date", "hasMedia", "seed")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_inputs(path):
    source = path.read_text()
    return {
        name: json.loads("[" + re.search(r"\b" + name + r"\s*:\s*\[([^\]]+)\]", source)[1] + "]")
        for name in FIELDS
    }


def input_evidence(folder, batches, expected):
    rows, errors = [], []
    for batch in batches:
        path = folder / batch["name"] / "report.json"
        if not path.exists():
            continue
        try:
            report = json.loads(path.read_text())
        except (OSError, ValueError) as error:
            errors.append({"path": str(path), "error": str(error)})
            continue
        for run in report.get("runs", []):
            if run["name"].endswith("-idle"):
                continue
            stats = run.get("final_telemetry", {})
            scene = stats.get("browser", stats).get("scene", {}) or {}
            proof = scene.get("fixed_control")
            origin = "final browser scene telemetry"
            error = None
            if not proof and stats.get("log"):
                origin = stats["log"]
                try:
                    with Path(origin).open() as handle:
                        prefix = handle.read(1 << 20)
                    marker = "WDB_FIXED_HEAVY_INPUTS "
                    proofs = [
                        json.loads(line.split(marker, 1)[1])
                        for line in prefix.splitlines()
                        if marker in line
                    ]
                    proof = proofs[-1] if proofs else None
                except (OSError, ValueError) as failure:
                    error = str(failure)
            exact = bool(
                proof
                and proof.get("verified") is True
                and proof.get("media") is False
                and proof.get("seed") == expected["seed"][0]
                and proof.get("inputs")
                == {key: value for key, value in expected.items() if key != "seed"}
            )
            rows.append(
                {
                    "batch": batch["name"],
                    "run": run["name"],
                    "profile_valid": run.get("valid"),
                    "uniforms_verified": exact,
                    "proof": proof,
                    "origin": origin,
                    "error": error
                    or (None if exact else "Missing or mismatched fixed uniform evidence"),
                }
            )
    return {
        "runs": rows,
        "errors": errors,
        "all_observed_runs_verified": bool(rows)
        and not errors
        and all(row["uniforms_verified"] for row in rows),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prototype-root", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--no-contender", action="store_true")
    parser.add_argument("--run", action="store_true")
    args, forwarded = parser.parse_known_args()
    if any(arg == "--stage" or arg.startswith("--stage=") or arg == "--audio" for arg in forwarded):
        parser.error("The fixed control supplies its own stage and keeps system audio capture off")
    root = args.prototype_root.resolve()
    bundle = root / "examples/stress-studio/fixed-heavy"
    expected = read_inputs(bundle / "inputs.js")
    batch = {
        "name": "fixed-heavy-360",
        "source": "stress-studio/fixed-heavy",
        "fps": 360,
        "seconds": 30,
        "repeats": 3,
        "contention": not args.no_contender,
        "engines": ENGINES.copy(),
    }
    if not args.run:
        print(
            json.dumps(
                {
                    "result": "plan_only",
                    "batch": batch,
                    "fixed_shader_inputs": expected,
                    "forwarded_stress_arguments": forwarded,
                    "note": "Stress overrides are applied only by --run or --run --list. No renderers have been launched.",
                },
                indent=2,
            )
        )
        return
    if args.output_dir is None:
        parser.error("--run requires a dedicated --output-dir")
    paths = [
        *sorted(path for path in bundle.iterdir() if path.is_file()),
        *(bundle.parent / name for name in ("shader.js", "workloads.js", "scene.lua", "scene.js")),
        root / "scripts/stress.py",
        root / "scripts/profile.py",
        Path(__file__).resolve(),
    ]
    provenance = {
        "benchmark_only": True,
        "expected_inputs": expected,
        "files": [{"path": str(path.relative_to(root)), "sha256": digest(path)} for path in paths],
        "scope": "Same shared heavy shader with constant uniform inputs; native FFI setters and browser callback adaptation remain measured. This is not a media/decoder control.",
    }
    source = root / "scripts/stress.py"
    sys.path.insert(0, str(root / "scripts"))
    namespace = {"__name__": "wdb_fixed_heavy_control", "__file__": str(source)}
    exec(compile(source.read_text(), str(source), "exec"), namespace)
    original_summary = namespace["write_summary"]

    def write_summary(folder, manifest, batches):
        manifest["fixed_heavy_control"] = {
            **provenance,
            "uniform_evidence": input_evidence(folder, batches, expected),
        }
        return original_summary(folder, manifest, batches)

    namespace["write_summary"] = write_summary
    namespace["recipe"] = lambda _stage: [dict(batch)]
    sys.argv = [
        str(source),
        "--stage",
        "screen",
        "--output-dir",
        str(args.output_dir.resolve()),
        "--output-name",
        "WDB-FIXED-CONTROL",
        *forwarded,
    ]
    namespace["main"]()


if __name__ == "__main__":
    main()
