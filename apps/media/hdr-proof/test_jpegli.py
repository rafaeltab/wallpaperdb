"""Real JPEGli SOF0 RGB8 coding retains color facts and independent decoding."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_sdr import decode
from jpegli import encode


class JpegliTests(unittest.TestCase):
    def test_native_options_keep_baseline_rgb8_and_srgb_interpretation(self):
        # Constant 8x8 blocks isolate native color/signaling semantics from the
        # separately measured fixture-dependent quantization error.
        colors = np.array([[0, 0, 0], [1, 1, 1], [10, 10, 10], [64, 64, 64],
                           [128, 128, 128], [255, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8)
        pixels = np.repeat(np.repeat(colors[None], 8, axis=0), 8, axis=1)
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory/'source.png'
            Image.fromarray(pixels).save(source)
            for input_type in ('uint8', 'float32'):
                for tables in ('standard', 'jpegli'):
                    for adaptive in (False, True):
                        with self.subTest(input_type=input_type, tables=tables, adaptive=adaptive):
                            target = directory/f'{input_type}-{tables}-{adaptive}.jpg'
                            encoded = encode(source, target, icc_profile=profile, input_type=input_type,
                                             tables=tables, adaptive=adaptive)
                            actual, facts = decode(target, gamut='srgb')
                            self.assertEqual(facts['sof'], 0)
                            self.assertEqual(facts['depth'], 8)
                            self.assertEqual(facts['transfer'], 'srgb')
                            self.assertTrue(facts['privacy'])
                            self.assertEqual(encoded['coded_depth'], 8)
                            self.assertEqual(encoded['sampling_factors'], [17, 17, 17])
                            self.assertEqual(encoded['icc_sha256'], facts['icc_sha256'])
                            with self.assertRaisesRegex(ValueError, 'gamut'):
                                decode(target, gamut='p3')
                            measurement = compare_appearance(sdr_signal_to_nits(pixels/255),
                                sdr_signal_to_nits(actual), reference_gamut='srgb', actual_gamut='srgb',
                                fixture_class='gainmap-sdr')
                            self.assertTrue(measurement['passed'], measurement['failures'])

    def test_alpha_and_unproven_input_options_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory/'alpha.png'
            Image.new('RGBA', (8, 8), (1, 2, 3, 127)).save(source)
            with self.assertRaisesRegex(ValueError, 'RGB8'):
                encode(source, directory/'output.jpg')
            with self.assertRaisesRegex(ValueError, 'input'):
                encode(source, directory/'output.jpg', input_type='uint12')

    def test_iso_improvement_keeps_failed_trials_unqualified(self):
        from jpegli_proof import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), corpus=(('gainmap-android-iso', 'contain'),
                ('gainmap-apple-new', 'contain')), options=(('uint8', 'standard', False),
                                                          ('uint8', 'standard', True)))
            cases = report['cases']
            self.assertTrue(report['commands'])
            self.assertTrue(all(command['exit_code'] == 0 for command in report['commands']))
            self.assertTrue(any(command['argv'][0] == '/opt/proof/jpegli/hdr-proof-jpegli'
                                for command in report['commands']))
            self.assertEqual(set(report['source_hashes']) & {'jpegli-build.sh', 'jpegli.cmake', 'native_jpegli.cpp'},
                             {'jpegli-build.sh', 'jpegli.cmake', 'native_jpegli.cpp'})
            self.assertEqual(len(cases), 4)
            self.assertEqual([case['status'] for case in cases],
                             ['tested and failed', 'qualified', 'tested and failed', 'tested and failed'])
            self.assertLess(cases[1]['measurement']['regions']['shadow']['delta_e_itp']['maximum'], 8)
            for case in (cases[0], cases[2], cases[3]):
                self.assertIn('shadow.delta_e_max', case['measurement']['failures'])
                self.assertIn('Failed appearance check', case['blockers'])
            for case in cases:
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertIn('no gain-map or HDR derivative qualification', case['qualification_scope'])
                self.assertEqual(case['native_candidate']['coded_depth'], 8)


if __name__ == '__main__':
    unittest.main()
