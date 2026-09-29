"""One corrected old Apple containment keeps the documented source model."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif
import apple_source_model
from gamma_icc import make_profile
from matrix import build_matrix


class AppleHdrJpegTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_jpeg
        cls.module = apple_hdr_jpeg
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')
        cls.case = cls.report['cases'][0]

    def test_documented_full_source_and_both_native_endpoints_have_separate_gates(self):
        case = self.case
        self.assertEqual(case['source_reference_revision'], apple_source_model.REFERENCE_REVISION)
        self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
        for name in ('native_source_precision', 'native_geometry', 'hdr_intent', 'structure', 'privacy', 'full_headroom'):
            self.assertTrue(case['checks'][name], (name, case['blockers']))
        for name in ('authored_sdr_base', 'reconstructed_hdr', 'independent_hdr', 'independent_hdr_cross_decoder'):
            self.assertIn(name, case['measurements'])
        self.assertEqual(case['measurements']['authored_sdr_base'],
                         self.report['converter_control']['cases'][0]['measurements']['authored_sdr_base'])
        self.assertEqual(case['rendering_scope']['display_boost'], 16)
        self.assertEqual(case['rendering_scope']['source_full_headroom'], 8)
        self.assertEqual(case['rendering_scope']['source_gain_map_weight'], 1)
        self.assertEqual(case['rendering_scope']['output_gain_map_weight'], 1)
        self.assertEqual(case['hdr_decoder_evidence']['independent']['display_boost'], 16)
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertIn('boost 16', case['qualification_scope'])
        self.assertTrue(case['known_consumer_limitations'])
        self.assertEqual(len(self.report['native_source_preparation']['legacy_diagnostic']['documented_full_model']['measurement']['failures']), 6)
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertEqual(case['artifacts']['sha256'], '2d8a2db64b65c2a377fd62a94edaa447259164cf2f7cfb1747bd3bb5bd27b010')
        self.assertEqual(self.report['converter_control']['cases'][0]['artifacts']['sha256'],
                         '067ffe32fe8c5f99b9ac1152faa414c5c557f56c8b2457fe692fb66b7c24f3a3')
        self.assertEqual(case['reference_hdr']['sha256'], 'e35748a2624ddc61cd57d7f7e4b3796bc4a5d503f4a32484e33a2d19aa53253a')
        self.assertAlmostEqual(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], 4.528920608332129, places=8)
        self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_actual_file_depth_geometry_icc_metadata_and_refs_are_bound(self):
        case = self.case
        self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
        self.assertNotEqual(case['artifacts']['sha256'],
                            self.report['converter_control']['cases'][0]['artifacts']['sha256'])
        for layer in ('base', 'map'):
            self.assertEqual(case['facts'][layer], {'depth': 8, 'width': 173, 'height': 231, 'components': 3, 'sof': 0})
        self.assertEqual(case['hdr_intent']['color']['primaries'], 12)
        self.assertEqual(case['hdr_intent']['color']['transfer'], 16)
        self.assertTrue(case['hdr_intent']['square_pixels'])
        self.assertEqual(case['sdr_decoder_evidence']['gamut'], 'p3')
        self.assertTrue(all(case['gain_map_metadata_agreement']['checks'].values()))
        for name in ('reference_hdr', 'reference_sdr'):
            self.assertEqual(avif.digest(case[name]['path']), case[name]['sha256'])

    def test_exact_selectors_and_known_source_are_required_before_native_work(self):
        for field, value in (('format', 'png'), ('range', 'sdr'), ('gamut', 'srgb'),
                             ('depth', '12'), ('fit', 'cover'), ('w', 174), ('motion', 'static')):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', selectors={**self.module.SELECTORS, field: value})
            self.assertEqual(len(avif.COMMANDS), before)
        unknown = self.root/'unknown.jpg'
        unknown.write_bytes(apple_source_model.SOURCE.read_bytes()+b'unknown source')
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'unknown', source=unknown)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_actual_jpeg_orientation_and_private_metadata_reject(self):
        for name, tag in (('orientation', '-Orientation#=6'), ('privacy', '-Artist=private proof control')):
            changed = self.root/(name+'.jpg')
            changed.write_bytes(Path(self.case['artifacts']['output']).read_bytes())
            avif.native(['exiftool', '-overwrite_original', tag, changed])
            with self.assertRaises(ValueError):
                self.module.inspect_output(changed, self.root/(name+'-inspection'))

    def test_actual_wrong_icc_and_conflicting_gain_metadata_reject(self):
        profile = self.root/'wrong-gamma.icc'
        profile.write_bytes(make_profile(gamma=2.2, gamut='p3'))
        changed = self.root/'wrong-icc.jpg'
        data = Path(self.case['artifacts']['output']).read_bytes()
        changed.write_bytes(data)
        avif.native(['exiftool', '-overwrite_original', f'-ICC_Profile<={profile}', changed])
        with self.assertRaises(ValueError):
            self.module.inspect_output(changed, self.root/'wrong-icc-inspection')
        self.assertEqual(data.count(b'<rdf:li>1.5</rdf:li>'), 3)
        changed = self.root/'wrong-gain.jpg'
        changed.write_bytes(data.replace(b'<rdf:li>1.5</rdf:li>', b'<rdf:li>2.5</rdf:li>', 1))
        with self.assertRaises(ValueError):
            self.module.inspect_output(changed, self.root/'wrong-gain-inspection')

    def test_native_result_enters_matrix_without_inheriting_adaptation_qualification(self):
        result = build_matrix(self.report['cases'])
        self.assertEqual(result['evidence_errors'], [])
        cell = next(row for row in result['cells'] if row['id'] == 'gainmap-jpeg:hdr:jpg')
        self.assertEqual([(row['case_id'], row['status']) for row in cell['evidence']],
                         [(self.case['case_id'], 'qualified')])
        self.assertNotIn('display_boost', self.case['selectors'])
        self.assertEqual(self.case['rendering_scope']['source_reference_revision'], apple_source_model.REFERENCE_REVISION)

    def test_wrong_native_normalization_or_gamut_rejects_before_pq_encoding(self):
        for changes in ({'normalization_nits': 10000}, {'gamut': 'rec2020'}, {'width': 174}, {'format': 'gbrpf32le'}):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module._intent({**self.case['native_geometry'], **changes}, self.root/'rejected.png')
            self.assertEqual(len(avif.COMMANDS), before)

    def test_actual_native_png_with_wrong_components_gamut_or_aspect_rejects(self):
        source = self.case['hdr_intent']['path']
        variants = [('rgba', ['-pix_fmt', 'rgba64be']),
                    ('gamut', ['-vf', 'setparams=color_primaries=1:color_trc=16:colorspace=0:range=full']),
                    ('aspect', ['-vf', 'setsar=2'])]
        for name, arguments in variants:
            changed = self.root/(name+'.png')
            avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, *arguments,
                         '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', changed])
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.module.inspect_intent(changed, self.root/(name+'-png-inspection'))

    def test_changed_extracted_output_map_after_actual_decoder_cannot_qualify(self):
        real_decode = self.module.icc_gainmap.independent_decode

        def decode_then_alter(path, map_path, **kwargs):
            result = real_decode(path, map_path, **kwargs)
            map_path = Path(map_path)
            map_path.write_bytes(map_path.read_bytes()+b'late extracted-map drift')
            return result

        with patch.object(self.module.icc_gainmap, 'independent_decode', side_effect=decode_then_alter):
            report = self.module.run(self.root/'map-drift')
        self.assertEqual(report['cases'][0]['status'], 'tested and failed')
        self.assertTrue(any('integrity' in value for value in report['cases'][0]['blockers']))

    def test_admitted_source_copy_remains_bound_after_actual_native_preparation(self):
        source = self.root/'admitted-copy.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes())
        real_prepare = self.module.apple_native_source.run

        def prepare_then_alter(directory):
            result = real_prepare(directory)
            source.write_bytes(source.read_bytes()+b'caller copy changed during native preparation')
            return result

        with patch.object(self.module.apple_native_source, 'run', side_effect=prepare_then_alter):
            report = self.module.run(self.root/'source-copy-drift', source=source)
        case = report['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(any('integrity' in value for value in case['blockers']))
        self.assertEqual(case['artifacts']['source_sha256'], apple_source_model.SOURCE_SHA256)


class AppleHdrJpegGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_jpeg
        cls.module = apple_hdr_jpeg
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof', geometries=('contain', 'cover', 'fill', 'upscale'))

    def test_four_geometries_keep_separate_actual_depth_dimensions_selectors_and_measurements(self):
        cases = self.report['cases']
        self.assertEqual([case['geometry'] for case in cases], ['contain', 'cover', 'fill', 'upscale'])
        self.assertEqual(len({case['case_id'] for case in cases}), 4)
        expected_hashes = {'contain': '2d8a2db64b65c2a377fd62a94edaa447259164cf2f7cfb1747bd3bb5bd27b010',
            'cover': '85a4381a362af0e35d9aafc16e53fba7ff32cc9b4f7d3022eec3831957690049',
            'fill': 'f27b9f13c3a7b2078ca2a9867d67d28653c0dbe7621b2796885582c46989ac87',
            'upscale': 'b89920e58f380b371099299480690292b71a64a855e61547e6e26726a6b6d94e'}
        for case in cases:
            with self.subTest(geometry=case['geometry']):
                size = self.module.SIZES[case['geometry']]
                for layer in ('base', 'map'):
                    self.assertEqual((case['facts'][layer]['width'], case['facts'][layer]['height']), size)
                    self.assertEqual(case['facts'][layer]['depth'], 8)
                self.assertEqual(case['selectors'], self.module._selectors(case['geometry']))
                self.assertEqual(case['source_reference_revision'], apple_source_model.REFERENCE_REVISION)
                self.assertEqual(case['rendering_scope']['display_boost'], 16)
                self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertEqual(case['artifacts']['sha256'], expected_hashes[case['geometry']])
                for name in ('native_source_precision', 'native_geometry', 'hdr_intent', 'structure', 'privacy', 'full_headroom', 'integrity'):
                    self.assertTrue(case['checks'][name], (name, case['blockers']))
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
                self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
        matrix = build_matrix(cases)
        self.assertEqual(matrix['evidence_errors'], [])
        rows = next(cell for cell in matrix['cells'] if cell['id'] == 'gainmap-jpeg:hdr:jpg')['evidence']
        self.assertEqual([(row['case_id'], row['status']) for row in rows],
                         [(row['case_id'], row['status']) for row in cases])

    def test_containment_bytes_facts_checks_and_measurements_match_default(self):
        baseline = self.module.run(self.root/'default')['cases'][0]
        contained = self.report['cases'][0]
        for key in ('case_id', 'candidate', 'selectors', 'facts', 'checks', 'measurements',
                    'threshold_scope', 'rendering_scope', 'qualification_scope', 'known_consumer_limitations'):
            self.assertEqual(contained[key], baseline[key], key)
        self.assertEqual(contained['artifacts']['sha256'], '2d8a2db64b65c2a377fd62a94edaa447259164cf2f7cfb1747bd3bb5bd27b010')
        self.assertEqual(contained['reference_hdr']['sha256'], baseline['reference_hdr']['sha256'])
        self.assertEqual(contained['reference_sdr']['sha256'], baseline['reference_sdr']['sha256'])

    def test_unproved_geometry_and_ambiguous_selector_lists_stop_before_native_work(self):
        for geometries in ((), ('contain', 'contain'), ('orientation',), ('crop',), ('identity',)):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', geometries=geometries)
            self.assertEqual(len(avif.COMMANDS), before)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'ambiguous', geometries=('contain', 'cover'), selectors=self.module.SELECTORS)


if __name__ == '__main__':
    unittest.main()
