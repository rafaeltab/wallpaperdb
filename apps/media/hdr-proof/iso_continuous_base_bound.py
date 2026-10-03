"""Continuous base bounds under the existing SDR and HDR color models.

The SDR metric uses the serialized ICC colorants and chromatic adaptation.
The existing independent HDR comparator uses nominal P3 for own-primary gain
results. Both matrices are explicit. This diagnostic admits all nonnegative
continuous base values, irrespective transfer or coded depth, in that fixed
linear color space. It neither qualifies a conversion nor changes a reference.
"""
import heapq
import json
from pathlib import Path

import numpy as np
from PIL import Image

import avif
from appearance import RGB_TO_XYZ, THRESHOLDS, THRESHOLDS_SHA256, _RGB_TO_LMS, linear_rgb_to_itp, sdr_signal_to_nits
from gamma_icc import profile_facts
import iso_global_offset_bound as global_bound
import iso_map_code_bound as map_bound

NODE_BUDGET = 100000
TARGET_GAP_NITS = .0005
ARITHMETIC_PAD = 1e-12
BALL_REJECTION_GUARD = 1e-15


def component_extremum(reference_nits, rgb_to_xyz, direction, *, fixture_class='gainmap-hdr',
                       node_budget=NODE_BUDGET, target_gap=TARGET_GAP_NITS):
    """Cover the complete metric ball; retain outer bounds when work stops.

    The initial cube covers the ITP ball. Midpoint splits preserve that cover.
    Nearest-box distance may reject a box; retained affine LMS' ranges also
    intersect the whole-ball row-norm support. Monotone PQ inversion and signed
    matrix intervals give outer RGB bounds. Feasible samples supply incumbents
    only. Pruning cannot discard a better value; the heap retains unresolved
    optimistic bounds at either budget or gap termination.
    """
    reference, matrix = np.asarray(reference_nits, dtype=float), np.asarray(rgb_to_xyz, dtype=float)
    if (reference.shape != (3,) or matrix.shape != (3, 3) or np.any(reference < 0)
            or not np.all(np.isfinite(reference)) or not np.all(np.isfinite(matrix))
            or direction not in ('minimum', 'maximum') or fixture_class not in ('gainmap-sdr', 'gainmap-hdr')
            or type(node_budget) is not int or node_budget < 2 or node_budget > 1000000
            or not np.isfinite(target_gap) or target_gap <= 0):
        raise ValueError('Expected finite P3 references/matrix, a supported direction/profile and a bounded search')
    own_to_lms = _RGB_TO_LMS@np.linalg.inv(RGB_TO_XYZ['rec2020'])@matrix
    if np.any(own_to_lms < 0):
        raise ValueError('The own-primary model must preserve the nonnegative LMS domain')
    try:
        inverse = np.linalg.inv(own_to_lms)
    except np.linalg.LinAlgError as error:
        raise ValueError('Singular own-primary color matrix') from error
    limit = THRESHOLDS['profiles'][fixture_class]['delta_e_max']
    radius = limit/720
    center = linear_rgb_to_itp(reference, 'p3')
    affine = global_bound.ITP_TO_LMS_PQ
    center_lms = center@affine.T
    positive_affine, negative_affine = np.maximum(affine, 0), np.minimum(affine, 0)
    positive, negative = np.maximum(inverse, 0), np.minimum(inverse, 0)
    support = radius*np.linalg.norm(affine, axis=1)

    def values(delta):
        return global_bound._inverse_pq((center+delta)@affine.T)@inverse.T

    def enclosure(low, high):
        nearest = np.maximum(low, np.minimum(0, high))
        if nearest@nearest > radius*radius+BALL_REJECTION_GUARD:
            return None
        q_low = np.maximum(center_lms+positive_affine@low+negative_affine@high-ARITHMETIC_PAD,
                           center_lms-support-ARITHMETIC_PAD)
        q_high = np.minimum(center_lms+positive_affine@high+negative_affine@low+ARITHMETIC_PAD,
                            center_lms+support+ARITHMETIC_PAD)
        if np.any(q_high < global_bound.PQ_BLACK):
            return None
        q_low = np.maximum(q_low, global_bound.PQ_BLACK)
        if np.any(q_low > q_high):
            return None
        lms_low = np.maximum(global_bound._inverse_pq(q_low)-ARITHMETIC_PAD, 0)
        lms_high = global_bound._inverse_pq(q_high)+ARITHMETIC_PAD
        rgb_low = positive@lms_low+negative@lms_high-ARITHMETIC_PAD
        rgb_high = positive@lms_high+negative@lms_low+ARITHMETIC_PAD
        if np.any(rgb_high < 0):
            return None
        return np.maximum(rgb_low, 0), rgb_high

    sample_count = 16384
    z = 1-2*(np.arange(sample_count)+.5)/sample_count
    angle = np.arange(sample_count)*np.pi*(3-np.sqrt(5))
    directions = np.stack([np.sqrt(1-z*z)*np.cos(angle), np.sqrt(1-z*z)*np.sin(angle), z], axis=1)
    candidates = np.vstack([np.zeros(3), directions*radius*(1-1e-6)])
    pixels = values(candidates)
    valid = np.all(pixels >= 0, axis=1) & np.all((center+candidates)@affine.T >= global_bound.PQ_BLACK, axis=1)
    sign = 1 if direction == 'minimum' else -1
    objectives = np.where(valid, sign*pixels[:, 1], np.inf)
    selected = int(np.argmin(objectives))
    best, witness = float(objectives[selected]), candidates[selected]
    if not np.isfinite(best):
        raise ValueError('No feasible incumbent in the admitted own-primary domain')
    low, high = np.full(3, -radius), np.full(3, radius)
    initial = enclosure(low, high)
    if initial is None:
        raise ValueError('The full metric ball has no admitted own-primary enclosure')

    def priority(interval):
        return float(interval[0][1] if direction == 'minimum' else -interval[1][1])

    heap = [(priority(initial), 0, low, high)]
    counter = visited = pruned = 0
    while heap and visited+2 <= node_budget:
        if best-heap[0][0] <= target_gap:
            break
        optimistic, _, low, high = heapq.heappop(heap)
        if optimistic >= best:
            pruned += 1
            continue
        axis = int(np.argmax(high-low))
        middle = (low[axis]+high[axis])/2
        for upper_half in (False, True):
            lower, upper = low.copy(), high.copy()
            if upper_half:
                lower[axis] = middle
            else:
                upper[axis] = middle
            visited += 1
            interval = enclosure(lower, upper)
            if interval is None:
                pruned += 1
                continue
            midpoint = (lower+upper)/2
            length = np.linalg.norm(midpoint)
            if length > radius*(1-1e-6):
                midpoint *= radius*(1-1e-6)/length
            pixel = values(midpoint)
            if (np.all(pixel >= 0) and np.all((center+midpoint)@affine.T >= global_bound.PQ_BLACK)
                    and sign*pixel[1] < best):
                best, witness = float(sign*pixel[1]), midpoint
            optimistic = priority(interval)
            if optimistic >= best:
                pruned += 1
                continue
            counter += 1
            heapq.heappush(heap, (optimistic, counter, lower, upper))
    outer = min(best, heap[0][0]) if heap else best
    pixel = values(witness)
    interpreted = pixel@matrix.T@np.linalg.inv(RGB_TO_XYZ['rec2020']).T
    error = float(720*np.linalg.norm(linear_rgb_to_itp(interpreted, 'rec2020')-center))
    if error > limit or np.any(pixel < 0):
        raise ValueError('Final incumbent does not satisfy the unchanged metric and color domain')
    return {'direction': direction, 'fixture_class': fixture_class, 'maximum_delta_e_gate': limit,
        'reference_rgb_nits': reference.tolist(), 'own_rgb_to_xyz': matrix.tolist(),
        'rgb_domain': 'All nonnegative continuous own-primary components; no upper cap',
        'outer_green_nits': outer if direction == 'minimum' else -outer,
        'feasible_green_nits': best if direction == 'minimum' else -best,
        'bound_witness_gap_nits': best-outer, 'witness_own_rgb_nits': pixel.tolist(), 'witness_delta_e': error,
        'visited_child_boxes': visited, 'remaining_boxes': len(heap), 'pruned_boxes': pruned,
        'reached_gap_target': best-outer <= target_gap,
        'budget_exhausted': bool(heap and visited+2 > node_budget and best-outer > target_gap),
        'node_budget': node_budget, 'target_gap_nits': target_gap,
        'initial_outer_rgb_low_nits': initial[0].tolist(), 'initial_outer_rgb_high_nits': initial[1].tolist(),
        'remaining_optimistic_box': {'delta_low': heap[0][2].tolist(), 'delta_high': heap[0][3].tolist(),
            'objective_bound': heap[0][0]} if heap else None,
        'sample_role': 'Feasible incumbents only; no sampled or local-search value supplies the outer bound'}


