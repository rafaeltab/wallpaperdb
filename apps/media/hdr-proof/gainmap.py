"""Execute native gain-map conversion candidates and independent file checks."""

import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess

import numpy as np
from PIL import Image, ImageCms, ImageOps

from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_iso import ISO_ID, iso_metadata, jpeg_facts, reconstruct, segments

ROOT = Path(__file__).parent
FIXTURES = ROOT / "fixtures" / "gainmap"
NAMES = ("gainmap-android-iso", "gainmap-android-xmp", "gainmap-apple-old", "gainmap-apple-new")
FORMATS = ("jpg", "avif", "png", "webp", "gif")
GEOMETRIES = ("contain", "cover", "fill", "upscale", "orientation", "crop")
NATIVE_RETAIN_BUILD = {
    "libultrahdr_version": "2.0.2",
    "source_commit": "e5f5a022fe96fc4dc2ee35c19f733a50df807abe",
    "patch_commits": ["2ae3c547c37c0dd19f051cfb7b5427d24eb26138",
                      "5b2ce500f5f8103a24a388b76d3c6b615d1028e4",
                      "2b058012b5bf4a8433c3593c3c9b15daf8cd7848"],
    "upstream_patch_status": "Experimental pinned PR484 and PR491 patches; not an upstream release.",
    "local_patches": [{"path": "libultrahdr-xmp-arrays.patch",
                       "sha256": "1fa1ab115b8d27dd9fd409554db38adc280637f854b1339aa578fe7c25705383",
                       "scope": "Native scalar/three-channel element XMP reading and per-channel XMP writing; no map pixels rewritten."}],
    "pipeline": "Patched native compressed base/map extraction; Sharp 0.35.5 geometry on each layer; native compressed-layer packing with dual ISO/Android metadata.",
}


def command(args, log, *, data=None, binary=False):
    result = subprocess.run([str(value) for value in args], input=data, capture_output=True,
                            text=not binary, timeout=300)
    log.parent.mkdir(parents=True, exist_ok=True)
    if binary:
        log.write_bytes(result.stderr)
    else:
        log.write_text(json.dumps({"command": [str(v) for v in args], "exit_code": result.returncode,
                                   "stdout": result.stdout, "stderr": result.stderr}, indent=2) + "\n")
    if result.returncode:
        raise RuntimeError((result.stderr.decode() if binary else result.stderr) or
                           (result.stdout.decode(errors="replace") if binary else result.stdout))
    return result.stdout


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private_metadata_tags(tags):
    private_names = ("GPS", "Make", "Model", "SerialNumber", "OwnerName", "Artist", "Copyright",
                     "DateTimeOriginal", "CreateDate", "ModifyDate", "UserComment", "DocumentID",
                     "InstanceID", "OriginalDocumentID", "Patient", "History", "PhotoIdentifier", "RunTime")
    safe_exif = {"Orientation", "XResolution", "YResolution", "ResolutionUnit", "YCbCrPositioning",
                 "ExifVersion", "ComponentsConfiguration", "FlashpixVersion", "ColorSpace",
                 "ExifImageWidth", "ExifImageHeight"}
    safe_xmp_groups = {"XMP-hdrgm", "XMP-GContainer", "XMP-HDRGainMap"}
    private_tags = []
    for key in tags:
        group, _, tag = key.partition(":")
        if group.startswith("ICC"):
            continue
        # The pinned native packer emits this fixed XMP wrapper marker. It is
        # generated software metadata, never a carried-through source value.
        if key == "XMP-x:XMPToolkit" and tags[key] == "Adobe XMP Core 5.1.2":
            continue
        private = any(tag.startswith(name) for name in private_names)
        private |= group in ("IFD0", "ExifIFD", "GPS", "Apple") and tag not in safe_exif
        private |= group.startswith("XMP-") and group not in safe_xmp_groups
        if private:
            private_tags.append(key)
    return private_tags


