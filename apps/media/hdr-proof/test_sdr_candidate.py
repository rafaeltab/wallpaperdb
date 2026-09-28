"""Native tone policy regression, independently decoded and measured."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
from appearance import evaluate_sdr_tone_map
from avif import make_scene, encode_transfer, write_png, read_png
from sdr_candidate import convert


class NativeSdrTests(unittest.TestCase):
    def test_pq_neutral_chart_places_white_and_retains_shadows(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            scene = make_scene(False)
            signal = scene.copy()
            signal[..., :3] = encode_transfer(scene[..., :3], 'pq', 'rec2020')
            source, output = directory/'input.png', directory/'output.png'
            write_png(source, signal)
            convert(source, output, 'pq', 'rec2020', peak_nits=1000)
            actual = read_png(output)
            measured = evaluate_sdr_tone_map(scene[..., :3], actual[..., :3], source_gamut='rec2020')
            self.assertTrue(measured['tone_curve_passed'], measured)
            np.testing.assert_array_equal(actual[..., 3], scene[..., 3])
