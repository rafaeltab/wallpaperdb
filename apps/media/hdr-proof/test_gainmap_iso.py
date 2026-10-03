"""Independent ISO parsing and arithmetic checks with real native JPEG pixels.

Literal nits below are analytic vectors declared independently of any candidate
output. The cross-reader control uses libavif's XMP reader and gain-map math;
libultrahdr only packs the two original compressed JPEG layers.
"""
import io
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms

from appearance import RGB_TO_XYZ
from gainmap_iso import ISO_ID, iso_metadata, reconstruct


def jpeg(level):
    buffer = io.BytesIO()
    Image.new('L', (8, 8), level).save(buffer, format='JPEG', quality=100)
    return buffer.getvalue()


def metadata_jpeg(image, *, channels=((0, 2, 1, 0, 0),), base=0, alternate=2,
                  common=False, flags=0, extra=b''):
    # This test-only byte fixture uses integer/eighth fractions, not the
    # production metadata parser or any native encoder's metadata writer.
    flags |= 64 | (128 if len(channels) == 3 else 0) | (8 if common else 0)
    payload = struct.pack('>HHB', 0, 0, flags)
    if common:
        payload += struct.pack('>I', 8)
    for value, signed in [(base, False), (alternate, False)] + [
            (v, i in (0, 1, 3, 4)) for channel in channels for i, v in enumerate(channel)]:
        payload += int(value * 8).to_bytes(4, 'big', signed=signed)
        if not common:
            payload += struct.pack('>I', 8)
    payload = ISO_ID + payload + extra
    return image[:2] + b'\xff\xe2' + struct.pack('>H', len(payload) + 2) + payload + image[2:]


