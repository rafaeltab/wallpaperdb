"""Authored SDR JPEG evidence needs real pixels, actual ICC and native storage."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

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


class GainMapAvifJpegGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_jpeg.run(cls.root/'proof', geometries=('contain', 'cover', 'fill', 'upscale'))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_all_actual_geometries_keep_source_color_precision_and_matrix_evidence(self):
        evidence = self.result['evidence']
        self.assertEqual(len(evidence), 4)
        self.assertEqual(len({case['case_id'] for case in evidence}), 4)
        self.assertEqual(len(self.result['source_fixtures']), 1)
        for case in evidence:
            with self.subTest(geometry=case['geometry']):
                self.assertIn('sdr', case['measurements'], case['blockers'])
                dimensions = gainmap_avif_jpeg.SIZES[case['geometry']]
                self.assertEqual((case['facts']['width'], case['facts']['height']), dimensions)
                for name in ('native_encoder', 'native_preparation', 'independent_source_decoder', 'independent_decoder', 'structure', 'privacy'):
                    self.assertTrue(case['checks'][name], case['blockers'])
                self.assertEqual((case['facts']['sof'], case['facts']['depth']), (0, 8))
                self.assertEqual((case['facts']['gamut'], case['facts']['transfer']), ('srgb', 'srgb'))
                self.assertEqual(case['native_preparation']['geometry'], case['geometry'])
                self.assertEqual(case['native_candidate']['input_sha256'], case['native_preparation']['artifacts']['sha256'])
                self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
                self.assertEqual(case['consumer_status'], 'pending manual review')
        matrix = build_matrix(evidence)
        self.assertEqual(matrix['evidence_errors'], [])
        actual = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:sdr:jpg')['evidence']
        self.assertEqual([(case['case_id'], case['status']) for case in actual], [(case['case_id'], case['status']) for case in evidence])
        self.assertEqual([case['status'] for case in evidence], ['qualified', 'qualified', 'qualified', 'tested and failed'])
        for case in evidence[:3]:
            self.assertTrue(all(case['checks'].values()))
        failed = evidence[3]
        self.assertEqual(failed['geometry'], 'upscale')
        self.assertEqual(failed['artifacts']['sha256'], 'f3be6e4c6e560ece389f853d484eb2470faaca6cbc2ec3ee9e58ffe89720f5b1')
        self.assertFalse(failed['checks']['native_storage_appearance'])
        self.assertFalse(failed['checks']['appearance'])
        for name in ('sdr', 'native_storage'):
            self.assertEqual(failed['measurements'][name]['failures'], ['shadow.delta_e_max'])
            self.assertAlmostEqual(failed['measurements'][name]['regions']['shadow']['delta_e_itp']['maximum'], 25.494851450009584, places=6)

    def test_invalid_geometry_lists_and_mismatched_selectors_stop_before_native_work(self):
        for geometries in ((), ('contain', 'contain'), ('orientation',), ('crop',), ('unknown',)):
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_jpeg.run(self.root/'invalid', geometries=geometries)
            self.assertEqual(len(avif.COMMANDS), start)
        for geometries in (('contain', 'cover'), ('cover',), ('fill',), ('upscale',)):
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_jpeg.run(self.root/'invalid-selectors', geometries=geometries, selectors=gainmap_avif_jpeg.SELECTORS)
            self.assertEqual(len(avif.COMMANDS), start)

    def test_actual_cover_dimensions_cannot_borrow_containment_facts(self):
        cover = next(case for case in self.result['evidence'] if case['geometry'] == 'cover')
        start = len(avif.COMMANDS)
        with self.assertRaisesRegex(ValueError, 'geometry'):
            gainmap_avif_jpeg.inspect_and_decode(Path(cover['artifacts']['output']))
        self.assertEqual(len(avif.COMMANDS), start)

    def test_containment_bytes_status_and_every_measurement_remain_exact(self):
        case = next(case for case in self.result['evidence'] if case['geometry'] == 'contain')
        self.assertEqual(case['status'], 'qualified')
        self.assertEqual(case['artifacts']['sha256'], 'fe78297586abb65828565ab94185a57898a9ec5926f6d8b30a8a2db555d5be5e')
        measured_hash = hashlib.sha256(json.dumps(case['measurements'], sort_keys=True).encode()).hexdigest()
        self.assertEqual(measured_hash, '9cb5b9a6773ad4f0f32e309087f39be4bd3e48b50fb3a058161aa3896fb306c9')


class GainMapAvifJpegGamma32Tests(unittest.TestCase):
    def test_native_transfer_matches_every_rgb8_code_without_reference_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            codes = np.arange(256, dtype=np.uint8)
            samples = np.stack((codes, codes[::-1], np.roll(codes, 37)), axis=-1)[None, ...]
            source, output = root/'native-input.png', root/'gamma32.png'
            Image.fromarray(samples).save(source)
            facts = gainmap_avif_jpeg._gamma32_input(source, output)
            signal = samples.astype(float)/255
            linear = np.where(signal <= .04045, signal/12.92, ((signal+.055)/1.055)**2.4)
            expected = np.floor(np.floor(linear**(1/3.2)*65535)*255/65535+.5).astype(np.uint8)
            with Image.open(output) as image:
                actual = np.asarray(image)
            np.testing.assert_array_equal(actual, expected)
            self.assertTrue(facts['passed'])
            self.assertEqual(facts['mismatched_coding_samples'], 0)
            self.assertTrue(facts['independent_decode_exact'])
            self.assertEqual(facts['input_sha256'], avif.digest(source))
            self.assertEqual(facts['output_sha256'], avif.digest(output))

    def test_gamma32_is_bounded_to_an_explicit_upscale_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            for geometries in (('contain',), ('cover',), ('fill',)):
                start = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'gamma3.2.*upscale'):
                    gainmap_avif_jpeg.run(temporary, geometries=geometries, gamma32_upscale=True)
                self.assertEqual(len(avif.COMMANDS), start)


class GainMapAvifJpegGamma32EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_jpeg.run(cls.root/'proof', geometries=('contain', 'cover', 'fill', 'upscale'), gamma32_upscale=True)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_optional_transfer_keeps_all_four_standard_candidates_exact(self):
        evidence = self.result['evidence']
        self.assertEqual(len(evidence), 5)
        expected = (
            ('fe78297586abb65828565ab94185a57898a9ec5926f6d8b30a8a2db555d5be5e', '9cb5b9a6773ad4f0f32e309087f39be4bd3e48b50fb3a058161aa3896fb306c9'),
            ('1b14f2e6cac11df6de6eea90850e4dc7a67877e62b35731a3232eae3086209c6', '9aad51fbcb9e2b42edceff41fe68b55033b95a3f8481953fe7078ca82e8f5679'),
            ('2614dfe0f7dd9610c235cbbb6087eee7d86f29d5e8e8438a2fe04f7c45ce6d39', '8c3fe41605898d259d5429328d8679bcb1e7ce842cb566abb1b68d41e8d92080'),
            ('f3be6e4c6e560ece389f853d484eb2470faaca6cbc2ec3ee9e58ffe89720f5b1', 'aa7aecd337be1ace5db4dcb6fc473179c4d2f8a25ef18afaf467b8a4181a0cab'))
        for case, (encoded, measured) in zip(evidence[:4], expected):
            self.assertEqual(case['artifacts']['sha256'], encoded)
            self.assertEqual(hashlib.sha256(json.dumps(case['measurements'], sort_keys=True).encode()).hexdigest(), measured)
        self.assertEqual([case['status'] for case in evidence[:4]], ['qualified']*3+['tested and failed'])

    def test_real_gamma32_case_uses_actual_icc_and_same_source_reference(self):
        self.assertEqual(len(self.result['evidence']), 5)
        standard, case = self.result['evidence'][-2:]
        self.assertEqual(case['candidate'], 'native-authored-base-jpeg-gamma32')
        self.assertNotEqual(case['case_id'], standard['case_id'])
        self.assertEqual(case['selectors'], standard['selectors'])
        self.assertEqual(case['reference_sdr'], standard['reference_sdr'])
        self.assertEqual(case['source_sha256'], standard['source_sha256'])
        self.assertEqual(case['native_candidate']['transfer_stage']['input_sha256'], standard['native_candidate']['input_sha256'])
        self.assertEqual(case['facts']['transfer'], 'gamma3.2')
        self.assertEqual(case['facts']['gamut'], 'srgb')
        self.assertTrue(case['facts']['rgb_packing_exact'])
        np.testing.assert_allclose(case['facts']['color']['gammas'], [3.2]*3, atol=1/65536, rtol=0)
        self.assertTrue(case['checks']['structure'], case['blockers'])
        self.assertTrue(case['checks']['privacy'], case['blockers'])
        self.assertEqual(case['threshold_scope']['thresholds_sha256'], standard['threshold_scope']['thresholds_sha256'])
        self.assertEqual(case['threshold_scope']['reference_revision'], standard['threshold_scope']['reference_revision'])
        self.assertEqual(case['status'], 'qualified' if all(case['checks'].values()) else 'tested and failed')
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(case['checks']['native_transfer'])
        self.assertEqual(case['artifacts']['sha256'], '2f6ac345b710717bd167bd1a7bccd4c62fc7410fa373ec9e81c3efefeb862bed')
        self.assertAlmostEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'], 3.8356176080182944, places=6)
        self.assertAlmostEqual(case['measurements']['native_storage']['regions']['shadow']['delta_e_itp']['maximum'], 3.6499951417726626, places=6)
        self.assertEqual(case['consumer_status'], 'pending manual review')
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        actual = next(cell for cell in matrix['cells'] if cell['id'] == 'avif-gainmap:sdr:jpg')['evidence']
        self.assertEqual([(row['case_id'], row['status']) for row in actual], [(row['case_id'], row['status']) for row in self.result['evidence']])

    def test_wrong_gamma_or_gamut_and_default_interpretation_reject_before_decode(self):
        self.assertEqual(len(self.result['evidence']), 5)
        case = self.result['evidence'][-1]
        data = Path(case['artifacts']['output']).read_bytes()
        start = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            gainmap_avif_jpeg.inspect_and_decode(case['artifacts']['output'], dimensions=(769, 576))
        self.assertEqual(len(avif.COMMANDS), start)
        for label, gamma, gamut in (('wrong-gamma', 2.2, 'srgb'), ('wrong-gamut', 3.2, 'p3')):
            profile, output = self.root/f'{label}.icc', self.root/f'{label}.jpg'
            profile.write_bytes(make_profile(gamma=gamma, gamut=gamut))
            output.write_bytes(data)
            avif.native(['exiftool', '-overwrite_original', f'-ICC_Profile<={profile}', output])
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_jpeg.inspect_and_decode(output, dimensions=(769, 576), gamma32=True)
            self.assertEqual(len(avif.COMMANDS), start)

    def test_incomplete_or_duplicate_gamma_icc_chunks_reject_before_decode(self):
        case = self.result['evidence'][-1]
        data = Path(case['artifacts']['output']).read_bytes()
        marker = b'ICC_PROFILE\x00\x01\x01'
        self.assertEqual(data.count(marker), 1)
        position = data.index(marker)-4
        length = int.from_bytes(data[position+2:position+4], 'big')+2
        segment = data[position:position+length]
        variants = (data.replace(marker, marker[:-1]+b'\x02'),
                    data[:position]+segment+data[position:],
                    data[:position]+data[position+length:])
        for index, changed in enumerate(variants):
            output = self.root/f'invalid-profile-{index}.jpg'
            output.write_bytes(changed)
            start = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                gainmap_avif_jpeg.inspect_and_decode(output, dimensions=(769, 576), gamma32=True)
            self.assertEqual(len(avif.COMMANDS), start)


if __name__ == '__main__':
    unittest.main()
