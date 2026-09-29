"""Unknown color facts cannot authorize a cross-format appearance comparison."""
import unittest
import tempfile
from pathlib import Path

from crossformat import established_output_gamut, run
from avif import fixture_specs, generate_fixture


class CrossformatFactsTests(unittest.TestCase):
    def test_missing_or_unrecognized_profiles_remain_unknown(self):
        for description in (None, 'sRGB-ish', 'unverified P3 profile', 'unknown 2020'):
            with self.subTest(description=description), self.assertRaisesRegex(ValueError, 'Unknown emitted'):
                established_output_gamut({'metadata': {'ICC_Profile:ProfileDescription': description}})

    def test_independently_recognized_profile_identifies_gamut(self):
        self.assertEqual(established_output_gamut({'metadata': {'ICC_Profile:ProfileDescription': 'Display P3'}}), 'p3')

    def test_native_iso_output_can_have_decoder_evidence_while_appearance_still_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for spec in fixture_specs():
                if spec['depth'] == 10 and not spec['alpha'] and spec['frames'] == 1:
                    generate_fixture(spec, directory/'avif'/spec['id'])
            cases = run(directory)
            selected = [case for case in cases if '-p3-' in case['fixture_id']]
            self.assertEqual(len(selected), 2)
            for case in selected:
                with self.subTest(case=case['case_id']):
                    self.assertTrue(case['checks']['independent_decoder'], case['blockers'])
                    self.assertIn('independent ISO', case['output_decoder_evidence']['decoder'])
                    self.assertEqual(case['status'], 'tested and failed')
                    self.assertFalse(case['checks']['appearance'])


if __name__ == '__main__':
    unittest.main()
