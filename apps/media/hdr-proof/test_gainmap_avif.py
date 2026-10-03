"""A gain-map AVIF authored base needs source facts and independent samples."""
import json
from pathlib import Path
import tempfile
import unittest

import avif
import gainmap_avif
import gainmap_avif_proof


class GainMapAvifTests(unittest.TestCase):
    def test_extra_sdr_geometries_retain_exact_containment_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline = gainmap_avif_proof.run(root/'baseline')
            expanded = gainmap_avif_proof.run(root/'expanded', geometries=('contain', 'cover', 'fill', 'upscale'))
            self.assertEqual(len(expanded['evidence']), 4)
            self.assertEqual(len(expanded['source_fixtures']), 1)
            self.assertEqual(expanded['source_fixtures'][0]['sha256'], baseline['source_fixtures'][0]['sha256'])
            original = baseline['evidence'][0]
            sizes = {'contain': (173, 130), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 576)}
            for case in expanded['evidence']:
                with self.subTest(geometry=case['geometry']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertTrue(all(case['checks'].values()))
                    self.assertEqual((case['facts']['width'], case['facts']['height']), sizes[case['geometry']])
                    self.assertEqual(case['measurements']['sdr']['fixture_class'], 'gainmap-sdr')
                    self.assertEqual(case['consumer_status'], 'pending manual review')
                    self.assertEqual(case['source_facts']['orientation'], 1)
                    if case['geometry'] == 'contain':
                        self.assertEqual(case['artifacts']['sha256'], 'd324dfdcaf20d7e985793f1b8f69cbeb26bbbb8a12fd84d820b150d20dceb81e')
                        self.assertEqual(case['artifacts']['sha256'], original['artifacts']['sha256'])
                        self.assertEqual(case['measurements'], original['measurements'])
                        self.assertEqual(case['selectors'], original['selectors'])
                        self.assertEqual(case['case_id'], original['case_id'])
            self.assertEqual(expanded['hdr_status'], 'untested')
            self.assertEqual([(control['case_id'], control['status']) for control in expanded['controls']],
                             [(control['case_id'], control['status']) for control in baseline['controls']])

    def test_unknown_and_orientation_geometries_stop_before_native_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            for operations in ((), ('contain', 'contain'), ('orientation',), ('crop',), ('arbitrary',)):
                with self.subTest(geometries=operations):
                    start = len(avif.COMMANDS)
                    with self.assertRaisesRegex(ValueError, 'geometries'):
                        gainmap_avif_proof.run(Path(temporary), geometries=operations)
                    self.assertEqual(len(avif.COMMANDS), start)

    def test_locked_native_source_and_authored_containment(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = gainmap_avif_proof.run(Path(temporary))
            self.assertEqual(len(result['evidence']), 1)
            source = result['source_fixtures'][0]
            self.assertTrue(source['source_valid'])
            self.assertTrue(source['source_lock']['passed'])
            facts = source['facts']
            self.assertEqual(facts['base']['dimensions'], [403, 302])
            self.assertEqual(facts['base']['depths'], [8, 8, 8])
            self.assertEqual(facts['base']['cicp'], [1, 13, 0, 1])
            self.assertEqual(facts['map']['dimensions'], [512, 384])
            self.assertEqual(facts['map']['depths'], [8])
            self.assertEqual(facts['metadata']['gain_map_max'], [[7, 2], [18, 5], [37, 10]])
            self.assertEqual(facts['metadata']['base_headroom'], [0, 1])
            self.assertEqual(facts['orientation'], 1)
            self.assertTrue(facts['private_tags'])
            self.assertTrue(facts['base_decoder_agreement'])
            self.assertTrue(facts['map_decoder_agreement'])
            self.assertEqual(facts['packet_samples']['base']['native_facts']['streams'][0]['pix_fmt'], 'gbrp')
            self.assertEqual(facts['packet_samples']['map']['native_facts']['streams'][0]['pix_fmt'], 'gray')
            case = result['evidence'][0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertEqual(case['selectors']['range'], 'sdr')
            self.assertEqual(case['selectors']['depth'], 'preserve')
            self.assertEqual(case['measurements']['sdr']['fixture_class'], 'gainmap-sdr')
            self.assertEqual(case['measurements']['sdr']['regions']['shadow']['delta_e_itp']['maximum'], 0)
            self.assertEqual((case['facts']['width'], case['facts']['height']), (173, 130))
            self.assertTrue(all(case['checks'].values()))
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(result['hdr_status'], 'untested')
            self.assertTrue(all(control['passed'] for control in result['controls']))
            self.assertTrue(all(control['status'] == 'passed' and control['case_id'] == control['id']
                                for control in result['controls']))

    def test_changed_source_hash_withholds_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = json.loads(gainmap_avif.SOURCE_LOCK.read_text())
            lock['sha256'][gainmap_avif.FIXTURE_ID] = '0' * 64
            bad_lock = root/'bad-lock.json'
            bad_lock.write_text(json.dumps(lock))
            start = len(avif.COMMANDS)
            with self.assertRaisesRegex(ValueError, 'source hash'):
                gainmap_avif_proof.run(root/'proof', source_lock=bad_lock)
            self.assertFalse(any('-filter_complex' in command['argv'] or command['argv'][0] == 'avifenc'
                                 for command in avif.COMMANDS[start:]))
            self.assertFalse(list(root.rglob('output.avif')))

    def test_actual_unknown_source_facts_keep_original_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original, _ = gainmap_avif.generate_source(root/'source')
            data = original.read_bytes()
            controls = {
                'unknown-base-color': (b'nclx\x00\x01\x00\x0d\x00\x00\x80',
                                       b'nclx\x00\x02\x00\x0d\x00\x00\x80'),
                'hdr-base': (b'nclx\x00\x01\x00\x0d\x00\x00\x80',
                             b'nclx\x00\x01\x00\x10\x00\x00\x80'),
                'unknown-map-color': (b'nclx\x00\x02\x00\x02\x00\x06\x80',
                                      b'nclx\x00\x02\x00\x02\x00\x02\x80'),
            }
            for name, (before, after) in controls.items():
                with self.subTest(name=name):
                    self.assertEqual(data.count(before), 1)
                    changed = root/f'{name}.avif'
                    changed.write_bytes(data.replace(before, after))
                    # The native decoder really parses each altered AVIF. These
                    # are file controls, not mocked facts or encoder results.
                    avif.inspect_avif(changed)
                    start = len(avif.COMMANDS)
                    decision = gainmap_avif.source_decision(changed, root/name)
                    self.assertEqual(decision['action'], 'original only')
                    self.assertFalse(decision['source_valid'])
                    self.assertEqual(decision['sha256'], avif.digest(changed))
                    self.assertFalse(any('-filter_complex' in command['argv'] for command in avif.COMMANDS[start:]))
                    copied = root/f'{name}-original.avif'
                    gainmap_avif.copy_original(changed, copied)
                    self.assertEqual(copied.read_bytes(), changed.read_bytes())

    def test_unproved_hdr_and_selector_tuples_are_withheld(self):
        selectors = gainmap_avif_proof.SELECTORS
        for change in ({'range': 'hdr'}, {'depth': '12'}, {'gamut': 'p3'},
                       {'motion': 'animate'}, {'transparency': 'coerce'}, {'w': 174}, {'h': 130}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, 'containment selectors'):
                    gainmap_avif_proof.validate_selectors({**selectors, **change})

    def test_contradictory_native_av1_config_is_rejected_before_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, _ = gainmap_avif.generate_source(root/'source')
            original = source.read_bytes()
            before = b'av1C\x81\x20\x00\x00'
            self.assertEqual(original.count(before), 1)
            for name, after in (
                    ('twelve-bit', b'av1C\x81\x20\x20\x00'),
                    ('high-bitdepth', b'av1C\x81\x20\x40\x00'),
                    ('reserved', b'av1C\x81\x20\x00\x80'),
                    ('initial-delay', b'av1C\x81\x20\x00\x10'),
                    ('profile', b'av1C\x81\x00\x00\x00'),
                    ('subsampling', b'av1C\x81\x20\x08\x00')):
                with self.subTest(name=name):
                    changed = root/f'{name}.avif'
                    changed.write_bytes(original.replace(before, after))
                    start = len(avif.COMMANDS)
                    decision = gainmap_avif.source_decision(changed, root/name)
                    self.assertEqual(decision['action'], 'original only')
                    self.assertIn('AV1 configuration', decision['reason'])
                    self.assertEqual(len(avif.COMMANDS), start)

    def test_unknown_gain_metadata_profile_and_orientation_withhold_transform(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, _ = gainmap_avif.generate_source(root/'source')
            original = source.read_bytes()
            # This is the native tmap item's version, flags, and two headroom
            # fractions. Change bytes in a real generated file, not facts.
            prefix = bytes(5) + b'\xc0' + bytes(4) + b'\x00\x00\x00\x01' + b'\x00\x00\x00\x07\x00\x00\x00\x02'
            self.assertEqual(original.count(prefix), 1)
            changes = {
                'metadata-version': (prefix, b'\x01' + prefix[1:]),
                'metadata-denominator': (prefix, prefix[:10] + bytes(4) + prefix[14:]),
                'unknown-icc': (b'colrnclx\x00\x01\x00\x0d', b'colrprof\x00\x01\x00\x0d'),
            }
            for name, (before, after) in changes.items():
                with self.subTest(name=name):
                    changed = root/f'{name}.avif'
                    changed.write_bytes(original.replace(before, after))
                    decision = gainmap_avif.source_decision(changed, root/name)
                    self.assertEqual(decision['action'], 'original only')
            changed = root/'orientation.avif'
            changed.write_bytes(original)
            avif.native(['exiftool', '-overwrite_original', '-Orientation#=6', changed])
            actual = avif.inspect_avif(changed)
            self.assertEqual(actual['exiftool']['Orientation'], 6)
            decision = gainmap_avif.source_decision(changed, root/'orientation')
            self.assertEqual(decision['action'], 'original only')

    def test_real_ten_bit_av1_packet_cannot_be_claimed_as_eight_bit_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            packet = Path(temporary)/'map10.obu'
            avif.native(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=16x16',
                         '-frames:v', '1', '-vf', 'format=gray10le', '-c:v', 'libaom-av1',
                         '-cpu-used', '8', '-crf', '0', '-b:v', '0', '-f', 'obu', packet])
            probe = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu',
                                            '-show_streams', '-of', 'json', packet]))
            self.assertEqual(probe['streams'][0]['pix_fmt'], 'gray10le')
            with self.assertRaisesRegex(ValueError, 'native pixel format/depth'):
                gainmap_avif.inspect_packet(packet, 'map', [16, 16])


if __name__ == '__main__':
    unittest.main()
