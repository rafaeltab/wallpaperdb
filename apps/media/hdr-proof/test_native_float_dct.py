"""Native floating DCT is a separate baseline JPEG precision experiment."""

from pathlib import Path
import tempfile
import unittest

from combined_gainmap_proof import run


class NativeFloatDctTests(unittest.TestCase):
    def test_iso_and_apple_oriented_derivatives_pass_without_changing_transfer(self):
        with tempfile.TemporaryDirectory() as temporary:
            cases = run(Path(temporary), names=('gainmap-android-iso', 'gainmap-apple-old', 'gainmap-apple-new'),
                        geometries=('orientation',), policies=('moderateoffset',), coding='dct-float-rgb')
            for case in cases:
                with self.subTest(source=case['fixture_id']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertEqual(case['sdr_decoder_evidence']['transfer'], 'srgb')
                    self.assertEqual(case['facts']['base']['sof'], 0)
                    self.assertEqual(case['native_candidate']['base_encoding']['method'], 'float')
                    self.assertEqual(case['consumer_status'], 'pending manual review')


if __name__ == '__main__':
    unittest.main()
