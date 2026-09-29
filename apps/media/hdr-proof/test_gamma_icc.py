"""Native gamma-coded SDR files require verified ICC semantics and pixels."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from appearance import RGB_TO_XYZ, compare_appearance, sdr_signal_to_nits
from avif import digest, native, read_png, write_png
from gamma_icc import make_profile, profile_facts, encode, inspect_and_decode, decode_signal_to_nits


class GammaIccTests(unittest.TestCase):
    def test_legacy_default_native_codec_bytes_remain_unchanged(self):
        # Recorded before introducing the opt-in quantizer, at 42e68ff9, in
        # the pinned proof image. The deterministic stimulus uses native PNG16.
        expected = {
            'static-jpeg': '29d0767b7035d155defb36a7ba601f4457436a7614137952c6523a46d1ee4f5f',
            'static-webp': '162f6293d32481d2de0375396e123b2db92845eb1e003c434488300ab972f11e',
            'animated-webp': 'c0a25f60f02b21a9ea32bb2317e8380e8e588b46ab634cb12f23e374814b77d7',
        }
        first = np.ones((16, 32, 4))
        first[..., :3] = [.0014, .25, .885]
        first[..., 3] = np.linspace(0, 1, 32)
        second = first.copy()
        second[..., :3] = [.2, .4, .6]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = [root/'first.png', root/'second.png']
            for path, pixels in zip(paths, (first, second)):
                write_png(path, pixels)
            for label, extension, inputs in (('static-jpeg', 'jpg', paths[:1]),
                                             ('static-webp', 'webp', paths[:1]),
                                             ('animated-webp', 'webp', paths)):
                with self.subTest(candidate=label):
                    output = root/f'{label}.{extension}'
                    encode(inputs, output, extension)
                    self.assertEqual(digest(output), expected[label])

    def test_native_nearest_quantizer_matches_independent_integer_rounding(self):
        # Exhaust every sixteen-bit alpha code, with changing straight RGB.
        ramp = np.arange(65536, dtype=float).reshape(256, 256) / 65535
        pixels = np.stack((ramp, ramp.T, 1 - ramp, np.roll(ramp, 47, axis=1)), axis=-1)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, output = root/'source.png', root/'nearest.webp'
            write_png(source, pixels)
            encode([source], output, 'webp', quantization='nearest')
            gamma16 = read_png(root/'nearest-gamma22-0.png')
            gamma8 = read_png(root/'nearest-gamma22-8-0.png')
            expected = np.rint(gamma16 * 255) / 255
            np.testing.assert_array_equal(gamma8, expected)
            self.assertLessEqual(float(np.max(np.abs(gamma8 - gamma16))), .5 / 255)
            _, frames, _ = inspect_and_decode(output)
            np.testing.assert_array_equal(frames[0], expected)

    def test_new_explicit_gamma_and_gamut_profiles_preserve_legacy_default_bytes(self):
        import hashlib
        self.assertEqual(hashlib.sha256(make_profile()).hexdigest(),
                         'd7b8387fdd626cc24b118014a6b7fb03396fe2486b262661e61f5658f92a8e45')
        signal = np.array([[.5, .5, .5], [.1, .3, .7], [1, 0, 0]])
        for gamut in ('srgb', 'p3'):
            with self.subTest(gamut=gamut):
                profile = make_profile(gamma=3.2, gamut=gamut)
                facts = profile_facts(profile)
                self.assertFalse(facts['gamma22_srgb_primaries'])
                self.assertEqual(facts['gamut'], gamut)
                np.testing.assert_allclose(facts['gammas'], [3.2] * 3, atol=1/65536)
                expected = (100 * signal ** 3.2) @ RGB_TO_XYZ[gamut].T @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T
                actual = decode_signal_to_nits(signal, profile, expected_gamma=3.2, expected_gamut=gamut)
                np.testing.assert_allclose(actual, expected, atol=.003, rtol=3e-5)
                with self.assertRaises(ValueError):
                    decode_signal_to_nits(signal, profile)
                with self.assertRaises(ValueError):
                    decode_signal_to_nits(signal, profile, expected_gamma=2.8, expected_gamut=gamut)

    def test_invalid_requested_profile_parameters_are_rejected(self):
        for gamma in (0, -1, float('nan'), float('inf')):
            with self.subTest(gamma=gamma), self.assertRaises(ValueError):
                make_profile(gamma=gamma)
        with self.assertRaises(ValueError):
            make_profile(gamut='unknown')

    def test_native_profile_is_deterministic_with_verified_gamma_and_colorants(self):
        first, second = make_profile(), make_profile()
        self.assertEqual(first, second)
        facts = profile_facts(first)
        np.testing.assert_allclose(facts['gammas'], [2.2] * 3, atol=1 / 65536)
        np.testing.assert_allclose(facts['rgb_to_xyz_d65'], RGB_TO_XYZ['srgb'], atol=3e-5)
        self.assertTrue(facts['gamma22_srgb_primaries'])
        self.assertEqual(facts['creation_date'], [2020, 1, 1, 0, 0, 0])

    def test_profile_rejects_altered_curve_even_when_description_is_unchanged(self):
        import struct
        profile = bytearray(make_profile())
        count = struct.unpack_from('>I', profile, 128)[0]
        for index in range(count):
            name, offset, length = struct.unpack_from('>4sII', profile, 132 + index * 12)
            if name == b'rTRC':
                struct.pack_into('>i', profile, offset + 12, int(3 * 65536))
                break
        self.assertFalse(profile_facts(profile)['gamma22_srgb_primaries'])
        with self.assertRaisesRegex(ValueError, 'gamma-2.2'):
            decode_signal_to_nits(np.array([[.5, .5, .5]]), profile)

    def test_profile_rejects_altered_colorant_and_truncated_tag_table(self):
        import struct
        profile = bytearray(make_profile())
        count = struct.unpack_from('>I', profile, 128)[0]
        for index in range(count):
            name, offset, length = struct.unpack_from('>4sII', profile, 132 + index * 12)
            if name == b'rXYZ':
                struct.pack_into('>i', profile, offset + 8, int(.9 * 65536))
                break
        self.assertFalse(profile_facts(profile)['gamma22_srgb_primaries'])
        with self.assertRaisesRegex(ValueError, 'gamma-2.2'):
            decode_signal_to_nits(np.array([[.5, .5, .5]]), profile)
        with self.assertRaises(ValueError):
            profile_facts(profile[:135])

    def test_profile_rejects_duplicate_tags_and_competing_transform_tables(self):
        for replacement in (b'A2B0', b'B2A0', b'D2B1', b'B2D1'):
            with self.subTest(replacement=replacement):
                profile = bytearray(make_profile())
                profile[132:136] = replacement
                with self.assertRaises(ValueError):
                    profile_facts(profile)
        profile = bytearray(make_profile())
        profile[144:148] = profile[132:136]
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            profile_facts(profile)

    def test_profile_rejects_changed_class_flags_or_d50_white_assumptions(self):
        import struct
        for offset, value in ((12, b'link'), (44, struct.pack('>I', 1)),
                              (68, struct.pack('>i', 32768))):
            with self.subTest(offset=offset):
                profile = bytearray(make_profile())
                profile[offset:offset + len(value)] = value
                with self.assertRaises(ValueError):
                    profile_facts(profile)
        profile = bytearray(make_profile())
        count = struct.unpack_from('>I', profile, 128)[0]
        for index in range(count):
            name, offset, length = struct.unpack_from('>4sII', profile, 132 + index * 12)
            if name == b'wtpt':
                struct.pack_into('>i', profile, offset + 8, 32768)
                break
        with self.assertRaises(ValueError):
            profile_facts(profile)

    def test_profile_equations_match_independent_native_lcms_double_xyz_decode(self):
        import ctypes
        for gamma, gamut in ((2.2, 'srgb'), (3.2, 'srgb'), (3.2, 'p3')):
            profile = make_profile(gamma=gamma, gamut=gamut)
            facts = profile_facts(profile)
            library = ctypes.CDLL('liblcms2.so.2')
            library.cmsOpenProfileFromMem.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            library.cmsOpenProfileFromMem.restype = ctypes.c_void_p
            library.cmsCreateXYZProfile.restype = ctypes.c_void_p
            library.cmsCreateTransform.argtypes = [ctypes.c_void_p, ctypes.c_uint32,
                ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32]
            library.cmsCreateTransform.restype = ctypes.c_void_p
            library.cmsDoTransform.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32]
            library.cmsDeleteTransform.argtypes = [ctypes.c_void_p]
            library.cmsCloseProfile.argtypes = [ctypes.c_void_p]
            source_profile = library.cmsOpenProfileFromMem(profile, len(profile))
            target_profile = library.cmsCreateXYZProfile()
            # lcms2.h TYPE_RGB_DBL / TYPE_XYZ_DBL. Disable interpolation optimization
            # and caches so this control measures the actual profile equations.
            transform = library.cmsCreateTransform(source_profile, 0x440018,
                target_profile, 0x490018, 1, 0x100 | 0x40)
            self.assertTrue(transform)
            signal = np.array([[0, 0, 0], [1, 1, 1], [.5, .5, .5],
                               [1, 0, 0], [0, 1, 0], [0, 0, 1], [.001, .3, .8]], dtype=np.float64)
            actual = np.empty_like(signal)
            try:
                library.cmsDoTransform(transform, signal.ctypes.data, actual.ctypes.data, len(signal))
            finally:
                library.cmsDeleteTransform(transform)
                library.cmsCloseProfile(source_profile)
                library.cmsCloseProfile(target_profile)
            expected = signal ** np.asarray(facts['gammas']) @ np.asarray(facts['rgb_to_xyz_d50']).T
            np.testing.assert_allclose(actual, expected, atol=1e-6)

    def test_jpeg_and_webp_retain_the_same_sdr_grade_with_actual_profile_signaling(self):
        rgba = np.ones((16, 32, 4))
        rgba[..., :3] = np.geomspace(.0001, 1, 32)[None, :, None]
        for extension in ('jpg', 'webp'):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                directory = Path(directory)
                source, output = directory/'source.png', directory/f'output.{extension}'
                write_png(source, rgba)
                native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE',
                        '-XMP-dc:Creator=HDR-PROOF-PRIVATE', source])
                encode([source], output, extension)
                facts, frames, profile = inspect_and_decode(output)
                self.assertEqual((facts['width'], facts['height'], facts['depth']), (32, 16, 8))
                self.assertEqual(len(frames), 1)
                self.assertTrue(facts['icc']['gamma22_srgb_primaries'])
                self.assertTrue(facts['privacy'])
                self.assertNotIn(b'HDR-PROOF-PRIVATE', output.read_bytes())
                measurement = compare_appearance(sdr_signal_to_nits(rgba[..., :3]),
                    decode_signal_to_nits(frames[0][..., :3], profile),
                    reference_gamut='srgb', actual_gamut='rec2020', fixture_class='sdr-8')
                self.assertTrue(measurement['passed'], measurement)

    def test_animated_webp_retains_fractional_alpha_duration_loop_and_profile(self):
        first = np.ones((16, 32, 4))
        first[..., :3] = [.0014, .25, .885]
        first[..., 3] = np.linspace(0, 1, 32)
        second = first.copy()
        second[..., :3] = [.2, .4, .6]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            paths = [directory/'first.png', directory/'second.png']
            for path, rgba in zip(paths, (first, second)):
                write_png(path, rgba)
            output = directory/'sequence.webp'
            encode(paths, output, 'webp')
            facts, frames, profile = inspect_and_decode(output)
        self.assertEqual(facts['durations_ms'], [300, 700])
        self.assertEqual(facts['loop'], 3)
        self.assertEqual(len(frames), 2)
        for actual, reference in zip(frames, (first, second)):
            np.testing.assert_allclose(actual[..., 3], reference[..., 3], atol=2 / 255)
            measured = compare_appearance(sdr_signal_to_nits(reference[..., :3]),
                decode_signal_to_nits(actual[..., :3], profile), reference_gamut='srgb',
                actual_gamut='rec2020', fixture_class='sdr-8', alpha=reference[..., 3])
            self.assertTrue(measured['passed'], measured)

    def test_webp_retains_rgb_when_positive_alpha_rounds_to_zero(self):
        rgba = np.ones((8, 8, 4))
        rgba[..., :3] = [.2, .4, .6]
        rgba[:, :4, 3] = .0001
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output = directory/'source.png', directory/'output.webp'
            write_png(source, rgba)
            encode([source], output, 'webp')
            facts, frames, profile = inspect_and_decode(output)
        self.assertEqual(frames[0][0, 0, 3], 0)
        measured = compare_appearance(sdr_signal_to_nits(rgba[..., :3]),
            decode_signal_to_nits(frames[0][..., :3], profile), reference_gamut='srgb',
            actual_gamut='rec2020', fixture_class='sdr-8', alpha=rgba[..., 3])
        self.assertTrue(measured['passed'], measured)


if __name__ == '__main__':
    unittest.main()
