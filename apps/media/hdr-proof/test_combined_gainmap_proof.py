"""Required HDR JPEG evidence must pass the actual native and appearance gates."""

from pathlib import Path
import tempfile
import unittest

from combined_gainmap_proof import run
from matrix import build_matrix


class CombinedGainMapProofTests(unittest.TestCase):
    def test_android_and_both_apple_contain_requests_qualify_with_explicit_reference_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            cases = run(Path(temporary), names=('gainmap-android-xmp', 'gainmap-apple-old', 'gainmap-apple-new'),
                        geometries=('contain',))
            self.assertEqual(len(cases), 3)
            for case in cases:
                with self.subTest(source=case['fixture_id']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertTrue(all(case['checks'].values()), case['checks'])
                    self.assertEqual(case['source_reference_revision'], 'gainmap-hdr-target-gamut-v1')
                    self.assertIn(case['source_reference_revision'], case['case_id'])
                    self.assertIn('superseded_reference_difference', case['reference_revision_diagnostics'])
                    self.assertNotIn('superseded_reference_difference', case['measurements'])
                    self.assertEqual(case['consumer_status'], 'pending manual review')
            matrix = build_matrix(cases)
            aggregated = {item['case_id']: item for cell in matrix['cells'] for item in cell['evidence']}
            for case in cases:
                self.assertEqual(aggregated[case['case_id']]['reference_revision_diagnostics'],
                                 case['reference_revision_diagnostics'])


if __name__ == '__main__':
    unittest.main()
