"""Native eight-bit HDR PNG source fixtures, separate from PNG16 conversion proof.

Declared before measuring these fixtures: reuse thresholds.json's avif-8
profile for the same authored PQ/HLG ramps and primary patches at eight coded
bits. Their uniform transfer-signal quantization is the same; PNG stores the
resulting codes losslessly. Passing that existing ceiling alone is insufficient:
native libpng must also recover every authored integer code exactly, and RGB
and alpha quantization must remain within half an eight-bit code.

These checks qualify source fixtures only. They do not qualify any conversion,
change source-admission policy, or establish physical display compatibility.
Existing PNG16 generators and their stricter avif-12 gates remain untouched.
"""
import json
from pathlib import Path
import struct

import numpy as np

import avif
from appearance import compare_appearance
from hdr_png import _png_chunks


SOURCE_POLICY = {
    'profile': 'avif-8',
    'declared_before_native_measurements': True,
    'rationale': ('The existing eight-bit PQ/HLG ramp and primary-patch ceiling applies to '
                  'the same eight-bit transfer-signal quantization. Native PNG storage is '
                  'lossless and must additionally recover every declared integer code exactly.'),
    'coded_sample_error_limit': .5 / 255,
    'floating_comparison_tolerance': 1e-12,
    'alpha_error_limit': .5 / 255,
    'scope': 'Source quantization only; no derivative or physical-display qualification',
}


def fixture_specs():
    for transfer in ('pq', 'hlg'):
        for gamut in ('p3', 'rec2020'):
            for alpha in (False, True):
                yield {'id': f'png-{transfer}-{gamut}-8-{"alpha" if alpha else "opaque"}',
                       'transfer': transfer, 'gamut': gamut, 'depth': 8,
                       'alpha': alpha, 'frames': 1}


def _authored_samples(spec):
    if (spec['transfer'] not in ('pq', 'hlg') or spec['gamut'] not in ('p3', 'rec2020')
            or spec['depth'] != 8 or spec['frames'] != 1 or not isinstance(spec['alpha'], bool)):
        raise ValueError('Expected a static eight-bit PQ/HLG P3/Rec.2020 fixture specification')
    scene = avif.make_scene(spec['alpha'])
    signal = scene.copy()
    signal[..., :3] = avif.encode_transfer(scene[..., :3], spec['transfer'], spec['gamut'])
    # This is deterministic stimulus generation, not a conversion candidate.
    # The native PNG writer receives these exact RGB8/RGBA8 sample bytes.
    codes = np.rint(np.clip(signal, 0, 1) * 255).astype(np.uint8)
    return scene, signal, codes


def inspect_and_decode(path):
    rejection = 'Source is outside the recognized eight-bit HDR PNG proof subset; keep it original-only'
    try:
        chunks = _png_chunks(Path(path).read_bytes())
        headers = [payload for kind, payload in chunks if kind == b'IHDR']
        colors = [payload for kind, payload in chunks if kind == b'cICP']
        if (len(headers) != 1 or len(headers[0]) != 13 or len(colors) != 1 or len(colors[0]) != 4
                or any(kind in (b'iCCP', b'sRGB', b'tRNS', b'acTL', b'fcTL', b'fdAT') for kind, _ in chunks)):
            raise ValueError('Required unique static image and color headers are missing or conflicting')
        width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', headers[0])
        primaries, transfer, matrix, full_range = colors[0]
        if (not 0 < width <= 8192 or not 0 < height <= 8192 or depth != 8 or color_type not in (2, 6)
                or (compression, filtering, interlace) != (0, 0, 0)
                or primaries not in (9, 12) or transfer not in (16, 18) or matrix != 0 or full_range != 1):
            raise ValueError('Unrecognized dimensions, precision, color type or HDR signaling')
        exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
        expected = {'FileType': 'PNG', 'ImageWidth': width, 'ImageHeight': height, 'BitDepth': depth,
                    'ColorType': color_type, 'ColorPrimaries': primaries, 'TransferCharacteristics': transfer,
                    'MatrixCoefficients': matrix, 'VideoFullRangeFlag': full_range}
        if any(exif.get(key) != value for key, value in expected.items()) or exif.get('Orientation', 1) != 1:
            raise ValueError('Independent ExifTool signaling disagrees or source orientation is not proved')
    except (ValueError, struct.error) as error:
        raise ValueError(f'{rejection}: {error}') from error
    raw = avif.native(['hdr-proof-png-decode', path])
    if len(raw) != 12 + width * height * 8 or struct.unpack('<III', raw[:12]) != (width, height, depth):
        raise ValueError('Native libpng dimensions or source depth disagree with inspected PNG headers')
    samples = np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4)
    if np.any(samples % 257) or (color_type == 2 and np.any(samples[..., 3] != 65535)):
        raise ValueError('Independent libpng did not return exact expanded eight-bit source codes')
    facts = {'format': 'png', 'range': 'hdr', 'width': width, 'height': height, 'depth': depth,
             'color_type': color_type, 'alpha_channel': color_type == 6, 'orientation': 1,
             'primaries': primaries, 'transfer': transfer, 'matrix': matrix, 'full_range': bool(full_range),
             'gamut': {9: 'rec2020', 12: 'p3'}[primaries],
             'transfer_name': {16: 'pq', 18: 'hlg'}[transfer],
             'libpng_source_depth': depth, 'decoder': 'independent native libpng; unchanged coded RGB and alpha',
             'exiftool': {key: value for key, value in exif.items() if key not in (
                 'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')}}
    return facts, samples.astype(float) / 65535


