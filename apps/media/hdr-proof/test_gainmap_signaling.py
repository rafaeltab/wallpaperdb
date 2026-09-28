"""Real emitted ICC metadata must establish gamut before appearance can qualify."""

import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import unittest

import numpy as np
from PIL import Image, ImageCms

from gainmap import geometry, inspect, output_gamut, source_image

ROOT = Path(__file__).parent


class GainMapColorSignalingTests(unittest.TestCase):
    def encode(self, directory, source, gamut, fmt, source_gamut=None):
        output = directory / f"{source}-{gamut}.{fmt}"
        job = {"case_id": "color-signaling", "mode": "sdr", "geometry": "contain",
               "format": fmt, "gamut": gamut, "output": str(output),
               "input": str(ROOT / "fixtures" / "gainmap" / f"{source}.jpg")}
        if source_gamut is not None:
            job["source_gamut"] = source_gamut
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

    def test_known_unprofiled_android_base_emits_srgb_without_changing_native_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            plain, known = directory / "plain", directory / "known"
            plain.mkdir()
            known.mkdir()
            source = ROOT / "fixtures" / "gainmap" / "gainmap-android-xmp.jpg"
            source_facts = inspect(source, directory / "source")
            self.assertEqual(source_facts["metadata"]["ExifIFD:ColorSpace"], 1)
            self.assertEqual(source_facts["metadata"]["InteropIFD:InteropIndex"], "R98")
            self.assertIsNone(output_gamut(source_facts))
            for fmt in ("jpg", "avif", "png", "webp"):
                with self.subTest(format=fmt):
                    output = self.encode(known, "gainmap-android-xmp", "preserve", fmt, "srgb")
                    facts = inspect(output, known / fmt)
                    self.assertEqual(output_gamut(facts), "srgb")
                    self.assertEqual(facts["private_tags"], [])
                    if fmt == "jpg":
                        untagged = self.encode(plain, "gainmap-android-xmp", "preserve", fmt)
                        self.assertIsNone(output_gamut(inspect(untagged, plain / fmt)))
                        np.testing.assert_array_equal(np.asarray(Image.open(output).convert("RGB")),
                                                      np.asarray(Image.open(untagged).convert("RGB")))

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

    def test_reference_srgb_profile_has_fixed_date_and_unchanged_native_cms_pixels(self):
        source = ROOT / "fixtures" / "gainmap" / "gainmap-apple-new.jpg"
        reference = source_image(source, "srgb")
        profile = reference.info["icc_profile"]
        self.assertEqual(struct.unpack(">6H", profile[24:36]), (2000, 1, 1, 0, 0, 0))
        with Image.open(source) as image:
            original_profile = ImageCms.ImageCmsProfile(io.BytesIO(image.info["icc_profile"]))
            native = ImageCms.profileToProfile(image.convert("RGB"), original_profile,
                                               ImageCms.createProfile("sRGB"),
                                               renderingIntent=0, outputMode="RGB")
        np.testing.assert_array_equal(np.asarray(reference), np.asarray(native))
        original_bytes = native.info["icc_profile"]
        self.assertEqual(profile[:24] + profile[36:], original_bytes[:24] + original_bytes[36:])

    def test_reference_png_bytes_repeat_across_native_profile_clock_ticks(self):
        source = ROOT / "fixtures" / "gainmap" / "gainmap-apple-new.jpg"

        def encoded_reference():
            reference = geometry(source_image(source, "srgb"), "contain")
            profile = reference.info["icc_profile"]
            reference.info.clear()
            buffer = io.BytesIO()
            reference.save(buffer, format="PNG", icc_profile=profile)
            return buffer.getvalue()

        first = encoded_reference()
        time.sleep(1.1)  # LittleCMS creation timestamps have one-second precision.
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(encoded_reference()).hexdigest())


if __name__ == "__main__":
    unittest.main()
