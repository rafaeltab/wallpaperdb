"""Real-file controls for selector semantics; not production Media integration."""

import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

from appearance import RGB_TO_XYZ
from avif import (COMMANDS, PRIMARIES, TRANSFERS, decode_avif, decode_transfer,
                  digest, encode_avif, encode_transfer, inspect_avif, native,
                  write_png)
from matrix import (ProofRequestError, exact_original, metadata_view,
                    request_decision)


ROOT = Path(__file__).parent
THRESHOLD_PATH = ROOT / "selector-thresholds.json"
THRESHOLDS = json.loads(THRESHOLD_PATH.read_text())


def alpha_scene(dynamic_range):
    """Deterministic fixture generator, not a converter."""
    signal = np.ones((16, 40, 4), dtype=float)
    linear = np.array([30, 100, 203] if dynamic_range == "hdr" else [5, 20, 70])
    transfer, gamut = ("pq", "rec2020") if dynamic_range == "hdr" else ("srgb", "srgb")
    signal[..., :3] = encode_transfer(linear, transfer, gamut)
    signal[..., 3] = np.repeat(np.array(THRESHOLDS["alpha_steps"]), 8)[None, :]
    return signal


def composed_reference(source, background, dynamic_range):
    transfer, gamut = ("pq", "rec2020") if dynamic_range == "hdr" else ("srgb", "srgb")
    background_linear = decode_transfer(np.array(background)/255, "srgb", "srgb")
    if dynamic_range == "hdr":
        background_linear *= 203/100
    background_target = np.linalg.solve(RGB_TO_XYZ[gamut], RGB_TO_XYZ["srgb"] @ background_linear)
    source_linear = decode_transfer(source[..., :3], transfer, gamut)
    composed = source_linear*source[..., 3:4] + background_target*(1-source[..., 3:4])
    return encode_transfer(composed, transfer, gamut)


def _facts(dynamic_range, depth):
    return {"format": "avif", "range": dynamic_range, "gamut": "rec2020" if dynamic_range == "hdr" else "srgb", "depth": depth,
            "width": 40, "height": 16, "motion": "static", "alpha": "fractional", "alpha_capable": True, "orientation": 1}


def _source(directory, dynamic_range):
    directory.mkdir(parents=True, exist_ok=True)
    png = directory / "fixture.png"
    write_png(png, alpha_scene(dynamic_range))
    source = directory / "source.avif"
    transfer, gamut = ("pq", "rec2020") if dynamic_range == "hdr" else ("srgb", "srgb")
    depth = 12 if dynamic_range == "hdr" else 8
    encode_avif([png], source, transfer, gamut, depth, private=True)
    decoded = decode_avif(source, directory, 1)[0]
    facts = inspect_avif(source)
    if (facts["depth"], facts["transfer"], facts["primaries"]) != (depth, TRANSFERS[transfer], PRIMARIES[gamut]):
        raise ValueError("Selector source facts disagree with independent native inspection")
    return source, decoded, transfer, gamut, depth


def _compose(foreground, background, output, transfer, gamut):
    # Native FFmpeg 8.1/libplacebo performs linear-light composition across two
    # independently tagged inputs. setparams describes verified PNG samples;
    # libplacebo, not setparams, converts the sRGB background and blends layers.
    tags = "format=rgba64le,setparams=range=full:colorspace=0"
    filters = f"[0:v]{tags}:color_primaries=1:color_trc=13,hwupload[bg];[1:v]{tags}:color_primaries={PRIMARIES[gamut]}:color_trc={TRANSFERS[transfer]},hwupload[fg];[bg][fg]libplacebo=inputs=2:colorspace=0:color_primaries={PRIMARIES[gamut]}:color_trc={TRANSFERS[transfer]}:range=pc:peak_detect=0:tonemapping=clip:gamut_mode=clip:contrast_recovery=0:dithering=none:alpha_mode=straight,hwdownload,format=rgba64le[out]"
    native(["ffmpeg", "-v", "error", "-y", "-init_hw_device", "vulkan=vk:0", "-filter_hw_device", "vk", "-i", background, "-i", foreground,
            "-filter_complex", filters, "-map", "[out]", "-frames:v", "1", "-map_metadata", "-1", "-threads", "1", output])


def _measured_case(case_id, source, output, decoded, expected, dynamic_range, *, alpha_expected=None, white=False):
    error = float(np.max(np.abs(decoded[..., :3]-expected)))
    limit = THRESHOLDS["hdr_pq_signal_max_error" if dynamic_range == "hdr" else "sdr_signal_max_error"]
    checks = {"pixel_signal": error <= limit}
    measurements = {"max_signal_error": error, "signal_error_limit": limit}
    if alpha_expected is not None:
        alpha_error = float(np.max(np.abs(decoded[..., 3]-alpha_expected)))
        checks["alpha"] = alpha_error == 0 if np.isscalar(alpha_expected) else alpha_error <= 1/255
        measurements["max_alpha_error"] = alpha_error
    if white and dynamic_range == "hdr":
        nits = decode_transfer(decoded[:, :8, :3], "pq", "rec2020")
        actual_white = float(np.mean(nits))
        measurements["fully_transparent_background_white_nits"] = actual_white
        checks["reference_white"] = abs(actual_white-203) <= THRESHOLDS["hdr_reference_white_tolerance_nits"]
    return {"case_id": case_id, "status": "passed" if all(checks.values()) else "failed", "checks": checks,
            "measurements": measurements, "artifacts": {"source": str(source), "source_sha256": digest(source), "output": str(output), "sha256": digest(output)},
            "codec_qualification": False, "scope": "Exact selector pixel control only; no full conversion or physical-display qualification."}


