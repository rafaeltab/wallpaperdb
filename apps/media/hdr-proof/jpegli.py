"""Separate native JPEGli RGB8 baseline trials with unchanged sRGB transfer."""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

from avif import native
from gainmap_iso import jpeg_facts, segments

HELPER = Path('/opt/proof/jpegli/hdr-proof-jpegli')


def encode(source, output, *, icc_profile=b'', input_type='uint8', tables='standard', adaptive=False, quality=100):
    if input_type not in ('uint8', 'float32'):
        raise ValueError('Unknown native JPEGli input type')
    if tables not in ('standard', 'jpegli') or not isinstance(adaptive, bool):
        raise ValueError('Unknown native JPEGli quantization options')
    if type(quality) is not int or quality not in (98, 99, 100):
        raise ValueError('JPEGli proof quality is bounded to 98, 99, and the unchanged default100')
    source, output = Path(source), Path(output)
    data = source.read_bytes()
    if len(data) < 29 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Native JPEGli proof requires opaque RGB8 PNG')
    width, height, depth, color = struct.unpack_from('>IIBB', data, 16)
    if depth != 8 or color != 2 or not 0 < width <= 4096 or not 0 < height <= 4096:
        raise ValueError('Native JPEGli proof requires bounded opaque RGB8 PNG')
    with Image.open(source) as image:
        if image.mode != 'RGB' or 'transparency' in image.info:
            raise ValueError('Native JPEGli proof requires opaque RGB8 PNG')
        pixels = np.asarray(image, dtype=np.uint8)
    raw = output.with_name(output.stem+'-jpegli-input.raw')
    # Numeric transport of the same codes, with no transfer/grade adjustment.
    raw.write_bytes(pixels.tobytes() if input_type == 'uint8' else (pixels.astype('<f4')/255).tobytes())
    profile = '-'
    if icc_profile:
        profile = output.with_name(output.stem+'-jpegli.icc')
        profile.write_bytes(icc_profile)
    evidence = json.loads(native([HELPER, raw, output, str(width), str(height), profile,
                                  input_type, tables, '1' if adaptive else '0', str(quality)]))
    emitted = output.read_bytes()
    facts = jpeg_facts(emitted)
    sof = next(value for marker, value in segments(emitted) if marker == 0xC0)
    sampling = list(sof[7::3])
    if (facts['sof'] != 0 or facts['depth'] != 8 or facts['components'] != 3
            or sof[6::3] != b'RGB' or sampling != [17, 17, 17]):
        raise ValueError('Native JPEGli output is not the requested SOF0 RGB8 4:4:4 coding')
    with Image.open(output) as image:
        quantization = image.quantization
    return {**evidence, 'sampling_factors': sampling, 'dimensions': [width, height],
        'quantization_tables': quantization,
        'native_encoder_binary_sha256': hashlib.sha256(HELPER.read_bytes()).hexdigest(),
        'input_sha256': hashlib.sha256(data).hexdigest(),
        'icc_sha256': hashlib.sha256(icc_profile).hexdigest() if icc_profile else None,
        'output_sha256': hashlib.sha256(emitted).hexdigest(),
        'scope': 'Native RGB8 JPEG only; float input does not change coded sample depth'}
