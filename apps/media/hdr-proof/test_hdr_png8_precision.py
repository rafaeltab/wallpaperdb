"""Higher-depth PNG8 derivatives must satisfy the stricter output-depth gate."""
from collections import Counter
import json
from pathlib import Path
import tempfile
import unittest

import avif
import hdr_png8
import hdr_png8_precision


class PngEightBitPrecisionTests(unittest.TestCase):
    def test_native_high_precision_containment_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = hdr_png8_precision.run(Path(temporary))
            self.assertEqual(len(result['evidence']), 16)
            self.assertEqual(Counter(item['status'] for item in result['evidence']), {'qualified': 16})
            self.assertEqual(len(result['source_fixtures']), 8)
            for fixture in result['source_fixtures']:
                self.assertTrue(fixture['source_valid'])
                self.assertTrue(fixture['source_lock']['passed'])
                self.assertEqual(fixture['source_appearance']['fixture_class'], 'avif-8')
            for item in result['evidence']:
                with self.subTest(case=item['case_id']):
                    self.assertTrue(all(item['checks'].values()), item['blockers'])
                    self.assertEqual(item['source_facts']['depth'], 8)
                    depth = 16 if item['selectors']['format'] == 'png' else 12
                    self.assertEqual(item['selectors']['depth'], str(depth))
                    self.assertEqual(item['facts']['depth'], depth)
                    self.assertTrue(item['case_id'].endswith(f':depth{depth}'))
                    self.assertEqual((item['facts']['width'], item['facts']['height']), (57, 38))
                    self.assertEqual(item['measurements']['frames'][0]['fixture_class'], 'avif-12')
                    self.assertTrue(item['source_normalization']['passed'])
                    self.assertEqual(item['source_normalization']['mismatched_samples'], 0)
                    alpha = item['facts']['alpha_measurement']
                    self.assertEqual(alpha['absolute_error_limit'], 2 / (2 ** depth - 1))
                    self.assertLessEqual(alpha['maximum_absolute_error'], alpha['absolute_error_limit'])
                    self.assertEqual(item['consumer_status'], 'pending manual review')

    def test_changed_source_hash_stops_before_high_precision_converters(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = next(hdr_png8.fixture_specs())
            lock = json.loads(hdr_png8_precision.SOURCE_LOCK.read_text())
            lock['sha256'][spec['id']] = '0' * 64
            changed = root/'changed-source-lock.json'
            changed.write_text(json.dumps(lock))
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'source hash/qualification mismatch'):
                hdr_png8_precision.run(root/'proof', specs=[spec], source_lock=changed)
            self.assertFalse(any(command['argv'][0] in ('avifenc', 'avifdec')
                                 or '-filter_complex' in command['argv']
                                 for command in avif.COMMANDS[start:]))
            self.assertFalse(list((root/'proof').rglob('output.*')))


if __name__ == '__main__':
    unittest.main()
