"""Keep the RGB JPEG decoder rejection beside a separately patched native build."""

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from appearance import compare_appearance
from gainmap import independent_hdr
import test_native_avif_gainmap
from test_native_gainmap import native


class NativeRgbGainMapTests(unittest.TestCase):
    def test_native_rgb_dispatch_matches_distinct_gain_intent_and_libavif_decoder(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, avif, gain, expected = test_native_avif_gainmap.NativeAvifGainMapTests().fixture(
                directory, rgb_base=True)
            output = directory / "output.jpg"
            packed = native("both", "pack-avif", avif, base, gain, output)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            unpatched = native("both", "decode-linear", output, directory / "rejected.gbrpf32")
            self.assertNotEqual(unpatched.returncode, 0)
            self.assertIn("JCS_YCbCr or JCS_GRAYSCALE", unpatched.stderr)

            raw = directory / "decoded.gbrpf32"
            patched = native("rgb", "decode-linear", output, raw)
            self.assertEqual(patched.returncode, 0, patched.stderr)
            self.assertEqual(json.loads(patched.stdout)["gamut"], 0)
            actual = np.fromfile(raw, dtype="<f4").reshape(3, 32, 32)[[2, 0, 1]].transpose(1, 2, 0)*203
            measured = compare_appearance(expected, actual, reference_gamut="srgb",
                                          actual_gamut="srgb", fixture_class="gainmap-hdr")
            self.assertTrue(measured["passed"], measured["failures"])
            oracle = directory / "independent"
            oracle.mkdir()
            independently_decoded = independent_hdr(output, oracle, "srgb")
            measured = compare_appearance(independently_decoded, actual, reference_gamut="rec2020",
                                          actual_gamut="srgb", fixture_class="gainmap-hdr")
            self.assertTrue(measured["passed"], measured["failures"])

    def test_native_ycbcr_decode_is_byte_identical_with_dispatch_patch(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, avif, gain, _ = test_native_avif_gainmap.NativeAvifGainMapTests().fixture(directory)
            output = directory / "output.jpg"
            packed = native("both", "pack-avif", avif, base, gain, output)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            for variant in ("both", "rgb"):
                result = native(variant, "decode-linear", output, directory / f"{variant}.gbrpf32")
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((directory / "both.gbrpf32").read_bytes(), (directory / "rgb.gbrpf32").read_bytes())


if __name__ == "__main__":
    unittest.main()
