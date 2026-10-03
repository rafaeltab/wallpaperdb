"""Test the proof's oracles against deliberately wrong, still decodable images."""

import unittest

import numpy as np

from appearance import (
    compare_appearance,
    delta_e_itp,
    evaluate_sdr_tone_map,
    linear_rgb_to_itp,
    sdr_signal_to_nits,
    RGB_TO_XYZ,
)


def reference_ramp():
    levels = np.concatenate((np.linspace(0, 10, 21), np.linspace(18, 203, 40),
                             np.linspace(220, 1000, 40)))
    return np.repeat(levels[:, None], 3, axis=1)


def example_sdr_curve(source):
    # Test input only: smooth curve anchored at ordinary white, never used to
    # generate a codec output or a qualification reference.
    luminance = source[..., 0]
    linear_white = sdr_signal_to_nits(np.array(0.9)) / 100
    linear = np.minimum(luminance, 203) * linear_white / 203
    signal = np.where(linear <= 0.0031308, 12.92 * linear,
                      1.055 * np.maximum(linear, 0) ** (1 / 2.4) - 0.055)
    signal = np.where(luminance > 203,
                      0.9 + 0.1 * (1 - np.exp(-(luminance - 203) / 400)), signal)
    return np.repeat(signal[..., None], 3, axis=-1)


