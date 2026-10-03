"""Native HDR JPEG must preserve both independently defined source endpoints."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import avif
import gainmap_avif
import gainmap_avif_hdr_jpeg
from matrix import build_matrix
from gamma_icc import make_profile


class GainMapAvifHdrJpegTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_hdr_jpeg.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_file_has_both_actual_rgb8_layers_and_independent_endpoints(self):
        self.assertEqual(len(self.result['evidence']), 1)
        case = self.result['evidence'][0]
        self.assertIn('independent_hdr', case['measurements'], case['blockers'])
        self.assertEqual(case['source_sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
        self.assertEqual(case['selectors'], gainmap_avif_hdr_jpeg.SELECTORS)
        self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
        for name in ('base', 'map'):
            facts = case['facts'][name]
            self.assertEqual((facts['width'], facts['height'], facts['depth'], facts['sof']), (173, 130, 8, 0))
        self.assertTrue(case['checks']['native_encoder'])
        self.assertTrue(case['checks']['native_hdr_preparation'])
        self.assertTrue(case['checks']['native_sdr_preparation'])
        self.assertTrue(case['checks']['structure'], case['blockers'])
        self.assertTrue(case['checks']['privacy'], case['blockers'])
        self.assertEqual(case['hdr_decoder_evidence']['independent']['gain_map_weight'], 1)
        self.assertEqual(case['endpoint']['native_weight_derived_from_verified_inputs'], 1)
        self.assertEqual(case['endpoint']['display_boost'], 16)
        self.assertEqual(case['native_candidate']['map_gamma'], 1.5)
        self.assertEqual(case['native_candidate']['map_policy'], 'midpointoffset')
        self.assertEqual(case['native_candidate']['map_method'], 'float')
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertIn('ICC-aware', case['qualification_scope'])
        self.assertIn('full-headroom', case['qualification_scope'])
        self.assertIn('stock_native_srgb', ' '.join(case['known_consumer_limitations']))
        self.assertIn('tested and failed', ' '.join(case['known_consumer_limitations']))
        self.assertEqual(case['status'], 'qualified' if all(case['checks'].values()) else 'tested and failed')
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertEqual(case['artifacts']['sha256'], '8d75fedb48b4622c4af1ce6d47592aa47a1325ffbe4cbd2817753c28d0127955')
        self.assertAlmostEqual(case['measurements']['independent_hdr']['regions']['midtone']['delta_e_itp']['maximum'], 3.849650003985151, places=6)
        self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
        self.assertTrue(all(row['passed'] for row in self.result['controls']))
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        actual = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:hdr:jpg')['evidence']
        self.assertEqual([(row['case_id'], row['status']) for row in actual], [(case['case_id'], case['status'])])

    def test_source_sampling_aspect_and_stock_reader_failures_stay_visible(self):
        case = self.result['evidence'][0]
        sampling = case['native_preparation']['source_sampling_diagnostics']['evidence'][0]
        self.assertEqual(sampling['candidate'], 'libavif-native-map-sampling-pq12')
        self.assertEqual(sampling['status'], 'tested and failed')
        self.assertFalse(sampling['checks']['source_appearance'])
        self.assertIn('source', sampling['measurements'])
        aspect = case['native_preparation']['hdr_png']['evidence'][0]
        self.assertEqual(aspect['status'], 'tested and failed')
        self.assertFalse(aspect['checks']['structure'])
        self.assertEqual(aspect['facts']['physical_pixel_dimensions'], [0, 1, 0])
        stock = case['consumer_decoder_diagnostics']['stock_native_srgb']
        self.assertEqual(stock['consumer_status'], 'pending manual review')
        self.assertIn('measurement', stock)
        self.assertEqual(stock['status'], 'tested and failed')

    def test_failed_source_geometry_or_intent_preparation_withholds_native_encoding(self):
        prepared = self.result['evidence'][0]['native_preparation']
        for name in ('source_appearance', 'linear_geometry_appearance', 'structure', 'native_storage'):
            hdr = copy.deepcopy(prepared['hdr_png'])
            hdr['evidence'][1]['checks'][name] = False
            start = len(avif.COMMANDS)
            failed = gainmap_avif_hdr_jpeg._case(self.root/'blocked', hdr, prepared['sdr_png'], prepared['source_sampling_diagnostics'])
            self.assertEqual(failed['status'], 'tested and failed')
            self.assertFalse(failed['checks']['native_hdr_preparation'])
            self.assertFalse(failed['checks']['native_encoder'])
            self.assertEqual(len(avif.COMMANDS), start)

    def test_private_orientation_wrong_icc_and_gain_metadata_are_rejected(self):
        case = self.result['evidence'][0]
        data = Path(case['artifacts']['output']).read_bytes()
        profile = self.root/'wrong-gamma.icc'
        profile.write_bytes(make_profile(gamma=2.2))
        for name, argument in (('privacy', '-XMP:Creator=proof-private'), ('orientation', '-Orientation#=8'),
                               ('icc', f'-ICC_Profile<={profile}')):
            path = self.root/f'{name}.jpg'
            path.write_bytes(data)
            avif.native(['exiftool', '-overwrite_original', argument, path])
            with self.assertRaises(ValueError):
                gainmap_avif_hdr_jpeg.inspect_output(path, self.root/f'{name}-inspection')
        marker = b'<rdf:li>1.5</rdf:li>'
        self.assertEqual(data.count(marker), 3)
        changed = self.root/'wrong-map-gamma.jpg'
        changed.write_bytes(data.replace(marker, b'<rdf:li>2.5</rdf:li>', 1))
        with self.assertRaises(ValueError):
            gainmap_avif_hdr_jpeg.inspect_output(changed, self.root/'wrong-gain-inspection')

    def test_trailing_payload_or_additional_image_cannot_hide_in_native_container(self):
        data = Path(self.result['evidence'][0]['artifacts']['output']).read_bytes()
        for name, suffix in (('private-tail', b'proof-private'), ('third-image', data)):
            path = self.root/f'{name}.jpg'
            path.write_bytes(data+suffix)
            with self.assertRaises(ValueError):
                gainmap_avif_hdr_jpeg.inspect_output(path, self.root/f'{name}-inspection')

    def test_unsupported_selectors_reject_before_native_work(self):
        for change in ({'format': 'avif'}, {'range': 'sdr'}, {'depth': '8'}, {'depth': '12'},
                       {'gamut': 'p3'}, {'w': 174}, {'fit': 'cover'}, {'h': 130},
                       {'motion': 'animate'}, {'transparency': 'coerce'}):
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'HDR JPEG containment'):
                gainmap_avif_hdr_jpeg.run(self.root/'wrong', selectors={**gainmap_avif_hdr_jpeg.SELECTORS, **change})
            self.assertEqual(len(avif.COMMANDS), start)

    def test_unknown_source_facts_remain_exact_original_only(self):
        source = Path(self.result['source_fixtures'][0]['path'])
        original = source.read_bytes()
        marker = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
        self.assertEqual(original.count(marker), 1)
        changed = self.root/'unknown-source.avif'
        changed.write_bytes(original.replace(marker, b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
        start = len(avif.COMMANDS)
        decision = gainmap_avif_hdr_jpeg.source_decision(changed, self.root/'unknown')
        self.assertEqual(decision['action'], 'original only')
        self.assertEqual(len(avif.COMMANDS), start)
        self.assertTrue(gainmap_avif.copy_original(changed, self.root/'original.avif')['exact_bytes'])

    def test_parseable_source_metadata_change_cannot_bypass_the_fixture_lock(self):
        data = Path(self.result['source_fixtures'][0]['path']).read_bytes()
        marker = bytes(5)+b'\xc0'+bytes(4)+b'\x00\x00\x00\x01'+b'\x00\x00\x00\x07\x00\x00\x00\x02'
        self.assertEqual(data.count(marker), 1)
        changed = self.root/'changed-headroom.avif'
        changed.write_bytes(data.replace(marker, marker[:-8]+b'\x00\x00\x00\x08\x00\x00\x00\x02'))
        gainmap_avif.parse_source(changed.read_bytes())
        start = len(avif.COMMANDS)
        result = gainmap_avif_hdr_jpeg.source_decision(changed, self.root/'changed-headroom')
        self.assertEqual(result['action'], 'original only')
        self.assertIn('source hash', result['reason'])
        self.assertEqual(len(avif.COMMANDS), start)


class GainMapAvifHdrJpegGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_hdr_jpeg.run(cls.root/'proof', geometries=('contain', 'cover', 'fill', 'upscale'))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_each_native_geometry_keeps_its_own_references_depths_and_full_headroom_gates(self):
        cases = self.result['evidence']
        self.assertEqual(len(cases), 4)
        self.assertEqual(len({case['case_id'] for case in cases}), 4)
        self.assertEqual([case['geometry'] for case in cases], ['contain', 'cover', 'fill', 'upscale'])
        self.assertEqual([case['status'] for case in cases], ['qualified']*4)
        for case in cases:
            with self.subTest(geometry=case['geometry']):
                self.assertIn('independent_hdr', case['measurements'], case['blockers'])
                dimensions = gainmap_avif_hdr_jpeg.SIZES[case['geometry']]
                for layer in ('base', 'map'):
                    facts = case['facts'][layer]
                    self.assertEqual((facts['width'], facts['height']), dimensions)
                    self.assertEqual((facts['sof'], facts['depth'], facts['components']), (0, 8, 3))
                for key in ('native_hdr_preparation', 'native_sdr_preparation', 'native_transfer', 'native_encoder', 'full_headroom', 'structure', 'privacy'):
                    self.assertTrue(case['checks'][key], case['blockers'])
                self.assertEqual(case['endpoint']['display_boost'], 16)
                self.assertEqual(case['endpoint']['independent_weight'], 1)
                self.assertEqual(case['endpoint']['partial_adaptation'], 'untested')
                self.assertIn('display boost 16 only', case['qualification_scope'])
                self.assertEqual(case['status'], 'qualified' if all(case['checks'].values()) else 'tested and failed')
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
        expected_hashes = ['8d75fedb48b4622c4af1ce6d47592aa47a1325ffbe4cbd2817753c28d0127955',
            'eb70a90c64012a6fef4a7879811fe0a0a3dc5748c9e32064ce81f3198adae2bb',
            'ba81c3b9a61554eaf06205bbe17b6129f0aecdf396e16c0e5b2b8f13d8d133c1',
            'fc025b1532d65390865c153d10317fbc4b9173d21559340a22e44b410310c430']
        self.assertEqual([case['artifacts']['sha256'] for case in cases], expected_hashes)
        self.assertAlmostEqual(cases[-1]['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], 6.105432785879105, places=6)
        matrix = build_matrix(cases)
        self.assertEqual(matrix['evidence_errors'], [])
        actual = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:hdr:jpg')['evidence']
        self.assertEqual([(row['case_id'], row['status']) for row in actual], [(row['case_id'], row['status']) for row in cases])

    def test_wrong_geometry_lists_and_selectors_stop_before_native_work(self):
        for geometries in ((), ('contain', 'contain'), ('crop',), ('orientation',), ('unknown',)):
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_hdr_jpeg.run(self.root/'wrong', geometries=geometries)
            self.assertEqual(len(avif.COMMANDS), start)
        for geometries in (('contain', 'cover'), ('cover',), ('fill',), ('upscale',)):
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_hdr_jpeg.run(self.root/'wrong-selectors', geometries=geometries, selectors=gainmap_avif_hdr_jpeg.SELECTORS)
            self.assertEqual(len(avif.COMMANDS), start)

    def test_actual_cover_raster_cannot_borrow_containment_dimensions(self):
        case = next(row for row in self.result['evidence'] if row['geometry'] == 'cover')
        with self.assertRaisesRegex(ValueError, 'geometry'):
            gainmap_avif_hdr_jpeg.inspect_output(case['artifacts']['output'], self.root/'wrong-dimensions')

    def test_containment_bytes_facts_checks_and_measurements_remain_exact(self):
        case = self.result['evidence'][0]
        self.assertEqual(case['geometry'], 'contain')
        self.assertEqual(case['status'], 'qualified')
        self.assertEqual(case['artifacts']['sha256'], '8d75fedb48b4622c4af1ce6d47592aa47a1325ffbe4cbd2817753c28d0127955')
        expected = {'facts': 'dc6615e385490f4420d818d6f83147e9150db696ef8f27321d1b10eb2df5893e',
            'checks': '2fae13a5a55d59ffddce5d5cd33858ae8cf048b7f25a2b3bd7993d39386b6225',
            'measurements': 'e9239cd0a0c643da7496400e211cfc898581efd5037ceab5d091cb403f6badae',
            'threshold_scope': '0d7e8cc6cb5f58064ac40a3fb750af032038c2fdf67de1595148f81a33b7db79',
            'endpoint': '4622b2e5cfcf92a983597f82e2e04acc474af28caf08f28e65bcb4e4c3970808'}
        for key, digest in expected.items():
            self.assertEqual(hashlib.sha256(json.dumps(case[key], sort_keys=True).encode()).hexdigest(), digest, key)


if __name__ == '__main__':
    unittest.main()
