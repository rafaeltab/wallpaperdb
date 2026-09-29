"""Explicit native PNG8 retains the fixed documented Apple full-effect gates."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import apple_source_model
import avif


class AppleHdrPng8Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_hdr_png8
        cls.module = apple_hdr_png8
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')
        cls.case = cls.report['cases'][0]

    def test_actual_png8_has_strict_native_storage_and_unchanged_source_gates(self):
        case = self.case
        baseline = self.report['baseline']['cases'][0]
        original = self.report['baseline']['baseline']['cases'][0]
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['artifacts']['sha256'], '166c05a6d10b08319828455fd612f294e08bf5ecee2f960bd83aa0c627bdcbde')
        self.assertEqual(baseline['artifacts']['sha256'], 'abebcdf69ad7adf9b8630694df7a3ffb1772003985e740e24047996ee2c871dc')
        self.assertEqual(original['artifacts']['sha256'], '6a80e8d0e95d9ef35c3ec4958a43e4e098ff115cf51006b9075cd424005e3b5c')
        self.assertEqual((case['facts']['width'], case['facts']['height'], case['facts']['depth'], case['facts']['color_type']),
                         (173, 231, 8, 2))
        self.assertEqual((case['facts']['primaries'], case['facts']['transfer'], case['facts']['matrix']), (12, 16, 0))
        self.assertEqual(case['facts']['physical_pixel_dimensions'], [1, 1, 0])
        self.assertEqual(case['facts']['orientation'], 1)
        self.assertTrue(case['facts']['native_decoders_agree'])
        self.assertTrue(case['facts']['opaque'])
        self.assertEqual(case['storage_measurement']['nearest_code_mismatches'], 0)
        self.assertTrue(case['storage_measurement']['native_rgb8_equals_independent_png'])
        self.assertEqual(case['threshold_scope'], baseline['threshold_scope'])
        self.assertEqual(case['reference_hdr'], baseline['reference_hdr'])
        self.assertEqual(case['selectors'], {**baseline['selectors'], 'depth': '8'})
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertAlmostEqual(max(region['delta_e_itp']['maximum']
            for region in case['measurements']['hdr']['regions'].values()), 2.686236028909041, places=10)
        self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
        self.assertEqual(len(self.report['cases']), 1)
        from matrix import build_matrix
        self.assertEqual(build_matrix([original, baseline, case])['evidence_errors'], [])

    def test_all_native_artifacts_source_versions_and_depth_comparison_are_bound(self):
        for path, sha in self.case['bound_files'].items():
            self.assertEqual(avif.digest(path), sha, path)
        for name, sha in self.report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).parent/name), sha, name)
        self.assertEqual(self.case['threshold_scope']['thresholds_sha256'],
                         '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
        comparison = self.case['regional_change_from_depth16']
        self.assertIn('Different requested depth', comparison['selector_scope'])
        self.assertEqual(comparison['qualification_role'], 'Diagnostic only; unchanged appearance gates decide qualification')
        self.assertEqual(len(comparison['error_increases']), 27)
        self.assertEqual(self.case['baseline_output']['selectors']['depth'], '16')
        self.assertEqual(self.case['selectors']['depth'], '8')

    def test_both_png16_baselines_remain_exact(self):
        direct = self.module.apple_hdr_png_precision.run(self.root/'direct-baseline')
        pairs = ((self.report['baseline']['cases'][0], direct['cases'][0]),
                 (self.report['baseline']['baseline']['cases'][0], direct['baseline']['cases'][0]))
        for actual, expected in pairs:
            for key in ('case_id', 'candidate', 'selectors', 'facts', 'checks', 'measurements', 'status', 'blockers',
                        'rendering_scope', 'qualification_scope', 'known_consumer_limitations', 'threshold_scope'):
                self.assertEqual(actual[key], expected[key], key)
            for key in ('artifacts', 'reference_hdr', 'reference_sdr'):
                self.assertEqual(actual[key]['sha256'], expected[key]['sha256'], key)

    def test_unknown_source_and_other_depth_gamut_or_geometry_selectors_reject_before_work(self):
        for key, value in (('depth', 'preserve'), ('depth', '16'), ('depth', '12'), ('format', 'avif'),
                           ('range', 'sdr'), ('gamut', 'rec2020'), ('w', 769), ('fit', 'cover'), ('orientation', 6)):
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

    def test_actual_private_orientation_aspect_and_depth_variants_are_rejected(self):
        source = self.case['artifacts']['output']
        for name, arguments in (('private', ['-Artist=private proof control']), ('orientation', ['-Orientation#=6'])):
            path = self.root/(name+'.png')
            path.write_bytes(Path(source).read_bytes())
            avif.native(['exiftool', '-overwrite_original', *arguments, path])
            with self.subTest(control=name), self.assertRaises(ValueError):
                self.module.inspect_output(path)
        path = self.root/'nonsquare.png'
        avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', 'setsar=2', '-frames:v', '1', '-threads', '1', path])
        with self.assertRaises(ValueError):
            self.module.inspect_output(path)
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.inspect_output(self.report['baseline']['cases'][0]['artifacts']['output'])
        self.assertEqual(len(avif.COMMANDS), before)

    def test_changed_native_intent_stops_before_the_quantizer(self):
        real_prepare = self.module.apple_hdr_png_precision.run
        boundary = []
        def prepare_then_change(*args, **kwargs):
            report = real_prepare(*args, **kwargs)
            path = Path(report['cases'][0]['artifacts']['output'])
            path.write_bytes(path.read_bytes()+b'changed native intent')
            boundary.append(len(avif.COMMANDS))
            return report
        with patch.object(self.module.apple_hdr_png_precision, 'run', side_effect=prepare_then_change):
            case = self.module.run(self.root/'changed-intent')['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['native_encoder'])
        self.assertTrue(any('integrity' in message for message in case['blockers']))
        self.assertEqual(len(avif.COMMANDS), boundary[0])

    def test_real_png_color_header_mutations_reject_before_independent_decoding(self):
        import struct
        import zlib
        chunks = self.module.hdr_png._png_chunks(Path(self.case['artifacts']['output']).read_bytes())
        for index, cicp in enumerate((bytes((9, 16, 0, 1)), bytes((12, 18, 0, 1)), bytes((12, 16, 0, 0)))):
            encoded = bytearray(b'\x89PNG\r\n\x1a\n')
            for kind, payload in chunks:
                if kind == b'cICP':
                    payload = cicp
                encoded.extend(struct.pack('>I', len(payload))+kind+payload+struct.pack('>I', zlib.crc32(kind+payload)))
            path = self.root/f'color-{index}.png'
            path.write_bytes(encoded)
            before = len(avif.COMMANDS)
            with self.subTest(cicp=list(cicp)), self.assertRaises(ValueError):
                self.module.inspect_output(path)
            self.assertEqual(len(avif.COMMANDS), before)

    def test_actual_biased_native_packing_cannot_pass_the_nearest_code_gate(self):
        directory = self.root/'biased-native'
        real_native = self.module.avif.native
        changed = []
        def native_with_biased_packing(args, **kwargs):
            args = list(args)
            if str(args[-1]) == str(directory/'native-rgb8.raw') and '-vf' in args:
                args[args.index('-vf')+1] = 'format=rgb24'
                changed.append(True)
            return real_native(args, **kwargs)
        with patch.object(self.module.avif, 'native', side_effect=native_with_biased_packing):
            case = self.module.run(directory)['cases'][0]
        self.assertEqual(changed, [True])
        self.assertEqual(case['status'], 'tested and failed')
        self.assertTrue(case['checks']['native_encoder'])
        self.assertTrue(case['checks']['independent_decoder'])
        self.assertFalse(case['checks']['nearest_code'])
        self.assertGreater(case['storage_measurement']['nearest_code_mismatches'], 0)

    def test_actual_source_output_and_quantized_stage_stay_bound_after_decoding(self):
        original = self.module.inspect_output
        for name in ('source', 'output', 'quantized-stage'):
            directory = self.root/('late-'+name)
            source = self.root/(name+'-source.jpg')
            source.write_bytes(apple_source_model.SOURCE.read_bytes())
            def decode_then_change(path):
                actual = original(path)
                target = {'source': source, 'output': Path(path), 'quantized-stage': directory/'native-rgb8.raw'}[name]
                target.write_bytes(target.read_bytes()+b'late native decoder boundary change')
                return actual
            with self.subTest(artifact=name), patch.object(self.module, 'inspect_output', side_effect=decode_then_change):
                case = self.module.run(directory, source=source)['cases'][0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertFalse(case['checks']['integrity'])
            self.assertTrue(any('integrity' in message for message in case['blockers']))


if __name__ == '__main__':
    unittest.main()
