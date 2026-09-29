"""Native alternatives keep exact selectors and their own appearance failures."""
from pathlib import Path
import tempfile
import unittest

from authored_sdr_proof import run
from matrix import build_matrix


class AuthoredSdrEvidenceTests(unittest.TestCase):
    def test_lossless_formats_keep_separate_measured_ledger_cells(self):
        with tempfile.TemporaryDirectory() as temporary:
            evidence = run(Path(temporary), names=('gainmap-apple-new',), geometries=('contain',),
                           gamuts=('preserve',), formats=('png', 'webp'))
            self.assertEqual(len(evidence), 2)
            self.assertEqual({case['cell_id'] for case in evidence},
                             {'gainmap-jpeg:sdr:png', 'gainmap-jpeg:sdr:webp'})
            for case in evidence:
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertTrue(case['facts']['privacy'])
            self.assertEqual(build_matrix(evidence)['evidence_errors'], [])

    def test_native_standard_rgb_jpeg_can_fulfill_only_its_measured_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            evidence = run(Path(temporary), names=('gainmap-android-xmp',),
                           geometries=('contain',), gamuts=('srgb',), gammas=(None,))
            self.assertEqual(len(evidence), 1)
            case = evidence[0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(case['case_id'].endswith(':rgb-jpeg-srgb-transfer'))
            self.assertEqual(case['selectors']['depth'], 'preserve')
            self.assertEqual(case['selectors']['w'], 173)
            self.assertEqual(case['reference_sdr']['gamut'], 'srgb')
            self.assertEqual(case['consumer_status'], 'pending manual review')
            matrix = build_matrix(evidence)
            self.assertEqual(matrix['evidence_errors'], [])
            self.assertEqual(matrix['product_coverage']['qualified_count'], 1)


if __name__ == '__main__':
    unittest.main()