def inspect(path, directory):
    directory.mkdir(parents=True, exist_ok=True)
    tags = json.loads(command(["exiftool", "-json", "-n", "-G1", "-s", path], directory / "exiftool.log"))[0]
    tags = {key: value for key, value in tags.items()
            if not key.startswith("System:") and key != "SourceFile"}
    result = {"sha256": digest(path), "metadata": tags}
    if path.suffix == ".avif":
        native_info = command(["avifdec", "-j", "1", "-c", "dav1d", "--info", path], directory / "avif-info.log")
        depth_match = re.search(r"Bit Depth\s*:\s*(\d+)", native_info)
        result["coded_depth"] = int(depth_match.group(1)) if depth_match else None
        result["frame_count"] = len(re.findall(r"Decoded frame \[", native_info))
        result["opaque"] = bool(re.search(r"Alpha\s*:\s*Absent", native_info))
        result["native_information"] = native_info
    else:
        with Image.open(path) as image:
            # JPEG MPF's second image is an auxiliary gain map, not motion.
            result["frame_count"] = 1 if path.suffix == ".jpg" else getattr(image, "n_frames", 1)
            result["opaque"] = image.convert("RGBA").getextrema()[3] == (255, 255)
        if path.suffix == ".png":
            result["coded_depth"] = tags.get("PNG:BitDepth")
        elif path.suffix == ".jpg":
            result["coded_depth"] = jpeg_facts(path.read_bytes())["depth"]
        elif path.suffix == ".webp":
            result["coded_depth"] = 8 if "WEBP" in str(tags.get("File:FileType", "")) else None
        elif path.suffix == ".gif":
            result["coded_depth"] = 8 if tags.get("File:FileType") == "GIF" else None
            result["depth_basis"] = "Decoded GIF palette entries contain three 8-bit channel samples; index depth is reported separately."
    result["private_tags"] = private_metadata_tags(tags)
    if path.suffix == ".jpg":
        result["base"] = jpeg_facts(path.read_bytes())
        map_data = command(["exiftool", "-b", "-MPImage2", path], directory / "map-extraction.log", binary=True)
        result["gain_map_present"] = bool(map_data)
        if map_data:
            (directory / "map.jpg").write_bytes(map_data)
            result["map"] = jpeg_facts(map_data)
            result["iso_identifier"] = any(marker == 0xE2 and value.startswith(ISO_ID)
                                             for marker, value in segments(map_data))
            xmp = command(["exiftool", "-json", "-G1", "-s", directory / "map.jpg"], directory / "map-exiftool.log")
            map_tags = json.loads(xmp)[0]
            result["map_private_tags"] = private_metadata_tags(map_tags)
            result["private_tags"].extend("gain-map:" + key for key in result["map_private_tags"])
            result["android_xmp_properties"] = {key: value for key, value in map_tags.items()
                                                 if key.startswith("XMP-hdrgm:")}
            if result["iso_identifier"]:
                result["iso_metadata"] = iso_metadata(map_data)
    (directory / "inspection.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def source_image(path, gamut):
    with Image.open(path) as original:
        profile = original.info.get("icc_profile")
        image = original.convert("RGB")
    if gamut == "srgb" and profile:
        image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                          ImageCms.createProfile("sRGB"), renderingIntent=0, outputMode="RGB")
        # LittleCMS writes the current time into a newly generated profile.
        # ICC header bytes 24..35 contain six big-endian uint16 date fields.
        # Fix only this reference profile's creation date to 2000-01-01 UTC;
        # do this after the native CMS transform so serializing and reopening
        # its in-memory color tags cannot alter reference-pixel rounding.
        reference_profile = bytearray(image.info["icc_profile"])
        reference_profile[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
        image.info["icc_profile"] = bytes(reference_profile)
    return image


def output_gamut(facts):
    """Recognize only the exact ICC descriptions used by this pinned corpus.

    This is not an arbitrary ICC interpreter. Unknown descriptions and absent
    profiles remain unknown, even when a decoder returns plausible RGB samples.
    """
    profiles = {"sRGB": "srgb", "Display P3": "p3",
                "Display P3 Gamut with sRGB Transfer": "p3"}
    return profiles.get(facts["metadata"].get("ICC_Profile:ProfileDescription"))


def geometry(image, operation, orientation=1):
    if operation == "orientation":
        transforms = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
                      4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
                      6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
                      8: Image.Transpose.ROTATE_90}
        if orientation in transforms:
            image = image.transpose(transforms[orientation])
    if operation == "cover":
        return ImageOps.fit(image, (173, 173), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    if operation == "fill":
        return image.resize((173, 211), Image.Resampling.LANCZOS)
    if operation == "crop":
        return image.crop((13, 17, 284, 256)).resize((173, 153), Image.Resampling.LANCZOS)
    width = 769 if operation == "upscale" else 173
    height = math.floor(image.height * width / image.width + 0.5)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def array_geometry(array, operation, orientation=1):
    return np.maximum(np.stack([np.asarray(geometry(Image.fromarray(array[..., channel].astype(np.float32)),
                                                    operation, orientation)) for channel in range(3)], axis=-1), 0)


def decoded_rgb(path, directory):
    # Pillow uses independent libjpeg/libpng/libwebp. AVIF is independently
    # decoded with FFmpeg/libdav1d; Sharp uses its bundled libheif/AOM.
    if path.suffix != ".avif":
        return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
    png = directory / "independent.png"
    command(["ffmpeg", "-v", "error", "-threads", "1", "-i", path, "-frames:v", "1", "-y", png],
            directory / "ffmpeg-decode.log")
    return np.asarray(Image.open(png).convert("RGB"), dtype=np.float64) / 255.0


def independent_hdr(path, directory, gamut):
    """Decode supported XMP/Apple JPEG through independent libavif gain-map math."""
    avif = directory / "oracle-lossless.avif"
    png = directory / "oracle-pq.png"
    primaries = {"p3": 12, "rec2020": 9, "srgb": 1}[gamut]
    command(["avifgainmaputil", "convert", path, avif, "--cicp", f"{primaries}/13/0", "--ignore-profile",
             "-d", "8", "-y", "444", "-q", "100", "--qgain-map", "100", "-s", "10"],
            directory / "independent-hdr-convert.log")
    command(["avifgainmaputil", "tonemap", avif, png, "--headroom", "4", "--cicp-output", "9/16/0",
             "--ignore-profile", "-d", "12", "-y", "444"], directory / "independent-hdr-tonemap.log")
    command(["avifgainmaputil", "printmetadata", avif], directory / "independent-gainmap-metadata.log")
    raw = command(["ffmpeg", "-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb48le", "pipe:1"],
                  directory / "independent-hdr-pixels.log", binary=True)
    with Image.open(png) as decoded:
        width, height = decoded.size
    signal = np.frombuffer(raw, dtype="<u2").reshape(height, width, 3) / 65535.0
    # ST 2084 inverse transfer, with absolute luminance in cd/m2.
    power = signal ** (1 / (2523 / 32))
    return 10000 * (np.maximum(power - 3424 / 4096, 0) /
                    (2413 / 128 - (2392 / 128) * power)) ** (1 / (2610 / 16384))


def selectors(mode, gamut, operation):
    result = {"range": "sdr" if mode == "sdr" else "hdr", "gamut": gamut, "depth": "preserve", "motion": "preserve"}
    result.update({"width": 769 if operation == "upscale" else 173,
                   "fit": "cover" if operation == "cover" else "fill" if operation in ("fill", "crop") else "contain"})
    if operation in ("cover", "fill", "crop"):
        result["height"] = {"cover": 173, "fill": 211, "crop": 153}[operation]
    return result


def source_hdr(path, directory, gamut):
    """Decode a gain-map JPEG whose gamut the caller has already established."""
    from gainmap_iso import decode_iso_source
    try:
        pixels = independent_hdr(path, directory, gamut)
        return pixels, 'rec2020', {'decoder': 'Independent native libavif gain-map reconstruction',
                                  'scope': 'Pinned source corpus with independently established base gamut'}
    except Exception as error:
        preferred_failure = str(error)[:1800]
    decoded = decode_iso_source(Path(path).read_bytes(), (Path(directory)/'map.jpg').read_bytes())
    if decoded['gamut'] != gamut:
        raise ValueError('Independently decoded ISO gamut disagrees with declared source gamut')
    return decoded['linear_rgb_nits'], decoded['gamut'], {
        **decoded['evidence'], 'preferred_decoder_failure': preferred_failure}


def run(output_dir):
    output_dir = Path(output_dir).resolve()
    directory = output_dir / "gainmap"
    directory.mkdir(parents=True, exist_ok=True)
    fixture_evidence, sources, jobs = [], {}, []
    for name in NAMES:
        path = FIXTURES / f"{name}.jpg"
        evidence_dir = directory / "sources" / name
        facts = inspect(path, evidence_dir)
        gamut = "srgb" if name == "gainmap-android-xmp" else "p3"
        established_gamut = output_gamut(facts)
        if established_gamut is None and (facts["metadata"].get("ExifIFD:ColorSpace") == 1
                                          and facts["metadata"].get("InteropIFD:InteropIndex") == "R98"):
            established_gamut = "srgb"
        facts["established_gamut"] = established_gamut
        if established_gamut != gamut:
            raise ValueError(f"Fixture {name} lacks independent signaling for its declared {gamut} gamut")
        sources[name] = {"path": path, "facts": facts, "gamut": gamut}
        try:
            sources[name]["hdr"], sources[name]["hdr_gamut"], decoder_evidence = source_hdr(path, evidence_dir, gamut)
            facts["independent_hdr_decode"] = True
            facts["independent_hdr_decoder_evidence"] = decoder_evidence
        except Exception as error:
            facts["independent_hdr_decode"] = False
            facts["independent_hdr_blocker"] = str(error)[:1800]
            try:
                sources[name]["hdr"], _ = reconstruct(path.read_bytes(), (evidence_dir / "map.jpg").read_bytes())
                sources[name]["hdr_gamut"] = gamut
            except Exception as fallback_error:
                facts["supplementary_iso_oracle_blocker"] = str(fallback_error)
        fixture_evidence.append({"fixture_id": name, **facts})
        for mode in ("keep", "regenerate", "native-regenerate", "native-regenerate-avif", "sdr"):
            formats = FORMATS if mode in ("keep", "sdr") else ("jpg",)
            for fmt in formats:
                gamuts = ("preserve", "srgb") if mode == "sdr" else ("preserve",)
                for gamut_selector in gamuts:
                    operations = GEOMETRIES if fmt == "jpg" else ("contain", "cover")
                    for operation in operations:
                        case_id = f"{name}:{'sdr' if mode == 'sdr' else 'hdr'}:{fmt}:{gamut_selector}:preserve:{operation}"
                        if mode in ("regenerate", "native-regenerate", "native-regenerate-avif"):
                            case_id += f":{mode}"
                        case_dir = directory / "cases" / case_id.replace(":", "-")
                        case_dir.mkdir(parents=True, exist_ok=True)
                        input_path = path
                        if operation == "orientation":
                            input_path = case_dir / "input-orientation-6.jpg"
                            shutil.copyfile(path, input_path)
                            command(["exiftool", "-overwrite_original", "-Orientation#=6", input_path], case_dir / "orientation-fixture.log")
                        native_mode = "native-retain" if mode == "keep" and fmt == "jpg" else mode
                        jobs.append({"case_id": case_id, "fixture_id": name, "mode": native_mode,
                                     "source_gamut": established_gamut,
                                     "input": str(input_path), "output": str(case_dir / f"output.{fmt}"),
                                     "geometry": operation, "orientation": 6 if operation == "orientation" else 1,
                                     "gamut": gamut_selector, "format": fmt})
        # All EXIF orientations use each authored source; the canonical case is 6.
        for orientation in (1, 2, 3, 4, 5, 7, 8):
            for mode in ("keep", "sdr"):
                case_id = f"{name}:{'sdr' if mode == 'sdr' else 'hdr'}:jpg:preserve:preserve:orientation-{orientation}"
                case_dir = directory / "cases" / case_id.replace(":", "-")
                case_dir.mkdir(parents=True, exist_ok=True)
                input_path = case_dir / f"input-orientation-{orientation}.jpg"
                shutil.copyfile(path, input_path)
                command(["exiftool", "-overwrite_original", f"-Orientation#={orientation}", input_path], case_dir / "orientation-fixture.log")
                jobs.append({"case_id": case_id, "fixture_id": name,
                             "mode": "native-retain" if mode == "keep" else mode,
                             "source_gamut": established_gamut,
                             "input": str(input_path), "output": str(case_dir / "output.jpg"),
                             "geometry": "orientation", "orientation": orientation, "gamut": "preserve", "format": "jpg"})

    (directory / "jobs.json").write_text(json.dumps(jobs, indent=2) + "\n")
    native = command(["node", ROOT / "gainmap.cjs"], directory / "native-encoders.log", data=json.dumps(jobs))
    native_results = {entry["case_id"]: entry for entry in map(json.loads, native.splitlines())}
    cases = []
    for job in jobs:
        source = sources[job["fixture_id"]]
        path, case_dir = Path(job["output"]), Path(job["output"]).parent
        encoded = native_results[job["case_id"]]
        is_hdr = job["mode"] != "sdr"
        case = {"case_id": job["case_id"], "cell_id": f"gainmap-jpeg:{'hdr' if is_hdr else 'sdr'}:{job['format']}",
                "fixture_id": job["fixture_id"], "selectors": selectors(job["mode"], job["gamut"], job["geometry"]),
                "geometry": job["geometry"], "candidate": f"sharp-0.35.5:{job['mode']}",
                "status": "tested and failed", "checks": {"native_encoder": encoded["ok"], "independent_decoder": False,
                    "structure": False, "appearance": False, "privacy": False},
                "blockers": [], "artifacts": [], "measurements": {}}
        case["selectors"]["format"] = job["format"]
        case["established_source_gamut"] = job["source_gamut"]
        if job["mode"] in ("native-retain", "native-regenerate", "native-regenerate-avif"):
            case["candidate"] = "libultrahdr-2.0.2+PR484+PR491+XMP-arrays:retain-base-and-map:sharp-0.35.5-geometry"
            case["native_build"] = NATIVE_RETAIN_BUILD
            regeneration = job["mode"] != "native-retain"
            if regeneration:
                source_decoder = "libavif-1.4.1" if job["mode"] == "native-regenerate-avif" else "libultrahdr-2.0.2"
                case["candidate"] = f"libultrahdr-2.0.2+PR484+PR491+XMP-arrays:regenerate-against-authored-base:source-{source_decoder}"
                case["native_build"] = {**NATIVE_RETAIN_BUILD,
                    "pipeline": "Native source HDR decode; FFmpeg float linear Lanczos geometry; native libultrahdr supplied HDR/SDR intent regeneration, retained compressed authored SDR base and full-resolution quality100 RGB gain map."}
            native_log = case_dir / ("native-regenerated-parts-both" if regeneration else "native-parts-both") / "native-commands.json"
            if native_log.exists():
                case["artifacts"].append(str(native_log.relative_to(output_dir)))
            if encoded["ok"]:
                case["source_gainmap_metadata"] = encoded["source_gainmap_metadata"]
                case["native_variant"] = encoded["native_variant"]
                case["retained_parts"] = {key: str(Path(value).relative_to(output_dir))
                                          for key, value in encoded["retained_parts"].items()}
                if regeneration:
                    case["regeneration"] = encoded["regeneration"]
                    case["native_hdr_source"] = {**encoded["native_hdr_source"],
                        "path": str(Path(encoded["native_hdr_source"]["path"]).relative_to(output_dir))}
        if job["geometry"] == "crop":
            case["probe_crop_rectangle"] = {"left": 13, "top": 17, "width": 271, "height": 239}
        if not encoded["ok"]:
            case["blockers"].append(encoded["error"])
            cases.append(case)
            continue
        case["artifacts"].append(str(path.relative_to(output_dir)))
        try:
            facts = inspect(path, case_dir)
            case["facts"] = facts
            case["checks"]["privacy"] = not facts["private_tags"]
            reference = geometry(source_image(source["path"], job["gamut"]), job["geometry"], job["orientation"])
            reference_path = case_dir / "reference-sdr.png"
            # The independent reference keeps only color signaling. Source
            # camera metadata must not leak through Pillow's image.info.
            reference_profile = reference.info.get("icc_profile")
            reference.info.clear()
            reference.save(reference_path, icc_profile=reference_profile)
            case["reference_sdr"] = {"path": str(reference_path.relative_to(output_dir)),
                                     "sha256": digest(reference_path),
                                     "purpose": "Independent matched-geometry authored SDR reference"}
            actual = decoded_rgb(path, case_dir)
            case["checks"]["independent_decoder"] = True
            width, height = reference.size
            actual_gamut = output_gamut(facts)
            case["color_signaling"] = {
                "gamut": actual_gamut,
                "basis": "Independently parsed exact ICC profile description from the pinned fixture/encoder allowlist.",
                "limitation": "This proof does not interpret arbitrary ICC profiles; absent and unrecognized profiles stay unqualified.",
            }
            if actual_gamut is None:
                case["blockers"].append("Emitted gamut signaling is absent or unrecognized; decoded RGB cannot establish an sRGB or Display P3 output.")
                cases.append(case)
                continue
            expected_gamut = source["gamut"] if job["gamut"] == "preserve" else "srgb"
            structure = actual.shape == (height, width, 3) and actual_gamut == expected_gamut
            structure &= facts["metadata"].get("IFD0:Orientation", 1) == 1
            structure &= facts["coded_depth"] == source["facts"]["base"]["depth"]
            structure &= facts["frame_count"] == 1 and facts["opaque"]
            if job["format"] == "jpg":
                structure &= facts["base"]["depth"] == source["facts"]["base"]["depth"]
                if is_hdr:
                    structure &= facts.get("gain_map_present", False) and facts.get("map", {}).get("depth") == source["facts"]["map"]["depth"]
                    structure &= "iso_metadata" in facts
                else:
                    structure &= not facts.get("gain_map_present", False)
            if is_hdr and job["format"] != "jpg":
                structure = False
                case["blockers"].append("This direct Sharp candidate does not preserve a verified HDR representation in this output format.")
            case["checks"]["structure"] = bool(structure)
            sdr_measurement = compare_appearance(sdr_signal_to_nits(np.asarray(reference, dtype=np.float64) / 255),
                                                sdr_signal_to_nits(actual), reference_gamut=expected_gamut,
                                                actual_gamut=actual_gamut, fixture_class="gainmap-sdr")
            case["measurements"]["authored_sdr_base"] = sdr_measurement
            case["measurements"]["rgb_mae_code_255"] = float(np.mean(np.abs(np.asarray(reference) - actual * 255)))
            case["checks"]["appearance"] = sdr_measurement["passed"]
            if is_hdr:
                if "native_hdr_source" in case and "hdr" in source:
                    native_source = case["native_hdr_source"]
                    values = np.fromfile(output_dir / native_source["path"], dtype="<f4")
                    native_source_rgb = values.reshape(3, native_source["height"], native_source["width"])[[2, 0, 1]].transpose(1, 2, 0) * 203.0
                    case["measurements"]["native_source_hdr_decode"] = compare_appearance(
                        source["hdr"], native_source_rgb, reference_gamut=source["hdr_gamut"],
                        actual_gamut={0: "srgb", 1: "p3", 2: "rec2020"}[native_source["gamut"]], fixture_class="gainmap-hdr")
                case["checks"]["independent_source_decoder"] = source["facts"]["independent_hdr_decode"]
                if not source["facts"]["independent_hdr_decode"]:
                    case["blockers"].append("Source HDR has no independently verified decoder within the supported native/ISO reader scope; supplementary reconstruction cannot qualify this conversion.")
                try:
                    hdr_output, hdr_gamut, decoder_evidence = source_hdr(path, case_dir, actual_gamut)
                    case['output_decoder_evidence'] = decoder_evidence
                except Exception as error:
                    case["checks"]["independent_decoder"] = False
                    case["blockers"].append("Output is outside the verified native/ISO HDR decoder scope: " + str(error)[:1300])
                    if job["format"] != "jpg" or not facts.get("iso_metadata"):
                        raise ValueError("No independently reconstructable HDR output")
                    hdr_output, _ = reconstruct(path.read_bytes(), (case_dir / "map.jpg").read_bytes())
                    hdr_gamut = actual_gamut
                    case["measurements"]["hdr_oracle_scope"] = "Supplementary proof-only ISO oracle, not independently qualified ISO interoperability"
                if "hdr" not in source:
                    raise ValueError("Source HDR reconstruction unavailable")
                hdr_reference = array_geometry(source["hdr"], job["geometry"], job["orientation"])
                hdr_measurement = compare_appearance(hdr_reference, hdr_output, reference_gamut=source["hdr_gamut"],
                                                     actual_gamut=hdr_gamut, fixture_class="gainmap-hdr")
                case["measurements"]["reconstructed_hdr"] = hdr_measurement
                case["checks"]["appearance"] &= hdr_measurement["passed"]
                if not facts.get("android_xmp_properties"):
                    case["blockers"].append("Independent ExifTool parsed no Android hdrgm XMP properties on the emitted map; dual ISO/Android metadata interoperability is unqualified.")
            if not case["checks"]["structure"]:
                case["blockers"].append("Emitted geometry, orientation, gamut, depth, or HDR representation did not satisfy selectors.")
            if not case["checks"]["privacy"]:
                case["blockers"].append("Transformed file retained private metadata: " + ", ".join(facts["private_tags"]))
            if not case["checks"]["appearance"]:
                case["blockers"].append("Authored SDR or reconstructed HDR appearance exceeded predeclared fixture thresholds.")
            if all(case["checks"].values()) and not case["blockers"]:
                case["status"] = "qualified"
        except Exception as error:
            case["blockers"].append(str(error)[:1800])
        cases.append(case)
    # Reuse an independently inspected real AVIF gain-map source produced by
    # lossless native conversion, then test Sharp's same-format HDR derivative.
    avif_source = directory / "sources" / "gainmap-android-xmp" / "oracle-lossless.avif"
    if avif_source.exists():
        case_dir = directory / "cases" / "avif-gainmap-hdr-avif-contain"
        case_dir.mkdir(parents=True, exist_ok=True)
        output = case_dir / "output.avif"
        job = {"case_id": "avif-gainmap:hdr:avif:preserve:preserve:contain", "input": str(avif_source),
               "output": str(output), "format": "avif", "geometry": "contain", "gamut": "preserve", "mode": "keep"}
        evidence = {"case_id": job["case_id"], "cell_id": "avif-gainmap:hdr:avif",
                    "fixture_id": "avif-gainmap-from-android-xmp", "selectors": selectors("keep", "preserve", "contain"),
                    "geometry": "contain", "candidate": "sharp-0.35.5:keep",
                    "status": "tested and failed", "checks": {"native_encoder": False, "independent_decoder": False,
                        "structure": False, "appearance": False, "privacy": False},
                    "blockers": [], "artifacts": [], "measurements": {}}
        evidence["selectors"]["format"] = "avif"
        try:
            encoded = json.loads(command(["node", ROOT / "gainmap.cjs"], case_dir / "native-encoder.log", data=json.dumps([job])))
            evidence["checks"]["native_encoder"] = encoded["ok"]
            if not encoded["ok"]:
                evidence["blockers"].append(encoded["error"])
            else:
                decoded = command(["avifdec", "--info", output], case_dir / "independent-avif-info.log")
                evidence["checks"]["independent_decoder"] = True
                evidence["artifacts"] = [str(output.relative_to(output_dir))]
                evidence["independent_information"] = decoded
                evidence["blockers"].append("This Sharp gain-map AVIF geometry candidate has no independent matched SDR/HDR proof and is not qualified.")
                evidence["facts"] = inspect(output, case_dir)
                evidence["checks"]["privacy"] = not evidence["facts"]["private_tags"]
        except Exception as error:
            evidence["blockers"].append(str(error)[:1800])
        cases.append(evidence)
    result = {"fixtures": fixture_evidence, "cases": cases,
              "scope": "Native codec candidates only. Production routing and physical displays are not qualified.",
              "oracle_limitations": ["ISO-only reconstruction qualifies decoder evidence only within the separately tested native-libjpeg/ISO reader scope; unknown metadata and color facts remain unsupported.",
                                     "The old/new Apple fixture pair shares pixels; the new file substitutes documented newer metadata."]}
    (directory / "evidence.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


if __name__ == "__main__":
    import sys
    result = run(sys.argv[1] if len(sys.argv) > 1 else ROOT / "results")
    print(json.dumps({"gainmap_cases": len(result["cases"]), "qualified": sum(c["status"] == "qualified" for c in result["cases"])}))
