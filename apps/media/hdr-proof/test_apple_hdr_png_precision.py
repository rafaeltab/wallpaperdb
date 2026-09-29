"""Actual opaque float-plane preservation improves native PNG PQ precision."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import apple_source_model
import avif


class AppleHdrPngPrecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_png_precision
        cls.module = apple_hdr_png_precision
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')
        cls.case = cls.report['cases'][0]

    def test_real_native_precision_candidate_preserves_baseline_and_fixed_reference(self):
        case = self.case
        old = self.report['baseline']['cases'][0]
        self.assertEqual(old['status'], 'qualified')
        self.assertEqual(old['artifacts']['sha256'], '6a80e8d0e95d9ef35c3ec4958a43e4e098ff115cf51006b9075cd424005e3b5c')
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['artifacts']['sha256'], 'abebcdf69ad7adf9b8630694df7a3ffb1772003985e740e24047996ee2c871dc')
        self.assertEqual(case['reference_hdr'], old['reference_hdr'])
        self.assertNotEqual(case['case_id'], old['case_id'])
        self.assertEqual(case['selectors'], old['selectors'])
        self.assertEqual(case['threshold_scope'], old['threshold_scope'])
        self.assertTrue(case['native_writer']['opaque_planes']['actual_alpha_exactly_one'])
        self.assertTrue(case['native_writer']['opaque_planes']['rgb_bytes_unchanged'])
        self.assertTrue(case['storage_checks']['native_rgb16_equals_independent_png'])
        diagnostic = case['precision_diagnostic']
        self.assertEqual(diagnostic['baseline']['maximum_code_error'], 16)
        self.assertEqual(diagnostic['candidate']['maximum_code_error'], 1)
        self.assertLess(case['measurements']['hdr']['regions']['shadow']['delta_e_itp']['maximum'], .011)
        self.assertEqual(case['consumer_status'], 'pending manual review')
        from matrix import build_matrix
        self.assertEqual(build_matrix([old,case])['evidence_errors'], [])

    def test_actual_stage_samples_and_every_bound_hash_remain_independently_checkable(self):
        case = self.case
        writer = case['native_writer']
        source = Path(writer['opaque_planes']['source']).read_bytes()
        plane = writer['opaque_planes']['bytes_per_plane']
        self.assertTrue(np.all(np.frombuffer(source[3*plane:], '<u4') == 0x3f800000))
        self.assertEqual(Path(writer['opaque_planes']['path']).read_bytes(), source[:3*plane])
        for path, sha in case['bound_files'].items():
            self.assertEqual(avif.digest(path), sha, path)
        for name, sha in self.report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).parent/name), sha, name)
        self.assertEqual(case['threshold_scope']['thresholds_sha256'],
                         '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
        self.assertEqual(case['precision_diagnostic']['candidate']['changed_codes'], 2914)
        for stage in ('native_source', 'native_geometry', 'native_rgb_planes', 'native_pq_stage', 'hdr'):
            self.assertTrue(case['measurements'][stage]['passed'], stage)
        self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])

    def test_baseline_bytes_facts_checks_measurements_and_scopes_are_unchanged(self):
        actual = self.report['baseline']['cases'][0]
        direct = self.module.apple_hdr_png.run(self.root/'direct-baseline')['cases'][0]
        for key in ('case_id', 'selectors', 'facts', 'checks', 'measurements', 'status', 'blockers',
                    'rendering_scope', 'qualification_scope', 'known_consumer_limitations', 'threshold_scope'):
            self.assertEqual(actual[key], direct[key], key)
        for key in ('artifacts', 'reference_hdr', 'reference_sdr'):
            self.assertEqual(actual[key]['sha256'], direct[key]['sha256'], key)
        self.assertEqual(len(self.report['cases']), 1)
        self.assertNotEqual(actual['case_id'], self.case['case_id'])

    def test_actual_fractional_nonfinite_or_nonunit_alpha_rejects_before_native_work(self):
        original = self.case['native_geometry']
        for index, alpha in enumerate((0., .5, np.nan, np.inf, np.nextafter(np.float32(1), np.float32(0)))):
            data = bytearray(Path(original['path']).read_bytes())
            np.frombuffer(data, '<f4')[3*173*231] = alpha
            path = self.root/f'alpha-{index}.gbrapf32'
            path.write_bytes(data)
            before = len(avif.COMMANDS)
            output = self.root/f'alpha-{index}.png'
            with self.subTest(alpha=alpha), self.assertRaisesRegex(ValueError, 'alpha must be exactly one'):
                self.module.encode({**original, 'path': str(path)}, output, expected_source_sha256=avif.digest(path))
            self.assertEqual(len(avif.COMMANDS), before)
            self.assertFalse(output.exists())

    def test_nonfinite_negative_or_out_of_range_rgb_rejects_before_native_work(self):
        original = self.case['native_geometry']
        for index, value in enumerate((np.nan, np.inf, -.001, 10001/203)):
            data = bytearray(Path(original['path']).read_bytes())
            np.frombuffer(data, '<f4')[0] = value
            path = self.root/f'rgb-{index}.gbrapf32'
            path.write_bytes(data)
            before = len(avif.COMMANDS)
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'finite nonnegative in-range'):
                self.module.encode({**original, 'path': str(path)}, self.root/'rejected.png',
                                   expected_source_sha256=avif.digest(path))
            self.assertEqual(len(avif.COMMANDS), before)

    def test_unknown_geometry_facts_or_source_hash_reject_before_native_work(self):
        geometry = self.case['native_geometry']
        sha = avif.digest(geometry['path'])
        for field, value in (('normalization_nits', 100), ('format', 'gbrpf32le'), ('gamut', 'rec2020'),
                             ('width', 174), ('height', 232)):
            before = len(avif.COMMANDS)
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.module.encode({**geometry, field: value}, self.root/'rejected.png', expected_source_sha256=sha)
            self.assertEqual(len(avif.COMMANDS), before)
        before = len(avif.COMMANDS)
        with self.assertRaisesRegex(ValueError, 'hash or dimensions'):
            self.module.encode(geometry, self.root/'rejected.png', expected_source_sha256='0'*64)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_unknown_source_and_unproved_selectors_are_original_only(self):
        for key, value in (('depth', '8'), ('depth', 'preserve'), ('format', 'avif'), ('range', 'sdr'),
                           ('gamut', 'rec2020'), ('fit', 'cover'), ('w', 769), ('orientation', 6)):
            before = len(avif.COMMANDS)
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', selectors={**self.module.SELECTORS, key: value})
            self.assertEqual(len(avif.COMMANDS), before)
        source = self.root/'unknown.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes()+b'unknown facts')
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'unknown', source=source)
        self.assertEqual(len(avif.COMMANDS), before)

    def test_output_changed_after_real_independent_decode_remains_failed(self):
        directory = self.root/'late-output'
        original = self.module.apple_hdr_png.inspect_output
        def decode_then_change(path, **kwargs):
            result = original(path, **kwargs)
            if Path(path) == directory/'output.png':
                with Path(path).open('ab') as stream:
                    stream.write(b'late output drift')
            return result
        with patch.object(self.module.apple_hdr_png, 'inspect_output', side_effect=decode_then_change):
            report = self.module.run(directory)
        self.assertEqual(report['baseline']['cases'][0]['status'], 'qualified')
        case = report['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['integrity'])
        self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_native_stage_changed_after_actual_measurement_remains_failed(self):
        original = self.module._read_planar
        def read_then_change(path):
            result = original(path)
            if Path(path).name == 'native-pq.gbrpf32':
                with Path(path).open('ab') as stream:
                    stream.write(b'late PQ stage drift')
            return result
        with patch.object(self.module, '_read_planar', side_effect=read_then_change):
            case = self.module.run(self.root/'late-stage')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['integrity'])
        self.assertTrue(any('integrity' in message for message in case['blockers']))

    def test_admitted_source_copy_remains_bound_after_actual_native_encoding(self):
        source = self.root/'admitted-copy.jpg'
        source.write_bytes(apple_source_model.SOURCE.read_bytes())
        original = self.module.encode
        def encode_then_change(*args, **kwargs):
            result = original(*args, **kwargs)
            with source.open('ab') as stream:
                stream.write(b'late source drift')
            return result
        with patch.object(self.module, 'encode', side_effect=encode_then_change):
            case = self.module.run(self.root/'late-source', source=source)['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['integrity'])
        self.assertTrue(any('integrity' in message for message in case['blockers']))


if __name__ == '__main__':
    unittest.main()
