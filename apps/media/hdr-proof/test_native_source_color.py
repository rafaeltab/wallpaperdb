"""Real source/metadata negatives bound the native ISO reconstruction candidate."""
import struct
import tempfile
import unittest
from pathlib import Path
import zlib

import numpy as np
from PIL import Image, ImageCms

from avif import native, write_png
from gainmap_hdr import decode_source, resample_pq, _decode_iso_source
from hdr_png import _png_chunks

ROOT = Path(__file__).parent
SOURCE = ROOT/'fixtures/gainmap/gainmap-android-iso.jpg'
HELPER = '/opt/proof/ultrahdr/precise/hdr-proof-uhdr'


class NativeIsoSourceColorTests(unittest.TestCase):
    def test_missing_or_disagreeing_source_color_facts_reject_native_reconstruction(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaisesRegex(ValueError, 'ICC disagrees'):
                decode_source(SOURCE, directory/'wrong-gamut', 'srgb')
            unknown = directory/'unknown.jpg'
            unknown.write_bytes(SOURCE.read_bytes())
            native(['exiftool', '-overwrite_original', '-ICC_Profile=', unknown])
            with self.assertRaisesRegex(ValueError, 'no complete ICC'):
                decode_source(unknown, directory/'missing-profile', 'p3')
            for name in ('wrong-gamut', 'missing-profile'):
                self.assertFalse((directory/name/'source-native.jpg').exists())

    def test_unproven_map_sampling_or_orientation_rejects_native_reconstruction(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, original_map = directory/'base.jpg', directory/'map.jpg'
            native([HELPER, 'extract', SOURCE, base, original_map])
            for variant in ('nonidentity-orientation', 'unproven-scale'):
                with self.subTest(variant=variant):
                    gain = directory/f'{variant}-map.jpg'
                    if variant == 'nonidentity-orientation':
                        gain.write_bytes(original_map.read_bytes())
                        native(['exiftool', '-overwrite_original', '-Orientation#=6', gain])
                    else:
                        with Image.open(original_map) as image:
                            image.resize((190, 256), Image.Resampling.BILINEAR).save(gain, quality=100)
                    source = directory/f'{variant}.jpg'
                    native([HELPER, 'pack', SOURCE, base, gain, source])
                    candidate = directory/variant
                    candidate.mkdir()
                    with self.assertRaises(ValueError):
                        _decode_iso_source(source, candidate, 'p3')
                    self.assertFalse((directory/variant/'source-native.jpg').exists())

    def test_unrecognized_pq_color_facts_reject_before_native_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory/'signal.png'
            write_png(source, np.full((3, 5, 4), .5))
            chunks = _png_chunks(source.read_bytes())
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            valid_cicp = (b'cICP', bytes((12, 16, 0, 1)))
            variants = {
                'missing-color': [],
                'unknown-primary': [(b'cICP', bytes((2, 16, 0, 1)))],
                'wrong-transfer': [(b'cICP', bytes((12, 18, 0, 1)))],
                'non-rgb-matrix': [(b'cICP', bytes((12, 16, 9, 1)))],
                'limited-range': [(b'cICP', bytes((12, 16, 0, 0)))],
                'duplicate-color': [valid_cicp, (b'cICP', bytes((9, 16, 0, 1)))],
                'conflicting-icc': [valid_cicp, (b'iCCP', b'sRGB\0\0' + zlib.compress(profile))],
                'conflicting-srgb': [valid_cicp, (b'sRGB', b'\0')],
            }
            for variant, packets in variants.items():
                with self.subTest(variant=variant):
                    modified = chunks[:1] + packets + chunks[1:]
                    data = bytearray(b'\x89PNG\r\n\x1a\n')
                    for kind, payload in modified:
                        data.extend(struct.pack('>I', len(payload)) + kind + payload
                                    + struct.pack('>I', zlib.crc32(kind+payload)))
                    path, output = directory/f'{variant}.png', directory/f'{variant}.raw'
                    path.write_bytes(data)
                    with self.assertRaisesRegex(ValueError, 'PQ signaling'):
                        resample_pq(path, output, 'contain', gamut='p3')
                    self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
