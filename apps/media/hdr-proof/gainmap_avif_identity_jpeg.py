"""Unresized gain-map AVIF to ICC-aware HDR JPEG at three measured boosts.

The locked source is decoded natively. Its original base raster is retained,
and its monochrome map is sampled at base dimensions with the existing native
bilinear8 convention. Native gamma 3.2 base coding and FLOAT-DCT map coding feed
the existing packer with fully checked original gain metadata. Independent
dav1d/tmap source references never enter either encoder.

Both HDR readers and actual-ICC SDR appearance must pass unchanged gates at
boost 2, source-full and boost 16. This optional identity format conversion has
no derivative resize, crop or orientation qualification. Prior failed resized
candidates remain unchanged; physical consumers remain pending manual review.
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
import gainmap_avif_jpeg
import gainmap_avif_png
import gainmap_avif_separate_map
import gainmap_sdr
import icc_gainmap
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_metadata import check_metadata
from gamma_icc import decode_signal_to_nits, profile_facts

SELECTORS = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
             'motion': 'preserve', 'transparency': 'preserve'}
DIMENSIONS = (403, 302)
POLICY = {
    'hdr_profile': 'gainmap-hdr', 'sdr_profile': 'gainmap-sdr',
    'reference_revision': 'gainmap-avif-original-raster-bilinear8-v1',
    'source_renderer_revision': gainmap_avif_hdr.POLICY['reference_revision'],
    'reference': 'Direct independent dav1d base/map packets, original tmap fractions, established Pillow BILINEAR8 map sampling at 403×302 and source gain application at each display boost; no raster geometry',
    'sdr_reference': 'Actual direct dav1d original RGB8 base, interpreted with sRGB at nominal 100-nit white; no resize',
    'native_preparation': 'Native AOM base checked against dav1d, native normalized BILINEAR8 map at source-base dimensions, established gamma 3.2 native base encoding, native FLOAT-DCT RGB8 gain map',
    'metadata': 'Original source gamma 1, offsets 0 and log2 capacity 3.5 retained through the fully checked provenance-locked XMP metadata carrier',
    'threshold_policy': 'Unchanged predeclared gainmap-hdr and gainmap-sdr gates; no original-map or identity-conversion error allowance',
    'scope': 'Static opaque identity-oriented source 403×302, HDR JPEG RGB8 base/map and original primaries; only explicit no-resize selectors and boosts 2/source-full/16',
}


def source_decision(source, directory, *, source_lock=gainmap_avif.SOURCE_LOCK):
    return gainmap_avif_hdr.source_decision(source, directory, source_lock=source_lock)


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')


def inspect_output(path, directory, source_facts, carrier):
    """Strict actual 403×302 RGB8 layers, privacy, ICC and original metadata."""
    if tuple(source_facts['base']['dimensions']) != DIMENSIONS:
        raise ValueError('Only the locked original 403×302 raster is admitted')
    path, directory = Path(path), Path(directory)
    facts = gainmap.inspect(path, directory)
    if (not facts.get('gain_map_present') or not facts.get('iso_metadata')
            or not facts.get('android_xmp_properties') or facts['private_tags']
            or facts['frame_count'] != 1 or not facts['opaque']):
        raise ValueError('Expected private-metadata-free static opaque dual-metadata gain-map JPEG')
    for layer in ('base', 'map'):
        if any(facts[layer].get(key) != value for key, value in
               {'width': 403, 'height': 302, 'depth': 8, 'components': 3, 'sof': 0}.items()):
            raise ValueError('Unknown original-raster RGB8 base/map dimensions or precision')
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
    facts['layer_structure'] = {name: gainmap_avif_hdr_jpeg._layer_structure(content, DIMENSIONS)
                               for name, content in (('base', data[:base_size]), ('map', map_data))}
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
    decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=3.2, expected_gamut='srgb')
    with Image.open(directory/'map.jpg') as image:
        if image.info.get('icc_profile'):
            raise ValueError('Gain map must not carry a display ICC profile')
    probe = json.loads(avif.native([gainmap_avif_separate_map.TOOL, 'probe', path]))
    agreement = check_metadata(facts, probe)
    source_agreement = gainmap_avif_separate_map._matches(source_facts, probe)
    values, iso = gainmap_avif_separate_map._values(source_facts), facts['iso_metadata']
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
        'independent_tmap_iso_field_agreement': original_iso, 'native_carrier_values_exact': exact,
        'extracted_map_sha256': hashlib.sha256(map_data).hexdigest()})
    return facts


def _controls(source, root):
    root.mkdir(parents=True, exist_ok=True)
    copied = gainmap_avif.copy_original(source, root/'original.avif')
    controls = [{'case_id': 'gainmap-avif-identity-jpeg-original-exact-bytes', 'passed': copied['exact_bytes'], 'original': copied}]
    data = source.read_bytes()
    for name, after in (('unknown-color', b'nclx\x00\x02\x00\x0d\x00\x00\x80'),
                        ('unknown-transfer', b'nclx\x00\x01\x00\x02\x00\x00\x80')):
        changed = root/(name+'.avif')
        changed.write_bytes(data.replace(b'nclx\x00\x01\x00\x0d\x00\x00\x80', after))
        decision = source_decision(changed, root/name)
        original = gainmap_avif.copy_original(changed, root/(name+'-original.avif'))
        controls.append({'case_id': 'gainmap-avif-identity-jpeg-'+name+'-original-only',
            'passed': decision['action'] == 'original only' and original['exact_bytes'], 'decision': decision, 'original': original})
    return [{**row, 'status': 'passed' if row['passed'] else 'tested and failed'} for row in controls]


def run(directory, *, source_id=gainmap_avif.FIXTURE_ID, operation='identity', selectors=None,
        source_lock=gainmap_avif.SOURCE_LOCK):
    if source_id != gainmap_avif.FIXTURE_ID or operation != 'identity' or selectors is not None and selectors != SELECTORS:
        raise ValueError('Only the locked source and exact no-resize HDR JPEG selectors are admitted')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source, fixture = gainmap_avif.generate_source(directory/'source', source_lock=source_lock)
    inspection = directory/'source-inspection'
    facts, base_codes = gainmap_avif_hdr._admit_source(source, inspection, source_lock)
    full, mapped = gainmap_avif_hdr._reference(facts, base_codes, inspection)
    values = gainmap_avif_separate_map._values(facts)
    capacity = values['alternate_headroom']
    base_linear = sdr_signal_to_nits(base_codes/255, nominal_white_nits=203)/203
    low, high, gamma, base_offset, alternate_offset = [np.array(values[key]) for key in
        ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
    gain = low+(high-low)*(mapped[..., None]/255)**(1/gamma)
    partial = ((base_linear+base_offset)*2**(gain/capacity)-alternate_offset)*203
    reference_paths = {}
    for label, pixels in (('boost2', partial), ('full', full)):
        path = directory/f'reference-{label}-source-nits.npy'
        np.save(path, pixels)
        reference_paths[label] = {'path': str(path), 'sha256': avif.digest(path)}
    sdr_reference = directory/'reference-sdr.png'
    Image.fromarray(base_codes).save(sdr_reference)
    fixture.update({'facts': facts, 'source_valid': True,
        'valid_scope': 'Actual locked source facts; each original-raster source/output rendering has its own appearance gate'})
    renderings = [('boost2', 2), ('source-full', 2**capacity), ('boost16', 16)]
    cases = []
    for label, boost in renderings:
        cases.append({'case_id': source_id+f':hdr:jpg:preserve:preserve:identity:original-map:render-{label}',
            'proof_module': 'gainmap_avif_identity_jpeg', 'candidate': 'native-identity-original-map-'+label,
            'fixture_id': source_id, 'cell_id': 'avif-gainmap:hdr:jpg', 'geometry': 'identity', 'selectors': SELECTORS,
            'source_sha256': avif.digest(source), 'source_facts': facts, 'source_reference_revision': POLICY['reference_revision'],
            'status': 'tested and failed', 'consumer_status': 'pending manual review',
            'qualification_scope': f'ICC-aware optional identity format conversion with no resize, at {label}, display boost {boost}; '
                'actual 403×302 source raster and original gain metadata under the declared bilinear8 renderer only.',
            'known_consumer_limitations': ['Passing this unresized conversion does not qualify resizing, crop, orientation, other headrooms or a different renderer.',
                'Actual gamma 3.2 ICC interpretation is required; the stock sRGB-assuming reader diagnostic is measured separately at 16 only.',
                'Mac/iPad/Windows/Galaxy browser and wallpaper checks remain pending manual review.'],
            'rendering_scope': {'label': label, 'display_boost': boost, 'headroom_log2': math.log2(boost),
                'sdr_white_nits': 203, 'headroom_is_product_selector': False, 'required_product_path': False},
            'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
            'checks': {key: False for key in ('native_encoder', 'independent_source_decoder', 'native_source',
                'native_base', 'native_transfer', 'source_metadata', 'independent_decoder', 'structure', 'privacy', 'same_file', 'appearance')},
            'measurements': {}, 'artifacts': {}, 'blockers': []})
    report = {'scope': POLICY, 'evidence': cases, 'source_fixtures': [fixture], 'fixtures': [],
        'source_reconstruction_profiles': [], 'controls': _controls(source, directory/'controls'),
        'consumer_status': 'pending manual review'}
    try:
        candidate = directory/'native-preparation'
        candidate.mkdir(exist_ok=True)
        native_source, source_pixels = gainmap_avif_hdr._reconstruct(source, facts, inspection, mapped, candidate)
        source_measure = _measure(full, source_pixels)
        if not source_measure['passed'] or not native_source['map_sampling']['passed'] or native_source['weight'] != 1:
            raise ValueError('Native source reconstruction must pass the established independent source convention')
        clean = directory/'base-clean.png'
        filters = 'format=rgb24,setsar=1,sidedata=mode=delete,setparams=color_primaries=1:color_trc=13:colorspace=0:range=full'
        avif.native(['ffmpeg', '-v', 'error', '-y', '-i', native_source['base_input']['path'], '-vf', filters,
                     '-pix_fmt', 'rgb24', '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', clean])
        clean_facts, clean_pixels = gainmap_avif_png.inspect_and_decode(clean)
        exact = bool(np.array_equal(np.rint(clean_pixels[..., :3]*255).astype(np.uint8), base_codes))
        report['native_preparation'] = {'source': native_source, 'source_appearance': source_measure,
            'base_source_samples_exact': exact, 'base': {'path': str(clean), 'sha256': avif.digest(clean), 'facts': clean_facts}}
        if not exact or (clean_facts['width'], clean_facts['height']) != DIMENSIONS:
            raise ValueError('Native original base cleanup changed source pixels or dimensions')
        base, map_path, output = directory/'base.jpg', directory/'map.jpg', directory/'output.jpg'
        encoded = gainmap_avif_jpeg._encode(clean, base, gamma32=True)
        if not encoded['transfer_stage']['passed']:
            raise ValueError('Native gamma 3.2 transfer changed the declared coding samples')
        map_encoding = dct_jpeg.encode(native_source['map_sampling']['path'], map_path, method='float')
        carrier = gainmap_avif_separate_map._carrier(facts)
        pack = json.loads(avif.native([gainmap_avif_separate_map.TOOL, 'pack', carrier['path'], base, map_path, output]))
        for case in cases:
            case['checks']['native_encoder'] = True
            case['artifacts'] = {'source': str(source), 'source_sha256': avif.digest(source),
                                 'output': str(output), 'sha256': avif.digest(output)}
        output_facts = inspect_output(output, directory/'inspection', facts, carrier)
        report['native_candidate'] = {'metadata_carrier': carrier, 'base_encoding': encoded, 'map_encoding': map_encoding,
            'native_pack': pack, 'native_packer_sha256': avif.digest(gainmap_avif_separate_map.TOOL)}
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='srgb', gamma=3.2)
        sdr_measure = compare_appearance(sdr_signal_to_nits(base_codes/255), actual_sdr, reference_gamut='srgb',
                                        actual_gamut='rec2020', fixture_class='gainmap-sdr')
        extracted_map = directory/'inspection/map.jpg'
        protected = [source, output, extracted_map, sdr_reference, *[Path(ref['path']) for ref in reference_paths.values()]]
        before = {str(path): avif.digest(path) for path in protected}
        for case, (label, boost) in zip(cases, renderings):
            expected = partial if label == 'boost2' else full
            raw = directory/f'{label}.rgbf32'
            actual, native = icc_gainmap.native_decode(output, raw, boost=boost)
            if avif.digest(extracted_map) != output_facts['extracted_map_sha256']:
                raise ValueError('Independent extracted map no longer matches the inspected output JPEG')
            independent, reader = icc_gainmap.independent_decode(output, extracted_map, boost=boost)
            weight = min(math.log2(boost)/capacity, 1)
            probe = output_facts['native_metadata_probe']
            native_weight = min(math.log2(boost/probe['hdr_capacity_min'])
                /math.log2(probe['hdr_capacity_max']/probe['hdr_capacity_min']), 1)
            measurements = {'authored_sdr': sdr_measure, 'native_hdr': _measure(expected, actual),
                'independent_hdr': _measure(expected, independent), 'cross_decoder_hdr': _measure(independent, actual)}
            reference = reference_paths['boost2' if label == 'boost2' else 'full']
            case.update({'facts': output_facts, 'measurements': measurements,
                'native_candidate': report['native_candidate'], 'native_preparation': report['native_preparation'],
                'reference_hdr': {**reference, 'gamut': 'srgb', 'transfer': 'linear', 'units': 'cd/m2',
                    'dimensions': list(DIMENSIONS), 'display_boost': boost, 'revision': POLICY['reference_revision']},
                'reference_sdr': {'path': str(sdr_reference), 'sha256': avif.digest(sdr_reference), 'gamut': 'srgb',
                    'transfer': 'srgb', 'revision': 'gainmap-avif-authored-original-base-v1'},
                'source_decoder_evidence': {'decoder': 'Direct dav1d base/map packets and independent tmap gain equations',
                    'geometry': 'none', 'source_packets': facts['packet_samples'], 'metadata': facts['metadata'],
                    'display_boost': boost, 'gain_map_weight': weight, 'sampling_revision': gainmap_avif_hdr.POLICY['reference_revision']},
                'hdr_decoder_evidence': {'native': {**native, 'requested_display_boost': boost, 'raw_sha256': avif.digest(raw)},
                                         'independent': reader}, 'sdr_decoder_evidence': sdr_facts})
            case['rendering_scope'].update({'source_capacity_headroom_log2': capacity,
                'output_capacity_headroom_log2': reader['iso_metadata']['alternate_headroom'],
                'source_gain_map_weight': weight, 'output_gain_map_weight': reader['gain_map_weight'],
                'native_weight_derived_from_verified_inputs': native_weight,
                'native_weight_scope': 'Derived from verified native probe capacities and recorded boost invocation; not a returned native decoder field'})
            case['checks'].update({'independent_source_decoder': True, 'native_source': source_measure['passed'],
                'native_base': exact, 'native_transfer': encoded['transfer_stage']['passed'],
                'source_metadata': (output_facts['original_metadata_agreement']['passed'] and reader['gain_map_weight'] == weight
                    and math.isclose(native_weight, weight, abs_tol=1e-7, rel_tol=0)),
                'independent_decoder': measurements['cross_decoder_hdr']['passed'],
                'structure': actual.shape == independent.shape == expected.shape == (302, 403, 3)
                    and native['gamut'] == reader['gamut'] == 'srgb',
                'privacy': not output_facts['private_tags'] and sdr_facts['privacy'],
                'appearance': all(value['passed'] for value in measurements.values())})
        stock = {'status': 'tested and failed', 'display_boost': 16, 'consumer_status': 'pending manual review',
                 'scope': 'Pinned native reader assuming sRGB base transfer; diagnostic only, not a physical consumer result'}
        diagnostic_start = len(avif.COMMANDS)
        try:
            raw = directory/'stock-boost16.gbrpf32'
            native = json.loads(avif.native([gainmap_avif_separate_map.TOOL, 'decode-linear', output, raw, '16']))
            pixels = np.fromfile(raw, '<f4').reshape(3, 302, 403)[[2, 0, 1]].transpose(1, 2, 0)*203
            stock['measurement'] = _measure(full, pixels)
            stock.update({'facts': native, 'raw_sha256': avif.digest(raw)})
            if stock['measurement']['passed']:
                stock['status'] = 'qualified'
        except Exception as error:
            stock['failure'] = str(error)
        stock['commands'] = avif.COMMANDS[diagnostic_start:]
        after = {str(path): avif.digest(path) for path in protected}
        report['same_file_all_renderings'] = {'before': before, 'after': after, 'passed': before == after}
        for case in cases:
            case['consumer_decoder_diagnostics'] = {'stock_native_srgb': stock}
            case['checks']['same_file'] = before == after
            case['blockers'] = [f'Failed {name} check' for name, passed in case['checks'].items() if not passed]
            if not case['blockers']:
                case['status'] = 'qualified'
    except Exception as error:
        for case in cases:
            case['blockers'].append(str(error))
    report['commands'] = avif.COMMANDS[start:]
    report['source_hashes'] = {name: avif.digest(Path(__file__).with_name(name)) for name in
        ('gainmap_avif_identity_jpeg.py', 'gainmap_avif_separate_map.py', 'gainmap_avif.py', 'gainmap_avif_hdr.py',
         'gainmap_avif_jpeg.py', 'gainmap_avif_png.py', 'gainmap_sdr.py', 'dct_jpeg.py', 'icc_gainmap.py', 'appearance.py')}
    report['native_log_artifacts'] = [{'path': str(path), 'sha256': avif.digest(path), 'text': path.read_text()}
                                    for path in sorted(directory.rglob('*.log'))]
    (directory/'evidence.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
