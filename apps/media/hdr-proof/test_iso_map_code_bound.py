"""The fixed-map bound is evidence, never an encoder or qualification shortcut."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import avif


class MapCodeMathTests(unittest.TestCase):
    def test_nonfinite_or_negative_references_reject_before_search(self):
        from iso_map_code_bound import minimum_map_error
        for invalid in (float('nan'), float('inf'), -.001):
            expected = np.ones((3, 3))
            expected[0, 0] = invalid
            with self.subTest(value=invalid), self.assertRaisesRegex(ValueError, 'finite nonnegative'):
                minimum_map_error([1]*3, expected, {})

    def test_forward_model_uses_actual_capacity_and_clamps_negative_output(self):
        from iso_map_code_bound import check_forward_model, render_codes
        metadata = {'base_headroom': 0, 'alternate_headroom': 2,
            'backward': False, 'use_base_colour_space': True,
            'channels': [{'minimum': 0, 'maximum': 2, 'gamma': 1,
                          'base_offset': .01, 'alternate_offset': .02}]*3}
        base = np.array([0, .1, .2])*203
        actual = render_codes(base, [255]*3, metadata)
        np.testing.assert_allclose(actual, [[0, .2*203, .4*203],
                                           [.02*203, .42*203, .82*203],
                                           [.02*203, .42*203, .82*203]], atol=1e-12)
        self.assertEqual(check_forward_model(base, [255]*3, metadata, actual), 0)
        with self.assertRaisesRegex(ValueError, 'independent decoder'):
            check_forward_model(base, [255]*3, metadata, actual+.001)
        for codes in ([0, 1.5, 2], [-1, 0, 0], [0, 256, 0], [0, 1]):
            with self.subTest(codes=codes), self.assertRaises(ValueError):
                render_codes(base, codes, metadata)
        for name, value in (('base_headroom', 1), ('alternate_headroom', 0),
                            ('backward', True), ('use_base_colour_space', False)):
            changed = {**metadata, name: value}
            with self.subTest(field=name), self.assertRaises(ValueError):
                render_codes(base, [0]*3, changed)

    def test_exhaustive_search_finds_one_shared_exact_code_without_qualifying_it(self):
        from iso_map_code_bound import minimum_map_error, render_codes
        metadata = {'base_headroom': 0, 'alternate_headroom': 6,
            'backward': False, 'use_base_colour_space': True,
            'channels': [{'minimum': -2, 'maximum': 2, 'gamma': 1.5,
                          'base_offset': 1/16384, 'alternate_offset': 1/16384}]*3}
        base = np.array([1, 2, 3.])
        expected = render_codes(base, [17, 111, 240], metadata)
        result = minimum_map_error(base, expected, metadata)
        self.assertEqual(result['enumerated_codes'], 256**3)
        self.assertEqual(result['joint_minimum_codes'], [17, 111, 240])
        self.assertLess(result['minimum_joint_max_delta_e'], 1e-10)
        self.assertGreater(result['joint_code_count_under_maximum'], 0)
        self.assertFalse(result['fixed_representation_cannot_meet_joint_maximum'])
        self.assertNotIn('qualified', result.values())


class MapCodeNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from iso_map_code_bound import run
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.folder = Path(cls.temporary.name)
        cls.report = run(cls.folder/'standalone')
        cls.capacity = json.loads((cls.folder/'standalone/capacity/results.json').read_text())

    def test_real_native_replay_binds_inputs_and_retains_both_counterexamples(self):
        report = self.report
        self.assertEqual(report['status'], 'diagnostic_only')
        self.assertNotIn('cases', report)
        self.assertEqual(report['fixed_maximum_gate'], 8)
        self.assertEqual(report['bindings']['output']['sha256'],
                         '64e1627f20632239fa5755908bb72a4e359776c0891df92fd8b99c6b99df1091')
        self.assertTrue(all(report['validation_checks'].values()))
        records = {tuple(row['xy']): row for row in report['records']}
        for xy, minimum, codes in (((236, 822), 109.4912812576038, [0, 0, 0]),
                                   ((242, 640), 54.10178946039394, [35, 32, 0])):
            row = records[xy]
            self.assertEqual(row['enumerated_codes'], 256**3)
            self.assertEqual(row['joint_minimum_codes'], codes)
            self.assertAlmostEqual(row['minimum_joint_max_delta_e'], minimum, places=9)
            self.assertEqual(row['joint_code_count_under_maximum'], 0)
            self.assertEqual(row['actual_model_error_nits_max'], 0)
            self.assertTrue(row['fixed_representation_cannot_meet_joint_maximum'])
        self.assertTrue(report['commands'])
        self.assertTrue(report['capacity_provenance']['commands'])
        for name, sha in report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).with_name(name)), sha)
        self.assertEqual(json.loads((self.folder/'standalone/results.json').read_text()), report)

    def test_validated_reuse_preserves_bound_without_running_an_encoder(self):
        from iso_map_code_bound import run
        before = len(avif.COMMANDS)
        replay = run(self.folder/'reuse', capacity_report=self.capacity)
        self.assertEqual(replay['records'], self.report['records'])
        commands = avif.COMMANDS[before:]
        self.assertTrue(commands)
        self.assertFalse(any(any(str(arg).startswith('pack') or arg == 'compute'
                                 for arg in command['argv'][1:]) for command in commands))

    def test_report_tampering_is_rejected_before_enumeration_or_persisting_results(self):
        from iso_map_code_bound import run
        changes = {
            'source': lambda r: r['cases'][0].update(source_sha256='0'*64),
            'output': lambda r: r['cases'][0]['artifacts'].update(sha256='0'*64),
            'reference': lambda r: r['cases'][0]['reference_hdr'].update(sha256='0'*64),
            'metadata': lambda r: r['cases'][0]['facts']['iso_metadata'].update(alternate_headroom=4),
            'base': lambda r: r['cases'][0]['native_candidate'].update(base_sha256='0'*64),
            'map': lambda r: r['native_candidate']['input_sha256'].update(map='0'*64),
            'map-input': lambda r: r['cases'][0]['native_candidate'].update(computed_map_sha256='0'*64),
            'authored-sdr': lambda r: r['cases'][0]['reference_sdr'].update(sha256='0'*64),
            'scope': lambda r: r['cases'][0]['rendering_scope'].update(display_boost=4),
            'threshold': lambda r: r.update(threshold_sha256='0'*64),
            'source-code': lambda r: r['source_hashes'].update({'icc_gainmap.py': '0'*64}),
            'native-provenance': lambda r: r.update(capacity_native_provenance='changed'),
            'missing-dependencies': lambda r: r.update(source_hashes={}),
        }
        for label, mutate in changes.items():
            report = copy.deepcopy(self.capacity)
            mutate(report)
            folder = self.folder/f'rejected-{label}'
            with self.subTest(label=label), self.assertRaises((ValueError, FileNotFoundError)):
                run(folder, capacity_report=report)
            self.assertFalse((folder/'results.json').exists())

    def test_changed_reference_bytes_cannot_be_admitted_with_a_new_report_hash(self):
        from iso_map_code_bound import run
        report = copy.deepcopy(self.capacity)
        actual = Path(report['cases'][0]['reference_hdr']['path'])
        changed = self.folder/'changed-reference.rgbf64'
        pixels = bytearray(actual.read_bytes())
        pixels[0] ^= 1
        changed.write_bytes(pixels)
        report['cases'][0]['reference_hdr'].update(path=str(changed), sha256=avif.digest(changed))
        with self.assertRaises(ValueError):
            run(self.folder/'changed-reference', capacity_report=report)

    def test_file_drift_after_real_decoder_readback_is_rejected(self):
        from iso_map_code_bound import run
        import icc_gainmap
        real_decode = icc_gainmap.independent_decode

        def decode_then_alter_map(path, map_path, *, boost):
            actual = real_decode(path, map_path, boost=boost)
            if boost == 64:
                with Path(map_path).open('ab') as output:
                    output.write(b'\x00')
            return actual

        folder = self.folder/'decoder-boundary-drift'
        # Actual native/independent readers still execute. Only the file drift
        # at their return boundary is injected; no encoder or pixels are mocked.
        with patch('icc_gainmap.independent_decode', side_effect=decode_then_alter_map):
            with self.assertRaisesRegex(ValueError, 'Changed diagnostic input'):
                run(folder, capacity_report=self.capacity)
        self.assertFalse((folder/'results.json').exists())


if __name__ == '__main__':
    unittest.main()
