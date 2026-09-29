"""Native preparation for the documented old Apple full HDR effect only.

The independent renderer and its revision live in apple_source_model. This
candidate decodes original JPEG samples with Sharp/libjpeg, resizes the coded
map through native separable bilinear filters, then applies inverse Rec.709
and linear gain in FFmpeg float32. No oracle pixels feed those filters.

The analytic tolerance is declared before measurement: 1e-6 relative plus
1e-7 absolute in normalized linear RGB, allowing accumulated float32 rounding
through normalization, transfer functions and multiplication. This numeric
control does not replace the unchanged gainmap-hdr photographic gates.
No intermediate display adaptation or derivative is qualified here.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import apple_source_model
import avif
from appearance import compare_appearance, sdr_signal_to_nits, THRESHOLDS_SHA256
from gainmap_sdr import _SOURCE_RGB

REFERENCE_REVISION = apple_source_model.REFERENCE_REVISION
DEPENDENCIES = ('apple_native_source.py', 'test_apple_native_source.py', *apple_source_model.DEPENDENCIES,
                'gainmap_sdr.py')
ANALYTIC_RELATIVE_TOLERANCE = 1e-6
ANALYTIC_ABSOLUTE_TOLERANCE = 1e-7


def _decode_rgb(source, output, size):
    """The candidate's original JPEG decoder, independent of the oracle reader."""
    facts = json.loads(avif.native(['node', '-e', _SOURCE_RGB], data=json.dumps({
        'input': str(source), 'output': str(output)}).encode()))
    if ((facts['width'], facts['height']) != tuple(size) or facts['channels'] != 3
            or Path(output).stat().st_size != size[0]*size[1]*3):
        raise ValueError('Native JPEG samples disagree with admitted dimensions and opacity')
    return facts


def _map_axis(source_args, output, size):
    # This source has exact twofold axes. Bilinear weights are quarters, with
    # half-up RGB8 rounding after each axis. The 0.0001-code correction only
    # resolves native float error at half ties; it cannot cross another quarter.
    rounding = ':'.join(f"{c}='floor({c}(X,Y)*255+0.5001)/255'" for c in 'rgb')
    filters = ('format=gbrp,zscale=rangein=full:range=full,format=gbrpf32le,'
               f'zscale=w={size[0]}:h={size[1]}:filter=bilinear:rangein=full:range=full,'
               f'format=gbrpf32le,geq={rounding},'
               'zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24')
    avif.native(['ffmpeg', '-v', 'error', '-y', *source_args, '-vf', filters,
                 '-map_metadata', '-1', '-frames:v', '1', '-threads', '1', output])
    return filters


def _apply_native(base, gain, output, dimensions, headroom):
    width, height = dimensions
    if (any(type(value) is not int or not 1 <= value <= 4096 for value in dimensions)
            or headroom not in (1, 8)
            or any(Path(path).stat().st_size != width*height*3 for path in (base, gain))):
        raise ValueError('Known opaque RGB8 geometry and declared full-effect headroom are required')
    normalized = 'format=gbrp,zscale=rangein=full:range=full,format=gbrpf32le'
    base_inverse = 'geq='+':'.join(f"{c}='if(lte({c}(X,Y),0.04045),{c}(X,Y)/12.92,pow(({c}(X,Y)+0.055)/1.055,2.4))'" for c in 'rgb')
    map_inverse = 'geq='+':'.join(f"{c}='if(lt({c}(X,Y),0.081),{c}(X,Y)/4.5,pow(({c}(X,Y)+0.099)/1.099,1/0.45))'" for c in 'rgb')
    expression = (f'[0:v]{normalized},{base_inverse}[base];[1:v]{normalized},{map_inverse}[map];'
                  f"[base][map]blend=all_expr='A*(1+{headroom-1}*B)'[out]")
    inputs = []
    for path in (base, gain):
        inputs += ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-i', path]
    avif.native(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', expression,
                 '-filter_complex_threads', '1', '-map', '[out]', '-frames:v', '1',
                 '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', output])
    if Path(output).stat().st_size != width*height*3*4:
        raise ValueError('Native full-effect output does not have the required float32 raster')
    return expression


def read_linear(facts):
    """Read candidate pixels only for measurements, never for encoder inputs."""
    if (facts.get('format') != 'gbrpf32le' or facts.get('gamut') != 'p3'
            or facts.get('normalization_nits') != 203 or facts.get('alpha') is not False
            or avif.digest(facts['path']) != facts['sha256']):
        raise ValueError('Known native source color, normalization, alpha and hash are required')
    data = Path(facts['path']).read_bytes()
    if len(data) != facts['width']*facts['height']*3*4:
        raise ValueError('Native float source dimensions disagree')
    pixels = np.frombuffer(data, '<f4').reshape(3, facts['height'], facts['width'])[[2, 0, 1]].transpose(1, 2, 0)
    if not np.all(np.isfinite(pixels)) or np.any(pixels < 0):
        raise ValueError('Native source contains invalid linear samples')
    return pixels.astype(float)*203


