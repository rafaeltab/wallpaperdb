"""Conservative shared-offset bounds for one fixed decoded P3 base.

The analytic construction encloses the unchanged Delta E ITP ball in component
intervals. Two pixels require conflicting values of the same green-channel
offset difference. This is diagnostic evidence under positive ordered display
weights, not a conversion qualification or a claim about other bases/models.
"""
import copy
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_sdr
import iso_map_code_bound as map_bound
from appearance import (RGB_TO_XYZ, THRESHOLDS, THRESHOLDS_SHA256, _LMS_P_TO_ITP, _RGB_TO_LMS,
                        delta_e_itp, linear_rgb_to_itp)
from gamma_icc import profile_facts

ARITHMETIC_PAD = 1e-12
ITP_TO_LMS_PQ = np.linalg.inv(_LMS_P_TO_ITP)
P3_TO_LMS = _RGB_TO_LMS@np.linalg.inv(RGB_TO_XYZ['rec2020'])@RGB_TO_XYZ['p3']
LMS_TO_P3 = np.linalg.inv(P3_TO_LMS)
PQ_BLACK = (3424/4096)**(2523/32)
PIXELS = ((236, 822), (242, 640))


def _inverse_pq(values):
    values = np.asarray(values, dtype=float)
    if not np.all(np.isfinite(values)):
        raise ValueError('PQ coordinates must be finite')
    powered = np.maximum(values, PQ_BLACK)**(32/2523)
    denominator = 2413/128-(2392/128)*powered
    if np.any(denominator <= 0):
        raise ValueError('PQ interval reaches the inverse pole')
    return 10000*(np.maximum(powered-3424/4096, 0)/denominator)**(16384/2610)


def itp_to_p3(values):
    """Inverse metric coordinates for numerical controls, with absolute nits."""
    values = np.asarray(values, dtype=float)
    if values.ndim < 1 or values.shape[-1] != 3 or not np.all(np.isfinite(values)):
        raise ValueError('Expected finite ITP triples')
    return _inverse_pq(values@ITP_TO_LMS_PQ.T)@LMS_TO_P3.T


def component_bounds(reference_nits):
    """Analytic outer enclosure, evaluated with guarded float64 arithmetic.

    Linear Cauchy-Schwarz support bounds each inverse-ITP coordinate. PQ is
    monotone on the checked inverse domain. Signed matrix interval propagation
    then encloses P3 RGB. Intersect only the native nonnegative RGB domain.
    Independent coordinate extrema need not coexist, so this is optimistic.
    """
    reference_nits = np.asarray(reference_nits, dtype=float)
    if (reference_nits.shape != (3,) or not np.all(np.isfinite(reference_nits))
            or np.any(reference_nits < 0)):
        raise ValueError('Expected finite nonnegative P3 RGB nits')
    limit = THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max']
    radius = limit/720
    center = linear_rgb_to_itp(reference_nits, 'p3')@ITP_TO_LMS_PQ.T
    coordinate_radius = radius*np.linalg.norm(ITP_TO_LMS_PQ, axis=1)
    low = np.maximum(center-coordinate_radius-ARITHMETIC_PAD, PQ_BLACK)
    high = center+coordinate_radius+ARITHMETIC_PAD
    lms_low = np.maximum(_inverse_pq(low)-ARITHMETIC_PAD, 0)
    lms_high = _inverse_pq(high)+ARITHMETIC_PAD
    positive, negative = np.maximum(LMS_TO_P3, 0), np.minimum(LMS_TO_P3, 0)
    rgb_low = np.maximum(positive@lms_low+negative@lms_high-ARITHMETIC_PAD, 0)
    rgb_high = positive@lms_high+negative@lms_low+ARITHMETIC_PAD
    return {'delta_e_gate': limit, 'itp_ball_radius': radius,
        'lms_pq_center': center.tolist(), 'lms_pq_radius': coordinate_radius.tolist(),
        'lms_nits_low': lms_low.tolist(), 'lms_nits_high': lms_high.tolist(),
        'rgb_nits_low': rgb_low.tolist(), 'rgb_nits_high': rgb_high.tolist()}


