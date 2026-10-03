"""Same-file rendering proofs retain the four exact native ISO recipes."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch

import avif


class IsoGeometryHeadroomTests(unittest.TestCase):
    def test_unknown_duplicate_or_empty_geometry_stops_before_native_work(self):
        from iso_geometry_headroom import run
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)/'proof'
            for geometries in ((), ('upscale',), ('crop',), ('contain', 'contain'), ['contain']):
                before = len(avif.COMMANDS)
                with self.subTest(geometries=geometries), self.assertRaises(ValueError):
                    run(target, geometries=geometries)
                self.assertEqual(before, len(avif.COMMANDS))
                self.assertFalse(target.exists())

    def test_changed_source_is_original_only_before_any_native_conversion(self):
        import gainmap
        from iso_geometry_headroom import run
        original = (gainmap.FIXTURES/'gainmap-android-iso.jpg').read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory/'gainmap-android-iso.jpg'
            source.write_bytes(original+b'unknown provenance')
            before, native_calls = source.read_bytes(), len(avif.COMMANDS)
            with patch.object(gainmap, 'FIXTURES', directory), self.assertRaisesRegex(ValueError, 'original only'):
                run(directory/'proof')
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(len(avif.COMMANDS), native_calls)
            self.assertFalse((directory/'proof').exists())


class NativeIsoGeometryHeadroomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from iso_geometry_headroom import run
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_changed_extracted_source_map_is_rejected_before_reference_decode(self):
        import combined_gainmap_proof
        from iso_geometry_headroom import run
        original_run = combined_gainmap_proof.run
        evidence = {}

        def encode_then_change_map(directory, **kwargs):
            endpoints = original_run(directory, **kwargs)
            source_map = directory/'sources/gainmap-android-iso/map.jpg'
            source_map.write_bytes(source_map.read_bytes()+b'changed map provenance')
            evidence['map'] = source_map
            evidence['bytes'] = source_map.read_bytes()
            evidence['native_calls'] = len(avif.COMMANDS)
            return endpoints

        with patch.object(combined_gainmap_proof, 'run', side_effect=encode_then_change_map):
            result = run(self.root/'changed-map', geometries=('contain',))
        self.assertEqual(len(avif.COMMANDS), evidence['native_calls'])
        self.assertEqual(evidence['map'].read_bytes(), evidence['bytes'])
        for case in result['cases']:
            self.assertEqual(case['status'], 'tested and failed')
            self.assertFalse(case['checks']['source_map'])
            self.assertTrue(case['checks']['source_lock'])
            self.assertFalse(case['checks']['independent_source_decoder'])
            self.assertNotIn('reference_hdr', case)
            self.assertIn('Extracted source gain map changed', case['blockers'])

    def test_four_native_recipes_keep_exact_endpoint_bytes_and_measurements(self):
        expected = {
            'contain': ('83ae811ce6a6c7e8bd0eba327d0ea5c1c4e7efeb11cd2f9b1ec5e17fa9c40a14',
                        'b6e8085429b3f19328f5768cd9bfee2e18f7c4ffe064d5372781b94f3d9feea6'),
            'cover': ('433bb087628c7d0e1b7b2a4a3035d86bc08a3a9919c8dfb5f4862e0fd42f0110',
                      '907921f4bf390245d3d8ba18883075173f3706a76364105fd90a0a9f0cc870b5'),
            'fill': ('5137e8b84c197b84f4bbfe82c38066d38dde2ac40774f8df670f8249667f8c8e',
                     'ecfd72e174382c97288a9143637eb937ba7076e50661d85695553cdcd46da9d7'),
            'orientation': ('f5b5ee0ab0b4ced63a4acd90ee37ab7ba44bfa939d5c46f6c1e568237f7f5c9b',
                            'd03a35710245b894be6b2bbcde12ac27f0da05e24f947770ae2018eea305b169'),
        }
        self.assertEqual(len(self.result['cases']), 12)
        self.assertEqual(len(self.result['converter_endpoints']), 4)
        for endpoint in self.result['converter_endpoints']:
            operation = endpoint['geometry']
            with self.subTest(operation=operation):
                self.assertEqual(endpoint['status'], 'qualified')
                self.assertEqual(endpoint['artifacts']['sha256'], expected[operation][0])
                self.assertEqual(avif.digest(endpoint['artifacts']['output']), expected[operation][0])
                self.assertEqual(hashlib.sha256(json.dumps(endpoint['measurements'], sort_keys=True).encode()).hexdigest(),
                                 expected[operation][1])
                self.assertEqual(hashlib.sha256(json.dumps(endpoint['checks'], sort_keys=True).encode()).hexdigest(),
                                 '73c08b56f01b3448a823e09b88f35aeb7b161688348cc4052a619eaacb9cb408')
                cases = [case for case in self.result['cases'] if case['geometry'] == operation]
                self.assertEqual({case['rendering_scope']['display_boost'] for case in cases}, {2, 16, 64})
                self.assertEqual({case['artifacts']['sha256'] for case in cases}, {expected[operation][0]})
                self.assertEqual(next(case for case in cases if case['rendering_scope']['display_boost'] == 16)['status'],
                                 'qualified')

    def test_actual_same_file_outcomes_keep_all_eight_appearance_failures(self):
        for case in self.result['cases']:
            boost = case['rendering_scope']['display_boost']
            with self.subTest(operation=case['geometry'], boost=boost):
                self.assertEqual(case['status'], 'qualified' if boost == 16 else 'tested and failed')
                self.assertEqual(case['blockers'], [] if boost == 16 else [f'Failed appearance check at display boost {boost}'])
                self.assertTrue(all(value for name, value in case['checks'].items() if name != 'appearance'))
                self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
                self.assertTrue(case['measurements']['independent_hdr_cross_decoder']['passed'])
                for name in ('reconstructed_hdr', 'independent_hdr'):
                    self.assertEqual(case['measurements'][name]['passed'], boost == 16)
                self.assertNotIn('display_boost', case['selectors'])
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertEqual(case['threshold_scope']['thresholds_sha256'],
                                 '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
                self.assertNotIn('hdr_intent', case)
                self.assertTrue(all(row['display_boost'] == 16 for row in case['consumer_decoder_diagnostics'].values()))

    def test_source_is_reconstructed_at_the_same_boost_before_exact_geometry(self):
        dimensions = {'contain': [173, 231], 'cover': [173, 173], 'fill': [173, 211], 'orientation': [173, 130]}
        revisions = {2: 'gainmap-iso-intermediate-boost2-v1', 16: 'gainmap-hdr-target-gamut-v1',
                     64: 'gainmap-iso-full-headroom-boost64-v1'}
        for case in self.result['cases']:
            boost, operation = case['rendering_scope']['display_boost'], case['geometry']
            with self.subTest(operation=operation, boost=boost):
                ref = case['reference_hdr']
                self.assertEqual(ref['dimensions'], dimensions[operation])
                self.assertEqual(ref['display_boost'], boost)
                self.assertEqual(avif.digest(ref['path']), ref['sha256'])
                self.assertEqual(case['source_reference_revision'], revisions[boost])
                self.assertEqual(case['source_decoder_evidence']['headroom_log2'], {2: 1, 16: 4, 64: 6}[boost])
                self.assertEqual(case['hdr_decoder_evidence']['native']['requested_display_boost'], boost)
                self.assertEqual(case['hdr_decoder_evidence']['independent']['headroom_log2'], {2: 1, 16: 4, 64: 6}[boost])
                self.assertEqual(case['source_decoder_evidence']['orientation'], 1)
                self.assertEqual(case['reference_method']['orientation'], 6 if operation == 'orientation' else 1)
                self.assertIn('before matched geometry', ref['purpose'])
                self.assertEqual(case['source_sha256'],
                                 'f33bd1aae8c72ded83b31e7e4e4649654ce7bb483a28bcaa4629a7999ff0f80e')
                if boost == 64:
                    self.assertTrue(case['checks']['full_headroom_weights'])
                    self.assertEqual(case['rendering_scope']['source_gain_map_weight'], 1)
                    self.assertEqual(case['rendering_scope']['output_gain_map_weight'], 1)
                if operation == 'orientation':
                    source = case['orientation_source']
                    self.assertEqual(source['orientation'], 6)
                    self.assertEqual(source['facts']['metadata']['IFD0:Orientation'], 6)
                    self.assertEqual(avif.digest(source['path']), source['sha256'])
                    self.assertNotEqual(source['sha256'], case['source_sha256'])
                else:
                    self.assertNotIn('orientation_source', case)

    def test_native_evidence_retains_qualifications_and_rendering_blockers_in_matrix(self):
        from matrix import build_matrix
        matrix = build_matrix(self.result['cases'])
        self.assertEqual(matrix['evidence_errors'], [])
        self.assertEqual(matrix['product_coverage']['qualified_count'], 4)
        rows = [row for cell in matrix['cells'] for row in cell['evidence']]
        self.assertEqual(sum(row['status'] == 'qualified' for row in rows), 4)
        self.assertEqual(sum(row['status'] == 'tested and failed' for row in rows), 8)
        renderings = matrix['rendering_coverage']
        tested = [row for row in renderings['requirements'] if row['tested_evidence']]
        self.assertEqual(len(tested), 8)
        self.assertTrue(all(row['status'] == 'tested and failed' for row in tested))
        joined = [row for row in renderings['same_file_requirements'] if row['tested_output_sha256']]
        self.assertEqual(len(joined), 4)
        self.assertTrue(all(row['status'] == 'tested and failed' and not row['qualified_output_sha256'] for row in joined))
        self.assertTrue(self.result['commands'])
        self.assertTrue(self.result['native_logs'])
        self.assertEqual(len(self.result['native_hashes']), 3)


if __name__ == '__main__':
    unittest.main()
