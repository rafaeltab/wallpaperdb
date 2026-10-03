"""Native map offsets affect eight-bit gain precision; appearance gates stay fixed."""

from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance
from avif import write_png
from lossless_jpeg import encode as encode_lossless
from gainmap_iso import iso_metadata
from test_native_gainmap import native


class NativeSmallOffsetGainMapTests(unittest.TestCase):
    def test_smaller_native_offsets_retain_near_black_intent_without_changing_base(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
            profile[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
            base = directory/"base.jpg"
            Image.new("RGB", (64, 64), (40, 40, 40)).save(
                base, quality=100, subsampling=0, keep_rgb=True, icc_profile=bytes(profile))
            levels = np.repeat([0, .001, .01, .1, .3, 1, 2, 500], 8)
            expected = np.broadcast_to(levels[None, :, None], (64, 64, 3))
            value = (expected/10000)**(2610/16384)
            signal = ((3424/4096+2413/128*value)/(1+2392/128*value))**(2523/32)
            hdr = directory/"hdr.png"
            write_png(hdr, np.concatenate((signal, np.ones((64, 64, 1))), axis=-1))
            for variant in ("fullrange", "smalloffset"):
                with self.subTest(variant=variant):
                    avif, png, gain, output, raw = (directory/f"{variant}.{suffix}"
                        for suffix in ("avif", "png", "map.jpg", "jpg", "gbrpf32"))
                    subprocess.run([f"/opt/proof/libavif/{variant}/avifgainmaputil", "combine", str(base), str(hdr), str(avif),
                                    "--cicp-base", "1/13/0", "--cicp-alternate", "1/16/0", "--ignore-profile",
                                    "--downscaling", "1", "--depth-gain-map", "8", "--qgain-map", "100",
                                    "--yuv-gain-map", "444", "-y", "444", "-d", "0", "-q", "100", "-s", "10"],
                                   check=True, capture_output=True, timeout=30)
                    subprocess.run(["avifgainmaputil", "extractgainmap", str(avif), str(png)],
                                   check=True, capture_output=True, timeout=30)
                    encode_lossless(png, gain)
                    packed = native("precise", "pack-avif", avif, base, gain, output)
                    self.assertEqual(packed.returncode, 0, packed.stderr)
                    decoded = native("precise", "decode-linear", output, raw)
                    self.assertEqual(decoded.returncode, 0, decoded.stderr)
                    actual = np.fromfile(raw, dtype="<f4").reshape(3, 64, 64)[[2, 0, 1]].transpose(1, 2, 0)*203
                    measured = compare_appearance(expected, actual, reference_gamut="srgb",
                                                  actual_gamut="srgb", fixture_class="gainmap-hdr")
                    if variant == "fullrange":
                        self.assertFalse(measured["passed"])
                    else:
                        self.assertTrue(measured["passed"], measured["failures"])
                        extracted_map = directory/'emitted-map.jpg'
                        extracted = native('precise', 'extract', output, directory/'emitted-base.jpg', extracted_map)
                        self.assertEqual(extracted.returncode, 0, extracted.stderr)
                        metadata = iso_metadata(extracted_map.read_bytes())
                        # ISO may compact three identical channels into one
                        # shared descriptor without changing their meaning.
                        for channel in metadata['channels']:
                            self.assertEqual(channel['base_offset'], 1/65536)
                            self.assertEqual(channel['alternate_offset'], 1/65536)
                        with Image.open(output) as image:
                            np.testing.assert_array_equal(np.asarray(image), np.full((64, 64, 3), 40))


if __name__ == "__main__":
    unittest.main()
