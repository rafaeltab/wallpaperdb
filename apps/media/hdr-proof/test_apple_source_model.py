"""Old Apple full-effect semantics remain separate from legacy measurements."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import avif


class AppleSourceModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_source_model
        cls.module = apple_source_model
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    def test_documented_full_effect_uses_inverse_rec709_and_linear_gain(self):
        values = np.array([0, .045, .5, 1.])
        expected = np.array([0, .01, ((.5+.099)/1.099)**(1/.45), 1])
        np.testing.assert_allclose(self.module.inverse_rec709(values), expected, atol=1e-15)
        base = np.ones((1, 4, 3))*203
        actual = self.module.documented_full(base, values[None, :], 8)
        np.testing.assert_allclose(actual, 203*(1+7*expected[None, :, None])*np.ones((1, 4, 3)), atol=1e-12)
        self.assertGreater(abs(actual[0, 2, 0]-203*8**.5), .1)
        for bad in (np.array([float('nan')]), np.array([1.001]), np.array([-.1])):
            with self.assertRaises(ValueError):
                self.module.inverse_rec709(bad)

    def test_actual_old_source_facts_and_imported_samples_are_bound(self):
        result = self.result
        self.assertEqual(result['source']['sha256'], self.module.SOURCE_SHA256)
        self.assertEqual(result['source']['map_sha256'], self.module.MAP_SHA256)
        self.assertEqual(result['source']['model']['version'], 65536)
        self.assertEqual(result['source']['model']['maker33_fraction'], [82317, 54194])
        self.assertEqual(result['source']['model']['maker48_fraction'], [0, 1])
        self.assertEqual(result['source']['model']['headroom_linear'], 8)
        self.assertEqual(result['source']['color']['gamut'], 'p3')
        self.assertTrue(all(result['checks'].values()))
        self.assertEqual(result['import_agreement']['base_changed_codes'], 0)
        self.assertEqual(result['import_agreement']['map_changed_codes'], 0)
        self.assertTrue(result['import_agreement']['no_map_reinterpretation_before_gain_application'])
        self.assertEqual(result['import_agreement']['tmap']['gamma'], [[1, 1]]*3)
        self.assertEqual(result['thresholds_sha256'], '0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf')

    def test_legacy_control_passes_but_documented_model_failure_is_preserved(self):
        result = self.result
        self.assertEqual(result['status'], 'diagnostic_only')
        self.assertNotIn('evidence', result)
        self.assertNotIn('cases', result)
        self.assertEqual(result['documented_full_model']['status'], 'tested and failed')
        measurement = result['documented_full_model']['measurement']
        self.assertEqual(len(measurement['failures']), 6)
        self.assertAlmostEqual(measurement['regions']['highlight']['delta_e_itp']['mean'], 4.3484822101145975, places=10)
        self.assertTrue(result['legacy_control']['measurement']['passed'])
        self.assertEqual(result['documented_full_model']['reference']['sha256'], '0166ec877116c9e6af93c0e0341fe5c6845eb2a28f9c972ff534c3e9134d25e5')
        self.assertEqual(result['consumer_status'], 'pending manual review')
        self.assertFalse(result['scope']['intermediate_adaptation_qualified'])
        self.assertFalse(result['scope']['new_apple_model_qualified'])
        self.assertEqual(json.loads((self.root/'proof/results.json').read_text()), result)

    def test_native_bridge_records_actual_signaling_precision_and_private_metadata(self):
        bridge = self.result['native_artifacts']['legacy_pq']
        self.assertEqual(bridge['color']['primaries'], 9)
        self.assertEqual(bridge['color']['transfer'], 16)
        self.assertEqual(bridge['color']['depth'], 16)
        self.assertEqual((bridge['color']['width'], bridge['color']['height']), (384, 512))
        self.assertEqual(bridge['inspection']['frame_count'], 1)
        self.assertTrue(bridge['inspection']['opaque'])
        self.assertEqual(bridge['inspection']['private_tags'], [])
        self.assertGreaterEqual(len(self.result['inspection_commands']), 4)

    def test_real_decoder_boundary_source_map_mutation_cannot_publish_evidence(self):
        real_read = self.module.avif.read_png
        root = self.root/'late-map-drift'

        def read_then_alter(path):
            pixels = real_read(path)
            extracted = root/'source-inspection/map.jpg'
            extracted.write_bytes(extracted.read_bytes()+b'changed after real native read')
            return pixels

        with patch.object(self.module.avif, 'read_png', side_effect=read_then_alter):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                self.module.run(root)
        self.assertFalse((root/'results.json').exists())

    def test_unknown_source_and_changed_extracted_map_reject_before_rendering(self):
        changed = self.root/'changed.jpg'
        changed.write_bytes(self.module.SOURCE.read_bytes()+b'changed provenance')
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            self.module.run(self.root/'bad-source', source=changed)
        self.assertEqual(len(avif.COMMANDS), before)
        real_inspect = self.module.gainmap.inspect

        def inspect_then_alter(path, directory):
            result = real_inspect(path, directory)
            extracted = Path(directory)/'map.jpg'
            extracted.write_bytes(extracted.read_bytes()+b'changed extracted map')
            return result

        with patch.object(self.module.gainmap, 'inspect', side_effect=inspect_then_alter):
            with self.assertRaisesRegex(ValueError, 'extracted map'):
                self.module.run(self.root/'bad-map')
        self.assertFalse((self.root/'bad-map/results.json').exists())

    def test_raw_metadata_model_rejects_wrong_version_missing_makernotes_and_new_headroom(self):
        source = self.module.SOURCE.read_bytes()
        gain = (self.root/'proof/source-inspection/map.jpg').read_bytes()
        for changed_base, changed_map in ((source.replace(b'Apple iOS', b'NotApple!'), gain),
                (source, gain.replace(b'65536', b'65537')),
                (source, (self.module.SOURCE.parent/'gainmap-apple-new.jpg').read_bytes())):
            with self.assertRaises(ValueError):
                self.module.parse_old_model(changed_base, changed_map)


if __name__ == '__main__':
    unittest.main()
