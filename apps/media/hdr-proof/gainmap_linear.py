"""Separate native float geometry candidate before a PQ16 intermediate.

The source still has libultrahdr's half-float reconstruction precision. This
candidate isolates the additional PQ encode/decode loss; it does not replace
or change the passing PQ-based route. Native stack filters preserve float
samples while padding, where FFmpeg's pad filter silently negotiates integers.
"""
import hashlib
import json
import math
from pathlib import Path
import struct

from gainmap import command
from gainmap_hdr import _decode_iso_source


def decode_iso_linear(source, directory, *, gamut):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    # The established decoder also emits a tagged inspection PNG. Consume its
    # native float output written before that PNG; no PQ samples return here.
    _decode_iso_source(source, directory, gamut)
    evidence = json.loads((directory/'iso-native-evidence.json').read_text())
    facts = evidence['decoded_color_facts']
    path = directory/'source-linear.gbrpf32'
    return {'path': str(path), 'format': 'gbrpf32le', 'width': facts['width'], 'height': facts['height'],
            'gamut': evidence['gamut'], 'normalization_nits': evidence['sdr_white_nits'], 'alpha': False,
            'native_source': evidence, 'source_sha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'precision': 'Native RGBA half-float samples expanded to float32 before any PQ16 roundtrip'}


def resample_linear(source, output, operation, orientation=1):
    """Resample established opaque planar float samples with native Lanczos3."""
    if (source.get('alpha') is not False or source.get('format') != 'gbrpf32le'
            or source.get('gamut') not in ('srgb', 'p3', 'rec2020')
            or source.get('normalization_nits') != 203):
        raise ValueError('Direct native geometry requires known opaque float source color facts at 203-nit normalization')
    source_path, output = Path(source['path']), Path(output)
    width, height = source['width'], source['height']
    if any(type(value) is not int or not 1 <= value <= 4096 for value in (width, height)):
        raise ValueError('Native float dimensions must be integers from 1 through 4096')
    data = source_path.read_bytes()
    if len(data) != width*height*3*4 or hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError('Native float source size or hash changed')
    if any(not math.isfinite(value[0]) for value in struct.iter_unpack('<f', data)):
        raise ValueError('Native float source contains nonfinite samples')
    if operation not in ('contain', 'cover', 'fill', 'upscale', 'crop', 'orientation') or orientation not in range(1, 9):
        raise ValueError('Unsupported native direct-float geometry')
    alpha_source = output.with_suffix('.input.gbrapf32')
    # This changes storage only. Existing RGB bytes are not converted, and the
    # established opaque source gets an exact one-valued alpha plane.
    alpha_source.write_bytes(data + struct.pack('<f', 1.0)*(width*height))
    before, raster_width, raster_height = [], width, height
    if operation == 'orientation':
        effects = {1: [], 2: ['hflip'], 3: ['hflip', 'vflip'], 4: ['vflip'],
                   5: ['transpose=clock', 'hflip'], 6: ['transpose=clock'],
                   7: ['transpose=clock', 'vflip'], 8: ['transpose=cclock']}
        before = effects[orientation]
        if orientation >= 5:
            raster_width, raster_height = height, width
    if operation == 'crop':
        if width < 284 or height < 256:
            raise ValueError('The declared proof crop must fit the native raster')
        before, raster_width, raster_height = ['crop=271:239:13:17'], 271, 239
    target_width = 769 if operation == 'upscale' else 173
    target_height = math.floor(raster_height*target_width/raster_width+.5)
    region = [raster_width, raster_height, raster_width, raster_height]
    if operation == 'cover':
        side = min(raster_width, raster_height)
        region = [raster_width+(raster_width-side)/2, raster_height+(raster_height-side)/2, side, side]
        target_height = 173
    elif operation == 'fill':
        target_height = 211
    elif operation == 'crop':
        target_height = 153
    padding = ('[0:v]' + (','.join(before)+',' if before else '')
        + 'setparams=alpha_mode=premultiplied,format=gbrapf32le:alpha_modes=premultiplied,'
        'split[image][zero];[zero]geq=r=0:g=0:b=0:a=0,split=8[b1][b2][b3][b4][b5][b6][b7][b8];'
        '[b1][b2][b3]hstack=inputs=3[top];[b4][image][b5]hstack=inputs=3[middle];'
        '[b6][b7][b8]hstack=inputs=3[bottom];[top][middle][bottom]vstack=inputs=3,'
        'format=gbrapf32le:alpha_modes=premultiplied[out]')
    padded = output.with_suffix('.padded.gbrapf32')
    command(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
             '-s', f'{width}x{height}', '-i', alpha_source, '-filter_complex_threads', '1',
             '-filter_complex', padding, '-map', '[out]', '-frames:v', '1',
             '-pix_fmt', 'gbrapf32le', '-f', 'rawvideo', padded], output.with_suffix('.padding.log'))
    padded_bytes = padded.read_bytes()
    plane_size = 3*raster_width*3*raster_height*4
    if len(padded_bytes) != 4*plane_size:
        raise ValueError('Native float padding changed the declared dimensions')
    pixels, coverage = output.with_suffix('.pixels.raw'), output.with_suffix('.coverage.raw')
    pixels.write_bytes(padded_bytes[:3*plane_size])
    coverage.write_bytes(padded_bytes[3*plane_size:]*3)
    numerator, weight = output.with_suffix('.numerator.raw'), output.with_suffix('.weight.raw')
    for input_path, output_path in ((pixels, numerator), (coverage, weight)):
        command(['hdr-proof-zimg-window', input_path, output_path, 3*raster_width, 3*raster_height,
                 target_width, target_height, *region], output_path.with_suffix('.log'))
    inputs = []
    for path in (numerator, weight):
        inputs += ['-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', f'{target_width}x{target_height}', '-i', path]
    normalize = "[0:v][1:v]blend=all_expr='if(gt(B,0),max(A/B,0),0)'[out]"
    linear = output.with_suffix('.gbrpf32')
    command(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex_threads', '1',
             '-filter_complex', normalize, '-map', '[out]', '-frames:v', '1',
             '-pix_fmt', 'gbrpf32le', '-f', 'rawvideo', linear], output.with_suffix('.normalize.log'))
    rgb = linear.read_bytes()
    if len(rgb) != 3*target_width*target_height*4:
        raise ValueError('Native direct-float output dimensions disagree')
    output.write_bytes(rgb + struct.pack('<f', 1.0)*(target_width*target_height))
    return {'path': str(output), 'format': 'gbrapf32le', 'gamut': source['gamut'],
            'normalization_nits': 203, 'width': target_width, 'height': target_height,
            'source_size': [width, height], 'source_float_sha256': source['sha256'],
            'padding_filter': padding, 'normalization_filter': normalize, 'native_active_region': region,
            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'candidate': 'native-linear-geometry-before-pq16', 'alpha': 'Established opaque source; exact output alpha 1'}
