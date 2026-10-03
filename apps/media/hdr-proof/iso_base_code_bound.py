"""Exhaustive authored-SDR RGB8 base bounds for one serialized ICC profile.

Every decoded base code is allowed optimistically, ignoring JPEG neighborhood
coupling and SDR regional gates. Independently admissible green extrema still
give conflicting shared offsets at the locked positive display weights. This
is a diagnostic about this ICC/depth/model, never a conversion qualification.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

import avif
from appearance import THRESHOLDS, THRESHOLDS_SHA256, linear_rgb_to_itp, sdr_signal_to_nits
from gamma_icc import decode_signal_to_nits, profile_facts
import iso_global_offset_bound as global_bound
import iso_map_code_bound as map_bound

# Refuse a numerical bound if a code is too near the unchanged metric cutoff.
# This does not admit codes above the gate or expand its permitted error.
CLASSIFICATION_DISTANCE_FLOOR = 1e-9


def offset_constraints(green_ranges_nits, hdr_references_nits, weights):
    """Use A's smallest and B's largest admissible green optimistically."""
    green = np.asarray(green_ranges_nits, dtype=float)
    if (green.shape != (2, 2) or not np.all(np.isfinite(green)) or np.any(green < 0)
            or np.any(green[:, 0] > green[:, 1])):
        raise ValueError('Expected two finite nonnegative ordered green ranges')
    # The shared-offset inequality concerns green alone. Independent extrema
    # enlarge the choices; they need not share other RGB codes or JPEG blocks.
    optimistic = np.zeros((2, 3))
    optimistic[:, 1] = [green[0, 0], green[1, 1]]
    result = global_bound.shared_offset_bound(optimistic, hdr_references_nits, weights)
    result['optimistic_own_green_ranges_nits_at203'] = green.tolist()
    return result


def enumerate_base_codes(profile, reference_sdr_nits):
    """Evaluate every RGB8 triple using the actual ICC at nominal 100 nits."""
    expected = np.asarray(reference_sdr_nits, dtype=float)
    if expected.shape != (2, 3) or not np.all(np.isfinite(expected)) or np.any(expected < 0):
        raise ValueError('Expected two finite nonnegative authored SDR P3 references')
    color = profile_facts(profile)
    # Admission uses the same strict actual ICC interpreter as SDR proof.
    decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=3.2, expected_gamut='p3')
    target = linear_rgb_to_itp(expected, 'p3')
    limit = THRESHOLDS['profiles']['gainmap-sdr']['delta_e_max']
    green, blue = np.meshgrid(np.arange(256), np.arange(256), indexing='ij')
    codes = np.empty((256**2, 3), dtype=np.uint8)
    codes[:, 1], codes[:, 2] = green.ravel(), blue.ravel()
    records = [{'admissible_base_codes': 0, 'minimum_green_code': 256, 'maximum_green_code': -1,
        'minimum_green_example_codes': None, 'maximum_green_example_codes': None,
        'nearest_delta_e_to_gate_absolute_difference': float('inf')} for _ in range(2)]
    total = 0
    for red in range(256):
        codes[:, 0] = red
        actual = linear_rgb_to_itp(decode_signal_to_nits(codes.astype(float)/255, profile,
            expected_gamma=3.2, expected_gamut='p3'), 'rec2020')
        total += len(codes)
        for index, row in enumerate(records):
            error = 720*np.linalg.norm(actual-target[index], axis=1)
            gap = float(np.min(np.abs(error-limit)))
            row['nearest_delta_e_to_gate_absolute_difference'] = min(
                row['nearest_delta_e_to_gate_absolute_difference'], gap)
            if gap <= CLASSIFICATION_DISTANCE_FLOOR:
                raise ValueError('A decoded code is too near the unchanged metric cutoff for this numeric bound')
            selected = error <= limit
            count = int(np.count_nonzero(selected))
            row['admissible_base_codes'] += count
            if not count:
                continue
            accepted = codes[selected]
            for direction, code in (('minimum', int(np.min(accepted[:, 1]))),
                                    ('maximum', int(np.max(accepted[:, 1])))):
                changed = (code < row['minimum_green_code'] if direction == 'minimum'
                           else code > row['maximum_green_code'])
                if changed:
                    row[direction+'_green_code'] = code
                    row[direction+'_green_example_codes'] = accepted[
                        np.flatnonzero(accepted[:, 1] == code)[0]].tolist()
    if total != 256**3 or any(row['admissible_base_codes'] == 0 for row in records):
        raise ValueError('Incomplete enumeration or an empty admissible base set')
    for index, row in enumerate(records):
        for direction in ('minimum', 'maximum'):
            code = row[direction+'_green_code']
            row[direction+'_own_green_nits_at203'] = float(203*(code/255)**color['gammas'][1])
            example = np.asarray(row[direction+'_green_example_codes'])
            value = decode_signal_to_nits(example/255, profile, expected_gamma=3.2, expected_gamut='p3')
            row[direction+'_example_delta_e'] = float(720*np.linalg.norm(
                linear_rgb_to_itp(value, 'rec2020')-target[index]))
    return {'enumerated_codes': total, 'records': records,
        'coverage': 'Each R=0..255 crossed with every G,B=0..255 once; all decoded RGB8 triples.',
        'classification_distance_floor': CLASSIFICATION_DISTANCE_FLOOR,
        'classification_policy': 'Codes require Delta E<=the unchanged gate. Refuse evidence if any computed '
            'distance lies within 1e-9 of that cutoff. No metric allowance is added.',
        'arithmetic': 'Float64 exhaustive evaluation, not a formal directed-rounding certificate.'}


def run(directory, map_code_report=None):
    """Re-read locked native/reference evidence, then bound all decoded bases."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    own_hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in
                  ('iso_base_code_bound.py', 'test_iso_base_code_bound.py')}
    # This public runner rechecks cached map/source/native/ICC bindings, runs
    # real native readers, and reconstructs every scalar HDR premise afresh.
    prior = global_bound.run(directory/'global-bound', map_code_report=map_code_report)
    bindings = prior['bindings']
    source_hashes = {**prior['source_hashes'], **own_hashes}
    with Image.open(bindings['output']['path']) as image:
        profile = image.info['icc_profile']
    color = profile_facts(profile)
    if color != prior['icc'] or color['sha256'] != bindings['icc_sha256']:
        raise ValueError('Actual ICC differs from validated native evidence')
    with Image.open(bindings['authored_sdr']['path']) as image:
        if image.size != (769, 1025) or image.mode != 'RGB':
            raise ValueError('Expected the locked matched-geometry RGB8 authored SDR reference')
        codes = np.asarray(image)
    references = {boost: np.memmap(bindings['references'][str(boost)]['path'], dtype='<f8', mode='r',
        shape=(1025, 769, 3)) for boost in map_bound.BOOSTS}
    inputs = []
    for previous, (x, y) in zip(prior['inputs'], global_bound.PIXELS):
        hdr = np.array([references[boost][y, x] for boost in map_bound.BOOSTS])
        if previous['xy'] != [x, y] or not np.array_equal(hdr, previous['references_nits']):
            raise ValueError('Changed actual HDR direction reference inputs')
        inputs.append({'xy': [x, y], 'authored_sdr_codes': codes[y, x].tolist(),
            'authored_sdr_p3_nits_at100': sdr_signal_to_nits(codes[y, x]/255).tolist(),
            'hdr_reference_nits': hdr.tolist(), 'boost_order': list(map_bound.BOOSTS)})
    metadata = prior['iso_metadata']
    weights = np.clip(np.log2(map_bound.BOOSTS)/metadata['alternate_headroom'], 0, 1)
    # Recompute direction premises from those freshly read references. Never
    # inherit a contradiction Boolean or analytic interval from cached JSON.
    refs = [row['hdr_reference_nits'] for row in inputs]
    directions = offset_constraints([[0, 0], [0, 0]], refs, weights)
    if (directions['A_positive_gain_direction_margin_nits'] <= 0
            or directions['B_negative_gain_direction_margin_nits'] <= 0):
        raise ValueError('Both strict HDR gain directions must be established before code enumeration')
    map_bound._recheck_bindings(bindings)
    enumeration = enumerate_base_codes(profile, [row['authored_sdr_p3_nits_at100'] for row in inputs])
    green_ranges = [[row['minimum_own_green_nits_at203'], row['maximum_own_green_nits_at203']]
                    for row in enumeration['records']]
    analytic = offset_constraints(green_ranges, refs, weights)
    result = {'schema_version': 1, 'status': 'diagnostic_only',
        'scope': 'Every decoded RGB8 base under the same actual gamma 3.2 P3 ICC, subject to the unchanged '
            'authored SDR maximum gate at 100 nits. Own-primary HDR values use 203 nits, locked source references '
            'and current strictly positive ordered capacities. One global offset pair per channel; arbitrary '
            'per-pixel gain/map precision. No conversion qualification.',
        'exclusions': ['Other ICC transfers or colorants', 'Continuous or higher-precision decoded bases',
            'Other references, geometry or capacities', 'Zero-weight authored-base bypass',
            'Different gain-map equations', 'Formal native LCMS rounding certificate', 'Physical displays'],
        'optimism': 'Every decoded RGB8 triple is admitted before the SDR maximum check. JPEG neighborhood '
            'coupling and SDR regional mean/p95/luminance limits are omitted, enlarging the admissible set. '
            'Independently favorable green extrema need not belong to simultaneously encodable pixels.',
        'normalization': {'sdr_nominal_white_nits': 100, 'hdr_reference_white_nits': 203},
        'sdr_maximum_gate': THRESHOLDS['profiles']['gainmap-sdr']['delta_e_max'],
        'hdr_maximum_gate': THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max'],
        'thresholds_sha256': THRESHOLDS_SHA256, 'bindings': bindings, 'icc': color,
        'iso_metadata': metadata, 'inputs': inputs, 'enumeration': enumeration, 'analytic_bound': analytic,
        'analytic_construction': prior['analytic_construction'],
        'validation_checks': {name: True for name in ('native_global_inputs_revalidated', 'actual_icc_interpretation',
            'actual_authored_sdr_samples', 'fresh_same_boost_hdr_samples', 'both_strict_hdr_directions',
            'all_rgb8_codes_enumerated', 'classification_away_from_fixed_gate')},
        'commands': avif.COMMANDS[start:], 'source_hashes': source_hashes,
        'native_binary_sha256': prior['native_binary_sha256'],
        'global_bound_provenance': {'canonical_report_sha256': map_bound._json_hash(prior),
            'commands': prior['commands'], 'map_code_provenance': prior['map_code_provenance']}}
    map_bound._recheck_bindings(bindings)
    for name, sha in source_hashes.items():
        map_bound._bind(Path(__file__).with_name(name), sha)
    for path, sha in prior['native_binary_sha256'].items():
        map_bound._bind(path, sha)
    result['validation_checks']['bound_inputs_and_sources_unchanged_at_completion'] = True
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