def qualify_fixture(path, spec):
    scene, signal, codes = _authored_samples(spec)
    facts, pixels = inspect_and_decode(path)
    if pixels.shape != codes.shape:
        raise ValueError('Decoded source dimensions differ from the declared analytic fixture')
    reconstructed = avif.decode_transfer(pixels[..., :3], facts['transfer_name'], facts['gamut'])
    measured = compare_appearance(scene[..., :3], reconstructed,
        reference_gamut=spec['gamut'], actual_gamut=facts['gamut'], fixture_class=SOURCE_POLICY['profile'],
        alpha=scene[..., 3])
    mismatches = int(np.count_nonzero(np.rint(pixels * 255).astype(np.uint8) != codes))
    signal_error = float(np.max(np.abs(pixels[..., :3] - signal[..., :3])))
    alpha_error = float(np.max(np.abs(pixels[..., 3] - signal[..., 3])))
    epsilon = SOURCE_POLICY['floating_comparison_tolerance']
    checks = {
        'dimensions': (facts['width'], facts['height']) == (96, 64),
        'coded_precision': facts['depth'] == facts['libpng_source_depth'] == 8,
        'color_signaling': facts['gamut'] == spec['gamut'] and facts['transfer_name'] == spec['transfer'],
        'native_samples_exact': mismatches == 0,
        'rgb_quantization': signal_error <= SOURCE_POLICY['coded_sample_error_limit'] + epsilon,
        'alpha_quantization': alpha_error <= SOURCE_POLICY['alpha_error_limit'] + epsilon,
        'alpha_structure': (facts['alpha_channel'] == spec['alpha']
            and bool(np.any((pixels[..., 3] > 0) & (pixels[..., 3] < 1))) == spec['alpha']),
        'source_appearance': measured['passed'],
    }
    return {'id': spec['id'], 'path': str(path), 'sha256': avif.digest(path), 'spec': spec,
            'generator': 'hdr_png8.py:generate_fixture', 'facts': facts,
            'source_valid': all(checks.values()), 'source_checks': checks, 'source_appearance': measured,
            'quantization': {'rule': 'Nearest integer RGB8/RGBA8 stimulus codes; ties to even',
                'mismatched_coded_samples': mismatches, 'maximum_signal_error': signal_error,
                'maximum_alpha_error': alpha_error},
            'threshold_scope': {**SOURCE_POLICY,
                'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
            'conversion_qualification': False, 'consumer_status': 'pending manual review'}


def generate_fixture(spec, directory):
    _, _, codes = _authored_samples(spec)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    source = directory/f'{spec["id"]}.png'
    channels = 4 if spec['alpha'] else 3
    format_name = 'rgba' if spec['alpha'] else 'rgb24'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', format_name,
        '-s', '96x64', '-i', 'pipe:0',
        '-vf', f'setparams=color_primaries={avif.PRIMARIES[spec["gamut"]]}:'
               f'color_trc={avif.TRANSFERS[spec["transfer"]]}:colorspace=gbr:range=full',
        '-frames:v', '1', '-pix_fmt', format_name,
        '-color_primaries', str(avif.PRIMARIES[spec['gamut']]),
        '-color_trc', str(avif.TRANSFERS[spec['transfer']]), '-colorspace', 'rgb', '-color_range', 'pc',
        '-map_metadata', '-1', '-threads', '1', source], data=codes[..., :channels].tobytes())
    avif.native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE',
        '-XMP-dc:Creator=HDR-PROOF-PRIVATE', '-GPSLatitude=51.5', '-GPSLatitudeRef=N',
        '-GPSLongitude=4.5', '-GPSLongitudeRef=E', '-Model=Test Camera', '-SerialNumber=987654', source])
    return source, qualify_fixture(source, spec)


def generate_sources(output_directory):
    start = len(avif.COMMANDS)
    fixtures = [generate_fixture(spec, Path(output_directory)/spec['id'])[1] for spec in fixture_specs()]
    return {'fixtures': fixtures, 'commands': avif.COMMANDS[start:],
            'scope': 'Native source fixtures only; derivative conversions have not been tested here'}
