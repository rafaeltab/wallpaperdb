"""Native authored-SDR geometry and independently decoded RGB JPEG controls."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from appearance import compare_appearance, sdr_signal_to_nits
from avif import read_png
from gainmap import geometry, source_image
from gainmap_sdr import encode, decode, prepare


class AuthoredSdrTests(unittest.TestCase):
    def test_native_float_boundaries_preserve_all_authored_rgb8_codes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pixels = np.broadcast_to(np.arange(256, dtype=np.uint8)[None, :, None], (8, 256, 3)).copy()
            source, output = directory/'input.png', directory/'identity.png'
            Image.fromarray(pixels).save(source)
            prepare(source, output, 'identity')
            actual = np.rint(read_png(output)[..., :3] * 255).astype(np.uint8)
            np.testing.assert_array_equal(actual, pixels)

    def test_android_authored_sdr_contain_passes_unchanged_appearance_gates(self):
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-xmp.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)/'authored.jpg'
            evidence = encode(source, output, 'contain')
            actual, facts = decode(output)
            reference = np.asarray(geometry(source_image(source, 'srgb'), 'contain')) / 255
            measured = compare_appearance(sdr_signal_to_nits(reference), sdr_signal_to_nits(actual),
                reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
            self.assertTrue(measured['passed'], measured)
            self.assertEqual(actual.shape, reference.shape)
            self.assertEqual(facts['color']['gamut'], 'srgb')
            self.assertEqual(facts['color']['transfer'], 'srgb')
            self.assertEqual(facts['depth'], 8)
            self.assertEqual(facts['jpeg_color_transform'], 0)
            self.assertTrue(facts['privacy'])
            self.assertEqual(facts['decoder'], 'FFmpeg native MJPEG decoder')
            self.assertEqual(evidence['coding'], 'RGB JPEG quality100; sRGB transfer and primaries')

    def test_unproven_geometry_and_gamut_requests_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)/'out.jpg'
            with self.assertRaises(ValueError):
                encode('unused.jpg', output, 'cover')
            with self.assertRaises(ValueError):
                encode('unused.jpg', output, 'contain', gamut='p3')


if __name__ == '__main__':
    unittest.main()
