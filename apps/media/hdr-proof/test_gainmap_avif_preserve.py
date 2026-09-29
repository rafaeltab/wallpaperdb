"""A gain-map AVIF derivative needs actual layer depths and two faithful renditions."""
from pathlib import Path
import tempfile
import unittest
import zlib

import avif
import gainmap_avif
import gainmap_avif_preserve
from matrix import build_matrix


class GainMapAvifPreserveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.result = gainmap_avif_preserve.run(cls.root/'proof')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_eight_bit_candidate_preserves_both_renditions(self):
        cases = {case['candidate']: case for case in self.result['evidence']}
        self.assertEqual(len(cases), 4)
        case = cases['moderateoffset-depth8']
        self.assertEqual(case['status'], 'qualified', case['blockers'])
        self.assertTrue(all(case['checks'].values()))
        self.assertEqual(case['selectors'], gainmap_avif_preserve.SELECTORS)
        self.assertEqual(case['artifacts']['sha256'], '45a3b21d212803fd292da1d667d455b4ef03b7ae909cd3908ec5e93398feb754')
        for name in ('base', 'map', 'alternate'):
            self.assertEqual(case['facts'][name]['depths'], [8, 8, 8])
            self.assertEqual(case['facts'][name]['dimensions'], [173, 130])
        self.assertEqual(case['facts']['base']['cicp'], [1, 13, 0, 1])
        self.assertEqual(case['facts']['map']['cicp'], [2, 2, 0, 1])
        self.assertEqual(case['facts']['alternate']['cicp'], [1, 16, 0, 1])
        self.assertEqual(case['facts']['metadata']['base_offset'], [[1, 4096]]*3)
        self.assertEqual(case['facts']['metadata']['alternate_headroom'], [11668297, 4194304])
        self.assertEqual(case['source_facts']['metadata']['alternate_headroom'], [7, 2])
        for name in ('base', 'map'):
            self.assertEqual(case['packet_facts'][name]['streams'][0]['pix_fmt'], 'gbrp')
        self.assertAlmostEqual(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'],
                               2.5401833742556192, places=6)
        self.assertAlmostEqual(max(region['delta_e_itp']['maximum'] for region in
            case['measurements']['independent_hdr']['regions'].values() if 'delta_e_itp' in region),
            3.1994343024635907, places=6)
        self.assertTrue(case['measurements']['sdr']['passed'])
        self.assertTrue(case['measurements']['native_hdr']['passed'])
        self.assertTrue(case['measurements']['decoder_agreement']['passed'])
        self.assertEqual(case['privacy_measurement']['private_tags'], [])
        self.assertEqual(case['consumer_status'], 'pending manual review')
        self.assertEqual(case['adaptation_scope']['qualified_display_headroom_log2'], [4])
        self.assertEqual(case['adaptation_scope']['intermediate_adaptation'], 'untested')
        self.assertTrue(all(control['passed'] for control in self.result['controls']))

    def test_stock_failures_and_depth_incompatible_results_stay_unqualified(self):
        cases = {case['candidate']: case for case in self.result['evidence']}
        for name in ('stock-auto', 'moderateoffset-auto'):
            self.assertEqual(cases[name]['status'], 'incompatible with the requested selectors')
            self.assertFalse(cases[name]['selector_checks']['alternate_depth_preserved'])
            self.assertEqual(cases[name]['facts']['alternate']['depths'], [12, 12, 12])
        self.assertFalse(cases['stock-auto']['measurements']['independent_hdr']['passed'])
        self.assertTrue(cases['moderateoffset-auto']['measurements']['independent_hdr']['passed'])
        self.assertEqual(cases['stock-depth8']['status'], 'tested and failed')
        self.assertFalse(cases['stock-depth8']['checks']['structure'])
        self.assertFalse(cases['stock-depth8']['measurements']['independent_hdr']['passed'])
        self.assertEqual(cases['stock-depth8']['facts']['map']['cicp'], [2, 2, 2, 1])
        for case in cases.values():
            self.assertEqual(case['source_sha256'], '2c744ec754e5953db4b2e0787ef2e729d9c3d5c00f685cfb7243cc3ea93630bd')
            self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
            self.assertEqual(case['threshold_scope']['reference_revision'], 'gainmap-avif-hdr-bilinear8-lanczosfloat-v1')
            self.assertTrue(case['measurements']['source']['passed'])
            self.assertTrue(case['commands'])
            self.assertEqual(avif.digest(case['artifacts']['output']), case['artifacts']['sha256'])

    def test_actual_native_evidence_retains_exact_statuses_in_conversion_matrix(self):
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        cell = next(item for item in matrix['cells'] if item['id'] == 'avif-gainmap:hdr:avif')
        expected = {case['case_id']: case['status'] for case in self.result['evidence']}
        self.assertEqual({case['case_id']: case['status'] for case in cell['evidence']}, expected)
        self.assertEqual([case['candidate'] for case in cell['qualified_cases']], ['moderateoffset-depth8'])

    def test_unproved_selectors_stop_before_native_work(self):
        for change in ({'range': 'sdr'}, {'format': 'png'}, {'depth': '12'}, {'depth': '8'}, {'gamut': 'p3'},
                       {'w': 174}, {'h': 130}, {'fit': 'cover'}, {'motion': 'animate'}, {'transparency': 'coerce'}):
            with self.subTest(change=change):
                before = len(avif.COMMANDS)
                with self.assertRaisesRegex(ValueError, 'gain-map AVIF containment'):
                    gainmap_avif_preserve.run(self.root/'wrong-selectors', selectors={**gainmap_avif_preserve.SELECTORS, **change})
                self.assertEqual(len(avif.COMMANDS), before)

    def test_unknown_actual_source_facts_stay_original_only(self):
        source = Path(self.result['source_fixtures'][0]['path'])
        before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
        data = source.read_bytes()
        self.assertEqual(data.count(before), 1)
        changed = self.root/'unknown-source.avif'
        changed.write_bytes(data.replace(before, b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
        start = len(avif.COMMANDS)
        decision = gainmap_avif_preserve.source_decision(changed, self.root/'unknown')
        self.assertEqual(decision['action'], 'original only')
        self.assertEqual(len(avif.COMMANDS), start)
        self.assertTrue(gainmap_avif.copy_original(changed, self.root/'original.avif')['exact_bytes'])

    def test_malformed_output_color_depth_gain_metadata_and_graph_reject_before_decode(self):
        valid = Path(self.result['evidence'][-1]['artifacts']['output']).read_bytes()
        prefix = bytes(5)+b'\xc0'+bytes(4)+b'\x00\x00\x00\x01'
        self.assertEqual(valid.count(prefix), 1)
        variants = {
            'denominator': valid.replace(prefix, prefix[:-4]+bytes(4)),
            'gain-version': valid.replace(prefix, b'\x01'+prefix[1:]),
            'gain-flags': valid.replace(prefix, prefix[:5]+b'\xd0'+prefix[6:]),
            'unknown-base-color': valid.replace(b'nclx\x00\x01\x00\x0d', b'nclx\x00\x02\x00\x0d'),
            'unknown-map-matrix': valid.replace(b'nclx\x00\x02\x00\x02\x00\x00', b'nclx\x00\x02\x00\x02\x00\x02'),
            'contradictory-depth': valid.replace(b'av1C\x81\x20\x00\x00', b'av1C\x81\x20\x20\x00'),
            'unknown-property': valid.replace(b'av1C', b'irot'),
            'unknown-derived-reference': valid.replace(b'dimg', b'auxl'),
        }
        for name, data in variants.items():
            with self.subTest(variant=name):
                path = self.root/f'{name}.avif'
                path.write_bytes(data)
                start = len(avif.COMMANDS)
                with self.assertRaises(ValueError):
                    gainmap_avif_preserve.inspect_output(path, self.root/name)
                self.assertEqual(len(avif.COMMANDS), start)

    def test_actual_twelve_bit_packet_cannot_masquerade_as_rgb8_map(self):
        packet = self.root/'rgb12.obu'
        avif.native(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=16x16', '-frames:v', '1',
                     '-vf', 'format=gbrp12le', '-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '0', '-b:v', '0',
                     '-color_range', 'pc', '-colorspace', 'rgb', '-f', 'obu', packet])
        with self.assertRaisesRegex(ValueError, 'pixel format/depth'):
            gainmap_avif_preserve.inspect_packet(packet, 'map', [16, 16])

    def test_native_hdr_reader_bridge_proves_its_actual_pq_storage(self):
        case = self.result['evidence'][-1]
        facts = case['native_hdr_artifact']['facts']
        self.assertEqual(facts['cicp'], [1, 16, 0, 1])
        self.assertEqual(facts['libpng_source_depth'], 16)
        self.assertEqual(facts['dimensions'], [173, 130])
        self.assertTrue(facts['opaque'])
        self.assertEqual(facts['requested_native_precision'], 12)
        original = Path(case['native_hdr_artifact']['path']).read_bytes()
        before = b'cICP'+bytes((1, 16, 0, 1))
        after = b'cICP'+bytes((1, 13, 0, 1))
        changed = original.replace(before+zlib.crc32(before).to_bytes(4, 'big'),
                                   after+zlib.crc32(after).to_bytes(4, 'big'))
        self.assertNotEqual(changed, original)
        path = self.root/'wrong-native-transfer.png'
        path.write_bytes(changed)
        start = len(avif.COMMANDS)
        with self.assertRaisesRegex(ValueError, 'PQ'):
            gainmap_avif_preserve.inspect_native_hdr(path)
        self.assertEqual(len(avif.COMMANDS), start)

    def test_changed_but_parseable_source_fails_its_provenance_lock(self):
        source = Path(self.result['source_fixtures'][0]['path'])
        data = source.read_bytes()
        marker = bytes(5)+b'\xc0'+bytes(4)+b'\x00\x00\x00\x01'+b'\x00\x00\x00\x07\x00\x00\x00\x02'
        self.assertEqual(data.count(marker), 1)
        changed = self.root/'changed-source-headroom.avif'
        changed.write_bytes(data.replace(marker, marker[:-8]+b'\x00\x00\x00\x08\x00\x00\x00\x02'))
        gainmap_avif.parse_source(changed.read_bytes())
        start = len(avif.COMMANDS)
        decision = gainmap_avif_preserve.source_decision(changed, self.root/'changed-provenance')
        self.assertEqual(decision['action'], 'original only')
        self.assertIn('source hash', decision['reason'])
        self.assertEqual(len(avif.COMMANDS), start)


if __name__ == '__main__':
    unittest.main()
