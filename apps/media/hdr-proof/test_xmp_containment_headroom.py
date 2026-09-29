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


if __name__ == '__main__':
    unittest.main()
