"""Isolate two proposed upstream fixes using real native builds and fixtures."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image

from gainmap_iso import iso_metadata
from gainmap import inspect

ROOT = Path(__file__).parent
BINARIES = Path("/opt/proof/ultrahdr")


def native(variant, *arguments):
    return subprocess.run([str(BINARIES / variant / "hdr-proof-uhdr"), *map(str, arguments)],
                          capture_output=True, text=True, timeout=30)


def pixels(path):
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB")).copy()


class NativeGainMapPatchTests(unittest.TestCase):
    def fixture(self, flavor):
        return ROOT / "fixtures" / "gainmap" / f"gainmap-apple-{flavor}.jpg"

    def probe(self, variant, path):
        result = native(variant, "probe", path)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_unpatched_native_encoder_reproduces_both_apple_failures(self):
        with tempfile.TemporaryDirectory() as temporary:
            for flavor in ("old", "new"):
                result = native("baseline", "roundtrip", self.fixture(flavor), Path(temporary) / f"{flavor}.jpg")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ICC marker in gainmap jpeg is missing", result.stderr)

    def test_patch_effects_are_separate_and_use_actual_native_metadata(self):
        expected = {
            "baseline": (False, 23.1474762),
            "pr484": (True, 23.1474762),
            "pr491": (False, 4.532783),
            "both": (True, 4.532783),
        }
        for variant, (use_base, headroom) in expected.items():
            with self.subTest(variant=variant):
                new = self.probe(variant, self.fixture("new"))
                old = self.probe(variant, self.fixture("old"))
                self.assertEqual(new["use_base_cg"], use_base)
                self.assertEqual(old["use_base_cg"], use_base)
                self.assertAlmostEqual(new["hdr_capacity_max"], headroom, places=4)
                self.assertAlmostEqual(old["hdr_capacity_max"], 8, places=5)

    def test_color_space_patch_is_required_even_with_corrected_headroom(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "output.jpg"
            rejected = native("pr491", "roundtrip", self.fixture("new"), output)
            accepted = native("pr484", "roundtrip", self.fixture("new"), output)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_both_patches_pack_dual_metadata_without_changing_base_or_map_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for flavor, headroom in (("old", 8), ("new", 4.532783)):
                source = self.fixture(flavor)
                output = directory / f"{flavor}.jpg"
                result = native("both", "roundtrip", source, output)
                self.assertEqual(result.returncode, 0, result.stderr)
                np.testing.assert_array_equal(pixels(source), pixels(output))
                maps = []
                for label, path in (("source", source), ("output", output)):
                    base, gain = directory / f"{label}-base.jpg", directory / f"{label}-map.jpg"
                    extracted = native("both", "extract", path, base, gain)
                    self.assertEqual(extracted.returncode, 0, extracted.stderr)
                    maps.append(pixels(gain))
                    if label == "output":
                        metadata = iso_metadata(gain.read_bytes())
                        self.assertAlmostEqual(2 ** metadata["alternate_headroom"], headroom, places=4)
                        tags = json.loads(subprocess.run(["exiftool", "-json", "-G1", "-s", str(gain)],
                                                         check=True, capture_output=True, text=True).stdout)[0]
                        self.assertIn("XMP-hdrgm:GainMapMax", tags)
                np.testing.assert_array_equal(maps[0], maps[1])

    def test_native_retained_geometry_preserves_authored_base_and_decodes_independently(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for flavor in ("old", "new"):
                output, sdr = directory / f"{flavor}-hdr.jpg", directory / f"{flavor}-sdr.jpg"
                common = {"input": str(self.fixture(flavor)), "geometry": "contain", "gamut": "preserve", "format": "jpg"}
                jobs = [dict(common, case_id="retained", mode="native-retain", native_variant="both", output=str(output)),
                        dict(common, case_id="sdr", mode="sdr", output=str(sdr))]
                encoded = subprocess.run(["node", str(ROOT / "gainmap.cjs")], input=json.dumps(jobs),
                                         capture_output=True, text=True, check=True, timeout=30)
                records = [json.loads(line) for line in encoded.stdout.splitlines()]
                self.assertTrue(all(record["ok"] for record in records), records)
                self.assertEqual(records[0].get("native_variant"), "both")
                np.testing.assert_array_equal(pixels(output), pixels(sdr))
                decoded = subprocess.run(["avifgainmaputil", "convert", str(output), str(directory / f"{flavor}.avif"),
                                          "--ignore-profile", "--cicp", "12/13/0", "-q", "100", "--qgain-map", "100",
                                          "-s", "10", "-y", "444", "-d", "8"], capture_output=True, text=True)
                self.assertEqual(decoded.returncode, 0, decoded.stderr)

    def test_retained_map_geometry_strips_private_tags_from_both_layers(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base, gain = directory / "base.jpg", directory / "gain.jpg"
            source, output = directory / "private.jpg", directory / "output.jpg"
            extracted = native("both", "extract", self.fixture("new"), base, gain)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            for layer in (base, gain):
                subprocess.run(["exiftool", "-overwrite_original", "-Artist=Private author",
                                "-XMP-dc:Creator=Private creator", str(layer)],
                               check=True, capture_output=True, timeout=30)
            packed = native("both", "pack", self.fixture("new"), base, gain, source)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            before = inspect(source, directory / "source-inspection")
            self.assertIn("IFD0:Artist", before["private_tags"])
            self.assertIn("gain-map:IFD0:Artist", before["private_tags"])
            job = {"case_id": "private-layers", "input": str(source), "output": str(output),
                   "format": "jpg", "geometry": "contain", "gamut": "preserve", "mode": "native-retain"}
            result = subprocess.run(["node", str(ROOT / "gainmap.cjs")], input=json.dumps([job]),
                                    capture_output=True, text=True, check=True, timeout=30)
            self.assertTrue(json.loads(result.stdout)["ok"], result.stdout)
            after = inspect(output, directory / "output-inspection")
            self.assertEqual(after["private_tags"], [])
            self.assertEqual(after["map_private_tags"], [])
            self.assertTrue(after["android_xmp_properties"])
            self.assertIn("iso_metadata", after)


if __name__ == "__main__":
    unittest.main()
