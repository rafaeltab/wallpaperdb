"""Tests for selector fixture/reference math; native observations are separate."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from avif import decode_avif, decode_transfer, encode_avif, write_png
from selector_probes import THRESHOLDS, _compose, _source, alpha_scene, composed_reference


class SelectorReferenceTests(unittest.TestCase):
    def test_native_background_composition_preserves_hdr_color_and_fractional_alpha(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, decoded, transfer, gamut, depth = _source(folder, 'hdr')
            for background in ((255, 255, 255), (255, 0, 0), (32, 128, 224)):
                with self.subTest(background=background):
                    decode_avif(source, folder, 1)
                    pixels = np.ones_like(decoded)
                    pixels[..., :3] = np.array(background)/255
                    write_png(folder/'background.png', pixels)
                    _compose(folder/'decoded-0.png', folder/'background.png', folder/'composed.png', transfer, gamut)
                    encode_avif([folder/'composed.png'], folder/'composed.avif', transfer, gamut, depth)
                    actual = decode_avif(folder/'composed.avif', folder, 1)[0]
                    reference = composed_reference(decoded, background, 'hdr')
                    error = float(np.max(np.abs(actual[..., :3]-reference)))
                    self.assertLessEqual(error, THRESHOLDS['hdr_pq_signal_max_error'])
                    self.assertTrue(np.all(actual[..., 3] == 1))

    def test_fully_transparent_hdr_white_is_reference_white(self):
        source = alpha_scene("hdr")
        signal = composed_reference(source, (255, 255, 255), "hdr")
        linear = decode_transfer(signal, "pq", "rec2020")
        np.testing.assert_allclose(linear[:, :8], 203, atol=1e-8)

    def test_opaque_source_does_not_change_with_a_background(self):
        for dynamic_range in ("hdr", "sdr"):
            source = alpha_scene(dynamic_range)
            signal = composed_reference(source, (255, 0, 0), dynamic_range)
            np.testing.assert_allclose(signal[:, 32:], source[:, 32:, :3], atol=1e-12)

    def test_fractional_hdr_alpha_composes_in_linear_light(self):
        source = alpha_scene("hdr")
        signal = composed_reference(source, (255, 255, 255), "hdr")
        linear = decode_transfer(signal, "pq", "rec2020")
        np.testing.assert_allclose(linear[:, 16:24], np.broadcast_to(np.array([116.5, 151.5, 203]), (16, 8, 3)), atol=1e-8)

    def test_background_red_is_converted_to_rec2020_primaries(self):
        signal = composed_reference(alpha_scene("hdr"), (255, 0, 0), "hdr")
        linear = decode_transfer(signal, "pq", "rec2020")
        expected = np.array([0.627403896, 0.069097289, 0.016391439])*203
        np.testing.assert_allclose(linear[0, 0], expected, atol=1e-6)


if __name__ == "__main__":
    unittest.main()
