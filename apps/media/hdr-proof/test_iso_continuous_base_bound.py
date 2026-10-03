"""Continuous bounds retain conservative coverage when the search stops."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import avif
from appearance import RGB_TO_XYZ, delta_e_itp


class ContinuousComponentTests(unittest.TestCase):
    def test_invalid_domains_and_search_limits_reject_before_searching(self):
        from iso_continuous_base_bound import component_extremum
        for reference in ([float('nan'), 0, 0], [0, float('inf'), 0], [-1, 0, 0], [0, 0]):
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                component_extremum(reference, RGB_TO_XYZ['p3'], 'minimum')
        for matrix in (np.zeros((3, 3)), np.eye(2), np.full((3, 3), float('nan'))):
            with self.subTest(matrix=matrix), self.assertRaises(ValueError):
                component_extremum([1, 1, 1], matrix, 'minimum')
        for settings in ({'node_budget': 0}, {'node_budget': True}, {'node_budget': 1000001},
                         {'target_gap': 0}, {'target_gap': float('nan')}, {'fixture_class': 'invented'}):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                component_extremum([1, 1, 1], RGB_TO_XYZ['p3'], 'minimum', **settings)

    def test_budget_stop_keeps_an_outer_bound_and_forward_feasible_witness(self):
        from iso_continuous_base_bound import component_extremum
        reference = np.array([1., 1., 1.])
        rng = np.random.default_rng(826)
        samples = np.maximum(reference+rng.normal(scale=.15, size=(5000, 3)), 0)
        admitted = samples[delta_e_itp(np.broadcast_to(reference, samples.shape), samples, 'p3', 'p3') <= 8]
        self.assertGreater(len(admitted), 100)
        for direction in ('minimum', 'maximum'):
            coarse = component_extremum(reference, RGB_TO_XYZ['p3'], direction, node_budget=2)
            refined = component_extremum(reference, RGB_TO_XYZ['p3'], direction, node_budget=128)
            with self.subTest(direction=direction):
                self.assertLessEqual(coarse['visited_child_boxes'], 2)
                self.assertTrue(coarse['budget_exhausted'])
                self.assertGreater(coarse['remaining_boxes'], 0)
                self.assertFalse(coarse['reached_gap_target'])
                self.assertGreater(coarse['bound_witness_gap_nits'], 0)
                self.assertLessEqual(refined['witness_delta_e'], 8)
                if direction == 'minimum':
                    self.assertLessEqual(coarse['outer_green_nits'], refined['outer_green_nits'])
                    self.assertLessEqual(refined['outer_green_nits'], admitted[:, 1].min())
                    self.assertLessEqual(refined['outer_green_nits'], refined['feasible_green_nits'])
                else:
                    self.assertGreaterEqual(coarse['outer_green_nits'], refined['outer_green_nits'])
                    self.assertGreaterEqual(refined['outer_green_nits'], admitted[:, 1].max())
                    self.assertGreaterEqual(refined['outer_green_nits'], refined['feasible_green_nits'])

    def test_matrix_aware_witnesses_and_known_white_use_the_forward_metric(self):
        from appearance import linear_rgb_to_itp
        from iso_continuous_base_bound import component_extremum
        # A distinct declared primary matrix changes the component domain;
        # the reference remains P3 and the actual forward metric is unchanged.
        reference = np.array([203., 203., 203.])
        for matrix in (RGB_TO_XYZ['p3'], RGB_TO_XYZ['rec2020']):
            own_reference = reference@RGB_TO_XYZ['p3'].T@np.linalg.inv(matrix).T
            for direction in ('minimum', 'maximum'):
                result = component_extremum(reference, matrix, direction, node_budget=128)
                pixel = np.asarray(result['witness_own_rgb_nits'])
                compared = pixel@matrix.T@np.linalg.inv(RGB_TO_XYZ['rec2020']).T
                actual = float(720*np.linalg.norm(linear_rgb_to_itp(compared, 'rec2020')
                                                 -linear_rgb_to_itp(reference, 'p3')))
                with self.subTest(matrix=matrix, direction=direction):
                    self.assertAlmostEqual(actual, result['witness_delta_e'], places=10)
                    self.assertLessEqual(actual, 8)
                    if direction == 'minimum':
                        self.assertLessEqual(result['outer_green_nits'], own_reference[1])
                    else:
                        self.assertGreaterEqual(result['outer_green_nits'], own_reference[1])


class ContinuousNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from iso_continuous_base_bound import run
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.folder = Path(cls.temporary.name)
        cls.report = run(cls.folder/'standalone')
        cls.map_report = json.loads((cls.folder/'standalone/global-bound/map-code-bound/results.json').read_text())

    def test_real_native_bound_reports_unresolved_boxes_without_qualifying_a_conversion(self):
        report = self.report
        self.assertEqual(report['status'], 'diagnostic_only')
        self.assertNotIn('cases', report)
        self.assertTrue(all(report['validation_checks'].values()))
        self.assertEqual(report['sdr_maximum_gate'], 8)
        self.assertEqual(report['hdr_maximum_gate'], 8)
        self.assertTrue(report['analytic_bound']['contradiction_established'])
        self.assertAlmostEqual(report['analytic_bound']['contradiction_margin_nits'], 1.1922884980409467, places=8)
        self.assertEqual(sum(row['budget_exhausted'] for row in report['extrema'].values()), 3)
        for row in report['extrema'].values():
            self.assertGreater(row['remaining_boxes'], 0)
            self.assertLessEqual(row['visited_child_boxes'], 100000)
            self.assertLess(row['bound_witness_gap_nits'], .001)
            self.assertLessEqual(row['witness_delta_e'], 8)
            self.assertEqual(row['rgb_domain'], 'All nonnegative continuous own-primary components; no upper cap')
        self.assertNotEqual(report['metric_matrices']['serialized_sdr_rgb_to_xyz'],
                            report['metric_matrices']['nominal_hdr_rgb_to_xyz'])
        self.assertTrue(report['commands'])
        for name, sha in report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).with_name(name)), sha)
        self.assertEqual(json.loads((self.folder/'standalone/results.json').read_text()), report)

    def test_reuse_recomputes_real_inputs_and_identical_bounds_without_encoding(self):
        from iso_continuous_base_bound import run
        result = run(self.folder/'reused', map_code_report=self.map_report)
        for name in ('inputs', 'extrema', 'analytic_bound', 'icc', 'iso_metadata', 'metric_matrices'):
            self.assertEqual(result[name], self.report[name])
        self.assertTrue(result['commands'])
        self.assertFalse(any(any(str(arg).startswith('pack') or arg == 'compute' for arg in row['argv'][1:])
                             for row in result['commands']))

    def test_changed_facts_references_and_missing_provenance_cannot_supply_a_bound(self):
        from iso_continuous_base_bound import run
        mutations = [lambda value: value['bindings']['source'].update(sha256='0'*64),
            lambda value: value['bindings']['references']['64'].update(sha256='0'*64),
            lambda value: value['icc'].update(rgb_to_xyz_d65=np.eye(3).tolist()),
            lambda value: value['iso_metadata'].update(alternate_headroom=4),
            lambda value: value['records'][0]['references_nits'][1].__setitem__(1, .2),
            lambda value: value.update(native_binary_sha256={}),
            lambda value: value.update(fixed_maximum_gate=9),
            lambda value: value['source_hashes'].pop('gainmap_iso.py')]
        for index, mutate in enumerate(mutations):
            modified = copy.deepcopy(self.map_report)
            mutate(modified)
            directory = self.folder/f'rejected-{index}'
            with self.subTest(index=index), self.assertRaises(ValueError):
                run(directory, map_code_report=modified)
            self.assertFalse((directory/'results.json').exists())
        with self.assertRaises(ValueError):
            run(self.folder/'missing-report', map_code_report={})

    def test_actual_authored_sdr_substitution_rejects_even_with_updated_hash(self):
        from iso_continuous_base_bound import run
        changed = self.folder/'changed-authored-sdr.png'
        with Image.open(self.report['bindings']['authored_sdr']['path']) as image:
            pixels = np.asarray(image).copy()
        pixels[822, 236, 1] += 1
        Image.fromarray(pixels).save(changed)
        modified = copy.deepcopy(self.map_report)
        modified['bindings']['authored_sdr'].update(path=str(changed), sha256=avif.digest(changed))
        directory = self.folder/'changed-sdr-rejected'
        with self.assertRaises(ValueError):
            run(directory, map_code_report=modified)
        self.assertFalse((directory/'results.json').exists())

    def test_file_drift_after_real_search_cannot_publish_a_bound(self):
        import iso_continuous_base_bound as bound
        modified = copy.deepcopy(self.map_report)
        copied = self.folder/'copied-authored-sdr.png'
        shutil.copyfile(modified['bindings']['authored_sdr']['path'], copied)
        modified['bindings']['authored_sdr']['path'] = str(copied)
        original = bound.component_extremum
        def actual_search_then_change_input(*args, **kwargs):
            result = original(*args, **kwargs)
            with copied.open('ab') as stream:
                stream.write(b'diagnostic-tamper')
            return result
        directory = self.folder/'completion-drift'
        # Every native read and real bound search runs. Only a file mutation
        # after the search is injected; no encoder or bound result is mocked.
        with patch.object(bound, 'component_extremum', side_effect=actual_search_then_change_input):
            with self.assertRaisesRegex(ValueError, 'Changed diagnostic input'):
                bound.run(directory, map_code_report=modified)
        self.assertFalse((directory/'results.json').exists())


if __name__ == '__main__':
    unittest.main()
