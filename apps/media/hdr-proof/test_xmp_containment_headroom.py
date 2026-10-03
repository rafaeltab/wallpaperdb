"""Actual XMP-source containment renderings retain the original endpoint."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import avif


class XmpContainmentHeadroomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import xmp_containment_headroom
        cls.module = xmp_containment_headroom
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_exact_old_endpoint_and_bytes_remain_separate_from_new_references(self):
        endpoint = self.result['converter_endpoint']['case']
        self.assertEqual(endpoint['status'], 'qualified')
        self.assertEqual(endpoint['artifacts']['sha256'],
            '50fcfb8f31c9da4fca968f608e3cb0e41cd672247b3d3f8fa9fc83de7e702517')
        expected = {'checks': '73c08b56f01b3448a823e09b88f35aeb7b161688348cc4052a619eaacb9cb408',
                    'facts': 'cff7fc33355104690db6666dbfb5282b5cd9e1c6577b68572b3cd27862069ea6',
                    'selectors': '849280a914b78242c0666796ce2bb2cdf52ea848fd724613bf3e7f3f8b3a1aba',
                    'measurements': '60a34d0ab745a4c1883151f55901b3105b002bdcf9c1fdc4cfd22cc9dc7112ec'}
        for name, digest in expected.items():
            self.assertEqual(hashlib.sha256(json.dumps(endpoint[name], sort_keys=True).encode()).hexdigest(), digest, name)
        cases = self.result['cases']
        self.assertEqual(len(cases), 2)
        self.assertEqual({case['rendering_scope']['display_boost'] for case in cases}, {2, 16})
        self.assertEqual({case['artifacts']['sha256'] for case in cases}, {endpoint['artifacts']['sha256']})
        self.assertEqual({case['source_reference_revision'] for case in cases},
            {'gainmap-xmp-intermediate-boost2-v1', 'gainmap-xmp-independent-boost16-v1'})
        self.assertTrue(all(case['checks']['independent_source_decoder'] for case in cases))
        self.assertEqual(self.result['source_renderer']['status'], 'qualified source renderer')

    def test_boost2_appearance_failure_is_visible_despite_reader_agreement(self):
        low, high = self.result['cases']
        self.assertEqual(low['status'], 'tested and failed')
        self.assertEqual(low['blockers'], ['Failed appearance check at display boost 2'])
        self.assertTrue(all(value for key, value in low['checks'].items() if key != 'appearance'))
        self.assertEqual(len(low['measurements']['independent_hdr']['failures']), 12)
        self.assertAlmostEqual(low['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'],
                               88.53405254259822, places=6)
        self.assertTrue(low['measurements']['independent_hdr_cross_decoder']['passed'])
        self.assertTrue(low['measurements']['authored_sdr_base']['passed'])
        self.assertEqual(high['status'], 'qualified', high['blockers'])
        self.assertTrue(all(high['checks'].values()))
        self.assertEqual(low['reference_hdr']['sha256'], '00d145e59c9c4fd41d7c5f208e070c6fa7f7238cf0fabbd6aacdc15c3de4549d')
        self.assertEqual(high['reference_hdr']['sha256'], '49de012fea5db47d820f0e45939ebbb4d29633cde8242c7cc054db851aa0abaa')

    def test_each_reference_reconstructs_source_before_geometry_at_the_requested_boost(self):
        for case in self.result['cases']:
            boost = case['rendering_scope']['display_boost']
            self.assertEqual(case['source_decoder_evidence']['headroom_log2'], 1 if boost == 2 else 4)
            self.assertEqual(case['reference_hdr']['display_boost'], boost)
            self.assertEqual(case['reference_hdr']['dimensions'], [173, 130])
            self.assertEqual(case['source_decoder_evidence']['sampling_revision'], 'xmp-libyuv-x86-point-bilinear8-v1')
            self.assertEqual(case['source_decoder_evidence']['base_color']['exif_colorspace'], 1)
            self.assertNotIn('display_boost', case['selectors'])
            self.assertNotIn('hdr_intent', case)
            self.assertIn('before target-gamut containment', case['reference_method']['order'])
            self.assertEqual(avif.digest(case['reference_hdr']['path']), case['reference_hdr']['sha256'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(all(value['display_boost'] == 16 for value in case['consumer_decoder_diagnostics'].values()))
        self.assertAlmostEqual(self.result['cases'][0]['rendering_scope']['source_gain_map_weight'], 2/7)
        self.assertAlmostEqual(self.result['cases'][0]['rendering_scope']['output_gain_map_weight'], .3606392740549769)

    def test_actual_matrix_keeps_independent_endpoint_and_failed_same_file_requirement(self):
        from matrix import build_matrix
        matrix = build_matrix(self.result['cases'])
        self.assertFalse(matrix['evidence_errors'])
        rows = {case['case_id']: case for cell in matrix['cells'] for case in cell['evidence']}
        self.assertEqual([rows[case['case_id']]['status'] for case in self.result['cases']], ['tested and failed', 'qualified'])
        joined = next(row for row in matrix['rendering_coverage']['same_file_requirements']
                      if row['fixture_id'] == 'gainmap-android-xmp' and row['geometry'] == 'contain')
        self.assertEqual(joined['status'], 'tested and failed')
        self.assertEqual(joined['qualified_output_sha256'], [])
        self.assertEqual(joined['tested_output_sha256'], [self.module.OUTPUT_SHA256])
        self.assertEqual([row['status'] for row in joined['points']], ['tested and failed', 'qualified'])
        self.assertFalse(matrix['milestone_qualified'])

    def test_undeclared_source_and_geometry_stop_before_native_work(self):
        for options in ({'source_id': 'gainmap-android-iso'}, {'operation': 'cover'}, {'operation': 'orientation'}):
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **options)
            self.assertEqual(len(avif.COMMANDS), start)

    def test_real_native_decode_cannot_qualify_after_extracted_map_changes(self):
        from unittest.mock import patch
        native = avif.native

        def mutate_after_real_decode(arguments, **options):
            result = native(arguments, **options)
            if len(arguments) > 3 and str(arguments[1]) == 'decode-linear':
                directory = Path(arguments[3]).parent
                if directory.name in ('boost2', 'boost16'):
                    path = directory/'inspection/map.jpg'
                    path.write_bytes(path.read_bytes()+b'changed map after native decode')
            return result

        with patch.object(avif, 'native', side_effect=mutate_after_real_decode):
            report = self.module.run(self.root/'changed-map')
        self.assertTrue(all(case['status'] == 'tested and failed' for case in report['cases']))
        self.assertTrue(all(any('gain map changed' in item for item in case['blockers']) for case in report['cases']))
        self.assertEqual(report['converter_endpoint']['case']['status'], 'qualified')
        self.assertTrue(all(avif.digest(case['artifacts']['output']) == self.module.OUTPUT_SHA256 for case in report['cases']))


class XmpGeometryHeadroomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import xmp_containment_headroom
        cls.module = xmp_containment_headroom
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof', geometries=('cover', 'fill', 'upscale', 'orientation'))

    def test_opt_in_geometries_keep_exact_native_files_and_independent_boosts(self):
        result = self.result
        self.assertEqual(len(result['cases']), 8)
        expected = {
                'cover': 'aed2f914ed445a66f2b70f08d8bb7d6f79d26d06296e1b580aed66011f6dc75e',
                'fill': 'c1e02b8b74c05d17d660d2834c947abba99348ecf01dc3bdad6bd92286933229',
                'upscale': 'a3a9191c6e6854b3cf5e982f9364d3448bb548ca7c85a2ba600e2cc411e51e53',
                'orientation': 'e9ca24d9fc94e33c16516423626a892b3fb9e3d719fc78fe1943d3b2ef2c2a96',
        }
        for operation, digest in expected.items():
            cases = [case for case in result['cases'] if case['geometry'] == operation]
            self.assertEqual(len(cases), 2)
            self.assertEqual({case['rendering_scope']['display_boost'] for case in cases}, {2, 16})
            self.assertEqual({case['artifacts']['sha256'] for case in cases}, {digest})
            self.assertEqual([case['status'] for case in cases], ['tested and failed', 'qualified'])
            self.assertEqual(cases[0]['blockers'], ['Failed appearance check at display boost 2'])
            self.assertTrue(all(value for key, value in cases[0]['checks'].items() if key != 'appearance'))
            self.assertTrue(all(cases[1]['checks'].values()))

    def test_each_boost_keeps_its_own_reference_and_measured_errors(self):
        expected = {
            'cover': ([173, 173], ('8852076d8d5ebf97cddf023caf06acc8d6fe8afb33c11efc004483b38163db26',
                                 'b670e8631afcbfacbd87a38b7a735d0af8c0256c36279e3fec19d16751b1ca99'), 81.43343623662018, 6.086112533740057),
            'fill': ([173, 211], ('19c1f77ab1fc409bfaada22477211fd364215954a39c9ac5d9a916f97ad1f9e9',
                                'c954d29cf766261a70f721269ce5c44c8abea3aec01f728cbf58334bd39e0599'), 90.21768570448246, 3.886404937623788),
            'upscale': ([769, 576], ('97fa9209284d1d031a881323d715c5a8a37d89d8c4d72b45834b0a4a1bfa80c0',
                                   'f150785fd3242969c801ae407c31d8827f192b620992685b537bb03fe32e725c'), 93.56703713159487, 6.926390192785285),
            'orientation': ([173, 231], ('0b80f2f6ae1ea4423073d0b2ec67210e914a4a1061c04a4c8ec376590a82fb0a',
                                       'a80d01eaf4c48949f37f88eace2374530649257382bd5b259842fd819d784c23'), 81.45474247964277, 5.95016406279426),
        }
        for operation, (dimensions, hashes, low_maximum, high_maximum) in expected.items():
            cases = [case for case in self.result['cases'] if case['geometry'] == operation]
            for index, case in enumerate(cases):
                self.assertEqual(case['reference_hdr']['dimensions'], dimensions)
                self.assertEqual(case['reference_hdr']['sha256'], hashes[index])
                self.assertEqual(avif.digest(case['reference_hdr']['path']), hashes[index])
                measurement = case['measurements']['independent_hdr']
                maximum = max(region['delta_e_itp']['maximum'] for region in measurement['regions'].values()
                              if 'delta_e_itp' in region)
                self.assertAlmostEqual(maximum, (low_maximum, high_maximum)[index], places=6)
                self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
                self.assertTrue(case['measurements']['independent_hdr_cross_decoder']['passed'])
                self.assertEqual(case['source_decoder_evidence']['headroom_log2'], (1, 4)[index])
                self.assertEqual(case['rendering_scope']['display_boost'], (2, 16)[index])
                self.assertNotIn('display_boost', case['selectors'])

    def test_real_exif_source_is_bound_while_canonical_reference_rotates_once(self):
        import numpy as np
        import gainmap_xmp
        from gainmap_reference import reference
        source = self.result['source_renderer']['source']
        for case in self.result['cases']:
            if case['geometry'] != 'orientation':
                self.assertNotIn('orientation_source', case)
                continue
            self.assertEqual(case['orientation_source']['orientation'], 6)
            self.assertEqual(case['orientation_source']['sha256'], self.module.ORIENTATION_SHA256)
            self.assertEqual(avif.digest(case['orientation_source']['path']), self.module.ORIENTATION_SHA256)
            self.assertTrue(case['orientation_correspondence']['original_coded_samples_equal'])
            self.assertEqual(case['orientation_correspondence']['gain_map_sha256'], gainmap_xmp.MAP_SHA256)
            self.assertEqual(case['reference_method']['orientation'], 6)
            decoded = gainmap_xmp.decode_xmp_source(Path(source['path']).read_bytes(),
                Path(source['evidence']['map_path']).read_bytes(), headroom=case['rendering_scope']['headroom_log2'])
            # Explicit clockwise rotation of original identity pixels, then ordinary
            # containment, independently verifies the declared EXIF6 reference order.
            expected, _ = reference(np.rot90(decoded['linear_rgb_nits'], -1), 'srgb', 'srgb', 'contain')
            actual = np.fromfile(case['reference_hdr']['path'], '<f8').reshape(231, 173, 3)
            self.assertTrue(np.array_equal(actual, expected))

    def test_actual_matrix_preserves_all_four_failed_same_file_requirements(self):
        from matrix import build_matrix
        matrix = build_matrix(self.result['cases'])
        self.assertFalse(matrix['evidence_errors'])
        rows = [row for row in matrix['rendering_coverage']['same_file_requirements']
                if row['fixture_id'] == 'gainmap-android-xmp' and row['geometry'] != 'contain']
        self.assertEqual(len(rows), 4)
        for row in rows:
            self.assertEqual(row['status'], 'tested and failed')
            self.assertEqual(row['qualified_output_sha256'], [])
            self.assertEqual(row['tested_output_sha256'], [self.module.OUTPUTS[row['geometry']]])
            self.assertEqual([point['status'] for point in row['points']], ['tested and failed', 'qualified'])

    def test_only_bounded_unique_geometry_tuples_are_admitted_before_native_work(self):
        for geometries in ((), ('crop',), ('fill', 'fill'), ['contain'], ('contain', []), (None,)):
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', geometries=geometries)
            self.assertEqual(len(avif.COMMANDS), start)


if __name__ == '__main__':
    unittest.main()
