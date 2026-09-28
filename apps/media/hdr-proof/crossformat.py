"""Probe Sharp's additional AVIF HDR to gain-map JPEG candidate."""

import json
from pathlib import Path

import numpy as np
from PIL import Image

from appearance import compare_appearance
from avif import decode_avif, decode_transfer
from gainmap import ROOT, command, digest, independent_hdr, inspect, output_gamut
from gainmap_iso import reconstruct


def established_output_gamut(facts):
    gamut = output_gamut(facts)
    if gamut is None:
        raise ValueError('Unknown emitted color profile; no default sRGB or substring-based gamut inference permits reconstruction')
    return gamut


def run(output_dir, fixture_directory=None):
    output_dir = Path(output_dir).resolve()
    fixture_directory = Path(fixture_directory) if fixture_directory else output_dir / "avif"
    directory = output_dir / "crossformat"
    directory.mkdir(parents=True, exist_ok=True)
    jobs, source_specs = [], {}
    for transfer in ("pq", "hlg"):
        for gamut in ("p3", "rec2020"):
            fixture_id = f"avif-{transfer}-{gamut}-10-opaque"
            source = fixture_directory / fixture_id / f"{fixture_id}.avif"
            case_id = f"{fixture_id}:hdr:jpg:preserve:preserve:contain:gainmap"
            case_dir = directory / case_id.replace(":", "-")
            case_dir.mkdir(parents=True, exist_ok=True)
            source_specs[case_id] = {"fixture_id": fixture_id, "source": source,
                                     "transfer": transfer, "gamut": gamut}
            jobs.append({"case_id": case_id, "input": str(source), "output": str(case_dir / "output.jpg"),
                         "geometry": "contain", "gamut": "preserve", "format": "jpg", "mode": "regenerate"})
    encoded = command(["node", ROOT / "gainmap.cjs"], directory / "native-encoder.log", data=json.dumps(jobs))
    native_results = {record["case_id"]: record for record in map(json.loads, encoded.splitlines())}
    evidence = []
    for job in jobs:
        source = source_specs[job["case_id"]]
        output = Path(job["output"])
        case_dir = output.parent
        result = native_results[job["case_id"]]
        item = {"case_id": job["case_id"], "cell_id": "static-avif:hdr:jpg", "fixture_id": source["fixture_id"],
                "selectors": {"format": "jpg", "range": "hdr", "gamut": "preserve", "depth": "8",
                              "motion": "preserve", "transparency": "preserve", "w": 173, "fit": "contain"},
                "geometry": "contain", "candidate": "sharp-0.35.5:withGainMap",
                "status": "tested and failed", "checks": {"native_encoder": result["ok"], "independent_decoder": False,
                    "structure": False, "appearance": False, "privacy": False},
                "blockers": [], "measurements": {}, "artifacts": {}}
        if not result["ok"]:
            item["blockers"].append(result["error"])
            evidence.append(item)
            continue
        try:
            facts = inspect(output, case_dir)
            item["facts"] = facts
            item["checks"]["privacy"] = not facts["private_tags"]
            actual_gamut = established_output_gamut(facts)
            item["checks"]["structure"] = (facts["base"]["width"] == 173 and facts["base"]["height"] == 115
                                              and facts["base"]["depth"] == 8 and facts.get("map", {}).get("depth") == 8
                                              and bool(facts.get("iso_metadata")) and actual_gamut == source["gamut"]
                                              and facts["metadata"].get("IFD0:Orientation", 1) == 1)
            decoded = decode_avif(source["source"], case_dir, 1)[0]
            source_nits = decode_transfer(decoded[..., :3], source["transfer"], source["gamut"])
            reference = np.maximum(np.stack([
                np.asarray(Image.fromarray(source_nits[..., channel].astype(np.float32)).resize((173, 115), Image.Resampling.LANCZOS))
                for channel in range(3)], axis=-1), 0)
            try:
                actual = independent_hdr(output, case_dir, actual_gamut)
                item["checks"]["independent_decoder"] = True
                decoded_gamut = "rec2020"
            except Exception as error:
                item["blockers"].append("Maintained independent HDR decoder rejected emitted ISO JPEG: " + str(error)[:1300])
                actual, _ = reconstruct(output.read_bytes(), (case_dir / "map.jpg").read_bytes())
                decoded_gamut = actual_gamut
                item["measurements"]["hdr_oracle_scope"] = "Supplementary proof-only ISO oracle, not independently qualified ISO interoperability"
            measured = compare_appearance(reference, actual, reference_gamut=source["gamut"],
                                           actual_gamut=decoded_gamut, fixture_class="gainmap-hdr")
            item["measurements"]["reconstructed_hdr"] = measured
            item["checks"]["appearance"] = measured["passed"]
            if not facts.get("android_xmp_properties"):
                item["blockers"].append("No Android hdrgm XMP properties were independently parsed from the emitted gain map; dual-metadata interoperability is unqualified.")
            item["blockers"].append("The HDR-only source has no creator-authored SDR companion; the regenerated JPEG base needs a separate controlled SDR-grade qualification.")
            item["blockers"].extend(f"Failed {name} check" for name, passed in item["checks"].items() if not passed)
            item["artifacts"] = {"output": str(output), "sha256": digest(output),
                                 "source": str(source["source"]), "source_sha256": digest(source["source"])}
        except Exception as error:
            item["blockers"].append(str(error)[:1800])
        evidence.append(item)
    (directory / "evidence.json").write_text(json.dumps(evidence, indent=2, allow_nan=False) + "\n")
    return evidence
