"""Exhaustive decoded RGB8 gain-map bounds, never conversion qualification.

One shared map code must render at every display boost. The search admits all
decoded RGB8 triples optimistically, ignoring JPEG neighborhood coupling. Its
lower bound applies only to the fixed decoded base, actual metadata and source
references. It says nothing about other bases, metadata, geometry or formats.
"""
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image

import avif
import gainmap
import icc_gainmap
import iso_source_capacity
from appearance import (RGB_TO_XYZ, THRESHOLDS, THRESHOLDS_PATH, THRESHOLDS_SHA256, delta_e_itp,
                        linear_rgb_to_itp, sdr_signal_to_nits)
from gainmap_iso import decode_iso_source
from gainmap_reference import reference
from gamma_icc import profile_facts
from iso_full_headroom_candidate import RENDERINGS

BOOSTS = (2, 16, 64)
REQUIRED_DEPENDENCIES = ('iso_source_capacity.py', 'iso_full_headroom_candidate.py',
    'icc_gainmap.py', 'gainmap_iso.py', 'gainmap_reference.py', 'appearance.py')
OUTPUT_SHA = '64e1627f20632239fa5755908bb72a4e359776c0891df92fd8b99c6b99df1091'
BASE_SHA = '5177870d6a7e34011d293ec0da6758d0b02778c095958d024d6a700ef32fff4a'
MAP_SHA = 'd79216f159265046f7e80942a5982179a1591be12cef4c354013dc3fa73ed10c'
MAP_INPUT_SHA = '49210362dbd93674a35c756899d13b8f1cef2c0b6c1f3f32ea9b083fa6c2fbb4'
AUTHORED_SDR_SHA = '506eaa7ab5ac7d17fcf1d83d8cd8810eec148ef4517a58c2f005a66f78690792'
REFERENCE_SHA = {
    2: 'ada7fd862aa808618206b5851a2a1a84906303698ea35c6e672c72ace7626e21',
    16: 'cccc87b046a06ee1fca707929adccb34c5c2bedfa280eb6245fee10017b5bf20',
    64: '50afd592440c056149d6a1a785ea662ce92eeb430ac7eebd5ab3d55cafbcfdf9'}


def _lookup(base_nits, metadata):
    base = np.asarray(base_nits, dtype=float)
    channels = metadata['channels']
    capacity = metadata['alternate_headroom']
    if (base.shape != (3,) or not np.all(np.isfinite(base)) or np.any(base < 0)
            or metadata['base_headroom'] != 0 or metadata['backward']
            or not metadata['use_base_colour_space'] or len(channels) != 3
            or not np.isfinite(capacity) or capacity <= 0):
        raise ValueError('Expected a forward RGB SDR-base gain map and finite positive capacity')
    fields = np.array([[channel[name] for name in
        ('minimum', 'maximum', 'gamma', 'base_offset', 'alternate_offset')] for channel in channels])
    minimum, maximum, gamma, offset, alternate = fields.T
    if (not np.all(np.isfinite(fields)) or np.any(maximum < minimum)
            or np.any(gamma <= 0) or np.any(offset < 0) or np.any(alternate < 0)):
        raise ValueError('Invalid actual gain-map parameters')
    weights = np.clip(np.log2(BOOSTS)/capacity, 0, 1)
    gain = minimum+(np.arange(256)[:, None]/255)**(1/gamma)*(maximum-minimum)
    return np.maximum((base[None, None, :]/203+offset)*2**(
        gain[None, :, :]*weights[:, None, None])-alternate, 0)*203


def render_codes(base_nits, codes, metadata):
    """The independent decoder's emitted-code model at boosts2,16,64."""
    codes = np.asarray(codes)
    if (codes.shape != (3,) or not np.all(np.isfinite(codes))
            or np.any(codes < 0) or np.any(codes > 255) or np.any(codes != np.floor(codes))):
        raise ValueError('Expected three actual decoded RGB8 map codes')
    return _lookup(base_nits, metadata)[:, codes.astype(int), np.arange(3)]


