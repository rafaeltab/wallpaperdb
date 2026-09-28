"""Fixture/oracle regressions. Native outcomes are checked by suite.py."""
import unittest
import tempfile
from pathlib import Path
import numpy as np
from avif import make_scene, encode_transfer, decode_transfer, geometry_reference, write_png, read_png


class FixtureTests(unittest.TestCase):
    def test_pq_hlg_round_trip_preserves_absolute_anchors(self):
        scene = make_scene(False)[..., :3]
        for transfer in ('pq', 'hlg'):
            for gamut in ('p3', 'rec2020'):
                recovered = decode_transfer(encode_transfer(scene, transfer, gamut), transfer, gamut)
                np.testing.assert_allclose(recovered, scene, atol=1e-7)

    def test_scene_has_fractional_alpha_and_three_luminance_regions(self):
        scene = make_scene(True)
        self.assertEqual(scene.shape, (64, 96, 4))
        self.assertTrue(np.any((scene[..., 3] > 0) & (scene[..., 3] < 1)))
        for lo, hi in ((0, 10), (10, 203), (203, 1001)):
            self.assertTrue(np.any((scene[..., 0] > lo) & (scene[..., 0] < hi)))

    def test_geometry_reference_is_centered_and_permits_upscaling(self):
        scene = make_scene(False)
        self.assertEqual(geometry_reference(scene, 'contain').shape, (38, 57, 4))
        self.assertEqual(geometry_reference(scene, 'cover').shape, (40, 40, 4))
        self.assertEqual(geometry_reference(scene, 'fill').shape, (48, 40, 4))
        self.assertEqual(geometry_reference(scene, 'upscale').shape, (80, 120, 4))

    def test_independent_libpng_keeps_all_sixteen_bits_and_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            values = np.arange(8*12*4, dtype=float).reshape(8,12,4)*131/65535
            path = Path(temporary)/"codes.png"
            write_png(path, values)
            np.testing.assert_array_equal(read_png(path), np.rint(values*65535)/65535)
