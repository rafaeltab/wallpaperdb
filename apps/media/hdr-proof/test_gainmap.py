"""Independent parser guards and pinned real-fixture integrity checks."""

import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

from gainmap_iso import ISO_ID, iso_metadata, jpeg_facts

ROOT = Path(__file__).parent


class GainMapProofTests(unittest.TestCase):
    def test_orientation_evidence_reads_actual_native_source_tag(self):
        from gainmap import orientation_source
        source = ROOT/'fixtures/gainmap/gainmap-apple-new.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for value in (2, 6):
                with self.subTest(orientation=value):
                    changed = directory/f'orientation-{value}.jpg'
                    changed.write_bytes(source.read_bytes())
                    subprocess.run(['exiftool', '-overwrite_original', f'-Orientation#={value}', str(changed)],
                                   check=True, capture_output=True)
                    observed = orientation_source(changed, directory/f'inspect-{value}.json')
                    self.assertEqual(observed['orientation'], value)
                    self.assertEqual(observed['facts']['metadata']['IFD0:Orientation'], value)
                    self.assertEqual(observed['sha256'], hashlib.sha256(changed.read_bytes()).hexdigest())

    def test_iso_fixture_native_generation_reproduces_committed_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "iso.jpg"
            subprocess.run(["node", str(ROOT / "gainmap-fixture.cjs"), str(output)], check=True,
                           capture_output=True, timeout=30)
            expected = (ROOT / "fixtures" / "gainmap" / "gainmap-android-iso.jpg").read_bytes()
            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), hashlib.sha256(expected).hexdigest())

    def test_committed_fixture_bytes_match_provenance(self):
        directory = ROOT / "fixtures" / "gainmap"
        manifest = json.loads((directory / "manifest.json").read_text())
        for fixture in manifest["fixtures"]:
            with self.subTest(fixture=fixture["id"]):
                data = (directory / fixture["file"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), fixture["sha256"])
                facts = jpeg_facts(data)
                self.assertEqual(facts["depth"], fixture["expected"]["base_depth"])
                self.assertEqual(facts["width"], fixture["expected"]["width"])
                self.assertEqual(facts["height"], fixture["expected"]["height"])

    def test_iso_reader_rejects_zero_denominator(self):
        # A malformed metadata record is never treated as an original fact.
        metadata = struct.pack(">HHB", 0, 0, 64) + struct.pack(">IIII", 0, 0, 1, 1)
        payload = ISO_ID + metadata
        jpeg = b"\xff\xd8\xff\xe2" + struct.pack(">H", len(payload) + 2) + payload + b"\xff\xda\x00\x02"
        with self.assertRaisesRegex(ValueError, "denominator"):
            iso_metadata(jpeg)

    def test_iso_reader_rejects_unknown_version(self):
        payload = ISO_ID + struct.pack(">HHB", 1, 1, 64)
        jpeg = b"\xff\xd8\xff\xe2" + struct.pack(">H", len(payload) + 2) + payload + b"\xff\xda\x00\x02"
        with self.assertRaisesRegex(ValueError, "version"):
            iso_metadata(jpeg)


if __name__ == "__main__":
    unittest.main()