def shared_offset_bound(base_nits, reference_nits, weights):
    """Enclose the two-pixel green offset constraints at positive weights.

    For any per-pixel log gain L and global nonnegative offsets, the positive-
    weight curve is max((B+203*Os)*2**(L*w)-203*Oh, 0). Strict increasing
    samples force L>0; strict decreasing positive samples force L<0. The
    authored-base bypass at weight0 is deliberately outside this argument.
    """
    bases, refs, weights = (np.asarray(value, dtype=float) for value in (base_nits, reference_nits, weights))
    if (bases.shape != (2, 3) or refs.shape != (2, 3, 3) or weights.shape != (3,)
            or not all(np.all(np.isfinite(value)) for value in (bases, refs, weights))
            or np.any(bases < 0) or np.any(refs < 0)
            or not 0 < weights[0] < weights[1] < weights[2] <= 1):
        raise ValueError('Expected two finite nonnegative bases/references and strictly ordered positive weights')
    intervals = [[component_bounds(sample) for sample in pixel] for pixel in refs]
    a, b = intervals
    a_direction = a[2]['rgb_nits_low'][1]-a[1]['rgb_nits_high'][1]
    b_direction = b[0]['rgb_nits_low'][1]-b[2]['rgb_nits_high'][1]
    # D is measured in nits:203*(Os-Oh). A's increasing curve requires D
    # below this upper bound. B's decreasing positive curve requires D above
    # its lower bound. No claim follows unless both strict signs are forced.
    upper = a[2]['rgb_nits_high'][1]-bases[0, 1]
    lower = b[0]['rgb_nits_low'][1]-bases[1, 1]
    return {'intervals': intervals, 'weights': weights.tolist(),
        'A_positive_gain_direction_margin_nits': a_direction,
        'B_negative_gain_direction_margin_nits': b_direction,
        'D_upper_bound_nits': upper, 'D_lower_bound_nits': lower,
        'B2_implied_upper_nits': bases[1, 1]+upper,
        'B2_required_lower_nits': b[0]['rgb_nits_low'][1],
        'contradiction_margin_nits': lower-upper,
        'contradiction_established': bool(a_direction > 0 and b_direction > 0 and lower > upper)}


