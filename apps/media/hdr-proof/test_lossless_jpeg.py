"""Real predictive JPEG encodes and independent emitted-sample checks."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms

from avif import native
from lossless_jpeg import encode


class LosslessJpegTests(unittest.TestCase):
    def test_rgb_and_gray_samples_survive_native_predictive_jpeg(self):
        pixels = np.random.default_rng(284).integers(0, 256, (19, 37, 3), dtype=np.uint8)
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        for components in (1, 3):
            with self.subTest(components=components), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                source, output = directory/'source.png', directory/'lossless.jpg'
                expected = pixels if components == 3 else pixels[..., 0]
                Image.fromarray(expected).save(source)
                evidence = encode(source, output, icc_profile=profile if components == 3 else b'')
                raw = native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', output,
                              '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt',
                              'rgb24' if components == 3 else 'gray', 'pipe:1'])
                actual = np.frombuffer(raw, dtype=np.uint8).reshape(expected.shape)
                np.testing.assert_array_equal(actual, expected)
                with Image.open(output) as image:
                    np.testing.assert_array_equal(np.asarray(image), expected)
                    self.assertEqual(image.info.get('icc_profile', b''), profile if components == 3 else b'')
                tags = json.loads(native(['exiftool', '-json', '-n', '-EncodingProcess', '-BitsPerSample', output]))[0]
                self.assertEqual(tags['EncodingProcess'], 3)
                self.assertEqual(tags['BitsPerSample'], 8)
                self.assertEqual(evidence['components'], components)
                self.assertEqual(evidence['predictor'], 1)
                self.assertEqual(evidence['point_transform'], 0)

    def test_alpha_and_higher_precision_are_rejected_before_encoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, image in [('alpha', Image.new('RGBA', (4, 4), (32, 64, 128, 127))),
                                ('depth16', Image.fromarray(np.full((4, 4), 12345, dtype=np.uint16)))]:
                with self.subTest(name=name):
                    source = directory/f'{name}.png'
                    image.save(source)
                    with self.assertRaises(ValueError):
                        encode(source, directory/'output.jpg')
            transparent = directory/'color-key.png'
            Image.new('RGB', (4, 4), (32, 64, 128)).save(transparent, transparency=(32, 64, 128))
            with self.assertRaises(ValueError):
                encode(transparent, directory/'output.jpg')

    def test_independent_iso_reconstruction_matches_native_lossless_rgb_application(self):
        from appearance import compare_appearance
        from gainmap_iso import decode_iso_source
        levels = np.array([0, 32, 64, 128, 192, 255], dtype=np.uint8)
        base = np.stack(np.meshgrid(levels, levels, indexing='ij'), axis=-1)
        base = np.concatenate([base, np.full((6, 6, 1), 96, np.uint8)], axis=-1)
        gain = np.broadcast_to(levels[None, :, None], (6, 6, 3)).copy()
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, pixels in (('base', base), ('gain', gain)):
                png = directory/f'{name}.png'
                Image.fromarray(pixels).save(png)
                encode(png, directory/f'{name}.jpg', icc_profile=profile if name == 'base' else b'')
            helper = '/opt/proof/ultrahdr/rgb/hdr-proof-uhdr'
            # These native source metadata cases cover uniform and distinct
            # per-channel gains. Equal map/base dimensions isolate predictive
            # JPEG and gain application from unproven resize conventions.
            for name in ('apple-new', 'android-xmp'):
                with self.subTest(metadata=name):
                    source = Path(__file__).parent/f'fixtures/gainmap/gainmap-{name}.jpg'
                    packed = directory/f'{name}.jpg'
                    native([helper, 'pack', source, directory/'base.jpg', directory/'gain.jpg', packed])
                    native([helper, 'extract', packed, directory/'read-base.jpg', directory/'read-gain.jpg'])
                    independent = decode_iso_source((directory/'read-base.jpg').read_bytes(),
                                                    (directory/'read-gain.jpg').read_bytes(), headroom=4)
                    facts = json.loads(native([helper, 'decode-linear', packed, directory/'native.gbrpf32']))
                    actual = np.fromfile(directory/'native.gbrpf32', dtype='<f4').reshape(3, 6, 6)
                    actual = actual.transpose(1, 2, 0)[..., [2, 0, 1]] * 203
                    measured = compare_appearance(independent['linear_rgb_nits'], actual,
                        reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')
                    self.assertEqual(facts['gamut'], 0)
                    self.assertEqual(independent['evidence']['base']['sof'], 3)
                    self.assertEqual(independent['evidence']['gain_map']['sof'], 3)
                    self.assertTrue(measured['passed'], measured)
                    # This maintained reader still rejects predictive JPEG.
                    # Native sample/gain proof must not imply reader support.
                    consumer = subprocess.run(['avifgainmaputil', 'convert', str(packed),
                        str(directory/'consumer.avif'), '--cicp', '1/13/0', '--ignore-profile',
                        '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'],
                        capture_output=True, text=True)
                    self.assertNotEqual(consumer.returncode, 0)
                    self.assertIn('Requested features are incompatible', consumer.stderr)


if __name__ == '__main__':
    unittest.main()