def run(directory, map_code_report=None):
    """Fresh native readback binds the color model and all scalar premises."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    own_hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in
                  ('iso_continuous_base_bound.py', 'test_iso_continuous_base_bound.py')}
    prior = global_bound.run(directory/'global-bound', map_code_report=map_code_report)
    bindings, source_hashes = prior['bindings'], {**prior['source_hashes'], **own_hashes}
    with Image.open(bindings['output']['path']) as image:
        color = profile_facts(image.info['icc_profile'])
    if color != prior['icc'] or color['sha256'] != bindings['icc_sha256']:
        raise ValueError('Changed actual ICC color model')
    with Image.open(bindings['authored_sdr']['path']) as image:
        if image.size != (769, 1025) or image.mode != 'RGB':
            raise ValueError('Expected the locked authored SDR reference')
        sdr = np.asarray(image)
    references = {boost: np.memmap(bindings['references'][str(boost)]['path'], dtype='<f8', mode='r',
        shape=(1025, 769, 3)) for boost in map_bound.BOOSTS}
    inputs = []
    for previous, (x, y) in zip(prior['inputs'], global_bound.PIXELS):
        hdr = np.array([references[boost][y, x] for boost in map_bound.BOOSTS])
        if previous['xy'] != [x, y] or not np.array_equal(hdr, previous['references_nits']):
            raise ValueError('Changed same-boost HDR reference samples')
        inputs.append({'xy': [x, y], 'authored_sdr_codes': sdr[y, x].tolist(),
            'authored_sdr_p3_nits_at100': sdr_signal_to_nits(sdr[y, x]/255).tolist(),
            'hdr_reference_nits': hdr.tolist(), 'boost_order': list(map_bound.BOOSTS)})
    weights = np.clip(np.log2(map_bound.BOOSTS)/prior['iso_metadata']['alternate_headroom'], 0, 1)
    directions = global_bound.shared_offset_bound(np.zeros((2, 3)),
        [row['hdr_reference_nits'] for row in inputs], weights)
    if (directions['A_positive_gain_direction_margin_nits'] <= 0
            or directions['B_negative_gain_direction_margin_nits'] <= 0):
        raise ValueError('Both strict HDR direction premises are required')
    serialized, nominal = np.asarray(color['rgb_to_xyz_d65']), RGB_TO_XYZ['p3']
    queries = [('sdr_A_min', inputs[0]['authored_sdr_p3_nits_at100'], serialized, 'minimum', 'gainmap-sdr'),
        ('sdr_B_max', inputs[1]['authored_sdr_p3_nits_at100'], serialized, 'maximum', 'gainmap-sdr'),
        ('hdr_A64_max', inputs[0]['hdr_reference_nits'][2], nominal, 'maximum', 'gainmap-hdr'),
        ('hdr_B2_min', inputs[1]['hdr_reference_nits'][0], nominal, 'minimum', 'gainmap-hdr')]
    map_bound._recheck_bindings(bindings)
    extrema = {name: component_extremum(reference, matrix, direction, fixture_class=fixture_class)
               for name, reference, matrix, direction, fixture_class in queries}
    upper = extrema['hdr_A64_max']['outer_green_nits']-2.03*extrema['sdr_A_min']['outer_green_nits']
    lower = extrema['hdr_B2_min']['outer_green_nits']-2.03*extrema['sdr_B_max']['outer_green_nits']
    result = {'schema_version': 1, 'status': 'diagnostic_only',
        'scope': 'All nonnegative continuous own-primary bases under the fixed serialized SDR ICC colorants '
            'and current nominal-P3 HDR comparison model. Same references/geometry, unchanged gates and '
            'strictly positive ordered source-capacity weights. One global nonnegative offset pair per channel and '
            'arbitrary per-pixel gain/map precision. No conversion qualification.',
        'exclusions': ['Other SDR colorants or color-space conversions', 'A different HDR color-management model',
            'Other source references or geometry', 'Other capacities or zero-weight bypass',
            'Different gain-map equations', 'Formal native LCMS rounding certificate', 'Physical displays'],
        'metric_matrices': {'serialized_sdr_rgb_to_xyz': serialized.tolist(),
            'nominal_hdr_rgb_to_xyz': nominal.tolist(),
            'interpretation': 'SDR uses actual ICC colorants with chad inversion. HDR uses the existing independent '
                'decoder own-primary channels and the nominal P3 matrix in appearance.py. These matrices are '
                'not asserted identical. The bound follows both existing gates exactly; it excludes another '
                'interpretation of HDR ICC matrix rounding and does not claim bit-exact native LCMS.'},
        'normalization': {'sdr_nominal_white_nits': 100, 'hdr_reference_white_nits': 203},
        'sdr_maximum_gate': THRESHOLDS['profiles']['gainmap-sdr']['delta_e_max'],
        'hdr_maximum_gate': THRESHOLDS['profiles']['gainmap-hdr']['delta_e_max'],
        'thresholds_sha256': THRESHOLDS_SHA256, 'bindings': bindings, 'icc': color,
        'iso_metadata': prior['iso_metadata'], 'inputs': inputs, 'extrema': extrema,
        'analytic_bound': {'weights': weights.tolist(),
            'A_positive_gain_direction_margin_nits': directions['A_positive_gain_direction_margin_nits'],
            'B_negative_gain_direction_margin_nits': directions['B_negative_gain_direction_margin_nits'],
            'D_lower_bound_nits': lower, 'D_upper_bound_nits': upper, 'contradiction_margin_nits': lower-upper,
            'contradiction_established': bool(lower > upper)},
        'analytic_construction': {'coverage': 'The complete ITP ball lies in the initial cube. Binary splits '
            'retain coverage; conservative ball/physical-domain rejection and objective bounds may prune. '
            'The unresolved heap bound remains authoritative at the node budget or target gap.',
            'intervals': 'Affine LMS ranges intersect whole-ball row-norm support; monotone PQ inversion and '
                'signed RGB matrix intervals give outer component bounds.',
            'offset_argument': 'The strict increasing A curve requires D<A64-B_A. The strict decreasing '
                'positive B curve requires D>=B2-B_B. Use the most favorable continuous SDR base extrema '
                'and HDR metric-ball component extrema; disjoint D bounds give the contradiction.',
            'gain_equation': 'F(w)=max((B+203*Os)*2**(L*w)-203*Oh,0), with B>=0, Os>=0, Oh>=0, '
                'and D=203*(Os-Oh). Shared offsets are nonnegative as required by the validated native metadata.',
            'arithmetic': 'Float64 with outward guards, not a formal directed-rounding certificate. '
                'Arithmetic enclosures expand; the metric gate is unchanged.',
            'arithmetic_pad': ARITHMETIC_PAD, 'squared_ball_rejection_guard': BALL_REJECTION_GUARD,
            'node_budget_per_extremum': NODE_BUDGET, 'target_gap_nits': TARGET_GAP_NITS,
            'optimism': 'All continuous nonnegative base values and gains are admitted. Coded depth, transfer, '
                'JPEG coupling and regional mean/p95/luminance gates impose no additional restriction here.'},
        'validation_checks': {name: True for name in ('native_global_inputs_revalidated', 'actual_serialized_icc_matrix',
            'fresh_authored_sdr_and_hdr_scalar_inputs', 'both_strict_hdr_directions', 'continuous_unbounded_base_domain',
            'actual_feasible_incumbents', 'unresolved_boxes_retain_outer_bounds')},
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
