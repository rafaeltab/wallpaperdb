"""Native alpha geometry keeps exact binary decisions separate from color."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

import avif
from gif_alpha import apply_alpha_geometry


class GifAlphaTests(unittest.TestCase):
    def test_half_opacity_after_resize_rounds_up_without_changing_color_codes(self):
        first = avif.make_scene(True)
        second = first.copy()
        second[32:] = np.roll(second[32:], 16, axis=1)
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for index, frame in enumerate((first, second)):
                original = folder/f'source-{index}.png'
                signal = frame.copy()
                signal[..., :3] = avif.encode_transfer(frame[..., :3], 'pq', 'p3')
                avif.write_png(original, signal)
                coded_source = avif.read_png(original)
                for geometry in ('identity', 'contain', 'cover', 'fill', 'upscale', 'orientation'):
                    with self.subTest(frame=index, geometry=geometry):
                        source = original
                        if geometry == 'orientation':
                            source = folder/f'rotated-{index}.png'
                            avif.native(['ffmpeg', '-v', 'error', '-y', '-i', original,
                                '-vf', 'transpose=cclock', '-frames:v', '1', '-threads', '1', source])
                        expected = avif.geometry_reference(coded_source, geometry)
                        colors = np.ones_like(expected)
                        colors[..., :3] = np.random.default_rng(123).random(expected[..., :3].shape)
                        colors[..., 3] = 0
                        converted, output = folder/'converted.png', folder/'output.png'
                        avif.write_png(converted, colors)
                        apply_alpha_geometry(source, converted, output, geometry)
                        actual = avif.read_png(output)
                        np.testing.assert_array_equal(actual[..., :3], avif.read_png(converted)[..., :3])
                        self.assertLessEqual(float(np.max(np.abs(actual[..., 3] - expected[..., 3]))), 2 / 65535)
                        np.testing.assert_array_equal(actual[..., 3] >= .5, expected[..., 3] >= .5)
                        if index == 1 and geometry == 'contain':
                            self.assertEqual(expected[37, 9, 3], .5)
                            self.assertEqual(actual[37, 9, 3], 32768 / 65535)

    def test_identity_keeps_both_codes_straddling_half_opacity(self):
        source_pixels = np.ones((8, 8, 4))
        source_pixels[..., 3] = np.array([32766, 32767, 32768, 32769] * 2) / 65535
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, output = folder/'source.png', folder/'output.png'
            avif.write_png(source, source_pixels)
            apply_alpha_geometry(source, source, output, 'identity')
            np.testing.assert_array_equal(avif.read_png(output), avif.read_png(source))


if __name__ == '__main__':
    unittest.main()
