"""Report aggregation does not change conversion qualification."""
from copy import deepcopy
import unittest

import numpy as np

from appearance import compare_appearance

from suite import gainmap_candidate_report, jpegli_experiment_report, mozjpeg_experiment_report
from matrix import CHECKS, GAINMAP_GEOMETRIES


def measurement(mean, maximum, luminance):
    return {'regions': {'shadow': {'samples': 10,
        'delta_e_itp': {'mean': mean, 'maximum': maximum},
        'luminance_absolute_error_nits': {'mean': luminance}},
        'highlight': {'samples': 0, 'delta_e_itp': {'mean': 999, 'maximum': 999}}}}


class MozjpegReportTests(unittest.TestCase):
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
