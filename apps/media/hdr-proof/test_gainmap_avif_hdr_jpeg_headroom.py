"""Actual lower-headroom rendering stays separate from endpoint qualification."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import avif
import gainmap_avif
import gainmap_avif_hdr_jpeg
from matrix import build_matrix


class GainMapAvifHdrJpegHeadroomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import gainmap_avif_hdr_jpeg_headroom
        cls.module = gainmap_avif_hdr_jpeg_headroom
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')
        cls.case = cls.result['evidence'][0]

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_real_converter_keeps_exact_qualified_boost16_endpoint(self):
        endpoint = self.result['converter_endpoint']['case']
        self.assertEqual(endpoint['status'], 'qualified')
        self.assertEqual(endpoint['endpoint']['display_boost'], 16)
        expected = {
            'facts': 'dc6615e385490f4420d818d6f83147e9150db696ef8f27321d1b10eb2df5893e',
            'checks': '2fae13a5a55d59ffddce5d5cd33858ae8cf048b7f25a2b3bd7993d39386b6225',
            'measurements': 'e9239cd0a0c643da7496400e211cfc898581efd5037ceab5d091cb403f6badae',
            'threshold_scope': '0d7e8cc6cb5f58064ac40a3fb750af032038c2fdf67de1595148f81a33b7db79',
            'endpoint': '4622b2e5cfcf92a983597f82e2e04acc474af28caf08f28e65bcb4e4c3970808',
        }
        for name, digest in expected.items():
            self.assertEqual(hashlib.sha256(json.dumps(endpoint[name], sort_keys=True).encode()).hexdigest(), digest, name)
        self.assertEqual(self.case['artifacts'], endpoint['artifacts'])
        self.assertEqual(self.case['artifacts']['sha256'], '8d75fedb48b4622c4af1ce6d47592aa47a1325ffbe4cbd2817753c28d0127955')
        self.assertEqual(avif.digest(self.case['artifacts']['output']), self.case['artifacts']['sha256'])
        self.assertEqual(self.case['source_sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
        self.assertEqual(endpoint['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
        record = self.result['converter_endpoint']['report']
        self.assertEqual(avif.digest(record['path']), record['sha256'])

    def test_actual_boost2_fails_both_readers_despite_reader_agreement(self):
        case = self.case
        self.assertEqual(case['status'], 'tested and failed', case['blockers'])
        self.assertEqual(case['blockers'], ['Failed appearance check at display boost 2'])
        self.assertTrue(all(value for key, value in case['checks'].items() if key != 'appearance'))
        self.assertFalse(case['checks']['appearance'])
        self.assertEqual(case['selectors'], gainmap_avif_hdr_jpeg.SELECTORS)
        self.assertNotIn('display_boost', case['selectors'])
        self.assertIn(':render-boost2', case['case_id'])
        self.assertEqual(case['rendering_scope']['display_boost'], 2)
        self.assertFalse(case['rendering_scope']['headroom_is_product_selector'])
        self.assertEqual(case['rendering_scope']['source_capacity_headroom_log2'], 3.5)
        self.assertAlmostEqual(case['rendering_scope']['source_gain_map_weight'], 2/7)
        self.assertAlmostEqual(case['rendering_scope']['output_capacity_headroom_log2'], 2.7734463214874268)
        self.assertAlmostEqual(case['rendering_scope']['output_gain_map_weight'], .36056223343947397)
        self.assertIn('not a returned native decoder field', case['rendering_scope']['native_weight_scope'])
        for reader in ('native_hdr', 'independent_hdr'):
            measure = case['measurements'][reader]
            self.assertFalse(measure['passed'])
            self.assertEqual(len(measure['failures']), 12)
            self.assertGreater(measure['regions']['shadow']['delta_e_itp']['maximum'], 75)
            self.assertGreater(measure['regions']['highlight']['delta_e_itp']['mean'], 9.9)
        self.assertTrue(case['measurements']['cross_decoder_hdr']['passed'])
        self.assertTrue(case['measurements']['authored_sdr']['passed'])
        self.assertAlmostEqual(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'],
                               75.26896020195449, places=6)
        self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')

    def test_source_is_rendered_at_same_boost_before_the_unchanged_geometry(self):
        source = self.case['source_decoder_evidence']
        self.assertTrue(source['boost16_source_reference_exact'])
        self.assertEqual(source['headroom_log2'], 1)
        self.assertIn('dav1d', source['decoder'])
        self.assertIn('before', source['geometry_order'])
        self.assertEqual(source['facts']['base']['depths'], [8, 8, 8])
        self.assertEqual(source['facts']['map']['depths'], [8])
        reference = self.case['reference_hdr']
        self.assertEqual(reference['dimensions'], [173, 130])
        self.assertEqual(reference['display_boost'], 2)
        self.assertEqual(avif.digest(reference['path']), reference['sha256'])
        self.assertEqual(reference['sha256'], 'f103a1752bc07c0e538ce7564394f9c7cc50f18f3fa4eeeab05a774b8ff2042e')
        self.assertEqual(self.case['source_reference_revision'], self.module.REFERENCE_REVISION)
        self.assertNotIn('hdr_intent', self.case)

    def test_hypothetical_diagnostics_explain_failure_without_qualifying_output(self):
        diagnostic = self.result['attribution_diagnostics']
        self.assertFalse(diagnostic['may_qualify_emitted_file'])
        self.assertIn('hypothetical', diagnostic['scope'])
        measurements = diagnostic['measurements']
        normalized = measurements['coded_map_source_capacity_weight']
        self.assertLess(normalized['regions']['highlight']['delta_e_itp']['maximum'], 1.7)
        self.assertGreater(normalized['regions']['shadow']['delta_e_itp']['maximum'], 87)
        self.assertGreater(measurements['ideal_native_endpoint_gain_source_capacity_weight']['regions']['shadow']['delta_e_itp']['maximum'], 87)
        self.assertGreater(measurements['independent_linear_geometry_endpoints_declared_offset']['regions']['shadow']['delta_e_itp']['maximum'], 22)
        self.assertGreater(diagnostic['authored_sdr_vs_hypothetical_linear_sdr_geometry']['regions']['shadow']['delta_e_itp']['maximum'], 116)
        self.assertTrue(diagnostic['coded_map_matches_independent_reader_exactly'])
        self.assertEqual(diagnostic['worst_pixels']['coded_map_source_capacity_weight']['xy'], [109, 97])
        self.assertEqual(diagnostic['worst_pixels']['coded_map_source_capacity_weight']['reference_nits'], [0, 0, 0])
        self.assertEqual(self.case['status'], 'tested and failed')

    def test_matrix_and_manual_scope_keep_the_two_renderings_separate(self):
        endpoint = self.result['converter_endpoint']['case']
        matrix = build_matrix([endpoint, self.case])
        self.assertEqual(matrix['evidence_errors'], [])
        rows = next(cell for cell in matrix['cells'] if cell['id'] == self.case['cell_id'])['evidence']
        self.assertEqual({row['case_id']: row['status'] for row in rows},
                         {endpoint['case_id']: 'qualified', self.case['case_id']: 'tested and failed'})
        self.assertEqual(self.case['consumer_status'], 'pending manual review')
        self.assertIn('display boost 2', self.case['qualification_scope'])
        self.assertIn('tested and failed', self.case['qualification_scope'])
        self.assertIn('stock_native_srgb', ' '.join(self.case['known_consumer_limitations']))
        self.assertEqual(self.case['consumer_decoder_diagnostics']['stock_native_srgb']['display_boost'], 16)
        self.assertTrue(self.result['commands'])
        self.assertTrue(self.result['native_log_artifacts'])

    def test_unsupported_renderings_and_selectors_stop_before_native_work(self):
        for change in ({'operation': 'upscale'}, {'source_id': 'gainmap-android-iso'},
                       {'display_boost': 1}, {'display_boost': 4}, {'display_boost': 16},
                       {'display_boost': True}, {'display_boost': float('nan')},
                       {'selectors': {**gainmap_avif_hdr_jpeg.SELECTORS, 'depth': '12'}},
                       {'selectors': {**gainmap_avif_hdr_jpeg.SELECTORS, 'orientation': 8}}):
            start = len(avif.COMMANDS)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **change)
            self.assertEqual(len(avif.COMMANDS), start)
            self.assertFalse((self.root/'rejected').exists())

    def test_unknown_source_facts_and_hash_are_original_only_before_source_decode(self):
        endpoint = self.result['converter_endpoint']['case']
        original = Path(endpoint['artifacts']['source']).read_bytes()
        marker = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
        for name, data in (('unknown', original.replace(marker, b'nclx\x00\x02\x00\x0d\x00\x00\x80')),
                           ('unlocked', original+b'changed')):
            path = self.root/f'{name}.avif'
            path.write_bytes(data)
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module._source_reference(path, endpoint, self.root/name, gainmap_avif.SOURCE_LOCK)
            self.assertEqual(len(avif.COMMANDS), start)
            decision = gainmap_avif_hdr_jpeg.source_decision(path, self.root/(name+'-decision'))
            self.assertEqual(decision['action'], 'original only')
            self.assertTrue(gainmap_avif.copy_original(path, self.root/(name+'-original.avif'))['exact_bytes'])


if __name__ == '__main__':
    unittest.main()
