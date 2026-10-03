"""Native original-map geometry is measured, never inferred from metadata."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import avif
from matrix import build_matrix


class GainMapAvifSeparateMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import gainmap_avif_separate_map
        cls.module = gainmap_avif_separate_map
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_file_fails_all_three_renderings_with_correct_source_weights(self):
        cases = self.result['evidence']
        self.assertEqual(len(cases), 3)
        self.assertEqual([case['rendering_scope']['label'] for case in cases], ['boost2', 'source-full', 'boost16'])
        self.assertEqual(len({case['case_id'] for case in cases}), 3)
        for case in cases:
            self.assertEqual(case['status'], 'tested and failed', case['blockers'])
            self.assertEqual(case['blockers'], ['Failed appearance check'])
            self.assertTrue(all(value for key, value in case['checks'].items() if key != 'appearance'))
            self.assertTrue(case['measurements']['authored_sdr']['passed'])
            self.assertTrue(case['measurements']['cross_decoder_hdr']['passed'])
            self.assertFalse(case['measurements']['native_hdr']['passed'])
            self.assertFalse(case['measurements']['independent_hdr']['passed'])
            self.assertEqual(case['rendering_scope']['source_gain_map_weight'], case['rendering_scope']['output_gain_map_weight'])
            self.assertEqual(case['rendering_scope']['source_capacity_headroom_log2'], 3.5)
            self.assertEqual(case['rendering_scope']['output_capacity_headroom_log2'], 3.5)
            self.assertFalse(case['rendering_scope']['headroom_is_product_selector'])
            self.assertEqual(case['source_sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
            self.assertEqual(case['artifacts']['sha256'], 'ecb7e4eee3afa0ceedab36488f3221ffe69ed3c78317a1054f69349b23cf090d')
            self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(avif.digest(case['reference_hdr']['path']), case['reference_hdr']['sha256'])
        for case, count, maximum in zip(cases, (6, 8, 8), (146.78469989010358, 171.39496427860442, 171.39496427860442)):
            self.assertEqual(len(case['measurements']['independent_hdr']['failures']), count)
            self.assertAlmostEqual(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], maximum, places=6)

    def test_source_metadata_carrier_and_both_rgb8_layers_are_independently_bound(self):
        native = self.result['native_candidate']
        carrier = native['metadata_carrier']
        self.assertEqual(carrier['sha256'], 'd22fd05e210df1067ebd6a1f63d0e5d94c5fa9042fe2ebd7067a10a301402271')
        self.assertTrue(carrier['agreement']['passed'])
        self.assertIn('No carrier pixels', carrier['scope'])
        facts = self.result['evidence'][0]['facts']
        self.assertTrue(all(facts['metadata_agreement']['checks'].values()))
        self.assertTrue(facts['original_metadata_agreement']['passed'])
        self.assertTrue(all(facts['independent_tmap_iso_field_agreement'].values()))
        self.assertTrue(facts['native_carrier_values_exact'])
        for layer in ('base', 'map'):
            self.assertEqual((facts[layer]['width'], facts[layer]['height'], facts[layer]['depth'], facts[layer]['sof']), (173, 130, 8, 0))
        self.assertEqual(facts['private_tags'], [])
        self.assertEqual([c['gamma'] for c in facts['iso_metadata']['channels']], [1, 1, 1])
        self.assertEqual([c['base_offset'] for c in facts['iso_metadata']['channels']], [0, 0, 0])
        self.assertTrue(native['map']['equal_rgb_channels'])
        self.assertEqual(native['map']['encoding']['method'], 'float')

    def test_previous_endpoint_and_failed_intermediate_trials_are_retained_exactly(self):
        baseline = self.result['regenerated_map_baseline']
        self.assertEqual(baseline['converter_endpoint']['status'], 'qualified')
        self.assertEqual(baseline['evidence'][0]['status'], 'tested and failed')
        self.assertEqual(baseline['evidence'][0]['artifacts']['sha256'], '8d75fedb48b4622c4af1ce6d47592aa47a1325ffbe4cbd2817753c28d0127955')
        self.assertAlmostEqual(baseline['evidence'][0]['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], 75.26896020195449, places=6)
        self.assertTrue(self.result['unchanged_artifacts']['passed'])
        self.assertEqual(self.result['unchanged_artifacts']['before'], self.result['unchanged_artifacts']['after'])
        for case in self.result['evidence']:
            self.assertEqual(case['measurements']['authored_sdr'],
                             baseline['converter_endpoint']['case']['measurements']['authored_sdr'])

    def test_ordering_diagnostic_has_equal_offset_scope_and_no_threshold_impossibility_claim(self):
        diagnostic = self.result['reference_ordering_diagnostic']
        self.assertEqual(diagnostic['pixels_with_exact_order_violation'], 809)
        self.assertEqual(diagnostic['pixels_with_order_violation_above_001nit'], 441)
        self.assertAlmostEqual(diagnostic['maximum_channel_excursion_nits'], 1.9247132137951066)
        self.assertIn('equal', diagnostic['property'])
        self.assertIn('not a proof', diagnostic['scope'])
        sample = diagnostic['samples'][0]
        self.assertEqual(sample['xy'], [117, 86])
        self.assertLess(sample['source_boost2_nits'][1], min(sample['authored_sdr_nits'][1], sample['source_full_nits'][1]))
        self.assertIn('not', sample['projection_scope'])
        self.assertIn('lower', sample['projection_scope'])
        self.assertFalse(diagnostic['may_qualify_emitted_file'])
        for value in self.result['pre_jpeg_diagnostics'].values():
            self.assertFalse(value['measurement']['passed'])
            self.assertFalse(value['may_qualify_emitted_file'])

    def test_carrier_hash_or_source_metadata_mismatch_stops_native_packing(self):
        carrier = Path(self.result['native_candidate']['metadata_carrier']['path'])
        changed = self.root/'changed-carrier.jpg'
        changed.write_bytes(carrier.read_bytes()+b'changed')
        source_facts = self.result['evidence'][0]['source_facts']
        start = len(avif.COMMANDS)
        with self.assertRaisesRegex(ValueError, 'carrier hash'):
            self.module._carrier(source_facts, changed)
        self.assertEqual(len(avif.COMMANDS), start)
        changed_facts = copy.deepcopy(source_facts)
        changed_facts['metadata']['alternate_headroom'] = [4, 1]
        with self.assertRaisesRegex(ValueError, 'carrier metadata'):
            self.module._carrier(changed_facts, carrier)

    def test_output_private_metadata_wrong_gain_and_trailing_payload_are_rejected(self):
        case = self.result['evidence'][0]
        original = Path(case['artifacts']['output']).read_bytes()
        carrier = self.result['native_candidate']['metadata_carrier']
        private = self.root/'private.jpg'
        private.write_bytes(original)
        avif.native(['exiftool', '-overwrite_original', '-XMP:Creator=proof-private', private])
        with self.assertRaises(ValueError):
            self.module.inspect_output(private, self.root/'private-inspection', case['source_facts'], carrier)
        tail = self.root/'tail.jpg'
        tail.write_bytes(original+b'private-tail')
        with self.assertRaises(ValueError):
            self.module.inspect_output(tail, self.root/'tail-inspection', case['source_facts'], carrier)
        wrong = copy.deepcopy(case['source_facts'])
        wrong['metadata']['gain_map_max'][0] = [4, 1]
        with self.assertRaises(ValueError):
            self.module.inspect_output(Path(case['artifacts']['output']), self.root/'wrong-gain', wrong, carrier)

    def test_unsupported_geometry_selectors_and_source_stop_before_native_work(self):
        for arguments in ({'operation': 'upscale'}, {'source_id': 'gainmap-android-iso'},
                          {'selectors': {'format': 'avif'}}, {'selectors': {**self.module.SELECTORS, 'orientation': 8}},
                          {'selectors': {**self.module.SELECTORS, 'depth': '12'}}):
            start = len(avif.COMMANDS)
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **arguments)
            self.assertEqual(len(avif.COMMANDS), start)
            self.assertFalse((self.root/'rejected').exists())

    def test_actual_matrix_preserves_three_failed_renderings_and_manual_scope(self):
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        rows = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:hdr:jpg')['evidence']
        self.assertEqual(len(rows), 3)
        self.assertEqual([row['status'] for row in rows], ['tested and failed']*3)
        for case in self.result['evidence']:
            self.assertIn('ICC-aware', case['qualification_scope'])
            self.assertIn('pending', ' '.join(case['known_consumer_limitations']))


if __name__ == '__main__':
    unittest.main()
