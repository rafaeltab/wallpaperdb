"""Real EXIF6 source provenance and native documented-full preparation."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import avif
import apple_source_model


class AppleOrientationSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import apple_orientation_source
        cls.module = apple_orientation_source
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.result = cls.module.run(cls.root/'proof')

    def test_real_exif6_source_preserves_original_model_and_stored_native_raster(self):
        result = self.result
        with self.subTest('actual native EXIF6 fixture'):
            self.assertEqual(result['status'], 'qualified source preparation')
            self.assertTrue(all(result['checks'].values()))
            self.assertEqual(result['orientation_source']['orientation'], 6)
            self.assertEqual(result['orientation_source']['sha256'],
                             '691ce29e25ba756cf0d9d2a4e498fcb4f246eaa0fd7046b15fb10f38b58053c9')
            self.assertEqual(result['native_source']['sha256'],
                             '10468aa300a9db19a18f02253583d2289b3acc00d4e3a14bc21e2f52b4617bba')
            self.assertEqual(result['reference']['sha256'],
                             '0166ec877116c9e6af93c0e0341fe5c6845eb2a28f9c972ff534c3e9134d25e5')
            self.assertTrue(result['native_source']['source_correspondence']['coded_base_equal'])
            self.assertEqual(result['native_source']['original_samples']['base_changed_codes'], 0)
            self.assertEqual(result['native_source']['map_sampling']['changed_codes'], 0)
            self.assertFalse(result['scope']['orientation_applied'])
            self.assertFalse(result['scope']['intermediate_adaptation_qualified'])
            self.assertFalse(result['scope']['conversion_qualified'])

    def test_unknown_source_and_identity_original_are_rejected_before_any_native_work(self):
        changed = self.root/'unknown.jpg'
        changed.write_bytes(Path(self.result['orientation_source']['path']).read_bytes()+b'unknown facts')
        for source in (changed, apple_source_model.SOURCE):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.run(self.root/'rejected', source=source)
            self.assertEqual(len(avif.COMMANDS), before)

    def test_generator_repeats_exact_bytes_and_original_canonical_guard_stays_narrow(self):
        import apple_native_source
        first = self.module.generate(self.root/'repeat-first')
        second = self.module.generate(self.root/'repeat-second')
        self.assertEqual(first.read_bytes(), second.read_bytes())
        before = len(avif.COMMANDS)
        with self.assertRaises(ValueError):
            apple_native_source.prepare(first, self.root/'canonical-rejects-oriented')
        self.assertEqual(len(avif.COMMANDS), before)

    def test_changed_map_after_real_native_decode_cannot_publish_preparation(self):
        import apple_native_source
        real_decode = apple_native_source._decode_rgb

        def decode_then_alter(source, output, size):
            result = real_decode(source, output, size)
            if Path(source).name == 'map.jpg':
                source = Path(source)
                source.write_bytes(source.read_bytes()+b'late extracted-map change')
            return result

        directory = self.root/'map-drift'
        with patch.object(apple_native_source, '_decode_rgb', side_effect=decode_then_alter):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                self.module.prepare(self.result['orientation_source']['path'], directory)
        self.assertFalse((directory/'source-evidence.json').exists())

    def test_actual_oriented_input_is_used_and_rechecked_after_native_read(self):
        import apple_native_source
        real_decode = apple_native_source._decode_rgb
        source = self.root/'admitted-copy.jpg'
        source.write_bytes(Path(self.result['orientation_source']['path']).read_bytes())
        read_paths = []

        def decode_then_alter(path, output, size):
            result = real_decode(path, output, size)
            read_paths.append(str(path))
            if Path(path) == source:
                source.write_bytes(source.read_bytes()+b'late source change')
            return result

        directory = self.root/'source-drift'
        with patch.object(apple_native_source, '_decode_rgb', side_effect=decode_then_alter):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                self.module.prepare(source, directory)
        self.assertIn(str(source), read_paths)
        self.assertFalse((directory/'source-evidence.json').exists())

    def test_source_color_model_and_lock_cannot_be_relabelled(self):
        source = self.result['orientation_source']['path']
        for kwargs in ({'gamut': 'srgb'}, {'model_revision': 'legacy-log-full'}):
            before = len(avif.COMMANDS)
            with self.assertRaises(ValueError):
                self.module.prepare(source, self.root/'wrong-color', **kwargs)
            self.assertEqual(len(avif.COMMANDS), before)
        import json
        lock = self.root/'unknown-lock.json'
        lock.write_text(json.dumps({**json.loads(self.module.LOCK_PATH.read_text()), 'orientation': 8}))
        with patch.object(self.module, 'LOCK_PATH', lock):
            with self.assertRaises(ValueError):
                self.module.prepare(source, self.root/'wrong-lock')


if __name__ == '__main__':
    unittest.main()
