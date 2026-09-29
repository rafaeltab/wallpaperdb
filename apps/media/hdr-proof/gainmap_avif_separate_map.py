"""Native separate base/map containment with the original source gain metadata.

Candidate pixels come only from the locked AVIF: the established native SDR
geometry supplies the unchanged gamma3.2 JPEG base; native bilinear map sampling
and native Lanczos axes supply the FLOAT-DCT RGB8 map. The provenance-locked
originating XMP JPEG carries metadata into the existing native packer. Every
field is checked against independently parsed AVIF tmap, emitted ISO/XMP and
native probes. No pixels from that metadata carrier enter either image layer.

The same emitted file is measured at boost2, source full headroom and boost16.
The existing regenerated-map trials stay separate. All appearance gates and
references remain unchanged. Reference-order diagnostics concern exact samples
under equal offsets, not impossibility under the allowed regional tolerances.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import dct_jpeg
import gainmap
import gainmap_avif
import gainmap_avif_hdr
import gainmap_avif_hdr_jpeg
import gainmap_avif_hdr_jpeg_headroom
import gainmap_sdr
import icc_gainmap
from appearance import compare_appearance, delta_e_itp, sdr_signal_to_nits
from gainmap_metadata import check_metadata
from gamma_icc import decode_signal_to_nits, profile_facts

SELECTORS = gainmap_avif_hdr_jpeg.SELECTORS
TOOL = '/opt/proof/ultrahdr/precise/hdr-proof-uhdr'
CARRIER = Path(__file__).parent/'fixtures/gainmap/gainmap-android-xmp.jpg'
CARRIER_SHA256 = 'd22fd05e210df1067ebd6a1f63d0e5d94c5fa9042fe2ebd7067a10a301402271'
POLICY = {
    'profile': 'gainmap-hdr', 'sdr_profile': 'gainmap-sdr',
    'threshold_policy': 'Unchanged predeclared photographic gates; no metadata-preservation or intermediate-headroom allowance',
    'reference_revision': gainmap_avif_hdr.POLICY['reference_revision'],
    'intermediate_reference_revision': gainmap_avif_hdr_jpeg_headroom.REFERENCE_REVISION,
    'source_renderer': gainmap_avif_hdr.POLICY['source_reference'],
    'geometry_reference': gainmap_avif_hdr.POLICY['geometry_reference'],
    'candidate_geometry': 'Native BILINEAR8 map to403x302 source-base dimensions, then native coded-space Lanczos RGB8 axes to173x130; native authored SDR base unchanged',
    'recipe': 'Original source gamma1, zero offsets and capacity3.5; native FLOAT-DCT RGB8 map and existing gamma3.2 RGB8 base',
    'metadata_precision': 'Native probe/float and ISO serialization relative tolerance1e-6, absolute1e-12, as in existing gainmap_metadata.check_metadata; no appearance tolerance change',
    'scope': 'Only static opaque identity-oriented locked source, contain173x130, depth/gamut preserve, same-file boosts2/source-full/16; physical consumers pending',
}


def _measure(expected, actual, profile='gainmap-hdr'):
    return compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class=profile)


def _values(source_facts):
    metadata = source_facts['metadata']
    vectors = {key: [n/d for n, d in metadata[key]] for key in
        ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')}
    return {**vectors, 'base_headroom': metadata['base_headroom'][0]/metadata['base_headroom'][1],
            'alternate_headroom': metadata['alternate_headroom'][0]/metadata['alternate_headroom'][1]}


def _matches(source_facts, native):
    values = _values(source_facts)
    expected = {'minimum_boost': [2**v for v in values['gain_map_min']],
        'maximum_boost': [2**v for v in values['gain_map_max']], 'gamma': values['gamma'],
        'sdr_offset': values['base_offset'], 'hdr_offset': values['alternate_offset'],
        'hdr_capacity_min': 2**values['base_headroom'], 'hdr_capacity_max': 2**values['alternate_headroom']}
    checks = {key: bool(np.asarray(native.get(key)).shape == np.asarray(value).shape
                       and np.allclose(value, native[key], atol=1e-12, rtol=1e-6)) for key, value in expected.items()}
    checks['use_base_cg'] = native.get('use_base_cg') is source_facts['metadata']['use_base_color_space']
    return {'passed': all(checks.values()), 'checks': checks, 'expected_from_tmap': expected,
            'relative_tolerance': 1e-6, 'absolute_tolerance': 1e-12,
            'scope': 'Metadata serialization only; all independent appearance thresholds remain unchanged'}


def _carrier(source_facts, path=CARRIER):
    path = Path(path)
    if avif.digest(path) != CARRIER_SHA256:
        raise ValueError('Unknown provenance-locked metadata carrier hash')
    probe = json.loads(avif.native([TOOL, 'probe', path]))
    agreement = _matches(source_facts, probe)
    if not agreement['passed']:
        raise ValueError('Native carrier metadata differs from independently parsed AVIF tmap')
    return {'path': str(path), 'sha256': avif.digest(path), 'native_probe': probe, 'agreement': agreement,
        'provenance': 'The locked originating XMP JPEG used by the deterministic gain-map AVIF source generator',
        'scope': 'Metadata only. No carrier pixels enter candidate layers. Native pack replaces both compressed image pointers before encoding.'}


def inspect_output(path, directory, source_facts, carrier):
    """Inspect actual RGB8 layers and original gain metadata independently."""
    path, directory = Path(path), Path(directory)
    facts = gainmap.inspect(path, directory)
    if (not facts.get('gain_map_present') or not facts.get('iso_metadata')
            or not facts.get('android_xmp_properties') or facts['private_tags']
            or facts['frame_count'] != 1 or not facts['opaque']):
        raise ValueError('Expected private-metadata-free static opaque dual-metadata gain-map JPEG')
    for layer in ('base', 'map'):
        if any(facts[layer].get(key) != value for key, value in
               {'width': 173, 'height': 130, 'depth': 8, 'components': 3, 'sof': 0}.items()):
            raise ValueError('Unknown emitted RGB8 base/map geometry or depth')
    data, map_data = path.read_bytes(), (directory/'map.jpg').read_bytes()
    tags = facts['metadata']
    base_size, map_size = tags.get('MPImage1:MPImageLength'), tags.get('MPImage2:MPImageLength')
    if (type(base_size) is not int or type(map_size) is not int or min(base_size, map_size) <= 0
            or base_size+map_size != len(data) or map_size != len(map_data) or data[base_size:] != map_data
            or tags.get('MPF0:NumberOfImages') != 2 or tags.get('MPImage1:MPImageStart') != 0
            or tags.get('MPImage2:MPImageStart') != base_size
            or tags.get('XMP-GContainer:DirectoryItemSemantic') != ['Primary', 'GainMap']
            or tags.get('XMP-GContainer:DirectoryItemMime') != ['image/jpeg']*2
            or tags.get('XMP-GContainer:DirectoryItemLength') != map_size):
        raise ValueError('Expected exactly two declared JPEG layers without additional payload')
    facts['layer_structure'] = {name: gainmap_avif_hdr_jpeg._layer_structure(content, (173, 130))
                               for name, content in (('base', data[:base_size]), ('map', map_data))}
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
    decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=3.2, expected_gamut='srgb')
    with Image.open(directory/'map.jpg') as image:
        if image.info.get('icc_profile'):
            raise ValueError('Gain map must not carry a display ICC profile')
    probe = json.loads(avif.native([TOOL, 'probe', path]))
    agreement = check_metadata(facts, probe)
    source_agreement = _matches(source_facts, probe)
    values, iso = _values(source_facts), facts['iso_metadata']
    channels = iso['channels']*(3 if len(iso['channels']) == 1 else 1)
    original_iso = {field: bool(np.allclose([channel[field] for channel in channels], values[source_field],
                                           atol=1e-12, rtol=1e-6)) for field, source_field in (
        ('minimum', 'gain_map_min'), ('maximum', 'gain_map_max'), ('gamma', 'gamma'),
        ('base_offset', 'base_offset'), ('alternate_offset', 'alternate_offset'))}
    original_iso.update({field: math.isclose(iso[field], values[field], abs_tol=1e-12, rel_tol=1e-6)
                         for field in ('base_headroom', 'alternate_headroom')})
    fields = tuple(source_agreement['expected_from_tmap'])+('use_base_cg',)
    exact = all(probe[key] == carrier['native_probe'][key] for key in fields)
    if not all(agreement['checks'].values()) or not source_agreement['passed'] or not all(original_iso.values()) or not exact:
        raise ValueError('Original AVIF, carrier, emitted ISO/XMP and native gain metadata disagree')
    facts.update({'actual_base_icc': profile_facts(profile), 'native_metadata_probe': probe,
        'metadata_agreement': agreement, 'original_metadata_agreement': source_agreement,
        'independent_tmap_iso_field_agreement': original_iso,
        'native_carrier_values_exact': exact})
    return facts


def _ordering(base, middle, full):
    low, high = np.minimum(base, full), np.maximum(base, full)
    excursion = np.maximum(np.maximum(low-middle, 0), np.maximum(middle-high, 0))
    result = {'scope': 'Exact reference representability only; not a proof that no approximate encoding can pass the unchanged regional thresholds',
        'may_qualify_emitted_file': False,
        'property': 'With equal nonnegative base/alternate offsets, R(w)=max((B+O)*2^(g*w)-O,0) is continuous at SDR and monotonic in weight: '
            'its unclipped derivative (B+O)*ln(2)*g*2^(g*w) has a constant sign. Clipping preserves monotonicity. '
            'Each middle channel must lie between its endpoint channels. Original zero offsets and the prior regenerated equal-offset recipe satisfy this assumption; '
            'this statement does not cover an unequal-offset decoder discontinuity at weight0.',
        'reference_scope': 'Fixed authored coded-space SDR at203nit white, independently reconstructed source boost2 before geometry, independent full HDR before geometry',
        'pixels_with_exact_order_violation': int(np.count_nonzero(np.any(excursion > 0, axis=2))),
        'pixels_with_order_violation_above_001nit': int(np.count_nonzero(np.any(excursion > .01, axis=2))),
        'maximum_channel_excursion_nits': float(np.max(excursion)), 'samples': []}
    for index in np.argsort(excursion.max(axis=2), axis=None)[-8:][::-1]:
        y, x = np.unravel_index(index, excursion.shape[:2])
        projection = np.clip(middle[y, x], low[y, x], high[y, x])
        result['samples'].append({'xy': [int(x), int(y)], 'authored_sdr_nits': base[y, x].tolist(),
            'source_boost2_nits': middle[y, x].tolist(), 'source_full_nits': full[y, x].tolist(),
            'channel_excursion_nits': excursion[y, x].tolist(), 'component_box_projection_nits': projection.tolist(),
            'projection_delta_e_itp': float(delta_e_itp(middle[y:y+1, x:x+1], projection[None, None, :],
                reference_gamut='srgb', actual_gamut='srgb')[0, 0]),
            'projection_scope': 'Diagnostic component clamp, not the metric-nearest admissible curve or a lower error bound'})
    return result


def run(directory, *, source_id=gainmap_avif.FIXTURE_ID, operation='contain', selectors=None,
        source_lock=gainmap_avif.SOURCE_LOCK):
    if source_id != gainmap_avif.FIXTURE_ID or operation != 'contain':
        raise ValueError('Only the locked gain-map AVIF source and containment geometry are admitted')
    gainmap_avif_hdr_jpeg.validate_selectors(SELECTORS if selectors is None else selectors)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    baseline = gainmap_avif_hdr_jpeg_headroom.run(directory/'regenerated-map-baseline', source_lock=source_lock)
    endpoint = baseline['converter_endpoint']['case']
    source = Path(endpoint['artifacts']['source'])
    source_facts = endpoint['source_facts']
    capacity = _values(source_facts)['alternate_headroom']
    renderings = [('boost2', 2), ('source-full', 2**capacity), ('boost16', 16)]
    cases = []
    for label, boost in renderings:
        cases.append({'case_id': source_id+f':hdr:jpg:preserve:preserve:contain:separate-original-map:render-{label}',
            'candidate': 'native-separate-original-map-'+label, 'fixture_id': source_id, 'cell_id': 'avif-gainmap:hdr:jpg',
            'geometry': operation, 'selectors': SELECTORS, 'source_sha256': endpoint['source_sha256'], 'source_facts': source_facts,
            'source_reference_revision': (gainmap_avif_hdr_jpeg_headroom.REFERENCE_REVISION if label == 'boost2'
                                          else gainmap_avif_hdr.POLICY['reference_revision']),
            'status': 'tested and failed', 'consumer_status': 'pending manual review',
            'qualification_scope': f'ICC-aware actual-file rendering at {label}, display boost {boost}, with original source metadata and separate native base/map geometry. '
                'Only this declared renderer and geometry are measured; no general adaptation or physical qualification.',
            'known_consumer_limitations': ['The base requires actual gamma3.2 ICC interpretation; stock sRGB-assuming readers are unqualified.',
                'Mac/iPad/Windows/Galaxy browser and wallpaper checks remain pending manual review.'],
            'rendering_scope': {'label': label, 'display_boost': boost, 'headroom_log2': math.log2(boost),
                'sdr_white_nits': 203, 'headroom_is_product_selector': False, 'required_product_path': False},
            'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
            'checks': {key: False for key in ('native_encoder', 'independent_source_decoder', 'native_preparation',
                'source_metadata', 'independent_decoder', 'structure', 'privacy', 'same_file', 'appearance')},
            'measurements': {}, 'artifacts': {}, 'blockers': []})
    report = {'scope': POLICY, 'evidence': cases, 'regenerated_map_baseline': baseline,
        'source_fixtures': baseline['source_fixtures'], 'fixtures': [],
        'source_reconstruction_profiles': baseline['source_reconstruction_profiles'],
        'controls': [{**row, 'case_id': row['case_id']+'-separate-map'} for row in baseline['controls']],
        'pre_jpeg_diagnostics': {}, 'consumer_status': 'pending manual review'}
    try:
        if endpoint['status'] != 'qualified' or not all(endpoint['checks'].values()):
            raise ValueError('Existing source and native authored-SDR preparation must qualify first')
        facts, _ = gainmap_avif_hdr._admit_source(source, directory/'source-inspection', source_lock)
        carrier = _carrier(facts)
        base = Path(endpoint['native_candidate']['base'])
        if avif.digest(base) != endpoint['native_candidate']['base_sha256']:
            raise ValueError('Native authored base changed after inspection')
        protected = [source, base, Path(endpoint['artifacts']['output'])]
        before = {str(path): avif.digest(path) for path in protected}
        horizontal, fullmap = directory/'map-at-base-horizontal.png', directory/'map-at-base.png'
        gainmap_avif_hdr._map_axis(directory/'source-inspection/map-native.png', horizontal, 403, 384)
        gainmap_avif_hdr._map_axis(horizontal, fullmap, 403, 302)
        gainmap_sdr._axis(['-i', fullmap], directory/'map-contained-horizontal.png', 173, 302)
        gainmap_sdr._axis(['-i', directory/'map-contained-horizontal.png'], directory/'map-contained.png', 173, 130)
        codes = gainmap_avif_hdr._read_rgb8(directory/'map-contained.png', (173, 130))
        if not np.all(codes == codes[..., :1]):
            raise ValueError('Monochrome source map must retain equal RGB channels after native geometry')
        map_path, output = directory/'map.jpg', directory/'output.jpg'
        encoding = dct_jpeg.encode(directory/'map-contained.png', map_path, method='float')
        pack = json.loads(avif.native([TOOL, 'pack', carrier['path'], base, map_path, output]))
        for case in cases:
            case['checks']['native_encoder'] = True
            case['artifacts'] = {'source': str(source), 'source_sha256': avif.digest(source),
                                 'output': str(output), 'sha256': avif.digest(output)}
        output_facts = inspect_output(output, directory/'inspection', facts, carrier)
        report['native_candidate'] = {'metadata_carrier': carrier, 'native_packer': pack,
            'native_packer_sha256': avif.digest(TOOL), 'base': {'path': str(base), 'sha256': avif.digest(base)},
            'map': {'path': str(map_path), 'sha256': avif.digest(map_path), 'encoding': encoding, 'equal_rgb_channels': True,
                'pre_jpeg_pixel_sha256': hashlib.sha256(codes.tobytes()).hexdigest()}}
        partial_ref = baseline['evidence'][0]['reference_hdr']
        full_ref, sdr_ref = endpoint['reference_hdr'], endpoint['reference_sdr']
        if any(avif.digest(ref['path']) != ref['sha256'] for ref in (partial_ref, full_ref, sdr_ref)):
            raise ValueError('Fixed independent source reference changed')
        partial = np.load(partial_ref['path'])
        full = gainmap.array_geometry(np.load(full_ref['path']), 'contain')
        full_path = directory/'reference-full-contain-nits.npy'
        np.save(full_path, full)
        with Image.open(sdr_ref['path']) as image:
            authored_signal = np.asarray(image).astype(float)/255
        authored = sdr_signal_to_nits(authored_signal, nominal_white_nits=203)
        authored_sdr = sdr_signal_to_nits(authored_signal)
        signal, _ = gainmap_sdr.decode(output, gamut='srgb', gamma=3.2)
        base_linear = signal**np.asarray(output_facts['actual_base_icc']['gammas'])
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='srgb', gamma=3.2)
        sdr_measure = compare_appearance(authored_sdr, actual_sdr, reference_gamut='srgb',
                                        actual_gamut='rec2020', fixture_class='gainmap-sdr')
        report['reference_ordering_diagnostic'] = _ordering(authored, partial, full)
        values = _values(facts)
        low, high, gamma, base_offset, alternate_offset = [np.array(values[key]) for key in
            ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
        gains = low+(high-low)*(codes/255)**(1/gamma)
        same_file = avif.digest(output)
        for case, (label, boost) in zip(cases, renderings):
            expected = partial if label == 'boost2' else full
            reference = partial_ref if label == 'boost2' else {'path': str(full_path), 'sha256': avif.digest(full_path),
                'gamut': 'srgb', 'transfer': 'linear', 'units': 'cd/m2', 'dimensions': [173, 130], 'display_boost': boost,
                'revision': gainmap_avif_hdr.POLICY['reference_revision'], 'purpose': 'Independent fully applied source, then established containment'}
            raw = directory/f'{label}.rgbf32'
            actual, native = icc_gainmap.native_decode(output, raw, boost=boost)
            independent, reader = icc_gainmap.independent_decode(output, directory/'inspection/map.jpg', boost=boost)
            weight = min(math.log2(boost)/capacity, 1)
            probe = output_facts['native_metadata_probe']
            native_weight = min(math.log2(boost/probe['hdr_capacity_min'])
                                /math.log2(probe['hdr_capacity_max']/probe['hdr_capacity_min']), 1)
            measure = {'authored_sdr': sdr_measure, 'native_hdr': _measure(expected, actual),
                'independent_hdr': _measure(expected, independent), 'cross_decoder_hdr': _measure(independent, actual)}
            case.update({'facts': output_facts, 'reference_hdr': reference, 'reference_sdr': sdr_ref, 'measurements': measure,
                'hdr_decoder_evidence': {'native': {**native, 'requested_display_boost': boost,
                    'raw_path': str(raw), 'raw_sha256': avif.digest(raw)}, 'independent': reader},
                'sdr_decoder_evidence': sdr_facts, 'native_candidate': report['native_candidate']})
            case['rendering_scope'].update({'source_capacity_headroom_log2': capacity,
                'output_capacity_headroom_log2': reader['iso_metadata']['alternate_headroom'],
                'source_gain_map_weight': weight, 'output_gain_map_weight': reader['gain_map_weight'],
                'native_weight_derived_from_verified_inputs': native_weight,
                'native_weight_scope': 'Derived from the verified native probe capacities and recorded invocation boost; not a returned native decoder field'})
            case['checks'].update({'independent_source_decoder': True, 'native_preparation': True,
                'source_metadata': (output_facts['original_metadata_agreement']['passed'] and reader['gain_map_weight'] == weight
                                    and math.isclose(native_weight, weight, abs_tol=1e-7, rel_tol=0)),
                'independent_decoder': measure['cross_decoder_hdr']['passed'],
                'structure': actual.shape == independent.shape == expected.shape == (130, 173, 3)
                    and reader['gamut'] == native['gamut'] == 'srgb',
                'privacy': not output_facts['private_tags'] and sdr_facts['privacy'],
                'same_file': avif.digest(output) == same_file, 'appearance': all(value['passed'] for value in measure.values())})
            diagnostic = np.maximum((base_linear+base_offset)*2**(gains*weight)-alternate_offset, 0)*203
            report['pre_jpeg_diagnostics'][label] = {'scope': 'Hypothetical uncompressed map only; not an emitted-file reader',
                'may_qualify_emitted_file': False, 'measurement': _measure(expected, diagnostic)}
        after = {str(path): avif.digest(path) for path in protected}
        report['unchanged_artifacts'] = {'before': before, 'after': after, 'passed': before == after}
        for case in cases:
            case['checks']['same_file'] &= before == after
            case['blockers'] = [f'Failed {name} check' for name, passed in case['checks'].items() if not passed]
            if not case['blockers']:
                case['status'] = 'qualified'
    except Exception as error:
        for case in cases:
            case['blockers'].append(str(error))
    report['commands'] = avif.COMMANDS[start:]
    report['source_hashes'] = {name: avif.digest(Path(__file__).with_name(name)) for name in
        ('gainmap_avif_separate_map.py', 'gainmap_avif_hdr_jpeg_headroom.py', 'gainmap_avif_hdr_jpeg.py',
         'gainmap_avif.py', 'gainmap_avif_hdr.py', 'gainmap_sdr.py', 'dct_jpeg.py', 'icc_gainmap.py', 'appearance.py')}
    report['native_log_artifacts'] = [{'path': str(path), 'sha256': avif.digest(path), 'text': path.read_text()}
                                    for path in sorted(directory.rglob('*.log'))]
    (directory/'evidence.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
