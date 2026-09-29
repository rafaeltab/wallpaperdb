"""Authored SDR JPEG evidence needs real pixels, actual ICC and native storage."""
from pathlib import Path
import tempfile
import unittest

import avif
import gainmap_avif
import gainmap_avif_jpeg
from gamma_icc import make_profile
from matrix import build_matrix


class GainMapAvifJpegTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_jpeg.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_baseline_has_actual_rgb8_and_srgb_color_facts(self):
        self.assertEqual(len(self.result['evidence']), 1)
        case = self.result['evidence'][0]
        self.assertIn('sdr', case['measurements'], case['blockers'])
        self.assertEqual(case['candidate'], 'native-authored-base-jpeg-srgb')
        self.assertEqual(case['selectors'], gainmap_avif_jpeg.SELECTORS)
        self.assertEqual(case['source_sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
        self.assertTrue(case['checks']['native_encoder'])
        self.assertTrue(case['checks']['native_preparation'])
        self.assertTrue(case['checks']['structure'])
        self.assertTrue(case['checks']['privacy'])
        facts = case['facts']
        self.assertEqual((facts['width'], facts['height'], facts['depth'], facts['sof']), (173, 130, 8, 0))
        self.assertEqual((facts['gamut'], facts['transfer']), ('srgb', 'srgb'))
        self.assertEqual(facts['orientation'], 1)
        self.assertEqual(facts['frames'], 1)
        self.assertTrue(facts['opaque'])
        self.assertTrue(facts['no_aspect_override'])
        self.assertFalse(facts['aspect_ratio_explicitly_signaled'])
        self.assertTrue(facts['rgb_packing_exact'])
        self.assertEqual(facts['packet_facts']['streams'][0]['pix_fmt'], 'gbrp')
        self.assertEqual(facts['color']['icc_sha256'], case['native_candidate']['icc_sha256'])
        self.assertEqual(case['threshold_scope']['profile'], 'gainmap-sdr')
        self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
        self.assertEqual(case['threshold_scope']['reference_revision'], 'gainmap-avif-authored-base-pillow-lanczos-v1')
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['artifacts']['sha256'], 'fe78297586abb65828565ab94185a57898a9ec5926f6d8b30a8a2db555d5be5e')
        self.assertAlmostEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'], 3.52674520989537, places=6)
        self.assertEqual(case['measurements']['sdr']['regions']['highlight']['samples'], 0)
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
        self.assertTrue(all(row['passed'] for row in self.result['controls']))

    def test_real_evidence_keeps_its_exact_status_in_the_conversion_matrix(self):
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        actual = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:sdr:jpg')['evidence']
        self.assertEqual([(case['case_id'], case['status']) for case in actual],
                         [(case['case_id'], case['status']) for case in self.result['evidence']])

    def test_unproved_selectors_are_rejected_before_native_work(self):
        for change in ({'range': 'hdr'}, {'format': 'avif'}, {'depth': '16'}, {'depth': '8'}, {'gamut': 'p3'},
                       {'w': 174}, {'fit': 'cover'}, {'h': 130}, {'motion': 'animate'}, {'transparency': 'coerce'}):
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'authored SDR JPEG containment'):
                gainmap_avif_jpeg.run(self.root/'wrong-selectors', selectors={**gainmap_avif_jpeg.SELECTORS, **change})
            self.assertEqual(len(avif.COMMANDS), start)

    def test_unknown_source_facts_remain_exact_original_only(self):
        source = Path(self.result['source_fixtures'][0]['path'])
        data = source.read_bytes()
        marker = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
        self.assertEqual(data.count(marker), 1)
        changed = self.root/'unknown-color.avif'
        changed.write_bytes(data.replace(marker, b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
        start = len(avif.COMMANDS)
        result = gainmap_avif_jpeg.source_decision(changed, self.root/'unknown-source')
        self.assertEqual(result['action'], 'original only')
        self.assertEqual(len(avif.COMMANDS), start)
        self.assertTrue(gainmap_avif.copy_original(changed, self.root/'original.avif')['exact_bytes'])

    def test_parseable_source_metadata_change_cannot_bypass_provenance(self):
        source = Path(self.result['source_fixtures'][0]['path'])
        data = source.read_bytes()
        marker = bytes(5)+b'\xc0'+bytes(4)+b'\x00\x00\x00\x01'+b'\x00\x00\x00\x07\x00\x00\x00\x02'
        self.assertEqual(data.count(marker), 1)
        changed = self.root/'changed-source.avif'
        changed.write_bytes(data.replace(marker, marker[:-8]+b'\x00\x00\x00\x08\x00\x00\x00\x02'))
        gainmap_avif.parse_source(changed.read_bytes())
        start = len(avif.COMMANDS)
        decision = gainmap_avif_jpeg.source_decision(changed, self.root/'changed-provenance')
        self.assertEqual(decision['action'], 'original only')
        self.assertIn('source hash', decision['reason'])
        self.assertEqual(len(avif.COMMANDS), start)

    def test_private_orientation_and_unknown_icc_reject_before_pixel_decode(self):
        data = Path(self.result['evidence'][0]['artifacts']['output']).read_bytes()
        profile = self.root/'wrong.icc'
        profile.write_bytes(make_profile(gamma=2.2))
        for name, argument in (('profile', f'-ICC_Profile<={profile}'), ('privacy', '-XMP:Creator=proof-private'),
                               ('orientation', '-EXIF:Orientation#=8')):
            path = self.root/f'{name}.jpg'
            path.write_bytes(data)
            avif.native(['exiftool', '-overwrite_original', argument, path])
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_jpeg.inspect_and_decode(path)
            self.assertEqual(len(avif.COMMANDS), start)

    def test_extra_images_missing_scan_and_unknown_rgb_depth_reject(self):
        original = Path(self.result['evidence'][0]['artifacts']['output']).read_bytes()
        scan = original.index(b'\xff\xda')
        scan_start = scan+2+int.from_bytes(original[scan+2:scan+4], 'big')
        sof = original.index(b'\xff\xc0')
        changed_depth = original[:sof+4]+b'\x0c'+original[sof+5:]
        aspect = b'JFIF\x00\x01\x02\x00\x00\x01\x00\x02\x00\x00'
        aspect_segment = b'\xff\xe0'+(len(aspect)+2).to_bytes(2, 'big')+aspect
        adobe = b'Adobe\x00\x64'+bytes(5)
        self.assertEqual(original.count(adobe), 1)
        variants = {'trailing': original+b'private', 'two-images': original+original,
                    'missing-scan': original[:scan_start]+b'\xff\xd9', 'depth12': changed_depth,
                    'nonsquare-aspect': original[:2]+aspect_segment+original[2:],
                    'conflicting-transform': original.replace(adobe, adobe[:-1]+b'\x01')}
        for name, data in variants.items():
            path = self.root/f'{name}.jpg'
            path.write_bytes(data)
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_jpeg.inspect_and_decode(path)
            self.assertEqual(len(avif.COMMANDS), start)


if __name__ == '__main__':
    unittest.main()
