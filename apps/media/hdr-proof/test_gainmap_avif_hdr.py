"""Native HDR reconstruction keeps the original gain-map sampling failures visible."""
from pathlib import Path
import tempfile
import unittest

import avif
import gainmap_avif
import gainmap_avif_hdr
from appearance import compare_appearance
from gainmap_hdr import read_linear


class GainMapAvifHdrTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_hdr.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_baseline_source_and_derivative_failures_remain_measured(self):
        baseline, candidate = self.result['evidence']
        self.assertEqual(baseline['candidate'], 'libavif-native-map-sampling-pq12')
        self.assertEqual(baseline['status'], 'tested and failed')
        self.assertFalse(baseline['checks']['source_appearance'])
        self.assertFalse(baseline['checks']['linear_geometry_appearance'])
        self.assertAlmostEqual(baseline['measurements']['source']['regions']['highlight']['delta_e_itp']['maximum'],
                               8.187944143126831, places=6)
        self.assertAlmostEqual(baseline['measurements']['linear_geometry']['regions']['shadow']['delta_e_itp']['maximum'],
                               29.16577260748179, places=6)
        self.assertEqual(baseline['selectors'], candidate['selectors'])
        self.assertEqual(baseline['threshold_scope'], candidate['threshold_scope'])
        for case in self.result['evidence']:
            self.assertEqual(set(case['measurements']), {'source', 'linear_geometry', 'hdr'})
            self.assertTrue(case['commands'])
            self.assertTrue(case['native_log_artifacts'])
            self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
            self.assertEqual(case['consumer_status'], 'pending manual review')

    def test_native_resampling_and_float_gain_application_pass_existing_gates(self):
        case = self.result['evidence'][1]
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['selectors']['depth'], '12')
        self.assertEqual(case['selectors']['gamut'], 'preserve')
        self.assertEqual(case['source_facts']['metadata']['gain_map_max'], [[7, 2], [18, 5], [37, 10]])
        self.assertEqual(case['source_facts']['base']['depths'], [8, 8, 8])
        self.assertEqual(case['source_facts']['map']['depths'], [8])
        self.assertEqual((case['facts']['width'], case['facts']['height']), (173, 130))
        self.assertEqual(case['facts']['depth'], 12)
        self.assertEqual((case['facts']['primaries'], case['facts']['transfer'], case['facts']['matrix']), (1, 16, 0))
        self.assertTrue(case['structural_checks']['gain_map_absent'])
        self.assertTrue(case['structural_checks']['opaque_source_retained'])
        self.assertTrue(case['structural_checks']['square_pixels'])
        self.assertEqual(case['pixel_aspect']['pasp_properties'], [])
        self.assertEqual(case['output_packet_facts']['streams'][0]['sample_aspect_ratio'], '1:1')
        self.assertEqual(case['native_source']['map_sampling']['maximum_code_difference'], 1)
        self.assertEqual(case['native_source']['map_sampling']['changed_pixels'], 110)
        self.assertTrue(case['native_source']['map_sampling']['passed'])
        self.assertLess(case['measurements']['source']['regions']['midtone']['delta_e_itp']['maximum'], .74)
        self.assertLess(case['measurements']['hdr']['regions']['midtone']['delta_e_itp']['maximum'], .33)
        self.assertEqual(case['privacy_measurement']['private_tags'], [])
        self.assertTrue(all(control['passed'] for control in self.result['controls']))

    def test_source_and_reference_locks_are_separate_from_output_precision(self):
        fixture = self.result['source_fixtures'][0]
        self.assertEqual(fixture['sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
        for case in self.result['evidence']:
            policy = case['threshold_scope']
            self.assertEqual(policy['profile'], 'gainmap-hdr')
            self.assertEqual(policy['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
            self.assertEqual(policy['reference_revision'], 'gainmap-avif-hdr-bilinear8-lanczosfloat-v1')
            self.assertIn('implementation-defined', policy['sampling_rationale'])
            self.assertIn('not a uniquely mandated ISO kernel', policy['sampling_rationale'])
            self.assertEqual(case['artifacts']['source_sha256'], fixture['sha256'])

    def test_native_pq_encoding_respects_each_input_normalization(self):
        self.assertEqual([case['native_geometry']['normalization_nits'] for case in self.result['evidence']], [10000, 203])
        for case in self.result['evidence']:
            with self.subTest(candidate=case['candidate']):
                decoded = avif.read_png(Path(case['artifacts']['output']).parent/'decoded-0.png')
                storage = compare_appearance(read_linear(case['native_geometry']),
                    avif.decode_transfer(decoded[..., :3], 'pq', 'srgb'),
                    reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')
                self.assertTrue(storage['passed'], storage['failures'])

    def test_actual_unproved_pixel_aspect_property_cannot_pass(self):
        output = Path(self.result['evidence'][1]['artifacts']['output'])
        data = output.read_bytes()
        self.assertEqual(data.count(b'pixi'), 1)
        changed = self.root/'unproved-pasp.avif'
        changed.write_bytes(data.replace(b'pixi', b'pasp'))
        start = len(avif.COMMANDS)
        aspect = gainmap_avif_hdr._pixel_aspect(changed)
        self.assertFalse(aspect['passed'])
        self.assertEqual(aspect['pasp_properties'], ['00000000030c0c0c'])
        self.assertEqual(len(avif.COMMANDS), start)

    def test_unknown_actual_source_facts_and_changed_bytes_withhold_hdr(self):
        original = Path(self.result['source_fixtures'][0]['path']).read_bytes()
        before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
        self.assertEqual(original.count(before), 1)
        for name, data in (
                ('unknown-color', original.replace(before, b'nclx\x00\x02\x00\x0d\x00\x00\x80')),
                ('changed-byte', original + b'extra')):
            with self.subTest(source=name):
                source = self.root/f'{name}.avif'
                source.write_bytes(data)
                start = len(avif.COMMANDS)
                decision = gainmap_avif_hdr.source_decision(source, self.root/name)
                self.assertEqual(decision['action'], 'original only')
                self.assertFalse(decision['source_valid'])
                self.assertEqual(len(avif.COMMANDS), start)
                copy = self.root/f'{name}-original.avif'
                self.assertTrue(gainmap_avif.copy_original(source, copy)['exact_bytes'])

    def test_unproved_selector_tuples_stop_before_native_conversion(self):
        for change in ({'depth': 'preserve'}, {'depth': '8'}, {'range': 'sdr'}, {'gamut': 'p3'},
                       {'motion': 'animate'}, {'transparency': 'coerce'}, {'w': 174}, {'h': 130}):
            with self.subTest(change=change):
                start = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'explicit PQ AVIF12 containment'):
                    gainmap_avif_hdr.run(self.root/'unsupported', selectors={**gainmap_avif_hdr.SELECTORS, **change})
                self.assertEqual(len(avif.COMMANDS), start)


if __name__ == '__main__':
    unittest.main()
