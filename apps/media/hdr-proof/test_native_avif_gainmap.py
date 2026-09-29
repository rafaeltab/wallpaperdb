"""Pack a map computed by libavif and decode HDR independently with libultrahdr."""

import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from avif import write_png
from appearance import compare_appearance
from gainmap import inspect
from test_native_gainmap import native, pixels


class NativeAvifGainMapTests(unittest.TestCase):
    def fixture(self, directory, *, rgb_base=False):
        base, hdr = directory / "base.jpg", directory / "hdr.png"
        # Independent test intent with spatially varying RGB and distinct
        # channel gains. These are fixture equations, not candidate map math.
        profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
        profile[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
        y, x = np.mgrid[:32, :32]
        rgb = np.stack((96+2*x, 112+y, 128+(x+y)//2), axis=-1).astype("uint8")
        Image.fromarray(rgb).save(
            base, quality=100, subsampling=0, keep_rgb=rgb_base, icc_profile=bytes(profile))
        signal = pixels(base)/255
        sdr = np.where(signal <= .04045, signal/12.92, ((signal+.055)/1.055)**2.4)
        expected_nits = sdr * 203 * [2, 3, 4]
        value = (expected_nits/10000) ** (2610/16384)
        signal = ((3424/4096 + 2413/128*value)/(1 + 2392/128*value)) ** (2523/32)
        rgba = np.ones((32, 32, 4))
        rgba[..., :3] = signal
        write_png(hdr, rgba)
        avif, gain = directory / "combined.avif", directory / "map.png"
        subprocess.run(["avifgainmaputil", "combine", str(base), str(hdr), str(avif),
                        "--cicp-base", "1/13/0", "--cicp-alternate", "1/16/0", "--ignore-profile",
                        "--downscaling", "1", "--depth-gain-map", "8", "--qgain-map", "100",
                        "--yuv-gain-map", "444", "-y", "444", "-d", "8", "-q", "100", "-s", "10"],
                       check=True, capture_output=True, timeout=30)
        subprocess.run(["avifgainmaputil", "extractgainmap", str(avif), str(gain)],
                       check=True, capture_output=True, timeout=30)
        with Image.open(gain) as image:
            image.save(directory / "map.jpg", quality=100, subsampling=0, keep_rgb=True)
        return base, avif, directory / "map.jpg", expected_nits

    def test_real_native_gain_metadata_and_retained_pixels_survive_dual_jpeg_packing(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, avif, gain, expected = self.fixture(directory)
            output = directory / "output.jpg"
            result = native("both", "pack-avif", avif, base, gain, output)
            self.assertEqual(result.returncode, 0, result.stderr)
            np.testing.assert_array_equal(pixels(base), pixels(output))
            facts = inspect(output, directory / "inspection")
            self.assertTrue(facts["iso_identifier"])
            self.assertTrue(facts["android_xmp_properties"])
            np.testing.assert_array_equal(pixels(gain), pixels(directory / "inspection/map.jpg"))
            metadata = json.loads(native("both", "probe", output).stdout)
            self.assertEqual(metadata["sdr_offset"], [1/64]*3)
            self.assertEqual(metadata["hdr_offset"], [1/64]*3)
            raw = directory / "decoded.gbrpf32"
            decoded = native("both", "decode-linear", output, raw)
            self.assertEqual(decoded.returncode, 0, decoded.stderr)
            self.assertEqual(json.loads(decoded.stdout)["gamut"], 0)
            values = np.fromfile(raw, dtype="<f4").reshape(3, 32, 32)[[2, 0, 1]].transpose(1, 2, 0) * 203
            measured = compare_appearance(expected, values, reference_gamut="srgb",
                                          actual_gamut="srgb", fixture_class="gainmap-hdr")
            self.assertTrue(measured["passed"], measured["failures"])
            self.assertGreater(float(np.ptp(pixels(gain))), 40)

    def test_native_packing_rejects_mismatched_base_and_map_dimensions(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, avif, gain, _ = self.fixture(directory)
            for label, layer in (("base", base), ("map", gain)):
                with self.subTest(layer=label):
                    wrong = directory / f"wrong-{label}.jpg"
                    with Image.open(layer) as image:
                        image.resize((16, 32)).save(wrong, quality=100, icc_profile=image.info.get("icc_profile"))
                    output = directory / f"invalid-{label}.jpg"
                    result = native("both", "pack-avif", avif,
                                    wrong if label == "base" else base,
                                    wrong if label == "map" else gain, output)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("dimensions", result.stderr)
                    self.assertFalse(output.exists())

    def test_native_hdr_decoder_rejects_rgb_base_even_when_packing_succeeds(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, avif, gain, _ = self.fixture(directory, rgb_base=True)
            output = directory / "output.jpg"
            packed = native("both", "pack-avif", avif, base, gain, output)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            np.testing.assert_array_equal(pixels(base), pixels(output))
            decoded = native("both", "decode-linear", output, directory / "decoded.gbrpf32")
            self.assertNotEqual(decoded.returncode, 0)
            self.assertIn("JCS_YCbCr or JCS_GRAYSCALE", decoded.stderr)


if __name__ == "__main__":
    unittest.main()