def _avif_output_facts(control, output, transfer, gamut, depth):
    facts = inspect_avif(output)
    control["facts"] = facts
    control["checks"].update({
        "coded_depth": facts["depth"] == depth,
        "color_signaling": facts["transfer"] == TRANSFERS[transfer] and facts["primaries"] == PRIMARIES[gamut],
        "dimensions": (facts["width"], facts["height"]) == (40, 16),
        "privacy": not any(key in facts["exiftool"] for key in ("GPSLatitude", "GPSLongitude", "Make", "Model")),
    })
    control["status"] = "passed" if all(control["checks"].values()) else "failed"


def _byte_controls(source, facts):
    original = source.read_bytes()
    controls = []
    explicit = {"format": "avif", "range": facts["range"], "gamut": facts["gamut"], "depth": str(facts["depth"]), "motion": "static", "w": "40", "h": "16"}
    for label, known, selectors in (("unknown-facts-original", {}, {}), ("matching-explicit-selectors", facts, explicit), ("coerce-alpha-capable-noop", facts, {"transparency": "coerce"})):
        before = len(COMMANDS)
        delivered = exact_original(original, request_decision(known, selectors))
        controls.append({"case_id": label, "status": "passed" if delivered == original and len(COMMANDS) == before else "failed", "checks": {"exact_bytes": delivered == original, "no_native_calls": len(COMMANDS) == before},
                         "source": str(source), "source_sha256": digest(source), "delivered_sha256": hashlib.sha256(delivered).hexdigest(), "scope": "Proof adapter only; production integration pending"})
    before = len(COMMANDS)
    pending = request_decision({}, {"w": "12"})
    metadata = metadata_view({}, [])
    controls.append({"case_id": "unknown-facts-no-transform", "status": "passed" if pending["action"] == "metadata-pending" and metadata["capabilities"] == [] and len(COMMANDS) == before else "failed",
                     "checks": {"no_native_calls": len(COMMANDS) == before, "original_only": pending["action"] == "metadata-pending", "no_speculative_capabilities": metadata["capabilities"] == []}, "scope": "Proof adapter only; metadata boundary has no byte-reader dependency"})
    rejected = [({"format": "gif", "range": "hdr", "transparency": "coerce", "depth": "8"}, 422),
                ({"format": "jpg", "range": "sdr"}, 422),
                ({"format": "gif", "range": "sdr", "depth": "8"}, 422),
                ({"format": "webp", "range": "sdr", "depth": "preserve"}, 422),
                ({"w": "4", "width": "4"}, 400), ({"transparency": "remove"}, 400)]
    for selectors, expected in rejected:
        before = len(COMMANDS)
        actual = None
        try:
            request_decision(facts, selectors)
        except ProofRequestError as error:
            actual = error.status
        controls.append({"case_id": "rejected-selector", "selectors": selectors, "status": "passed" if actual == expected and before == len(COMMANDS) else "failed", "expected_status": expected, "actual_status": actual,
                         "checks": {"rejected_before_native": actual == expected and before == len(COMMANDS)}, "scope": "Proof adapter only; no production HTTP endpoint exercised"})
    return controls


