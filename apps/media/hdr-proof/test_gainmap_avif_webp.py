"""Native WebP containment keeps the authored SDR base and exact storage."""
from pathlib import Path
import tempfile
import unittest

import avif
import gainmap_avif_webp
from gamma_icc import make_profile


class GainmapAvifWebpTests(unittest.TestCase):
    def test_actual_native_containment_passes_every_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = gainmap_avif_webp.run(Path(temporary))
            case = result['evidence'][0]
            self.assertEqual(len(result['evidence']), 1)
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertEqual(case['facts']['format'], 'webp')
            self.assertEqual(case['facts']['depth'], 8)
            self.assertEqual(case['facts']['transfer'], 'srgb')
            self.assertEqual(case['facts']['gamut'], 'srgb')
            self.assertEqual((case['facts']['width'], case['facts']['height']), (173, 130))
            self.assertEqual(case['storage_measurement']['mismatched_samples'], 0)
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(all(row['status'] == 'passed' for row in result['controls']))
            self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])
            self.assertEqual(case['artifacts']['sha256'],
                             '2b33147c1df616e87ed67f986aaa0da2f8383cf2fad7bddf4c50bbd9c12ccc20')
            self.assertTrue(result['commands'])

    def test_other_selectors_cannot_borrow_containment_evidence(self):
        for changes in ({'format': 'jpg'}, {'range': 'hdr'}, {'depth': '16'},
                        {'gamut': 'p3'}, {'w': 174}, {'fit': 'cover'}, {'motion': 'animate'}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'exact'):
                gainmap_avif_webp.validate_selectors({**gainmap_avif_webp.SELECTORS, **changes})

    def test_wrong_profile_or_private_metadata_cannot_pass_inspection(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            case = gainmap_avif_webp.run(folder)['evidence'][0]
            output = Path(case['artifacts']['output'])
            original = output.read_bytes()
            profile = folder/'wrong.icc'
            profile.write_bytes(make_profile(gamma=2.2))
            avif.native(['exiftool', '-overwrite_original', f'-ICC_Profile<={profile}', output])
            with self.assertRaises(ValueError):
                gainmap_avif_webp.inspect_and_decode(output)
            output.write_bytes(original)
            avif.native(['exiftool', '-overwrite_original', '-XMP:Creator=privacy-control', output])
            with self.assertRaisesRegex(ValueError, 'WebP'):
                gainmap_avif_webp.inspect_and_decode(output)
