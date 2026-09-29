"""Real dual-layer JPEG coding keeps the synthetic AVIF tone and HDR gates."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif


class StaticAvifHdrJpegTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import static_avif_hdr_jpeg
        cls.module = static_avif_hdr_jpeg
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.report = cls.module.run(cls.root/'proof')

    def test_real_undithered_failure_and_ordered_success_are_separate(self):
        plain, ordered = self.report['cases']
        self.assertEqual(plain['status'], 'tested and failed')
        self.assertEqual(plain['measurements']['encoded_sdr_tone']['failures'], ['highlight_flattening'])
        self.assertEqual(ordered['status'], 'qualified', ordered['blockers'])
        self.assertTrue(all(ordered['checks'].values()))
        self.assertEqual([row['artifacts']['sha256'] for row in (plain, ordered)], [
            '63fad5894c3970b66c9a35154d733963c561707380ad3ba288d5f730a3ab99ab',
            'e8bd0ccb9daa46e0e95fc1af94857ca4f6b24acba3288b6a662b53209a69ac67'])
        for case in (plain, ordered):
            self.assertEqual(case['selectors'], self.module.SELECTORS)
            self.assertEqual(case['facts']['base']['depth'], 8)
            self.assertEqual(case['facts']['map']['depth'], 8)
            self.assertTrue(all(case['facts']['metadata_agreement']['checks'].values()))
            for key in ('native_hdr', 'independent_hdr', 'cross_decoder_hdr'):
                self.assertEqual(case['measurements'][key]['fixture_class'], 'avif-8')
                self.assertTrue(case['measurements'][key]['passed'])
            self.assertEqual(case['measurements']['sdr']['fixture_class'], 'sdr-8')
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertFalse(case['rendering_scope']['intermediate_adaptation_qualified'])
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
            display = case['sdr_display_mapping']
            self.assertTrue(display['clipping_does_not_hide_tone_failure'])
            self.assertEqual(display['unclipped_neutral_curve']['checks'], display['clipped_neutral_curve']['checks'])
            for name in ('ordinary_white', 'shadow', 'midtone'):
                self.assertEqual(display['probe_clipping'][name]['affected_pixels'], 0)

    def test_all_files_references_and_native_stages_are_bound(self):
        for case in self.report['cases']:
            for path, digest in case['bound_files'].items():
                self.assertEqual(avif.digest(path), digest)
            self.assertTrue(case['native_preparation']['opaque_float_plane_copy_exact'])
            self.assertTrue(case['native_preparation']['aom_dav1d_samples_exact'])
            self.assertTrue(case['native_preparation']['hdr_intent_samples_exact'])
            self.assertLessEqual(case['native_preparation']['gamma_code_maximum_error'], 1.01)
        for path, digest in self.report['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).parent/path), digest)
        self.assertEqual(json.loads((self.root/'proof/results.json').read_text()), self.report)

    def test_actual_evidence_keeps_failed_case_unqualified_in_matrix(self):
        from matrix import build_matrix
        matrix = build_matrix(self.report['cases'])
        self.assertEqual(matrix['evidence_errors'], [])
        actual = {case['case_id']: case for row in matrix['cells'] for case in row['evidence']}
        for case in self.report['cases']:
            self.assertEqual(actual[case['case_id']]['status'], case['status'])
        self.assertFalse(matrix['milestone_qualified'])

    def test_selectors_and_unknown_sources_reject_before_native_work(self):
        for key, value in (('depth', 'preserve'), ('depth', '10'), ('gamut', 'srgb'),
                           ('range', 'sdr'), ('w', 96), ('motion', 'static'), ('orientation', 6)):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', selectors={**self.module.SELECTORS, key: value})
            self.assertEqual(len(avif.COMMANDS), before)
        source = self.root/'unknown.avif'
        source.write_bytes(Path(self.report['source_fixtures'][0]['path']).read_bytes()+b'unknown facts')
        before = len(avif.COMMANDS)
        with self.assertRaisesRegex(ValueError, 'original-only'):
            self.module.run(self.root/'unknown', source=source)
        self.assertEqual(len(avif.COMMANDS), before)
        decision = self.module.source_decision(source)
        self.assertEqual(decision['delivery'], 'original-only')
        self.assertEqual(decision['metadata_state'], 'pending')
        self.assertEqual(decision['original_sha256'], avif.digest(source))
        self.assertEqual(source.read_bytes()[-13:], b'unknown facts')

    def test_actual_wrong_hdr_intent_signaling_is_rejected(self):
        path = self.root/'wrong-intent.png'
        original = Path(self.report['cases'][0]['native_preparation']['hdr_intent']['path'])
        avif.native(['ffmpeg', '-v', 'error', '-y', '-i', original, '-vf',
            'format=rgb48le,setparams=color_primaries=12:color_trc=18:colorspace=0:range=full',
            '-frames:v', '1', '-threads', '1', path])
        with self.assertRaises(ValueError):
            self.module.inspect_hdr_intent(path)

    def test_private_metadata_or_extra_payload_cannot_pass_real_output_inspection(self):
        actual = Path(self.report['cases'][1]['artifacts']['output'])
        private = self.root/'private.jpg'
        private.write_bytes(actual.read_bytes())
        avif.native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE', private])
        with self.assertRaises(ValueError):
            self.module.inspect_output(private, self.root/'private-inspection')
        tail = self.root/'tail.jpg'
        tail.write_bytes(actual.read_bytes()+b'unknown tail')
        with self.assertRaises(ValueError):
            self.module.inspect_output(tail, self.root/'tail-inspection')

    def test_map_drift_after_real_native_decode_withholds_qualification(self):
        original = self.module.icc_gainmap.native_decode
        def decode_then_mutate(path, *args, **kwargs):
            result = original(path, *args, **kwargs)
            extracted = Path(path).parent/'inspection/map.jpg'
            with extracted.open('ab') as stream:
                stream.write(b'late extracted map drift')
            return result
        with patch.object(self.module.icc_gainmap, 'native_decode', side_effect=decode_then_mutate):
            result = self.module.run(self.root/'map-drift', dithers=('ordered',))
        self.assertEqual(result['cases'][0]['status'], 'tested and failed')
        self.assertIn('integrity', ' '.join(result['cases'][0]['blockers']))

    def test_output_drift_after_real_inspection_cannot_rebind_emitted_hash(self):
        original = self.module.inspect_output
        def inspect_then_mutate(path, *args, **kwargs):
            result = original(path, *args, **kwargs)
            with Path(path).open('ab') as stream:
                stream.write(b'late emitted output drift')
            return result
        with patch.object(self.module, 'inspect_output', side_effect=inspect_then_mutate):
            result = self.module.run(self.root/'output-drift', dithers=('ordered',))
        case = result['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertIn('integrity', ' '.join(case['blockers']))
        self.assertEqual(case['artifacts']['sha256'],
                         'e8bd0ccb9daa46e0e95fc1af94857ca4f6b24acba3288b6a662b53209a69ac67')

    def test_extracted_map_drift_after_real_inspection_cannot_rebind_map(self):
        original = self.module.inspect_output
        def inspect_then_mutate(path, directory, *args, **kwargs):
            result = original(path, directory, *args, **kwargs)
            with (Path(directory)/'map.jpg').open('ab') as stream:
                stream.write(b'late inspected map drift')
            return result
        with patch.object(self.module, 'inspect_output', side_effect=inspect_then_mutate):
            case = self.module.run(self.root/'inspected-map-drift', dithers=('ordered',))['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertIn('integrity', ' '.join(case['blockers']))

    def test_admitted_source_copy_drift_after_real_aom_read_is_rejected(self):
        source = self.root/'source-copy.avif'
        source.write_bytes(Path(self.report['source_fixtures'][0]['path']).read_bytes())
        original = self.module.avif.native
        def native_then_mutate(argv, **kwargs):
            result = original(argv, **kwargs)
            if argv[0] == 'avifdec' and 'aom' in argv:
                with source.open('ab') as stream:
                    stream.write(b'late source drift')
            return result
        with patch.object(self.module.avif, 'native', side_effect=native_then_mutate):
            result = self.module.run(self.root/'source-drift', source=source, dithers=('ordered',))
        self.assertEqual(result['cases'][0]['status'], 'tested and failed')
        self.assertIn('integrity', ' '.join(result['cases'][0]['blockers']))

    def test_native_source_and_hdr_intent_readback_cannot_rebind_changed_png(self):
        original = self.module.avif.read_png
        for filename in ('source-aom.png', 'native-hdr-intent.png'):
            def read_then_mutate(path):
                result = original(path)
                if Path(path).name == filename:
                    avif.native(['exiftool', '-overwrite_original', '-Artist=Late inspected PNG drift', path])
                return result
            with self.subTest(filename=filename), patch.object(self.module.avif, 'read_png', side_effect=read_then_mutate):
                case = self.module.run(self.root/f'png-drift-{filename}', dithers=('ordered',))['cases'][0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertIn('integrity', ' '.join(case['blockers']))


if __name__ == '__main__':
    unittest.main()
