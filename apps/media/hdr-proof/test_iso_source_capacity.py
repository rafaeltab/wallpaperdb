"""Native source-capacity preservation retains one coded base/map at all boosts."""
from pathlib import Path
import json
import re
import tempfile
import unittest

import avif


class IsoSourceCapacityTests(unittest.TestCase):
    def test_unknown_source_is_rejected_without_an_output_or_native_encode(self):
        from iso_source_capacity import pack
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = folder/'unknown.jpg'
            source.write_bytes(b'unknown')
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                pack(source, folder/'candidate.jpg', folder/'base.jpg', folder/'map.jpg', folder/'output.jpg')
            self.assertEqual(before, len(avif.COMMANDS))
            self.assertFalse((folder/'output.jpg').exists())
            self.assertEqual(source.read_bytes(), b'unknown')

    def test_exact_source_capacities_and_coded_parts_survive_native_packing(self):
        from iso_source_capacity import TOOL, coded_payload, pack, run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary))
            self.assertTrue(all(report['preservation_checks'].values()))
            cases = {case['rendering_scope']['display_boost']: case for case in report['cases']}
            self.assertEqual(set(cases), {2, 16, 64})
            self.assertEqual(len({case['artifacts']['sha256'] for case in cases.values()}), 1)
            self.assertEqual(report['full_source_control']['output_sha256'],
                             '47abfb9e448d87cbb9ee9b0ba268d391b81ed3934c383c250554c6783100a831')
            for boost, case in cases.items():
                with self.subTest(boost=boost):
                    self.assertAlmostEqual(case['rendering_scope']['source_gain_map_weight'],
                                           case['rendering_scope']['output_gain_map_weight'])
                    self.assertTrue(case['checks']['source_capacity_preservation'])
                    self.assertTrue(case['checks']['structure'])
                    self.assertTrue(case['checks']['privacy'])
                    self.assertTrue(case['checks']['native_source_precision'])
                    self.assertTrue(case['checks']['native_geometry'])
                    self.assertTrue(case['checks']['hdr_intent'])
                    self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
                    self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
                    self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(cases[64]['checks']['full_headroom_weights'])
            self.assertEqual(cases[64]['measurements']['reconstructed_hdr'],
                             report['full_source_control']['full_headroom_measurement'])
            self.assertTrue(report['commands'])
            self.assertEqual(cases[64]['status'], 'qualified')
            self.assertEqual(cases[64]['artifacts']['sha256'],
                             '64e1627f20632239fa5755908bb72a4e359776c0891df92fd8b99c6b99df1091')
            for boost in (2, 16):
                self.assertEqual(cases[boost]['blockers'], [f'Failed appearance check at display boost {boost}'])
                self.assertLess(cases[boost]['measurements']['reconstructed_hdr']['regions']['highlight']['delta_e_itp']['mean'], 1.5)
            folder = Path(temporary)
            source = Path('/proof/fixtures/gainmap/gainmap-android-iso.jpg')
            control = json.loads((folder/'full-source-control/results.json').read_text())
            candidate = folder/'full-source-control/output.jpg'
            base = Path(control['native_candidate']['base'])
            gain_map = folder/'full-source-control/output-icc-parts/map.jpg'
            altered_icc = folder/'base-without-icc.jpg'
            altered_icc.write_bytes(base.read_bytes())
            avif.native(['exiftool', '-overwrite_original', '-ICC_Profile=', altered_icc])
            self.assertEqual(coded_payload(altered_icc.read_bytes()), coded_payload(base.read_bytes()))
            map_icc = folder/'map-with-icc.jpg'
            map_icc.write_bytes(gain_map.read_bytes())
            avif.native(['exiftool', '-overwrite_original', '-TagsFromFile', base, '-ICC_Profile', map_icc])
            self.assertEqual(coded_payload(map_icc.read_bytes()), coded_payload(gain_map.read_bytes()))
            bad_transform = folder/'base-with-conflicting-transform.jpg'
            changed = bytearray(base.read_bytes())
            changed[changed.index(b'Adobe')+11] = 1
            bad_transform.write_bytes(changed)
            self.assertEqual(coded_payload(bad_transform.read_bytes()), coded_payload(base.read_bytes()))
            for label, supplied_base, supplied_map in (('base', gain_map, gain_map),
                    ('map', base, base), ('icc', altered_icc, gain_map),
                    ('map-icc', base, map_icc), ('transform', bad_transform, gain_map)):
                output = folder/f'rejected-{label}.jpg'
                before = sum(command['argv'][0] == TOOL for command in avif.COMMANDS)
                with self.subTest(label=label), self.assertRaises(ValueError):
                    pack(source, candidate, supplied_base, supplied_map, output)
                self.assertFalse(output.exists())
                self.assertEqual(sum(command['argv'][0] == TOOL for command in avif.COMMANDS), before)
            conflicting = folder/'conflicting-source.jpg'
            data = candidate.read_bytes()
            match = re.search(rb'hdrgm:HDRCapacityMax="([0-9.]+)"', data)
            self.assertIsNotNone(match)
            position = match.start(1)
            conflicting.write_bytes(data[:position]+b'1'+data[position+1:])
            before_hash = avif.digest(conflicting)
            with self.assertRaises(ValueError):
                pack(conflicting, candidate, base, gain_map, folder/'rejected-source.jpg')
            with self.assertRaisesRegex(RuntimeError, 'ISO-only source metadata'):
                avif.native([TOOL, 'pack-source-capacity', conflicting, candidate, base, gain_map,
                             folder/'rejected-native-source.jpg'])
            self.assertEqual(before_hash, avif.digest(conflicting))
            self.assertFalse((folder/'rejected-native-source.jpg').exists())
            for preserved in (source, candidate, base, gain_map):
                before_hash = avif.digest(preserved)
                with self.assertRaisesRegex(ValueError, 'overwrite'):
                    pack(source, candidate, base, gain_map, preserved)
                self.assertEqual(avif.digest(preserved), before_hash)


if __name__ == '__main__':
    unittest.main()
