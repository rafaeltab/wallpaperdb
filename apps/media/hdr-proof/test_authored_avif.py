"""Native authored SDR AVIF retains RGB8 depth, gamut and appearance."""
import json
from pathlib import Path
import tempfile
import unittest

import avif
from authored_sdr_proof import run


class AuthoredAvifTests(unittest.TestCase):
    def test_native_authored_avif_preserves_both_requested_gamuts(self):
        with tempfile.TemporaryDirectory() as temporary:
            cases = run(Path(temporary), names=('gainmap-apple-new', 'gainmap-android-xmp'),
                        geometries=('contain', 'orientation'), formats=('avif',))
            json.dumps(cases, allow_nan=False)
            self.assertEqual(len(cases), 8)
            for case in cases:
                with self.subTest(case=case['case_id']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertEqual(case['selectors']['depth'], 'preserve')
                    self.assertEqual(case['facts']['depth'], 8)
                    self.assertEqual(case['facts']['transfer'], 'srgb')
                    self.assertIn('dav1d', case['facts']['decoder'])
                    self.assertTrue(case['facts']['privacy'])
                    self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
                    self.assertEqual(case['consumer_status'], 'pending manual review')

    def test_conflicting_requested_color_or_hdr_transfer_cannot_be_sdr_evidence(self):
        from authored_avif import encode, decode_linear
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-apple-new.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            output = directory/'output.avif'
            encode(source, output, 'contain', gamut='p3')
            with self.assertRaisesRegex(ValueError, 'color'):
                decode_linear(output, gamut='srgb')
            avif.encode_avif([directory/'output-authored.png'], directory/'wrong-transfer.avif', 'pq', 'p3', 8)
            with self.assertRaisesRegex(ValueError, 'color'):
                decode_linear(directory/'wrong-transfer.avif', gamut='p3')


if __name__ == '__main__':
    unittest.main()
