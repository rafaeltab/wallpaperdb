"""Native source reconstruction must establish its interpretation independently."""
from pathlib import Path
import tempfile
import unittest

import numpy as np

from gainmap import inspect, source_hdr


class SourceDecoderTests(unittest.TestCase):
    def test_verified_iso_reader_establishes_source_without_claiming_libavif_iso_support(self):
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-iso.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            facts = inspect(source, directory)
            pixels, gamut, evidence = source_hdr(source, directory, 'p3')
        self.assertEqual(gamut, 'p3')
        self.assertEqual(pixels.shape, (facts['base']['height'], facts['base']['width'], 3))
        self.assertTrue(np.all(np.isfinite(pixels)))
        self.assertIn('independent ISO', evidence['decoder'])
        self.assertIn('preferred_decoder_failure', evidence)
        self.assertTrue(evidence['base_color']['icc_sha256'])

    def test_iso_color_facts_must_match_the_declared_source_gamut(self):
        source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-iso.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            inspect(source, directory)
            with self.assertRaisesRegex(ValueError, 'disagrees'):
                source_hdr(source, directory, 'srgb')


if __name__ == '__main__':
    unittest.main()
