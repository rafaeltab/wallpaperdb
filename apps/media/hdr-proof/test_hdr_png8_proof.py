"""Native PNG8 containment conversions keep source and output error separate."""
import json
from collections import Counter
from pathlib import Path
import tempfile
import unittest

import avif
import hdr_png8
import hdr_png8_proof


class PngEightBitConversionTests(unittest.TestCase):
    def test_all_containment_outputs_have_independent_pixels_and_exact_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = hdr_png8_proof.run(Path(temporary))
            self.assertEqual(len(result['fixtures']), 8)
            self.assertEqual(len(result['evidence']), 32)
            self.assertEqual(Counter(item['status'] for item in result['evidence']),
                             {'qualified': 12, 'tested and failed': 20})
            noops = [control for control in result['controls'] if control['kind'] == 'matching-original']
            self.assertEqual(len(noops), 8)
            self.assertTrue(all(control['passed'] for control in result['controls']))
            for fixture in result['fixtures']:
                self.assertTrue(fixture['source_valid'])
                self.assertTrue(fixture['source_lock']['passed'])
            for item in result['evidence']:
                with self.subTest(case=item['case_id']):
                    self.assertEqual(item['geometry'], 'contain')
                    self.assertEqual(item['selectors']['transparency'], 'preserve')
                    self.assertEqual((item['facts']['width'], item['facts']['height']), (57, 38))
                    self.assertTrue(item['checks']['native_encoder'], item['blockers'])
                    self.assertTrue(item['checks']['independent_decoder'], item['blockers'])
                    alpha_failure = (item['selectors']['range'] == 'sdr'
                                     and item['selectors']['format'] == 'png'
                                     and item['source_facts']['alpha_channel'])
                    self.assertEqual(item['checks']['structure'], not alpha_failure,
                                     item['structural_checks'])
                    self.assertTrue(all(value for key, value in item['structural_checks'].items()
                                        if key != 'alpha'))
                    alpha = item['facts']['alpha_measurement']
                    self.assertEqual(alpha['maximum_absolute_error'] <= alpha['absolute_error_limit'],
                                     not alpha_failure)
                    self.assertTrue(item['checks']['privacy'], item['privacy_measurement'])
                    self.assertEqual(item['facts']['depth'], int(item['selectors']['depth']))
                    measurement = item['measurements']['frames'][0]
                    self.assertEqual(measurement['fixture_class'],
                                     'avif-8' if item['selectors']['range'] == 'hdr' else 'sdr-8')
                    # These native failures remain failed evidence. Tests pin
                    # their rejection instead of enlarging an appearance gate.
                    self.assertEqual(item['checks']['appearance'], item['selectors']['range'] == 'sdr')
                    if item['selectors']['range'] == 'hdr':
                        self.assertIn('highlight.delta_e_mean', measurement['failures'])
                    self.assertTrue(all(measurement['regions'][region]['samples'] > 0
                                        for region in ('shadow', 'midtone', 'highlight')))
                    expected = 'qualified' if all(item['checks'].values()) else 'tested and failed'
                    self.assertEqual(item['status'], expected)
                    self.assertEqual(item['consumer_status'], 'pending manual review')
                    self.assertEqual(avif.digest(Path(item['artifacts']['output'])), item['artifacts']['sha256'])

    def test_changed_source_lock_stops_before_any_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = json.loads(hdr_png8_proof.SOURCE_LOCK.read_text())
            spec = next(hdr_png8.fixture_specs())
            lock['sha256'][spec['id']] = '0' * 64
            changed = root/'changed-lock.json'
            changed.write_text(json.dumps(lock))
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'PNG8 source hash mismatch'):
                hdr_png8_proof.run(root/'proof', specs=[spec], source_lock=changed)
            commands = avif.COMMANDS[start:]
            # Stimulus generation is native; no candidate filter or AVIF writer
            # may run after a fixture fails its committed source hash.
            self.assertFalse(any(command['argv'][0] in ('avifenc', 'avifdec') for command in commands))
            self.assertFalse(any('-filter_complex' in command['argv'] for command in commands))
            self.assertFalse(list((root/'proof').rglob('output.*')))

    def test_unknown_color_signaling_keeps_original_and_withholds_transformations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, _ = hdr_png8.generate_fixture(next(hdr_png8.fixture_specs()), root/'source')
            controls = hdr_png8_proof.source_rejection_controls(source, root/'controls')
            self.assertEqual({control['variant'] for control in controls}, {'missing-cicp', 'unknown-transfer'})
            for control in controls:
                self.assertTrue(control['passed'], control)
                self.assertFalse(control['codec_qualification'])
                self.assertEqual(control['transformed_decision']['action'], 'metadata-pending')
                self.assertEqual(control['source_sha256'], control['original_sha256'])


if __name__ == '__main__':
    unittest.main()