def minimum_map_error(base_nits, reference_nits, metadata):
    """Enumerate every RGB8 triple with one shared code for all three boosts."""
    expected = np.asarray(reference_nits, dtype=float)
    if (expected.shape != (3, 3) or not np.all(np.isfinite(expected)) or np.any(expected < 0)):
        raise ValueError('Expected one finite nonnegative RGB reference per declared display boost')
    targets = linear_rgb_to_itp(expected, 'p3')
    lookup = _lookup(base_nits, metadata)
    limit = THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max']
    green, blue = np.meshgrid(np.arange(256), np.arange(256), indexing='ij')
    green, blue = green.ravel(), blue.ravel()
    best, best_codes, best_errors = np.inf, None, None
    individual = np.full(3, np.inf)
    individual_codes = np.zeros((3, 3), dtype=int)
    pass_counts, joint_passes = np.zeros(3, dtype=np.int64), 0
    values, errors = np.empty((65536, 3)), np.empty((65536, 3))
    for red in range(256):
        for index in range(3):
            values[:, 0], values[:, 1], values[:, 2] = (
                lookup[index, red, 0], lookup[index, green, 1], lookup[index, blue, 2])
            errors[:, index] = 720*np.linalg.norm(linear_rgb_to_itp(values, 'p3')-targets[index], axis=-1)
            nearest = int(np.argmin(errors[:, index]))
            if errors[nearest, index] < individual[index]:
                individual[index] = errors[nearest, index]
                individual_codes[index] = [red, green[nearest], blue[nearest]]
        maxima = np.max(errors, axis=1)
        nearest = int(np.argmin(maxima))
        if maxima[nearest] < best:
            best = float(maxima[nearest])
            best_codes = [red, int(green[nearest]), int(blue[nearest])]
            best_errors = errors[nearest].tolist()
        pass_counts += np.count_nonzero(errors <= limit, axis=0)
        joint_passes += int(np.count_nonzero(np.all(errors <= limit, axis=1)))
    return {'enumerated_codes': 256**3, 'minimum_joint_max_delta_e': best,
        'joint_minimum_codes': best_codes, 'joint_minimum_delta_e_by_boost': best_errors,
        'joint_minimum_rgb_nits': render_codes(base_nits, best_codes, metadata).tolist(),
        'individual_minimum_delta_e': individual.tolist(), 'individual_minimum_codes': individual_codes.tolist(),
        'individual_code_counts_under_maximum': pass_counts.tolist(), 'joint_code_count_under_maximum': joint_passes,
        'fixed_representation_cannot_meet_joint_maximum': best > limit}


def _json_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _bind(path, declared_sha, expected_sha=None):
    path = Path(path)
    if expected_sha is not None and declared_sha != expected_sha or avif.digest(path) != declared_sha:
        raise ValueError(f'Changed diagnostic input or declared hash: {path}')
    return {'path': str(path), 'sha256': declared_sha}


def _recheck_bindings(bindings):
    for value in bindings.values():
        if isinstance(value, dict):
            if 'path' in value and 'sha256' in value:
                _bind(value['path'], value['sha256'])
            else:
                _recheck_bindings(value)


