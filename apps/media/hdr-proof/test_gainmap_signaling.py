"""Real emitted ICC metadata must establish gamut before appearance can qualify."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from gainmap import inspect, output_gamut

ROOT = Path(__file__).parent


class GainMapColorSignalingTests(unittest.TestCase):
    def encode(self, directory, source, gamut, fmt):
        output = directory / f"{source}-{gamut}.{fmt}"
        job = {"case_id": "color-signaling", "mode": "sdr", "geometry": "contain",
               "format": fmt, "gamut": gamut, "output": str(output),
               "input": str(ROOT / "fixtures" / "gainmap" / f"{source}.jpg")}
        result = subprocess.run(["node", str(ROOT / "gainmap.cjs")], input=json.dumps([job]),
                                capture_output=True, text=True, check=True, timeout=30)
        self.assertTrue(json.loads(result.stdout)["ok"], result.stdout)
        return output

    def test_native_known_srgb_and_both_p3_profiles_are_recognized(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for source, selector, expected in (("gainmap-apple-new", "srgb", "srgb"),
                                                ("gainmap-apple-new", "preserve", "p3"),
                                                ("gainmap-android-iso", "preserve", "p3")):
                for fmt in ("jpg", "avif", "png", "webp"):
                    with self.subTest(source=source, selector=selector, format=fmt):
                        output = self.encode(directory, source, selector, fmt)
                        facts = inspect(output, directory / output.stem / fmt)
                        self.assertEqual(output_gamut(facts), expected)

    def test_native_profile_removal_preserves_pixels_but_removes_gamut_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for selector in ("srgb", "preserve"):
                output = self.encode(directory, "gainmap-apple-new", selector, "jpg")
                before = np.asarray(Image.open(output).convert("RGB")).copy()
                subprocess.run(["exiftool", "-overwrite_original", "-ICC_Profile=", str(output)],
                               capture_output=True, check=True, timeout=30)
                np.testing.assert_array_equal(before, np.asarray(Image.open(output).convert("RGB")))
                facts = inspect(output, directory / selector)
                self.assertNotIn("ICC_Profile:ProfileDescription", facts["metadata"])
                self.assertIsNone(output_gamut(facts))

    def test_unrecognized_profile_stays_unknown_despite_decodable_unchanged_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            output = self.encode(directory, "gainmap-apple-new", "srgb", "jpg")
            before = np.asarray(Image.open(output).convert("RGB")).copy()
            # A real LittleCMS-generated profile is outside this fixture
            # allowlist. Its description alone does not authorize conversion.
            profile = directory / "unrecognized.icc"
            profile.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
            subprocess.run(["exiftool", "-overwrite_original", f"-ICC_Profile<={profile}", str(output)],
                           capture_output=True, check=True, timeout=30)
            facts = inspect(output, directory / "unrecognized")
            self.assertEqual(facts["metadata"]["ICC_Profile:ProfileDescription"], "sRGB built-in")
            np.testing.assert_array_equal(before, np.asarray(Image.open(output).convert("RGB")))
            self.assertIsNone(output_gamut(facts))


if __name__ == "__main__":
    unittest.main()
