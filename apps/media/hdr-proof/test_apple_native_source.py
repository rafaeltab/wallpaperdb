"""Native old Apple full-effect preparation against an independent renderer."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import avif
import apple_source_model


class AppleNativeSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_native_source
        cls.module = apple_native_source
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    def test_every_base_and_map_code_obeys_the_native_full_effect_formula(self):
        controls = self.result['analytic_control']
        self.assertTrue(controls['passed'])
        self.assertEqual(controls['base_map_pairs'], 65536)
        self.assertEqual(controls['tested_headrooms'], [1, 8])
        self.assertLess(controls['maximum_absolute_error_nits'], .002)
        self.assertTrue(controls['black_preserved'])
        self.assertTrue(controls['unclipped_above_sdr_white'])

    def test_actual_source_pixels_metadata_sampling_and_photo_gate_are_independent(self):
        result = self.result
        self.assertEqual(result['status'], 'qualified source preparation')
        self.assertNotIn('evidence', result)
        self.assertTrue(all(result['checks'].values()))
        self.assertEqual(result['reference_revision'], apple_source_model.REFERENCE_REVISION)
        self.assertEqual(result['reference']['sha256'], '0166ec877116c9e6af93c0e0341fe5c6845eb2a28f9c972ff534c3e9134d25e5')
        self.assertEqual(result['native_source']['gamut'], 'p3')
        self.assertEqual(result['native_source']['normalization_nits'], 203)
        self.assertEqual(result['native_source']['format'], 'gbrpf32le')
        self.assertEqual(result['native_source']['source_sha256'], apple_source_model.SOURCE_SHA256)
        self.assertEqual(result['native_source']['original_samples']['base_changed_codes'], 0)
        self.assertEqual(result['native_source']['original_samples']['map_changed_codes'], 0)
        self.assertEqual(result['native_source']['map_sampling']['changed_codes'], 0)
        self.assertTrue(result['measurement']['passed'])
        self.assertEqual(len(result['legacy_diagnostic']['documented_full_model']['measurement']['failures']), 6)
        self.assertFalse(result['scope']['intermediate_adaptation_qualified'])
        self.assertEqual(result['consumer_status'], 'pending manual review')

    def test_source_precision_remains_float_without_a_pq_or_half_float_roundtrip(self):
        prepared = self.result['native_source']
        pixels = self.module.read_linear(prepared)
        self.assertEqual(pixels.shape, (512, 384, 3))
        self.assertTrue(np.all(np.isfinite(pixels)))
        self.assertGreater(np.max(pixels), 203)
        self.assertEqual(Path(prepared['path']).stat().st_size, 512*384*3*4)
        self.assertFalse(prepared['alpha'])
        self.assertIn('geq=', prepared['gain_filter'])

    def test_unknown_source_gamut_model_or_metadata_never_enters_native_transform(self):
        source = apple_source_model.SOURCE
        changed = self.root/'changed.jpg'
        changed.write_bytes(source.read_bytes()+b'unknown source')
        for filename, kwargs in ((changed, {}), (source, {'gamut': 'srgb'}),
                (source, {'model_revision': 'legacy-log-full'})):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.prepare(filename, self.root/'rejected', **kwargs)
            self.assertEqual(len(avif.COMMANDS), before)

    def test_changed_source_map_after_real_native_decode_cannot_publish_preparation(self):
        root = self.root/'map-drift'
        real_decode = self.module._decode_rgb

        def decode_then_alter(source, output, size):
            result = real_decode(source, output, size)
            if Path(source).name == 'map.jpg':
                source = Path(source)
                source.write_bytes(source.read_bytes()+b'late native map drift')
            return result

        with patch.object(self.module, '_decode_rgb', side_effect=decode_then_alter):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                self.module.prepare(apple_source_model.SOURCE, root)
        self.assertFalse((root/'source-evidence.json').exists())

    def test_float_artifact_hash_and_normalization_must_be_established_before_readback(self):
        prepared = self.result['native_source']
        for changes in ({'sha256': '0'*64}, {'normalization_nits': 10000}, {'gamut': 'srgb'}, {'alpha': True}):
            with self.assertRaises(ValueError):
                self.module.read_linear({**prepared, **changes})

    def test_analytic_artifacts_remain_bound_after_actual_readback(self):
        real_read = self.module.read_linear

        def read_then_alter(facts):
            pixels = real_read(facts)
            if Path(facts['path']).name == 'full-8.gbrpf32':
                path = Path(facts['path'])
                path.write_bytes(path.read_bytes()+b'changed after actual read')
            return pixels

        with patch.object(self.module, 'read_linear', side_effect=read_then_alter):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                self.module.analytic_control(self.root/'analytic-drift')


if __name__ == '__main__':
    unittest.main()
