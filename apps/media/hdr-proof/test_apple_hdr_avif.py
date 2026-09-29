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
            self.assertEqual(avif.digest(Path(__file__).with_name(name)), digest)
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


if __name__ == '__main__':
    unittest.main()
