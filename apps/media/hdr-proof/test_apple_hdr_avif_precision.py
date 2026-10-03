"""Actual AOM output from the separately verified precise native PQ intent."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import apple_source_model
import avif


class AppleHdrAvifPrecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_avif_precision
        cls.module = apple_hdr_avif_precision
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')
        cls.case = cls.report['cases'][0]

    def test_native_avif_retains_exact_baseline_and_uses_inspected_precise_png(self):
        case = self.case
        old = self.report['baseline']['cases'][0]
        intent = self.report['native_preparation']['cases'][0]
        self.assertEqual(old['status'], 'qualified', old['blockers'])
        self.assertEqual(old['artifacts']['sha256'], '0df05ebcaec55271c6ba09724f3cf55339c6859d55ea6441468dfd9cc400e9be')
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertTrue(all(case['structural_checks'].values()))
        self.assertEqual(case['artifacts']['sha256'], '1dffb13fe24aac6b2d43c7f65d82f3c6ec02cdf6709a04b36aadf36dc4028ebb')
        self.assertAlmostEqual(max(region['delta_e_itp']['maximum'] for region in case['measurements']['hdr']['regions'].values()
                                   if region['samples']), .17486298499932634, places=9)
        self.assertEqual(case['hdr_intent']['sha256'], 'abebcdf69ad7adf9b8630694df7a3ffb1772003985e740e24047996ee2c871dc')
        self.assertEqual(case['hdr_intent']['sha256'], intent['artifacts']['sha256'])
        self.assertEqual(case['reference_hdr']['sha256'], old['reference_hdr']['sha256'])
        self.assertEqual(case['reference_hdr'], intent['reference_hdr'])
        self.assertEqual(case['threshold_scope'], old['threshold_scope'])
        self.assertEqual(case['facts']['depth'], 12)
        self.assertEqual((case['facts']['primaries'], case['facts']['transfer'], case['facts']['matrix']), (12, 16, 0))
        self.assertEqual(case['facts']['alpha'], 'Absent')
        self.assertEqual(case['output_packet_facts']['streams'][0]['pix_fmt'], 'gbrp12le')
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
        self.assertEqual(len(self.report['cases']), 1)
        self.assertNotEqual(case['case_id'], old['case_id'])
        from matrix import build_matrix
        self.assertEqual(build_matrix([old, case])['evidence_errors'], [])

    def test_bound_native_preparation_output_and_sources_are_stable(self):
        for path, sha in self.case['bound_files'].items():
            self.assertEqual(avif.digest(path), sha, path)
        for name, sha in self.report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).parent/name), sha, name)
        self.assertEqual(self.case['threshold_scope']['thresholds_sha256'],
                         '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
        self.assertEqual(self.case['measurements']['native_intent'],
                         self.report['native_preparation']['cases'][0]['measurements']['hdr'])
        for stage in ('native_source', 'native_geometry', 'native_rgb_planes', 'native_pq_stage', 'native_intent', 'hdr'):
            self.assertTrue(self.case['measurements'][stage]['passed'], stage)

    def test_original_avif_bytes_metadata_measurements_and_scopes_remain_exact(self):
        old = self.report['baseline']['cases'][0]
        direct = self.module.apple_hdr_avif.run(self.root/'direct-baseline')['cases'][0]
        for key in ('case_id', 'candidate', 'selectors', 'checks', 'measurements', 'status', 'blockers',
                    'structural_checks', 'output_packet_facts', 'privacy_measurement',
                    'rendering_scope', 'qualification_scope', 'known_consumer_limitations', 'threshold_scope'):
            self.assertEqual(old[key], direct[key], key)
        for key in ('artifacts', 'reference_hdr', 'reference_sdr', 'hdr_intent'):
            self.assertEqual(old[key]['sha256'], direct[key]['sha256'], key)
        def stable_facts(row):
            return {**row['facts'], 'info': row['facts']['info'].replace(row['artifacts']['output'], '<output>')}
        self.assertEqual(stable_facts(old), stable_facts(direct))

    def test_unproved_selectors_and_unknown_source_remain_original_only(self):
        for key, value in (('depth', 'preserve'), ('depth', '8'), ('depth', '10'), ('format', 'png'),
                           ('range', 'sdr'), ('gamut', 'rec2020'), ('w', 769), ('fit', 'cover'), ('orientation', 6)):
            before = len(avif.COMMANDS)
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', selectors={**self.module.SELECTORS, key: value})
            self.assertEqual(len(avif.COMMANDS), before)
        source = self.root/'unknown.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes()+b'unknown source facts')
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'unknown', source=source)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_native_intent_changed_after_real_preparation_stops_before_avif_encoding(self):
        original = self.module.apple_hdr_png_precision.run
        boundary = []
        def prepare_then_change(*args, **kwargs):
            report = original(*args, **kwargs)
            path = Path(report['cases'][0]['artifacts']['output'])
            path.write_bytes(path.read_bytes()+b'changed native intent')
            boundary.append(len(avif.COMMANDS))
            return report
        with patch.object(self.module.apple_hdr_png_precision, 'run', side_effect=prepare_then_change):
            case = self.module.run(self.root/'intent-drift')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['native_encoder'])
        self.assertTrue(any('intent integrity' in message for message in case['blockers']))
        self.assertEqual(len(avif.COMMANDS), boundary[0])

    def test_source_changed_after_real_encoding_stops_before_actual_output_decoder(self):
        source = self.root/'admitted-copy.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes())
        directory = self.root/'source-drift'
        original = self.module.avif.encode_avif
        boundary = []
        def encode_then_change(paths, output, *args, **kwargs):
            actual = original(paths, output, *args, **kwargs)
            if Path(output) == directory/'output.avif':
                source.write_bytes(source.read_bytes()+b'late source drift')
                boundary.append(len(avif.COMMANDS))
            return actual
        with patch.object(self.module.avif, 'encode_avif', side_effect=encode_then_change):
            case = self.module.run(directory, source=source)['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(case['checks']['native_encoder'])
        self.assertFalse(case['checks']['independent_decoder'])
        self.assertTrue(any('integrity' in message for message in case['blockers']))
        self.assertEqual(len(avif.COMMANDS), boundary[0])

    def test_output_or_intent_changed_after_real_dav1d_decode_remains_failed(self):
        original = self.module.inspect_output
        for name in ('output', 'intent'):
            directory = self.root/('late-'+name)
            def decode_then_change(path, *args, **kwargs):
                actual = original(path, *args, **kwargs)
                target = Path(path) if name == 'output' else directory/'native-preparation/output.png'
                target.write_bytes(target.read_bytes()+b'late decoder boundary drift')
                return actual
            with self.subTest(artifact=name), patch.object(self.module, 'inspect_output', side_effect=decode_then_change):
                case = self.module.run(directory)['cases'][0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertFalse(case['checks']['integrity'])
            self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_real_native_depth_mismatch_and_private_metadata_are_rejected(self):
        original = self.module.avif.encode_avif
        for name in ('depth', 'private'):
            directory = self.root/name
            def encode_bad_output(paths, output, transfer, gamut, depth, **kwargs):
                is_candidate = Path(output) == directory/'output.avif'
                actual = original(paths, output, transfer, gamut, 10 if is_candidate and name == 'depth' else depth, **kwargs)
                if is_candidate and name == 'private':
                    avif.native(['exiftool', '-overwrite_original', '-Artist=private proof control', output])
                return actual
            with self.subTest(control=name), patch.object(self.module.avif, 'encode_avif', side_effect=encode_bad_output):
                case = self.module.run(directory)['cases'][0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertTrue(case['checks']['native_encoder'])
            if name == 'depth':
                self.assertEqual(case['facts']['depth'], 10)
                self.assertEqual(case['output_packet_facts']['streams'][0]['pix_fmt'], 'gbrp10le')
                self.assertFalse(case['checks']['structure'])
            else:
                self.assertFalse(case['checks']['privacy'])
                self.assertTrue(case['privacy_measurement']['private_tags'])


class AppleHdrAvifPrecisionDepthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_avif_precision
        cls.module = apple_hdr_avif_precision
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof', depths=(12, 10, 8))

    def test_explicit_native_depths_keep_separate_baselines_and_unchanged_gates(self):
        from matrix import build_matrix
        cases = self.report['cases']
        self.assertEqual([case['selectors']['depth'] for case in cases], ['12', '10', '8'])
        self.assertEqual(len({case['case_id'] for case in cases}), 3)
        baselines = {case['selectors']['depth']: case for case in self.report['baseline']['cases']}
        hashes = {12: '1dffb13fe24aac6b2d43c7f65d82f3c6ec02cdf6709a04b36aadf36dc4028ebb',
                  10: '6cf3a99518eca0ea0cee3208eacde4e7e8a53437db5fef8163d2491b82e28505',
                  8: 'e55fc20801f655114d15734b5c7b71256baa0dd74a969983858e85a6613ddd8d'}
        for case in cases:
            depth = int(case['selectors']['depth'])
            old = baselines[str(depth)]
            with self.subTest(depth=depth):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertTrue(all(case['structural_checks'].values()))
                self.assertEqual(case['facts']['depth'], depth)
                self.assertEqual(case['artifacts']['sha256'], hashes[depth])
                self.assertEqual(case['output_packet_facts']['streams'][0]['pix_fmt'], 'gbrp' if depth == 8 else f'gbrp{depth}le')
                self.assertEqual(case['selectors'], {**self.module.SELECTORS, 'depth': str(depth)})
                self.assertEqual(case['reference_hdr']['sha256'], old['reference_hdr']['sha256'])
                self.assertEqual(case['threshold_scope'], old['threshold_scope'])
                self.assertEqual(case['threshold_scope']['profile'], 'gainmap-hdr')
                self.assertEqual(case['threshold_scope']['source_quantization_allowance'], 0)
                self.assertEqual(case['hdr_intent']['sha256'], 'abebcdf69ad7adf9b8630694df7a3ffb1772003985e740e24047996ee2c871dc')
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
                for path, sha in case['bound_files'].items():
                    self.assertEqual(avif.digest(path), sha, path)
        self.assertEqual(build_matrix([*baselines.values(), *cases])['evidence_errors'], [])

    def test_signed_regional_errors_retain_every_regression_as_a_diagnostic(self):
        baselines = {case['selectors']['depth']: case for case in self.report['baseline']['cases']}
        for case in self.report['cases']:
            old = baselines[case['selectors']['depth']]
            comparison = case['regional_change_from_baseline']
            self.assertEqual(comparison['qualification_role'], 'Diagnostic only; unchanged appearance gates decide qualification')
            increases = []
            for region, measured in case['measurements']['hdr']['regions'].items():
                prior = old['measurements']['hdr']['regions'][region]
                self.assertEqual(comparison['regions'][region]['samples'], measured['samples'])
                self.assertEqual(measured['samples'], prior['samples'])
                for metric in ('delta_e_itp', 'luminance_absolute_error_nits', 'luminance_relative_error_above_absolute_floor'):
                    for statistic in ('mean', 'p95', 'maximum'):
                        difference = measured[metric][statistic]-prior[metric][statistic]
                        self.assertEqual(comparison['regions'][region][metric][statistic], difference)
                        if difference > 0:
                            increases.append(f'{region}.{metric}.{statistic}')
            self.assertEqual(comparison['error_increases'], increases)
        by_depth = {int(case['selectors']['depth']): case for case in self.report['cases']}
        self.assertEqual([len(by_depth[depth]['regional_change_from_baseline']['error_increases']) for depth in (12, 10, 8)],
                         [0, 5, 6])
        # Coarser quantization is not a monotonic improvement from precise input.
        eight = by_depth[8]
        maximum = lambda case: max(region['delta_e_itp']['maximum'] for region in case['measurements']['hdr']['regions'].values()
                                   if region['samples'])
        self.assertGreater(maximum(eight), maximum(baselines['8']))
        self.assertEqual(eight['status'], 'qualified')  # The original fixed gates still pass.

    def test_prior_precision12_result_and_native_baseline_remain_exact(self):
        original = self.module.run(self.root/'default')
        for name, actual, expected in (('candidate', self.report['cases'][0], original['cases'][0]),
                ('baseline', self.report['baseline']['cases'][0], original['baseline']['cases'][0])):
            for key in ('case_id', 'candidate', 'selectors', 'checks', 'measurements', 'status', 'blockers',
                        'structural_checks', 'output_packet_facts', 'privacy_measurement',
                        'rendering_scope', 'qualification_scope', 'known_consumer_limitations', 'threshold_scope'):
                self.assertEqual(actual[key], expected[key], (name, key))
            for key in ('artifacts', 'reference_hdr', 'reference_sdr', 'hdr_intent'):
                self.assertEqual(actual[key]['sha256'], expected[key]['sha256'], (name, key))
            def stable_facts(row):
                return {**row['facts'], 'info': row['facts']['info'].replace(row['artifacts']['output'], '<output>')}
            self.assertEqual(stable_facts(actual), stable_facts(expected), name)

    def test_unproved_or_ambiguous_depth_requests_stop_before_native_work(self):
        for depths in ((), (8, 8), (16,), (True,), ('8',), ([8],)):
            before = len(avif.COMMANDS)
            with self.subTest(depths=depths), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', depths=depths)
            self.assertEqual(len(avif.COMMANDS), before)
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'ambiguous', depths=(12, 10), selectors=self.module.SELECTORS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'mismatch', depths=(8,), selectors=self.module.SELECTORS)
        self.assertEqual(len(avif.COMMANDS), before)


class AppleHdrAvifPrecisionGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_avif_precision
        cls.module = apple_hdr_avif_precision
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof', geometries=('contain', 'cover', 'fill', 'upscale', 'orientation'))

    def test_native12_geometries_have_independent_intent_output_and_baseline_gates(self):
        from matrix import build_matrix
        cases = self.report['cases']
        self.assertEqual([case['geometry'] for case in cases], ['contain', 'cover', 'fill', 'upscale', 'orientation'])
        baselines = {case['geometry']: case for case in self.report['baseline']['cases']}
        self.assertEqual(len({case['case_id'] for case in cases}), 5)
        for case in cases:
            operation = case['geometry']
            old = baselines[operation]
            with self.subTest(operation=operation):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertTrue(all(case['structural_checks'].values()))
                self.assertEqual(case['selectors'], self.module.apple_hdr_avif._selectors(operation, 12))
                width, height = self.module.apple_hdr_png_precision.SIZES[operation]
                self.assertEqual((case['facts']['width'], case['facts']['height']), (width, height))
                self.assertEqual(case['facts']['depth'], 12)
                packet = case['output_packet_facts']['streams'][0]
                self.assertEqual((packet['width'], packet['height'], packet['pix_fmt'], packet['sample_aspect_ratio']),
                                 (width, height, 'gbrp12le', '1:1'))
                self.assertEqual(case['reference_hdr']['sha256'], old['reference_hdr']['sha256'])
                self.assertEqual(case['threshold_scope'], old['threshold_scope'])
                self.assertEqual(case['hdr_intent']['facts']['physical_pixel_dimensions'], [1, 1, 0])
                self.assertEqual(case['consumer_status'], 'pending manual review')
                self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
                self.assertEqual(case['regional_change_from_baseline']['qualification_role'],
                                 'Diagnostic only; unchanged appearance gates decide qualification')
                for path, sha in case['bound_files'].items():
                    self.assertEqual(avif.digest(path), sha, path)
        self.assertEqual(build_matrix([*baselines.values(), *cases])['evidence_errors'], [])

    def test_native_orientation_reads_the_precise_png_actual_exif6_source(self):
        case = self.report['cases'][-1]
        self.assertEqual(case['orientation_source']['orientation'], 6)
        self.assertEqual(case['orientation_source']['sha256'],
                         '691ce29e25ba756cf0d9d2a4e498fcb4f246eaa0fd7046b15fb10f38b58053c9')
        self.assertEqual(case['artifacts']['source'], case['orientation_source']['path'])
        self.assertEqual(case['artifacts']['source_sha256'], case['orientation_source']['sha256'])
        self.assertEqual(case['source_facts']['metadata']['IFD0:Orientation'], 6)
        self.assertFalse(case['source_decoder_evidence']['native_source']['orientation_applied'])
        self.assertEqual(case['native_geometry']['padding_filter'].count('transpose=clock'), 1)
        self.assertEqual(case['rendering_scope']['orientation_applications'], 1)
        self.assertEqual(case['facts']['exiftool'].get('Orientation', 1), 1)
        self.assertTrue(case['structural_checks']['orientation_baked'])

    def test_containment12_fields_and_regional_comparison_remain_exact(self):
        old = self.module.run(self.root/'default')['cases'][0]
        actual = self.report['cases'][0]
        for key in ('case_id', 'candidate', 'selectors', 'checks', 'measurements', 'status', 'blockers',
                    'structural_checks', 'output_packet_facts', 'privacy_measurement',
                    'rendering_scope', 'qualification_scope', 'known_consumer_limitations', 'threshold_scope',
                    'regional_change_from_baseline'):
            self.assertEqual(actual[key], old[key], key)
        for key in ('artifacts', 'reference_hdr', 'reference_sdr', 'hdr_intent'):
            self.assertEqual(actual[key]['sha256'], old[key]['sha256'], key)

    def test_unproved_depth_geometry_combinations_reject_before_native_work(self):
        options = ({'geometries': ()}, {'geometries': ('contain', 'contain')}, {'geometries': ('orientation-8',)},
                   {'geometries': ('crop',)}, {'geometries': (['cover'],)},
                   {'depths': (8,), 'geometries': ('cover',)}, {'depths': (10,), 'geometries': ('orientation',)},
                   {'depths': (12, 8), 'geometries': ('contain', 'fill')},
                   {'geometries': ('cover',), 'selectors': self.module.SELECTORS})
        for kwargs in options:
            before = len(avif.COMMANDS)
            with self.subTest(options=kwargs), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **kwargs)
            self.assertEqual(len(avif.COMMANDS), before)


if __name__ == '__main__':
    unittest.main()
