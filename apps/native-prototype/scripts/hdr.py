"""Verify actual HDR scene pixels, Wayland signaling, and DP-5 output metadata."""

import argparse, json, math, re, subprocess, time
from lab_common import ROOT, api, assign, ready, hypr, capture, saved_assignments


def drm(output):
    text = subprocess.run(
        ["modetest", "-M", "nvidia-drm", "-c"],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    ).stdout
    section = re.search(
        rf"^\d+\s+\d+\s+connected\s+{re.escape(output)}\s.*?(?=^\d+\s+\d+\s+(?:connected|disconnected)|\Z)",
        text,
        re.S | re.M,
    )
    if not section:
        return {"available": False}
    s = section.group(0)
    color = re.search(r"Colorspace:.*?\n\s*value:\s*(\d+)", s, re.S)
    metadata = re.search(
        r"HDR_OUTPUT_METADATA:.*?\n\s*value:\s*\n((?:\s+[0-9a-f]{8,}\n)*)", s, re.S
    )
    raw = "".join(re.findall(r"[0-9a-f]+", metadata.group(1))) if metadata else ""
    blob = bytes.fromhex(raw) if raw else b""
    # drm_hdr_output_metadata: u32 metadata_type, followed by HDMI static metadata.
    return {
        "available": True,
        "colorspace_value": int(color[1]) if color else None,
        "blob": raw,
        "eotf": blob[4] if len(blob) > 4 else None,
        "hdr_metadata_present": bool(blob),
        "raw_connector": s,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="DP-5")
    parser.add_argument("--experiments", default="gpu,chromium-dmabuf")
    parser.add_argument(
        "--preview", help="Keep one live bundle/file in HDR until Ctrl-C, then restore"
    )
    args = parser.parse_args()
    out = ROOT / "verification" / f"hdr-{int(time.time())}"
    out.mkdir(parents=True)
    before = hypr("-j", "monitors")
    monitor = next(m for m in before if m["name"] == args.output)
    if args.output != "DP-5":
        raise SystemExit("This verification is scoped to the authorized HDR monitor DP-5")
    bitdepth = 10 if "2101010" in monitor["currentFormat"] else 8
    original = f"{args.output},{monitor['width']}x{monitor['height']}@{monitor['refreshRate']:.2f},{monitor['x']}x{monitor['y']},{monitor['scale']},bitdepth,{bitdepth},transform,{monitor['transform']},cm,{monitor['colorManagementPreset']}"
    result = {
        "before": before,
        "before_drm": drm(args.output),
        "restore_rule": original,
        "checks": [],
        "meaning": "HDR signal and renderer content; no calibrated physical luminance measurement. Screenshots are SDR evidence only.",
    }
    with saved_assignments():
        try:
            override = original.rsplit(",cm,", 1)[0] + ",cm,hdr"
            hypr("keyword", "monitor", override)
            time.sleep(2)
            result["hdr_monitors"] = hypr("-j", "monitors")
            result["hdr_drm"] = drm(args.output)
            output_hdr = (
                result["hdr_drm"]["hdr_metadata_present"] and result["hdr_drm"]["eotf"] == 2
            )
            if args.preview:
                assign(
                    args.preview,
                    args.experiments.split(",")[0],
                    [args.output],
                    hdr=True,
                    keep_playing=True,
                )
                ready(args.output)
                print(
                    "HDR preview is running on DP-5. Ctrl-C restores the previous display settings and wallpapers.",
                    flush=True,
                )
                try:
                    while True:
                        time.sleep(1)
                except KeyboardInterrupt:
                    return
            for engine in args.experiments.split(","):
                for asset in [
                    "hdr-calibration",
                    "HDR reference.png",
                    "HDR reference.avif",
                    "HDR reference.mkv",
                ]:
                    row = {"experiment": engine, "asset": asset, "output_hdr": output_hdr}
                    try:
                        assign(asset, engine, [args.output], hdr=True, keep_playing=True)
                        stats = ready(args.output, 25)
                        time.sleep(1)
                        stats = next(
                            s["telemetry"]
                            for s in api("status")["surfaces"]
                            if s["output"] == args.output
                        )
                        row["telemetry"] = stats
                        patches = stats.get("probe_patches_scrgb", [])
                        # Source patches 203/400 nits must be distinct and survive the real renderer.
                        expected = [0.1 / 80, 1 / 80, 10 / 80, 1, 203 / 80, 300 / 80, 5, 10]
                        row["patches_match"] = len(patches) == 8 and all(
                            len(p) == 3
                            and all(
                                math.isfinite(c) and abs(c - e) < max(0.0003, e * 0.08) for c in p
                            )
                            for p, e in zip(patches, expected)
                        )
                        row["drm"] = drm(args.output)
                        row["output_format"] = next(
                            m["currentFormat"]
                            for m in hypr("-j", "monitors")
                            if m["name"] == args.output
                        )
                        row["passed"] = bool(
                            "2101010" in row["output_format"]
                            and stats.get("surface_color") == "scRGB linear, 1 = 80 cd/m2"
                            and any(
                                o["output"] == args.output and o["presented"] > 0
                                for o in stats.get("outputs", [])
                            )
                            and stats.get("state") == "ready"
                            and not stats.get("error")
                            and row["drm"]["eotf"] == 2
                            and row["drm"]["colorspace_value"] == 9
                            and output_hdr
                            and stats.get("egl_float")
                            and stats.get("egl_bits", 0) >= 16
                            and stats.get("hdr")
                            and row["patches_match"]
                        )
                        shot = out / f'{engine}-{asset.replace(" ","-")}.png'
                        capture(shot, args.output, empty=True)
                        row["screenshot"] = shot.name
                    except Exception as error:
                        row.update(passed=False, error=str(error))
                    result["checks"].append(row)
                    print(json.dumps(row), flush=True)
                    (out / "report.json").write_text(json.dumps(result, indent=2))
        finally:
            hypr("keyword", "monitor", original)
            time.sleep(1)
            result["after"] = hypr("-j", "monitors")
            result["after_drm"] = drm(args.output)
            restored = next(m for m in result["after"] if m["name"] == args.output)
            keys = [
                "width",
                "height",
                "refreshRate",
                "x",
                "y",
                "scale",
                "transform",
                "currentFormat",
                "colorManagementPreset",
                "sdrBrightness",
                "sdrSaturation",
                "minLuminance",
                "maxLuminance",
                "vrr",
                "mirrorOf",
            ]
            result["restore_differences"] = {
                k: [monitor.get(k), restored.get(k)]
                for k in keys
                if monitor.get(k) != restored.get(k)
            }
            result["restored"] = not result["restore_differences"] and all(
                result["before_drm"].get(k) == result["after_drm"].get(k)
                for k in ["colorspace_value", "blob", "eotf"]
            )
            (out / "report.json").write_text(json.dumps(result, indent=2))
    print(out / "report.json")


if __name__ == "__main__":
    main()
