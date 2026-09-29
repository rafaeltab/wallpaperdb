"""Baseline DCT JPEG is a separate measured representation, with real loss."""

from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageCms

from combined_gainmap_proof import run
from gainmap_sdr import decode


class CombinedDctGainMapTests(unittest.TestCase):
    def test_native_rgb_dct_contain_passes_both_android_appearances(self):
        with tempfile.TemporaryDirectory() as temporary:
            cases = run(Path(temporary), names=('gainmap-android-xmp',), geometries=('contain',),
                        policies=('moderateoffset',), coding='dct-rgb')
            case = cases[0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertEqual(case['facts']['base']['sof'], 0)
            self.assertEqual(case['facts']['map']['sof'], 0)
            self.assertIn('dct-rgb', case['case_id'])
            self.assertTrue(case['structural_checks']['metadata_agreement'])
            self.assertEqual(case['sdr_decoder_evidence']['jpeg_color_transform'], None)
            self.assertIn('SOF0 RGB', case['sdr_decoder_evidence']['jpeg_color_model'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(case['native_candidate']['gain_map_base_from_compressed_jpeg'])
            diagnostic = case['consumer_decoder_diagnostics']['baseline_libavif']
            self.assertTrue(diagnostic['decoded'])
            self.assertEqual(diagnostic['status'], 'tested and failed')
            self.assertIn('highlight.delta_e_mean', diagnostic['measurement']['failures'])

    def test_apple_dct_shadow_error_remains_unqualified(self):
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary), names=('gainmap-apple-new',), geometries=('contain',),
                       policies=('moderateoffset',), coding='dct-rgb')[0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertIn('shadow.delta_e_max', case['measurements']['authored_sdr_base']['failures'])

    def test_ycbcr_component_identifiers_cannot_enter_rgb_header_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'ycbcr.jpg'
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            Image.new('RGB', (16, 16), (32, 96, 224)).save(path, quality=100, subsampling=0, icc_profile=profile)
            with self.assertRaisesRegex(ValueError, 'RGB JPEG coding was not independently signaled'):
                decode(path)


if __name__ == '__main__':
    unittest.main()
