"""JPEGli's improved SDR base must qualify again after real HDR JPEG packing."""
from pathlib import Path
import tempfile
import unittest

from combined_gainmap_proof import run


class CombinedJpegliGainMapTests(unittest.TestCase):
    def test_iso_contain_passes_all_gates_with_recomputed_native_gain_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary), names=('gainmap-android-iso',), geometries=('contain',),
                policies=('moderateoffset',), coding='jpegli-base-dct-float-map')[0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(all(case['structural_checks'].values()))
            self.assertEqual(case['facts']['base']['sof'], 0)
            self.assertEqual(case['facts']['map']['sof'], 0)
            self.assertEqual(case['native_candidate']['base_encoding']['coded_depth'], 8)
            self.assertTrue(case['native_candidate']['base_encoding']['adaptive'])
            self.assertEqual(case['native_candidate']['map_encoding']['method'], 'float')
            self.assertTrue(case['native_candidate']['gain_map_base_from_compressed_jpeg'])
            self.assertEqual(case['consumer_decoder_diagnostics']['rgb_libavif']['status'], 'qualified')
            self.assertEqual(case['consumer_status'], 'pending manual review')


if __name__ == '__main__':
    unittest.main()
