"""Original-size XMP conversion must preserve actual layers and measured renderings."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif
from matrix import build_matrix


class XmpIdentityAvifTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import xmp_identity_avif
        cls.module = xmp_identity_avif
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    def test_real_file_preserves_original_depths_metadata_and_three_renderings(self):
        self.assertEqual(len(self.result['evidence']), 3)
        self.assertTrue(self.result['same_file_all_renderings']['passed'])
        for case in self.result['evidence']:
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
            self.assertEqual(case['artifacts']['sha256'], '8ab207a6885f010ce9c7512126033acbb6bc59ae0093b8cf2eed5e7f07688acb')
            self.assertEqual(case['facts']['base']['dimensions'], [403, 302])
            self.assertEqual(case['facts']['map']['dimensions'], [512, 384])
            self.assertEqual(case['facts']['base']['depths'], [8, 8, 8])
            self.assertEqual(case['facts']['map']['depths'], [8])
            self.assertEqual(case['facts']['alternate']['depths'], [8, 8, 8])
            self.assertEqual(case['facts']['private_metadata_items'], [])
            self.assertEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'], 0)
            self.assertLess(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], 1e-8)
            self.assertLess(max(region['delta_e_itp']['maximum'] for region in case['measurements']['native_hdr']['regions'].values()), .214)
            self.assertEqual(case['rendering_scope']['source_gain_map_weight'], case['rendering_scope']['output_gain_map_weight'])
            self.assertFalse(case['rendering_scope']['headroom_is_product_selector'])
            self.assertEqual(case['threshold_scope']['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')
        self.assertEqual([case['rendering_scope']['source_gain_map_weight'] for case in self.result['evidence']], [2/7, 1, 1])

    def test_references_provenance_and_physical_scope_remain_exact(self):
        self.assertTrue(all(value for value in self.result['original_sample_agreement'].values()))
        for case in self.result['evidence']:
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['selectors'], self.module.SELECTORS)
            self.assertEqual(case['geometry'], 'identity')
            self.assertIn('legacy EXIF', case['qualification_scope'])
            self.assertEqual(case['reference_hdr']['display_boost'], case['rendering_scope']['display_boost'])
            for key in ('reference_hdr', 'reference_sdr'):
                self.assertEqual(avif.digest(case[key]['path']), case[key]['sha256'])
        for name, sha in self.result['source_hashes'].items():
            self.assertEqual(avif.digest(Path(__file__).with_name(name)), sha)
        self.assertEqual(json.loads((self.root/'proof/results.json').read_text()), self.result)
        matrix = build_matrix(self.result['evidence'])
        self.assertEqual(matrix['evidence_errors'], [])
        rows = next(row for row in matrix['cells'] if row['id'] == 'gainmap-jpeg:hdr:avif')['evidence']
        self.assertEqual([row['status'] for row in rows], ['qualified']*3)

    def test_unknown_source_and_unproved_selectors_reject_before_native_conversion(self):
        for options in ({'operation': 'contain'}, {'selectors': {**self.module.SELECTORS, 'w': 403}},
                        {'selectors': {**self.module.SELECTORS, 'depth': '12'}},
                        {'selectors': {**self.module.SELECTORS, 'gamut': 'p3'}},
                        {'selectors': {**self.module.SELECTORS, 'motion': 'animated'}}):
            count = len(avif.COMMANDS)
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', **options)
            self.assertEqual(len(avif.COMMANDS), count)
            self.assertFalse((self.root/'rejected').exists())
        changed = self.root/'unknown.jpg'
        changed.write_bytes(self.module.SOURCE.read_bytes()+b'unknown provenance')
        count = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'unknown-output', source=changed)
        self.assertEqual(len(avif.COMMANDS), count)
        decision = self.module.source_decision(changed, self.root/'original-only')
        self.assertEqual(decision['status'], 'original only')
        self.assertEqual(avif.digest(decision['original']), avif.digest(changed))
        self.assertTrue(all(control['passed'] for control in self.result['controls']))

    def test_independent_graph_reader_rejects_color_depth_orientation_private_and_tail_changes(self):
        data = Path(self.result['evidence'][0]['artifacts']['output']).read_bytes()
        mutations = (data+b'private tail', data.replace(b'nclx\x00\x01\x00\x0d\x00\x00\x80', b'nclx\x00\x02\x00\x0d\x00\x00\x80'),
            data.replace(b'pixi\0\0\0\0\x03\x08\x08\x08', b'pixi\0\0\0\0\x03\x0c\x0c\x0c'),
            data.replace(b'av1C', b'irot'), data.replace(b'Color\0', b'Owner\0'))
        for index, changed in enumerate(mutations):
            self.assertNotEqual(data, changed)
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.module.parse_output(changed)
        metadata = copy.deepcopy(self.result['evidence'][0]['facts']['metadata'])
        metadata['base_offset'] = [[1, 64]]*3
        with self.assertRaises(ValueError):
            self.module.match_metadata(self.result['source_facts']['metadata'], metadata)

    def test_actual_extracted_packet_mutation_prevents_qualification(self):
        native = avif.native
        def mutate_after_real_native_render(argv, **kwargs):
            result = native(argv, **kwargs)
            if len(argv) > 2 and argv[1] == 'tonemap':
                packet = Path(argv[2]).parent/'inspection/map.obu'
                packet.write_bytes(packet.read_bytes()+b'changed packet')
            return result
        with patch.object(avif, 'native', side_effect=mutate_after_real_native_render):
            result = self.module.run(self.root/'changed-packet')
        self.assertFalse(result['same_file_all_renderings']['passed'])
        self.assertTrue(all(case['status'] == 'tested and failed' for case in result['evidence']))
        self.assertTrue(all(any('Changed bound' in error for error in case['blockers']) for case in result['evidence']))

    def test_source_read_boundary_drift_cannot_replace_admitted_source_or_map_hashes(self):
        read_source = self.module.gainmap_xmp.read_source
        for target in ('source', 'map'):
            source = self.root/f'{target}-read-boundary.jpg'
            source.write_bytes(self.module.SOURCE.read_bytes())
            def real_read_then_mutate(path, directory, **kwargs):
                result = read_source(path, directory, **kwargs)
                changed = Path(path) if target == 'source' else Path(result['evidence']['map_path'])
                changed.write_bytes(changed.read_bytes()+b'changed after actual source read')
                return result
            start = len(avif.COMMANDS)
            with self.subTest(target=target), patch.object(self.module.gainmap_xmp, 'read_source', side_effect=real_read_then_mutate):
                with self.assertRaisesRegex(ValueError, 'Changed bound'):
                    self.module.run(self.root/f'{target}-read-boundary-proof', source=source)
            self.assertFalse(any(row['argv'][0] == 'avifenc' for row in avif.COMMANDS[start:]))

    def test_inspector_return_cannot_replace_the_hash_of_the_packet_actually_read(self):
        inspect = self.module.inspect_output
        def inspect_then_mutate(path, directory):
            result = inspect(path, directory)
            packet = Path(directory)/'map.obu'
            packet.write_bytes(packet.read_bytes()+b'changed after actual packet inspection')
            return result
        with patch.object(self.module, 'inspect_output', side_effect=inspect_then_mutate):
            result = self.module.run(self.root/'inspected-packet-drift')
        self.assertFalse(result['same_file_all_renderings']['passed'])
        self.assertTrue(all(case['status'] == 'tested and failed' for case in result['evidence']))
        self.assertTrue(all(any('Changed bound' in error for error in case['blockers']) for case in result['evidence']))

    def test_packet_decode_boundary_is_bound_to_actual_container_payload(self):
        native = avif.native
        def decode_then_mutate(argv, **kwargs):
            result = native(argv, **kwargs)
            if argv[0] == 'ffmpeg' and 'obu' in argv:
                packet = Path(argv[argv.index('-i')+1])
                if packet.name == 'map.obu':
                    packet.write_bytes(packet.read_bytes()+b'changed after real packet decode')
            return result
        with patch.object(avif, 'native', side_effect=decode_then_mutate):
            result = self.module.run(self.root/'decoded-packet-drift')
        self.assertTrue(all(case['status'] == 'tested and failed' for case in result['evidence']))
        self.assertTrue(all(any('Changed bound' in error for error in case['blockers']) for case in result['evidence']))

    def test_native_render_readback_retains_the_original_emitted_png_hash(self):
        read_png = avif.read_png
        def read_then_mutate(path):
            result = read_png(path)
            path = Path(path)
            if path.name.startswith('native-'):
                path.write_bytes(path.read_bytes()+b'changed after real PNG readback')
            return result
        with patch.object(avif, 'read_png', side_effect=read_then_mutate):
            result = self.module.run(self.root/'native-render-drift')
        self.assertTrue(all(case['status'] == 'tested and failed' for case in result['evidence']))
        self.assertTrue(all(any('Changed bound' in error for error in case['blockers']) for case in result['evidence']))


if __name__ == '__main__':
    unittest.main()
