"""A separate native ISO float32 candidate must prove emitted JPEG renditions."""
from pathlib import Path
import tempfile
import unittest

from combined_gainmap_proof import run
from gainmap_combine import encode

ROOT = Path(__file__).parent


class CombinedSourcePrecisionTests(unittest.TestCase):
    def test_iso_float32_source_qualifies_six_emitted_derivatives_with_independent_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            cases = run(Path(temporary), names=('gainmap-android-iso',), policies=('moderateoffset',),
                        source_precision='float32')
            self.assertEqual(len(cases), 6)
            for case in cases:
                with self.subTest(geometry=case['geometry']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertIn('-source-float32:', case['case_id'])
                    self.assertEqual(case['source_precision'], 'float32')
                    self.assertTrue(case['checks']['native_source_precision'])
                    self.assertTrue(case['measurements']['native_hdr_source']['passed'])
                    self.assertTrue(case['measurements']['native_hdr_geometry']['passed'])
                    self.assertTrue(case['measurements']['native_hdr_intent_png']['passed'])
                    self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
                    self.assertTrue(case['measurements']['reconstructed_hdr']['passed'])
                    self.assertTrue(case['measurements']['independent_hdr_cross_decoder']['passed'])
                    source = case['source_precision_evidence']
                    self.assertEqual(source['source_sha256'], case['source_sha256'])
                    self.assertEqual(len(source['native_source']['float32_helper_sha256']), 64)
                    self.assertEqual(source['normalization_nits'], 203)
                    self.assertEqual(case['consumer_status'], 'pending manual review')

    def test_unproven_source_models_cannot_select_float32_reconstruction(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)/'output.jpg'
            source = ROOT/'fixtures/gainmap/gainmap-apple-new.jpg'
            with self.assertRaisesRegex(ValueError, 'ISO'):
                encode(source, output, 'contain', gamut='p3', source_precision='float32')
            self.assertFalse(output.exists())
            self.assertFalse(output.with_name('output-parts').exists())


if __name__ == '__main__':
    unittest.main()
