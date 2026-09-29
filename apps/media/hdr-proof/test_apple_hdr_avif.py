"""Explicit PQ12 output must retain the documented old Apple full image."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif
import apple_source_model


class AppleHdrAvifTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_avif
        cls.module = apple_hdr_avif
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')
        cls.case = cls.report['cases'][0]

    def test_actual_native_avif_has_independent_source_and_output_gates(self):
        case = self.case
        self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertEqual(case['source_reference_revision'], apple_source_model.REFERENCE_REVISION)
        self.assertTrue(all(case['structural_checks'].values()), case['blockers'])
        for name in ('native_source', 'native_geometry', 'native_intent', 'hdr'):
            self.assertIn(name, case['measurements'])
        self.assertEqual(case['facts']['depth'], 12)
        self.assertEqual((case['facts']['primaries'], case['facts']['transfer'], case['facts']['matrix']), (12, 16, 0))
        self.assertEqual(case['facts']['alpha'], 'Absent')
        self.assertEqual(case['output_packet_facts']['streams'][0]['pix_fmt'], 'gbrp12le')
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
        self.assertEqual(case['selectors']['depth'], '12')
        self.assertEqual(case['artifacts']['sha256'], '0df05ebcaec55271c6ba09724f3cf55339c6859d55ea6441468dfd9cc400e9be')
        self.assertAlmostEqual(case['measurements']['hdr']['regions']['shadow']['delta_e_itp']['maximum'],
                               .3509343723855521, places=9)
        self.assertEqual(json.loads((self.root/'proof/results.json').read_text()), self.report)

    def test_reference_and_emitted_files_remain_bound(self):
        for path, digest in self.case['bound_files'].items():
            self.assertEqual(avif.digest(path), digest)
        for name, digest in self.report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).parent/name), digest)
        self.assertEqual(avif.digest(self.case['artifacts']['output']), self.case['artifacts']['sha256'])
        self.assertEqual(self.case['reference_hdr']['dimensions'], [173, 231])

    def test_unsupported_selectors_and_unknown_source_reject_before_native_work(self):
        for key, value in (('depth', 'preserve'), ('depth', '8'), ('format', 'jpg'), ('range', 'sdr'),
                           ('gamut', 'rec2020'), ('w', 174), ('motion', 'static'), ('fit', 'cover')):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', selectors={**self.module.SELECTORS, key: value})
            self.assertEqual(len(avif.COMMANDS), before)
        source = self.root/'unknown.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes()+b'unknown source facts')
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'unknown', source=source)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_changed_output_after_real_dav1d_decode_cannot_qualify(self):
        original = self.module.avif.decode_avif
        def decode_then_change(path, *args, **kwargs):
            actual = original(path, *args, **kwargs)
            with Path(path).open('ab') as stream:
                stream.write(b'late output drift')
            return actual
        with patch.object(self.module.avif, 'decode_avif', side_effect=decode_then_change):
            case = self.module.run(self.root/'changed')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_actual_case_enters_only_its_explicit_conversion_cell(self):
        from matrix import build_matrix
        matrix = build_matrix([self.case])
        self.assertEqual(matrix['evidence_errors'], [])
        self.assertFalse(matrix['milestone_qualified'])
        self.assertEqual(matrix['rendering_coverage']['same_file_qualified_count'], 0)

    def test_admitted_source_copy_remains_bound_through_real_native_preparation(self):
        source = self.root/'admitted-source.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes())
        original = self.module.apple_native_source.run
        def prepare_then_change(*args, **kwargs):
            actual = original(*args, **kwargs)
            with source.open('ab') as stream:
                stream.write(b'late source drift')
            return actual
        with patch.object(self.module.apple_native_source, 'run', side_effect=prepare_then_change):
            case = self.module.run(self.root/'changed-source', source=source)['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_actual_private_metadata_added_to_real_encoded_avif_is_rejected(self):
        original = self.module._encode
        def encode_then_add_private(*args, **kwargs):
            actual = original(*args, **kwargs)
            avif.native(['exiftool', '-overwrite_original', '-Artist=private proof control', actual[0]])
            return actual
        with patch.object(self.module, '_encode', side_effect=encode_then_add_private):
            case = self.module.run(self.root/'private')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['privacy'])
        self.assertTrue(case['privacy_measurement']['private_tags'])

    def test_unknown_float_normalization_gamut_or_geometry_rejects_before_encoding(self):
        for field, value in (('normalization_nits', 100), ('gamut', 'srgb'), ('format', 'rgb24'), ('width', 174)):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module._encode({**self.case['native_geometry'], field: value}, self.root/'bad-intent')
            self.assertEqual(len(avif.COMMANDS), before)

    def test_explicit_depth_and_geometry_matrix_preserves_containment12(self):
        report = self.module.run(self.root/'expanded', depths=(12, 10),
                                 geometries=('contain', 'cover', 'fill', 'upscale'))
        self.assertEqual(len(report['cases']), 8)
        self.assertEqual(len({case['case_id'] for case in report['cases']}), 8)
        sizes = {'contain': (173, 231), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 1025)}
        output_hashes = {
            (12, 'contain'): '0df05ebcaec55271c6ba09724f3cf55339c6859d55ea6441468dfd9cc400e9be',
            (12, 'cover'): '1ba4744cb41e5041543745f40ec2a7115ad0e7cd9460803420462bc827bb51dd',
            (12, 'fill'): '4dcebfdebd655e690207fef515b879e3b1c4dd33d2e1984a5007f40f906ea274',
            (12, 'upscale'): 'b9c3a115a4dd9bddeb664310aa1d548f60b0560e739c3c74ecfd11cb46b175c9',
            (10, 'contain'): '76ac61a5f83de9e8f70555d50ffb270a2ea2a7a84667dcc04cba7e36bd7eefb8',
            (10, 'cover'): '0b58c98184b52e8c22496f60ef57365ccace174a3df11d8eb91a1a20148fba5d',
            (10, 'fill'): 'e8fd4d64e651dbc7f5fb63e47638c3d8be7b8a6e3dc3131d9abb38baf85e576d',
            (10, 'upscale'): 'e62ae256df08591ca5f3b9b092536e908e6d1346921889c70ee5b58a433d08c9'}
        for case in report['cases']:
            depth, operation = int(case['selectors']['depth']), case['geometry']
            with self.subTest(depth=depth, geometry=operation):
                self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertEqual(case['artifacts']['sha256'], output_hashes[(depth, operation)])
                self.assertTrue(case['checks']['structure'], case['blockers'])
                self.assertTrue(case['checks']['integrity'], case['blockers'])
                self.assertEqual(case['facts']['depth'], depth)
                self.assertEqual(case['reference_hdr']['dimensions'], list(sizes[operation]))
                self.assertEqual(case['output_packet_facts']['streams'][0]['pix_fmt'], f'gbrp{depth}le')
                self.assertEqual(case['threshold_scope']['profile'], 'gainmap-hdr')
                self.assertEqual(case['threshold_scope']['source_quantization_allowance'], 0)
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
        retained = next(case for case in report['cases'] if case['case_id'] == self.case['case_id'])
        for key in ('case_id', 'selectors', 'status', 'checks', 'measurements', 'threshold_scope',
                    'rendering_scope', 'qualification_scope', 'known_consumer_limitations'):
            self.assertEqual(retained[key], self.case[key], key)
        # avifdec's diagnostic includes the absolute artifact path, which
        # changes between these independent native runs; all content is kept.
        def stable_facts(case):
            return {**case['facts'], 'info': case['facts']['info'].replace(case['artifacts']['output'], '<output>')}
        self.assertEqual(stable_facts(retained), stable_facts(self.case))
        self.assertEqual(retained['artifacts']['sha256'], self.case['artifacts']['sha256'])
        self.assertEqual(retained['reference_hdr']['sha256'], self.case['reference_hdr']['sha256'])
        from matrix import build_matrix
        matrix = build_matrix(report['cases'])
        self.assertEqual(matrix['evidence_errors'], [])
        self.assertEqual(matrix['rendering_coverage']['same_file_qualified_count'], 0)

    def test_unproved_depth_geometry_and_mismatched_selector_tuples_reject_before_native_work(self):
        options = ({'depths': ()}, {'depths': (16,)}, {'depths': (10, 10)}, {'depths': (True,)},
                   {'depths': ('10',)}, {'depths': ([10],)}, {'geometries': ()},
                   {'geometries': ('contain', 'contain')}, {'geometries': ('orientation-8',)},
                   {'geometries': ('crop',)}, {'geometries': (['contain'],)},
                   {'depths': (10,), 'selectors': dict(self.module.SELECTORS)},
                   {'geometries': ('cover',), 'selectors': dict(self.module.SELECTORS)},
                   {'depths': (12, 10), 'selectors': dict(self.module.SELECTORS)})
        for kwargs in options:
            with self.subTest(options=kwargs):
                before = len(avif.COMMANDS)
                with self.assertRaises(ValueError):
                    self.module.run(self.root/'unsupported-tuples', **kwargs)
                self.assertEqual(len(avif.COMMANDS), before)
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module._encode(self.case['native_geometry'], self.root/'wrong-geometry', operation='cover')
        self.assertEqual(len(avif.COMMANDS), before)

    def test_explicit8_bit_paths_use_the_unchanged_photographic_gates(self):
        report = self.module.run(self.root/'eight-bit', depths=(8,),
                                 geometries=('contain', 'cover', 'fill', 'upscale'))
        self.assertEqual(len(report['cases']), 4)
        for case in report['cases']:
            with self.subTest(geometry=case['geometry']):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertTrue(all(case['structural_checks'].values()))
                self.assertEqual(case['facts']['depth'], 8)
                self.assertEqual(case['output_packet_facts']['streams'][0]['pix_fmt'], 'gbrp')
                self.assertEqual(case['selectors']['depth'], '8')
                self.assertEqual(case['threshold_scope']['profile'], 'gainmap-hdr')
                self.assertEqual(case['threshold_scope']['source_quantization_allowance'], 0)
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
                self.assertEqual(case['consumer_status'], 'pending manual review')
        from matrix import build_matrix
        self.assertEqual(build_matrix(report['cases'])['evidence_errors'], [])

    def test_real_exif6_derivatives_at_each_depth_rotate_the_documented_source_once(self):
        import numpy as np
        from PIL import Image
        report = self.module.run(self.root/'orientation', depths=(8,10,12), geometries=('orientation',))
        self.assertEqual(len(report['cases']), 3)
        for case in report['cases']:
            with self.subTest(depth=case['selectors']['depth']):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertEqual(case['orientation_source']['orientation'], 6)
                self.assertEqual(case['orientation_source']['sha256'],
                                 '691ce29e25ba756cf0d9d2a4e498fcb4f246eaa0fd7046b15fb10f38b58053c9')
                self.assertEqual(case['artifacts']['source_sha256'], case['orientation_source']['sha256'])
                self.assertEqual(case['artifacts']['source'], case['orientation_source']['path'])
                self.assertEqual(case['source_facts']['metadata']['IFD0:Orientation'], 6)
                self.assertFalse(case['source_decoder_evidence']['native_source']['orientation_applied'])
                self.assertEqual(case['native_geometry']['padding_filter'].count('transpose=clock'), 1)
                original = np.load(case['source_decoder_evidence']['reference']['path'])
                rotated = np.rot90(original, -1)
                expected = np.maximum(np.stack([np.asarray(Image.fromarray(rotated[..., channel].astype(np.float32)).resize(
                    (173,130), Image.Resampling.LANCZOS)) for channel in range(3)],axis=-1),0)
                self.assertTrue(np.array_equal(np.load(case['reference_hdr']['path']),expected))
                self.assertEqual(case['reference_hdr']['dimensions'], [173,130])
                self.assertEqual(case['rendering_scope']['orientation_applications'], 1)
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
                self.assertTrue(case['structural_checks']['orientation_baked'])
                self.assertIn('Transformations: None', case['facts']['info'])
                self.assertEqual(case['facts']['exiftool'].get('Orientation', 1), 1)
        from matrix import build_matrix
        self.assertEqual(build_matrix(report['cases'])['evidence_errors'], [])

    def test_real_generated_orientation_change_stops_before_native_pixel_preparation(self):
        original = self.module.apple_orientation_source.generate
        boundary = []
        def generate_then_change(directory, **kwargs):
            source = original(directory, **kwargs)
            avif.native(['exiftool', '-overwrite_original', '-Orientation#=8', source])
            boundary.append(len(avif.COMMANDS))
            return source
        with patch.object(self.module.apple_orientation_source, 'generate', side_effect=generate_then_change):
            case = self.module.run(self.root/'changed-orientation', geometries=('orientation',))['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['native_encoder'])
        self.assertTrue(any('Generated EXIF6 source changed' in value for value in case['blockers']))
        self.assertEqual(len(avif.COMMANDS), boundary[0])

    def test_actual_oriented_source_is_hash_bound_through_native_decode(self):
        original = self.module.apple_orientation_source.run
        def prepare_then_change(directory, **kwargs):
            result = original(directory, **kwargs)
            source = Path(result['orientation_source']['path'])
            source.write_bytes(source.read_bytes()+b'late oriented source drift')
            return result
        with patch.object(self.module.apple_orientation_source, 'run', side_effect=prepare_then_change):
            case = self.module.run(self.root/'source-orientation-drift', geometries=('orientation',))['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['integrity'])
        self.assertTrue(any('integrity' in value for value in case['blockers']))
        self.assertEqual(case['artifacts']['source_sha256'], self.module.apple_orientation_source.SOURCE_SHA256)


class AppleHdrAvifRec2020Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_avif
        cls.module = apple_hdr_avif
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'rec2020', gamut='rec2020', depths=(12, 10, 8))

    def test_native_rec2020_containment_retains_the_original_p3_reference_and_gates(self):
        outputs = {12: '1b801104d13fdaca83e847b2464acd9541a5af1444a5a6b576f4b04ac5eff011',
                   10: 'dc01444fdf689123f292586df43349eb136aa2ede86d3d3b79295c041d3cb35a',
                   8: '7b8cdc2b28520fdf994b1a58cf276f20a22ed3193e2a37d5a75ee5a855f1b942'}
        self.assertEqual(len(self.report['cases']), 3)
        for case in self.report['cases']:
            depth = int(case['selectors']['depth'])
            with self.subTest(depth=depth):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertTrue(all(case['structural_checks'].values()))
                self.assertEqual(case['selectors']['gamut'], 'rec2020')
                self.assertIn(':rec2020:', case['case_id'])
                self.assertEqual(case['artifacts']['sha256'], outputs[depth])
                self.assertEqual((case['facts']['primaries'], case['facts']['transfer'], case['facts']['matrix']), (9,16,0))
                self.assertEqual(case['facts']['depth'], depth)
                self.assertEqual(case['output_packet_facts']['streams'][0]['color_primaries'], 'bt2020')
                self.assertEqual(case['hdr_intent']['facts']['primaries'], 9)
                self.assertEqual(case['reference_hdr']['gamut'], 'p3')
                self.assertEqual(case['reference_hdr']['sha256'], 'e35748a2624ddc61cd57d7f7e4b3796bc4a5d503f4a32484e33a2d19aa53253a')
                self.assertEqual(case['native_geometry']['gamut'], 'p3')
                self.assertEqual(case['native_geometry']['output_sha256'], '353d025843645deb4f36680f9229f72b42e9050d098df9eeb3e8dafc96676822')
                self.assertEqual(case['threshold_scope']['profile'], 'gainmap-hdr')
                self.assertEqual(case['threshold_scope']['source_quantization_allowance'], 0)
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
                for path, sha in case['bound_files'].items():
                    self.assertEqual(avif.digest(path), sha)
        from matrix import build_matrix
        matrix = build_matrix(self.report['cases'])
        self.assertEqual(matrix['evidence_errors'], [])
        self.assertEqual(matrix['rendering_coverage']['same_file_qualified_count'], 0)

    def test_unproved_gamut_geometry_and_selector_combinations_reject_before_native_work(self):
        options = ({'gamut': 'p3'}, {'gamut': 'srgb'}, {'gamut': ['rec2020']},
                   {'gamut': 'rec2020', 'geometries': ('cover',)},
                   {'gamut': 'rec2020', 'geometries': ('orientation',)},
                   {'gamut': 'rec2020', 'selectors': dict(self.module.SELECTORS)})
        for kwargs in options:
            before = len(avif.COMMANDS)
            with self.subTest(options=kwargs), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **kwargs)
            self.assertEqual(len(avif.COMMANDS), before)

    def test_actual_p3_file_cannot_satisfy_explicit_rec2020_signaling(self):
        original = self.module._encode
        def encode_other_primaries(*args, **kwargs):
            return original(*args, **{**kwargs, 'gamut': 'preserve'})
        with patch.object(self.module, '_encode', side_effect=encode_other_primaries):
            case = self.module.run(self.root/'wrong-output-gamut', gamut='rec2020')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['structure'])
        self.assertEqual(case['facts']['primaries'], 12)

    def test_rec2020_actual_native_intent_drift_cannot_qualify(self):
        original = self.module.avif.decode_avif
        def decode_then_change(path, *args, **kwargs):
            pixels = original(path, *args, **kwargs)
            intent = Path(path).with_name('native-intent-pq.png')
            intent.write_bytes(intent.read_bytes()+b'late native intent drift')
            return pixels
        with patch.object(self.module.avif, 'decode_avif', side_effect=decode_then_change):
            case = self.module.run(self.root/'changed-intent', gamut='rec2020')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['integrity'])
        self.assertTrue(any('integrity' in message for message in case['blockers']))


if __name__ == '__main__':
    unittest.main()
