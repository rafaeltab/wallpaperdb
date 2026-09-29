"""A passing MozJPEG base must qualify again inside the complete HDR JPEG."""
from pathlib import Path
import tempfile
import unittest

from combined_gainmap_proof import run


class CombinedMozjpegGainMapTests(unittest.TestCase):
    def test_iso_cover_passes_all_gates_with_recomputed_native_gain_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary), names=('gainmap-android-iso',), geometries=('cover',),
                policies=('moderateoffset',), coding='mozjpeg-base-dct-float-map')[0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(all(case['structural_checks'].values()))
            self.assertEqual(case['facts']['base']['sof'], 0)
            self.assertEqual(case['facts']['map']['sof'], 0)
            base = case['native_candidate']['base_encoding']
            self.assertEqual(base['coded_depth'], 8)
            self.assertEqual(base['method'], 'islow')
            self.assertTrue(base['trellis'])
            self.assertFalse(base['deringing'])
            self.assertTrue(base['optimized_huffman'])
            self.assertEqual(case['native_candidate']['map_encoding']['method'], 'float')
            self.assertTrue(case['native_candidate']['gain_map_base_from_compressed_jpeg'])
            self.assertIn('rgb_libavif', case['consumer_decoder_diagnostics'])
            self.assertEqual(case['consumer_status'], 'pending manual review')


if __name__ == '__main__':
    unittest.main()
