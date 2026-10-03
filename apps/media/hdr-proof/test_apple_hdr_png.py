"""A native PQ16 PNG must preserve the independently documented Apple image."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif
import apple_source_model


class AppleHdrPngTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_png
        cls.module = apple_hdr_png
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')
        cls.case = cls.report['cases'][0]

    def test_real_png_passes_separate_source_geometry_storage_and_hdr_gates(self):
        case = self.case
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['selectors']['depth'], '16')
        self.assertEqual(case['source_reference_revision'], apple_source_model.REFERENCE_REVISION)
        self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
        facts = case['facts']
        self.assertEqual((facts['width'], facts['height'], facts['depth'], facts['color_type']), (173, 231, 16, 2))
        self.assertEqual((facts['primaries'], facts['transfer'], facts['matrix']), (12, 16, 0))
        self.assertEqual(facts['physical_pixel_dimensions'], [1, 1, 0])
        self.assertTrue(facts['native_decoders_agree'])
        self.assertEqual(facts['orientation'], 1)
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertEqual(case['artifacts']['sha256'], '6a80e8d0e95d9ef35c3ec4958a43e4e098ff115cf51006b9075cd424005e3b5c')
        self.assertAlmostEqual(case['measurements']['hdr']['regions']['shadow']['delta_e_itp']['maximum'],
                               .258408766702518, places=9)
        for name in ('native_source', 'native_geometry', 'hdr'):
            self.assertTrue(case['measurements'][name]['passed'])

    def test_bound_artifacts_and_source_code_match(self):
        for path, sha in self.case['bound_files'].items():
            self.assertEqual(avif.digest(path), sha)
        for name, sha in self.report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).parent/name), sha)
        self.assertEqual(avif.digest(self.case['artifacts']['output']), self.case['artifacts']['sha256'])

    def test_unknown_selectors_or_source_are_original_only_before_native_work(self):
        for key, value in (('depth', '12'), ('depth', 'preserve'), ('format', 'avif'), ('range', 'sdr'),
                           ('gamut', 'rec2020'), ('fit', 'cover'), ('w', 174), ('motion', 'animated')):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', selectors={**self.module.SELECTORS, key: value})
            self.assertEqual(len(avif.COMMANDS), before)
        source = self.root/'unknown.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes()+b'unknown facts')
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'unknown', source=source)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_real_private_oriented_and_wrong_aspect_pngs_reject(self):
        source = self.case['artifacts']['output']
        for name, arguments in (
                ('private', ['exiftool', '-overwrite_original', '-Artist=private proof control']),
                ('oriented', ['exiftool', '-overwrite_original', '-Orientation#=6'])):
            path = self.root/(name+'.png')
            path.write_bytes(Path(source).read_bytes())
            avif.native([*arguments, path])
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.module.inspect_output(path)
        path = self.root/'aspect.png'
        avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', 'setsar=2',
                     '-frames:v', '1', '-threads', '1', path])
        with self.assertRaises(ValueError):
            self.module.inspect_output(path)

    def test_output_mutation_after_actual_independent_decode_cannot_qualify(self):
        original = self.module.inspect_output
        def decode_then_change(path):
            result = original(path)
            with Path(path).open('ab') as stream:
                stream.write(b'late output drift')
            return result
        with patch.object(self.module, 'inspect_output', side_effect=decode_then_change):
            case = self.module.run(self.root/'changed')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_native_float_admission_checks_normalization_format_gamut_and_geometry(self):
        for field, value in (('normalization_nits', 100), ('format', 'rgb24'), ('gamut', 'srgb'), ('width', 174)):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.encode({**self.case['native_geometry'], field: value}, self.root/'rejected.png')
            self.assertEqual(len(avif.COMMANDS), before)

    def test_admitted_source_copy_remains_bound_through_native_preparation(self):
        source = self.root/'admitted-copy.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes())
        original = self.module.apple_native_source.run
        def prepare_then_change(*args, **kwargs):
            result = original(*args, **kwargs)
            with source.open('ab') as stream:
                stream.write(b'late source drift')
            return result
        with patch.object(self.module.apple_native_source, 'run', side_effect=prepare_then_change):
            case = self.module.run(self.root/'source-drift', source=source)['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_actual_case_cannot_qualify_gainmap_adaptation(self):
        from matrix import build_matrix
        matrix = build_matrix(self.report['cases'])
        self.assertEqual(matrix['evidence_errors'], [])
        self.assertEqual(matrix['rendering_coverage']['same_file_qualified_count'], 0)
        self.assertFalse(matrix['milestone_qualified'])


class AppleHdrPngGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_png
        cls.module = apple_hdr_png
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof', geometries=('contain', 'cover', 'fill', 'upscale'))

    def test_each_explicit_png16_geometry_has_its_own_native_and_independent_gates(self):
        from matrix import build_matrix
        cases = self.report['cases']
        self.assertEqual([case['geometry'] for case in cases], ['contain', 'cover', 'fill', 'upscale'])
        self.assertEqual(len({case['case_id'] for case in cases}), 4)
        hashes = {'contain': '6a80e8d0e95d9ef35c3ec4958a43e4e098ff115cf51006b9075cd424005e3b5c',
            'cover': 'bb5cc3d53c804a9192ffcd921bf2a9c1b3648af7210f22cebfaf4562260e1c27',
            'fill': '125136af612bd6fec7b192bb3354b435c9a108fb27b2914f7ca9777cb264ed2b',
            'upscale': '0dd5a52b0f54cf19d3751c3d891e1fd9db36563c3a194d229f3e7a8e3a3f5904'}
        for case in cases:
            with self.subTest(geometry=case['geometry']):
                width, height = self.module.SIZES[case['geometry']]
                self.assertEqual((case['facts']['width'], case['facts']['height']), (width, height))
                self.assertEqual(case['facts']['depth'], 16)
                self.assertEqual(case['facts']['physical_pixel_dimensions'], [1, 1, 0])
                self.assertTrue(case['facts']['native_decoders_agree'])
                self.assertEqual(case['reference_hdr']['dimensions'], [width, height])
                self.assertEqual(case['selectors'], self.module._selectors(case['geometry']))
                self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertEqual(case['artifacts']['sha256'], hashes[case['geometry']])
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
                self.assertEqual(case['source_reference_revision'], apple_source_model.REFERENCE_REVISION)
                self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
        self.assertEqual(build_matrix(cases)['evidence_errors'], [])

    def test_containment_stays_byte_fact_and_measurement_exact(self):
        original = self.module.run(self.root/'default')['cases'][0]
        contained = self.report['cases'][0]
        for key in ('case_id', 'selectors', 'facts', 'checks', 'measurements', 'status', 'blockers',
                    'rendering_scope', 'qualification_scope', 'known_consumer_limitations', 'threshold_scope'):
            self.assertEqual(contained[key], original[key], key)
        for key in ('artifacts', 'reference_hdr', 'reference_sdr'):
            self.assertEqual(contained[key]['sha256'], original[key]['sha256'], key)

    def test_unproved_or_ambiguous_geometry_requests_reject_before_native_work(self):
        for geometries in ((), ('contain', 'contain'), ('orientation-8',), ('crop',), ('identity',)):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', geometries=geometries)
            self.assertEqual(len(avif.COMMANDS), before)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'ambiguous', geometries=('contain', 'cover'), selectors=self.module.SELECTORS)


class AppleHdrPngOrientationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_png
        cls.module = apple_hdr_png
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof', geometries=('orientation',))
        cls.case = cls.report['cases'][0]

    def test_real_exif6_source_is_reconstructed_then_rotated_once_for_png16(self):
        import numpy as np
        from PIL import Image
        case = self.case
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['orientation_source']['orientation'], 6)
        self.assertEqual(case['orientation_source']['sha256'],
                         '691ce29e25ba756cf0d9d2a4e498fcb4f246eaa0fd7046b15fb10f38b58053c9')
        self.assertEqual(case['artifacts']['source'], case['orientation_source']['path'])
        self.assertEqual(case['artifacts']['source_sha256'], case['orientation_source']['sha256'])
        self.assertEqual(case['source_facts']['metadata']['IFD0:Orientation'], 6)
        self.assertEqual((case['facts']['width'], case['facts']['height'], case['facts']['orientation']), (173, 130, 1))
        self.assertEqual(case['artifacts']['sha256'], '3ffe361e65413d197a74023e2cfee6d4a29d4657ee0d24833233bbc5d833052d')
        self.assertEqual(case['native_geometry']['padding_filter'].count('transpose=clock'), 1)
        prepared = self.report['source_preparation']
        self.assertFalse(prepared['native_source']['orientation_applied'])
        source = np.load(prepared['reference']['path'])
        rotated = np.rot90(source, -1)
        expected = np.maximum(np.stack([np.asarray(Image.fromarray(rotated[..., channel].astype(np.float32)).resize(
            (173, 130), Image.Resampling.LANCZOS)) for channel in range(3)], axis=-1), 0)
        self.assertTrue(np.array_equal(np.load(case['reference_hdr']['path']), expected))
        self.assertEqual(case['rendering_scope']['source_orientation'], 6)
        self.assertEqual(case['rendering_scope']['orientation_applications'], 1)
        self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
        self.assertEqual(case['consumer_status'], 'pending manual review')
        from matrix import build_matrix
        self.assertEqual(build_matrix([case])['evidence_errors'], [])

    def test_unknown_orientation_selectors_and_source_reject_before_native_work(self):
        for source, selectors in ((Path(self.case['orientation_source']['path']), self.module._selectors('orientation')),
                (apple_source_model.SOURCE, {**self.module._selectors('orientation'), 'depth': '8'}),
                (apple_source_model.SOURCE, {**self.module._selectors('orientation'), 'orientation': 8})):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'bad-orientation', source=source, selectors=selectors, geometries=('orientation',))
            self.assertEqual(len(avif.COMMANDS), before)

    def test_generated_metadata_change_stops_before_native_pixel_work(self):
        real_generate = self.module.apple_orientation_source.generate
        boundary = []

        def generate_then_change(directory, **kwargs):
            source = real_generate(directory, **kwargs)
            avif.native(['exiftool', '-overwrite_original', '-Orientation#=8', source])
            boundary.append(len(avif.COMMANDS))
            return source

        with patch.object(self.module.apple_orientation_source, 'generate', side_effect=generate_then_change):
            with self.assertRaisesRegex(ValueError, 'Generated EXIF6 source changed'):
                self.module.run(self.root/'wrong-generated-orientation', geometries=('orientation',))
        self.assertEqual(len(avif.COMMANDS), boundary[0])

    def test_actual_oriented_source_stays_bound_after_native_preparation(self):
        real_prepare = self.module.apple_orientation_source.run

        def prepare_then_change(directory, **kwargs):
            result = real_prepare(directory, **kwargs)
            source = Path(result['orientation_source']['path'])
            source.write_bytes(source.read_bytes()+b'late oriented source drift')
            return result

        with patch.object(self.module.apple_orientation_source, 'run', side_effect=prepare_then_change):
            case = self.module.run(self.root/'orientation-source-drift', geometries=('orientation',))['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(any('integrity' in message for message in case['blockers']))
        self.assertEqual(case['artifacts']['source_sha256'], self.module.apple_orientation_source.SOURCE_SHA256)


if __name__ == '__main__':
    unittest.main()
