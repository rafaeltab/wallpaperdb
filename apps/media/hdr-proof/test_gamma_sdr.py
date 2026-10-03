"""Real gamma-2.2 SDR encodes retain the same independently declared grade."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from appearance import compare_appearance, sdr_signal_to_nits
from avif import decode_avif, inspect_avif, native, read_png, write_png
from gamma_sdr import convert, decode_signal_to_nits, encode


class GammaSdrTests(unittest.TestCase):
    def test_declared_gamma_signal_decodes_to_known_display_luminance(self):
        np.testing.assert_allclose(decode_signal_to_nits(np.array([0, .5, 1])),
                                   [0, 21.7637640824, 100], atol=1e-9)
        for signal in (np.array([-0.1]), np.array([1.1]), np.array([np.nan])):
            with self.subTest(signal=signal), self.assertRaises(ValueError):
                decode_signal_to_nits(signal)

    def test_native_transfer_conversion_retains_straight_colors_and_alpha(self):
        rgba = np.empty((16, 32, 4))
        rgba[..., :3] = [.0014, .25, .885]
        rgba[..., 3] = np.linspace(0, 1, 32)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output = directory/'source.png', directory/'gamma.png'
            write_png(source, rgba)
            source_rgba = read_png(source)
            convert(source, output)
            actual = read_png(output)
        np.testing.assert_allclose(actual[..., :3],
            (sdr_signal_to_nits(source_rgba[..., :3]) / 100) ** (1 / 2.2), atol=2 / 65535)
        np.testing.assert_array_equal(actual[..., 3], source_rgba[..., 3])

    def test_native_eight_bit_avif_retains_shadow_precision_signaling_and_private_metadata(self):
        rgba = np.ones((16, 32, 4))
        rgba[..., :3] = np.geomspace(.0001, 1, 32)[None, :, None]
        rgba[8:, :, 3] = .5
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output = directory/'source.png', directory/'gamma.avif'
            write_png(source, rgba)
            native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE',
                    '-XMP-dc:Creator=HDR-PROOF-PRIVATE', source])
            encode([source], output)
            decoded = decode_avif(output, directory, 1)[0]
            facts = inspect_avif(output)
        self.assertEqual((facts['width'], facts['height'], facts['depth']), (32, 16, 8))
        self.assertEqual((facts['primaries'], facts['transfer'], facts['matrix']), (1, 4, 0))
        self.assertEqual(facts['exiftool']['TransferCharacteristics'], 4)
        self.assertNotIn('HDR-PROOF-PRIVATE', str(facts))
        self.assertIn('Transformations: None', facts['info'])
        np.testing.assert_allclose(decoded[..., 3], rgba[..., 3], atol=2 / 255)
        measured = compare_appearance(sdr_signal_to_nits(rgba[..., :3]),
            decode_signal_to_nits(decoded[..., :3]), reference_gamut='srgb',
            actual_gamut='srgb', fixture_class='sdr-8', alpha=rgba[..., 3])
        self.assertTrue(measured['passed'], measured)

    def test_native_sequence_retains_timing_loop_and_fractional_alpha(self):
        rgba = np.full((8, 8, 4), .5)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            first, second = directory/'first.png', directory/'second.png'
            write_png(first, rgba)
            rgba[..., :3] = .9
            write_png(second, rgba)
            output = directory/'sequence.avif'
            encode([first, second], output)
            frames = decode_avif(output, directory, 2)
            facts = inspect_avif(output)
        from avif import timing
        self.assertEqual(timing(facts), [3, 7])
        self.assertIn('Repeat Count   : 2', facts['info'])
        self.assertEqual(len(frames), 2)
        for frame in frames:
            np.testing.assert_allclose(frame[..., 3], .5, atol=2 / 255)


if __name__ == '__main__':
    unittest.main()
