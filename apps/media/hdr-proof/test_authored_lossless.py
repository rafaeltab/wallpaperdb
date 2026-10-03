"""Native lossless SDR derivatives retain the authored base and actual ICC."""
from pathlib import Path
import tempfile
import unittest

import numpy as np

from appearance import compare_appearance, sdr_signal_to_nits
from gainmap import source_image, geometry
from authored_lossless import encode, decode_linear


class AuthoredLosslessTests(unittest.TestCase):
    def test_png_and_webp_preserve_authored_base_in_both_requested_gamuts(self):
        root = Path(__file__).parent/'fixtures/gainmap'
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, gamut in (('apple-new', 'p3'), ('android-xmp', 'srgb')):
                source = root/f'gainmap-{name}.jpg'
                expected = sdr_signal_to_nits(np.asarray(geometry(source_image(source, 'preserve'), 'contain'))/255)
                for extension in ('png', 'webp'):
                    with self.subTest(source=name, extension=extension):
                        output = directory/f'{name}.{extension}'
                        encoded = encode(source, output, 'contain', gamut=gamut)
                        actual, facts = decode_linear(output, gamut=gamut)
                        measured = compare_appearance(expected, actual, reference_gamut=gamut,
                            actual_gamut='rec2020', fixture_class='gainmap-sdr')
                        self.assertTrue(measured['passed'], measured['failures'])
                        self.assertEqual(facts['gamut'], gamut)
                        self.assertEqual(facts['depth'], 8)
                        self.assertTrue(facts['privacy'])
                        self.assertEqual(encoded['icc_sha256'], facts['icc_sha256'])


if __name__ == '__main__':
    unittest.main()
