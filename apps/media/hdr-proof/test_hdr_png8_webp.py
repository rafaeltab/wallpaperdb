"""PNG8 SDR WebP needs actual ICC semantics and independent native pixels."""
from collections import Counter
import json
from pathlib import Path
import struct
import tempfile
import unittest

import avif
import hdr_png8
import hdr_png8_webp


class PngEightBitWebpTests(unittest.TestCase):
    def test_nearest_candidates_keep_legacy_bytes_and_measurements(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline = hdr_png8_webp.run(root/'baseline')
            extended = hdr_png8_webp.run(root/'nearest', nearest_quantization=True)
            self.assertEqual(len(extended['evidence']), 16)
            self.assertEqual(Counter(item['status'] for item in extended['evidence']), {'qualified': 16})
            originals = {item['case_id']: item for item in baseline['evidence']}
            for item in extended['evidence']:
                with self.subTest(case=item['case_id']):
                    if item['case_id'] in originals:
                        before = originals[item['case_id']]
                        self.assertEqual(item['artifacts']['sha256'], before['artifacts']['sha256'])
                        self.assertEqual(item['measurements']['frames'], before['measurements']['frames'])
                        self.assertEqual(item['status'], before['status'])
                        continue
                    self.assertTrue(item['case_id'].endswith(':nearest8'))
                    self.assertTrue(item['quantization_measurement']['passed'])
                    self.assertEqual(item['quantization_measurement']['mismatched_nearest_codes'], 0)
                    self.assertLessEqual(item['quantization_measurement']['maximum_rgb_error'], .5 / 255)
                    self.assertLessEqual(item['quantization_measurement']['maximum_alpha_error'], .5 / 255)
                    self.assertTrue(all(item['checks'].values()), item['blockers'])
                    before = originals[item['case_id'].removesuffix(':nearest8')]
                    self.assertLessEqual(item['facts']['alpha_measurement']['maximum_absolute_error'],
                                         before['facts']['alpha_measurement']['maximum_absolute_error'])
            # The same independent stage gate must detect the original native
            # conversion's rounding bias; a decodable lossless file is not enough.
            first = Path(baseline['evidence'][0]['artifacts']['output']).parent
            previous_rounding = hdr_png8_webp.inspect_quantization(
                first/'output-gamma22-0.png', first/'output-gamma22-8-0.png')
            self.assertFalse(previous_rounding['passed'])
            self.assertGreater(previous_rounding['mismatched_nearest_codes'], 0)

    def test_all_containment_outputs_preserve_the_declared_sdr_grade_and_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = hdr_png8_webp.run(Path(temporary))
            self.assertEqual(len(result['evidence']), 8)
            self.assertEqual(Counter(item['status'] for item in result['evidence']), {'qualified': 8})
            self.assertEqual(result['fixtures'], [])
            self.assertEqual(len(result['source_fixtures']), 8)
            for item in result['evidence']:
                with self.subTest(case=item['case_id']):
                    self.assertTrue(all(item['checks'].values()), item['blockers'])
                    self.assertEqual(item['selectors']['transparency'], 'preserve')
                    self.assertEqual(item['selectors']['depth'], '8')
                    facts = item['facts']
                    self.assertEqual((facts['width'], facts['height'], facts['depth']), (57, 38, 8))
                    self.assertTrue(facts['icc']['gamma22_srgb_primaries'])
                    self.assertEqual(facts['container']['coding'], 'VP8L version 0, RGB8/RGBA8')
                    self.assertEqual(facts['independent_decoder_agreement']['mismatched_rgba_samples'], 0)
                    self.assertEqual(facts['lossless_storage']['mismatched_rgba_samples'], 0)
                    self.assertEqual(facts['alpha_measurement']['absolute_error_limit'], 2 / 255)
                    self.assertLessEqual(facts['alpha_measurement']['maximum_absolute_error'], 2 / 255)
                    self.assertTrue(item['source_normalization']['passed'])
                    self.assertTrue(item['measurements']['tone_controls'][0]['passed'])
                    self.assertEqual(item['measurements']['frames'][0]['fixture_class'], 'sdr-8')
                    self.assertEqual(item['consumer_status'], 'pending manual review')

    def test_malformed_container_or_metadata_is_rejected_before_native_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = hdr_png8_webp.run(root/'valid', specs=[next(hdr_png8.fixture_specs())])
            data = Path(result['evidence'][0]['artifacts']['output']).read_bytes()
            animation = bytearray(data)
            self.assertEqual(animation[12:16], b'VP8X')
            animation[20] |= 2
            dimensions = bytearray(data)
            dimensions[24] ^= 1
            metadata = bytearray(data + struct.pack('<4sI', b'EXIF', 4) + b'test')
            struct.pack_into('<I', metadata, 4, len(metadata) - 8)
            for name, modified in (('trailing', data + b'bad'), ('animation', animation),
                                   ('canvas', dimensions), ('private-metadata', metadata)):
                with self.subTest(variant=name):
                    output = root/f'{name}.webp'
                    output.write_bytes(modified)
                    start = len(avif.COMMANDS)
                    with self.assertRaises(ValueError):
                        hdr_png8_webp.inspect_and_decode(output)
                    self.assertEqual(len(avif.COMMANDS), start)

    def test_changed_source_hash_stops_before_webp_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = next(hdr_png8.fixture_specs())
            lock = json.loads(hdr_png8_webp.SOURCE_LOCK.read_text())
            lock['sha256'][spec['id']] = '0' * 64
            changed = root/'changed-source-lock.json'
            changed.write_text(json.dumps(lock))
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'source hash/qualification mismatch'):
                hdr_png8_webp.run(root/'proof', specs=[spec], source_lock=changed)
            self.assertFalse(any(command['argv'][0] == 'node' or '-filter_complex' in command['argv']
                                 for command in avif.COMMANDS[start:]))
            self.assertFalse(list((root/'proof').rglob('output.*')))


if __name__ == '__main__':
    unittest.main()
