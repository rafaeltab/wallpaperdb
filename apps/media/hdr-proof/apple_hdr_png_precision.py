"""Separate old Apple PNG candidates preserve opaque float RGB planes.

The old PNG and its measurements remain nested baseline evidence. Actual
float alpha must equal one before native dd copies the three RGB planes
without arithmetic. Native zimg writes PQ float, quantizes to planar16, then
packs RGB16 for the PNG encoder. Reference arrays never feed this pipeline.
All photographic stages use the unchanged gainmap-hdr gates. Analytic PQ
code deviations are reported for attribution, not as a new appearance gate.
"""
import copy
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np

import apple_hdr_png
import apple_source_model
import avif
from appearance import compare_appearance

SELECTORS = dict(apple_hdr_png.SELECTORS)
SIZES = dict(apple_hdr_png.SIZES)
DEPENDENCIES = ('apple_hdr_png_precision.py', 'test_apple_hdr_png_precision.py', *apple_hdr_png.DEPENDENCIES)


def _measure(reference, actual):
    return compare_appearance(reference, actual, reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')


def encode(geometry, output, *, expected_source_sha256, operation='contain'):
    if operation not in SIZES:
        raise ValueError('Unproved native HDR PNG precision geometry')
    width, height = SIZES[operation]
    if (geometry.get('format') != 'gbrapf32le' or geometry.get('gamut') != 'p3'
            or geometry.get('normalization_nits') != 203
            or (geometry.get('width'), geometry.get('height')) != (width, height)):
        raise ValueError('Only the independently established P3 float geometry is admitted')
    source, output = Path(geometry['path']), Path(output)
    data = source.read_bytes()
    plane = width*height*4
    if hashlib.sha256(data).hexdigest() != expected_source_sha256 or len(data) != 4*plane:
        raise ValueError('Native source float hash or dimensions changed')
    if not np.all(np.frombuffer(data[3*plane:], '<u4') == 0x3f800000):
        raise ValueError('Actual native float alpha must be exactly one before removal')
    samples = np.frombuffer(data[:3*plane], '<f4')
    if not np.all(np.isfinite(samples)) or np.any(samples < 0) or np.any(samples > 10000/203):
        raise ValueError('Native RGB must contain finite nonnegative in-range linear samples')
    output.parent.mkdir(parents=True, exist_ok=True)
    rgb, pq, packed = (output.parent/name for name in ('opaque-rgb.gbrpf32', 'native-pq.gbrpf32', 'native-rgb16.raw'))
    executable = Path(shutil.which('dd'))
    dd_facts = {'path': str(executable), 'implementation_binary': str(executable.resolve()),
                'sha256': avif.digest(executable)}
    avif.native(['dd', f'if={source}', f'of={rgb}', f'bs={plane}', 'count=3', 'status=none'])
    if rgb.read_bytes() != data[:3*plane]:
        raise ValueError('Native opaque-plane copy changed RGB bytes')
    transfer = ('zscale=agamma=0:transferin=linear:transfer=16:primariesin=12:primaries=12:'
                'matrixin=0:matrix=0:rangein=full:range=full:npl=203,format=gbrpf32le')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', f'{width}x{height}',
        '-i', rgb, '-vf', transfer, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', pq])
    quantize = ('zscale=agamma=0:transferin=16:transfer=16:primariesin=12:primaries=12:'
        'matrixin=0:matrix=0:rangein=full:range=full:npl=10000:dither=none,format=gbrp16le,format=rgb48le')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', f'{width}x{height}',
        '-i', pq, '-vf', quantize, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', packed])
    if pq.stat().st_size != 3*plane or packed.stat().st_size != width*height*3*2:
        raise ValueError('Native PQ or RGB16 raster size changed')
    # Signaling describes the measured native PQ/P3 bytes; it does not assign
    # a different gamut or transfer to an unknown input.
    signaling = 'setparams=color_primaries=12:color_trc=16:colorspace=0:range=full,setsar=1'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', f'{width}x{height}',
        '-i', packed, '-vf', signaling, '-map_metadata', '-1', '-frames:v', '1', '-threads', '1', output])
    bound = {str(source): expected_source_sha256, str(executable): dd_facts['sha256'],
             **{str(path): avif.digest(path) for path in (rgb, pq, packed, output)}}
    if any(avif.digest(path) != sha for path, sha in bound.items()):
        raise ValueError('Native plane or PNG artifact integrity changed during encoding')
    return {'opaque_planes': {'actual_alpha_exactly_one': True, 'rgb_bytes_unchanged': True,
                'source': str(source), 'source_sha256': expected_source_sha256,
                'path': str(rgb), 'sha256': bound[str(rgb)], 'bytes_per_plane': plane, 'native_copy': dd_facts},
        'pq_float': {'path': str(pq), 'sha256': bound[str(pq)], 'format': 'gbrpf32le',
            'gamut': 'p3', 'transfer': 'pq', 'normalization': 'normalized ST2084 signal', 'filter': transfer},
        'rgb16': {'path': str(packed), 'sha256': bound[str(packed)], 'format': 'rgb48le', 'filter': quantize},
        'png_signaling_filter': signaling, 'bound_files': bound}


