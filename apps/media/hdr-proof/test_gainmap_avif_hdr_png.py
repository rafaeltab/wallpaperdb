"""PNG16 metadata correction must preserve independently decoded HDR samples."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

import avif
import gainmap_avif
import gainmap_avif_hdr_png
import hdr_png


class GainMapAvifHdrPngTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_hdr_png.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_additional_geometries_preserve_containment_and_failed_metadata_cases(self):
        expanded = gainmap_avif_hdr_png.run(self.root/'geometries', geometries=('contain', 'cover', 'fill', 'upscale'))
        self.assertEqual(len(expanded['evidence']), 8)
        self.assertEqual(len({case['case_id'] for case in expanded['evidence']}), 8)
        self.assertEqual(len(expanded['source_reconstruction_profiles']), 1)
        originals = {case['candidate']: case for case in self.result['evidence']}
        sizes = {'contain': (173, 130), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 576)}
        for case in expanded['evidence']:
            with self.subTest(candidate=case['candidate'], geometry=case['geometry']):
                original = originals[case['candidate']]
                self.assertEqual(case['source_sha256'], original['source_sha256'])
                self.assertEqual(case['measurements']['source'], original['measurements']['source'])
                self.assertEqual(case['native_geometry']['normalization_nits'], 203)
                self.assertEqual(case['status'], original['status'], case['blockers'])
                self.assertEqual(case['checks'], original['checks'])
                self.assertEqual((case['facts']['width'], case['facts']['height']), sizes[case['geometry']])
                self.assertEqual(case['facts']['lossless_metadata_correction']['mismatched_rgba_samples'], 0)
                self.assertEqual(case['selectors']['depth'], '16')
                self.assertEqual(case['selectors']['gamut'], 'preserve')
                self.assertEqual(case['selectors']['range'], 'hdr')
                self.assertEqual(case['privacy_measurement']['private_tags'], [])
                self.assertEqual(case['consumer_status'], 'pending manual review')
                if case['geometry'] == 'contain':
                    for key in ('case_id', 'selectors', 'status', 'checks', 'measurements', 'threshold_scope'):
                        self.assertEqual(case[key], original[key])
                    self.assertEqual(case['artifacts']['sha256'], original['artifacts']['sha256'])
        for operation in sizes:
            pair = [case for case in expanded['evidence'] if case['geometry'] == operation]
            self.assertEqual(pair[0]['measurements'], pair[1]['measurements'])
            self.assertEqual(pair[0]['facts']['rgba16_sha256'], pair[1]['facts']['rgba16_sha256'])
        self.assertEqual([(item['case_id'], item['status']) for item in expanded['controls']],
                         [(item['case_id'], item['status']) for item in self.result['controls']])

    def test_unknown_duplicate_and_orientation_geometries_stop_before_native_work(self):
        for operations in ((), ('contain', 'contain'), ('orientation',), ('crop',), ('arbitrary',)):
            with self.subTest(geometries=operations):
                before = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'geometries'):
                    gainmap_avif_hdr_png.run(self.root/'unknown-geometry', geometries=operations)
                self.assertEqual(len(avif.COMMANDS), before)

    def test_original_aspect_failure_and_corrected_native_png_are_separate(self):
        baseline, corrected = self.result['evidence']
        self.assertEqual(baseline['candidate'], 'native-pq16-unspecified-aspect')
        self.assertEqual(corrected['candidate'], 'native-pq16-square-pixels')
        self.assertEqual(baseline['status'], 'tested and failed')
        self.assertEqual(baseline['blockers'], ['Failed structure check'])
        self.assertFalse(baseline['structural_checks']['square_pixels'])
        self.assertEqual(baseline['facts']['physical_pixel_dimensions'], [0, 1, 0])
        self.assertEqual(baseline['artifacts']['sha256'], '5366e1ce3bf90576ec1d4c1ec759d0a9a9090940c6e74e0964c48a289dbbbeeb')
        self.assertEqual(corrected['status'], 'qualified', corrected['blockers'])
        self.assertTrue(all(corrected['checks'].values()))
        self.assertTrue(all(corrected['structural_checks'].values()))
        self.assertEqual(corrected['facts']['physical_pixel_dimensions'], [1, 1, 0])
        self.assertEqual(corrected['facts']['lossless_metadata_correction']['mismatched_rgba_samples'], 0)
        self.assertEqual(baseline['measurements'], corrected['measurements'])
        self.assertEqual(corrected['artifacts']['sha256'], 'fb335e70e3baaa2c3685797bde33edc70ac6e5f7d1f98794e2b53abf188bb1da')
        for case in self.result['evidence']:
            self.assertEqual(case['selectors'], gainmap_avif_hdr_png.SELECTORS)
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['facts']['cicp'], [1, 16, 0, 1])
            self.assertEqual(case['facts']['libpng_source_depth'], 16)
            self.assertEqual((case['facts']['width'], case['facts']['height'], case['facts']['color_type']), (173, 130, 2))
            self.assertTrue(case['facts']['native_decoders_agree'])
            self.assertTrue(case['facts']['opaque'])
            self.assertEqual(case['privacy_measurement']['private_tags'], [])
            self.assertTrue(case['measurements']['source']['passed'])
            self.assertTrue(case['measurements']['linear_geometry']['passed'])
            self.assertTrue(case['measurements']['native_storage']['passed'])
            self.assertTrue(case['measurements']['hdr']['passed'])
            self.assertAlmostEqual(case['measurements']['hdr']['regions']['midtone']['delta_e_itp']['maximum'],
                                   .28996237561548527, places=6)
            self.assertEqual(case['native_geometry']['normalization_nits'], 203)
            self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
        self.assertTrue(all(control['passed'] for control in self.result['controls']))

    def test_source_and_reference_scope_remain_locked(self):
        fixture = self.result['source_fixtures'][0]
        self.assertEqual(fixture['sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
        self.assertEqual(fixture['facts']['base']['depths'], [8, 8, 8])
        self.assertEqual(fixture['facts']['map']['depths'], [8])
        self.assertEqual(len(self.result['source_reconstruction_profiles']), 1)
        self.assertEqual(self.result['source_reconstruction_profiles'][0]['status'], 'qualified')
        for case in self.result['evidence']:
            self.assertEqual(case['threshold_scope']['profile'], 'gainmap-hdr')
            self.assertEqual(case['threshold_scope']['reference_revision'], 'gainmap-avif-hdr-bilinear8-lanczosfloat-v1')
            self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
            self.assertIn('implementation-defined', case['threshold_scope']['sampling_rationale'])
            self.assertEqual(case['source_sha256'], fixture['sha256'])

    def test_actual_metadata_conflicts_reject_before_native_decode(self):
        def encode(chunks):
            return b'\x89PNG\r\n\x1a\n'+b''.join(struct.pack('>I', len(payload))+kind+payload+
                struct.pack('>I', zlib.crc32(kind+payload)) for kind, payload in chunks)
        path = Path(self.result['evidence'][1]['artifacts']['output'])
        chunks = hdr_png._png_chunks(path.read_bytes())
        changes = {
            'unknown-aspect': [(kind, struct.pack('>IIB', 0, 1, 0) if kind == b'pHYs' else payload) for kind, payload in chunks],
            'non-square-aspect': [(kind, struct.pack('>IIB', 2, 1, 0) if kind == b'pHYs' else payload) for kind, payload in chunks],
            'missing-color': [(kind, payload) for kind, payload in chunks if kind != b'cICP'],
            'sdr-transfer': [(kind, bytes((1, 13, 0, 1)) if kind == b'cICP' else payload) for kind, payload in chunks],
            'different-gamut': [(kind, bytes((12, 16, 0, 1)) if kind == b'cICP' else payload) for kind, payload in chunks],
            'conflicting-chromaticity': [(kind, bytes(32) if kind == b'cHRM' else payload) for kind, payload in chunks],
            'wrong-depth': [(kind, payload[:8]+bytes((8,))+payload[9:] if kind == b'IHDR' else payload) for kind, payload in chunks],
        }
        for name, kind, payload in (('duplicate-color', b'cICP', bytes((1, 16, 0, 1))),
                                   ('animation', b'acTL', struct.pack('>II', 1, 0)),
                                   ('private-exif', b'eXIf', b'test'), ('icc', b'iCCP', b'test')):
            changes[name] = chunks[:1]+[(kind, payload)]+chunks[1:]
        for name, changed in changes.items():
            with self.subTest(variant=name):
                target = self.root/f'{name}.png'
                target.write_bytes(encode(changed))
                before = len(avif.COMMANDS)
                with self.assertRaises(ValueError):
                    gainmap_avif_hdr_png.inspect_and_decode(target)
                self.assertEqual(len(avif.COMMANDS), before)

    def test_unproved_selectors_stop_before_native_processing(self):
        for change in ({'depth': 'preserve'}, {'depth': '8'}, {'format': 'avif'}, {'range': 'sdr'}, {'gamut': 'p3'},
                       {'motion': 'animate'}, {'transparency': 'coerce'}, {'w': 174}, {'h': 130}, {'fit': 'cover'}):
            with self.subTest(change=change):
                before = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'explicit PQ PNG16 containment'):
                    gainmap_avif_hdr_png.run(self.root/'unsupported', selectors={**gainmap_avif_hdr_png.SELECTORS, **change})
                self.assertEqual(len(avif.COMMANDS), before)

    def test_changed_source_hash_stops_before_native_reconstruction(self):
        lock = json.loads(gainmap_avif.SOURCE_LOCK.read_text())
        lock['sha256'][gainmap_avif.FIXTURE_ID] = '0'*64
        path = self.root/'changed-lock.json'
        path.write_text(json.dumps(lock))
        before = len(avif.COMMANDS)
        with self.assertRaisesRegex(ValueError, 'source hash'):
            gainmap_avif_hdr_png.run(self.root/'changed-source', source_lock=path)
        self.assertFalse(any('-filter_complex' in record['argv'] for record in avif.COMMANDS[before:]))
        self.assertFalse(list((self.root/'changed-source').rglob('output.png')))

    def test_unknown_float_normalization_and_color_cannot_reach_png_encoder(self):
        linear = self.result['evidence'][1]['native_geometry']
        for change in ({'normalization_nits': 10000}, {'gamut': 'p3'}, {'format': 'gbrp16le'}, {'width': 174}):
            with self.subTest(change=change):
                before = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'normalization, primaries, precision'):
                    gainmap_avif_hdr_png._write_original({**linear, **change}, self.root/'unproved.png')
                self.assertEqual(len(avif.COMMANDS), before)
                self.assertFalse((self.root/'unproved.png').exists())


if __name__ == '__main__':
    unittest.main()
