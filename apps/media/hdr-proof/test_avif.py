"""Fixture/oracle regressions. Native outcomes are checked by suite.py."""
import unittest
import tempfile
from pathlib import Path
import numpy as np
from avif import make_scene, encode_transfer, decode_transfer, geometry_reference, write_png, read_png, convert_frame
from appearance import compare_appearance


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

    def test_native_hdr_resize_preserves_linear_light_and_fractional_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            cases = [(transfer, gamut, alpha, mode)
                     for transfer in ('pq', 'hlg') for gamut in ('p3', 'rec2020')
                     for alpha, mode in ((False, 'contain'), (False, 'upscale'), (True, 'upscale'))]
            for transfer, gamut, alpha, mode in cases:
                with self.subTest(transfer=transfer, gamut=gamut, alpha=alpha, mode=mode):
                    scene = make_scene(alpha)
                    signal = scene.copy()
                    signal[..., :3] = encode_transfer(scene[..., :3], transfer, gamut)
                    source, target = directory/'source.png', directory/'target.png'
                    write_png(source, signal)
                    reference = read_png(source)
                    reference[..., :3] = decode_transfer(reference[..., :3], transfer, gamut)
                    reference = geometry_reference(reference, mode)
                    convert_frame(source, target, transfer, gamut, mode)
                    actual = read_png(target)
                    measurement = compare_appearance(
                        reference[..., :3], decode_transfer(actual[..., :3], transfer, gamut),
                        reference_gamut=gamut, actual_gamut=gamut,
                        fixture_class='avif-12', alpha=reference[..., 3],
                    )
                    self.assertTrue(measurement['passed'], measurement)
                    self.assertLessEqual(np.max(np.abs(reference[..., 3]-actual[..., 3])), 2/4095)

    def test_alpha_downscale_boundary_mismatch_remains_unqualified(self):
        # zimg clamps samples beyond the source edge; the declared independent
        # Pillow reference truncates and normalizes its kernel. This residual
        # is a failed proof, even after fixing transfer and premultiplication.
        # Keep it observable until native boundary handling is implemented.
        with tempfile.TemporaryDirectory() as temporary:
            source, target = Path(temporary)/'source.png', Path(temporary)/'target.png'
            scene = make_scene(True)
            signal = scene.copy()
            signal[..., :3] = encode_transfer(scene[..., :3], 'pq', 'rec2020')
            write_png(source, signal)
            reference = read_png(source)
            reference[..., :3] = decode_transfer(reference[..., :3], 'pq', 'rec2020')
            reference = geometry_reference(reference, 'contain')
            convert_frame(source, target, 'pq', 'rec2020', 'contain')
            actual = read_png(target)
            measurement = compare_appearance(
                reference[..., :3], decode_transfer(actual[..., :3], 'pq', 'rec2020'),
                reference_gamut='rec2020', actual_gamut='rec2020',
                fixture_class='avif-12', alpha=reference[..., 3],
            )
            self.assertFalse(measurement['passed'])
            self.assertIn('shadow.delta_e_max', measurement['failures'])
            self.assertGreater(np.max(np.abs(reference[..., 3]-actual[..., 3])), 2/4095)
