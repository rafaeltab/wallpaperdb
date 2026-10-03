"""Additional PNG8 geometry keeps actual source orientation and precision proved."""
from collections import Counter
import json
from pathlib import Path
import tempfile
import unittest

import avif
import hdr_png8
import hdr_png8_geometry


class PngEightBitGeometryTests(unittest.TestCase):
    def test_real_orientation_sources_retain_locked_coded_samples(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for spec in hdr_png8.fixture_specs():
                with self.subTest(source=spec['id']):
                    source, base = hdr_png8.generate_fixture(spec, root/spec['id'])
                    oriented, fixture = hdr_png8_geometry.generate_orientation_fixture(source, base)
                    self.assertTrue(fixture['source_valid'], fixture)
                    self.assertEqual(fixture['facts']['orientation'], 8)
                    self.assertEqual(fixture['facts']['depth'], 8)
                    self.assertEqual(fixture['base_sha256'], avif.digest(source))
                    self.assertTrue(fixture['source_checks']['exact_coded_samples'])
                    with self.assertRaisesRegex(ValueError, 'recognized eight-bit HDR PNG'):
                        hdr_png8.inspect_and_decode(oriented)

    def test_native_normalized_geometry_outputs_are_measured_with_fixed_gates(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = hdr_png8_geometry.run(Path(temporary))
            self.assertEqual(len(result['evidence']), 128)
            self.assertEqual(Counter(item['status'] for item in result['evidence']), {'qualified': 128})
            self.assertEqual(Counter(item['geometry'] for item in result['evidence']),
                             {'cover': 32, 'fill': 32, 'upscale': 32, 'orientation': 32})
            self.assertEqual(len(result['fixtures']), 8)
            self.assertTrue(all(item['source_lock']['passed'] for item in result['fixtures']))
            self.assertTrue(all(item['source_lock']['passed'] for item in result['source_fixtures']))
            for item in result['evidence']:
                with self.subTest(case=item['case_id']):
                    self.assertTrue(item['source_normalization']['passed'])
                    self.assertTrue(item['checks']['native_encoder'], item['blockers'])
                    self.assertTrue(item['checks']['independent_decoder'], item['blockers'])
                    self.assertTrue(item['checks']['privacy'], item['privacy_measurement'])
                    self.assertTrue(item['checks']['structure'], item['structural_checks'])
                    self.assertTrue(item['checks']['appearance'], item['measurements'])
                    self.assertEqual(item['facts']['depth'], int(item['selectors']['depth']))
                    self.assertEqual(item['measurements']['frames'][0]['fixture_class'],
                                     'avif-8' if item['selectors']['range'] == 'hdr' else 'sdr-8')
                    if item['geometry'] == 'orientation':
                        self.assertEqual(item['source_facts']['orientation'], 8)
                        self.assertTrue(item['orientation_bake']['exact_rotated_samples'])
                        self.assertTrue(item['orientation_bake']['passed'])
                    self.assertEqual(item['status'], 'qualified')
                    self.assertEqual(item['consumer_status'], 'pending manual review')

    def test_changed_orientation_hash_withholds_all_candidate_conversions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = next(hdr_png8.fixture_specs())
            lock = json.loads(hdr_png8_geometry.ORIENTATION_LOCK.read_text())
            lock['sha256'][spec['id'] + '-orientation-8'] = '0' * 64
            changed = root/'changed-orientation-lock.json'
            changed.write_text(json.dumps(lock))
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'source hash/qualification mismatch'):
                hdr_png8_geometry.run(root/'proof', specs=[spec], orientation_lock=changed)
            self.assertFalse(any(command['argv'][0] in ('avifenc', 'avifdec')
                                 or '-filter_complex' in command['argv']
                                 for command in avif.COMMANDS[start:]))
            self.assertFalse(list((root/'proof').rglob('output.*')))


if __name__ == '__main__':
    unittest.main()