def run(output_dir):
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    command_start = len(COMMANDS)
    controls, fixtures = [], []
    for dynamic_range in ("sdr", "hdr"):
        folder = directory / dynamic_range
        source, decoded, transfer, gamut, depth = _source(folder, dynamic_range)
        fixtures.append({"id": "selector-"+dynamic_range, "sha256": digest(source), "path": str(source), "generator": "selector_probes.alpha_scene", "native_facts": inspect_avif(source)})
        if dynamic_range == "hdr":
            controls += _byte_controls(source, _facts(dynamic_range, depth))
        foreground = folder / "decoded-0.png"
        for background in ((255, 255, 255), (255, 0, 0)):
            label = "white" if background[1] else "red"
            case_id = f"{dynamic_range}-background-{label}"
            try:
                background_file = folder / f"background-{label}.png"
                bg = np.ones_like(decoded)
                bg[..., :3] = np.array(background)/255
                write_png(background_file, bg)
                composed = folder / f"composed-{label}.png"
                _compose(foreground, background_file, composed, transfer, gamut)
                output = folder / f"background-{label}.avif"
                encode_avif([composed], output, transfer, gamut, depth)
                result = decode_avif(output, folder, 1)[0]
                expected = composed_reference(decoded, background, dynamic_range)
                control = _measured_case(case_id, source, output, result, expected, dynamic_range, alpha_expected=1, white=label == "white")
                control["selectors"] = {"format": "avif", "range": dynamic_range, "gamut": "preserve", "depth": "preserve", "transparency": "#FFFFFF" if label == "white" else "rgb(255,0,0)"}
                _avif_output_facts(control, output, transfer, gamut, depth)
                controls.append(control)
            except Exception as error:
                controls.append({"case_id": case_id, "status": "failed", "blockers": [str(error)], "codec_qualification": False})
            # decode_avif writes decoded-0.png; restore the independently decoded
            # source before the next experiment instead of chaining candidates.
            decode_avif(source, folder, 1)
        try:
            output_png = folder / "coerce.png"
            native(["ffmpeg", "-v", "error", "-y", "-i", foreground, "-vf", "format=rgb48le", "-frames:v", "1", "-map_metadata", "-1", "-threads", "1", output_png])
            output = folder / "coerce.avif"
            encode_avif([output_png], output, transfer, gamut, depth)
            result = decode_avif(output, folder, 1)[0]
            # This explicitly tests the no-alpha native intermediate's hidden
            # channel retention. The AVIF output is an inspection carrier, not a
            # requested coerce transformation for alpha-capable AVIF.
            control = _measured_case(f"{dynamic_range}-native-drop-alpha-hidden-rgb", source, output, result, decoded[..., :3], dynamic_range, alpha_expected=1)
            _avif_output_facts(control, output, transfer, gamut, depth)
            control["scope"] = "Native no-alpha intermediate control; not a claim that transparency=coerce should remove AVIF alpha. JPEG selectors are tested separately by conversion probes."
            controls.append(control)
        except Exception as error:
            controls.append({"case_id": f"{dynamic_range}-native-drop-alpha-hidden-rgb", "status": "failed", "blockers": [str(error)], "codec_qualification": False})
        if dynamic_range == "sdr":
            decode_avif(source, folder, 1)
            for extension in ("jpg", "gif", "webp"):
                case_id = f"sdr-coerce-{extension}"
                try:
                    output = folder / f"coerce.{extension}"
                    options = ["ffmpeg", "-v", "error", "-y", "-i", foreground, "-map_metadata", "-1", "-threads", "1"]
                    if extension == "jpg":
                        options += ["-q:v", "1", "-pix_fmt", "yuvj444p"]
                    elif extension == "gif":
                        options += ["-vf", "format=rgba,split[a][b];[a]palettegen=reserve_transparent=1[pal];[b][pal]paletteuse=alpha_threshold=128"]
                    else:
                        options += ["-c:v", "libwebp", "-lossless", "1", "-pix_fmt", "bgra"]
                    native(options + ["-frames:v", "1", output])
                    # Pillow's libjpeg/GIF/libwebp decoders do not use FFmpeg's
                    # MJPEG or GIF encoder implementation.
                    with Image.open(output) as image:
                        result = np.asarray(image.convert("RGBA")).astype(float)/255
                    alpha = 1 if extension == "jpg" else ((decoded[..., 3] >= .5).astype(float) if extension == "gif" else decoded[..., 3])
                    expected = decoded[..., :3].copy()
                    if extension != "jpg":
                        # A fully transparent pixel's hidden RGB has no visual
                        # claim here; alpha removal into JPEG does test it.
                        expected[result[..., 3] == 0] = result[..., :3][result[..., 3] == 0]
                    control = _measured_case(case_id, source, output, result, expected, dynamic_range, alpha_expected=alpha)
                    if extension == "gif":
                        control["checks"]["binary_alpha_exact"] = bool(np.array_equal(result[..., 3], alpha))
                        control["status"] = "passed" if all(control["checks"].values()) else "failed"
                    control["selectors"] = {"format": extension, "range": "sdr", "gamut": "srgb", "depth": "8", "motion": "static", "transparency": "coerce"}
                    controls.append(control)
                except Exception as error:
                    controls.append({"case_id": case_id, "status": "failed", "blockers": [str(error)], "codec_qualification": False})
    for source in sorted((ROOT / "fixtures/gainmap").glob("*.jpg")):
        original = source.read_bytes()
        before = len(COMMANDS)
        delivered = exact_original(original, request_decision({"format": "jpg"}, {"format": "jpg"}))
        equal = delivered == original and len(COMMANDS) == before
        controls.append({"case_id": "exact-original-" + source.stem, "status": "passed" if equal else "failed",
                         "checks": {"exact_bytes": delivered == original, "no_native_calls": len(COMMANDS) == before},
                         "source": str(source), "source_sha256": digest(source),
                         "delivered_sha256": hashlib.sha256(delivered).hexdigest(),
                         "scope": "Real gain-map JPEG bytes through the proof original-delivery adapter; production integration pending"})
    return {"controls": controls, "evidence": [], "fixtures": fixtures, "commands": COMMANDS[command_start:],
            "thresholds": THRESHOLDS, "thresholds_sha256": digest(THRESHOLD_PATH), "production_integration": "pending", "consumer_status": "pending manual review"}


if __name__ == "__main__":
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "work/selectors")
    report = run(output)
    (output / "selector-controls.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps({"controls": len(report["controls"]), "failed": sum(control["status"] == "failed" for control in report["controls"])}))