def _validate_report(report):
    """Reject stale or substituted evidence before any expensive enumeration."""
    if report['threshold_sha256'] != THRESHOLDS_SHA256:
        raise ValueError('Threshold hash differs from the fixed proof profile')
    if not set(REQUIRED_DEPENDENCIES).issubset(report['source_hashes']):
        raise ValueError('Cached evidence omits required source dependency hashes')
    for name, sha in report['source_hashes'].items():
        _bind(Path(__file__).with_name(name), sha)
    for name, path in (('native_hashes', '/opt/proof/icc-gainmap/binary-sha256.txt'),
                       ('native_source_hashes', '/opt/proof/icc-gainmap/source-sha256.txt'),
                       ('capacity_native_provenance', '/opt/proof/gainmap-capacity/provenance-sha256.txt')):
        if report[name] != Path(path).read_text():
            raise ValueError('Cached native provenance differs from the current pinned environment')
    cases = {case['rendering_scope']['display_boost']: case for case in report['cases']}
    if len(report['cases']) != 3 or set(cases) != set(BOOSTS):
        raise ValueError('Expected exactly the three same-file rendering records')
    bindings = {'source': _bind(gainmap.FIXTURES/'gainmap-android-iso.jpg', iso_source_capacity.SOURCE_SHA),
                'thresholds': _bind(THRESHOLDS_PATH, THRESHOLDS_SHA256),
                'references': {}}
    selectors = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
                 'motion': 'preserve', 'transparency': 'preserve', 'w': 769, 'fit': 'contain'}
    for boost, case in cases.items():
        if (case['fixture_id'] != 'gainmap-android-iso' or case['geometry'] != 'upscale'
                or case['source_sha256'] != iso_source_capacity.SOURCE_SHA
                or case['source_facts']['sha256'] != iso_source_capacity.SOURCE_SHA
                or case['selectors'] != selectors or case['source_reference_revision'] != RENDERINGS[boost]
                or case['rendering_scope']['source_reference_revision'] != RENDERINGS[boost]):
            raise ValueError('Changed source, selectors or rendering reference scope')
        _bind(case['artifacts']['output'], case['artifacts']['sha256'], OUTPUT_SHA)
        ref = case['reference_hdr']
        if (ref['gamut'] != 'p3' or ref['transfer'] != 'linear' or ref['dimensions'] != [769, 1025]
                or ref['display_boost'] != boost or ref['units'] != 'cd/m2'
                or ref['sample_format'] != 'interleaved little-endian RGB float64'):
            raise ValueError('Changed reference sample interpretation or rendering scope')
        bindings['references'][str(boost)] = _bind(ref['path'], ref['sha256'], REFERENCE_SHA[boost])
    first = cases[2]
    encoded = first['native_candidate']
    bindings['output'] = _bind(first['artifacts']['output'], first['artifacts']['sha256'], OUTPUT_SHA)
    bindings['base'] = _bind(encoded['base'], encoded['base_sha256'], BASE_SHA)
    bindings['map_input'] = _bind(encoded['computed_map'], encoded['computed_map_sha256'], MAP_INPUT_SHA)
    bindings['compressed_map'] = _bind(Path(encoded['computed_map']).with_suffix('.jpg'),
        report['native_candidate']['input_sha256']['map'], MAP_SHA)
    bindings['authored_sdr'] = _bind(first['reference_sdr']['path'], first['reference_sdr']['sha256'], AUTHORED_SDR_SHA)
    for name, expected in (('source', iso_source_capacity.SOURCE_SHA), ('base', BASE_SHA), ('map', MAP_SHA)):
        if report['native_candidate']['input_sha256'][name] != expected:
            raise ValueError('Changed native capacity input binding')
    if (report['native_candidate']['output_sha256'] != OUTPUT_SHA
            or not report['preservation_checks'] or not all(report['preservation_checks'].values())):
        raise ValueError('The original coded-layer preservation proof did not pass')
    return cases, bindings


def _samples(path, shape):
    return np.frombuffer(avif.native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', path,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']), np.uint8).reshape(shape)


def check_forward_model(base_nits, codes, metadata, independently_decoded):
    actual = render_codes(base_nits, codes, metadata)
    expected = np.asarray(independently_decoded, dtype=float)
    if expected.shape != (3, 3) or not np.allclose(actual, expected, rtol=0, atol=1e-12):
        raise ValueError('Emitted-code model disagrees with the actual independent decoder')
    return float(np.max(np.abs(actual-expected)))


