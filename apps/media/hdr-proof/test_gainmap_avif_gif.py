"""Native photographic palette failures must remain measured, never inferred."""
from pathlib import Path
import json
import tempfile
import unittest

import avif
import gainmap_avif
from gainmap_avif_gif import SELECTORS, inspect_and_decode, run


class GainmapAvifGifTests(unittest.TestCase):
    def test_gamma32_native_palette_keeps_reference_and_proves_actual_icc_transfer(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = run(Path(temporary), palette='libimagequant-gamma32')
            case = result['evidence'][0]
            for gate in ('native_encoder', 'native_transfer', 'independent_decoder', 'structure', 'privacy'):
                self.assertTrue(case['checks'][gate], case['blockers'])
            self.assertEqual(case['facts']['transfer'], 'gamma3.2')
            self.assertEqual(case['reference_sdr']['sha256'],
                             'b58ac4171554daab4ab1736bc37eb041681927999a46369b8b7117e4c0683731')
            self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
            self.assertEqual(case['status'], 'tested and failed')
            self.assertEqual(case['artifacts']['sha256'],
                             'c0104036053dcfdde091082acd702901ca6f8f0f505a8bc87fad8ef179d3b4dc')
            self.assertEqual(case['palette_lower_bound']['pixels_above_fixed_maximum'], 794)
            self.assertAlmostEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'],
                                   46.784424724305694, places=8)
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertIn('gamma3.2', case['qualification_scope'])
            self.assertTrue(case['known_consumer_limitations'])
            self.assertTrue(all(control['passed'] for control in result['controls']))
            self.assertTrue(all(control['case_id'].endswith('-libimagequant-gamma32') for control in result['controls']))
            output = Path(case['artifacts']['output'])
            with self.assertRaises(ValueError):
                inspect_and_decode(output)
            from gamma_icc import make_profile
            profile = Path(temporary)/'wrong-gamma.icc'
            profile.write_bytes(make_profile(gamma=2.2))
            avif.native(['exiftool', '-overwrite_original', f'-ICC_Profile<={profile}', output])
            with self.assertRaises(ValueError):
                inspect_and_decode(output, gamma32=True)

    def test_separate_native_quantizer_retains_the_same_authored_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = run(Path(temporary), palette='libimagequant')
            case = result['evidence'][0]
            self.assertTrue(case['checks']['native_encoder'], case['blockers'])
            self.assertTrue(case['checks']['independent_decoder'], case['blockers'])
            self.assertTrue(case['checks']['structure'], case['blockers'])
            self.assertTrue(case['checks']['privacy'], case['blockers'])
            self.assertIn('libimagequant', case['native_candidate']['encoder'])
            self.assertEqual(case['reference_sdr']['sha256'],
                             'b58ac4171554daab4ab1736bc37eb041681927999a46369b8b7117e4c0683731')
            self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['status'], 'tested and failed')
            self.assertEqual(case['artifacts']['sha256'],
                             '76c698c153a42767771ffd71bc258c340caf88bae733d8aeed00f5438f6371c2')
            self.assertEqual(case['palette_lower_bound']['pixels_above_fixed_maximum'], 951)
            self.assertAlmostEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'],
                                   62.973723511959726, places=8)
            self.assertTrue(case['native_candidate']['native_library_hashes'])
            self.assertIn('libimagequant-4.2.2-r0', case['native_candidate']['native_package'])
            self.assertEqual(case['native_candidate']['native_version_api'], '4.0.0')
            self.assertTrue(all(control['case_id'].endswith('-libimagequant') for control in result['controls']))

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
            with self.assertRaises(ValueError):
                run(root, palette='unknown')
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