class IsoGainMapTests(unittest.TestCase):
    def test_common_and_separate_fraction_layouts_preserve_distinct_channels(self):
        channels = ((-1, 2, 2, .25, -.25), (0, 3, .5, 0, .25), (1, 4, 1, -.25, 0))
        records = [iso_metadata(metadata_jpeg(jpeg(255), channels=channels, common=common))
                   for common in (False, True)]
        self.assertEqual(records[0], records[1])
        for actual, expected in zip(records[0]['channels'], channels):
            self.assertEqual(list(actual.values()), list(expected))

    def test_native_jpeg_endpoints_and_half_headroom_have_known_luminance(self):
        base = jpeg(255)
        channels = ((0, 0, 1, 0, 0), (0, 2, 1, 0, 0), (0, 4, 1, 0, 0))
        gain = metadata_jpeg(jpeg(255), channels=channels)
        for headroom, expected in [(0, [203, 203, 203]), (1, [203, 406, 812]),
                                   (2, [203, 812, 3248]), (7, [203, 812, 3248])]:
            with self.subTest(headroom=headroom):
                actual, _ = reconstruct(base, gain, headroom=headroom)
                np.testing.assert_allclose(actual, np.broadcast_to(expected, actual.shape), atol=1e-10)
        actual, _ = reconstruct(base, metadata_jpeg(jpeg(0)), headroom=2)
        np.testing.assert_allclose(actual, 203, atol=1e-10)

    def test_nonlinear_gamma_and_signed_offsets_match_analytic_vectors(self):
        # Native grayscale JPEG preserves these DC codes exactly. At code64,
        # gain gamma2 and gamma1/2 give the independently evaluated nits below.
        for gamma, expected in [(2, 483.5050219173262), (.5, 125.71125848813)]:
            with self.subTest(gamma=gamma):
                gain = metadata_jpeg(jpeg(64), channels=((-1, 3, gamma, .25, .125),))
                actual, _ = reconstruct(jpeg(255), gain, headroom=2)
                np.testing.assert_allclose(actual, expected, atol=1e-9)

    def test_base_headroom_returns_authored_base_even_with_unequal_offsets(self):
        gain = metadata_jpeg(jpeg(255), base=1, alternate=3, channels=((0, 2, 1, .25, 0),))
        for headroom in (0, 1):
            actual, _ = reconstruct(jpeg(255), gain, headroom=headroom)
            np.testing.assert_allclose(actual, 203, atol=1e-10)

    def test_zero_weight_matches_native_libavif_with_unequal_offsets(self):
        from test_native_gainmap import native
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-xmp.jpg'
        # An equal-length XMP change keeps the original MPF offsets intact.
        original = source.read_bytes()
        token = b'hdrgm:OffsetSDR="0"'
        self.assertEqual(original.count(token), 1)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            metadata_source = directory/'offset-source.jpg'
            metadata_source.write_bytes(original.replace(token, b'hdrgm:OffsetSDR="1"'))
            base, gain, dual = (directory/name for name in ('base.jpg', 'gain.jpg', 'dual.jpg'))
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            Image.new('RGB', (8, 8), 'white').save(base, quality=100, icc_profile=profile)
            gain.write_bytes(jpeg(255))
            packed = native('both', 'pack', metadata_source, base, gain, dual)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            extracted = native('both', 'extract', dual, base, gain)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            metadata = iso_metadata(gain.read_bytes())
            self.assertEqual(metadata['channels'][0]['base_offset'], 1)
            self.assertEqual(metadata['channels'][0]['alternate_offset'], 0)
            avif, output = directory/'gain.avif', directory/'base-only.png'
            for arguments in [
                    ['avifgainmaputil', 'convert', dual, avif, '--cicp', '1/13/0', '--ignore-profile',
                     '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'],
                    ['avifgainmaputil', 'tonemap', avif, output, '--headroom', '0',
                     '--cicp-output', '1/13/0', '--ignore-profile', '-d', '8', '-y', '444']]:
                subprocess.run(list(map(str, arguments)), check=True, capture_output=True, timeout=30)
            np.testing.assert_array_equal(np.asarray(Image.open(output).convert('RGB')), 255)
            actual, _ = reconstruct(base.read_bytes(), gain.read_bytes(), headroom=0)
            np.testing.assert_allclose(actual, 203, atol=1e-10)

    def test_duplicate_and_unknown_trailing_metadata_fail_closed(self):
        once = metadata_jpeg(jpeg(255))
        twice = metadata_jpeg(once)
        for bad in (twice, metadata_jpeg(jpeg(255), extra=b'unknown')):
            with self.subTest(size=len(bad)), self.assertRaises(ValueError):
                iso_metadata(bad)

    def test_invalid_headroom_is_rejected_before_reconstruction(self):
        for headroom in (-1, float('nan'), float('inf')):
            with self.subTest(headroom=headroom), self.assertRaises(ValueError):
                reconstruct(jpeg(255), metadata_jpeg(jpeg(255)), headroom=headroom)

    def test_native_dual_metadata_agrees_with_independent_xmp_reconstruction(self):
        from gainmap import independent_hdr
        from test_native_gainmap import native
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-xmp.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, gain, output = (directory/name for name in ('base.jpg', 'gain.jpg', 'dual.jpg'))
            base.write_bytes(jpeg(255))
            gain.write_bytes(jpeg(128))
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            Image.new('RGB', (8, 8), 'white').save(base, quality=100, icc_profile=profile)
            packed = native('both', 'pack', source, base, gain, output)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            extracted = native('both', 'extract', output, base, gain)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            python_rgb, metadata = reconstruct(base.read_bytes(), gain.read_bytes(), headroom=4)
            np.testing.assert_allclose([c['maximum'] for c in metadata['channels']], [3.5, 3.6, 3.7], atol=1e-6)
            expected = python_rgb @ RGB_TO_XYZ['srgb'].T @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T
            actual = independent_hdr(output, directory, 'srgb')
            # Native control includes a12-bit PQ roundtrip. A0.3% component
            # bound covers its rounding; uniform pixels avoid resampling or
            # codec-edge tolerances. This is an oracle cross-check, not a
            # replacement for any fixture's existing appearance gates.
            np.testing.assert_allclose(actual, expected, rtol=.003, atol=.01)

    def test_pinned_iso_fixture_matches_independent_xmp_reconstruction(self):
        from gainmap import independent_hdr
        from appearance import compare_appearance
        from test_native_gainmap import native
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-iso.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, gain, dual = (directory/name for name in ('base.jpg', 'gain.jpg', 'dual.jpg'))
            extracted = native('both', 'extract', source, base, gain)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            original_base, original_gain = base.read_bytes(), gain.read_bytes()
            expected_metadata = iso_metadata(original_gain)
            from gainmap_iso import decode_iso_source
            decoded = decode_iso_source(original_base, original_gain, headroom=4)
            self.assertEqual(decoded['gamut'], 'p3')
            expected = decoded['linear_rgb_nits']
            # The packer writes fresh ISO/XMP packets. Remove only the old ISO
            # APP2 packet; preserve every other byte, including JPEG entropy.
            data, clean, position = original_gain, original_gain[:2], 2
            while data[position + 1] not in (0xDA, 0xD9):
                size = int.from_bytes(data[position + 2:position + 4], 'big')
                segment = data[position:position + size + 2]
                if not (data[position + 1] == 0xE2 and segment[4:].startswith(ISO_ID)):
                    clean += segment
                position += size + 2
            gain.write_bytes(clean + data[position:])
            packed = native('both', 'pack', source, base, gain, dual)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            extracted = native('both', 'extract', dual, base, gain)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            self.assertEqual(iso_metadata(gain.read_bytes()), expected_metadata)
            for original, path in [(original_base, base), (original_gain, gain)]:
                np.testing.assert_array_equal(np.asarray(Image.open(io.BytesIO(original))), np.asarray(Image.open(path)))
            actual = independent_hdr(dual, directory, 'p3')
            # Existing source-specific gain-map appearance gates, unchanged.
            # This camera-derived fixture also exercises the real half-sized
            # map's interpolation and P3→Rec.2020 color conversion.
            measured = compare_appearance(expected, actual, reference_gamut='p3',
                actual_gamut='rec2020', fixture_class='gainmap-hdr')
            self.assertTrue(measured['passed'], measured)


