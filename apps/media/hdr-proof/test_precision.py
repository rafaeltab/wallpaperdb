"""Representation bounds and real codec counterexamples cannot qualify paths."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from precision import minimum_rgb8_error, native_counterexample, native_yuv_candidates, analyze


class PrecisionTests(unittest.TestCase):
    def test_exhaustive_rgb8_search_finds_representable_and_impossible_colors(self):
        reference = np.array([[0, 0, 0], [1, 1, 1],
                              [.35917961716473906 / 255] * 3,
                              [.17231441227079494 / 255] * 3])
        result = minimum_rgb8_error(reference)
        self.assertEqual(result['enumerated_codes'], 256 ** 3)
        self.assertEqual(result['best_rgb8_codes'][:2], [[0, 0, 0], [255, 255, 255]])
        np.testing.assert_allclose(result['minimum_delta_e_itp'][:2], 0, atol=1e-12)
        self.assertEqual(result['best_rgb8_codes'][2:], [[1, 1, 1], [0, 0, 0]])
        np.testing.assert_allclose(result['minimum_delta_e_itp'][2:],
                                   [10.29187656985, 11.11186150066], atol=1e-8)

    def test_search_rejects_non_signal_or_wrong_shape(self):
        for invalid in ([], [0, 0, 0], [[1.1, 0, 0]], [[float('nan'), 0, 0]]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                minimum_rgb8_error(invalid)

    def test_native_identity_matrix_avif_preserves_codes_but_fails_reference(self):
        reference = np.full((8, 8, 3), .35917961716473906 / 255)
        with tempfile.TemporaryDirectory() as directory:
            result = native_counterexample(reference, Path(directory))
            self.assertTrue(result['decoded_exactly_matches_supplied_rgb8'])
            self.assertEqual(result['facts']['depth'], 8)
            self.assertEqual(result['facts']['matrix'], 0)
            self.assertEqual(result['facts']['transfer'], 13)
            self.assertFalse(result['appearance']['passed'])
            self.assertIn('shadow.delta_e_max', result['appearance']['failures'])

    def test_diagnostic_reports_visible_counterexamples_without_support_claim(self):
        reference = np.full((4, 4, 3), .17231441227079494 / 255)
        alpha = np.ones((4, 4))
        alpha[0] = 0
        result = analyze(reference, np.ones((4, 4)), alpha, sample_limit=1)
        self.assertEqual(result['status'], 'diagnostic_only')
        self.assertEqual(result['shadow_samples'], 12)
        self.assertEqual(result['selected_samples_with_impossible_maximum_gate'], 12)
        self.assertEqual(result['references'][0]['visible_matching_samples'], 12)
        self.assertTrue(result['references'][0]['exceeds_fixed_maximum_gate'])
        self.assertIn('identity', result['representation'])
        self.assertNotIn('qualified', result)

    def test_diagnostic_rejects_missing_shadow_evidence_or_invalid_geometry(self):
        reference = np.zeros((2, 2, 3))
        with self.assertRaisesRegex(ValueError, 'no visible shadow'):
            analyze(reference, np.full((2, 2), 100), np.ones((2, 2)))
        with self.assertRaisesRegex(ValueError, 'matched RGB'):
            analyze(reference, np.zeros((2, 3)), np.ones((2, 2)))

    def test_yuv_candidates_record_real_failed_encodes_without_an_impossibility_claim(self):
        from avif import write_png
        reference = np.full((8, 8, 3), .35917961716473906 / 255)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            input_png = directory/'source.png'
            write_png(input_png, np.concatenate((reference, np.ones((8, 8, 1))), axis=-1))
            rows = native_yuv_candidates(input_png, reference, directory/'yuv')
        self.assertEqual(len(rows), 6)
        for row in rows:
            self.assertEqual(row['status'], 'tested and failed')
            self.assertEqual(row['facts']['depth'], 8)
            self.assertEqual(row['facts']['matrix'], row['requested_matrix'])
            self.assertFalse(row['appearance']['passed'])
            self.assertFalse(row['exhaustive_representation_bound'])


if __name__ == '__main__':
    unittest.main()
