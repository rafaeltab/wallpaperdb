"""Separate native MozJPEG SOF0 RGB8 experiments at quality100."""
import hashlib
import json
from pathlib import Path
import struct

from PIL import Image

from avif import native
from gainmap_iso import jpeg_facts, segments

HELPER = Path('/opt/proof/mozjpeg/hdr-proof-mozjpeg')


def encode(source, output, *, icc_profile=b'', method='islow', trellis=False, deringing=False,
           optimized_huffman=True, lambda_scale1=14.75, lambda_scale2=16.5):
    if method not in ('islow', 'float'):
        raise ValueError('Unknown native MozJPEG DCT method')
    if any(not isinstance(value, bool) for value in (trellis, deringing, optimized_huffman)):
        raise ValueError('Native MozJPEG controls must be boolean')
    if (type(lambda_scale1) not in (int, float) or lambda_scale1 not in (14.75, 18.75, 22.75)
            or type(lambda_scale2) not in (int, float) or lambda_scale2 != 16.5):
        raise ValueError('Native lambda experiment requires scale1 in {14.75,18.75,22.75} and scale2=16.5')
    source, output = Path(source), Path(output)
    data = source.read_bytes()
    if len(data) < 29 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Native MozJPEG proof requires opaque RGB8 PNG')
    width, height, depth, color = struct.unpack_from('>IIBB', data, 16)
    if depth != 8 or color != 2 or not 0 < width <= 4096 or not 0 < height <= 4096:
        raise ValueError('Native MozJPEG proof requires bounded opaque RGB8 PNG')
    with Image.open(source) as image:
        if image.mode != 'RGB' or 'transparency' in image.info:
            raise ValueError('Native MozJPEG proof requires opaque RGB8 PNG')
        pixels = image.tobytes()
    raw = output.with_name(output.stem+'-mozjpeg-input.raw')
    raw.write_bytes(pixels)
    profile = '-'
    if icc_profile:
        profile = output.with_name(output.stem+'-mozjpeg.icc')
        profile.write_bytes(icc_profile)
    evidence = json.loads(native([HELPER, raw, output, str(width), str(height), profile,
                                  method, '1' if trellis else '0', '1' if deringing else '0',
                                  '1' if optimized_huffman else '0', str(lambda_scale1), str(lambda_scale2)]))
    emitted = output.read_bytes()
    facts = jpeg_facts(emitted)
    sof = next(value for marker, value in segments(emitted) if marker == 0xC0)
    sampling = list(sof[7::3])
    if (facts['sof'] != 0 or facts['depth'] != 8 or facts['components'] != 3
            or sof[6::3] != b'RGB' or sampling != [17, 17, 17]):
        raise ValueError('Native MozJPEG output is not the requested SOF0 RGB8 4:4:4 coding')
    with Image.open(output) as image:
        quantization = image.quantization
    return {**evidence, 'sampling_factors': sampling, 'dimensions': [width, height],
        'quantization_tables': quantization,
        'native_encoder_binary_sha256': hashlib.sha256(HELPER.read_bytes()).hexdigest(),
        'input_sha256': hashlib.sha256(data).hexdigest(),
        'icc_sha256': hashlib.sha256(icc_profile).hexdigest() if icc_profile else None,
        'output_sha256': hashlib.sha256(emitted).hexdigest(),
        'scope': 'Native SOF0 RGB8 JPEG with unchanged transfer/primaries and no chroma subsampling'}