class AppearanceTests(unittest.TestCase):
    def test_itu_published_colour_vector(self):
        actual = linear_rgb_to_itp(np.array([8.753, 2.291, 181.3]), "rec2020")
        # Annex 4's printed intermediate values are rounded and do not exactly
        # reproduce its printed ITP triplet. Keep this published-vector check
        # separate from the exact neutral-vector normalization below.
        np.testing.assert_allclose(actual, [0.3554, 0.1346, -0.1613], atol=0.0005)

    def test_pq_absolute_luminance_normalization(self):
        actual = linear_rgb_to_itp(np.array([100, 100, 100]), "rec2020")
        np.testing.assert_allclose(actual, [0.508078421517399, 0, 0], atol=1e-12)

    def test_identical_pixels_have_zero_delta(self):
        ramp = reference_ramp()
        np.testing.assert_allclose(delta_e_itp(ramp, ramp), 0, atol=1e-10)

    def test_same_p3_color_in_signed_rec2020_coordinates_keeps_its_measurement(self):
        p3 = np.array([[1., 0., 0.], [100., 0., 0.], [1000., 0., 0.]])
        rec2020 = p3 @ RGB_TO_XYZ['p3'].T @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T
        self.assertLess(float(rec2020.min()), 0)
        np.testing.assert_allclose(delta_e_itp(p3, rec2020, 'p3', 'rec2020'), 0, atol=1e-10)
        measured = compare_appearance(p3, rec2020, reference_gamut='p3', actual_gamut='rec2020',
                                      fixture_class='gainmap-hdr')
        self.assertTrue(measured['passed'])
        for region in measured['regions'].values():
            if region.get('samples'):
                self.assertLess(region['luminance_absolute_error_nits']['maximum'], 1e-10)
        # Clipping these coordinates changes the color. Measurement must not do it.
        self.assertGreater(float(delta_e_itp(p3, np.maximum(rec2020, 0), 'p3', 'rec2020').max()), .01)

    def test_negative_luminance_and_out_of_domain_lms_remain_rejected(self):
        for invalid in (np.array([-1., -1., -1.]), np.array([-200., 100., 0.])):
            with self.subTest(rgb=invalid), self.assertRaisesRegex(ValueError, 'luminance|LMS'):
                linear_rgb_to_itp(invalid, 'rec2020')

    def test_matched_geometry_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "geometry"):
            compare_appearance(reference_ramp(), reference_ramp()[:-1],
                               reference_gamut="rec2020", actual_gamut="rec2020",
                               fixture_class="avif-10")

    def test_every_present_region_is_reported(self):
        ramp = reference_ramp()
        result = compare_appearance(ramp, ramp, reference_gamut="rec2020",
                                    actual_gamut="rec2020", fixture_class="avif-10")
        self.assertTrue(result["passed"])
        self.assertEqual(set(result["regions"]), {"shadow", "midtone", "highlight"})
        self.assertGreater(result["regions"]["shadow"]["samples"], 0)

    def test_sdr_errors_can_be_grouped_by_original_hdr_luminance(self):
        reference = np.repeat(np.array([[1., 50., 90.]])[..., None], 3, axis=-1)
        actual = reference.copy()
        actual[0, 2] = 45
        result = compare_appearance(reference, actual, reference_gamut='srgb', actual_gamut='srgb',
                                    fixture_class='sdr-8', region_reference_luminance_nits=np.array([[1., 150., 1000.]]))
        self.assertFalse(result['passed'])
        self.assertEqual(result['regions']['highlight']['samples'], 1)
        self.assertAlmostEqual(result['regions']['highlight']['reference_mean_nits'], 90, places=3)
        self.assertTrue(any(failure.startswith('highlight.') for failure in result['failures']))

    def test_region_luminance_requires_matched_finite_nonnegative_geometry(self):
        reference = reference_ramp()
        for invalid in (np.array([1.]), np.full(reference.shape[:-1], np.nan), -np.ones(reference.shape[:-1])):
            with self.subTest(shape=invalid.shape), self.assertRaisesRegex(ValueError, 'region luminance'):
                compare_appearance(reference, reference, reference_gamut='rec2020', actual_gamut='rec2020',
                                   fixture_class='avif-10', region_reference_luminance_nits=invalid)

    def test_wrong_transfer_cannot_pass_even_with_identical_shape(self):
        ramp = reference_ramp()
        wrong = np.minimum(ramp, 100)
        result = compare_appearance(ramp, wrong, reference_gamut="rec2020",
                                    actual_gamut="rec2020", fixture_class="avif-8")
        self.assertFalse(result["passed"])
        self.assertTrue(any("highlight" in failure for failure in result["failures"]))

    def test_wrong_gamut_cannot_pass_even_with_identical_rgb_numbers(self):
        colours = np.array([[203, 0, 0], [0, 203, 0], [0, 0, 203], [500, 80, 50]])
        result = compare_appearance(colours, colours, reference_gamut="rec2020",
                                    actual_gamut="srgb", fixture_class="avif-8")
        self.assertFalse(result["passed"])

    def test_small_shadow_region_cannot_hide_in_whole_image_average(self):
        reference = np.ones((1000, 3)) * 500
        reference[0] = 1
        actual = reference.copy()
        actual[0] = 0
        result = compare_appearance(reference, actual, reference_gamut="rec2020",
                                    actual_gamut="rec2020", fixture_class="avif-10")
        self.assertFalse(result["passed"])

    def test_unknown_threshold_class_is_not_qualified(self):
        with self.assertRaisesRegex(ValueError, "threshold"):
            compare_appearance(reference_ramp(), reference_ramp(),
                               reference_gamut="rec2020", actual_gamut="rec2020",
                               fixture_class="unreviewed")

    def test_non_finite_pixels_are_not_qualified(self):
        actual = reference_ramp()
        actual[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            compare_appearance(reference_ramp(), actual, reference_gamut="rec2020",
                               actual_gamut="rec2020", fixture_class="avif-10")

    def test_empty_visible_image_is_not_qualified(self):
        ramp = reference_ramp()
        with self.assertRaisesRegex(ValueError, "visible"):
            compare_appearance(ramp, ramp, reference_gamut="rec2020",
                               actual_gamut="rec2020", fixture_class="avif-10",
                               alpha=np.zeros(ramp.shape[:-1]))

    def test_fractional_alpha_does_not_hide_premultiplication_damage(self):
        ramp = reference_ramp()
        result = compare_appearance(ramp, ramp * 0.5, reference_gamut="rec2020",
                                    actual_gamut="rec2020", fixture_class="avif-10",
                                    alpha=np.ones(ramp.shape[:-1]) * 0.5)
        self.assertFalse(result["passed"])

    def test_tone_curve_requires_gamut_evidence(self):
        source = reference_ramp()
        result = evaluate_sdr_tone_map(source, example_sdr_curve(source),
                                       source_gamut="rec2020")
        self.assertFalse(result["passed"])
        self.assertIn("gamut_mapping_reference_missing", result["failures"])
        self.assertTrue(result["tone_curve_passed"])

    def test_ordinary_white_at_full_signal_is_rejected(self):
        source = reference_ramp()
        output = np.clip(example_sdr_curve(source) / 0.9, 0, 1)
        result = evaluate_sdr_tone_map(source, output, source_gamut="rec2020")
        self.assertIn("ordinary_white_signal", result["failures"])
        self.assertIn("highlight_headroom", result["failures"])

    def test_hard_clipped_highlights_are_rejected(self):
        source = reference_ramp()
        output = example_sdr_curve(source)
        output[source[:, 0] > 300] = 1
        result = evaluate_sdr_tone_map(source, output, source_gamut="rec2020")
        self.assertIn("highlight_clipping", result["failures"])

    def test_crushed_shadows_are_rejected(self):
        source = reference_ramp()
        output = example_sdr_curve(source)
        output[source[:, 0] < 10] = 0
        result = evaluate_sdr_tone_map(source, output, source_gamut="rec2020")
        self.assertIn("shadow_retention", result["failures"])

    def test_missing_white_probe_is_not_qualified(self):
        source = reference_ramp()
        selected = source[:, 0] < 100
        result = evaluate_sdr_tone_map(source[selected], example_sdr_curve(source[selected]),
                                       source_gamut="rec2020")
        self.assertIn("ordinary_white_probe_missing", result["failures"])


if __name__ == "__main__":
    unittest.main()
