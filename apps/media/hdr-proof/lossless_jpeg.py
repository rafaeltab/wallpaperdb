"""Scoped native SOF3 JPEG candidate; consumer support needs separate proof."""
import hashlib
import json
from pathlib import Path
import struct

from avif import native


def encode(source, output, *, icc_profile=b''):
    """Encode actual opaque RGB8/gray8 PNG samples as predictive lossless JPEG.

    FFmpeg decodes the source PNG; native libjpeg-turbo performs the encoding.
    An empty ICC is useful for gain-map samples, whose interpretation comes
    from gain-map metadata rather than a display profile.
    """
    source, output = Path(source), Path(output)
    data = source.read_bytes()
    if len(data) < 29 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Lossless JPEG candidate requires a PNG input')
    width, height, depth, color = struct.unpack_from('>IIBB', data, 16)
    if depth != 8 or color not in (0, 2) or not 0 < width <= 4096 or not 0 < height <= 4096:
        raise ValueError('Lossless JPEG candidate requires bounded opaque RGB8 or grayscale8 samples')
    # A PNG tRNS chunk can add transparency even to RGB/gray samples. Inspect
    # actual chunks rather than silently discarding that selector obligation.
    offset = 8
    while offset + 12 <= len(data):
        size = struct.unpack_from('>I', data, offset)[0]
        if offset + 12 + size > len(data):
            raise ValueError('Truncated PNG chunk')
        if data[offset+4:offset+8] == b'tRNS':
            raise ValueError('Predictive JPEG cannot retain PNG transparency')
        offset += size + 12
    if not isinstance(icc_profile, bytes) or len(icc_profile) > 8 * 1024 * 1024:
        raise ValueError('ICC profile must be at most eight MiB of bytes')
    components = 3 if color == 2 else 1
    raw = output.with_name(output.stem+'-lossless-input.raw')
    raw.write_bytes(native(['ffmpeg', '-v', 'error', '-c:v', 'png', '-i', source,
                            '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt',
                            'rgb24' if components == 3 else 'gray', 'pipe:1']))
    profile = '-'
    if icc_profile:
        profile = output.with_name(output.stem+'-lossless.icc')
        profile.write_bytes(icc_profile)
    encoded = json.loads(native(['hdr-proof-lossless-jpeg', raw, output, str(width), str(height),
                                 str(components), profile]))
    return {**encoded, 'dimensions': [width, height],
            'coding': 'JPEG SOF3 predictive lossless; consumer compatibility is a separate obligation',
            'input_sha256': hashlib.sha256(data).hexdigest(),
            'icc_sha256': hashlib.sha256(icc_profile).hexdigest() if icc_profile else None,
            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