def run(directory, capacity_report=None):
    """Regenerate native evidence, or validate and read back a supplied report."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    report = iso_source_capacity.run(directory/'capacity') if capacity_report is None else capacity_report
    cases, bindings = _validate_report(report)
    source_hashes = {**report['source_hashes'], **{name: avif.digest(Path(__file__).with_name(name))
        for name in ('iso_map_code_bound.py', 'test_iso_map_code_bound.py', 'gamma_icc.py',
                     'gainmap_sdr.py', 'gainmap.py', 'avif.py')}}
    source, output = Path(bindings['source']['path']), Path(bindings['output']['path'])
    source_facts = gainmap.inspect(source, directory/'source-inspection')
    source_map = directory/'source-inspection/map.jpg'
    bindings['source_extracted_map'] = _bind(source_map, avif.digest(source_map))
    facts = gainmap.inspect(output, directory/'output-inspection')
    metadata = facts['iso_metadata']
    output_map = directory/'output-inspection/map.jpg'
    bindings['extracted_map'] = _bind(output_map, avif.digest(output_map))
    bindings['iso_metadata_sha256'] = _json_hash(metadata)
    for case in cases.values():
        if (case['facts']['iso_metadata'] != metadata
                or case['source_facts']['iso_metadata'] != source_facts['iso_metadata']):
            raise ValueError('Reported metadata differs from the actual source or output')
    if any(metadata[name] != source_facts['iso_metadata'][name]
           for name in ('base_headroom', 'alternate_headroom')):
        raise ValueError('Actual source and output capacities differ')
    for name, raw, packed in (('base', Path(bindings['base']['path']), output),
                              ('map', Path(bindings['compressed_map']['path']), output_map)):
        before = iso_source_capacity.coded_payload(raw.read_bytes())
        after = iso_source_capacity.coded_payload(packed.read_bytes())
        if before != after:
            raise ValueError('Actual compressed coding no longer matches the native supplied layer')
        bindings[name+'_coding_sha256'] = hashlib.sha256(after).hexdigest()
    with Image.open(output) as image:
        icc = image.info['icc_profile']
    with Image.open(bindings['base']['path']) as image:
        if image.info['icc_profile'] != icc:
            raise ValueError('Actual base ICC changed during packing')
    color = profile_facts(icc)
    bindings['icc_sha256'] = hashlib.sha256(icc).hexdigest()
    shape = (1025, 769, 3)
    bindings['native_renderings'] = {}
    refs, native, independent, decoder_facts = {}, {}, {}, {}
    for boost, case in cases.items():
        decoded = decode_iso_source(source.read_bytes(), source_map.read_bytes(),
                                    headroom=int(np.log2(boost)))
        expected, _ = reference(decoded['linear_rgb_nits'], decoded['gamut'], 'p3', 'upscale', 1)
        cached = np.fromfile(bindings['references'][str(boost)]['path'], '<f8').reshape(shape)
        if not np.array_equal(expected, cached):
            raise ValueError('Bound reference differs from fresh independent source reconstruction')
        refs[boost] = expected
        native_path = directory/f'native-boost{boost}.rgbf32'
        native[boost], native_facts = icc_gainmap.native_decode(output, native_path, boost=boost)
        bindings['native_renderings'][str(boost)] = _bind(native_path, avif.digest(native_path))
        independent[boost], independent_facts = icc_gainmap.independent_decode(output, output_map, boost=boost)
        decoder_facts[str(boost)] = {'native': native_facts, 'independent': independent_facts}
        if native[boost].shape != shape or independent[boost].shape != shape:
            raise ValueError('Actual native or independent geometry changed')
    _recheck_bindings(bindings)
    base_codes, map_codes = _samples(output, shape), _samples(output_map, shape)
    native_codes = {}
    for name, path in (('base', output), ('map', output_map)):
        raw = directory/f'native-{name}.rgb8'
        avif.native([icc_gainmap.TOOL, 'jpeg-samples', path, raw])
        native_codes[name] = np.fromfile(raw, np.uint8).reshape(shape)
        bindings[f'native_{name}_samples'] = _bind(raw, avif.digest(raw))
    with Image.open(bindings['authored_sdr']['path']) as image:
        authored = np.asarray(image.convert('RGB'))
    with Image.open(bindings['map_input']['path']) as image:
        pre_jpeg = np.asarray(image.convert('RGB'))
    if authored.shape != shape or pre_jpeg.shape != shape:
        raise ValueError('Authored SDR or pre-JPEG map dimensions changed')
    selected = {}
    for reader, arrays in (('native', native), ('independent', independent)):
        for boost in (2, 16):
            delta = delta_e_itp(refs[boost], arrays[boost], 'p3', 'p3')
            shadow = refs[boost]@RGB_TO_XYZ['p3'][1] <= 10
            y, x = np.unravel_index(np.argmax(np.where(shadow, delta, -np.inf)), delta.shape)
            selected.setdefault((int(y), int(x)), []).append({'reader': reader, 'display_boost': boost,
                                                           'shadow_max_delta_e': float(delta[y, x])})
    records = []
    for (y, x), selection in selected.items():
        expected = np.array([refs[boost][y, x] for boost in BOOSTS])
        if np.any(expected@RGB_TO_XYZ['p3'][1] > 10):
            raise ValueError('Selected pixel is not shadow at every declared boost')
        base = (base_codes[y, x]/255)**np.asarray(color['gammas'])*203
        oracle = np.array([independent[boost][y, x] for boost in BOOSTS])
        agreement = check_forward_model(base, map_codes[y, x], metadata, oracle)
        records.append({'xy': [x, y], 'selected_by': selection, 'boost_order': list(BOOSTS),
            'base_codes': base_codes[y, x].tolist(), 'base_nits': base.tolist(),
            'native_base_codes': native_codes['base'][y, x].tolist(),
            'authored_sdr_srgb_codes': authored[y, x].tolist(),
            'authored_sdr_nits_at_203': sdr_signal_to_nits(authored[y, x]/255, 203).tolist(),
            'pre_jpeg_map_codes': pre_jpeg[y, x].tolist(), 'actual_independent_codes': map_codes[y, x].tolist(),
            'actual_native_codes': native_codes['map'][y, x].tolist(),
            'references_nits': expected.tolist(), 'actual_independent_nits': oracle.tolist(),
            'actual_native_nits': [native[boost][y, x].tolist() for boost in BOOSTS],
            'reference64_delta_e_from_black': float(delta_e_itp(expected[2], np.zeros(3), 'p3', 'p3')),
            'actual_model_error_nits_max': agreement, **minimum_map_error(base, expected, metadata)})
    result = {'schema_version': 1, 'status': 'diagnostic_only',
        'scope': 'A bound for the current decoded base, actual metadata, independent references and per-pixel metric; '
                 'not a conversion qualification or format-wide impossibility claim',
        'objective': 'Minimum over one shared decoded RGB8 map triple of maximum Delta E ITP at boosts2,16,64',
        'selection': 'Union of worst native and independent shadow pixels at boosts2 and16; all selected pixels must be shadow at all3 boosts',
        'arithmetic': 'IEEE754 float64; no formal interval-arithmetic certificate. Parsed actual ICC gamma in its '
                      'own-primary coordinates reproduces the independent decoder; this is not bit-exact native LCMS.',
        'jpeg_coupling': 'Every decoded RGB8 triple is allowed optimistically, ignoring JPEG neighborhood coupling. '
                         'A feasible code does not establish encodability or whole-image qualification.',
        'exclusions': ['Other base pixels or transfers', 'Other gain bounds/gamma/offsets/capacities',
                       'Other geometry or references', 'Higher or continuous decoded map precision',
                       'Regional mean/p95 or physical-display qualification'],
        'fixed_maximum_gate': THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max'],
        'thresholds_sha256': THRESHOLDS_SHA256, 'bindings': bindings, 'icc': color, 'iso_metadata': metadata,
        'validation_checks': {key: True for key in ('source_output_part_hashes', 'actual_iso_metadata',
            'exact_compressed_layers_and_icc', 'fresh_same_boost_source_references', 'actual_native_readback',
            'independent_emitted_code_model_within_1e_12_nits', 'all_selected_regions_shadow')},
        'records': records, 'decoder_facts': decoder_facts, 'commands': avif.COMMANDS[start:],
        'native_binary_sha256': {path: avif.digest(path) for path in
            (icc_gainmap.TOOL, iso_source_capacity.TOOL, shutil.which('ffmpeg'))},
        'capacity_provenance': {'canonical_report_sha256': _json_hash(report),
            'commands': report['commands'], 'native_hashes': report['native_hashes'],
            'native_source_hashes': report['native_source_hashes'],
            'capacity_native_provenance': report['capacity_native_provenance']},
        'source_hashes': source_hashes}
    result['inspection_commands'] = [json.loads(path.read_text()) for folder in
        ('source-inspection', 'output-inspection') for path in sorted((directory/folder).glob('*exiftool.log'))]
    for folder, path in (('source-inspection', source), ('output-inspection', output)):
        result['inspection_commands'].append({'command': ['exiftool', '-b', '-MPImage2', str(path)],
            'exit_code': 0, 'stderr': (directory/folder/'map-extraction.log').read_text(),
            'stdout_sha256': avif.digest(directory/folder/'map.jpg')})
    _recheck_bindings(bindings)
    for name, sha in source_hashes.items():
        _bind(Path(__file__).with_name(name), sha)
    result['validation_checks']['bound_inputs_and_dependencies_unchanged_at_completion'] = True
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
