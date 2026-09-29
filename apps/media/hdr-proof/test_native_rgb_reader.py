"""The separate libavif reader preserves actual JPEG gain-map RGB codes."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from avif import native
from dct_jpeg import encode
from gainmap_iso import decode_iso_source
from appearance import compare_appearance
from rgb_gainmap_reader import decode

ROOT = Path(__file__).parent
HELPER = '/opt/proof/ultrahdr/precise/hdr-proof-uhdr'
READER = '/opt/proof/libavif/rgbreader/avifgainmaputil'


class NativeRgbReaderTests(unittest.TestCase):
    def test_actual_rgb_gray_and_ycbcr_map_codes_survive_native_avif_readback(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rng = np.random.default_rng(284263)
            samples = rng.integers(0, 256, (32, 40, 3), dtype=np.uint8)
            base_png = directory/'base.png'
            Image.new('RGB', (40, 32), (64, 96, 128)).save(base_png)
            encode(base_png, directory/'base.jpg', icc_profile=ImageCms.ImageCmsProfile(
                ImageCms.createProfile('sRGB')).tobytes())
            for coding in ('rgb', 'gray', 'ycbcr'):
                with self.subTest(coding=coding):
                    gain = directory/f'{coding}.jpg'
                    if coding == 'rgb':
                        png = directory/'map.png'
                        Image.fromarray(samples).save(png)
                        encode(png, gain)
                    else:
                        image = Image.fromarray(samples[..., 0] if coding == 'gray' else samples)
                        image.save(gain, quality=100, subsampling=0)
                    source = directory/f'{coding}-source.jpg'
                    native([HELPER, 'pack', ROOT/'fixtures/gainmap/gainmap-android-xmp.jpg',
                            directory/'base.jpg', gain, source])
                    with Image.open(gain) as image:
                        expected = np.asarray(image.convert('RGB'))
                    for label, tool in (('baseline', 'avifgainmaputil'), ('rgbreader', READER)):
                        avif, png = directory/f'{coding}-{label}.avif', directory/f'{coding}-{label}.png'
                        native([tool, 'convert', source, avif, '--cicp', '1/13/0', '--ignore-profile',
                                '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'])
                        native([tool, 'extractgainmap', avif, png])
                        with Image.open(png) as image:
                            actual = np.asarray(image.convert('RGB'))
                        if label == 'rgbreader':
                            np.testing.assert_array_equal(actual, expected)
                            facts = native(['avifdec', '--info', '-c', 'dav1d', avif]).decode()
                            self.assertRegex(facts, r'Gain map\s*:[^\n]+8 bit, YUV444, Full Range, Matrix Coeffs\. 0')
                        elif coding == 'rgb':
                            self.assertGreater(np.count_nonzero(actual != expected), 0)

    def test_disagreeing_or_missing_source_color_facts_are_not_inferred(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = ROOT/'fixtures/gainmap/gainmap-android-iso.jpg'
            with self.assertRaisesRegex(ValueError, 'matching'):
                decode(source, directory/'wrong-gamut', gamut='srgb')
            unknown = directory/'missing-profile.jpg'
            unknown.write_bytes(source.read_bytes())
            native(['exiftool', '-overwrite_original', '-ICC_Profile=', unknown])
            with self.assertRaisesRegex(ValueError, 'ICC'):
                decode(unknown, directory/'missing-profile', gamut='p3')
            self.assertFalse((directory/'wrong-gamut/decoded.avif').exists())
            self.assertFalse((directory/'missing-profile/decoded.avif').exists())

    def test_real_dct_gainmap_hdr_matches_independent_iso_reconstruction(self):
        from gainmap_combine import encode as combine
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = ROOT/'fixtures/gainmap/gainmap-android-xmp.jpg'
            output = directory/'derivative.jpg'
            combine(source, output, 'contain', gamut='srgb', map_policy='moderateoffset',
                    geometry_revision='gainmap-hdr-target-gamut-v1', coding='dct-rgb')
            native([HELPER, 'extract', output, directory/'base.jpg', directory/'map.jpg'])
            reference = decode_iso_source((directory/'base.jpg').read_bytes(), (directory/'map.jpg').read_bytes())
            actual, facts = decode(output, directory/'reader', gamut='srgb')
            measured = compare_appearance(reference['linear_rgb_nits'], actual,
                reference_gamut=reference['gamut'], actual_gamut=facts['gamut'], fixture_class='gainmap-hdr')
            self.assertTrue(measured['passed'], measured['failures'])
            self.assertEqual(facts['cicp'], [1, 16, 0, 1])
            self.assertEqual(facts['consumer_status'], 'pending manual review')
            self.assertEqual(len(facts['reader_binary_sha256']), 64)


if __name__ == '__main__':
    unittest.main()