def _numeric_controls(records):
    """Implementation checks do not supply the analytic enclosure argument."""
    controls = np.array([[0]*3, [.01]*3, [1]*3, [203]*3, [1000]*3,
                         [0, .16628398001194, 0], [3.672389030456543, 3.1140284538269043, .5423629879951477]])
    roundtrip = itp_to_p3(linear_rgb_to_itp(controls, 'p3'))
    roundtrip_error = float(np.max(np.abs(roundtrip-controls)))
    rng, rows = np.random.default_rng(21496), []
    radius = THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max']/720
    for record in records:
        for boost, sample in zip(map_bound.BOOSTS, record['references_nits']):
            target = np.asarray(sample)
            center = linear_rgb_to_itp(target, 'p3')
            enclosure = component_bounds(target)
            support_error = 0.0
            for row in ITP_TO_LMS_PQ:
                norm = np.linalg.norm(row)
                direction = radius*row/norm
                nominal = center@row
                support_error = max(support_error, abs((center+direction)@row-(nominal+radius*norm)),
                                    abs((center-direction)@row-(nominal-radius*norm)))
            directions = rng.normal(size=(30000, 3))
            directions /= np.linalg.norm(directions, axis=1)[:, None]
            points = center+directions*radius*rng.random((30000, 1))**(1/3)
            points = points[np.all(points@ITP_TO_LMS_PQ.T >= PQ_BLACK, axis=1)]
            rgb = itp_to_p3(points)
            rgb = rgb[np.all(rgb >= 0, axis=1)]
            if not len(rgb):
                raise ValueError('Numerical enclosure control has no physical samples')
            delta = delta_e_itp(np.broadcast_to(target, rgb.shape), rgb, 'p3', 'p3')
            enclosed = bool(np.all(rgb >= enclosure['rgb_nits_low']) and np.all(rgb <= enclosure['rgb_nits_high']))
            rows.append({'xy': record['xy'], 'display_boost': boost, 'attempted_ball_samples': 30000,
                'physical_nonnegative_samples': len(rgb), 'maximum_delta_e': float(np.max(delta)),
                'linear_support_error': float(support_error), 'all_samples_enclosed': enclosed})
    passed = roundtrip_error < 1e-8 and all(row['all_samples_enclosed'] and row['linear_support_error'] < 1e-15
        and row['maximum_delta_e'] <= THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max'] for row in rows)
    return {'role': 'Implementation sanity checks only; not the enclosure proof', 'passed': bool(passed),
        'roundtrip_max_rgb_nits_error': roundtrip_error, 'rng_seed': 21496, 'rows': rows}


def _validate_cached(report):
    try:
        return _validate_cached_fields(report)
    except (KeyError, TypeError, AttributeError, IndexError) as error:
        raise ValueError('Incomplete or malformed fixed-map diagnostic bindings') from error


def _validate_cached_fields(report):
    required_sources = set(map_bound.REQUIRED_DEPENDENCIES) | {
        'iso_map_code_bound.py', 'gamma_icc.py', 'gainmap_sdr.py', 'gainmap.py', 'avif.py'}
    required_bindings = {'source', 'output', 'base', 'compressed_map', 'map_input', 'authored_sdr',
        'thresholds', 'references', 'source_extracted_map', 'extracted_map', 'icc_sha256',
        'iso_metadata_sha256', 'base_coding_sha256', 'map_coding_sha256', 'native_renderings',
        'native_base_samples', 'native_map_samples'}
    required_native = {map_bound.icc_gainmap.TOOL, map_bound.iso_source_capacity.TOOL, shutil.which('ffmpeg')}
    if (report['status'] != 'diagnostic_only' or report['thresholds_sha256'] != THRESHOLDS_SHA256
            or report['fixed_maximum_gate'] != THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max']
            or not required_sources.issubset(report['source_hashes'])
            or not required_bindings.issubset(report['bindings'])
            or not required_native.issubset(report['native_binary_sha256'])
            or set(report['bindings']['references']) != {'2', '16', '64'}
            or set(report['bindings']['native_renderings']) != {'2', '16', '64'}):
        raise ValueError('Incomplete or changed fixed-map diagnostic bindings')
    bindings = copy.deepcopy(report['bindings'])
    for name in ('source', 'output', 'base', 'compressed_map', 'map_input', 'authored_sdr', 'thresholds',
                 'source_extracted_map', 'extracted_map', 'native_base_samples', 'native_map_samples'):
        if not {'path', 'sha256'}.issubset(bindings[name]):
            raise ValueError('Missing native diagnostic file binding')
    for group in ('references', 'native_renderings'):
        if not all({'path', 'sha256'}.issubset(value) for value in bindings[group].values()):
            raise ValueError('Missing rendering/reference file binding')
    map_bound._recheck_bindings(bindings)
    for name, sha in report['source_hashes'].items():
        map_bound._bind(Path(__file__).with_name(name), sha)
    for path, sha in report['native_binary_sha256'].items():
        map_bound._bind(path, sha)
    for name, path in (('native_hashes', '/opt/proof/icc-gainmap/binary-sha256.txt'),
                       ('native_source_hashes', '/opt/proof/icc-gainmap/source-sha256.txt'),
                       ('capacity_native_provenance', '/opt/proof/gainmap-capacity/provenance-sha256.txt')):
        if report['capacity_provenance'][name] != Path(path).read_text():
            raise ValueError('Cached native provenance differs from the current pinned environment')
    locks = {'source': map_bound.iso_source_capacity.SOURCE_SHA, 'output': map_bound.OUTPUT_SHA,
        'base': map_bound.BASE_SHA, 'compressed_map': map_bound.MAP_SHA,
        'map_input': map_bound.MAP_INPUT_SHA, 'authored_sdr': map_bound.AUTHORED_SDR_SHA,
        'thresholds': THRESHOLDS_SHA256}
    for name, sha in locks.items():
        if bindings[name]['sha256'] != sha:
            raise ValueError('Changed fixed diagnostic input hash')
    for boost, sha in map_bound.REFERENCE_SHA.items():
        if bindings['references'][str(boost)]['sha256'] != sha:
            raise ValueError('Changed independent same-boost reference hash')
    records = {tuple(row['xy']): row for row in report['records']}
    if len(report['records']) != 2 or set(records) != set(PIXELS):
        raise ValueError('Only the two predeclared fixed-base shadow pixels are admitted')
    if not all({'boost_order', 'base_codes', 'base_nits', 'references_nits'}.issubset(row)
               for row in records.values()):
        raise ValueError('Missing cached scalar input fields')
    for name in ('iso_metadata', 'icc', 'commands', 'capacity_provenance'):
        if name not in report:
            raise ValueError('Missing cached input interpretation/provenance')
    return bindings, records


def run(directory, map_code_report=None):
    """Re-read native base/metadata and bound references before any inference."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    prior = map_bound.run(directory/'map-code-bound') if map_code_report is None else map_code_report
    bindings, cached = _validate_cached(prior)
    source_hashes = {**prior['source_hashes'], **{name: avif.digest(Path(__file__).with_name(name))
        for name in ('iso_global_offset_bound.py', 'test_iso_global_offset_bound.py')}}
    source, output = (Path(bindings[name]['path']) for name in ('source', 'output'))
    source_facts = gainmap.inspect(source, directory/'source-inspection')
    output_facts = gainmap.inspect(output, directory/'output-inspection')
    for name, folder in (('source_extracted_map', 'source-inspection'), ('extracted_map', 'output-inspection')):
        path = directory/folder/'map.jpg'
        if avif.digest(path) != bindings[name]['sha256']:
            raise ValueError('Fresh native extraction differs from the bound map')
        bindings['fresh_'+name] = map_bound._bind(path, avif.digest(path))
    for name, raw, packed in (('base', Path(bindings['base']['path']), output),
                              ('map', Path(bindings['compressed_map']['path']), directory/'output-inspection/map.jpg')):
        before = map_bound.iso_source_capacity.coded_payload(raw.read_bytes())
        after = map_bound.iso_source_capacity.coded_payload(packed.read_bytes())
        if before != after or hashlib.sha256(after).hexdigest() != bindings[name+'_coding_sha256']:
            raise ValueError('Actual compressed coding differs from the bound native layer')
    metadata = output_facts['iso_metadata']
    if (metadata != prior['iso_metadata'] or map_bound._json_hash(metadata) != bindings['iso_metadata_sha256']
            or metadata['base_headroom'] != 0 or metadata['backward'] or not metadata['use_base_colour_space']
            or any(metadata[key] != source_facts['iso_metadata'][key] for key in ('base_headroom', 'alternate_headroom'))):
        raise ValueError('Actual source-preserving metadata differs from the bound model')
    weights = np.clip(np.log2(map_bound.BOOSTS)/metadata['alternate_headroom'], 0, 1)
    if not 0 < weights[0] < weights[1] < weights[2] <= 1:
        raise ValueError('The fixed positive ordered rendering weights are not established')
    with Image.open(output) as image:
        icc = image.info['icc_profile']
    with Image.open(bindings['base']['path']) as image:
        if image.info['icc_profile'] != icc:
            raise ValueError('Actual packed/base ICC bytes disagree')
    if hashlib.sha256(icc).hexdigest() != bindings['icc_sha256'] or profile_facts(icc) != prior['icc']:
        raise ValueError('Changed actual ICC interpretation')
    signal, decoder_facts = gainmap_sdr.decode(output, gamut='p3', gamma=3.2)
    color = profile_facts(icc)
    if signal.shape != (1025, 769, 3) or decoder_facts['sof'] != 0:
        raise ValueError('Changed baseline decoded base geometry')
    references = {boost: np.memmap(bindings['references'][str(boost)]['path'], dtype='<f8', mode='r',
                                  shape=(1025, 769, 3)) for boost in map_bound.BOOSTS}
    records = []
    for x, y in PIXELS:
        codes = np.rint(signal[y, x]*255).astype(int)
        base = signal[y, x]**np.asarray(color['gammas'])*203
        refs = np.array([references[boost][y, x] for boost in map_bound.BOOSTS])
        previous = cached[(x, y)]
        if (previous['boost_order'] != list(map_bound.BOOSTS)
                or not np.array_equal(codes, previous['base_codes'])
                or not np.array_equal(base, previous['base_nits'])
                or not np.array_equal(refs, previous['references_nits'])):
            raise ValueError('Cached scalar input differs from freshly read bound samples')
        if not np.all(np.isfinite(refs)) or np.any(refs < 0) or np.any(refs@RGB_TO_XYZ['p3'][1] > 10):
            raise ValueError('Every declared reference must remain a finite nonnegative shadow sample')
        records.append({'xy': [x, y], 'base_codes': codes.tolist(), 'base_nits': base.tolist(),
                        'references_nits': refs.tolist(), 'boost_order': list(map_bound.BOOSTS)})
    map_bound._recheck_bindings(bindings)
    analytic = shared_offset_bound([row['base_nits'] for row in records],
                                   [row['references_nits'] for row in records], weights)
    controls = _numeric_controls(records)
    if not controls['passed']:
        raise ValueError('Numerical enclosure controls failed')
    result = {'schema_version': 1, 'status': 'diagnostic_only',
        'scope': 'Fixed decoded own-P3 gamma3.2 base, unchanged source references and existing strictly positive '
                 'ordered source-capacity weights. One global nonnegative offset pair per channel; arbitrary '
                 'per-pixel gain and map precision. No conversion qualification.',
        'exclusions': ['Other decoded bases or ICC interpretation', 'Other source references or geometry',
                       'Arbitrary capacities or zero-weight authored-base bypass', 'Different gain-map equations',
                       'Formal native LCMS rounding certificate', 'Physical-display qualification'],
        'analytic_construction': {'method': 'Cauchy-Schwarz linear support of the unchanged Euclidean ITP ball; '
            'monotone PQ inverse; signed inverse-LMS matrix interval propagation; native nonnegative RGB intersection.',
            'T_scaling': 'The appearance matrix already uses T=Ct/2; no additional half-scaling.',
            'equation': 'For positive weights, F(w)=max((B+203*Os)*2**(L*w)-203*Oh,0), D=203*(Os-Oh).',
            'argument': 'A64 lower>A16 upper forces L_A>0, so D<A64 upper-B_A. B2 lower>B64 upper '
                'forces L_B<0; positive B2 requires D>=B2 lower-B_B. Disjoint D bounds give the contradiction.',
            'optimism': 'Coordinate interval extrema need not coexist. Enlarging the admissible RGB sets makes '
                'the contradiction conservative; no optimizer or sampled minimum supplies these bounds.',
            'arithmetic': 'Float64 with 1e-12 outward guards at mapped boundaries. Guards expand arithmetic '
                'enclosures, not the Delta E gate. This is not a formal directed-rounding interval certificate.',
            'arithmetic_guard': ARITHMETIC_PAD, 'inverse_ITP_matrix': ITP_TO_LMS_PQ.tolist(),
            'P3_to_LMS_matrix': P3_TO_LMS.tolist(), 'inverse_LMS_to_P3_matrix': LMS_TO_P3.tolist()},
        'fixed_maximum_gate': THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max'],
        'thresholds_sha256': THRESHOLDS_SHA256, 'bindings': bindings, 'inputs': records,
        'icc': color, 'iso_metadata': metadata, 'base_decoder_facts': decoder_facts,
        'analytic_bound': analytic, 'numeric_controls': controls,
        'validation_checks': {name: True for name in ('critical_hashes', 'fresh_native_extraction',
            'actual_compressed_layers', 'actual_source_preserving_metadata', 'actual_icc_and_base_samples', 'recomputed_scalar_references',
            'positive_ordered_current_weights', 'all_reference_samples_shadow', 'numeric_controls')},
        'commands': avif.COMMANDS[start:], 'native_binary_sha256': prior['native_binary_sha256'],
        'map_code_provenance': {'canonical_report_sha256': map_bound._json_hash(prior),
            'commands': prior['commands'], 'capacity_provenance': prior['capacity_provenance']},
        'source_hashes': source_hashes}
    result['inspection_commands'] = []
    for folder, path in (('source-inspection', source), ('output-inspection', output)):
        result['inspection_commands'].extend(json.loads(log.read_text())
            for log in sorted((directory/folder).glob('*exiftool.log')))
        result['inspection_commands'].append({'command': ['exiftool', '-b', '-MPImage2', str(path)],
            'exit_code': 0, 'stderr': (directory/folder/'map-extraction.log').read_text(),
            'stdout_sha256': avif.digest(directory/folder/'map.jpg')})
    map_bound._recheck_bindings(bindings)
    for name, sha in source_hashes.items():
        map_bound._bind(Path(__file__).with_name(name), sha)
    for path, sha in prior['native_binary_sha256'].items():
        map_bound._bind(path, sha)
    result['validation_checks']['bound_inputs_and_sources_unchanged_at_completion'] = True
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
