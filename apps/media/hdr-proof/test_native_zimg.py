"""Fractional crop boundaries must retain samples in the filter's support."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageOps

from appearance import compare_appearance, sdr_signal_to_nits
from avif import read_png
from native_zimg import cover


class NativeWindowTests(unittest.TestCase):
    def test_fractional_cover_matches_independent_separable_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for width, height in ((403, 302), (384, 512)):
                with self.subTest(size=(width, height)):
                    # Opaque coded input with ramps, edges and a dark boundary.
                    x, y = np.meshgrid(np.arange(width), np.arange(height))
                    pixels = np.stack((x * 255 // (width-1), y * 255 // (height-1),
                                       ((x//9+y//11) % 2)*255), axis=-1).astype(np.uint8)
                    pixels[height//2:height//2+7, width//2:width//2+9] = 1
                    source, output = directory/'input.rgb', directory/'output.png'
                    source.write_bytes(pixels.tobytes())
                    cover(source, output, width, height, size=173)
                    actual = read_png(output)[..., :3]
                    reference = np.asarray(ImageOps.fit(Image.fromarray(pixels), (173, 173),
                                                        method=Image.Resampling.LANCZOS)) / 255
                    result = compare_appearance(sdr_signal_to_nits(reference), sdr_signal_to_nits(actual),
                        reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
                    self.assertTrue(result['passed'], result['failures'])

    def test_invalid_dimensions_fail_before_a_native_call(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):
                cover(Path(temporary)/'missing.rgb', Path(temporary)/'output.png', 0, 12)