class IsoSourceDecoderTests(unittest.TestCase):
    def parts(self, directory):
        from test_native_gainmap import native
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-iso.jpg'
        base, gain = directory/'base.jpg', directory/'gain.jpg'
        result = native('both', 'extract', source, base, gain)
        self.assertEqual(result.returncode, 0, result.stderr)
        return base.read_bytes(), gain.read_bytes()

    def test_pinned_source_returns_verified_color_and_independent_evidence(self):
        from gainmap_iso import decode_iso_source
        with tempfile.TemporaryDirectory() as temporary:
            base, gain = self.parts(Path(temporary))
        decoded = decode_iso_source(base, gain)
        self.assertEqual(decoded['gamut'], 'p3')
        self.assertEqual(decoded['linear_rgb_nits'].shape, (512, 384, 3))
        self.assertEqual(decoded['evidence']['base_color']['transfer'], 'srgb')
        self.assertEqual(decoded['evidence']['base_color']['icc_sha256'],
                         '33c92020023a0b41f7a963445d69e07a49f770d7b98ef3422d3983d2f5efbf70')
        self.assertEqual(decoded['evidence']['base']['components'], 3)
        self.assertEqual(decoded['evidence']['gain_map']['components'], 1)
        self.assertEqual(decoded['evidence']['headroom_log2'], 4)
        self.assertTrue(np.all(np.isfinite(decoded['linear_rgb_nits'])))
        self.assertEqual(len(decoded['evidence']['base_sha256']), 64)
        self.assertEqual(len(decoded['evidence']['gain_map_sha256']), 64)

    def test_native_srgb_matrix_profile_is_verified_from_its_color_tags(self):
        from gainmap_iso import decode_iso_source
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        buffer = io.BytesIO()
        Image.new('RGB', (8, 8), 'white').save(buffer, format='JPEG', quality=100, icc_profile=profile)
        decoded = decode_iso_source(buffer.getvalue(), metadata_jpeg(jpeg(255)))
        self.assertEqual(decoded['gamut'], 'srgb')
        np.testing.assert_allclose(decoded['linear_rgb_nits'], 812, atol=1e-9)

    def test_missing_or_changed_icc_facts_fail_closed(self):
        from gainmap_iso import decode_iso_source
        with tempfile.TemporaryDirectory() as temporary:
            base, gain = self.parts(Path(temporary))
        image = Image.open(io.BytesIO(base))
        original_profile = image.info['icc_profile']
        count = struct.unpack_from('>I', original_profile, 128)[0]
        offsets = {name: offset for name, offset, size in
                   (struct.unpack_from('>4sII', original_profile, 132 + index * 12) for index in range(count))}
        variants = [None]
        for tag in (b'rTRC', b'rXYZ'):
            changed = bytearray(original_profile)
            # Preserve profile description while changing actual transfer or
            # colorant facts; a name-based classifier would falsely accept it.
            struct.pack_into('>i', changed, offsets[tag] + (12 if tag == b'rTRC' else 8), 65536)
            variants.append(bytes(changed))
        for offset, value in ((44, 1), (68, 65536)):
            changed = bytearray(original_profile)
            struct.pack_into('>I', changed, offset, value)
            variants.append(bytes(changed))
        for profile in variants:
            with self.subTest(profile_present=profile is not None):
                buffer = io.BytesIO()
                image.save(buffer, format='JPEG', quality=100, icc_profile=profile)
                with self.assertRaises(ValueError):
                    decode_iso_source(buffer.getvalue(), gain)

    def test_unsupported_base_and_gain_map_semantics_are_rejected(self):
        from gainmap_iso import decode_iso_source
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        buffer = io.BytesIO()
        Image.new('RGB', (8, 8), 'white').save(buffer, format='JPEG', quality=100, icc_profile=profile)
        base = buffer.getvalue()
        alternate_color_space = bytearray(metadata_jpeg(jpeg(255)))
        flags_offset = alternate_color_space.index(ISO_ID) + len(ISO_ID) + 4
        alternate_color_space[flags_offset] &= ~64
        for gain in (metadata_jpeg(jpeg(255), flags=4),
                     metadata_jpeg(jpeg(255), alternate=0), bytes(alternate_color_space)):
            with self.assertRaises(ValueError):
                decode_iso_source(base, gain)
        with self.assertRaises(ValueError):
            decode_iso_source(jpeg(255), metadata_jpeg(jpeg(255)))

    def test_unhandled_source_orientation_is_not_silently_ignored(self):
        from gainmap_iso import decode_iso_source
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        image, buffer = Image.new('RGB', (8, 8), 'white'), io.BytesIO()
        exif = Image.Exif()
        exif[274] = 6
        image.save(buffer, format='JPEG', quality=100, icc_profile=profile, exif=exif)
        with self.assertRaisesRegex(ValueError, 'orientation'):
            decode_iso_source(buffer.getvalue(), metadata_jpeg(jpeg(255)))


if __name__ == '__main__':
    unittest.main()
