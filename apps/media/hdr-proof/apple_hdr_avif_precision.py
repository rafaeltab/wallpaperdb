"""Explicit AVIF8/10/12 containment and AVIF12 geometry from precise PQ16 PNG.

Declared before measurement: the same documented Apple full-effect reference
and gainmap-hdr gates apply to native source, geometry, PQ intent and decoded
AVIF. Native AOM receives only the inspected native PNG, never reference
pixels. The existing AVIF result and PNG preparation remain separate evidence.
This opaque P3 endpoint does not establish gain-map display adaptation.
Signed regional changes retain coarse-depth regressions as diagnostics;
precise input does not imply every final encoded metric improves.
"""
import copy
import json
from pathlib import Path

import numpy as np

import apple_hdr_avif
import apple_hdr_png_precision
import apple_source_model
import avif
import gainmap
from appearance import compare_appearance
from gainmap_avif_hdr import _pixel_aspect

SELECTORS = dict(apple_hdr_avif.SELECTORS)
DEPTHS = (8, 10, 12)
SIZES = dict(apple_hdr_png_precision.SIZES)
DEPENDENCIES = ('apple_hdr_avif_precision.py', 'test_apple_hdr_avif_precision.py',
                *apple_hdr_avif.DEPENDENCIES, *apple_hdr_png_precision.DEPENDENCIES)


def inspect_output(path, directory, reference, *, depth=12, operation='contain'):
    if (type(depth) is not int or depth not in DEPTHS or operation not in SIZES
            or depth != 12 and operation != 'contain'):
        raise ValueError('Unproved AVIF precision depth/geometry')
    width, height = SIZES[operation]
    facts = avif.inspect_avif(path)
    frames = avif.decode_avif(path, directory, 1)
    rgba = np.concatenate((reference, np.ones((*reference.shape[:2], 1))), axis=-1)
    structural = avif.structure_checks(facts, frames, {}, [rgba], 'pq', 'p3', depth, 1)
    structural['opaque'] = bool(facts['alpha'] == 'Absent' and np.all(frames[0][..., 3] == 1))
    packet = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-count_frames',
        '-show_entries', 'stream=codec_name,width,height,pix_fmt,color_space,color_transfer,color_primaries,color_range,nb_read_frames,sample_aspect_ratio,display_aspect_ratio',
        '-of', 'json', path]))
    streams = packet.get('streams', [])
    structural['independent_packet_facts'] = len(streams) == 1 and all(streams[0].get(key) == value
        for key, value in {'codec_name': 'av1', 'width': width, 'height': height,
            'pix_fmt': 'gbrp' if depth == 8 else f'gbrp{depth}le',
            'color_space': 'gbr', 'color_transfer': 'smpte2084', 'color_primaries': 'smpte432',
            'color_range': 'pc', 'nb_read_frames': '1', 'sample_aspect_ratio': '1:1',
            'display_aspect_ratio': f'{width}:{height}' if width != height else '1:1'}.items())
    structural['pixel_aspect'] = _pixel_aspect(path)['passed']
    tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', path]))[0]
    private = gainmap.private_metadata_tags(tags)
    privacy = not private and 'XMP Metadata   : Absent' in facts['info'] and 'Exif Metadata  : Absent' in facts['info']
    return facts, frames[0], structural, packet, {'passed': privacy, 'private_tags': private}


def _regional_changes(baseline, candidate):
    if any(baseline[key] != candidate[key] for key in ('metric', 'fixture_class', 'thresholds_sha256', 'region_basis')):
        raise ValueError('Regional comparison requires the same metric, fixture and thresholds')
    result = {'qualification_role': 'Diagnostic only; unchanged appearance gates decide qualification',
              'sign': 'Candidate error minus baseline error; positive values are regressions',
              'regions': {}, 'error_increases': []}
    for region, measured in candidate['regions'].items():
        old = baseline['regions'][region]
        if measured['samples'] != old['samples']:
            raise ValueError('Regional comparison requires the same independent reference samples')
        differences = {'samples': measured['samples']}
        if measured['samples']:
            for metric in ('delta_e_itp', 'luminance_absolute_error_nits', 'luminance_relative_error_above_absolute_floor'):
                differences[metric] = {statistic: measured[metric][statistic]-old[metric][statistic]
                                      for statistic in ('mean', 'p95', 'maximum')}
                result['error_increases'].extend(f'{region}.{metric}.{statistic}'
                    for statistic, difference in differences[metric].items() if difference > 0)
        result['regions'][region] = differences
    return result


