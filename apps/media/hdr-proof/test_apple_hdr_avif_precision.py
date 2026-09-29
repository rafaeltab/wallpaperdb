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


if __name__ == '__main__':
    unittest.main()
