"""Unknown color facts cannot authorize a cross-format appearance comparison."""
import unittest

from crossformat import established_output_gamut


class CrossformatFactsTests(unittest.TestCase):
    def test_missing_or_unrecognized_profiles_remain_unknown(self):
        for description in (None, 'sRGB-ish', 'unverified P3 profile', 'unknown 2020'):
            with self.subTest(description=description), self.assertRaisesRegex(ValueError, 'Unknown emitted'):
                established_output_gamut({'metadata': {'ICC_Profile:ProfileDescription': description}})

    def test_independently_recognized_profile_identifies_gamut(self):
        self.assertEqual(established_output_gamut({'metadata': {'ICC_Profile:ProfileDescription': 'Display P3'}}), 'p3')


if __name__ == '__main__':
    unittest.main()
