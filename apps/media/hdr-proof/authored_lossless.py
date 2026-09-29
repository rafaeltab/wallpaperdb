"""Native lossless SDR PNG/WebP candidates with independently checked ICC."""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms, features

from appearance import RGB_TO_XYZ, sdr_signal_to_nits
from avif import native
from gainmap import private_metadata_tags
from gainmap_iso import srgb_profile_facts
from gainmap_sdr import prepare


def encode(source, output, operation, *, gamut='srgb'):
    source, output = Path(source), Path(output)
    if output.suffix not in ('.png', '.webp'):
        raise ValueError('Expected an explicit PNG or WebP candidate')
    intermediate = output.with_name(output.stem+'-authored.png')
    evidence = prepare(source, intermediate, operation, gamut=gamut)
    if gamut == 'p3':
        with Image.open(source) as image:
            profile = bytearray(image.info['icc_profile'])
    else:
        profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)
    with Image.open(intermediate) as image:
        # A fresh RGB image carries only the deliberately supplied color data.
        clean = Image.frombytes('RGB', image.size, image.convert('RGB').tobytes())
        if output.suffix == '.png':
            clean.save(output, format='PNG', icc_profile=bytes(profile), compress_level=9)
        else:
            clean.save(output, format='WEBP', lossless=True, exact=True, method=6, icc_profile=bytes(profile))
    return {**evidence, 'coding': f'Lossless {output.suffix[1:]} RGB8; sRGB transfer; {gamut} primaries',
            'icc_sha256': hashlib.sha256(profile).hexdigest(),
            'native_encoder': ('Pillow native PNG/zlib '+features.version('zlib') if output.suffix == '.png'
                               else 'Pillow native libwebp '+features.version('webp')),
            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


def _container_facts(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        from hdr_png import _png_chunks
        chunks = _png_chunks(data)
        if not chunks or chunks[0][0] != b'IHDR' or len(chunks[0][1]) != 13:
            raise ValueError('PNG IHDR is missing or malformed')
        width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', chunks[0][1])
        if (depth, color, compression, filtering, interlace) != (8, 2, 0, 0, 0):
            raise ValueError('Expected noninterlaced opaque RGB8 PNG')
        forbidden = {b'acTL', b'tRNS', b'eXIf', b'tEXt', b'zTXt', b'iTXt', b'cICP', b'sRGB', b'gAMA', b'cHRM'}
        if any(kind in forbidden for kind, _ in chunks) or sum(kind == b'iCCP' for kind, _ in chunks) != 1:
            raise ValueError('Unexpected or conflicting PNG metadata')
        return {'format': 'png', 'width': width, 'height': height, 'depth': depth, 'components': 3}
    if data[:4] != b'RIFF' or data[8:12] != b'WEBP' or struct.unpack_from('<I', data, 4)[0]+8 != len(data):
        raise ValueError('Expected a complete PNG or WebP file')
    position, chunks = 12, {}
    while position + 8 <= len(data):
        kind, size = struct.unpack_from('<4sI', data, position)
        if kind in chunks or kind not in (b'VP8X', b'ICCP', b'VP8L') or position+8+size > len(data):
            raise ValueError('Unsupported or duplicate WebP chunk')
        chunks[kind] = data[position+8:position+8+size]
        position += 8 + size + size % 2
    if position != len(data) or set(chunks) != {b'VP8X', b'ICCP', b'VP8L'}:
        raise ValueError('Expected static lossless WebP with one ICC profile')
    extended, payload = chunks[b'VP8X'], chunks[b'VP8L']
    if len(extended) != 10 or extended[:4] != b'\x20\0\0\0' or len(payload) < 5 or payload[0] != 0x2f:
        raise ValueError('Unexpected WebP alpha, animation, or coding flags')
    bits = struct.unpack_from('<I', payload, 1)[0]
    width, height = (bits & 0x3fff)+1, ((bits >> 14) & 0x3fff)+1
    if bits >> 28 or (int.from_bytes(extended[4:7], 'little')+1,
                      int.from_bytes(extended[7:10], 'little')+1) != (width, height):
        raise ValueError('WebP header dimensions, alpha, or version disagree')
    return {'format': 'webp', 'width': width, 'height': height, 'depth': 8, 'components': 3,
            'coding': 'VP8L version 0, opaque RGB8'}


def decode_linear(path, *, gamut='srgb'):
    path = Path(path)
    facts = _container_facts(path.read_bytes())
    profile = native(['exiftool', '-b', '-ICC_Profile', path])
    color = srgb_profile_facts(profile)
    if color['gamut'] != gamut:
        raise ValueError('Emitted ICC primaries disagree with the requested gamut')
    raw = native(['ffmpeg', '-v', 'error', '-c:v', facts['format'], '-i', path, '-frames:v', '1',
                  '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    signal = np.frombuffer(raw, dtype=np.uint8).reshape(facts['height'], facts['width'], 3)/255
    linear = sdr_signal_to_nits(signal) @ RGB_TO_XYZ[gamut].T @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T
    tags = json.loads(native(['exiftool', '-json', '-n', '-G1', '-s', path]))[0]
    return linear, {**facts, 'gamut': gamut, 'transfer': 'srgb', 'color': color,
        'icc_sha256': hashlib.sha256(profile).hexdigest(), 'decoder': f'FFmpeg native {facts["format"]} decoder',
        'privacy': not private_metadata_tags(tags),
        'metadata': {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}}