def prepare(source, directory, *, gamut='p3', model_revision=REFERENCE_REVISION):
    """Admit one actual old Apple source and apply its documented full effect."""
    source, directory = Path(source), Path(directory)
    if (gamut != 'p3' or model_revision != REFERENCE_REVISION
            or avif.digest(source) != apple_source_model.SOURCE_SHA256):
        raise ValueError('Unknown Apple source, color or model; retain the exact original only')
    directory.mkdir(parents=True, exist_ok=True)
    first = len(avif.COMMANDS)
    facts, independent_base, independent_map = apple_source_model.read_source(source, directory/'inspection')
    if facts['model']['headroom_linear'] != 8:
        raise ValueError('This native source candidate requires verified full headroom 8')
    gain = Path(facts['map_path'])
    bound = {str(source): facts['sha256'], str(gain): facts['map_sha256']}
    base_raw, map_raw = directory/'base-original.rgb', directory/'map-original.rgb'
    base_decode = _decode_rgb(source, base_raw, (384, 512))
    map_decode = _decode_rgb(gain, map_raw, (192, 256))
    native_base = np.fromfile(base_raw, np.uint8).reshape(512, 384, 3)
    native_map = np.fromfile(map_raw, np.uint8).reshape(256, 192, 3)
    original = {'base_changed_codes': int(np.count_nonzero(native_base != independent_base)),
                'map_changed_codes': int(np.count_nonzero(native_map != independent_map[..., None])),
                'base_samples_sha256': avif.digest(base_raw), 'map_samples_sha256': avif.digest(map_raw),
                'base_decode': base_decode, 'map_decode': map_decode}
    if original['base_changed_codes'] or original['map_changed_codes']:
        raise ValueError('Native JPEG decoder changed independently established original source samples')
    for path in (base_raw, map_raw):
        bound[str(path)] = avif.digest(path)
    horizontal, mapped, mapped_raw = directory/'map-horizontal.png', directory/'map-full.png', directory/'map-full.rgb'
    filters = [_map_axis(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '192x256', '-i', map_raw], horizontal, (384, 256)),
               _map_axis(['-i', horizontal], mapped, (384, 512))]
    _decode_rgb(mapped, mapped_raw, (384, 512))
    actual_map = np.fromfile(mapped_raw, np.uint8).reshape(512, 384, 3)
    expected_map = np.asarray(Image.fromarray(independent_map).resize((384, 512), Image.Resampling.BILINEAR))
    sampling = {'changed_codes': int(np.count_nonzero(actual_map != expected_map[..., None])),
        'dimensions': [384, 512], 'depth': 8, 'filters': filters,
        'convention': 'Native separable bilinear at RGB8 axis precision; exact quarter weights with half-up ties',
        'native_samples_sha256': avif.digest(mapped_raw),
        'independent_gray_samples_sha256': hashlib.sha256(expected_map.tobytes()).hexdigest()}
    if sampling['changed_codes']:
        raise ValueError('Native map sampling differs from the declared independent convention')
    output = directory/'source-linear.gbrpf32'
    expression = _apply_native(base_raw, mapped_raw, output, (384, 512), facts['model']['headroom_linear'])
    for path in (horizontal, mapped, mapped_raw, output):
        bound[str(path)] = avif.digest(path)
    logs = {str(path): {'sha256': avif.digest(path), 'content': path.read_text()}
            for path in sorted((directory/'inspection').glob('*.log'))}
    bound.update({path: details['sha256'] for path, details in logs.items()})
    if any(avif.digest(path) != digest for path, digest in bound.items()):
        raise ValueError('Native source or extracted-map integrity changed during preparation')
    result = {'path': str(output), 'sha256': avif.digest(output), 'format': 'gbrpf32le', 'gamut': gamut,
        'width': 384, 'height': 512, 'normalization_nits': 203, 'transfer': 'linear', 'alpha': False,
        'source_sha256': facts['sha256'], 'source_facts': facts, 'reference_revision': REFERENCE_REVISION,
        'precision': 'Native normalized RGB8 to float32, inverse sRGB and Rec.709, full linear gain',
        'full_headroom': 8, 'original_samples': original, 'map_sampling': sampling, 'gain_filter': expression,
        'bound_files': bound, 'commands': avif.COMMANDS[first:], 'source_inspection_logs': logs}
    read_linear(result)
    (directory/'source-evidence.json').write_text(json.dumps(result, indent=2)+'\n')
    return result


