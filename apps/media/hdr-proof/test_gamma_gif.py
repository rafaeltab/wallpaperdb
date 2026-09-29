"""Real paletted SDR files require explicit binary alpha and verified ICC."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from appearance import compare_appearance, sdr_signal_to_nits
from avif import native, write_png
from gamma_gif import encode, inspect_and_decode
from gamma_icc import decode_signal_to_nits


class GammaGifTests(unittest.TestCase):
    def test_gamma32_nearest_palette_declares_actual_transfer_and_keeps_binary_alpha(self):
        rgba = np.ones((8, 32, 4))
        rgba[..., :3] = np.geomspace(.0001, 1, 32)[None, :, None]
        rgba[:4, :, 3] = 32767 / 65535
        rgba[4:, :, 3] = 32768 / 65535
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output = directory/'source.png', directory/'output.gif'
            write_png(source, rgba)
            native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE', source])
            encode([source], output, gamma=3.2, quantization='nearest')
            facts, frames, profile = inspect_and_decode(output)
            self.assertNotIn(b'HDR-PROOF-PRIVATE', output.read_bytes())
        np.testing.assert_allclose(facts['icc']['gammas'], [3.2] * 3, atol=1 / 65536, rtol=0)
        self.assertEqual(facts['icc']['gamut'], 'srgb')
        self.assertFalse(facts['icc']['gamma22_srgb_primaries'])
        self.assertEqual((facts['width'], facts['height'], facts['depth']), (32, 8, 8))
        self.assertTrue(facts['privacy'])
        expected_alpha = (rgba[..., 3] >= .5).astype(float)
        np.testing.assert_array_equal(frames[0][..., 3], expected_alpha)
        actual = decode_signal_to_nits(frames[0][..., :3], profile, expected_gamma=3.2)
        measured = compare_appearance(sdr_signal_to_nits(rgba[..., :3]), actual,
            reference_gamut='srgb', actual_gamut='rec2020', fixture_class='sdr-8', alpha=expected_alpha)
        self.assertTrue(measured['passed'], measured)
        with self.assertRaisesRegex(ValueError, 'Expected gamma-2.2'):
            decode_signal_to_nits(frames[0][..., :3], profile)

    def test_unknown_gamma_or_quantization_is_rejected_before_native_io(self):
        for arguments in ({'gamma': 1.0}, {'quantization': 'unknown'}):
            with self.subTest(arguments=arguments), self.assertRaisesRegex(ValueError, 'GIF candidate'):
                encode([Path('missing.png')], Path('output.gif'), **arguments)

    def test_static_native_palette_retains_shadow_grade_and_embedded_profile(self):
        rgba = np.ones((16, 32, 4))
        rgba[..., :3] = np.geomspace(.0001, 1, 32)[None, :, None]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output = directory/'source.png', directory/'output.gif'
            write_png(source, rgba)
            native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE',
                    '-XMP-dc:Creator=HDR-PROOF-PRIVATE', source])
            encode([source], output)
            explicit_default = directory/'explicit-default.gif'
            encode([source], explicit_default, gamma=2.2, quantization='native')
            self.assertEqual(output.read_bytes(), explicit_default.read_bytes())
            facts, frames, profile = inspect_and_decode(output)
            self.assertNotIn(b'HDR-PROOF-PRIVATE', output.read_bytes())
        self.assertEqual((facts['width'], facts['height'], facts['depth']), (32, 16, 8))
        self.assertEqual(len(frames), 1)
        self.assertTrue(facts['icc']['gamma22_srgb_primaries'])
        self.assertTrue(facts['privacy'])
        measured = compare_appearance(sdr_signal_to_nits(rgba[..., :3]),
            decode_signal_to_nits(frames[0][..., :3], profile), reference_gamut='srgb',
            actual_gamut='rec2020', fixture_class='sdr-8')
        self.assertTrue(measured['passed'], measured)

    def test_alpha_threshold_precedes_eight_bit_palette_quantization(self):
        rgba = np.ones((8, 8, 4))
        rgba[..., :3] = [.2, .4, .6]
        rgba[:, :4, 3] = 32767 / 65535
        rgba[:, 4:, 3] = 32768 / 65535
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output = directory/'source.png', directory/'output.gif'
            write_png(source, rgba)
            encode([source], output)
            _, frames, profile = inspect_and_decode(output)
        expected_alpha = (rgba[..., 3] >= .5).astype(float)
        np.testing.assert_array_equal(frames[0][..., 3], expected_alpha)
        measured = compare_appearance(sdr_signal_to_nits(rgba[..., :3]),
            decode_signal_to_nits(frames[0][..., :3], profile), reference_gamut='srgb',
            actual_gamut='rec2020', fixture_class='sdr-8', alpha=expected_alpha)
        self.assertTrue(measured['passed'], measured)

    def test_sequence_requires_a_separate_supported_encoder(self):
        with self.assertRaisesRegex(ValueError, 'one explicitly selected frame'):
            encode([Path('first.png'), Path('second.png')], Path('output.gif'))


if __name__ == '__main__':
    unittest.main()
