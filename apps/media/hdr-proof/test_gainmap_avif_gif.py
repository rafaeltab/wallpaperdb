"""Native photographic palette failures must remain measured, never inferred."""
from pathlib import Path
import json
import tempfile
import unittest

import avif
import gainmap_avif
from gainmap_avif_gif import SELECTORS, inspect_and_decode, run


class GainmapAvifGifTests(unittest.TestCase):
    def test_real_native_containment_records_palette_and_appearance_separately(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = run(Path(temporary))
            self.assertEqual(len(result['evidence']), 1)
            case = result['evidence'][0]
            self.assertTrue(case['checks']['native_encoder'], case['blockers'])
            self.assertTrue(case['checks']['independent_decoder'], case['blockers'])
            self.assertTrue(case['checks']['structure'], case['blockers'])
            self.assertTrue(case['checks']['privacy'], case['blockers'])
            self.assertEqual(case['facts']['palette_channel_depth'], 8)
            self.assertEqual(case['facts']['frames'], 1)
            self.assertTrue(case['facts']['opaque'])
            self.assertEqual(case['facts']['transfer'], 'srgb')
            self.assertIn('palette', case['measurements'])
            self.assertIn('sdr', case['measurements'])
            self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
            self.assertEqual(case['status'], 'tested and failed')
            self.assertFalse(case['checks']['native_palette'])
            self.assertFalse(case['checks']['appearance'])
            self.assertEqual(case['artifacts']['sha256'],
                             '5ea890a08942063b83fed635ae3580fd9c4f54dfdd95fd1789aa13059689a78a')
            self.assertAlmostEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'],
                                   45.019980562824735, places=8)
            self.assertEqual(case['measurements']['sdr']['regions']['highlight']['samples'], 0)
            bound = case['palette_lower_bound']
            self.assertEqual(bound['output_sha256'], case['artifacts']['sha256'])
            self.assertEqual(bound['reference_sha256'], case['reference_sdr']['sha256'])
            self.assertEqual(bound['pixels_above_fixed_maximum'], 900)
            self.assertAlmostEqual(bound['minimum_error_max'], 45.019980562824735, places=8)
            self.assertIn('this exact palette only', bound['scope'])
            from matrix import build_matrix
            matrix = build_matrix(result['evidence'])
            self.assertEqual(matrix['evidence_errors'], [])
            cell = next(c for c in matrix['cells'] if c['id'] == 'avif-gainmap:sdr:gif')
            self.assertEqual(cell['status'], 'tested and failed')
            self.assertEqual(cell['qualified_cases'], [])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(all(control['passed'] for control in result['controls']))
            output = Path(case['artifacts']['output'])
            original = output.read_bytes()
            altered = Path(temporary)/'private.gif'
            altered.write_bytes(original[:-1]+b'\x21\xfe\x07PRIVATE\0'+original[-1:])
            with self.assertRaisesRegex(ValueError, 'extension'):
                inspect_and_decode(altered)
            altered.write_bytes(original+b'PRIVATE')
            with self.assertRaisesRegex(ValueError, 'trailing'):
                inspect_and_decode(altered)
            for label, contents in (
                    ('aspect', original[:12]+b'\1'+original[13:]),
                    ('loop', original[:-1]+b'\x21\xff\x0bNETSCAPE2.0\x03\x01\0\0\0'+original[-1:])):
                altered.write_bytes(contents)
                with self.subTest(mutation=label), self.assertRaises(ValueError):
                    inspect_and_decode(altered)
            changed = bytearray(original)
            gce = changed.index(b'\x21\xf9\x04')
            changed[gce+3] |= 1
            altered.write_bytes(changed)
            with self.assertRaisesRegex(ValueError, 'alpha'):
                inspect_and_decode(altered)
            from gamma_icc import make_profile
            profile = Path(temporary)/'wrong-gamma.icc'
            profile.write_bytes(make_profile(gamma=2.2))
            altered.write_bytes(original)
            avif.native(['exiftool', '-overwrite_original', f'-ICC_Profile<={profile}', altered])
            with self.assertRaises(ValueError):
                inspect_and_decode(altered)

    def test_unknown_source_and_unproved_selectors_do_not_reach_an_encoder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for change in ({'range': 'hdr'}, {'depth': '16'}, {'gamut': 'p3'},
                           {'transparency': 'opaque'}, {'w': 174}, {'motion': 'static'}):
                before = len(avif.COMMANDS)
                with self.subTest(change=change), self.assertRaises(ValueError):
                    run(root, selectors={**SELECTORS, **change})
                self.assertEqual(len(avif.COMMANDS), before)
            lock = json.loads(gainmap_avif.SOURCE_LOCK.read_text())
            lock['parent']['sha256'] = '0'*64
            changed = root/'unknown-parent.json'
            changed.write_text(json.dumps(lock))
            before = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'hash'):
                run(root, source_lock=changed)
            self.assertEqual(len(avif.COMMANDS), before)


if __name__ == '__main__':
    unittest.main()
