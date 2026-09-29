"""Recognized HDR PNG sources need native signaling and measured derivatives."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from avif import read_png, write_png
from hdr_png import fixture_specs, generate_fixture, inspect_source, run


class HdrPngTests(unittest.TestCase):
    def test_native_fixtures_are_deterministic_and_independently_recognized(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            for spec in fixture_specs():
                with self.subTest(spec=spec):
                    first, _, _ = generate_fixture(spec, directory/'first'/spec['id'])
                    second, _, _ = generate_fixture(spec, directory/'second'/spec['id'])
                    self.assertEqual(first.read_bytes(), second.read_bytes())
                    facts = inspect_source(first)
                    self.assertEqual(facts['depth'], 16)
                    self.assertEqual(facts['gamut'], spec['gamut'])
                    self.assertEqual(facts['transfer_name'], spec['transfer'])
                    for tag in ('GPSLatitude', 'GPSLongitude', 'Model', 'SerialNumber'):
                        self.assertIn(tag, facts['exiftool'])
                    decoded = read_png(first)
                    self.assertEqual(decoded.shape, (64, 96, 4))
                    self.assertEqual(bool(np.any(decoded[..., 3] < 1)), spec['alpha'])

    def test_unrecognized_transfer_remains_ineligible_for_conversion(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'unlabeled.png'
            write_png(path, np.ones((8, 8, 4)))
            with self.assertRaisesRegex(ValueError, 'recognized HDR signaling'):
                inspect_source(path)

    def test_native_png_source_derivatives_pass_the_existing_appearance_gates(self):
        spec = {'id': 'png-pq-rec2020-16-alpha', 'transfer': 'pq',
                'gamut': 'rec2020', 'depth': 16, 'alpha': True, 'frames': 1}
        with tempfile.TemporaryDirectory() as directory:
            result = run(Path(directory), specs=[spec], geometries=('contain',))
        self.assertEqual(len(result['evidence']), 7)
        for case in result['evidence']:
            with self.subTest(case=case['case_id']):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertEqual(case['cell_id'].split(':')[0], 'hdr-png')
                self.assertEqual(case['privacy_measurement']['exif_xmp_tags'], {})

    def test_identity_same_format_is_a_byte_exact_control_not_a_fake_encode(self):
        spec = {'id': 'png-hlg-p3-16-opaque', 'transfer': 'hlg',
                'gamut': 'p3', 'depth': 16, 'alpha': False, 'frames': 1}
        with tempfile.TemporaryDirectory() as directory:
            result = run(Path(directory), specs=[spec], geometries=('identity',))
        controls = [control for control in result['controls'] if 'variant' not in control]
        self.assertEqual(len(controls), 1)
        self.assertTrue(controls[0]['passed'])
        self.assertTrue(controls[0]['exact_bytes'])
        self.assertTrue(controls[0]['no_native_calls'])
        self.assertTrue(controls[0]['retained_source_metadata'])
        self.assertEqual(controls[0]['status'], 'passed')
        self.assertTrue(all(controls[0]['checks'].values()))
        self.assertIn('case_id', controls[0])
        self.assertFalse(any(case['cell_id'] == 'hdr-png:hdr:png' for case in result['evidence']))

    def test_numeric_private_metadata_fails_without_the_literal_privacy_marker(self):
        from hdr_png import inspect_privacy
        from avif import native
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'private.png'
            write_png(path, np.ones((8, 8, 4)))
            native(['exiftool', '-overwrite_original', '-GPSLatitude=51.5',
                    '-GPSLatitudeRef=N', '-Model=Test Camera', '-SerialNumber=987654', path])
            self.assertNotIn(b'HDR-PROOF-PRIVATE', path.read_bytes())
            result = inspect_privacy(path, {'exiftool': {}}, 'png')
            self.assertFalse(result['passed'])
            self.assertTrue(result['exif_xmp_tags'])

    def test_nonidentity_exif_orientation_is_baked_once_with_native_pixels(self):
        from hdr_png import generate_orientation_fixture, bake_orientation
        spec = next(spec for spec in fixture_specs() if spec['alpha'])
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, _, _ = generate_fixture(spec, directory)
            original = source.read_bytes()
            oriented, facts = generate_orientation_fixture(source, directory/'orientation-8.png')
            self.assertEqual(facts['orientation'], 8)
            self.assertEqual((facts['width'], facts['height']), (96, 64))
            self.assertEqual((facts['display_width'], facts['display_height']), (64, 96))
            self.assertEqual(source.read_bytes(), original)
            self.assertNotEqual(oriented.read_bytes(), original)
            np.testing.assert_array_equal(read_png(oriented), read_png(source))
            baked = directory/'baked.png'
            bake_orientation(oriented, baked, facts)
            baked_facts = inspect_source(baked)
            self.assertEqual(baked_facts['orientation'], 1)
            self.assertEqual((baked_facts['width'], baked_facts['height']), (64, 96))
            np.testing.assert_array_equal(read_png(baked), np.rot90(read_png(source)))

    def test_remaining_geometries_measure_real_native_outputs(self):
        spec = {'id': 'png-hlg-p3-16-alpha', 'transfer': 'hlg',
                'gamut': 'p3', 'depth': 16, 'alpha': True, 'frames': 1}
        with tempfile.TemporaryDirectory() as directory:
            result = run(Path(directory), specs=[spec],
                         geometries=('cover', 'fill', 'upscale', 'orientation'))
        self.assertEqual(len(result['evidence']), 28)
        self.assertEqual(len(result['fixtures']), 2)
        for case in result['evidence']:
            with self.subTest(case=case['case_id']):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                if case['geometry'] == 'orientation':
                    self.assertEqual(case['source_facts']['orientation'], 8)
                    self.assertTrue(case['orientation_source']['exact_rotation'])
                    self.assertTrue(case['fixture_id'].endswith('-orientation-8'))
                    self.assertEqual(case['source_facts']['display_width'], 64)
                    self.assertTrue(case['structural_checks']['orientation_baked'])

    def test_conflicting_and_unknown_png_signaling_keeps_only_exact_originals(self):
        from hdr_png import source_rejection_controls
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, _, _ = generate_fixture(next(fixture_specs()), directory)
            controls = source_rejection_controls(source, directory/'negative')
            self.assertEqual({control['variant'] for control in controls}, {
                'unknown-transfer', 'conflicting-cicp', 'duplicate-cicp',
                'invalid-cicp-crc', 'conflicting-icc', 'conflicting-srgb'})
            for control in controls:
                with self.subTest(variant=control['variant']):
                    self.assertEqual(control['status'], 'passed')
                    self.assertTrue(all(control['checks'].values()), control)
                    self.assertEqual(control['transformed_decision']['action'], 'metadata-pending')
                    self.assertEqual(control['original_decision']['action'], 'original')
                    self.assertEqual(control['source_sha256'], control['original_sha256'])
                    self.assertFalse(control['codec_qualification'])
                    with self.assertRaisesRegex(ValueError, 'recognized HDR signaling'):
                        inspect_source(Path(control['source']))


if __name__ == '__main__':
    unittest.main()