def _read_planar(path, *, dimensions=(173, 231)):
    if tuple(dimensions) not in SIZES.values():
        raise ValueError('Unproved native float raster dimensions')
    width, height = dimensions
    data = Path(path).read_bytes()
    if len(data) != width*height*3*4:
        raise ValueError('Unexpected native float raster size')
    result = np.frombuffer(data, '<f4').reshape(3, height, width)[[2, 0, 1]].transpose(1, 2, 0).astype(float)
    if not np.all(np.isfinite(result)):
        raise ValueError('Nonfinite native float samples')
    return result


def _code_error(reference_codes, actual):
    errors = np.rint(actual*65535).astype(int)-reference_codes
    return {'changed_codes': int(np.count_nonzero(errors)), 'maximum_code_error': int(np.abs(errors).max()),
            'mean_signed_code_error': float(errors.mean()), 'scope': 'Diagnostic only; unchanged photographic gates decide appearance'}


def _run_one(directory, *, source=apple_source_model.SOURCE, selectors=None, operation='contain'):
    if (operation not in SIZES or (selectors is not None and selectors != apple_hdr_png._selectors(operation))
            or avif.digest(source) != apple_source_model.SOURCE_SHA256):
        raise ValueError('Only the locked original and exact P3 PNG16 geometry selectors are admitted; original only otherwise')
    dimensions = SIZES[operation]
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    first = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).parent/name) for name in DEPENDENCIES}
    baseline = apple_hdr_png.run(directory/'baseline', source=source, geometries=(operation,))
    old = baseline['cases'][0]
    case = copy.deepcopy(old)
    case.update({'case_id': old['case_id']+':precision-opaque-planar16',
        'candidate': 'documented-full-native-pq16-opaque-planar16', 'proof_module': 'apple_hdr_png_precision',
        'status': 'tested and failed', 'blockers': [], 'measurements': {}, 'artifacts': {},
        'qualification_scope': 'One explicit P3 PNG16 containment with byte-exact native removal of verified opaque float alpha. '
            'Documented full effect only; other selectors and physical consumers require separate evidence.'})
    if operation != 'contain':
        case['qualification_scope'] = (f'One explicit P3 PNG16 {operation} with byte-exact native removal of verified opaque float alpha. '
            'Documented full effect only; other selectors and physical consumers require separate evidence.')
    case['checks'] = {key: False for key in (*old['checks'], 'baseline', 'opaque_rgb_planes', 'native_pq_stage', 'native_storage')}
    for key in ('facts', 'native_writer', 'bound_files'):
        case.pop(key, None)
    report = {'baseline': baseline, 'cases': [case]}
    try:
        if old['status'] != 'qualified' or not all(old['checks'].values()):
            raise ValueError('Unchanged original source/geometry/baseline preparation did not qualify')
        protected = dict(old['bound_files'])
        geometry = old['native_geometry']
        output = directory/'output.png'
        writer = encode(geometry, output, expected_source_sha256=protected[geometry['path']], operation=operation)
        case['checks']['native_encoder'] = True
        case['artifacts'] = {**old['artifacts'], 'output': str(output), 'sha256': avif.digest(output)}
        protected.update(writer['bound_files'])
        facts, pixels = apple_hdr_png.inspect_output(output, dimensions=dimensions)
        expected_storage = np.rint(pixels[..., :3]*65535).astype('<u2').tobytes()
        stored_equal = Path(writer['rgb16']['path']).read_bytes() == expected_storage
        native_pq = _read_planar(writer['pq_float']['path'], dimensions=dimensions)
        if np.any((native_pq < 0) | (native_pq > 1)):
            raise ValueError('Native PQ stage is not a finite normalized transfer signal')
        reference = np.load(old['reference_hdr']['path'])
        native_linear = _read_planar(writer['opaque_planes']['path'], dimensions=dimensions)*203
        expected_codes = np.floor(avif.encode_transfer(native_linear, 'pq', 'p3')*65535+.5).astype(int)
        _, old_pixels = apple_hdr_png.inspect_output(old['artifacts']['output'], dimensions=dimensions)
        measurements = {'native_source': old['measurements']['native_source'],
            'native_geometry': old['measurements']['native_geometry'],
            'native_rgb_planes': _measure(reference, native_linear),
            'native_pq_stage': _measure(reference, avif.decode_transfer(native_pq, 'pq', 'p3')),
            'hdr': _measure(reference, avif.decode_transfer(pixels[..., :3], 'pq', 'p3'))}
        case.update({'facts': facts, 'native_writer': writer, 'measurements': measurements,
            'storage_checks': {'native_rgb16_equals_independent_png': stored_equal},
            'precision_diagnostic': {'reference': 'Analytic ST2084 of the actual native float RGB input, rounded to nearest RGB16 code',
                'baseline': _code_error(expected_codes, old_pixels[..., :3]),
                'candidate': _code_error(expected_codes, pixels[..., :3])},
            'baseline_output': {'case_id': old['case_id'], 'sha256': old['artifacts']['sha256'], 'path': old['artifacts']['output']}})
        case['checks'].update({'baseline': True, 'independent_source_decoder': old['checks']['independent_source_decoder'],
            'native_source_precision': old['checks']['native_source_precision'], 'native_geometry': old['checks']['native_geometry'],
            'opaque_rgb_planes': True, 'native_pq_stage': measurements['native_pq_stage']['passed'],
            'native_storage': stored_equal, 'independent_decoder': True, 'structure': True, 'privacy': True,
            'appearance': all(value['passed'] for value in measurements.values())})
        if operation == 'orientation':
            case['checks']['source_transform'] = old['checks']['source_transform']
        if (any(avif.digest(path) != sha for path, sha in protected.items())
                or any(avif.digest(Path(__file__).parent/name) != sha for name, sha in hashes.items())):
            raise ValueError('Source, reference, native stage or output integrity changed during decoding')
        case['bound_files'] = protected
        case['checks']['integrity'] = True
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    report.update({'source_hashes': hashes, 'commands': avif.COMMANDS[first:]})
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


def run(directory, *, source=apple_source_model.SOURCE, selectors=None, geometries=('contain',)):
    geometries = tuple(geometries)
    if (not geometries or len(set(geometries)) != len(geometries) or any(operation not in SIZES for operation in geometries)
            or selectors is not None and (len(geometries) != 1 or selectors != apple_hdr_png._selectors(geometries[0]))):
        raise ValueError('Expected distinct proved precision PNG geometries and at most one exact selector request')
    directory = Path(directory)
    reports = [_run_one(directory if operation == 'contain' else directory/operation,
                        source=source, selectors=selectors, operation=operation) for operation in geometries]
    report = reports[0]
    if len(reports) > 1:
        baselines = [result['baseline'] for result in reports]
        report['additional_geometry_results'] = reports[1:]
        report['cases'] = [case for result in reports for case in result['cases']]
        report['commands'] = [command for result in reports for command in result['commands']]
        report['baseline'] = {'cases': [case for baseline in baselines for case in baseline['cases']],
                              'geometry_results': baselines}
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
