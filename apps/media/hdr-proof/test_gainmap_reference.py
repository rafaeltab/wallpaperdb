"""Analytic controls for the explicitly versioned HDR geometry reference."""
import unittest

import numpy as np
from PIL import Image

from appearance import RGB_TO_XYZ, compare_appearance
from gainmap import array_geometry, geometry
from gainmap_reference import reference


def convert(values, source, target):
    return values @ RGB_TO_XYZ[source].T @ np.linalg.inv(RGB_TO_XYZ[target]).T


def unclipped_geometry(values):
    return np.stack([np.asarray(geometry(Image.fromarray(values[..., c].astype(np.float32)), 'fill'))
                     for c in range(3)], axis=-1)


class GainMapReferenceTests(unittest.TestCase):
    def test_linear_filtering_commutes_with_primary_conversion_before_clipping(self):
        source = np.random.default_rng(284).uniform(0, 50, (8, 11, 3))
        before = unclipped_geometry(convert(source, 'p3', 'rec2020'))
        after = convert(unclipped_geometry(source), 'p3', 'rec2020')
        # Pillow's float32 separable filter introduces a few float32 ULPs;
        # this numerical identity is independent of any codec error budget.
        np.testing.assert_allclose(before, after, atol=2e-5, rtol=0)

    def test_clipping_in_other_primaries_can_leave_the_requested_gamut(self):
        source_p3 = np.zeros((8, 8, 3))
        source_p3[:, :4, 1] = 25
        source_p3[:, 4:, 2] = 25
        source_rec2020 = convert(source_p3, 'p3', 'rec2020')
        legacy = convert(array_geometry(source_rec2020, 'fill'), 'rec2020', 'p3')
        self.assertLess(float(legacy.min()), -.01)
        corrected, facts = reference(source_rec2020, 'rec2020', 'p3', 'fill')
        np.testing.assert_allclose(corrected, np.maximum(unclipped_geometry(source_p3), 0),
                                   atol=1e-5, rtol=0)
        self.assertGreaterEqual(float(corrected.min()), 0)
        self.assertEqual(facts['revision'], 'gainmap-hdr-target-gamut-v1')

    def test_identity_preserves_physical_color_across_metric_coordinates(self):
        p3 = np.array([[[25., 0., 0.], [0., 25., 0.], [0., 0., 25.], [30., 30., 30.]]])
        rec2020 = convert(p3, 'p3', 'rec2020')
        self.assertLess(float(rec2020.min()), 0)
        result, facts = reference(rec2020, 'rec2020', 'p3', 'identity')
        np.testing.assert_allclose(result, p3, atol=1e-12, rtol=0)
        measured = compare_appearance(p3, result, reference_gamut='p3', actual_gamut='p3',
                                      fixture_class='gainmap-hdr')
        self.assertTrue(measured['passed'], measured)
        self.assertEqual(facts['clipping_gamut'], 'p3')

    def test_revision_keeps_existing_geometry_and_does_not_mutate_legacy_reference(self):
        source = np.random.default_rng(250).uniform(0, 100, (300, 400, 3))
        for operation in ('contain', 'cover', 'fill', 'upscale', 'crop', 'orientation'):
            with self.subTest(operation=operation):
                actual, facts = reference(source, 'p3', 'p3', operation, orientation=6)
                expected = array_geometry(source, operation, 6)
                np.testing.assert_array_equal(actual, expected)
                self.assertEqual(facts['geometry'], operation)
                self.assertEqual(facts['orientation'], 6)

    def test_unknown_color_facts_nonfinite_pixels_and_unknown_geometry_fail_closed(self):
        source = np.ones((4, 4, 3))
        for args in ((source, 'unknown', 'p3', 'identity'), (source, 'p3', 'unknown', 'identity'),
                     (source * np.nan, 'p3', 'p3', 'identity'), (source, 'p3', 'p3', 'unknown')):
            with self.subTest(args=args[1:]), self.assertRaises(ValueError):
                reference(*args)


if __name__ == '__main__':
    unittest.main()
