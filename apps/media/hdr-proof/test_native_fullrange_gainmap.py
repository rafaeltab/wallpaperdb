"""Separate native map encoder policy: retain rare gains instead of clipping them."""

import json
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
from gainmap_iso import reconstruct
from test_native_gainmap import native


class NativeFullRangeGainMapTests(unittest.TestCase):
    def test_rare_black_intent_survives_full_range_map_but_baseline_clips_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
            profile[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
            base = directory / "base.jpg"
            Image.new("RGB", (64, 64), (128, 128, 128)).save(
                base, quality=100, subsampling=0, keep_rgb=True, icc_profile=bytes(profile))
            sdr = ((128/255+.055)/1.055)**2.4
            expected = np.full((64, 64, 3), sdr*203*8)
            expected[16, 16] = 0
            value = (expected/10000)**(2610/16384)
            signal = ((3424/4096+2413/128*value)/(1+2392/128*value))**(2523/32)
            hdr = directory / "hdr.png"
            write_png(hdr, np.concatenate((signal, np.ones((64, 64, 1))), axis=-1))
            for name, tool in (("baseline", "avifgainmaputil"),
                               ("fullrange", "/opt/proof/libavif/fullrange/avifgainmaputil")):
                with self.subTest(variant=name):
                    avif, png, gain = (directory/f"{name}.{suffix}" for suffix in ("avif", "png", "map.jpg"))
                    subprocess.run([tool, "combine", str(base), str(hdr), str(avif),
                                    "--cicp-base", "1/13/0", "--cicp-alternate", "1/16/0", "--ignore-profile",
                                    "--downscaling", "1", "--depth-gain-map", "8", "--qgain-map", "100",
                                    "--yuv-gain-map", "444", "-y", "444", "-d", "0", "-q", "100", "-s", "10"],
                                   check=True, capture_output=True, timeout=30)
                    subprocess.run(["avifgainmaputil", "extractgainmap", str(avif), str(png)],
                                   check=True, capture_output=True, timeout=30)
                    # The native policy control must not conflate clipped gain
                    # endpoints with a later lossy JPEG map-code error.
                    encode_lossless(png, gain)
                    output, raw = directory/f"{name}.jpg", directory/f"{name}.gbrpf32"
                    packed = native("rgb", "pack-avif", avif, base, gain, output)
                    self.assertEqual(packed.returncode, 0, packed.stderr)
                    decoded = native("rgb", "decode-linear", output, raw)
                    self.assertEqual(decoded.returncode, 0, decoded.stderr)
                    actual = np.fromfile(raw, dtype="<f4").reshape(3, 64, 64)[[2, 0, 1]].transpose(1, 2, 0)*203
                    measured = compare_appearance(expected, actual, reference_gamut="srgb",
                                                  actual_gamut="srgb", fixture_class="gainmap-hdr")
                    if name == "baseline":
                        self.assertFalse(measured["passed"])
                        self.assertGreater(float(actual[16, 16].min()), 300)
                    else:
                        # The separately retained rgb reader uses an inverse
                        # sRGB lookup table. It reconstructs exact black as
                        # about .006 nit here, which still fails the fixed gate.
                        self.assertFalse(measured["passed"])
                        extracted_base, extracted_map = directory/"base-part.jpg", directory/"map-part.jpg"
                        extracted = native("rgb", "extract", output, extracted_base, extracted_map)
                        self.assertEqual(extracted.returncode, 0, extracted.stderr)
                        # Narrow generated control: native entropy decoding and
                        # independently implemented ISO metadata/equations. The
                        # public source-admission reader has its own SOF scope.
                        independent, _ = reconstruct(extracted_base.read_bytes(), extracted_map.read_bytes())
                        measured = compare_appearance(expected, independent, reference_gamut="srgb",
                                                      actual_gamut="srgb", fixture_class="gainmap-hdr")
                        self.assertTrue(measured["passed"], measured["failures"])
                        metadata = json.loads(native("rgb", "probe", output).stdout)
                        self.assertTrue(all(value < 1 for value in metadata["minimum_boost"]))


if __name__ == "__main__":
    unittest.main()
