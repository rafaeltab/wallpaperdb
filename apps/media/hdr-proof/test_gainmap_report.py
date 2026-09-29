"""Report aggregation does not change conversion qualification."""
import unittest

import numpy as np

from appearance import compare_appearance

from suite import gainmap_candidate_report


def measurement(mean, maximum, luminance):
    return {'regions': {'shadow': {'samples': 10,
        'delta_e_itp': {'mean': mean, 'maximum': maximum},
        'luminance_absolute_error_nits': {'mean': luminance}},
        'highlight': {'samples': 0, 'delta_e_itp': {'mean': 999, 'maximum': 999}}}}


class GainMapReportTests(unittest.TestCase):
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
