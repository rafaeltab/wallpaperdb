"""Regression for libavif 1.4.1 animated irot serialization.

The unpatched encoder dereferences a null stream when writing an animated
sample entry's transformative properties. This test uses real AOM encoding,
dav1d decoding, and independent PNG pixels; no transform flag is omitted.
"""

from pathlib import Path
import tempfile
import unittest

import numpy as np

from avif import decode_avif, encode_avif, inspect_avif, timing, write_png


class AnimatedOrientationTests(unittest.TestCase):
    def test_rotation_retains_both_hdr_frames_alpha_timing_and_loop(self):
        with tempfile.TemporaryDirectory(prefix="hdr-orientation-") as temporary:
            directory = Path(temporary)
            y, x = np.mgrid[:16, :24]
            first = np.stack((.1 + .6*x/23, .15 + .4*y/15,
                              np.full_like(x, .55, dtype=float), .25 + .5*x/23), axis=-1)
            second = np.roll(first, 5, axis=1).copy()
            second[..., 1] = 1-second[..., 1]
            inputs = [directory / f"frame-{index}.png" for index in range(2)]
            for path, frame in zip(inputs, (first, second)):
                write_png(path, frame)
            for transfer in ("pq", "hlg"):
                with self.subTest(transfer=transfer):
                    baseline = directory / f"{transfer}-baseline.avif"
                    oriented = directory / f"{transfer}-oriented.avif"
                    encode_avif(inputs, baseline, transfer, "rec2020", 10)
                    reference = decode_avif(baseline, directory, 2)
                    encode_avif(inputs, oriented, transfer, "rec2020", 10, orientation=True)
                    facts = inspect_avif(oriented)
                    self.assertIn("irot (Rotation)      : 1", facts["info"])
                    self.assertEqual(timing(facts), [3, 7])
                    self.assertIn("Repeat Count   : 2", facts["info"])
                    self.assertEqual(facts["depth"], 10)
                    self.assertEqual(facts["primaries"], 9)
                    self.assertEqual(facts["transfer"], 16 if transfer == "pq" else 18)
                    self.assertEqual(facts["exiftool"]["TransferCharacteristics"], facts["transfer"])
                    decoded = decode_avif(oriented, directory, 2)
                    self.assertEqual(len(decoded), 2)
                    for actual, expected in zip(decoded, reference):
                        self.assertEqual(actual.shape, (24, 16, 4))
                        np.testing.assert_array_equal(actual, np.rot90(expected))
                        self.assertTrue(np.any((actual[..., 3] > 0) & (actual[..., 3] < 1)))


if __name__ == "__main__":
    unittest.main()
