"""The decoded-base bound cannot supply a conversion qualification."""
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


class BaseConstraintTests(unittest.TestCase):
    def test_optimistic_green_extrema_require_both_strict_hdr_directions(self):
        from iso_base_code_bound import offset_constraints
        greens = [[2.5579497777942644, 3.7085340485118805],
                  [2.43413807356602, 3.548404531192528]]
        refs = [[[0, 0, 0], [0, 0, 0], [0, .16628398001194, 0]],
                [[3.672389030456543, 3.1140284538269043, .5423629879951477],
                 [1.9613218307495117, 1.2131978273391724, 0], [0, 0, 0]]]
        weights = [.17786073385939657, .7114429354375863, 1]
        actual = offset_constraints(greens, refs, weights)
        self.assertTrue(actual['contradiction_established'])
        self.assertAlmostEqual(actual['contradiction_margin_nits'], .02735289920805517, places=10)
        for which in ('increasing', 'decreasing'):
            changed = copy.deepcopy(refs)
            if which == 'increasing':
                changed[0][1] = changed[0][2]
            else:
                changed[1][2] = changed[1][0]
            with self.subTest(which=which):
                # The D endpoints remain disjoint; the missing strict gain
                # direction must still prevent the contradiction claim.
                result = offset_constraints(greens, changed, weights)
                self.assertGreater(result['contradiction_margin_nits'], 0)
                self.assertFalse(result['contradiction_established'])
        for values in ([[2, 1], [1, 2]], [[float('nan'), 2], [1, 2]], [[-1, 2], [1, 2]]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                offset_constraints(values, refs, weights)
        for invalid in ([0, .7, 1], [.2, .2, 1], [.7, .2, 1], [.2, .7, float('inf')]):
            with self.subTest(weights=invalid), self.assertRaises(ValueError):
                offset_constraints(greens, refs, invalid)


class BaseCodeNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from iso_base_code_bound import run
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.folder = Path(cls.temporary.name)
        cls.report = run(cls.folder/'standalone')
        cls.map_report = json.loads((cls.folder/'standalone/global-bound/map-code-bound/results.json').read_text())
        with Image.open(cls.report['bindings']['output']['path']) as image:
            cls.profile = image.info['icc_profile']

    def test_real_native_inputs_and_complete_code_enumeration_persist_a_narrow_bound(self):
        report = self.report
        self.assertEqual(report['status'], 'diagnostic_only')
        self.assertNotIn('cases', report)
        self.assertEqual(report['enumeration']['enumerated_codes'], 256**3)
        self.assertEqual(report['sdr_maximum_gate'], 8)
        self.assertEqual(report['hdr_maximum_gate'], 8)
        self.assertTrue(all(report['validation_checks'].values()))
        rows = report['enumeration']['records']
        self.assertEqual([row['admissible_base_codes'] for row in rows], [668, 603])
        self.assertEqual([row['minimum_green_code'] for row in rows], [65, 64])
        self.assertEqual([row['maximum_green_code'] for row in rows], [73, 72])
        self.assertGreater(min(row['nearest_delta_e_to_gate_absolute_difference'] for row in rows), .0019)
        self.assertAlmostEqual(report['analytic_bound']['contradiction_margin_nits'], .02735289920805517, places=10)
        self.assertTrue(report['analytic_bound']['contradiction_established'])
        self.assertEqual(report['normalization'], {'sdr_nominal_white_nits': 100, 'hdr_reference_white_nits': 203})
        self.assertTrue(report['commands'])
        for name, sha in report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).with_name(name)), sha)
        self.assertEqual(json.loads((self.folder/'standalone/results.json').read_text()), report)

    def test_reuse_recomputes_the_same_bound_with_actual_readers_and_no_encoder(self):
        from iso_base_code_bound import run
        result = run(self.folder/'reused', map_code_report=self.map_report)
        for name in ('inputs', 'enumeration', 'analytic_bound', 'icc', 'iso_metadata'):
            self.assertEqual(result[name], self.report[name])
        self.assertTrue(result['commands'])
        self.assertFalse(any(any(str(arg).startswith('pack') or arg == 'compute' for arg in row['argv'][1:])
                             for row in result['commands']))

    def test_changed_hdr_facts_source_icc_references_and_missing_provenance_reject(self):
        from iso_base_code_bound import run
        mutations = [lambda value: value['bindings']['source'].update(sha256='0'*64),
            lambda value: value['bindings']['references']['16'].update(sha256='0'*64),
            lambda value: value['icc'].update(gammas=[2.2]*3),
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

    def test_changed_authored_sdr_bytes_reject_even_with_a_new_declared_hash(self):
        from iso_base_code_bound import run
        changed = self.folder/'changed-authored-sdr.png'
        with Image.open(self.report['bindings']['authored_sdr']['path']) as image:
            pixels = np.asarray(image).copy()
        pixels[822, 236, 1] += 1
        Image.fromarray(pixels).save(changed)
        modified = copy.deepcopy(self.map_report)
        modified['bindings']['authored_sdr'].update(path=str(changed), sha256=avif.digest(changed))
        with self.assertRaises(ValueError):
            run(self.folder/'changed-sdr-rejected', map_code_report=modified)

    def test_unknown_profile_invalid_references_and_near_cutoff_controls_cannot_supply_a_bound(self):
        from iso_base_code_bound import enumerate_base_codes
        from iso_global_offset_bound import itp_to_p3
        from appearance import linear_rgb_to_itp
        from gamma_icc import make_profile
        for invalid in ([[0, 0, 0]], [[float('nan'), 0, 0]]*2, [[0, float('inf'), 0]]*2, [[-1, 0, 0]]*2):
            with self.subTest(reference=invalid), self.assertRaises(ValueError):
                enumerate_base_codes(self.profile, invalid)
        with self.assertRaisesRegex(ValueError, 'Expected gamma'):
            enumerate_base_codes(make_profile(gamma=2.2, gamut='p3'), [[0, 0, 0]]*2)
        # Actual code black lies at the unchanged8DeltaE cutoff for this
        # synthetic reference. Refuse evidence rather than add metric slack.
        near = itp_to_p3(linear_rgb_to_itp([0, 0, 0], 'p3')+np.array([8/720, 0, 0]))
        with self.assertRaisesRegex(ValueError, 'too near the unchanged metric cutoff'):
            enumerate_base_codes(self.profile, [near, near])

    def test_input_file_drift_after_complete_real_enumeration_prevents_publication(self):
        import iso_base_code_bound as bound
        modified = copy.deepcopy(self.map_report)
        copied = self.folder/'copied-authored-sdr.png'
        shutil.copyfile(modified['bindings']['authored_sdr']['path'], copied)
        modified['bindings']['authored_sdr']['path'] = str(copied)
        original = bound.enumerate_base_codes
        def complete_enumeration_then_change_bound_file(*args, **kwargs):
            result = original(*args, **kwargs)
            with copied.open('ab') as stream:
                stream.write(b'diagnostic-tamper')
            return result
        folder = self.folder/'completion-drift'
        # All native readers and every code evaluation run. Only an input
        # file mutation after their return is injected; no encoder is mocked.
        with patch.object(bound, 'enumerate_base_codes', side_effect=complete_enumeration_then_change_bound_file):
            with self.assertRaisesRegex(ValueError, 'Changed diagnostic input'):
                bound.run(folder, map_code_report=modified)
        self.assertFalse((folder/'results.json').exists())


if __name__ == '__main__':
    unittest.main()
