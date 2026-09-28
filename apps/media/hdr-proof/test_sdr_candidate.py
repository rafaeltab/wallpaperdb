"""Native tone policy regression, independently decoded and measured."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
from appearance import evaluate_sdr_tone_map, compare_appearance, sdr_signal_to_nits
from avif import make_scene, encode_transfer, write_png, read_png
from sdr_candidate import convert
from sdr_reference import reference_srgb


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

    def test_native_gamut_conversion_matches_independent_colorimetric_reference(self):
        for gamut in ('p3', 'rec2020'):
            with self.subTest(gamut=gamut), tempfile.TemporaryDirectory() as directory:
                directory = Path(directory)
                scene = make_scene(False)
                signal = scene.copy()
                signal[..., :3] = encode_transfer(scene[..., :3], 'pq', gamut)
                source, output = directory/'input.png', directory/'output.png'
                write_png(source, signal)
                convert(source, output, 'pq', gamut, peak_nits=1000)
                actual = read_png(output)
                expected = reference_srgb(scene[..., :3], gamut, peak_nits=1000)
                measured = evaluate_sdr_tone_map(scene[..., :3], actual[..., :3],
                    source_gamut=gamut, reference_srgb=expected)
                self.assertTrue(measured['passed'], measured)

    def test_hlg_reference_display_has_the_same_sdr_grade_as_pq(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            scene = make_scene(False)
            signal = scene.copy()
            signal[..., :3] = encode_transfer(scene[..., :3], 'hlg', 'rec2020')
            source, output = directory/'hlg.png', directory/'output.png'
            write_png(source, signal)
            convert(source, output, 'hlg', 'rec2020', peak_nits=1000)
            actual = read_png(output)
            measured = evaluate_sdr_tone_map(scene[..., :3], actual[..., :3],
                source_gamut='rec2020', reference_srgb=reference_srgb(scene[..., :3], 'rec2020', peak_nits=1000))
            self.assertTrue(measured['passed'], measured)

    def test_partial_alpha_preserves_straight_sdr_colors(self):
        for transfer in ('pq', 'hlg'):
            with self.subTest(transfer=transfer), tempfile.TemporaryDirectory() as directory:
                directory = Path(directory)
                scene = make_scene(True)
                signal = scene.copy()
                signal[..., :3] = encode_transfer(scene[..., :3], transfer, 'rec2020')
                source, output = directory/'input.png', directory/'output.png'
                write_png(source, signal)
                convert(source, output, transfer, 'rec2020', peak_nits=1000)
                actual = read_png(output)
                expected = reference_srgb(scene[..., :3], 'rec2020', peak_nits=1000)
                measured = compare_appearance(sdr_signal_to_nits(expected),
                    sdr_signal_to_nits(actual[..., :3]), reference_gamut='srgb', actual_gamut='srgb',
                    fixture_class='sdr-8', alpha=scene[..., 3])
                self.assertTrue(measured['passed'], measured)
                np.testing.assert_allclose(actual[..., 3], scene[..., 3], atol=2/65535)

    def test_reference_includes_valid_pq_quantization_above_nominal_peak(self):
        signal = np.rint(encode_transfer(np.array([[[1000., 1000., 1000.]]]), 'pq', 'rec2020') * 255) / 255
        from avif import decode_transfer
        actual_nits = decode_transfer(signal, 'pq', 'rec2020')
        self.assertGreater(float(actual_nits.max()), 1000)
        mapped = reference_srgb(actual_nits, 'rec2020', peak_nits=1000)
        self.assertTrue(np.all(np.isfinite(mapped)))
        self.assertTrue(np.all((mapped >= 0) & (mapped <= 1)))
