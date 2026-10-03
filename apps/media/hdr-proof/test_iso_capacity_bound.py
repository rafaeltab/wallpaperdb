"""Capacity-family diagnostics keep native zero-weight semantics separate."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif


class CapacityMathTests(unittest.TestCase):
    def test_imported_metadata_requires_every_actual_fraction_and_forward_space(self):
        from iso_capacity_bound import imported_metadata
        text = '\n'.join([
            ' * Base headroom: 1 (as fraction: 1/1)',
            ' * Alternate headroom: 3 (as fraction: 3/1)',
            *[f' * {name}: '+ ' '.join(f'{channel} {value} (as fraction: {fraction})' for channel in 'RGB')
              for name, value, fraction in [('Gain Map Min', 0, '0/1'), ('Gain Map Max', 2, '2/1'),
                  ('Base Offset', .25, '1/4'), ('Alternate Offset', .125, '1/8'), ('Gain Map Gamma', 1, '1/1')]],
            ' * Use Base Color Space: True'])
        self.assertEqual(imported_metadata(text, 1)['base_offset'], [[1, 4]]*3)
        for changed in (text.replace('1/4', '1/5'), text.replace('1/8', '1/0'),
                        text.replace('1/1', '0/1', 1), text.replace('True', 'False'),
                        text+'\n * Gain Map Min: missing', text.replace('G 2 ', 'R 2 ')):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                imported_metadata(changed, 1)

    def test_all_analytic_branches_require_their_own_strict_premises(self):
        from iso_capacity_bound import capacity_constraints
        values = dict(base_A_green_lower=2.473786078491971, black_green_upper=.006532658860476874,
                      A_direction=.006864494258045901, B_direction=1.343738320434944,
                      D_lower=-1.0421091089418386, D_upper=-2.2343976069827853)
        actual = capacity_constraints(**values)
        self.assertTrue(actual['authored_base_bypass_model_excluded'])
        self.assertTrue(actual['offset_at_zero_model_excluded'])
        for field, replacement in (('A_direction', 0), ('B_direction', 0), ('D_lower', -3)):
            with self.subTest(field=field):
                result = capacity_constraints(**{**values, field: replacement})
                self.assertFalse(result['authored_base_bypass_model_excluded'])
                self.assertFalse(result['offset_at_zero_model_excluded'])
        zero_branch_open = capacity_constraints(**{**values, 'base_A_green_lower': 0})
        self.assertFalse(zero_branch_open['authored_base_bypass_model_excluded'])
        self.assertTrue(zero_branch_open['offset_at_zero_model_excluded'])
        for value in (float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                capacity_constraints(**{**values, 'D_lower': value})

    def test_capacity_boundaries_cover_zero_plateau_and_ordered_positive_weights(self):
        from iso_capacity_bound import capacity_branch
        for endpoints, branch, weights in (
                ((1, 3), 'zero_weight_authored_base', [0, 1, 1]),
                ((0, 4), 'equal_16_64', [.25, 1, 1]),
                ((0, 8), 'positive_ordered', [.125, .5, .75]),
                ((7, 8), 'zero_weight_authored_base', [0, 0, 0])):
            with self.subTest(endpoints=endpoints):
                result = capacity_branch(*endpoints)
                self.assertEqual(result['branch'], branch)
                self.assertEqual(result['weights'], weights)
        for a, b in ((-1, 2), (1, 1), (2, 1), (0, float('inf')), (float('nan'), 2)):
            with self.subTest(a=a, b=b), self.assertRaises(ValueError):
                capacity_branch(a, b)


class CapacityNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from iso_capacity_bound import run
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.directory = Path(cls.temporary.name)
        cls.report = run(cls.directory/'standalone')
        cls.map_report = json.loads((cls.directory/
            'standalone/continuous-bound/global-bound/map-code-bound/results.json').read_text())

    def test_real_native_zero_and_positive_controls_persist_scoped_diagnostic_only(self):
        result = self.report
        self.assertEqual(result['status'], 'diagnostic_only')
        self.assertNotIn('cases', result)
        self.assertTrue(all(result['validation_checks'].values()))
        self.assertTrue(result['constraints']['authored_base_bypass_model_excluded'])
        self.assertTrue(result['constraints']['offset_at_zero_model_excluded'])
        self.assertAlmostEqual(result['constraints']['zero_weight_bypass_separation_nits'], 2.467253419631494)
        self.assertAlmostEqual(result['constraints']['shared_offset_separation_nits'], 1.1922884980409467)
        controls = result['native_controls']['records']
        self.assertEqual([row['output']['sha256'] for row in controls], [
            'b94534671dfe02fd822d8bbe332384cc1e13c6d0414dfb17ad8f18f41a038974',
            '6520ff9d78f3ba33066c5842f9bdbe006f6235df3a19ad70336d3ab125801ee6'])
        for row in controls:
            self.assertTrue(row['native_imported_metadata'])
            self.assertEqual(row['imported_metadata']['base_headroom'], [row['base_headroom_log2'], 1])
            self.assertEqual(row['imported_metadata']['alternate_headroom'], [3, 1])
            self.assertEqual(row['imported_metadata']['base_offset'], [[1, 4]]*3)
            self.assertEqual(row['imported_metadata']['alternate_offset'], [[1, 8]]*3)
            self.assertEqual(row['imported_samples']['base_code'], 255)
            self.assertEqual(row['imported_samples']['map_code'], 64)
            self.assertEqual(row['jpeg_metadata_checks']['forward_sdr_base'], row['base_headroom_log2'] == 0)
            self.assertLess(row['positive_weight_control']['maximum_quantization_error_nits'], .5)
            self.assertGreater(row['positive_weight_control']['native_minimum_nits'], 300)
            for rendering in row['renderings']:
                self.assertEqual(rendering['ultrahdr_precise']['minimum_nits'], 228.375)
                self.assertLess(rendering['libavif']['zero_weight_white_max_quantization_error_nits'], .5)
                if row['base_headroom_log2'] == 0:
                    self.assertEqual(rendering['icc_native_and_independent']['native_minimum_nits'], 203)
                    self.assertEqual(rendering['icc_native_and_independent']['independent_minimum_nits'], 203)
                else:
                    self.assertIn('Only SDR base', rendering['icc_native_rejection'])
                    self.assertIn('Only forward SDR-base', rendering['icc_independent_rejection'])
        self.assertEqual(result['numeric_capacity_controls']['counts'],
            {'zero_weight_authored_base': 55, 'equal_16_64': 18, 'positive_ordered': 18})
        for name, sha in result['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).with_name(name)), sha)
        self.assertEqual(json.loads((self.directory/'standalone/results.json').read_text()), result)

    def test_map_report_reuse_keeps_fresh_continuous_bounds_and_identical_controls(self):
        from iso_capacity_bound import run
        result = run(self.directory/'reused', map_code_report=self.map_report)
        for name in ('constraints', 'numeric_capacity_controls', 'analytic_capacity_domain'):
            self.assertEqual(result[name], self.report[name])
        self.assertEqual([row['output']['sha256'] for row in result['native_controls']['records']],
                         [row['output']['sha256'] for row in self.report['native_controls']['records']])
        self.assertLess(len(result['commands']), len(self.report['commands']))

    def test_changed_upstream_bindings_and_directions_cannot_supply_capacity_evidence(self):
        from iso_capacity_bound import run
        mutations = [lambda value: value['bindings']['source'].update(sha256='0'*64),
            lambda value: value['records'][0]['references_nits'][1].__setitem__(1, .2),
            lambda value: value['iso_metadata'].update(alternate_headroom=4),
            lambda value: value.update(native_binary_sha256={}),
            lambda value: value.update(fixed_maximum_gate=9)]
        for index, mutate in enumerate(mutations):
            modified = copy.deepcopy(self.map_report)
            mutate(modified)
            directory = self.directory/f'rejected-{index}'
            with self.subTest(index=index), self.assertRaises(ValueError):
                run(directory, map_code_report=modified)
            self.assertFalse((directory/'results.json').exists())

    def test_native_controls_reject_unknown_carrier_and_imported_bridge_drift(self):
        import iso_capacity_bound as bound
        unknown = self.directory/'unknown-carrier.jpg'
        unknown.write_bytes(bound.SOURCE.read_bytes()+b'changed provenance')
        before = len(avif.COMMANDS)
        with patch.object(bound, 'SOURCE', unknown), self.assertRaises(ValueError):
            bound.native_zero_weight_controls(self.directory/'unknown-carrier')
        self.assertEqual(before, len(avif.COMMANDS))
        native = avif.native
        def real_positive_reader_then_mutate_bridge(argv, **kwargs):
            result = native(argv, **kwargs)
            if len(argv) > 2 and argv[1] == 'tonemap' and argv[argv.index('--headroom')+1] == '3':
                with Path(argv[2]).open('ab') as stream:
                    stream.write(b'changed bridge after real positive-weight read')
            return result
        directory = self.directory/'drifted-native-bridge'
        with patch.object(avif, 'native', side_effect=real_positive_reader_then_mutate_bridge):
            with self.assertRaisesRegex(ValueError, 'Changed diagnostic input'):
                bound.native_zero_weight_controls(directory)
        self.assertFalse((directory/'native-controls.json').exists())


if __name__ == '__main__':
    unittest.main()
