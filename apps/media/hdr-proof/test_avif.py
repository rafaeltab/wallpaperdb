"""Fixture/oracle regressions. Native outcomes are checked by suite.py."""
import unittest
import tempfile
from pathlib import Path
import numpy as np
from avif import make_scene, encode_transfer, decode_transfer, geometry_reference, write_png, read_png, convert_frame
from appearance import compare_appearance, sdr_signal_to_nits
from sdr_reference import reference_srgb


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

    def test_native_cover_filters_before_cropping_the_white_black_boundary(self):
        for transfer, gamut in (('pq', 'rec2020'), ('hlg', 'p3')):
            for alpha in (False, True):
                with self.subTest(transfer=transfer, alpha=alpha), tempfile.TemporaryDirectory() as temporary:
                    source, target = Path(temporary)/'source.png', Path(temporary)/'target.png'
                    scene = make_scene(alpha)
                    signal = scene.copy()
                    signal[..., :3] = encode_transfer(scene[..., :3], transfer, gamut)
                    write_png(source, signal)
                    reference = read_png(source)
                    reference[..., :3] = decode_transfer(reference[..., :3], transfer, gamut)
                    reference = geometry_reference(reference, 'cover')
                    convert_frame(source, target, transfer, gamut, 'cover')
                    actual = read_png(target)
                    measured = compare_appearance(reference[..., :3], decode_transfer(actual[..., :3], transfer, gamut),
                        reference_gamut=gamut, actual_gamut=gamut, fixture_class='avif-12', alpha=reference[..., 3])
                    self.assertTrue(measured['passed'], measured)
                    self.assertLessEqual(np.max(np.abs(reference[..., 3]-actual[..., 3])), 2/4095)

    def test_native_sdr_geometry_matches_independent_full_color_reference(self):
        for transfer in ('pq', 'hlg'):
            with self.subTest(transfer=transfer), tempfile.TemporaryDirectory() as temporary:
                source, target = Path(temporary)/'source.png', Path(temporary)/'target.png'
                scene = make_scene(True)
                signal = scene.copy()
                signal[..., :3] = encode_transfer(scene[..., :3], transfer, 'rec2020')
                write_png(source, signal)
                reference = read_png(source)
                reference[..., :3] = decode_transfer(reference[..., :3], transfer, 'rec2020')
                reference = geometry_reference(reference, 'upscale')
                convert_frame(source, target, transfer, 'rec2020', 'upscale', sdr=True, peak_nits=1000)
                actual = read_png(target)
                expected = reference_srgb(reference[..., :3], 'rec2020', peak_nits=1000)
                measured = compare_appearance(sdr_signal_to_nits(expected), sdr_signal_to_nits(actual[..., :3]),
                    reference_gamut='srgb', actual_gamut='srgb', fixture_class='sdr-8', alpha=reference[..., 3])
                self.assertTrue(measured['passed'], measured)
                self.assertLessEqual(np.max(np.abs(reference[..., 3]-actual[..., 3])), 2/4095)

    def test_eight_bit_tone_control_finds_authored_white_after_source_quantization(self):
        from avif import generate_fixture, decode_avif, sdr_tone_control
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            spec = {'id': 'pq8-control', 'transfer': 'pq', 'gamut': 'rec2020', 'depth': 8, 'alpha': False, 'frames': 1}
            source, _, authored = generate_fixture(spec, directory)
            decoded = decode_avif(source, directory, 1)[0]
            reference = decoded.copy()
            reference[..., :3] = decode_transfer(decoded[..., :3], 'pq', 'rec2020')
            control = sdr_tone_control(directory/'decoded-0.png', directory/'control.png',
                                      reference, authored[0], 'pq', 'rec2020', peak_nits=1000)
            self.assertTrue(control['passed'], control)
            self.assertIn('ordinary_white_signal', control['measurement']['measurements'])

    def test_native_optional_twelve_bit_sdr_keeps_required_eight_bit_failures(self):
        from avif import run
        from matrix import build_matrix, required_cases
        spec = {'id': 'avif-pq-rec2020-10-opaque', 'transfer': 'pq', 'gamut': 'rec2020',
                'depth': 10, 'alpha': False, 'frames': 1}
        with tempfile.TemporaryDirectory() as temporary:
            result = run(temporary, specs=[spec])
            cases = {case['case_id']: case for case in result['evidence']}
            self.assertEqual(len(cases), 22)
            for geometry in ('contain', 'cover', 'fill', 'upscale', 'orientation'):
                baseline_id = f'{spec["id"]}:sdr:avif:srgb:preserve:{geometry}'
                baseline, candidate = cases[baseline_id], cases[baseline_id + ':depth-12']
                self.assertEqual(baseline['selectors']['depth'], '8')
                self.assertEqual(candidate['selectors']['depth'], '12')
                self.assertEqual(candidate['facts']['depth'], 12)
                self.assertEqual(candidate['status'], 'qualified', candidate['blockers'])
                self.assertNotEqual(baseline['artifacts']['output'], candidate['artifacts']['output'])
                self.assertTrue(candidate['optional_depth_variant'])
                self.assertEqual(candidate['measurements']['frames'][0]['fixture_class'], 'sdr-8')
                self.assertEqual(candidate['appearance_threshold_policy']['coded_depth'], 12)
            failed_eight = cases[f'{spec["id"]}:sdr:avif:srgb:preserve:contain']
            self.assertEqual(failed_eight['status'], 'tested and failed')
            matrix = build_matrix(result['evidence'])
            self.assertEqual(len(required_cases()), 320)
            self.assertEqual(matrix['evidence_errors'], [])
            cell = next(cell for cell in matrix['cells'] if cell['id'] == 'static-avif:sdr:avif')
            self.assertEqual(cell['status'], 'tested and failed')

    def test_native_sixteen_bit_png_rejects_eight_bit_fractional_alpha_precision(self):
        from avif import encode_other
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            reference = np.full((8, 12, 4), .25)
            reference[..., 3] = np.linspace(.03125, .96875, 8*12).reshape(8, 12)
            reference = np.rint(reference*65535)/65535
            spec = {'alpha': True, 'frames': 1}
            for quantized in (False, True):
                with self.subTest(eight_bit_alpha_in_sixteen_bit_png=quantized):
                    pixels = reference.copy()
                    if quantized:
                        pixels[..., 3] = np.rint(pixels[..., 3]*255)/255
                    source, output = directory/f'input-{quantized}.png', directory/f'output-{quantized}.png'
                    write_png(source, pixels)
                    facts, actual, checks = encode_other([source], output, 'png', 'srgb', 'srgb', [reference], 1, spec)
                    self.assertEqual(facts['exiftool']['BitDepth'], 16)
                    self.assertEqual(checks['alpha'], not quantized)
                    self.assertEqual(facts['alpha_measurement']['absolute_error_limit'], 2/65535)
                    actual_error = float(np.max(np.abs(actual[0][..., 3]-reference[..., 3])))
                    self.assertEqual(facts['alpha_measurement']['maximum_absolute_error'], actual_error)
