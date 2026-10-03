"""A full-source candidate must retain one file across every measured rendering."""
from pathlib import Path
import tempfile
import unittest

import avif


class IsoFullHeadroomCandidateTests(unittest.TestCase):
    def test_only_the_declared_iso_upscale_source_is_admitted(self):
        from iso_full_headroom_candidate import run
        with tempfile.TemporaryDirectory() as temporary:
            for args in ({'source_id': 'gainmap-android-xmp'}, {'operation': 'contain'}):
                before = len(avif.COMMANDS)
                with self.subTest(args=args), self.assertRaises(ValueError):
                    run(Path(temporary), **args)
                self.assertEqual(before, len(avif.COMMANDS))
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_native_source_facts_must_establish_the_requested_full_headroom(self):
        from iso_full_headroom_candidate import check_native_source
        source = {'base': {'width': 384, 'height': 512},
                  'iso_metadata': {'base_headroom': 0, 'alternate_headroom': 5.622376441955566}}
        facts = {'width': 384, 'height': 512, 'gamut': 1, 'headroom': 49.2610817,
                 'requested_display_boost': 64, 'gain_map_weight': 1,
                 'native_precision': 'float32 gain application before half-float storage'}
        check_native_source(facts, source)
        for key, value in (('width', 385), ('height', 513), ('gamut', 2),
                           ('headroom', 16), ('headroom', float('nan')),
                           ('requested_display_boost', 16), ('gain_map_weight', .7),
                           ('native_precision', 'half')):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                check_native_source({**facts, key: value}, source)

    def test_one_native_full_source_file_is_independently_measured_at_all_three_boosts(self):
        from iso_full_headroom_candidate import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary))
            cases = {case['rendering_scope']['display_boost']: case for case in report['cases']}
            self.assertEqual(set(cases), {2, 16, 64})
            self.assertEqual(report['converter_control']['output_sha256'],
                             '37376e5629f11d61debb2664cd2568fd1965d30268e1d0acc76810e01e6826a2')
            self.assertEqual(report['native_candidate']['base_sha256'],
                             '5177870d6a7e34011d293ec0da6758d0b02778c095958d024d6a700ef32fff4a')
            self.assertEqual(len({case['artifacts']['sha256'] for case in cases.values()}), 1)
            self.assertEqual(cases[64]['artifacts']['sha256'],
                             '47abfb9e448d87cbb9ee9b0ba268d391b81ed3934c383c250554c6783100a831')
            self.assertNotEqual(cases[64]['artifacts']['sha256'], report['converter_control']['output_sha256'])
            self.assertEqual(avif.digest(Path(cases[64]['artifacts']['output'])), cases[64]['artifacts']['sha256'])
            self.assertEqual(cases[2]['reference_hdr']['sha256'],
                             'ada7fd862aa808618206b5851a2a1a84906303698ea35c6e672c72ace7626e21')
            self.assertEqual(cases[64]['reference_hdr']['sha256'],
                             '50afd592440c056149d6a1a785ea662ce92eeb430ac7eebd5ab3d55cafbcfdf9')
            self.assertEqual(cases[16]['reference_hdr']['sha256'],
                             'cccc87b046a06ee1fca707929adccb34c5c2bedfa280eb6245fee10017b5bf20')
            for boost, case in cases.items():
                with self.subTest(boost=boost):
                    self.assertNotIn('display_boost', case['selectors'])
                    self.assertEqual(case['reference_hdr']['display_boost'], boost)
                    self.assertEqual(case['hdr_decoder_evidence']['independent']['display_boost'], boost)
                    self.assertTrue(case['checks']['native_source_precision'])
                    self.assertTrue(case['checks']['native_geometry'])
                    self.assertTrue(case['checks']['hdr_intent'])
                    self.assertTrue(case['checks']['structure'])
                    self.assertTrue(case['checks']['privacy'])
                    self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
                    self.assertEqual(case['status'] == 'qualified', all(case['checks'].values()))
                    self.assertEqual(case['consumer_status'], 'pending manual review')
                    self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
                    for layer in ('base', 'map'):
                        self.assertEqual(case['facts'][layer]['depth'], 8)
                        self.assertEqual(case['facts'][layer]['sof'], 0)
            self.assertNotIn('hdr_intent', cases[2])
            self.assertNotIn('hdr_intent', cases[16])
            self.assertEqual(cases[64]['hdr_intent']['display_boost'], 64)
            self.assertEqual(cases[64]['status'], 'qualified')
            self.assertTrue(cases[64]['checks']['full_headroom_weights'])
            for boost in (2, 16):
                self.assertEqual(cases[boost]['status'], 'tested and failed')
                self.assertEqual(cases[boost]['blockers'], [f'Failed appearance check at display boost {boost}'])
                self.assertTrue(cases[boost]['checks']['independent_decoder'])
                for name in ('reconstructed_hdr', 'independent_hdr'):
                    self.assertIn('highlight.delta_e_mean', cases[boost]['measurements'][name]['failures'])
            self.assertAlmostEqual(cases[64]['rendering_scope']['output_capacity_headroom_log2'], 3.0894980430603027)
            self.assertAlmostEqual(cases[64]['rendering_scope']['source_capacity_headroom_log2'], 5.622376441955566)
            self.assertTrue(report['commands'])
            self.assertTrue(report['gainmap_commands'])


if __name__ == '__main__':
    unittest.main()