def analytic_control(directory):
    """Deterministic coded ramps exercise all 256x256 base/map combinations."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    x = np.broadcast_to(np.arange(256, dtype=np.uint8)[None, :], (256, 256))
    base = np.stack((x, (x.astype(int)*73%256).astype(np.uint8), 255-x), axis=-1)
    gain = np.repeat(x.T[..., None], 3, axis=-1)
    base_path, map_path = directory/'coded-base.rgb', directory/'coded-map.rgb'
    base_path.write_bytes(base.tobytes())
    map_path.write_bytes(gain.tobytes())
    bound = {str(path): avif.digest(path) for path in (base_path, map_path)}
    comparisons, maximum = [], 0.
    for headroom in (1, 8):
        path = directory/f'full-{headroom}.gbrpf32'
        expression = _apply_native(base_path, map_path, path, (256, 256), headroom)
        facts = {'path': str(path), 'sha256': avif.digest(path), 'format': 'gbrpf32le', 'gamut': 'p3',
                 'normalization_nits': 203, 'alpha': False, 'width': 256, 'height': 256}
        bound[str(path)] = facts['sha256']
        actual = read_linear(facts)/203
        expected = apple_source_model.documented_full(sdr_signal_to_nits(base/255, nominal_white_nits=1), gain[..., 0]/255, headroom)
        error = float(np.max(np.abs(actual-expected)))*203
        maximum = max(maximum, error)
        comparisons.append({'headroom': headroom, 'maximum_absolute_error_nits': error,
            'passed': bool(np.allclose(actual, expected, rtol=ANALYTIC_RELATIVE_TOLERANCE, atol=ANALYTIC_ABSOLUTE_TOLERANCE)),
            'black_preserved': bool(np.all(actual[base == 0] == 0)),
            'white_full_gain': bool(actual[255, 255, 0] == headroom),
            'artifact': facts, 'filter': expression})
    result = {'base_map_pairs': 65536, 'tested_headrooms': [1, 8],
        'relative_tolerance': ANALYTIC_RELATIVE_TOLERANCE, 'absolute_tolerance_normalized': ANALYTIC_ABSOLUTE_TOLERANCE,
        'maximum_absolute_error_nits': maximum, 'comparisons': comparisons,
        'black_preserved': all(row['black_preserved'] for row in comparisons),
        'unclipped_above_sdr_white': bool(comparisons[1]['white_full_gain']),
        'fixture_generator': 'RGB base codes x,73*x mod256,255-x; monochrome map y over a 256x256 raster',
        'base_sha256': avif.digest(base_path), 'map_sha256': avif.digest(map_path), 'bound_files': bound}
    result['passed'] = all(row['passed'] and row['black_preserved'] and row['white_full_gain'] for row in comparisons)
    if any(avif.digest(path) != sha for path, sha in bound.items()):
        raise ValueError('Analytic native artifact integrity changed during measurement')
    if not result['passed']:
        raise ValueError('Native full-effect analytic control failed')
    return result


def run(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    first = len(avif.COMMANDS)
    source_hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in DEPENDENCIES}
    legacy = apple_source_model.run(directory/'legacy-diagnostic')
    analytic = analytic_control(directory/'analytic')
    native = prepare(apple_source_model.SOURCE, directory/'native')
    reference = legacy['documented_full_model']['reference']
    measurement = compare_appearance(np.load(reference['path']), read_linear(native),
        reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')
    bound = {**legacy['bound_inputs'], **native['bound_files'], **analytic['bound_files']}
    if (any(avif.digest(path) != sha for path, sha in bound.items())
            or any(avif.digest(Path(__file__).with_name(name)) != sha for name, sha in source_hashes.items())):
        raise ValueError('Source, reference or implementation integrity changed during measurement')
    result = {'status': 'qualified source preparation' if measurement['passed'] else 'tested and failed',
        'reference_revision': REFERENCE_REVISION, 'reference': reference, 'thresholds_sha256': THRESHOLDS_SHA256,
        'scope': {'source': 'Locked old Apple JPEG with actual P3/sRGB ICC and MakerNote full headroom 8',
            'effect': 'Apple documented full HDR formula under the named bilinear8 sampling convention',
            'intermediate_adaptation_qualified': False, 'new_apple_model_qualified': False,
            'conversion_qualified': False, 'geometry_qualified': False},
        'checks': {'source_provenance': True, 'source_color_and_model': True, 'original_samples': True,
            'map_sampling': True, 'analytic_control': analytic['passed'], 'source_appearance': measurement['passed'],
            'integrity': True},
        'native_source': native, 'measurement': measurement, 'analytic_control': analytic,
        'legacy_diagnostic': legacy, 'bound_files': bound, 'source_hashes': source_hashes,
        'commands': avif.COMMANDS[first:], 'consumer_status': 'pending manual review'}
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
