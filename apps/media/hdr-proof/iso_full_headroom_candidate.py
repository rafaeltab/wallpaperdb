"""One native full-source HDR JPEG, tested at three absolute display boosts.

The native source decoder renders boost64 before the existing geometry and
PQ intent encoding. Native gain computation uses the actual compressed base.
Independent references never supply pixels to the encoder. The unchanged
boost16 preparation remains a separate control, and every rendering shares
one emitted file. Display headroom is not a product selector.
"""
import copy
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_hdr
import gainmap_linear
import gainmap_sdr
import icc_gainmap
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_iso import decode_iso_source
from gainmap_metadata import check_metadata
from gainmap_reference import reference
from iso_intermediate_headroom import RENDERING_REFERENCE_REVISION, FULL_HEADROOM_REFERENCE_REVISION

SOURCE_TOOL = '/opt/proof/ultrahdr/float32/hdr-proof-uhdr'
RENDERINGS = {2: RENDERING_REFERENCE_REVISION, 16: 'gainmap-hdr-target-gamut-v1',
              64: FULL_HEADROOM_REFERENCE_REVISION}


def check_native_source(facts, source):
    """Require actual source capacity and precision before native geometry."""
    metadata = source['iso_metadata']
    if (metadata['base_headroom'] != 0 or not 0 < metadata['alternate_headroom'] <= 6
            or facts.get('width') != source['base']['width']
            or facts.get('height') != source['base']['height'] or facts.get('gamut') != 1
            or facts.get('requested_display_boost') != 64 or facts.get('gain_map_weight') != 1
            or facts.get('native_precision') != 'float32 gain application before half-float storage'
            or not np.isclose(facts.get('headroom', float('nan')), 2**metadata['alternate_headroom'], rtol=1e-6, atol=0)):
        raise ValueError('Native source must establish full pinned ISO capacity at requested boost64 in P3 float32')


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='p3', actual_gamut='p3',
                              fixture_class='gainmap-hdr')


def _render(case, directory, source, source_map, output, output_map, full_intent):
    boost = case['rendering_scope']['display_boost']
    headroom = int(math.log2(boost))
    decoded = decode_iso_source(source.read_bytes(), source_map.read_bytes(), headroom=headroom)
    expected, geometry = reference(decoded['linear_rgb_nits'], decoded['gamut'], 'p3', 'upscale', 1)
    ref = directory/f'independent-source-boost{boost}.rgbf64'
    expected.astype('<f8').tofile(ref)
    case['source_decoder_evidence'] = decoded['evidence']
    case['reference_method'] = {**geometry, 'source_rendering_headroom_log2': headroom,
        'source_reference_revision': case['source_reference_revision'],
        'order': f'Independently reconstruct source at display boost{boost}, then apply established geometry'}
    case['reference_hdr'] = {'path': str(ref), 'sha256': avif.digest(ref), 'gamut': 'p3',
        'transfer': 'linear', 'units': 'cd/m2', 'sample_format': 'interleaved little-endian RGB float64',
        'dimensions': [expected.shape[1], expected.shape[0]], 'display_boost': boost,
        'purpose': 'Independent same-boost matched-geometry source reference'}
    native, native_facts = icc_gainmap.native_decode(output, directory/f'native-boost{boost}.rgbf32', boost=boost)
    independent, independent_facts = icc_gainmap.independent_decode(output, output_map, boost=boost)
    case['hdr_decoder_evidence'] = {'native': {**native_facts, 'requested_display_boost': boost},
                                    'independent': independent_facts}
    source_capacity = decoded['evidence']['iso_metadata']['alternate_headroom']
    case['rendering_scope'].update({'headroom_log2': headroom, 'source_capacity_headroom_log2': source_capacity,
        'output_capacity_headroom_log2': independent_facts['iso_metadata']['alternate_headroom'],
        'source_gain_map_weight': min(headroom/source_capacity, 1),
        'output_gain_map_weight': independent_facts['gain_map_weight']})
    cross, actual, oracle = _measure(independent, native), _measure(expected, native), _measure(expected, independent)
    case['measurements'].update({'reconstructed_hdr': actual, 'independent_hdr': oracle,
                                'independent_hdr_cross_decoder': cross})
    case['checks'].update({'independent_source_decoder': True, 'independent_decoder': cross['passed'],
        'structure': case['checks']['structure'] and native.shape == independent.shape == expected.shape
            and native_facts['gamut'] == independent_facts['gamut'] == 'p3',
        'appearance': case['measurements']['authored_sdr_base']['passed'] and actual['passed'] and oracle['passed']})
    if boost == 64:
        case['checks']['full_headroom_weights'] = (
            case['rendering_scope']['source_gain_map_weight'] == 1 and independent_facts['gain_map_weight'] == 1)
        case['hdr_intent'] = {**full_intent, 'display_boost': 64}
    diagnostic = {'status': 'tested and failed', 'scope': 'Pinned sRGB-assuming native reader at the same '
        'display boost; not physical consumer qualification', 'consumer_status': 'pending manual review'}
    try:
        raw = directory/f'stock-boost{boost}.gbrpf32'
        stock = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr',
                                       'decode-linear', output, raw, str(boost)]))
        values = np.fromfile(raw, '<f4').reshape(3, stock['height'], stock['width'])[[2, 0, 1]].transpose(1, 2, 0)*203
        diagnostic['measurement'] = compare_appearance(expected, values, reference_gamut='p3',
            actual_gamut={0: 'srgb', 1: 'p3', 2: 'rec2020'}[stock['gamut']], fixture_class='gainmap-hdr')
        if diagnostic['measurement']['passed']:
            diagnostic['status'] = 'qualified'
    except Exception as error:
        diagnostic['failure'] = str(error)
    case['consumer_decoder_diagnostics'] = {'stock_native_srgb': diagnostic}


