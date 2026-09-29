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
            self.assertEqual(evidence['icc_sha256'], facts['icc_sha256'])

    def test_unproven_geometry_and_gamut_requests_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)/'out.jpg'
            with self.assertRaises(ValueError):
                encode('unused.jpg', output, 'unknown')
            with self.assertRaises(ValueError):
                encode('unused.jpg', output, 'contain', gamut='unknown')

    def test_gamma32_rgb_jpeg_preserves_authored_sdr_in_srgb_and_p3(self):
        from gainmap_sdr import decode_linear
        for name in ('android-xmp', 'apple-new', 'android-iso'):
            for gamut in (('srgb',) if name == 'android-xmp' else ('srgb', 'p3')):
                with self.subTest(source=name, gamut=gamut), tempfile.TemporaryDirectory() as temporary:
                    source = Path(__file__).parent/f'fixtures/gainmap/gainmap-{name}.jpg'
                    output = Path(temporary)/'gamma32.jpg'
                    evidence = encode(source, output, 'contain', gamut=gamut, gamma=3.2)
                    actual, facts = decode_linear(output, gamut=gamut, gamma=3.2)
                    reference = np.asarray(geometry(source_image(source, 'srgb' if gamut == 'srgb' else 'preserve'), 'contain')) / 255
                    measured = compare_appearance(sdr_signal_to_nits(reference), actual,
                        reference_gamut=gamut, actual_gamut='rec2020', fixture_class='gainmap-sdr')
                    self.assertTrue(measured['passed'], measured)
                    self.assertEqual(evidence['gamma'], 3.2)
                    self.assertEqual(facts['color']['gamut'], gamut)
                    self.assertEqual(facts['jpeg_color_transform'], 0)
                    self.assertTrue(facts['privacy'])
                    self.assertEqual(evidence['icc_sha256'], facts['icc_sha256'])
                    with Image.open(output) as image:
                        self.assertEqual(image.info['icc_profile'][84:100], bytes(16))

    def test_gamma32_native_geometry_records_current_fidelity(self):
        from gainmap_sdr import decode_linear
        for gamut in ('srgb', 'p3'):
            for operation in ('identity', 'fill', 'upscale', 'crop'):
                with self.subTest(gamut=gamut, operation=operation), tempfile.TemporaryDirectory() as temporary:
                    source = Path(__file__).parent/'fixtures/gainmap/gainmap-apple-new.jpg'
                    output = Path(temporary)/'derivative.jpg'
                    encode(source, output, operation, gamut=gamut, gamma=3.2)
                    actual, facts = decode_linear(output, gamut=gamut, gamma=3.2)
                    authored = source_image(source, 'srgb' if gamut == 'srgb' else 'preserve')
                    reference = np.asarray(authored if operation == 'identity' else geometry(authored, operation)) / 255
                    measured = compare_appearance(sdr_signal_to_nits(reference), actual,
                        reference_gamut=gamut, actual_gamut='rec2020', fixture_class='gainmap-sdr')
                    self.assertTrue(measured['passed'], measured)
                    self.assertEqual(actual.shape, reference.shape)
                    self.assertEqual(facts['gamut'], gamut)
                    self.assertEqual(facts['transfer'], 'gamma3.2')

    def test_native_orientation_uses_actual_exif_and_strips_it_from_output(self):
        import shutil
        from avif import native
        from gainmap_sdr import decode_linear
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-apple-new.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            oriented, output = directory/'orientation6.jpg', directory/'baked.jpg'
            shutil.copyfile(source, oriented)
            native(['exiftool', '-overwrite_original', '-Orientation#=6', oriented])
            evidence = encode(oriented, output, 'orientation', gamut='p3', gamma=3.2)
            actual, facts = decode_linear(output, gamut='p3', gamma=3.2)
            reference = np.asarray(geometry(source_image(oriented, 'preserve'), 'orientation', 6)) / 255
            measured = compare_appearance(sdr_signal_to_nits(reference), actual,
                reference_gamut='p3', actual_gamut='rec2020', fixture_class='gainmap-sdr')
            self.assertTrue(measured['passed'], measured)
            self.assertEqual(actual.shape, reference.shape)
            self.assertEqual(evidence['source_orientation'], 6)
            self.assertNotIn('IFD0:Orientation', facts['metadata'])

    def test_native_fractional_cover_preserves_all_authored_bases(self):
        from gainmap_sdr import decode_linear
        for name in ('android-xmp', 'android-iso', 'apple-old', 'apple-new'):
            for selector in ('preserve', 'srgb'):
                with self.subTest(source=name, gamut=selector), tempfile.TemporaryDirectory() as temporary:
                    source = Path(__file__).parent/f'fixtures/gainmap/gainmap-{name}.jpg'
                    gamut = 'srgb' if selector == 'srgb' or name == 'android-xmp' else 'p3'
                    output = Path(temporary)/'cover.jpg'
                    evidence = encode(source, output, 'cover', gamut=gamut, gamma=3.2)
                    actual, facts = decode_linear(output, gamut=gamut, gamma=3.2)
                    reference = np.asarray(geometry(source_image(source, selector), 'cover')) / 255
                    measured = compare_appearance(sdr_signal_to_nits(reference), actual,
                        reference_gamut=gamut, actual_gamut='rec2020', fixture_class='gainmap-sdr')
                    self.assertTrue(measured['passed'], measured)
                    self.assertEqual(actual.shape, (173, 173, 3))
                    self.assertEqual(len(evidence['native_window_axes']), 2)
                    self.assertEqual(facts['gamut'], gamut)
                    self.assertEqual(facts['transfer'], 'gamma3.2')
                    self.assertEqual(facts['depth'], 8)
                    self.assertTrue(facts['privacy'])

    def test_sof3_rgb_component_ids_establish_coding_without_adobe_marker(self):
        from PIL import ImageCms
        from lossless_jpeg import encode as lossless_encode
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source, output = directory/'source.png', directory/'predictive.jpg'
            pixels = np.random.default_rng(263).integers(0, 256, (11, 17, 3), dtype=np.uint8)
            Image.fromarray(pixels).save(source)
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            lossless_encode(source, output, icc_profile=profile)
            # The native gain-map packer omits Adobe metadata. Remove only
            # that declaration here, preserving the real predictive scan.
            data, offset, header = output.read_bytes(), 2, b'\xff\xd8'
            while data[offset:offset+2] != b'\xff\xda':
                size = int.from_bytes(data[offset+2:offset+4], 'big')
                if data[offset:offset+2] != b'\xff\xee':
                    header += data[offset:offset+size+2]
                offset += size + 2
            output.write_bytes(header + data[offset:])
            actual, facts = decode(output)
            np.testing.assert_array_equal(np.rint(actual * 255).astype(np.uint8), pixels)
            self.assertEqual(facts['sof'], 3)
            self.assertIsNone(facts['jpeg_color_transform'])
            self.assertEqual(facts['jpeg_color_model'], 'SOF3 RGB component identifiers with verified RGB ICC')


if __name__ == '__main__':
    unittest.main()
