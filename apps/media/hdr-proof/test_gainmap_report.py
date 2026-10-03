"""Report aggregation does not change conversion qualification."""
from copy import deepcopy
import unittest

import numpy as np

from appearance import compare_appearance

from suite import (coefficient_diagnostic_report, gainmap_candidate_report,
                   jpegli_experiment_report, mozjpeg_experiment_report, product_coverage_report)
from matrix import CHECKS, GAINMAP_GEOMETRIES, build_matrix


def measurement(mean, maximum, luminance):
    return {'regions': {'shadow': {'samples': 10,
        'delta_e_itp': {'mean': mean, 'maximum': maximum},
        'luminance_absolute_error_nits': {'mean': luminance}},
        'highlight': {'samples': 0, 'delta_e_itp': {'mean': 999, 'maximum': 999}}}}


class MozjpegReportTests(unittest.TestCase):
    def test_coefficient_report_preserves_best_profile_and_remaining_dc_failures(self):
        rendered = '\n'.join(coefficient_diagnostic_report({'cases': [{
            'fixture_id': 'source', 'geometry': 'upscale', 'native_geometry_measurement': {'passed': True},
            'profiles': [{'worst_pixel': {'delta_e_itp': error},
                          'unchanged_dc_blocks': {'failing_pixel_count': pixels}}
                         for error, pixels in ((26, 235), (25, 140))]}]}))
        self.assertIn('| `source` | upscale | 2 | True | 25.0000 | 140 |', rendered)
        self.assertIn('cannot qualify a converter or physical consumer', rendered)
        self.assertIn('is an inference', rendered)

    def test_base_report_keeps_decoder_failures_separate_from_appearance(self):
        valid = {'status': 'qualified', 'measurement': {'passed': True}}
        measured = {'status': 'tested and failed', 'measurement': {'passed': False}}
        concealed = {'status': 'tested and failed', 'facts': {'decoder_diagnostics': [
            {'exit_code': 0, 'stderr': 'overread'}]}}
        rendered = '\n'.join(mozjpeg_experiment_report({'cases': [valid, measured]},
                                                       {'cases': [concealed, measured]},
                                                       {'cases': [measured]}))
        self.assertIn('| Optimized Huffman | 2 | 1 | 1 | 0 |', rendered)
        self.assertIn('| Retained standard Huffman | 2 | 0 | 1 | 1 |', rendered)
        self.assertIn('| Bounded trellis precision | 1 | 0 | 1 | 0 |', rendered)
        self.assertIn('excluded from the conversion-attempt counts', rendered)
        self.assertIn('pending manual review', rendered)


def native_case(candidate, geometry, qualified):
    return {'fixture_id': 'gainmap-android-iso', 'source_sha256': 'a' * 64,
            'candidate': f'native-combine-{candidate}', 'geometry': geometry,
            'source_reference_revision': 'reference-v1',
            'selectors': {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
                          'motion': 'preserve', 'transparency': 'preserve', **GAINMAP_GEOMETRIES[geometry]},
            'facts': {'base': {'sof': 0}, 'map': {'sof': 0}},
            'status': 'qualified' if qualified else 'tested and failed',
            'checks': {key: qualified or key != 'appearance' for key in CHECKS},
            'measurements': {}, 'blockers': []}


