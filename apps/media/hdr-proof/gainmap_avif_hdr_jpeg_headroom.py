"""One same-boost2 rendering proof for the existing gain-map AVIF HDR JPEG.

The real containment converter is rerun unchanged. Its qualified boost16
endpoint is preserved separately. Direct dav1d source packets and actual tmap
fractions reconstruct the source at boost2 before the established geometry.
Both ICC-aware output readers must match that reference under unchanged gates.

Capacity-normalized, pre-JPEG and ideal endpoint arrays are attribution only.
They never enter the encoder or qualify the emitted file. In particular, the
authored coded-space SDR geometry remains fixed even where hypothetical linear
SDR geometry would reduce intermediate HDR errors. This optional measurement
does not add a product selector, required conversion, or physical qualification.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_avif
import gainmap_avif_hdr
import gainmap_avif_hdr_jpeg
import gainmap_avif_hdr_png
import gainmap_sdr
import icc_gainmap
from appearance import compare_appearance, delta_e_itp, sdr_signal_to_nits
from gamma_icc import profile_facts

REFERENCE_REVISION = 'gainmap-avif-hdr-bilinear8-lanczosfloat-boost2-v1'
POLICY = {
    'profile': 'gainmap-hdr',
    'reference_revision': REFERENCE_REVISION,
    'source_renderer_revision': gainmap_avif_hdr.POLICY['reference_revision'],
    'threshold_policy': 'Unchanged predeclared gainmap-hdr regional gates; no intermediate-headroom error allowance',
    'reference': 'Direct dav1d base/map samples, actual tmap fractions and established BILINEAR8 map sampling; source gain application at boost2 before linear-light Lanczos containment',
    'sampling_scope': gainmap_avif_hdr.POLICY['sampling_rationale'],
    'sdr_reference': 'The existing independently authored coded-space SDR geometry and gainmap-sdr gates remain unchanged',
    'output_scope': 'Actual existing ICC-aware RGB8 base/map JPEG rendered at boost2 only; no general adaptation or consumer claim',
}


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='srgb',
                              fixture_class='gainmap-hdr')


def _worst(expected, actual):
    difference = delta_e_itp(expected, actual, reference_gamut='srgb', actual_gamut='srgb')
    y, x = np.unravel_index(np.argmax(difference), difference.shape)
    return {'xy': [int(x), int(y)], 'delta_e_itp': float(difference[y, x]),
            'reference_nits': expected[y, x].tolist(), 'actual_nits': actual[y, x].tolist()}


def _source_reference(source, endpoint, directory, source_lock):
    """Render independent source pixels at boost2, before any geometry."""
    directory = Path(directory)
    facts, base_codes = gainmap_avif_hdr._admit_source(source, directory, source_lock)
    width, height = facts['map']['dimensions']
    raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu', '-i', directory/'map.obu',
                       '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'])
    if len(raw) != width*height or hashlib.sha256(raw).hexdigest() != facts['packet_samples']['map']['decoded_sha256']:
        raise ValueError('Independent map samples changed after source inspection')
    mapped = np.asarray(Image.fromarray(np.frombuffer(raw, np.uint8).reshape(height, width)).resize(
        tuple(facts['base']['dimensions']), Image.Resampling.BILINEAR))
    metadata = facts['metadata']
    low, high, gamma, base_offset, alternate_offset = [np.array([n/d for n, d in metadata[key]])
        for key in ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
    capacity = metadata['alternate_headroom'][0]/metadata['alternate_headroom'][1]
    base_capacity = metadata['base_headroom'][0]/metadata['base_headroom'][1]
    if base_capacity != 0 or not 1 < capacity < 4:
        raise ValueError('The locked source must have partial weight at boost2 and full weight at boost16')
    weight = float(np.clip((1-base_capacity)/(capacity-base_capacity), 0, 1))
    base = sdr_signal_to_nits(base_codes/255, nominal_white_nits=203)/203
    gain = low+(high-low)*(mapped[..., None]/255)**(1/gamma)
    full = ((base+base_offset)*2**gain-alternate_offset)*203
    original = endpoint['reference_hdr']
    if avif.digest(original['path']) != original['sha256'] or not np.array_equal(full, np.load(original['path'])):
        raise ValueError('Same source convention no longer reproduces the unchanged boost16 reference exactly')
    partial = ((base+base_offset)*2**(gain*weight)-alternate_offset)*203
    expected = gainmap.array_geometry(partial, 'contain')
    source_path, reference_path = directory/'source-boost2-nits.npy', directory/'contain-boost2-nits.npy'
    np.save(source_path, partial)
    np.save(reference_path, expected)
    evidence = {'decoder': 'Direct native dav1d source base/map packets; independent actual tmap equations',
        'facts': facts, 'display_boost': 2, 'headroom_log2': 1, 'sdr_white_nits': 203,
        'source_capacity_headroom_log2': capacity, 'source_gain_map_weight': weight,
        'map_sampling': 'Established Pillow antialiased BILINEAR8 at actual base dimensions',
        'geometry_order': 'Reconstruct source at display boost2 before established linear-light float Lanczos containment; clamp negative geometry components',
        'boost16_source_reference_exact': True, 'source_sha256': avif.digest(source),
        'source_reference': {'path': str(source_path), 'sha256': avif.digest(source_path)},
        'reference_revision': REFERENCE_REVISION}
    reference = {'path': str(reference_path), 'sha256': avif.digest(reference_path), 'gamut': 'srgb',
        'transfer': 'linear', 'units': 'cd/m2', 'dimensions': [expected.shape[1], expected.shape[0]],
        'sample_format': 'NumPy RGB float64 array', 'display_boost': 2,
        'purpose': 'Independent same-boost matched-geometry source reference, not the boost16 native intent'}
    return expected, evidence, reference, {'base_nits': base*203, 'full_nits': full, 'weight': weight}


def _attribution(directory, endpoint, expected, independent, reader, source):
    """Hold the real endpoints fixed; all resulting arrays are hypothetical."""
    output = Path(endpoint['artifacts']['output'])
    base_signal, base_facts = gainmap_sdr.decode(output, gamut='srgb', gamma=3.2)
    with Image.open(output) as image:
        color = profile_facts(image.info['icc_profile'])
    base = base_signal**np.asarray(color['gammas'])
    map_path = directory/'output-inspection/map.jpg'
    raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', map_path,
                      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    codes = np.frombuffer(raw, np.uint8).reshape(expected.shape)/255
    channels = reader['iso_metadata']['channels']
    minimum = np.array([channel['minimum'] for channel in channels])
    interval = np.array([channel['maximum']-channel['minimum'] for channel in channels])
    gamma = np.array([channel['gamma'] for channel in channels])
    base_offset = np.array([channel['base_offset'] for channel in channels])
    alternate_offset = np.array([channel['alternate_offset'] for channel in channels])
    coded_gain = minimum+interval*codes**(1/gamma)
    weight, source_weight = reader['gain_map_weight'], source['weight']

    def render(gain, gain_weight):
        return np.maximum((base+base_offset)*2**(gain*gain_weight)-alternate_offset, 0)*203

    if not np.array_equal(render(coded_gain, weight), independent):
        raise ValueError('Attribution arithmetic must exactly reproduce the independent actual-file reader')
    candidate = endpoint['native_candidate']
    original_map, intent_path = Path(candidate['computed_map']), Path(candidate['hdr_intent'])
    if avif.digest(original_map) != candidate['computed_map_sha256'] or avif.digest(intent_path) != candidate['hdr_intent_sha256']:
        raise ValueError('Inspected native map or HDR intent changed before attribution')
    map_input = gainmap_avif_hdr._read_rgb8(original_map, (173, 130))/255
    pre_jpeg_gain = minimum+interval*map_input**(1/gamma)
    _, intent_signal = gainmap_avif_hdr_png.inspect_and_decode(intent_path)
    intent = avif.decode_transfer(intent_signal[..., :3], 'pq', 'srgb')/203
    ideal_gain = np.log2((intent+alternate_offset)/(base+base_offset))
    full_reference = gainmap.array_geometry(source['full_nits'], 'contain')
    base_reference = gainmap.array_geometry(source['base_nits'], 'contain')
    sdr_reference = endpoint['reference_sdr']
    if avif.digest(sdr_reference['path']) != sdr_reference['sha256']:
        raise ValueError('Independent authored SDR reference changed before attribution')
    with Image.open(sdr_reference['path']) as image:
        authored = sdr_signal_to_nits(np.asarray(image).astype(float)/255, nominal_white_nits=203)
    linear_endpoints = (base_reference/203)**(1-source_weight)*(full_reference/203)**source_weight*203
    linear_endpoints_offset = np.maximum((base_reference/203+base_offset)**(1-source_weight)
        *(full_reference/203+alternate_offset)**source_weight-alternate_offset, 0)*203
    authored_endpoints_offset = np.maximum((authored/203+base_offset)**(1-source_weight)
        *(full_reference/203+alternate_offset)**source_weight-alternate_offset, 0)*203
    variants = {
        'coded_map_source_capacity_weight': render(coded_gain, source_weight),
        'pre_jpeg_map_actual_weight': render(pre_jpeg_gain, weight),
        'pre_jpeg_map_source_capacity_weight': render(pre_jpeg_gain, source_weight),
        'ideal_native_endpoint_gain_actual_weight': render(ideal_gain, weight),
        'ideal_native_endpoint_gain_source_capacity_weight': render(ideal_gain, source_weight),
        'ideal_native_endpoints_zero_offset_source_capacity_weight': base**(1-source_weight)*intent**source_weight*203,
        'independent_linear_geometry_endpoints_zero_offset': linear_endpoints,
        'independent_linear_geometry_endpoints_declared_offset': linear_endpoints_offset,
        'independent_authored_sdr_geometry_endpoints_declared_offset': authored_endpoints_offset,
    }
    result = {'scope': 'Read-only attribution from hypothetical arrays; no encoder input, emitted metadata change, replacement reference or qualification',
        'may_qualify_emitted_file': False, 'actual_weight': weight, 'diagnostic_source_capacity_weight': source_weight,
        'weight_basis': 'One log2 display-headroom unit divided by actual source capacity3.5; this is not the emitted output weight',
        'base_linearization_model': 'Actual ICC TRCs evaluated in float64 in the profile own-primary coordinates. '
            'Native LCMS uses the same ICC with gamma1 destination TRCs. This is not bit-exact LCMS readback and '
            'does not remove all native color or floating-point differences.',
        'coded_map_matches_independent_reader_exactly': True,
        'native_inputs': {'computed_map': str(original_map), 'computed_map_sha256': avif.digest(original_map),
            'hdr_intent': str(intent_path), 'hdr_intent_sha256': avif.digest(intent_path), 'base_facts': base_facts},
        'measurements': {}, 'worst_pixels': {}}
    for name, values in variants.items():
        result['measurements'][name] = _measure(expected, values)
        worst = _worst(expected, values)
        x, y = worst['xy']
        result['worst_pixels'][name] = {**worst, 'source_linear_geometry_base_nits': base_reference[y, x].tolist(),
            'source_authored_sdr_geometry_nits': authored[y, x].tolist(),
            'native_compressed_base_nits': (base[y, x]*203).tolist(),
            'source_full_hdr_geometry_nits': full_reference[y, x].tolist(),
            'native_full_hdr_intent_nits': (intent[y, x]*203).tolist(),
            'output_coded_gain': coded_gain[y, x].tolist(), 'output_map_rgb8': (codes[y, x]*255).tolist()}
    result['authored_sdr_vs_hypothetical_linear_sdr_geometry'] = compare_appearance(
        authored/203*100, base_reference/203*100, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
    return result


def run(directory, *, source_id=gainmap_avif.FIXTURE_ID, operation='contain', display_boost=2,
        source_lock=gainmap_avif.SOURCE_LOCK, selectors=None):
    """Re-encode the existing endpoint and test only its declared boost2 rendering."""
    if (source_id != gainmap_avif.FIXTURE_ID or operation != 'contain'
            or type(display_boost) not in (int, float) or display_boost != 2):
        raise ValueError('Only the locked gain-map AVIF containment at display boost2 is admitted')
    gainmap_avif_hdr_jpeg.validate_selectors(gainmap_avif_hdr_jpeg.SELECTORS if selectors is None else selectors)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    endpoint_report = gainmap_avif_hdr_jpeg.run(directory/'converter-endpoint', source_lock=source_lock)
    endpoint = endpoint_report['evidence'][0]
    endpoint_path = directory/'converter-endpoint-evidence.json'
    endpoint_path.write_text(json.dumps(endpoint_report, indent=2)+'\n')
    case = {'case_id': endpoint['case_id']+':render-boost2', 'candidate': endpoint['candidate']+'-render-boost2',
        'fixture_id': source_id, 'source_sha256': endpoint['source_sha256'], 'source_facts': endpoint['source_facts'],
        'cell_id': endpoint['cell_id'], 'geometry': operation, 'selectors': endpoint['selectors'],
        'source_reference_revision': REFERENCE_REVISION,
        'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': 'Actual-file ICC-aware rendering at display boost 2 against the independently reconstructed source at '
            'the same boost, currently tested and failed. The separate qualified boost16 endpoint establishes no intermediate adaptation or physical-display qualification.',
        'known_consumer_limitations': [*endpoint['known_consumer_limitations'],
            'The stock_native_srgb diagnostic below was measured at boost16 only; it is not a boost2 reader result.'],
        'consumer_decoder_diagnostics': {name: {**value, 'display_boost': 16}
            for name, value in endpoint.get('consumer_decoder_diagnostics', {}).items()},
        'rendering_scope': {'display_boost': 2, 'headroom_log2': 1, 'sdr_white_nits': 203,
            'source_reference_revision': REFERENCE_REVISION, 'converter_reference_display_boost': 16,
            'headroom_is_product_selector': False, 'required_product_path': False},
        'checks': {'native_encoder': endpoint['checks']['native_encoder'], 'converter_endpoint': endpoint['status'] == 'qualified',
            'independent_source_decoder': False, 'independent_decoder': False, 'same_output': False,
            'structure': endpoint['checks']['structure'], 'privacy': endpoint['checks']['privacy'],
            'rendering_headroom': False, 'appearance': False},
        'measurements': {}, 'blockers': [], 'artifacts': endpoint['artifacts']}
    report = {'scope': 'One optional AVIF-source containment rendering at boost2; endpoint conversion evidence remains separate',
        'evidence': [case], 'converter_endpoint': {'status': endpoint['status'], 'case_id': endpoint['case_id'],
            'display_boost': 16, 'case': endpoint, 'report': {'path': str(endpoint_path), 'sha256': avif.digest(endpoint_path)}},
        'source_fixtures': endpoint_report['source_fixtures'], 'fixtures': [],
        'source_reconstruction_profiles': endpoint_report['source_reconstruction_profiles'],
        'controls': [{**row, 'case_id': row['case_id']+'-headroom2'} for row in endpoint_report['controls']],
        'consumer_status': 'pending manual review'}
    try:
        if endpoint['status'] != 'qualified' or not all(endpoint['checks'].values()):
            raise ValueError('The unchanged converter endpoint must qualify before its intermediate rendering')
        source, output = Path(endpoint['artifacts']['source']), Path(endpoint['artifacts']['output'])
        before = {'source': avif.digest(source), 'output': avif.digest(output), 'endpoint_report': avif.digest(endpoint_path)}
        if before['source'] != endpoint['source_sha256'] or before['output'] != endpoint['artifacts']['sha256']:
            raise ValueError('Source or endpoint output changed after converter inspection')
        expected, source_evidence, reference, context = _source_reference(
            source, endpoint, directory/'source-inspection', source_lock)
        case.update({'source_decoder_evidence': source_evidence, 'reference_hdr': reference,
                     'reference_sdr': endpoint['reference_sdr']})
        case['checks']['independent_source_decoder'] = True
        facts = gainmap_avif_hdr_jpeg.inspect_output(output, directory/'output-inspection')
        native_path = directory/'native-boost2.rgbf32'
        actual, native_facts = icc_gainmap.native_decode(output, native_path, boost=2)
        independent, reader = icc_gainmap.independent_decode(output, directory/'output-inspection/map.jpg', boost=2)
        probe = facts['native_metadata_probe']
        native_weight = float(np.clip(math.log2(2/probe['hdr_capacity_min'])
            /math.log2(probe['hdr_capacity_max']/probe['hdr_capacity_min']), 0, 1))
        case['rendering_scope'].update({'source_capacity_headroom_log2': source_evidence['source_capacity_headroom_log2'],
            'source_gain_map_weight': context['weight'], 'output_capacity_headroom_log2': reader['iso_metadata']['alternate_headroom'],
            'output_gain_map_weight': reader['gain_map_weight'], 'native_weight_derived_from_verified_inputs': native_weight,
            'native_weight_scope': 'Derived from verified native probe capacities and the recorded boost2 invocation; not a returned native decoder field'})
        case['hdr_decoder_evidence'] = {'native': {**native_facts, 'requested_display_boost': 2,
            'raw_path': str(native_path), 'raw_sha256': avif.digest(native_path)}, 'independent': reader}
        case['facts'] = facts
        measurements = {'authored_sdr': endpoint['measurements']['authored_sdr'], 'native_hdr': _measure(expected, actual),
            'independent_hdr': _measure(expected, independent), 'cross_decoder_hdr': _measure(independent, actual)}
        case['measurements'] = measurements
        case['checks'].update({'independent_decoder': measurements['cross_decoder_hdr']['passed'],
            'structure': (endpoint['checks']['structure'] and facts == endpoint['facts']
                and actual.shape == independent.shape == expected.shape == (130, 173, 3)
                and native_facts['gamut'] == reader['gamut'] == 'srgb'),
            'rendering_headroom': bool(reader['display_boost'] == 2 and 0 < context['weight'] < 1
                and 0 < reader['gain_map_weight'] < 1
                and np.isclose(reader['gain_map_weight'], native_weight, atol=1e-7, rtol=0)),
            'appearance': all(value['passed'] for value in measurements.values())})
        case['worst_pixels'] = {'native_hdr': _worst(expected, actual), 'independent_hdr': _worst(expected, independent)}
        report['attribution_diagnostics'] = _attribution(directory, endpoint, expected, independent, reader, context)
        after = {'source': avif.digest(source), 'output': avif.digest(output), 'endpoint_report': avif.digest(endpoint_path)}
        case['checks']['same_output'] = before == after
        report['unchanged_artifacts'] = {'before': before, 'after': after, 'passed': before == after}
        case['blockers'] = [f'Failed {name} check at display boost 2' for name, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    report['commands'] = avif.COMMANDS[start:]
    logs = []
    for path in sorted(directory.rglob('*.log')):
        content = path.read_text()
        try:
            record = json.loads(content)
        except json.JSONDecodeError:
            record = {'text': content}
        logs.append({'path': str(path), 'sha256': avif.digest(path), 'record': record})
    report['native_log_artifacts'] = logs
    report['source_hashes'] = {name: avif.digest(Path(__file__).with_name(name)) for name in
        ('gainmap_avif_hdr_jpeg_headroom.py', 'gainmap_avif.py', 'gainmap_avif_hdr.py', 'gainmap_avif_hdr_jpeg.py',
         'gainmap_avif_hdr_png.py', 'gainmap.py', 'icc_gainmap.py', 'appearance.py', 'gamma_icc.py')}
    (directory/'evidence.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