def run(directory, *, source_id='gainmap-android-iso', operation='upscale'):
    """Test a fixed native recipe and retain all three same-file outcomes."""
    if source_id != 'gainmap-android-iso' or operation != 'upscale':
        raise ValueError('Only the declared pinned ISO upscale full-source candidate is admitted')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    control_directory = directory/'converter-control'
    control_report = icc_gainmap.run(control_directory, map_policy='midpointoffset', map_gamma=1.5)
    control = control_report['cases'][0]
    candidate = control['candidate']+'-source-boost64'
    cases = []
    for boost, revision in RENDERINGS.items():
        cases.append({'case_id': f'{source_id}:hdr:jpg:preserve:preserve:{operation}:{candidate}:{revision}:render-boost{boost}',
            'fixture_id': source_id, 'cell_id': control['cell_id'], 'candidate': candidate,
            'source_sha256': control['source_sha256'], 'geometry': operation,
            'source_reference_revision': revision, 'source_precision': 'float32',
            'selectors': copy.deepcopy(control['selectors']), 'status': 'tested and failed',
            'consumer_status': 'pending manual review',
            'known_consumer_limitations': control['known_consumer_limitations'],
            'qualification_scope': f'One actual-file rendering at display boost{boost}; '
                'faithful adaptation requires the same output bytes to pass every declared rendering',
            'rendering_scope': {'display_boost': boost, 'source_reference_revision': revision,
                'native_source_preparation_display_boost': 64, 'headroom_is_product_selector': False},
            'checks': {name: False for name in ('native_encoder', 'independent_source_decoder',
                'native_source_precision', 'native_geometry', 'hdr_intent', 'independent_decoder',
                'structure', 'appearance', 'privacy')}, 'measurements': {}, 'blockers': [], 'artifacts': {}})
    report = {'scope': 'One separately encoded full-source native candidate; the same file is measured at boosts2,16,64',
        'declaration': 'Use the existing native source float32 helper at64, unchanged upscale geometry, '
            'the exact existing compressed gamma3.2 base, midpointoffset1/16384 and gamma1.5 FLOAT map. '
            'No reference pixels enter the encoder; no metadata-only reinterpretation of prior output.',
        'converter_control': {'status': control['status'], 'case_id': control['case_id'],
            'display_boost': 16, 'output_sha256': control.get('artifacts', {}).get('sha256'),
            'path': str(control_directory/'results.json'), 'sha256': avif.digest(control_directory/'results.json')},
        'cases': cases, 'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}
    try:
        if control['status'] != 'qualified':
            raise ValueError('Unchanged source/base preparation control failed')
        source, source_map = gainmap.FIXTURES/(source_id+'.jpg'), control_directory/'source-inspection/map.jpg'
        preparation = control['native_candidate']['source_preparation']
        repacked = Path(preparation['parts_directory'])/'hdr-source/source-native.jpg'
        raw = directory/'source-boost64.gbrpf32'
        native_facts = json.loads(avif.native([SOURCE_TOOL, 'decode-linear32', repacked, raw, '64']))
        check_native_source(native_facts, control['source_decoder_evidence'])
        native_source = {**preparation['hdr_source'], 'path': str(raw), 'sha256': avif.digest(raw),
            'precision': native_facts['native_precision'], 'native_source': {
                'display_boost': 64, 'facts': native_facts, 'source_repacking': preparation['hdr_source']['native_source'],
                'repacked_source_sha256': avif.digest(repacked), 'helper_sha256': avif.digest(SOURCE_TOOL)}}
        geometry = gainmap_linear.resample_linear(native_source, directory/'geometry-boost64.gbrapf32', operation, 1)
        intent = directory/'hdr-intent-boost64-pq.png'
        filters = preparation['hdr_intent_filters']
        avif.native(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
            '-s', f'{geometry["width"]}x{geometry["height"]}', '-i', geometry['path'], '-vf', filters,
            '-frames:v', '1', '-map_metadata', '-1', '-y', intent])
        base, output = Path(control['native_candidate']['base']), directory/'output.jpg'
        encoded = icc_gainmap.pack(base, intent, output, map_policy='midpointoffset', map_gamma=1.5, map_method='float')
        report['native_candidate'] = encoded
        # Independent source reconstruction happens after actual native encoding.
        full_source = decode_iso_source(source.read_bytes(), source_map.read_bytes(), headroom=6)
        expected_full, reference_geometry = reference(full_source['linear_rgb_nits'], 'p3', 'p3', operation, 1)
        samples = np.fromfile(raw, '<f4').reshape(3, native_source['height'], native_source['width'])
        source_measure = _measure(full_source['linear_rgb_nits'], samples[[2, 0, 1]].transpose(1, 2, 0).astype(float)*203)
        geometry_measure = _measure(expected_full, gainmap_hdr.read_linear(geometry))
        intent_facts = gainmap.inspect(intent, directory/'intent-inspection')
        intent_signal = avif.read_png(intent)
        intent_measure = _measure(expected_full, avif.decode_transfer(intent_signal[..., :3], 'pq', 'p3'))
        cicp = [intent_facts['metadata'].get('PNG-cICP:'+key) for key in
                ('ColorPrimaries', 'TransferCharacteristics', 'MatrixCoefficients', 'VideoFullRangeFlag')]
        intent_check = (intent_measure['passed'] and cicp == [12, 16, 0, 1] and intent_facts['coded_depth'] == 16
            and intent_facts['frame_count'] == 1 and intent_facts['opaque'] and not intent_facts['private_tags']
            and intent_signal.shape[:2] == expected_full.shape[:2])
        full_intent = {'path': str(intent), 'sha256': avif.digest(intent), 'facts': intent_facts,
            'purpose': 'Inspected native full-source HDR intent comparison; not an independent reference'}
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='p3', gamma=3.2)
        with Image.open(control['reference_sdr']['path']) as image:
            reference_sdr = sdr_signal_to_nits(np.asarray(image.convert('RGB'))/255)
        sdr_measure = compare_appearance(reference_sdr, actual_sdr, reference_gamut='p3',
                                        actual_gamut='rec2020', fixture_class='gainmap-sdr')
        facts = gainmap.inspect(output, directory/'inspection')
        probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
        agreement = check_metadata(facts, probe)
        structural = {'baseline_depths': all(facts[layer]['sof'] == 0 and facts[layer]['depth'] == 8
                                             for layer in ('base', 'map')),
            'dimensions': all([facts[layer]['width'], facts[layer]['height']] == [769, 1025] for layer in ('base', 'map')),
            'gamut': sdr_facts['gamut'] == 'p3', 'orientation': facts['metadata'].get('IFD0:Orientation', 1) == 1,
            'static_opaque': facts['frame_count'] == 1 and facts['opaque'],
            'dual_metadata': bool(facts['iso_identifier'] and facts['android_xmp_properties']),
            'metadata_agreement': all(agreement['checks'].values()), 'requested_map_gamma': probe['gamma'] == [1.5]*3,
            'requested_map_offsets': all(channel[field] == 1/16384 for channel in facts['iso_metadata']['channels']
                                         for field in ('base_offset', 'alternate_offset')),
            'actual_base_icc': sdr_facts['icc_sha256'] == control['native_candidate']['base_encoding']['icc_sha256']}
        report['full_source_preparation'] = {'native_source': native_source, 'geometry': geometry,
            'reference_method': reference_geometry, 'native_intent': full_intent, 'intent_filters': filters,
            'measurements': {'source': source_measure, 'geometry': geometry_measure, 'intent': intent_measure}}
        for case in cases:
            case.update({'facts': facts, 'source_facts': control['source_facts'], 'native_candidate': encoded,
                'reference_sdr': control['reference_sdr'], 'source_precision_evidence': native_source,
                'structural_checks': structural, 'gain_map_metadata_agreement': agreement,
                'native_metadata_probe': probe, 'sdr_decoder_evidence': sdr_facts,
                'artifacts': {'output': str(output), 'sha256': avif.digest(output)}})
            case['measurements'].update({'native_hdr_source_at_boost64': source_measure,
                'native_hdr_geometry_at_boost64': geometry_measure, 'native_hdr_intent_png_at_boost64': intent_measure,
                'authored_sdr_base': sdr_measure})
            case['checks'].update({'native_encoder': True, 'native_source_precision': source_measure['passed'],
                'native_geometry': geometry_measure['passed'], 'hdr_intent': intent_check,
                'structure': all(structural.values()), 'privacy': not facts['private_tags'] and sdr_facts['privacy']})
            try:
                _render(case, directory, source, source_map, output, directory/'inspection/map.jpg', full_intent)
                case['blockers'] = [f'Failed {key} check at display boost {case["rendering_scope"]["display_boost"]}'
                                    for key, passed in case['checks'].items() if not passed]
                if all(case['checks'].values()):
                    case['status'] = 'qualified'
            except Exception as error:
                case['blockers'].append(str(error))
    except Exception as error:
        for case in cases:
            case['blockers'].append(str(error))
    report['commands'] = avif.COMMANDS[start:]
    report['gainmap_commands'] = control_report['gainmap_commands'] + [
        {'log': str(path), **json.loads(path.read_text())} for path in sorted(directory.glob('*.log'))]
    report['source_hashes'] = {**control_report['source_hashes'], **{name: avif.digest(Path(__file__).with_name(name))
        for name in ('iso_full_headroom_candidate.py', 'gainmap_linear.py', 'gainmap_reference.py',
                     'gainmap_iso.py', 'gainmap_metadata.py', 'native_gainmap.cpp', 'appearance.py')}}
    report['native_hashes'], report['native_source_hashes'] = control_report['native_hashes'], control_report['native_source_hashes']
    report['full_source_helper_sha256'] = avif.digest(SOURCE_TOOL)
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
