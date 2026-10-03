"""Native RGB8 SDR AVIF from an authored base, decoded independently by dav1d."""
from pathlib import Path
import re

import numpy as np

import avif
import gainmap
from appearance import RGB_TO_XYZ, sdr_signal_to_nits
from gainmap_sdr import prepare


def encode(source, output, operation, *, gamut='srgb'):
    output = Path(output)
    if output.suffix != '.avif' or gamut not in ('srgb', 'p3'):
        raise ValueError('Expected an explicit SDR AVIF candidate with established sRGB/P3 color facts')
    intermediate = output.with_name(output.stem+'-authored.png')
    evidence = prepare(source, intermediate, operation, gamut=gamut)
    avif.encode_avif([intermediate], output, 'srgb', gamut, 8)
    return {**evidence, 'coding': f'Lossless AV1 RGB8; sRGB transfer; {gamut} primaries',
        'native_encoder': 'libavif/AOM; quality 100, identity matrix, full range',
        'output_sha256': avif.digest(output)}


def decode_linear(path, *, gamut='srgb'):
    path = Path(path)
    facts = avif.inspect_avif(path)
    exif = facts['exiftool']
    if (gamut not in ('srgb', 'p3') or facts['depth'] != 8
            or facts['primaries'] != avif.PRIMARIES[gamut] or exif.get('ColorPrimaries') != facts['primaries']
            or facts['transfer'] != 13 or exif.get('TransferCharacteristics') != 13
            or facts['matrix'] != 0 or exif.get('MatrixCoefficients') != 0
            or not re.search(r'Range\s*:\s*Full', facts['info'])
            or not re.search(r'ICC Profile\s*:\s*Absent', facts['info'])):
        raise ValueError('Emitted AVIF color/depth facts disagree with requested authored SDR encoding')
    if (avif.timing(facts) != [1] or facts['alpha'] != 'Absent'
            or 'Transformations: None' not in facts['info']
            or not re.search(r'Gain map\s*:\s*Absent', facts['info'])):
        raise ValueError('Authored SDR AVIF must be static, opaque, oriented and without a gain map')
    decoded = path.with_name(path.stem+'-independent-decode')
    decoded.mkdir(exist_ok=True)
    pixels = avif.decode_avif(path, decoded, 1)[0]
    if pixels.shape[:2] != (facts['height'], facts['width']) or not np.all(pixels[..., 3] == 1):
        raise ValueError('Independent AVIF raster contradicts dimensions or opaque signaling')
    inspected = gainmap.inspect(path, decoded/'metadata')
    linear = sdr_signal_to_nits(pixels[..., :3]) @ RGB_TO_XYZ[gamut].T @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T
    return linear, {**facts, 'gamut': gamut, 'transfer': 'srgb', 'components': 3,
        'decoder': 'Independent dav1d AV1 and native libpng; ExifTool CICP verification',
        'privacy': not inspected['private_tags'], 'metadata': inspected['metadata']}
