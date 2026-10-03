"""Native per-channel Android XMP regression with independent reconstruction."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import ImageCms

from gainmap import independent_hdr, inspect, output_gamut
from test_native_gainmap import native, pixels

ROOT = Path(__file__).parent
SOURCE = ROOT / "fixtures" / "gainmap" / "gainmap-android-xmp.jpg"


class NativeXmpChannelTests(unittest.TestCase):
    def test_baseline_reproduces_reader_failure_and_patched_reader_keeps_all_channels(self):
        baseline = native("baseline", "probe", SOURCE)
        self.assertNotEqual(baseline.returncode, 0)
        self.assertIn("GainMapMax", baseline.stderr)
        patched = native("both", "probe", SOURCE)
        self.assertEqual(patched.returncode, 0, patched.stderr)
        metadata = json.loads(patched.stdout)
        np.testing.assert_allclose(metadata["maximum_boost"], 2 ** np.array([3.5, 3.6, 3.7]), rtol=1e-6)
        self.assertAlmostEqual(metadata["hdr_capacity_max"], 2 ** 3.5, places=5)
        self.assertEqual(metadata["sdr_offset"], [0, 0, 0])
        self.assertEqual(metadata["hdr_offset"], [0, 0, 0])

    def test_dual_metadata_repacking_keeps_pixels_channels_and_independent_hdr(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            output = directory / "roundtrip.jpg"
            base, gain = directory / "base.jpg", directory / "gain.jpg"
            extracted = native("both", "extract", SOURCE, base, gain)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            before = inspect(SOURCE, directory / "source")
            self.assertEqual(before["metadata"]["ExifIFD:ColorSpace"], 1)
            self.assertEqual(before["metadata"]["InteropIFD:InteropIndex"], "R98")
            # This fixture establishes sRGB through EXIF, while the native
            # compressed-base packer requires an ICC profile. Attaching an
            # equivalent profile preserves its JPEG coefficients and pixels.
            profile = directory / "srgb.icc"
            profile.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
            subprocess.run(["exiftool", "-overwrite_original", "-XMP:All=", f"-ICC_Profile<={profile}", str(base)],
                           check=True, capture_output=True, timeout=30)
            # The packer writes fresh container/map XMP; retaining source XMP
            # would create duplicate packets, rejected by the independent reader.
            subprocess.run(["exiftool", "-overwrite_original", "-XMP:All=", str(gain)],
                           check=True, capture_output=True, timeout=30)
            result = native("both", "pack", SOURCE, base, gain, output)
            self.assertEqual(result.returncode, 0, result.stderr)
            np.testing.assert_array_equal(pixels(SOURCE), pixels(output))
            after = inspect(output, directory / "output")
            np.testing.assert_array_equal(pixels(directory / "source/map.jpg"), pixels(directory / "output/map.jpg"))
            self.assertTrue(after["iso_identifier"])
            values = after["android_xmp_properties"]["XMP-hdrgm:GainMapMax"]
            np.testing.assert_allclose(values, [3.5, 3.6, 3.7], atol=1e-6)
            np.testing.assert_array_equal(independent_hdr(SOURCE, directory / "source", "srgb"),
                                          independent_hdr(output, directory / "output", "srgb"))

    def test_native_geometry_emits_decodable_dual_metadata_and_retains_sdr_base(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for geometry in ("contain", "cover", "fill", "upscale", "orientation"):
                with self.subTest(geometry=geometry):
                    case_dir = directory / geometry
                    case_dir.mkdir()
                    output, sdr = case_dir / "hdr.jpg", case_dir / "sdr.jpg"
                    common = {"input": str(SOURCE), "geometry": geometry, "gamut": "preserve",
                              "source_gamut": "srgb", "format": "jpg"}
                    jobs = [dict(common, case_id="retained", mode="native-retain", output=str(output)),
                            dict(common, case_id="sdr", mode="sdr", output=str(sdr))]
                    encoded = subprocess.run(["node", str(ROOT / "gainmap.cjs")], input=json.dumps(jobs),
                                             capture_output=True, text=True, check=True, timeout=30)
                    records = [json.loads(line) for line in encoded.stdout.splitlines()]
                    self.assertTrue(all(record["ok"] for record in records), records)
                    np.testing.assert_array_equal(pixels(output), pixels(sdr))
                    facts = inspect(output, case_dir / "inspection")
                    self.assertEqual(output_gamut(facts), "srgb")
                    self.assertTrue(facts["iso_identifier"])
                    self.assertEqual(facts["private_tags"], [])
                    self.assertEqual(facts["map_private_tags"], [])
                    np.testing.assert_allclose(facts["android_xmp_properties"]["XMP-hdrgm:GainMapMax"],
                                               [3.5, 3.6, 3.7], atol=1e-6)
                    (case_dir / "oracle").mkdir()
                    reconstructed = independent_hdr(output, case_dir / "oracle", "srgb")
                    self.assertEqual(reconstructed.shape, pixels(output).shape)
                    self.assertTrue(np.isfinite(reconstructed).all())
                    # Decoding and base retention remove blockers; resized HDR
                    # fidelity still requires the separate appearance gates.

    def test_bad_array_cardinality_and_nonfinite_values_are_rejected_natively(self):
        original = SOURCE.read_bytes()
        token = b"<rdf:li>3.6</rdf:li>"
        self.assertEqual(original.count(token), 1)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for label, replacement in (("two-channels", b" " * len(token)),
                                       ("nonfinite", b"<rdf:li>nan</rdf:li>")):
                with self.subTest(case=label):
                    path = directory / f"{label}.jpg"
                    path.write_bytes(original.replace(token, replacement))
                    # Equal-length metadata changes retain valid JPEG/MPF
                    # image bytes; this is a real malformed metadata input.
                    np.testing.assert_array_equal(pixels(path), pixels(SOURCE))
                    result = native("both", "probe", path)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("GainMapMax", result.stderr)


if __name__ == "__main__":
    unittest.main()
