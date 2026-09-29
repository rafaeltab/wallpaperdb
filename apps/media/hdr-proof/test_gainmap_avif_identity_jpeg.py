"""Unresized conversion qualifies only its exact file and measured boosts."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif
import gainmap_avif
from matrix import build_matrix


class GainMapAvifIdentityJpegTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import gainmap_avif_identity_jpeg
        cls.module = gainmap_avif_identity_jpeg
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_one_native_file_passes_all_three_renderings_with_original_metadata(self):
        cases = self.result['evidence']
        self.assertEqual(len(cases), 3)
        self.assertEqual(len({case['case_id'] for case in cases}), 3)
        for case in cases:
            self.assertEqual(case['proof_module'], 'gainmap_avif_identity_jpeg')
            self.assertEqual(case['geometry'], 'identity')
            self.assertEqual(case['selectors'], self.module.SELECTORS)
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertEqual(case['artifacts']['sha256'], '94d21dd9b9c96cdeb04511d945a8b60dacd6a8d829aed7369e154e7d480c92b2')
            self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
            self.assertEqual(case['source_sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
            self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
            self.assertEqual(case['rendering_scope']['source_gain_map_weight'], case['rendering_scope']['output_gain_map_weight'])
            self.assertEqual(case['rendering_scope']['source_capacity_headroom_log2'], 3.5)
            self.assertEqual(case['rendering_scope']['output_capacity_headroom_log2'], 3.5)
            self.assertFalse(case['rendering_scope']['headroom_is_product_selector'])
            self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
            self.assertAlmostEqual(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], 4.666031245202287, places=6)
        self.assertEqual([case['rendering_scope']['source_gain_map_weight'] for case in cases], [2/7, 1, 1])
        self.assertTrue(self.result['same_file_all_renderings']['passed'])

    def test_source_and_native_preparation_are_independent_and_keep_actual_dimensions(self):
        case = self.result['evidence'][0]
        source = self.result['source_fixtures'][0]
        self.assertTrue(source['source_lock']['passed'])
        self.assertEqual(source['facts']['base']['depths'], [8, 8, 8])
        self.assertEqual(source['facts']['map']['depths'], [8])
        self.assertEqual(source['facts']['base']['dimensions'], [403, 302])
        self.assertTrue(self.result['native_preparation']['base_source_samples_exact'])
        self.assertTrue(self.result['native_preparation']['source_appearance']['passed'])
        self.assertTrue(self.result['native_candidate']['base_encoding']['transfer_stage']['passed'])
        self.assertTrue(case['facts']['original_metadata_agreement']['passed'])
        self.assertTrue(all(case['facts']['independent_tmap_iso_field_agreement'].values()))
        self.assertTrue(case['facts']['native_carrier_values_exact'])
        for layer in ('base', 'map'):
            self.assertEqual((case['facts'][layer]['width'], case['facts'][layer]['height'],
                              case['facts'][layer]['depth'], case['facts'][layer]['sof']), (403, 302, 8, 0))
        self.assertEqual(case['facts']['private_tags'], [])
        self.assertEqual(case['facts']['actual_base_icc']['gamut'], 'srgb')
        self.assertEqual([c['gamma'] for c in case['facts']['iso_metadata']['channels']], [1, 1, 1])
        self.assertTrue(all(row['passed'] for row in self.result['controls']))

    def test_source_references_are_same_boost_without_derivative_geometry(self):
        for case in self.result['evidence']:
            reference = case['reference_hdr']
            self.assertEqual(reference['dimensions'], [403, 302])
            self.assertEqual(reference['display_boost'], case['rendering_scope']['display_boost'])
            self.assertEqual(avif.digest(reference['path']), reference['sha256'])
            self.assertEqual(case['source_decoder_evidence']['geometry'], 'none')
            self.assertIn('dav1d', case['source_decoder_evidence']['decoder'])
            self.assertNotIn('w', case['selectors'])
            self.assertNotIn('h', case['selectors'])
            self.assertNotIn('fit', case['selectors'])
            self.assertIn('no resize', case['qualification_scope'])
        self.assertEqual(self.result['evidence'][1]['reference_hdr']['sha256'], '92fc94cac7abb0b39e5d5ca9bee3c18e5bf817a7585e2dd26d9322700fa484ca')

    def test_stock_and_physical_consumers_remain_separate_and_pending(self):
        for case in self.result['evidence']:
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertIn('ICC-aware', case['qualification_scope'])
            self.assertIn('resizing', ' '.join(case['known_consumer_limitations']))
            stock = case['consumer_decoder_diagnostics']['stock_native_srgb']
            self.assertEqual(stock['display_boost'], 16)
            self.assertEqual(stock['status'], 'tested and failed')
            self.assertFalse(stock['measurement']['passed'])
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        rows = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:hdr:jpg')['evidence']
        self.assertEqual(len(rows), 3)
        self.assertEqual([row['status'] for row in rows], ['qualified']*3)

    def test_unsupported_source_or_selectors_stop_before_native_work(self):
        for options in ({'source_id': 'gainmap-android-iso'}, {'operation': 'contain'},
                        {'selectors': {**self.module.SELECTORS, 'w': 403}},
                        {'selectors': {**self.module.SELECTORS, 'orientation': 8}},
                        {'selectors': {**self.module.SELECTORS, 'depth': '12'}},
                        {'selectors': {**self.module.SELECTORS, 'motion': 'animate'}}):
            before = len(avif.COMMANDS)
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **options)
            self.assertEqual(len(avif.COMMANDS), before)
            self.assertFalse((self.root/'rejected').exists())
        source = Path(self.result['source_fixtures'][0]['path'])
        unknown = self.root/'unknown.avif'
        data = source.read_bytes()
        unknown.write_bytes(data.replace(b'nclx\x00\x01\x00\x0d\x00\x00\x80', b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
        before = len(avif.COMMANDS)
        decision = self.module.source_decision(unknown, self.root/'unknown')
        self.assertEqual(decision['action'], 'original only')
        self.assertEqual(len(avif.COMMANDS), before)
        self.assertTrue(gainmap_avif.copy_original(unknown, self.root/'unknown-original.avif')['exact_bytes'])

    def test_wrong_geometry_gain_metadata_and_private_payload_are_rejected(self):
        case = self.result['evidence'][0]
        path = Path(case['artifacts']['output'])
        facts, carrier = case['source_facts'], self.result['native_candidate']['metadata_carrier']
        altered = self.root/'private.jpg'
        altered.write_bytes(path.read_bytes())
        avif.native(['exiftool', '-overwrite_original', '-XMP:Creator=proof-private', altered])
        with self.assertRaises(ValueError):
            self.module.inspect_output(altered, self.root/'private-inspection', facts, carrier)
        tail = self.root/'tail.jpg'
        tail.write_bytes(path.read_bytes()+b'private tail')
        with self.assertRaises(ValueError):
            self.module.inspect_output(tail, self.root/'tail-inspection', facts, carrier)
        wrong = copy.deepcopy(facts)
        wrong['metadata']['alternate_headroom'] = [4, 1]
        with self.assertRaises(ValueError):
            self.module.inspect_output(path, self.root/'wrong-metadata', wrong, carrier)
        wrong = copy.deepcopy(facts)
        wrong['base']['dimensions'] = [173, 130]
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.inspect_output(path, self.root/'wrong-size', wrong, carrier)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_changed_extracted_map_cannot_qualify_the_original_output(self):
        decode = self.module.icc_gainmap.native_decode

        def mutate_after_real_native_decode(path, raw, **options):
            result = decode(path, raw, **options)
            extracted = Path(path).parent/'inspection/map.jpg'
            extracted.write_bytes(extracted.read_bytes()+b'changed extracted map')
            return result

        with patch.object(self.module.icc_gainmap, 'native_decode', side_effect=mutate_after_real_native_decode):
            result = self.module.run(self.root/'changed-map')
        self.assertTrue(all(case['status'] == 'tested and failed' for case in result['evidence']))
        self.assertTrue(all(any('extracted map' in error for error in case['blockers']) for case in result['evidence']))


if __name__ == '__main__':
    unittest.main()
