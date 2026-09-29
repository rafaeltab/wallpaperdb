"""Separate ISO display-boost2/64 proofs; boost16 endpoint evidence stays separate.

The converter is rerun without modifying its bytes or metadata. The source
reference is independently reconstructed at the same display boost before
the established geometry. Hypothetical weighting and uncompressed-map
comparisons diagnose error; they cannot qualify the actual emitted file.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap
import icc_gainmap
from appearance import compare_appearance, delta_e_itp
from gainmap_iso import decode_iso_source
from gainmap_reference import reference
from gamma_icc import profile_facts

RENDERING_REFERENCE_REVISION = 'gainmap-iso-intermediate-boost2-v1'
FULL_HEADROOM_REFERENCE_REVISION = 'gainmap-iso-full-headroom-boost64-v1'


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='p3', actual_gamut='p3',
                              fixture_class='gainmap-hdr')


def _attribution(directory, endpoint, expected, capacity, headroom=1):
    """Hold native endpoint pixels fixed while isolating map coding/weighting."""
    shape = expected.shape
    codes = np.fromfile(directory/'diagnostic-native-base.rgb8', np.uint8).reshape(shape)
    with Image.open(directory/'output.jpg') as image:
        gammas = profile_facts(image.info['icc_profile'])['gammas']
    linear = (codes.astype(float)/255)**np.asarray(gammas)
    with Image.open(directory/'output-icc-parts/map.png') as image:
        map_input = np.asarray(image.convert('RGB'))/255
    channels = endpoint['facts']['iso_metadata']['channels']
    minimum = np.array([channel['minimum'] for channel in channels])
    interval = np.array([channel['maximum']-channel['minimum'] for channel in channels])
    gamma = np.array([channel['gamma'] for channel in channels])
    offset = np.array([channel['base_offset'] for channel in channels])
    alternate_offset = np.array([channel['alternate_offset'] for channel in channels])
    intent = avif.decode_transfer(avif.read_png(directory/'preparation-parts/hdr-intent-pq.png')[..., :3],
                                  'pq', 'p3')/203
    ideal_gain = np.log2((intent+alternate_offset)/(linear+offset))
    quantized_gain = minimum+map_input**(1/gamma)*interval
    actual_weight, normalized_weight = min(headroom/capacity, 1), 1/4
    result = {'scope': 'Read-only attribution only; these hypothetical pixels cannot qualify the actual file',
        'base_linearization_model': 'Actual parsed ICC TRCs evaluated in float64 in the profile own-primary '
            'coordinates. Native LCMS duplicates the same actual ICC and replaces only destination TRCs '
            'with gamma1, retaining its colorants, white point and adaptation matrix. This models that '
            'coordinate boundary without a second matrix conversion; it is not bit-exact LCMS readback '
            'and does not eliminate every color-interpretation or floating-point difference.',
        'normalized_weight_basis': 'One log2 display-headroom unit divided by the existing four-unit '
            'source reference endpoint. This is not the weight signaled by the emitted file.',
        'actual_weight': actual_weight, 'diagnostic_normalized_weight': normalized_weight,
        'measurements': {}, 'worst_pixels': {}}
    variants = [
            ('pre_jpeg_map_actual_weight', quantized_gain, actual_weight),
            ('ideal_gain_actual_weight', ideal_gain, actual_weight)]
    if headroom == 1:
        variants += [
            ('pre_jpeg_map_normalized_weight', quantized_gain, normalized_weight),
            ('ideal_gain_normalized_weight', ideal_gain, normalized_weight)]
    else:
        del result['diagnostic_normalized_weight'], result['normalized_weight_basis']
        result['weight_scope'] = 'Full source and output capacity at boost64; no hypothetical '
        result['weight_scope'] += 'normalized-weight comparison above the converter boost16 endpoint'
    for name, gain, weight in variants:
        actual = np.maximum((linear+offset)*2**(gain*weight)-alternate_offset, 0)*203
        result['measurements'][name] = _measure(expected, actual)
        delta = delta_e_itp(expected, actual, reference_gamut='p3', actual_gamut='p3')
        y, x = np.unravel_index(np.argmax(delta), delta.shape)
        result['worst_pixels'][name] = {'xy': [int(x), int(y)], 'delta_e_itp': float(delta[y, x]),
            'reference_nits': expected[y, x].tolist(), 'actual_nits': actual[y, x].tolist(),
            'compressed_base_nits': (linear[y, x]*203).tolist(),
            'native_intent_at_display_boost16_nits': (intent[y, x]*203).tolist()}
    return result


def run(directory, *, source_id='gainmap-android-iso', operation='upscale', display_boost=2):
    """Run the real converter and independently test one exact rendering."""
    if (source_id != 'gainmap-android-iso' or operation != 'upscale'
            or type(display_boost) not in (int, float) or display_boost not in (2, 64)):
        raise ValueError('Only the declared ISO upscale renderings at display boost2 or boost64 are admitted')
    display_boost = int(display_boost)
    headroom = int(math.log2(display_boost))
    revision = RENDERING_REFERENCE_REVISION if display_boost == 2 else FULL_HEADROOM_REFERENCE_REVISION
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    endpoint_directory = directory/'converter-endpoint'
    endpoint_report = icc_gainmap.run(endpoint_directory, source_id=source_id, operation=operation,
                                    map_policy='midpointoffset', map_gamma=1.5)
    endpoint = endpoint_report['cases'][0]
    candidate = endpoint['candidate']+f'-render-boost{display_boost}'
    case = {'case_id': endpoint['case_id']+f':render-boost{display_boost}', 'candidate': candidate,
        'fixture_id': source_id, 'source_sha256': endpoint['source_sha256'],
        'source_reference_revision': revision,
        'cell_id': endpoint['cell_id'], 'geometry': operation, 'selectors': endpoint['selectors'],
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': f'Only actual-file rendering at display boost{display_boost} against independently '
            'reconstructed ISO source at that same boost. The separate boost16 endpoint does not '
            'establish faithful intermediate adaptation or physical-display qualification.',
        'known_consumer_limitations': endpoint['known_consumer_limitations'],
        'checks': {'native_encoder': endpoint['checks']['native_encoder'],
            'converter_endpoint': endpoint['status'] == 'qualified', 'independent_source_decoder': False,
            'independent_decoder': False, 'structure': endpoint['checks']['structure'],
            'appearance': False, 'privacy': endpoint['checks']['privacy']},
        'rendering_scope': {'display_boost': display_boost, 'headroom_log2': headroom,
            'source_reference_revision': revision,
            'sdr_white_nits': 203, 'converter_reference_display_boost': 16,
            'headroom_is_product_selector': False},
        'measurements': {}, 'blockers': [], 'artifacts': endpoint.get('artifacts', {})}
    report = {'scope': 'One declared intermediate ISO display-headroom requirement; unchanged endpoint qualification',
        'converter_endpoint': {'status': endpoint['status'], 'case_id': endpoint['case_id'],
            'display_boost': 16, 'path': str(endpoint_directory/'results.json'),
            'sha256': avif.digest(endpoint_directory/'results.json'),
            'gainmap_commands': endpoint_report['gainmap_commands'],
            'scope': 'Separate existing conversion proof evaluated at source reference display boost16'},
        'cases': [case], 'attribution_diagnostics': {},
        'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}
    if display_boost == 64:
        report['scope'] = 'One declared full-source ISO display-headroom requirement; unchanged boost16 endpoint qualification'
        case['checks']['full_headroom_weights'] = False
        case['qualification_scope'] = ('Only actual-file rendering at display boost64 against independently '
            'reconstructed ISO source at the same boost. Both source and output gain weights are full; '
            'the separate boost16 endpoint does not establish full-source HDR or physical-display qualification.')
    try:
        if endpoint['status'] != 'qualified':
            raise ValueError('The unchanged converter endpoint did not qualify; intermediate rendering cannot qualify')
        source = gainmap.FIXTURES/(source_id+'.jpg')
        decoded = decode_iso_source(source.read_bytes(), (endpoint_directory/'source-inspection/map.jpg').read_bytes(),
                                    headroom=headroom)
        expected, geometry = reference(decoded['linear_rgb_nits'], decoded['gamut'], 'p3', operation, 1)
        case['source_decoder_evidence'] = decoded['evidence']
        case['source_facts'] = endpoint['source_facts']
        case['reference_method'] = {**geometry, 'source_rendering_headroom_log2': headroom,
            'source_reference_revision': revision,
            'order': f'Independently reconstruct source at display boost{display_boost}, then apply established geometry'}
        case['checks']['independent_source_decoder'] = True
        ref = directory/f'independent-source-boost{display_boost}.rgbf64'
        expected.astype('<f8').tofile(ref)
        case['reference_hdr'] = {'path': str(ref), 'sha256': avif.digest(ref), 'gamut': 'p3',
            'transfer': 'linear', 'units': 'cd/m2', 'sample_format': 'interleaved little-endian RGB float64',
            'dimensions': [expected.shape[1], expected.shape[0]], 'display_boost': display_boost,
            'purpose': 'Independent same-boost matched-geometry source reference; not the boost16 native intent'}
        output, map_path = endpoint_directory/'output.jpg', endpoint_directory/'inspection/map.jpg'
        native_path = directory/f'native-boost{display_boost}.rgbf32'
        actual, native = icc_gainmap.native_decode(output, native_path, boost=display_boost)
        independent, oracle = icc_gainmap.independent_decode(output, map_path, boost=display_boost)
        capacity = oracle['iso_metadata']['alternate_headroom']
        source_capacity = decoded['evidence']['iso_metadata']['alternate_headroom']
        case['rendering_scope'].update({'source_capacity_headroom_log2': source_capacity,
            'output_capacity_headroom_log2': capacity, 'source_gain_map_weight': min(headroom/source_capacity, 1),
            'output_gain_map_weight': oracle['gain_map_weight'],
            'source_weight_at_converter_reference_display_boost16': min(4/source_capacity, 1)})
        if display_boost == 64:
            case['checks']['full_headroom_weights'] = (
                case['rendering_scope']['source_gain_map_weight'] == 1 and oracle['gain_map_weight'] == 1)
        case['hdr_decoder_evidence'] = {'native': {**native, 'requested_display_boost': display_boost}, 'independent': oracle}
        case['facts'] = endpoint['facts']
        case['gain_map_metadata_agreement'] = endpoint['gain_map_metadata_agreement']
        case['native_metadata_probe'] = endpoint['native_metadata_probe']
        cross = _measure(independent, actual)
        native_measure, independent_measure = _measure(expected, actual), _measure(expected, independent)
        case['measurements'] = {'authored_sdr_base': endpoint['measurements']['authored_sdr_base'],
            'reconstructed_hdr': native_measure, 'independent_hdr': independent_measure,
            'independent_hdr_cross_decoder': cross}
        case['checks']['independent_decoder'] = cross['passed']
        case['checks']['structure'] &= actual.shape == independent.shape == expected.shape
        case['checks']['appearance'] = (native_measure['passed'] and independent_measure['passed']
                                       and case['measurements']['authored_sdr_base']['passed'])
        report['attribution_diagnostics'] = _attribution(endpoint_directory, endpoint, expected, capacity, headroom)
        if display_boost == 64:
            report['unchanged_output_rendering_diagnostics'] = {
                'scope': 'Read-only comparison; native boost16 intent is not the boost64 source reference',
                'native_output_identical_to_boost16': native_path.read_bytes() == (endpoint_directory/'native.rgbf32').read_bytes(),
                'reference_peak_channel_nits': float(np.max(expected)), 'output_peak_channel_nits': float(np.max(actual))}
        case['blockers'] = [f'Failed {key} check at display boost {display_boost}' for key, passed in case['checks'].items() if not passed]
        if all(case['checks'].values()):
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    report['commands'] = avif.COMMANDS[start:]
    report['source_hashes'] = {**endpoint_report['source_hashes'],
        **{name: avif.digest(Path(__file__).with_name(name)) for name in
           ('iso_intermediate_headroom.py', 'gainmap_iso.py', 'gainmap_reference.py', 'appearance.py')}}
    report['native_hashes'] = endpoint_report['native_hashes']
    report['native_source_hashes'] = endpoint_report['native_source_hashes']
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
