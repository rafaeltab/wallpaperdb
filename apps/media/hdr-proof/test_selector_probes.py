"""Tests for selector fixture/reference math; native observations are separate."""

import unittest

import numpy as np

from avif import decode_transfer
from selector_probes import alpha_scene, composed_reference


class SelectorReferenceTests(unittest.TestCase):
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