def _run_one(directory, *, source=apple_source_model.SOURCE, selectors=None, depth=12, operation='contain'):
    if (type(depth) is not int or depth not in DEPTHS or operation not in SIZES
            or depth != 12 and operation != 'contain'
            or (selectors is not None and selectors != apple_hdr_avif._selectors(operation, depth))
            or avif.digest(source) != apple_source_model.SOURCE_SHA256):
        raise ValueError('Only the locked source and exact proved P3 depth/geometry selectors are admitted; original only otherwise')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    first = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).parent/name) for name in DEPENDENCIES}
    baseline = apple_hdr_avif.run(directory/'baseline', source=source, depths=(depth,), geometries=(operation,))
    old = baseline['cases'][0]
    case = copy.deepcopy(old)
    case.update({'case_id': old['case_id']+':precision-opaque-planar16',
        'candidate': f'documented-full-native-pq{depth}-opaque-planar16', 'proof_module': 'apple_hdr_avif_precision',
        'status': 'tested and failed', 'blockers': [], 'measurements': {}, 'artifacts': {},
        'qualification_scope': f'One explicit P3 AVIF{depth} containment from inspected precise native PQ16 intent. '
            'Documented full effect only; other selectors and physical consumers require separate evidence.'})
    if operation != 'contain':
        case['qualification_scope'] = (f'One explicit P3 AVIF12 {operation} from inspected precise native PQ16 intent. '
            'Documented full effect only; other selectors and physical consumers require separate evidence.')
    case['checks'] = {key: False for key in (*old['checks'], 'baseline', 'native_preparation', 'reference_agreement')}
    if operation == 'orientation':
        case['checks']['source_transform'] = False
    for key in ('facts', 'hdr_intent', 'bound_files', 'structural_checks', 'output_packet_facts', 'privacy_measurement'):
        case.pop(key, None)
    report = {'baseline': baseline, 'cases': [case]}
    try:
        if old['status'] != 'qualified' or not all(old['checks'].values()):
            raise ValueError('Unchanged original AVIF baseline did not qualify')
        prepared = apple_hdr_png_precision.run(directory/'native-preparation', source=source, geometries=(operation,))
        report['native_preparation'] = prepared
        intent = prepared['cases'][0]
        if intent['status'] != 'qualified' or not all(intent['checks'].values()):
            raise ValueError('Precise native PNG preparation did not qualify')
        if operation == 'orientation':
            orientation = intent['orientation_source']
            if (intent['checks'].get('source_transform') is not True
                    or orientation['sha256'] != old['orientation_source']['sha256']
                    or orientation['orientation'] != 6 or orientation['path'] != intent['artifacts']['source']
                    or orientation['sha256'] != intent['artifacts']['source_sha256']
                    or intent['source_decoder_evidence']['native_source']['orientation_applied'] is not False
                    or intent['native_geometry']['padding_filter'].count('transpose=clock') != 1):
                raise ValueError('Actual oriented native source and one geometry rotation were not verified')
            case['orientation_source'] = orientation
            case['checks']['source_transform'] = True
        agreement = all(intent['reference_hdr'][key] == old['reference_hdr'][key]
            for key in ('sha256', 'dimensions', 'gamut', 'transfer', 'units', 'source_reference_revision'))
        agreement = agreement and intent['reference_sdr']['sha256'] == old['reference_sdr']['sha256']
        if not agreement:
            raise ValueError('Independent source reference changed between native candidates')
        protected = {**old['bound_files'], **intent['bound_files']}
        png = Path(intent['artifacts']['output'])
        if avif.digest(png) != intent['artifacts']['sha256']:
            raise ValueError('Inspected native PNG intent integrity changed before encoding')
        if any(avif.digest(path) != sha for path, sha in protected.items()):
            raise ValueError('Source, reference or native preparation integrity changed before encoding')
        reference = np.load(intent['reference_hdr']['path'])
        output = directory/'output.avif'
        avif.encode_avif([png], output, 'pq', 'p3', depth)
        case['checks']['native_encoder'] = True
        protected[str(output)] = avif.digest(output)
        case['artifacts'] = {**intent['artifacts'], 'output': str(output), 'sha256': protected[str(output)]}
        if any(avif.digest(path) != sha for path, sha in protected.items()):
            raise ValueError('Source, reference or native intent integrity changed before output decoding')
        facts, pixels, structural, packet, privacy = inspect_output(output, directory, reference, depth=depth, operation=operation)
        measurements = {**intent['measurements'], 'native_intent': intent['measurements']['hdr'],
            'hdr': compare_appearance(reference, avif.decode_transfer(pixels[..., :3], 'pq', 'p3'),
                reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')}
        case.update({'source_facts': intent['source_facts'], 'source_decoder_evidence': intent['source_decoder_evidence'],
            'native_geometry': intent['native_geometry'], 'reference_hdr': intent['reference_hdr'],
            'reference_sdr': intent['reference_sdr'], 'facts': facts, 'structural_checks': structural,
            'output_packet_facts': packet, 'privacy_measurement': privacy, 'measurements': measurements,
            'hdr_intent': {'path': str(png), 'sha256': intent['artifacts']['sha256'], 'facts': intent['facts'],
                'native_writer': intent['native_writer'], 'purpose': 'Inspected native encoder intent, not independent reference'},
            'regional_change_from_baseline': _regional_changes(old['measurements']['hdr'], measurements['hdr']),
            'baseline_output': {'case_id': old['case_id'], 'sha256': old['artifacts']['sha256'], 'path': old['artifacts']['output']}})
        case['checks'].update({'baseline': True, 'native_preparation': True, 'reference_agreement': agreement,
            'independent_source_decoder': intent['checks']['independent_source_decoder'],
            'native_source_precision': intent['checks']['native_source_precision'], 'native_geometry': intent['checks']['native_geometry'],
            'hdr_intent': intent['measurements']['hdr']['passed'], 'independent_decoder': True,
            'structure': all(structural.values()), 'privacy': privacy['passed'],
            'appearance': all(measurement['passed'] for measurement in measurements.values())})
        if (any(avif.digest(path) != sha for path, sha in protected.items())
                or any(avif.digest(Path(__file__).parent/name) != sha for name, sha in hashes.items())):
            raise ValueError('Source, reference, native intent or emitted output integrity changed during decoding')
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


def run(directory, *, source=apple_source_model.SOURCE, selectors=None, depths=(12,), geometries=('contain',)):
    depths, geometries = tuple(depths), tuple(geometries)
    if (not depths or any(type(depth) is not int or depth not in DEPTHS for depth in depths)
            or len(set(depths)) != len(depths)
            or not geometries or any(type(operation) is not str or operation not in SIZES for operation in geometries)
            or len(set(geometries)) != len(geometries)
            or any(depth != 12 and operation != 'contain' for depth in depths for operation in geometries)
            or selectors is not None and (len(depths) != 1 or len(geometries) != 1
                                         or selectors != apple_hdr_avif._selectors(geometries[0], depths[0]))):
        raise ValueError('Expected distinct proved depth/geometry tuples and at most one exact selector request')
    directory = Path(directory)
    reports = [_run_one(directory if (depth, operation) == (12, 'contain')
                        else directory/(f'depth-{depth}' if operation == 'contain' else f'{operation}-{depth}'),
                        source=source, selectors=selectors, depth=depth, operation=operation)
               for depth in depths for operation in geometries]
    report = reports[0]
    if len(reports) > 1:
        baselines = [result['baseline'] for result in reports]
        report['additional_depth_results'] = reports[1:]
        report['cases'] = [case for result in reports for case in result['cases']]
        report['commands'] = [command for result in reports for command in result['commands']]
        report['baseline'] = {'cases': [case for baseline in baselines for case in baseline['cases']],
                              'depth_results': baselines}
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
