"""A separate native reader uses its existing exact transfer/gain formulas."""

from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np

from appearance import compare_appearance
from avif import write_png
from gainmap_iso import decode_iso_source
from lossless_jpeg import encode as encode_lossless
import test_native_avif_gainmap
from test_native_gainmap import native


class NativePreciseGainMapTests(unittest.TestCase):
    def test_existing_native_formulas_recover_black_and_match_independent_iso_reader(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, _, _, expected = test_native_avif_gainmap.NativeAvifGainMapTests().fixture(
                directory, rgb_base=True)
            expected[0, 0] = 0
            value = (expected/10000)**(2610/16384)
            signal = ((3424/4096+2413/128*value)/(1+2392/128*value))**(2523/32)
            hdr, avif = directory/"black.png", directory/"black.avif"
            write_png(hdr, np.concatenate((signal, np.ones((32, 32, 1))), axis=-1))
            subprocess.run(["/opt/proof/libavif/fullrange/avifgainmaputil", "combine", str(base), str(hdr), str(avif),
                            "--cicp-base", "1/13/0", "--cicp-alternate", "1/16/0", "--ignore-profile",
                            "--downscaling", "1", "--depth-gain-map", "8", "--qgain-map", "100",
                            "--yuv-gain-map", "444", "-y", "444", "-d", "0", "-q", "100", "-s", "10"],
                           check=True, capture_output=True, timeout=30)
            png, gain, output = directory/"map.png", directory/"map.jpg", directory/"output.jpg"
            subprocess.run(["avifgainmaputil", "extractgainmap", str(avif), str(png)],
                           check=True, capture_output=True, timeout=30)
            encode_lossless(png, gain)
            packed = native("rgb", "pack-avif", avif, base, gain, output)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            extracted_base, extracted_map = directory/"base-part.jpg", directory/"map-part.jpg"
            extracted = native("rgb", "extract", output, extracted_base, extracted_map)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            independent = decode_iso_source(extracted_base.read_bytes(), extracted_map.read_bytes())
            for variant in ("rgb", "precise"):
                with self.subTest(variant=variant):
                    raw = directory/f"{variant}.gbrpf32"
                    decoded = native(variant, "decode-linear", output, raw)
                    self.assertEqual(decoded.returncode, 0, decoded.stderr)
                    actual = np.fromfile(raw, dtype="<f4").reshape(3, 32, 32)[[2, 0, 1]].transpose(1, 2, 0)*203
                    measured = compare_appearance(expected, actual, reference_gamut="srgb",
                                                  actual_gamut="srgb", fixture_class="gainmap-hdr")
                    if variant == "rgb":
                        self.assertFalse(measured["passed"])
                    else:
                        self.assertTrue(measured["passed"], measured["failures"])
                        measured = compare_appearance(independent['linear_rgb_nits'], actual,
                                                      reference_gamut="srgb", actual_gamut="srgb",
                                                      fixture_class="gainmap-hdr")
                        self.assertTrue(measured["passed"], measured["failures"])


if __name__ == "__main__":
    unittest.main()
