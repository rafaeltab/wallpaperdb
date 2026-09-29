"""Real MozJPEG baseline RGB8 experiments preserve declared file semantics."""
import itertools
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_sdr import decode
from mozjpeg import encode


class MozjpegTests(unittest.TestCase):
    def test_native_options_keep_sof0_rgb8_srgb_and_independent_appearance(self):
        colors = np.array([[0, 0, 0], [1, 1, 1], [10, 10, 10], [64, 64, 64],
                           [128, 128, 128], [255, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8)
        pixels = np.repeat(np.repeat(colors[None], 8, axis=0), 8, axis=1)
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory/'source.png'
            Image.fromarray(pixels).save(source)
            for method, trellis, deringing in itertools.product(('islow', 'float'), (False, True), (False, True)):
                with self.subTest(method=method, trellis=trellis, deringing=deringing):
                    output = directory/f'{method}-{trellis}-{deringing}.jpg'
                    encoded = encode(source, output, icc_profile=profile, method=method,
                                     trellis=trellis, deringing=deringing)
                    actual, facts = decode(output, gamut='srgb')
                    self.assertEqual((facts['sof'], facts['depth']), (0, 8))
                    self.assertEqual(encoded['sampling_factors'], [17, 17, 17])
                    self.assertEqual(encoded['quality'], 100)
                    self.assertEqual(encoded['trellis'], trellis)
                    self.assertEqual(encoded['deringing'], deringing)
                    self.assertEqual(encoded['icc_sha256'], facts['icc_sha256'])
                    self.assertTrue(facts['privacy'])
                    self.assertEqual(facts['transfer'], 'srgb')
                    self.assertEqual(max(max(table) for table in encoded['quantization_tables'].values()), 1)
                    with self.assertRaisesRegex(ValueError, 'gamut'):
                        decode(output, gamut='p3')
                    measurement = compare_appearance(sdr_signal_to_nits(pixels/255), sdr_signal_to_nits(actual),
                        reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
                    self.assertTrue(measurement['passed'], measurement['failures'])

    def test_alpha_and_unproven_dct_options_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)/'alpha.png'
            Image.new('RGBA', (8, 8), (1, 2, 3, 127)).save(source)
            with self.assertRaisesRegex(ValueError, 'RGB8'):
                encode(source, source.with_suffix('.jpg'))
            with self.assertRaisesRegex(ValueError, 'DCT'):
                encode(source, source.with_suffix('.jpg'), method='ifast')

    def test_initial_huffman_failure_is_retained_even_when_decoder_exits_zero(self):
        from mozjpeg_proof import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), corpus=(('gainmap-android-iso', 'cover'),),
                         options=(('islow', True, False),), optimized_huffman=False)
            case = report['cases'][0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertFalse(case['checks']['independent_decoder'])
            self.assertFalse(case['facts']['appearance_evaluated'])
            self.assertNotIn('measurement', case)
            self.assertTrue(all(command['exit_code'] == 0 for command in case['facts']['decoder_diagnostics']))
            self.assertTrue(any(command['stderr'] for command in case['facts']['decoder_diagnostics']))
            self.assertIn('Failed independent_decoder check', case['blockers'])
            self.assertTrue(case['checks']['native_encoder'])
            self.assertEqual(case['native_candidate']['coded_depth'], 8)
            self.assertTrue(Path(case['artifacts']['output']).is_file())
            self.assertEqual(report['status_counts'], {'tested and failed': 1})
            self.assertIn('no gain-map or HDR derivative qualification', case['qualification_scope'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(report['commands'])
            self.assertTrue(report['source_hashes']['mozjpeg-build.sh'])

    def test_native_trellis_iso_cover_passes_unchanged_authored_sdr_gates(self):
        from mozjpeg_proof import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), corpus=(('gainmap-android-iso', 'cover'),),
                         options=(('islow', True, False),))
            case = report['cases'][0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(case['facts']['decoder_clean'])
            self.assertEqual(case['native_candidate']['coded_depth'], 8)
            self.assertTrue(case['options']['optimized_huffman'])
            self.assertTrue(case['measurement']['passed'])
            self.assertEqual(case['artifacts']['sha256'],
                '1d2e285b9aad47c9f1c57897e2ba67bf8dfd9d0ceca8b7719ea7301b386d00ee')
            self.assertIn('no gain-map or HDR derivative qualification', case['qualification_scope'])
            self.assertEqual(case['consumer_status'], 'pending manual review')

    def test_bounded_native_lambda_options_preserve_sample_depth_and_color(self):
        from avif import native
        colors = np.array([[0, 0, 0], [0, 0, 12], [1, 1, 1], [10, 10, 10],
                           [64, 64, 64], [128, 128, 128], [255, 0, 0], [0, 255, 0]], dtype=np.uint8)
        pixels = np.repeat(np.repeat(colors[None], 8, axis=0), 8, axis=1)
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = folder/'source.png'
            Image.fromarray(pixels).save(source)
            for method, scale1 in itertools.product(('islow', 'float'), (14.75, 18.75, 22.75)):
                output = folder/f'{method}-{scale1}.jpg'
                encoded = encode(source, output, icc_profile=profile, method=method, trellis=True,
                                 lambda_scale1=scale1, lambda_scale2=16.5)
                actual, facts = decode(output, gamut='srgb')
                self.assertEqual((facts['sof'], facts['depth']), (0, 8))
                self.assertEqual(encoded['sampling_factors'], [17, 17, 17])
                self.assertEqual((encoded['lambda_scale1'], encoded['lambda_scale2']), (scale1, 16.5))
                self.assertEqual(max(max(table) for table in encoded['quantization_tables'].values()), 1)
                self.assertTrue(compare_appearance(sdr_signal_to_nits(pixels/255), sdr_signal_to_nits(actual),
                    reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')['passed'])
            for invalid in (0, 100, float('nan'), float('inf'), True, '14.75'):
                with self.assertRaisesRegex(ValueError, 'lambda'):
                    encode(source, folder/'invalid.jpg', lambda_scale1=invalid)
            with self.assertRaisesRegex(ValueError, 'lambda'):
                encode(source, folder/'invalid.jpg', lambda_scale2=0)
            with self.assertRaisesRegex(RuntimeError, 'lambda'):
                native(['/opt/proof/mozjpeg/hdr-proof-mozjpeg',
                    folder/'float-22.75-mozjpeg-input.raw', folder/'invalid.jpg', '64', '8', '-',
                    'float', '1', '0', '1', 'nan', '16.5'])

    def test_lambda_default_controls_keep_all_twelve_previously_recorded_jpeg_bytes(self):
        from mozjpeg_proof import run, LAMBDA_CORPUS, LAMBDA_OPTIONS
        baseline = json.loads((Path(__file__).parent/'results/mozjpeg-base-experiment.json').read_text())
        expected = {case['case_id']: case['artifacts']['sha256'] for case in baseline['cases']}
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), corpus=LAMBDA_CORPUS, options=LAMBDA_OPTIONS)
            self.assertEqual(len(report['cases']), 12)
            for case in report['cases']:
                self.assertEqual(case['artifacts']['sha256'], expected[case['case_id']], case['case_id'])
                self.assertEqual(case['status'], 'tested and failed')


if __name__ == '__main__':
    unittest.main()
