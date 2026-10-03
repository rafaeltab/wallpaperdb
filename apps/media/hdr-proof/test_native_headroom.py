"""Native and independent reconstruction must use the same display boost."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance
from gainmap import inspect
from gainmap_iso import decode_iso_source
from test_native_gainmap import native
from lossless_jpeg import encode


class NativeHeadroomTests(unittest.TestCase):
    def test_explicit_boost_matches_independent_iso_headroom(self):
        metadata = Path(__file__).parent/'fixtures/gainmap/gainmap-android-iso.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, image in (('base', Image.new('RGB', (32, 32), (64, 128, 192))),
                                ('map', Image.new('RGB', (32, 32), (128, 128, 128)))):
                png = directory/f'{name}.png'
                image.save(png)
                profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes() if name == 'base' else b''
                encode(png, directory/f'{name}.jpg', icc_profile=profile)
            source = directory/'source.jpg'
            packed = native('precise', 'pack', metadata, directory/'base.jpg', directory/'map.jpg', source)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            inspect(source, directory/'reference')
            reference = decode_iso_source(source.read_bytes(), (directory/'reference/map.jpg').read_bytes(), headroom=4)
            raw = directory/'actual.raw'
            decoded = native('precise', 'decode-linear', source, raw, 16)
            self.assertEqual(decoded.returncode, 0, decoded.stderr)
            facts = json.loads(decoded.stdout)
            self.assertEqual(facts['requested_display_boost'], 16)
            self.assertEqual(facts['gamut'], 0)
            actual = np.fromfile(raw, dtype='<f4').reshape(3, facts['height'], facts['width'])
            actual = actual[[2, 0, 1]].transpose(1, 2, 0)*203
            measured = compare_appearance(reference['linear_rgb_nits'], actual,
                reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')
            self.assertTrue(measured['passed'], measured['failures'])
            for invalid in ('nan', 'inf', '0', '0.5', '16junk'):
                with self.subTest(display_boost=invalid):
                    result = native('precise', 'decode-linear', source, raw, invalid)
                    self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
