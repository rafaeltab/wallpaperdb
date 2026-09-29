"""Native HDR/SDR intent regeneration must retain the supplied authored base."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np

from gainmap import independent_hdr, inspect, output_gamut
from test_native_gainmap import native, pixels

ROOT = Path(__file__).parent


class NativeGainMapRegenerationTests(unittest.TestCase):
    def test_regenerated_map_preserves_authored_base_and_source_display_headroom(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, gamut in (("apple-old", "p3"), ("apple-new", "p3"),
                                ("android-xmp", "srgb"), ("android-iso", "p3")):
                with self.subTest(source=name):
                    case_dir = directory / name
                    case_dir.mkdir()
                    source = ROOT / "fixtures/gainmap" / f"gainmap-{name}.jpg"
                    output = case_dir / "output.jpg"
                    job = {"case_id": name, "mode": "native-regenerate", "format": "jpg",
                           "gamut": "preserve", "source_gamut": gamut, "geometry": "contain",
                           "input": str(source), "output": str(output)}
                    result = subprocess.run(["node", str(ROOT / "gainmap.cjs")], input=json.dumps([job]),
                                            capture_output=True, text=True, check=True, timeout=30)
                    record = json.loads(result.stdout)
                    self.assertTrue(record["ok"], record)
                    self.assertEqual(record.get("native_variant"), "both")
                    np.testing.assert_array_equal(pixels(output), pixels(record["retained_parts"]["base"]))
                    facts = inspect(output, case_dir / "inspection")
                    self.assertEqual(output_gamut(facts), gamut)
                    self.assertEqual(facts["private_tags"], [])
                    self.assertEqual(facts["map_private_tags"], [])
                    self.assertTrue(facts["android_xmp_properties"])
                    self.assertTrue(facts["iso_identifier"])
                    for key in ("width", "height", "depth"):
                        self.assertEqual(facts["base"][key], facts["map"][key])
                    source_metadata = json.loads(native("both", "probe", source).stdout)
                    output_metadata = json.loads(native("both", "probe", output).stdout)
                    self.assertAlmostEqual(output_metadata["hdr_capacity_max"],
                                           source_metadata["hdr_capacity_max"], places=4)
                    self.assertNotEqual(output_metadata["maximum_boost"], source_metadata["maximum_boost"])
                    (case_dir / "oracle").mkdir()
                    hdr = independent_hdr(output, case_dir / "oracle", gamut)
                    self.assertEqual(hdr.shape, pixels(output).shape)
                    self.assertGreater(float(hdr.max()), 203)
                    self.assertTrue(np.isfinite(hdr).all())
                    raw = np.fromfile(record["native_hdr_source"]["path"], dtype="<f4")
                    self.assertTrue(np.isfinite(raw).all())
                    self.assertGreater(float(raw.max()), 1, "The native HDR handoff must not clip to SDR white")
                    # Structural success is deliberately separate from the
                    # unchanged independent SDR/HDR appearance qualification.


if __name__ == "__main__":
    unittest.main()
