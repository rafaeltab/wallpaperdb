"""Actual native map regeneration from independently prepared SDR/HDR intents."""

from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from gainmap import FIXTURES, inspect
from gainmap_combine import encode
from gainmap_iso import decode_iso_source


class NativeCombinedGainMapTests(unittest.TestCase):
    def test_native_combination_retains_exact_authored_base_and_gain_samples(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, gamut in (("gainmap-android-xmp", "srgb"), ("gainmap-apple-new", "p3")):
                with self.subTest(source=name):
                    target = directory/f"{name}.jpg"
                    evidence = encode(FIXTURES/f"{name}.jpg", target, "contain", gamut=gamut)
                    facts = inspect(target, directory/name)
                    self.assertEqual(facts['base']['depth'], 8)
                    self.assertEqual(facts['map']['depth'], 8)
                    self.assertEqual(facts['private_tags'], [])
                    self.assertTrue(facts['iso_identifier'])
                    self.assertTrue(facts['android_xmp_properties'])
                    for encoded, intended in ((target, evidence['authored_sdr_png']),
                                              (directory/name/'map.jpg', evidence['gain_map_png'])):
                        with Image.open(encoded) as actual, Image.open(intended) as expected:
                            np.testing.assert_array_equal(np.asarray(actual), np.asarray(expected))
                    decoded = decode_iso_source(target.read_bytes(), (directory/name/'map.jpg').read_bytes())
                    self.assertEqual(decoded['gamut'], gamut)
                    self.assertGreater(float(decoded['linear_rgb_nits'].max()), 203)
                    self.assertEqual(evidence['hdr_geometry']['dimensions'], evidence['base_geometry']['dimensions'])


if __name__ == "__main__":
    unittest.main()