class GainMapReportTests(unittest.TestCase):
    def test_optional_gainmap_report_keeps_failed_tone_and_exact_renderings(self):
        from suite import optional_gainmap_report
        case = {'proof_module': 'static_avif_hdr_jpeg', 'fixture_id': 'pq8',
            'selectors': {'format': 'jpg'}, 'rendering_scope': {'display_boost': 16},
            'artifacts': {'sha256': 'a'*64}, 'status': 'tested and failed',
            'measurements': {'sdr': measurement(.1, 1.2, .2),
                'independent_hdr': measurement(.2, 2.3, .4), 'native_hdr': measurement(.3, 3.4, .5),
                'encoded_sdr_tone': {'passed': False, 'failures': ['highlight_flattening']}}}
        identity = {**case, 'proof_module': 'xmp_identity_avif', 'fixture_id': 'xmp',
            'selectors': {'format': 'avif'}, 'rendering_scope': {'display_boost': 2},
            'status': 'qualified', 'measurements': {key: value for key, value in case['measurements'].items()
                                                  if key != 'encoded_sdr_tone'}}
        missing = {**case, 'measurements': {}, 'artifacts': {}}
        rendered = '\n'.join(optional_gainmap_report([case, identity, missing]))
        self.assertIn('| pq8 | jpg | 16 | 1.200000 | 2.300000 | 3.400000 | failed: highlight_flattening | `aaaaaaaaaaaa` | tested and failed |', rendered)
        self.assertIn('| xmp | avif | 2 | 1.200000 | 2.300000 | 3.400000 | authored SDR |', rendered)
        self.assertIn('| missing | missing | missing | missing | missing | tested and failed |', rendered)
        self.assertIn('pending manual review', rendered)
        self.assertIn('does not qualify resized adaptation', rendered)
        self.assertEqual(optional_gainmap_report([]), [])

    def test_precision_tradeoff_report_preserves_positive_errors_without_requalifying(self):
        from suite import apple_precision_tradeoffs
        case = {'proof_module': 'apple_hdr_avif_precision', 'geometry': 'contain',
            'selectors': {'depth': '8'}, 'status': 'qualified',
            'regional_change_from_baseline': {'regions': {'shadow': {'samples': 10,
                'delta_e_itp': {'mean': -.1, 'p95': -.2, 'maximum': .038191},
                'luminance_absolute_error_nits': {'mean': .003, 'p95': -.01, 'maximum': 0}}}}}
        unchanged = {**case, 'selectors': {'depth': '12'},
                     'regional_change_from_baseline': {'regions': {'shadow': {'samples': 10,
                         'delta_e_itp': {'mean': -.1, 'p95': -.2, 'maximum': -.3}}}}}
        rendered = '\n'.join(apple_precision_tradeoffs([case, unchanged]))
        self.assertIn('| contain | 8 | shadow | delta_e_itp | maximum | +0.038191000 | qualified |', rendered)
        self.assertIn('| contain | 8 | shadow | luminance_absolute_error_nits | mean | +0.003000000 | qualified |', rendered)
        self.assertIn('| contain | 12 | none | none | none | 0 | qualified |', rendered)
        self.assertNotIn('-0.100000000', rendered)
        self.assertIn('unchanged appearance gates decide qualification', rendered)
        self.assertIn('not a universal improvement', rendered)
        self.assertEqual(apple_precision_tradeoffs([]), [])

    def test_png8_report_distinguishes_requested_depth_from_encoder_precision(self):
        from suite import apple_precision_tradeoffs
        case = {'proof_module': 'apple_hdr_png8', 'geometry': 'contain',
            'selectors': {'depth': '8'}, 'status': 'qualified',
            'regional_change_from_depth16': {'regions': {'shadow': {'samples': 10,
                'delta_e_itp': {'mean': .1, 'p95': .2, 'maximum': 2.6}}}}}
        rendered = '\n'.join(apple_precision_tradeoffs([case]))
        self.assertIn('## Requested PNG8 depth tradeoffs', rendered)
        self.assertIn('different requested depth', rendered)
        self.assertIn('| contain | 8 | shadow | delta_e_itp | maximum | +2.600000000 | qualified |', rendered)
        self.assertNotIn('## Measured AVIF precision tradeoffs', rendered)

    def test_capacity_report_keeps_zero_weight_models_and_native_admission_separate(self):
        from suite import iso_capacity_report
        diagnostic = {'constraints': {'authored_base_bypass_model_excluded': True,
            'offset_at_zero_model_excluded': True, 'zero_weight_bypass_separation_nits': 2.4672534196,
            'shared_offset_separation_nits': 1.1922884980}, 'native_controls': {'records': [
                {'base_headroom_log2': 0, 'renderings': [{'display_boost': 1,
                    'libavif': {'minimum_nits': 203.046064},
                    'ultrahdr_precise': {'minimum_nits': 228.375},
                    'icc_native_and_independent': {'native_minimum_nits': 203}}]},
                {'base_headroom_log2': 1, 'renderings': [{'display_boost': 2,
                    'libavif': {'minimum_nits': 203.046064},
                    'ultrahdr_precise': {'minimum_nits': 228.375},
                    'icc_native_rejection': 'Only SDR base gain application'}]}]}}
        rendered = '\n'.join(iso_capacity_report(diagnostic))
        self.assertIn('| authored-base bypass | excluded |', rendered)
        self.assertIn('| offsets applied at zero | excluded |', rendered)
        self.assertIn('2.467253', rendered)
        self.assertIn('1.192288', rendered)
        self.assertIn('| 0 | 1 | 203.046064 | 228.375000 | 203.000000 |', rendered)
        self.assertIn('| 1 | 2 | 203.046064 | 228.375000 | rejected |', rendered)
        self.assertIn('0 <= a < b', rendered)
        self.assertIn('finite-grid checks are not the real-domain proof', rendered)
        self.assertIn('does not widen native admission', rendered)
        self.assertIn('cannot qualify a conversion', rendered)
        self.assertIn('(iso-capacity-bound.json)', rendered)
        diagnostic['constraints']['offset_at_zero_model_excluded'] = False
        self.assertIn('| offsets applied at zero | not established |', '\n'.join(iso_capacity_report(diagnostic)))

    def test_continuous_base_bound_keeps_its_color_models_and_unresolved_search_visible(self):
        from suite import iso_continuous_base_report
        diagnostic = {'sdr_maximum_gate': 8, 'hdr_maximum_gate': 8,
            'normalization': {'sdr_nominal_white_nits': 100, 'hdr_reference_white_nits': 203},
            'extrema': {'sdr_A_min': {'direction': 'minimum', 'outer_green_nits': 1.218613832,
                'bound_witness_gap_nits': .00072, 'visited_child_boxes': 100000, 'budget_exhausted': True}},
            'analytic_bound': {'contradiction_established': True, 'D_upper_bound_nits': -2.234397607,
                'D_lower_bound_nits': -1.042109109, 'contradiction_margin_nits': 1.192288498}}
        rendered = '\n'.join(iso_continuous_base_report(diagnostic))
        self.assertIn('| sdr_A_min | minimum | 1.218614 | 0.000720 | 100,000 | True |', rendered)
        self.assertIn('| -2.234398 | -1.042109 | 1.192288 | established |', rendered)
        self.assertIn('serialized ICC colorants', rendered)
        self.assertIn('nominal P3', rendered)
        self.assertIn('no upper component cap', rendered)
        self.assertIn('nonnegative offsets', rendered)
        self.assertIn('unresolved boxes', rendered)
        self.assertIn('not an exact optimum', rendered)
        self.assertIn('cannot qualify a conversion', rendered)
        self.assertIn('(iso-continuous-base-bound.json)', rendered)
        diagnostic['analytic_bound']['contradiction_established'] = False
        self.assertIn('| not established |', '\n'.join(iso_continuous_base_report(diagnostic)))

    def test_corrected_apple_report_uses_current_results_and_keeps_failed_rows(self):
        from suite import apple_documented_report
        from apple_source_model import REFERENCE_REVISION
        case = {'fixture_id': 'gainmap-apple-old', 'proof_module': 'apple_hdr_jpeg',
            'source_reference_revision': REFERENCE_REVISION, 'geometry': 'contain',
            'selectors': {'format': 'jpg', 'gamut': 'preserve', 'depth': 'preserve'}, 'status': 'qualified',
            'artifacts': {'sha256': 'a'*64},
            'measurements': {'independent_hdr': measurement(.1, 4.52892, .2),
                             'authored_sdr_base': measurement(.1, 4.64090, .1)}}
        failed = {**case, 'geometry': 'orientation', 'status': 'tested and failed', 'artifacts': {},
            'measurements': {'independent_hdr': measurement(3, 12.45, 2)}}
        single = {**case, 'proof_module': 'apple_hdr_avif', 'geometry': 'cover',
            'selectors': {'format': 'avif', 'gamut': 'preserve', 'depth': '10'},
            'measurements': {'hdr': measurement(.1, .82, .2)}}
        wide = {**single, 'selectors': {**single['selectors'], 'gamut': 'rec2020'},
                'artifacts': {'sha256': 'b'*64}, 'measurements': {'hdr': measurement(.1, 1.02, .2)}}
        precision = {**single, 'proof_module': 'apple_hdr_png_precision', 'geometry': 'contain',
                     'selectors': {'format': 'png', 'gamut': 'preserve', 'depth': '16'},
                     'artifacts': {'sha256': 'c'*64}, 'measurements': {'hdr': measurement(.001, .01089, .001)}}
        avif_precision = {**precision, 'proof_module': 'apple_hdr_avif_precision',
                          'selectors': {'format': 'avif', 'gamut': 'preserve', 'depth': '12'},
                          'artifacts': {'sha256': 'd'*64}, 'measurements': {'hdr': measurement(.01, .2, .01)}}
        png8 = {**precision, 'proof_module': 'apple_hdr_png8',
                'selectors': {'format': 'png', 'gamut': 'preserve', 'depth': '8'},
                'artifacts': {'sha256': 'e'*64}, 'measurements': {'hdr': measurement(.2, 2.686236, .01)}}
        legacy = {**case, 'source_reference_revision': 'legacy-convention'}
        rendered = '\n'.join(apple_documented_report([case, failed, single, wide, precision, avif_precision, png8, legacy]))
        self.assertIn('| contain | jpg | preserve | preserve | 4.528920 | 4.640900 | `aaaaaaaaaaaa` | qualified |', rendered)
        self.assertIn('| orientation | jpg | preserve | preserve | 12.450000 | missing | missing | tested and failed |', rendered)
        self.assertIn('| cover | avif | preserve | 10 | 0.820000 | not embedded | `aaaaaaaaaaaa` | qualified |', rendered)
        self.assertIn('| cover | avif | rec2020 | 10 | 1.020000 | not embedded | `bbbbbbbbbbbb` | qualified |', rendered)
        self.assertIn('| contain | png | preserve | 16 | 0.010890 | not embedded | `cccccccccccc` | qualified |', rendered)
        self.assertIn('| contain | avif | preserve | 12 | 0.200000 | not embedded | `dddddddddddd` | qualified |', rendered)
        self.assertIn('| contain | png | preserve | 8 | 2.686236 | not embedded | `eeeeeeeeeeee` | qualified |', rendered)
        self.assertEqual(rendered.count('| contain |'), 4)
        self.assertIn('Current recorded rows only', rendered)
        self.assertIn('does not qualify intermediate Apple adaptation', rendered)
        self.assertIn('pending manual review', rendered)
        self.assertIn('No current corrected-source conversion evidence.', '\n'.join(apple_documented_report([])))

    def test_rgb8_base_bound_reports_its_exact_admission_and_normalization(self):
        from suite import iso_base_code_report
        diagnostic = {'sdr_maximum_gate': 8, 'hdr_maximum_gate': 8,
            'normalization': {'sdr_nominal_white_nits': 100, 'hdr_reference_white_nits': 203},
            'inputs': [{'xy': [236, 822]}, {'xy': [242, 640]}],
            'enumeration': {'enumerated_codes': 256**3, 'records': [
                {'admissible_base_codes': count, 'minimum_green_code': low, 'maximum_green_code': high,
                 'minimum_own_green_nits_at203': minimum, 'maximum_own_green_nits_at203': maximum}
                for count, low, high, minimum, maximum in ((668, 65, 73, 2.55794978, 3.70),
                                                          (603, 64, 72, 2.43, 3.54840453))]},
            'analytic_bound': {'contradiction_established': True,
                'D_upper_bound_nits': -2.2254864511, 'D_lower_bound_nits': -2.1981335519,
                'contradiction_margin_nits': .027352899208}}
        rendered = '\n'.join(iso_base_code_report(diagnostic))
        self.assertIn('| [236, 822] | 668 | 65..73 | 2.557950..3.700000 |', rendered)
        self.assertIn('| [242, 640] | 603 | 64..72 | 2.430000..3.548405 |', rendered)
        self.assertIn('| -2.225486 | -2.198134 | 0.027353 | established |', rendered)
        self.assertIn('16,777,216', rendered)
        self.assertIn('SDR at 100 nits', rendered)
        self.assertIn('HDR at 203 nits', rendered)
        self.assertIn('Other ICC transfers or colorants', rendered)
        self.assertIn('cannot qualify a conversion', rendered)
        self.assertIn('(iso-base-code-bound.json)', rendered)
        diagnostic['analytic_bound']['contradiction_established'] = False
        self.assertIn('| not established |', '\n'.join(iso_base_code_report(diagnostic)))

    def test_global_offset_bound_reports_only_the_declared_fixed_base_contradiction(self):
        from suite import iso_global_offset_report
        diagnostic = {'fixed_maximum_gate': 8, 'analytic_bound': {
            'contradiction_established': True, 'D_upper_bound_nits': -2.76414504335,
            'D_lower_bound_nits': -1.46816776674, 'contradiction_margin_nits': 1.29597727661}}
        rendered = '\n'.join(iso_global_offset_report(diagnostic))
        self.assertIn('| -2.764145 | -1.468168 | 1.295977 | established |', rendered)
        self.assertIn('same decoded P3 base', rendered)
        self.assertIn('positive ordered display weights', rendered)
        self.assertIn('arbitrary map precision', rendered)
        self.assertIn('unchanged maximum of 8', rendered)
        self.assertIn('not a formal directed-rounding certificate', rendered)
        self.assertIn('Other bases, capacities, reference models', rendered)
        self.assertIn('cannot qualify a conversion', rendered)
        self.assertIn('(iso-global-offset-bound.json)', rendered)
        diagnostic['analytic_bound']['contradiction_established'] = False
        self.assertIn('| not established |', '\n'.join(iso_global_offset_report(diagnostic)))

    def test_fixed_map_bound_keeps_its_measured_scope_and_cannot_qualify_a_path(self):
        from suite import iso_map_bound_report
        rendered = '\n'.join(iso_map_bound_report({'fixed_maximum_gate': 8,
            'records': [{'xy': [236, 822], 'enumerated_codes': 256**3,
                         'minimum_joint_max_delta_e': 109.491281,
                         'joint_minimum_codes': [0, 0, 0], 'joint_code_count_under_maximum': 0}]}))
        self.assertIn('| [236, 822] | 16,777,216 | 109.491281 | [0, 0, 0] | 0 |', rendered)
        self.assertIn('fixed decoded base and actual gain metadata', rendered)
        self.assertIn('unchanged maximum of 8', rendered)
        self.assertIn('ignores JPEG neighborhood coupling', rendered)
        self.assertIn('Other base pixels, offsets, capacities', rendered)
        self.assertIn('cannot qualify a conversion', rendered)
        self.assertIn('(iso-map-code-bound.json)', rendered)

    def test_endpoint_report_exposes_additional_required_rendering_gap(self):
        rendered = '\n'.join(product_coverage_report(build_matrix([])))
        self.assertIn('display boost 16', rendered)
        self.assertIn('0 of 25 additional HDR rendering requirements qualify', rendered)
        self.assertIn('gainmap-android-iso:hdr:jpg:upscale:display-boost2', rendered)
        self.assertIn('| 2 | untested |', rendered)
        self.assertIn('gainmap-android-iso:hdr:jpg:upscale:display-boost64', rendered)
        self.assertIn('| 64 | untested |', rendered)
        self.assertIn('blocks faithful-HDR qualification', rendered)
        self.assertIn('One identical output file at display boosts 2, 16, 64: untested', rendered)
        self.assertIn('Different output files cannot jointly satisfy', rendered)
        self.assertIn('0 of 20 required gain-map fixture/geometry tuples pass every declared same-file rendering', rendered)

    def test_jpegli_quality_failures_remain_separate_from_hdr_qualification(self):
        base = {'cases': [{'status': 'qualified'}, {'status': 'tested and failed'}]}
        quality = {'cases': [{'status': 'tested and failed'}] * 3}
        rendered = '\n'.join(jpegli_experiment_report(base, quality))
        self.assertIn('2 native SOF0 RGB8 trials, of which 1 pass', rendered)
        self.assertIn('3 native trials, with 0 passing and 3 failed or unqualified', rendered)
        self.assertIn('(jpegli-quality-experiment.json)', rendered)
        self.assertIn('do not qualify an HDR derivative', rendered)

    def test_sof0_union_counts_complementary_exact_alternatives_once(self):
        cases = [native_case(candidate, geometry, qualified)
                 for candidate, geometry, qualified in (
                     ('integer', 'contain', True), ('integer', 'cover', False),
                     ('float', 'contain', False), ('float', 'cover', True),
                     ('jpegli', 'fill', False))]
        cases.append(deepcopy(cases[0]))
        rendered = '\n'.join(gainmap_candidate_report(cases))
        self.assertIn('| `reference-v1` | 2/3 | 2/3 |', rendered)
        self.assertIn('observed corpus only', rendered)
        self.assertIn('pending manual review', rendered)
        # Every failed representation still contributes to its own row.
        self.assertIn('| `native-combine-float` | `reference-v1` | 1/2 |', rendered)
        self.assertIn('| `native-combine-jpegli` | `reference-v1` | 0/1 |', rendered)

    def test_sof0_union_does_not_merge_selectors_geometry_source_or_reference(self):
        original = native_case('integer', 'contain', True)
        cases = [original]
        for field, value in (('depth', '8'), ('gamut', 'srgb'), ('w', 174)):
            changed = native_case('float', 'contain', False)
            changed['selectors'][field] = value
            cases.append(changed)
        for field, value in (('geometry', 'cover'), ('fixture_id', 'gainmap-android-xmp'),
                             ('source_sha256', 'b' * 64), ('source_reference_revision', 'reference-v2')):
            changed = native_case('jpegli', 'contain', False)
            changed[field] = value
            cases.append(changed)
        rendered = '\n'.join(gainmap_candidate_report(cases))
        self.assertIn('| `reference-v1` | 1/7 | 1/3 |', rendered)
        self.assertIn('| `reference-v2` | 0/1 | 0/1 |', rendered)

    def test_sof0_union_requires_actual_layers_and_passing_original_evidence(self):
        failed = native_case('integer', 'contain', False)
        cases = [failed]
        for mutation in ('predictive-base', 'predictive-map', 'missing-map', 'encoder',
                         'failed-check', 'blocker', 'failed-measurement'):
            changed = native_case(mutation, 'contain', True)
            if mutation.startswith('predictive'):
                changed['facts'][mutation.split('-')[1]]['sof'] = 3
            elif mutation == 'missing-map':
                changed['facts'].pop('map')
            elif mutation == 'encoder':
                changed['checks']['native_encoder'] = False
            elif mutation == 'failed-check':
                changed['checks']['privacy'] = False
            elif mutation == 'blocker':
                changed['blockers'] = ['Unresolved output validation']
            else:
                changed['measurements'] = {'reconstructed_hdr': {'passed': False}}
            cases.append(changed)
        rendered = '\n'.join(gainmap_candidate_report(cases))
        self.assertIn('| `reference-v1` | 0/1 | 0/1 |', rendered)

    def test_real_appearance_record_supplies_maximum_fields(self):
        reference = np.ones((2, 2, 3))
        actual = reference * 1.01
        measured = compare_appearance(reference, actual, reference_gamut='srgb',
                                      actual_gamut='srgb', fixture_class='gainmap-sdr')
        case = {'fixture_id': 'source', 'candidate': 'native-combine-example',
                'source_reference_revision': 'reference-v1', 'status': 'tested and failed',
                'measurements': {'authored_sdr_base': measured, 'reconstructed_hdr': measured}}
        rendered = '\n'.join(gainmap_candidate_report([case]))
        self.assertNotIn(' | missing |', rendered)
        maximum = measured['regions']['shadow']['delta_e_itp']['maximum']
        self.assertIn(f' | {maximum:.4f} |', rendered)

    def test_reports_failed_attempts_and_maximum_regional_statistics_without_pooling(self):
        cases = [
            {'fixture_id': 'source', 'candidate': 'native-combine-moderateoffset-dct-rgb',
             'source_reference_revision': 'reference-v1', 'status': status,
             'measurements': {'authored_sdr_base': measurement(mean, maximum, .2),
                              'reconstructed_hdr': measurement(1, 6, .5)},
             'consumer_decoder_diagnostics': {'rgb_libavif': {'status': 'qualified'}}}
            for status, mean, maximum in [('qualified', 1, 3), ('tested and failed', 2, 10)]
        ]
        cases.append({'fixture_id': 'source', 'candidate': 'native-combine-moderateoffset-dct-rgb',
                      'source_reference_revision': 'reference-v1', 'status': 'tested and failed',
                      'measurements': {}})
        rendered = '\n'.join(gainmap_candidate_report(cases))
        self.assertIn('| 1/3 | 2.0000 | 10.0000 | 1.0000 | 6.0000 | 0.5000 |', rendered)
        self.assertIn('maximum of the recorded regional statistic', rendered)
        self.assertIn('| `rgb_libavif` | 2 | 2 | 0 |', rendered)
        self.assertNotIn('999', rendered)
        self.assertIn('pending manual review', rendered)

    def test_preserves_missing_measurements_and_reference_revision_boundaries(self):
        cases = [{'fixture_id': 'source', 'candidate': 'native-combine-candidate',
                  'source_reference_revision': revision, 'status': 'tested and failed'}
                 for revision in ('reference-v1', 'reference-v2')]
        cases.append({'fixture_id': 'ignored', 'candidate': 'another-encoder', 'status': 'qualified'})
        rendered = '\n'.join(gainmap_candidate_report(cases))
        self.assertEqual(rendered.count('| 0/1 | missing | missing | missing | missing | missing |'), 2)
        self.assertIn('reference-v1', rendered)
        self.assertIn('reference-v2', rendered)
        self.assertNotIn('ignored', rendered)


if __name__ == '__main__':
    unittest.main()
