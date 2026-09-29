"""Native coefficient observations cannot promote a failed JPEG candidate."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from PIL import Image

import mozjpeg
import mozjpeg_diagnostics as diagnostic
from mozjpeg_proof import run, LAMBDA_OPTIONS, LAMBDAS


class MozjpegDiagnosticTests(unittest.TestCase):
    def test_native_reader_returns_actual_constant_block_coefficients(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, output = folder/'source.png', folder/'output.jpg'
            Image.new('RGB', (16, 8), (0, 64, 255)).save(source)
            mozjpeg.encode(source, output)
            facts = diagnostic.coefficients(output, (0, 0), (15, 7))
            self.assertEqual([facts['width'], facts['height']], [16, 8])
            self.assertEqual([c['id'] for c in facts['components']], [82, 71, 66])
            for component, code in zip(facts['components'], (0, 64, 255)):
                self.assertEqual(component['quantization'], [1]*64)
                self.assertEqual(component['dc'], [[8*(code-128)]*2])
                self.assertEqual(component['blocks'], [[8*(code-128)]+[0]*63]*2)
            with self.assertRaisesRegex(ValueError, 'coordinates'):
                diagnostic.coefficients(output, (-1, 0), (0, 0))
            with self.assertRaisesRegex(RuntimeError, 'coordinates'):
                diagnostic.coefficients(output, (16, 0), (0, 0))
            gray = folder/'gray.jpg'
            Image.new('L', (8, 8), 0).save(gray)
            with self.assertRaisesRegex(RuntimeError, 'RGB8'):
                diagnostic.coefficients(gray, (0, 0), (0, 0))

    def test_real_failed_iso_candidates_keep_diagnostic_scope_and_input_integrity(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            corpus = (('gainmap-android-iso', 'upscale'),)
            baseline = run(folder/'baseline', corpus=corpus,
                options=(('islow', False, False), ('islow', True, False),
                         ('float', False, False), ('float', True, False)))
            lambdas = run(folder/'lambdas', corpus=corpus, options=LAMBDA_OPTIONS, lambdas=LAMBDAS)
            result = diagnostic.run(folder/'diagnosis', baseline, lambdas, corpus=corpus)
            self.assertEqual(result['qualification_scope'], 'none; diagnostic only')
            self.assertEqual(len(result['cases']), 1)
            profiles = result['cases'][0]['profiles']
            self.assertEqual(len(profiles), 8)
            self.assertTrue(all(p['input_status'] == 'tested and failed' for p in profiles))
            self.assertTrue(all(p['worst_pixel']['native_authored_rgb8'] == p['worst_pixel']['reference_rgb8']
                                for p in profiles))
            changed = [p for p in profiles if p['options'].get('lambda_scale1', 14.75) != 14.75]
            self.assertTrue(all(p['bytes_changed_from_default_lambda'] for p in changed))
            self.assertTrue(all(p['fixed_block_ac_changes_from_default_lambda'] > 0 for p in changed))
            self.assertTrue(all(p['unchanged_dc_blocks']['failing_pixel_count'] > 0 for p in changed))
            self.assertTrue(result['commands'])
            self.assertTrue(result['native_reader_binary_sha256'])
            tampered = deepcopy(lambdas)
            tampered['cases'][1]['artifacts']['sha256'] = '0'*64
            with self.assertRaisesRegex(ValueError, 'output hash'):
                diagnostic.run(folder/'tampered', baseline, tampered, corpus=corpus)


if __name__ == '__main__':
    unittest.main()
