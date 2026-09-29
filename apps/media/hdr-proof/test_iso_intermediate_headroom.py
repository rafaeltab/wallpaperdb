"""A real endpoint conversion does not establish intermediate HDR appearance."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif


class IsoIntermediateHeadroomTests(unittest.TestCase):
    def test_actual_boost64_exposes_full_source_loss_without_changing_endpoint_bytes(self):
        from iso_intermediate_headroom import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), display_boost=64)
            case = report['cases'][0]
            self.assertEqual(report['converter_endpoint']['status'], 'qualified')
            self.assertEqual(case['artifacts']['sha256'],
                             '37376e5629f11d61debb2664cd2568fd1965d30268e1d0acc76810e01e6826a2')
            self.assertEqual(case['status'], 'tested and failed')
            self.assertEqual(case['blockers'], ['Failed appearance check at display boost 64'])
            self.assertTrue(all(passed for key, passed in case['checks'].items() if key != 'appearance'))
            self.assertIn('render-boost64', case['case_id'])
            self.assertNotIn('display_boost', case['selectors'])
            self.assertNotIn('hdr_intent', case)
            self.assertEqual(case['rendering_scope']['display_boost'], 64)
            self.assertEqual(case['rendering_scope']['headroom_log2'], 6)
            self.assertEqual(case['rendering_scope']['source_gain_map_weight'], 1)
            self.assertEqual(case['rendering_scope']['output_gain_map_weight'], 1)
            self.assertTrue(case['checks']['full_headroom_weights'])
            revision = 'gainmap-iso-full-headroom-boost64-v1'
            self.assertEqual(case['rendering_scope']['source_reference_revision'], revision)
            self.assertEqual(case['source_reference_revision'], revision)
            self.assertEqual(case['source_decoder_evidence']['headroom_log2'], 6)
            self.assertEqual(case['reference_hdr']['display_boost'], 64)
            self.assertEqual(avif.digest(Path(case['reference_hdr']['path'])), case['reference_hdr']['sha256'])
            self.assertEqual(case['reference_hdr']['sha256'],
                             '50afd592440c056149d6a1a785ea662ce92eeb430ac7eebd5ab3d55cafbcfdf9')
            for name in ('reconstructed_hdr', 'independent_hdr'):
                measure = case['measurements'][name]
                self.assertFalse(measure['passed'])
                self.assertIn('highlight.delta_e_mean', measure['failures'])
                self.assertGreater(measure['regions']['shadow']['delta_e_itp']['maximum'], 129)
                self.assertGreater(measure['regions']['highlight']['delta_e_itp']['mean'], 25)
            self.assertTrue(case['measurements']['independent_hdr_cross_decoder']['passed'])
            diagnostics = report['attribution_diagnostics']
            self.assertEqual(diagnostics['actual_weight'], 1)
            self.assertNotIn('diagnostic_normalized_weight', diagnostics)
            self.assertEqual(set(diagnostics['measurements']),
                             {'pre_jpeg_map_actual_weight', 'ideal_gain_actual_weight'})
            self.assertFalse(diagnostics['measurements']['ideal_gain_actual_weight']['passed'])
            rendering = report['unchanged_output_rendering_diagnostics']
            self.assertTrue(rendering['native_output_identical_to_boost16'])
            self.assertGreater(rendering['reference_peak_channel_nits'], 1729)
            self.assertLess(rendering['output_peak_channel_nits'], 919)
            self.assertEqual(case['consumer_status'], 'pending manual review')

    def test_boost64_rejects_a_decoder_claim_that_does_not_reach_full_output_weight(self):
        import icc_gainmap
        from iso_intermediate_headroom import run
        decode = icc_gainmap.independent_decode

        def changed_weight(path, map_path, *, boost=16):
            pixels, facts = decode(path, map_path, boost=boost)
            if boost == 64:
                facts['gain_map_weight'] = .5
            return pixels, facts

        with tempfile.TemporaryDirectory() as temporary, patch.object(
                icc_gainmap, 'independent_decode', side_effect=changed_weight):
            report = run(Path(temporary), display_boost=64)
        case = report['cases'][0]
        self.assertEqual(case['status'], 'tested and failed')
        self.assertFalse(case['checks']['full_headroom_weights'])
        self.assertIn('Failed full_headroom_weights check at display boost 64', case['blockers'])

    def test_only_the_declared_source_geometry_and_display_headroom_are_admitted(self):
        from iso_intermediate_headroom import run
        with tempfile.TemporaryDirectory() as temporary:
            for arguments in ({'source_id': 'gainmap-android-xmp'}, {'operation': 'contain'},
                              {'display_boost': 1}, {'display_boost': 4}, {'display_boost': float('nan')}):
                before = len(avif.COMMANDS)
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    run(Path(temporary), **arguments)
                self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_actual_boost2_fails_while_converter_endpoint_and_reader_agreement_pass(self):
        from iso_intermediate_headroom import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary))
            case = report['cases'][0]
            self.assertEqual(report['converter_endpoint']['status'], 'qualified')
            self.assertEqual(report['converter_endpoint']['display_boost'], 16)
            self.assertEqual(case['artifacts']['sha256'],
                             '37376e5629f11d61debb2664cd2568fd1965d30268e1d0acc76810e01e6826a2')
            self.assertEqual(case['status'], 'tested and failed')
            self.assertEqual(case['blockers'], ['Failed appearance check at display boost 2'])
            self.assertTrue(all(passed for key, passed in case['checks'].items() if key != 'appearance'))
            self.assertFalse(case['checks']['appearance'])
            self.assertIn('render-boost2', case['case_id'])
            self.assertNotIn('display_boost', case['selectors'])
            self.assertNotIn('hdr_intent', case)
            self.assertEqual(case['rendering_scope']['display_boost'], 2)
            self.assertEqual(case['rendering_scope']['source_reference_revision'], 'gainmap-iso-intermediate-boost2-v1')
            self.assertEqual(case['source_reference_revision'], 'gainmap-iso-intermediate-boost2-v1')
            self.assertEqual(case['reference_hdr']['display_boost'], 2)
            self.assertEqual(case['reference_hdr']['gamut'], 'p3')
            self.assertEqual(case['reference_hdr']['dimensions'], [769, 1025])
            self.assertEqual(avif.digest(Path(case['reference_hdr']['path'])), case['reference_hdr']['sha256'])
            self.assertEqual(case['reference_hdr']['sha256'],
                             'ada7fd862aa808618206b5851a2a1a84906303698ea35c6e672c72ace7626e21')
            self.assertEqual(case['source_decoder_evidence']['headroom_log2'], 1)
            self.assertEqual(case['source_decoder_evidence']['decoder'],
                             'Pillow/native libjpeg plus independent ISO parsing and reconstruction')
            self.assertAlmostEqual(case['rendering_scope']['source_gain_map_weight'], .17786073385939657)
            self.assertAlmostEqual(case['rendering_scope']['output_gain_map_weight'], .4629941696104883)
            for name in ('reconstructed_hdr', 'independent_hdr'):
                self.assertFalse(case['measurements'][name]['passed'])
                self.assertIn('highlight.delta_e_mean', case['measurements'][name]['failures'])
                self.assertGreater(case['measurements'][name]['regions']['shadow']['delta_e_itp']['maximum'], 100)
            self.assertTrue(case['measurements']['independent_hdr_cross_decoder']['passed'])
            diagnostics = report['attribution_diagnostics']
            self.assertIn('not bit-exact LCMS readback', diagnostics['base_linearization_model'])
            for name in ('pre_jpeg_map_actual_weight', 'ideal_gain_actual_weight',
                         'pre_jpeg_map_normalized_weight', 'ideal_gain_normalized_weight'):
                self.assertFalse(diagnostics['measurements'][name]['passed'])
            self.assertLess(diagnostics['measurements']['ideal_gain_normalized_weight']['regions']['highlight']['delta_e_itp']['mean'], 1)
            self.assertEqual(diagnostics['worst_pixels']['ideal_gain_normalized_weight']['xy'], [391, 642])
            self.assertEqual(diagnostics['worst_pixels']['ideal_gain_normalized_weight']['reference_nits'], [0, 0, 0])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertTrue(report['commands'])
            self.assertTrue(report['converter_endpoint']['gainmap_commands'])


if __name__ == '__main__':
    unittest.main()
