"""Authored SDR PNG needs independently checked native source and output codes."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

import avif
import gainmap_avif
import gainmap_avif_png
import hdr_png


class GainMapAvifPngTests(unittest.TestCase):
    def test_additional_geometries_preserve_exact_containment_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline = gainmap_avif_png.run(root/'baseline')
            expanded = gainmap_avif_png.run(root/'expanded', geometries=('contain', 'cover', 'fill', 'upscale'))
            self.assertEqual(len(expanded['evidence']), 4)
            self.assertEqual(len(expanded['source_fixtures']), 1)
            original = baseline['evidence'][0]
            sizes = {'contain': (173, 130), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 576)}
            for case in expanded['evidence']:
                with self.subTest(geometry=case['geometry']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertTrue(all(case['checks'].values()))
                    self.assertEqual((case['facts']['width'], case['facts']['height']), sizes[case['geometry']])
                    self.assertEqual(case['facts']['lossless_storage']['mismatched_rgba_samples'], 0)
                    self.assertEqual(case['facts']['libpng_source_depth'], 8)
                    self.assertEqual(case['facts']['physical_pixel_dimensions'], [1, 1, 0])
                    self.assertEqual(case['measurements']['sdr']['fixture_class'], 'gainmap-sdr')
                    self.assertEqual(case['consumer_status'], 'pending manual review')
                    if case['geometry'] == 'contain':
                        self.assertEqual(case['artifacts']['sha256'], '16bf329dbb17a14821b585b7a771d02a639bef9d5c7d097ed7a26d3ed53a905a')
                        for key in ('case_id', 'selectors', 'status', 'measurements'):
                            self.assertEqual(case[key], original[key])
            self.assertEqual([(item['case_id'], item['status']) for item in expanded['controls']],
                             [(item['case_id'], item['status']) for item in baseline['controls']])
            self.assertEqual(expanded['hdr_status'], 'untested')

    def test_unknown_duplicate_and_orientation_geometries_stop_before_native_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            for operations in ((), ('contain', 'contain'), ('orientation',), ('crop',), ('arbitrary',)):
                with self.subTest(geometries=operations):
                    start = len(avif.COMMANDS)
                    with self.assertRaisesRegex(ValueError, 'geometries'):
                        gainmap_avif_png.run(Path(temporary), geometries=operations)
                    self.assertEqual(len(avif.COMMANDS), start)

    def test_native_authored_containment_is_qualified_without_promoting_hdr(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = gainmap_avif_png.run(Path(temporary))
            self.assertEqual(len(result['evidence']), 1)
            self.assertEqual(result['fixtures'], [])
            self.assertEqual(len(result['source_fixtures']), 1)
            self.assertTrue(result['source_fixtures'][0]['source_lock']['passed'])
            case = result['evidence'][0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertEqual(case['cell_id'], 'avif-gainmap:sdr:png')
            self.assertEqual(case['selectors'], gainmap_avif_png.SELECTORS)
            self.assertEqual(case['measurements']['sdr']['fixture_class'], 'gainmap-sdr')
            facts = case['facts']
            self.assertEqual((facts['width'], facts['height'], facts['depth']), (173, 130, 8))
            self.assertEqual(facts['libpng_source_depth'], 8)
            self.assertEqual(facts['color_signaling'], 'sRGB with consistent cHRM/gAMA')
            self.assertEqual(facts['srgb_rendering_intent'], 1)
            self.assertEqual(facts['encoded_gamma'], 45455)
            self.assertEqual(facts['chromaticities'], [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000])
            self.assertEqual(facts['color_type'], 2)
            self.assertEqual(facts['physical_pixel_dimensions'], [1, 1, 0])
            self.assertTrue(facts['square_pixels'])
            self.assertTrue(facts['opaque'])
            self.assertEqual(facts['orientation'], 1)
            self.assertEqual(facts['lossless_storage']['mismatched_rgba_samples'], 0)
            self.assertTrue(case['native_candidate']['source_samples_match_dav1d'])
            self.assertTrue(all(control['passed'] for control in result['controls']))
            self.assertTrue(all(control['status'] == 'passed' for control in result['controls']))
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(result['hdr_status'], 'untested')

    def test_unproved_selectors_are_rejected_before_native_work(self):
        for change in ({'format': 'avif'}, {'range': 'hdr'}, {'gamut': 'p3'}, {'depth': '16'},
                       {'motion': 'static'}, {'transparency': 'coerce'}, {'w': 174},
                       {'h': 130}, {'fit': 'cover'}):
            with self.subTest(change=change):
                start = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'exact explicit SDR PNG containment'):
                    gainmap_avif_png.validate_selectors({**gainmap_avif_png.SELECTORS, **change})
                self.assertEqual(len(avif.COMMANDS), start)

    def test_changed_source_hash_stops_before_candidate_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = json.loads(gainmap_avif.SOURCE_LOCK.read_text())
            lock['sha256'][gainmap_avif.FIXTURE_ID] = '0' * 64
            changed = root/'changed-lock.json'
            changed.write_text(json.dumps(lock))
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'source hash'):
                gainmap_avif_png.run(root/'proof', source_lock=changed)
            self.assertFalse(any('-filter_complex' in command['argv'] for command in avif.COMMANDS[start:]))
            self.assertFalse(list((root/'proof').rglob('output.png')))

    def test_ambiguous_color_depth_animation_and_metadata_are_rejected_before_decode(self):
        def encoded(chunks):
            return b'\x89PNG\r\n\x1a\n' + b''.join(struct.pack('>I', len(payload)) + kind + payload
                + struct.pack('>I', zlib.crc32(kind + payload)) for kind, payload in chunks)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = gainmap_avif_png.run(root/'valid')
            output = Path(result['evidence'][0]['artifacts']['output'])
            chunks = hdr_png._png_chunks(output.read_bytes())
            variants = {
                'unknown-intent': [(kind, bytes((4,)) if kind == b'sRGB' else payload) for kind, payload in chunks],
                'missing-color': [(kind, payload) for kind, payload in chunks if kind != b'sRGB'],
                'duplicate-color': chunks[:1] + [(b'sRGB', bytes((1,)))] + chunks[1:],
                'conflicting-gamma': [(kind, struct.pack('>I', 50000) if kind == b'gAMA' else payload) for kind, payload in chunks],
                'conflicting-chromaticity': [(kind, bytes(32) if kind == b'cHRM' else payload) for kind, payload in chunks],
                'unknown-pixel-aspect': [(kind, struct.pack('>IIB', 0, 1, 0) if kind == b'pHYs' else payload) for kind, payload in chunks],
                'non-square-pixels': [(kind, struct.pack('>IIB', 2, 1, 0) if kind == b'pHYs' else payload) for kind, payload in chunks],
                'wrong-depth': [(kind, payload[:8] + bytes((16,)) + payload[9:] if kind == b'IHDR' else payload) for kind, payload in chunks],
            }
            for name, kind, payload in (('conflicting-icc', b'iCCP', b'test'),
                                       ('extra-cicp', b'cICP', bytes((1, 13, 0, 1))),
                                       ('animation', b'acTL', struct.pack('>II', 1, 0)),
                                       ('private-exif', b'eXIf', b'test')):
                variants[name] = chunks[:1] + [(kind, payload)] + chunks[1:]
            for name, modified in variants.items():
                with self.subTest(variant=name):
                    path = root/f'{name}.png'
                    path.write_bytes(encoded(modified))
                    start = len(avif.COMMANDS)
                    with self.assertRaises(ValueError):
                        gainmap_avif_png.inspect_and_decode(path)
                    self.assertEqual(len(avif.COMMANDS), start)


if __name__ == '__main__':
    unittest.main()
