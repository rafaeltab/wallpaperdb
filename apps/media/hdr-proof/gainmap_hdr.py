"""Native HDR source decode and float geometry for gain-map candidates.

The geometry reference operates in Rec.2020 display light and drops filter
support outside the image. Native zero padding plus a resampled coverage image
implements that boundary condition. Negative Lanczos excursions are clipped
only after resampling. Files keep float alpha until a later transfer encoding;
dropping it through swscale first would quantize linear light to 16 bits.
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image

from gainmap import command


def decode_source(source, directory, gamut):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    primaries = {"srgb": 1, "p3": 12}[gamut]
    avif, pq = directory / "source.avif", directory / "source-pq-rec2020.png"
    command(["avifgainmaputil", "convert", source, avif, "--cicp", f"{primaries}/13/0",
             "--ignore-profile", "-d", "8", "-y", "444", "-q", "100", "--qgain-map", "100", "-s", "10"],
            directory / "decode-convert.log")
    command(["avifgainmaputil", "tonemap", avif, pq, "--headroom", "4", "--cicp-output", "9/16/0",
             "--ignore-profile", "-d", "12", "-y", "444"], directory / "decode-pq.log")
    return pq


def resample_pq(source_pq, output, operation, orientation=1):
    """Resample known Rec.2020/PQ PNG through native float Lanczos filters."""
    output = Path(output)
    with Image.open(source_pq) as image:
        source_width, source_height = image.size
    width, height = source_width, source_height
    prefix = []
    if operation == "orientation":
        effects = {2: ["hflip"], 3: ["hflip", "vflip"], 4: ["vflip"],
                   5: ["transpose=clock", "hflip"], 6: ["transpose=clock"],
                   7: ["transpose=clock", "vflip"], 8: ["transpose=cclock"]}
        prefix += effects.get(orientation, [])
        if orientation >= 5:
            width, height = height, width
    if operation == "crop":
        prefix += ["crop=271:239:13:17"]
        width, height = 271, 239
    target_width = 769 if operation == "upscale" else 173
    target_height = math.floor(height * target_width / width + 0.5)
    final_crop = ""
    if operation == "fill":
        target_height = 211
    elif operation == "crop":
        target_height = 153
    elif operation == "cover":
        scale = 173 / min(width, height)
        target_width, target_height = math.floor(width * scale + 0.5), math.floor(height * scale + 0.5)
        final_crop = ",crop=173:173:(iw-ow)/2:(ih-oh)/2"
    elif operation not in ("contain", "upscale", "orientation"):
        raise ValueError(f"Unknown HDR geometry {operation}")
    resample = (f"zscale=agamma=0:w={target_width*3}:h={target_height*3}:filter=lanczos,"
                "format=gbrapf32le:alpha_modes=premultiplied,"
                f"crop={target_width}:{target_height}:{target_width}:{target_height}")
    coverage = "between(X,W/3,2*W/3-1)*between(Y,H/3,2*H/3-1)"
    filters = ("[0:v]" + ",".join(prefix + [
        "format=gbrap16le", "pad=iw*3:ih*3:iw:ih:color=black@0", "setparams=alpha_mode=premultiplied",
        "format=gbrapf32le:alpha_modes=premultiplied",
        "zscale=agamma=0:transferin=16:primariesin=9:matrixin=0:rangein=full:transfer=linear:primaries=9:matrix=0:range=full:npl=10000",
        "format=gbrapf32le:alpha_modes=premultiplied", "split[pixels][coverage]"])
        + ";[pixels]" + resample + "[numerator];[coverage]geq="
        + ":".join(f"{channel}='{coverage}'" for channel in "rgba") + "," + resample + "[weight];"
        "[numerator][weight]blend=all_expr='if(gt(B,0),max(A/B,0),0)'"
        + final_crop + ",setparams=alpha_mode=premultiplied,format=gbrapf32le:alpha_modes=premultiplied[out]")
    command(["ffmpeg", "-v", "error", "-filter_complex_threads", "1", "-i", source_pq,
             "-filter_complex", filters, "-map", "[out]", "-frames:v", "1", "-pix_fmt", "gbrapf32le",
             "-f", "rawvideo", "-y", output], output.with_suffix(".log"))
    return {"path": str(output), "format": "gbrapf32le", "gamut": "rec2020", "transfer": "linear",
            "normalization_nits": 10000, "width": 173 if operation == "cover" else target_width,
            "height": 173 if operation == "cover" else target_height, "filter": filters,
            "source_size": [source_width, source_height]}


def read_linear(result):
    """Read native evidence for test-time measurements only."""
    values = np.fromfile(result["path"], dtype="<f4").reshape(4, result["height"], result["width"])
    return values[[2, 0, 1]].transpose(1, 2, 0).astype(np.float64) * result["normalization_nits"]
