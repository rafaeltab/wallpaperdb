"""APNG proof requires independent full-precision frames and animation facts."""
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

import apng
import avif
from hdr_png import _png_chunks


class ApngTests(unittest.TestCase):
    def test_native_hdr_fixtures_preserve_16bit_pixels_alpha_and_timing(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for spec in apng.fixture_specs():
                with self.subTest(spec=spec):
                    source, facts, authored = apng.generate_fixture(spec, directory/spec['id'])
                    repeated, _, _ = apng.generate_fixture(spec, directory/'repeat'/spec['id'])
                    self.assertEqual(source.read_bytes(), repeated.read_bytes())
                    oriented, oriented_facts, _ = apng.generate_orientation_fixture(source, directory/'orientation'/spec['id'])
                    repeated_orientation, _, _ = apng.generate_orientation_fixture(repeated, directory/'repeat-orientation'/spec['id'])
                    self.assertEqual(oriented.read_bytes(), repeated_orientation.read_bytes())
                    self.assertEqual(oriented_facts['orientation'], 8)
                    facts, frames = apng.inspect_and_decode(source, directory/'decoded'/spec['id'])
                    self.assertEqual(facts['depth'], 16)
                    self.assertEqual(facts['primaries'], avif.PRIMARIES[spec['gamut']])
                    self.assertEqual(facts['transfer'], avif.TRANSFERS[spec['transfer']])
                    self.assertEqual(facts['durations_ms'], [300, 700])
                    self.assertEqual(facts['plays'], 3)
                    self.assertEqual(facts['frames'], 2)
                    self.assertEqual(facts['decoder'], 'independent APNG chunk reader and native libpng')
                    np.testing.assert_array_equal(authored[0][:32, 44:51], authored[1][:32, 44:51])
                    for index, (actual, analytic) in enumerate(zip(frames, authored)):
                        original = avif.read_png(source.parent/f'frame-{index}.png')
                        np.testing.assert_array_equal(actual, original)
                        self.assertTrue(np.any((actual[..., 3] > 0) & (actual[..., 3] < 1)))
                        self.assertEqual(actual.shape, analytic.shape)
                    self.assertIn('GPSLatitude', facts['exiftool'])

    def test_unsupported_composition_and_conflicting_animation_facts_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source, _, _ = apng.generate_fixture(next(apng.fixture_specs()), directory)
            chunks = _png_chunks(source.read_bytes())
            variants = ('over-blend', 'previous-disposal', 'partial-default-frame',
                        'bad-sequence', 'frame-count', 'zero-duration', 'duplicate-cicp',
                        'rectangle-outside-canvas')
            for variant in variants:
                modified = []
                changed = False
                for kind, payload in chunks:
                    if (kind == b'fcTL' and not changed
                            and (variant != 'rectangle-outside-canvas' or struct.unpack_from('>I', payload)[0] != 0)):
                        values = list(struct.unpack('>IIIIIHHBB', payload))
                        if variant == 'over-blend': values[8] = 1
                        if variant == 'previous-disposal': values[7] = 2
                        if variant == 'partial-default-frame': values[1] -= 1
                        if variant == 'rectangle-outside-canvas': values[3] = 1
                        if variant == 'bad-sequence': values[0] = 7
                        if variant == 'zero-duration': values[5] = 0
                        payload = struct.pack('>IIIIIHHBB', *values)
                        changed = True
                    if kind == b'acTL' and variant == 'frame-count':
                        payload = struct.pack('>II', 3, 3)
                    if kind == b'cICP' and variant == 'duplicate-cicp':
                        modified.append((kind, bytes((1, 13, 0, 1))))
                    modified.append((kind, payload))
                path = directory/f'{variant}.png'
                path.write_bytes(apng.pack_chunks(modified))
                with self.subTest(variant=variant):
                    with self.assertRaisesRegex(ValueError, 'APNG proof subset'):
                        apng.inspect_and_decode(path, directory/variant)

    def test_contain_hdr_and_explicit_sdr_sequences_meet_existing_gates(self):
        spec = next(apng.fixture_specs())
        with tempfile.TemporaryDirectory() as temporary:
            result = apng.run(Path(temporary), specs=[spec], geometries=('contain',), motions=('preserve',))
        self.assertEqual(len(result['evidence']), 5)
        for case in result['evidence']:
            with self.subTest(case=case['case_id']):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(all(case['checks'].values()))
                self.assertTrue(case['privacy_measurement']['passed'])
                self.assertEqual(len(case['measurements']['frames']), 2)
                white = case['measurements']['sequence_white_control']
                self.assertTrue(white['reference_samples_identical'])
                self.assertEqual(white['maximum_signal_difference'], 0)
                self.assertTrue(white['passed'])
                self.assertEqual(case['facts'].get('durations_ms', [300, 700]), [300, 700])
        self.assertTrue(result['controls'])
        self.assertTrue(all(control['passed'] for control in result['controls']))

    def test_real_native_source_rectangle_reconstructs_exact_full_frames(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            first = avif.make_scene(True)
            second = first.copy()
            second[32:] = np.roll(second[32:], 16, axis=1)
            paths = []
            for index, frame in enumerate((first, second)):
                signal = frame.copy()
                signal[..., :3] = avif.encode_transfer(frame[..., :3], 'pq', 'p3')
                path = folder/f'frame-{index}.png'
                avif.write_png(path, signal)
                paths.append(path)
            source = folder/'native-partial.png'
            apng.encode(paths, source, 'pq', 'p3')
            controls = [struct.unpack('>IIIIIHHBB', payload)
                        for kind, payload in _png_chunks(source.read_bytes()) if kind == b'fcTL']
            self.assertEqual(controls[1][1:5], (96, 32, 0, 32))
            facts, frames = apng.inspect_and_decode(source, folder/'decoded')
            self.assertEqual(facts['frame_rectangles'], [[0, 0, 96, 64], [0, 32, 96, 32]])
            self.assertEqual(facts['durations_ms'], [300, 700])
            for index, actual in enumerate(frames):
                expected = avif.read_png(paths[index])
                np.testing.assert_array_equal(actual, expected)
                np.testing.assert_array_equal(avif.read_png(facts['decoded_paths'][index]), expected)
            self.assertTrue(np.any(frames[1][32:, :, 3] == 0))
            self.assertTrue(np.any((frames[1][32:, :, 3] > 0) & (frames[1][32:, :, 3] < 1)))

    def test_offset_rectangle_replaces_rgb_and_alpha_without_blending(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            first = avif.make_scene(True)
            second = first.copy()
            second[40:56, 20:60, :3] = [400, 200, 15]
            second[40:56, 20:60, 3] = 2/3
            second[45:48, 30:33, 3] = 0
            paths = []
            for index, frame in enumerate((first, second)):
                signal = frame.copy()
                signal[..., :3] = avif.encode_transfer(frame[..., :3], 'hlg', 'rec2020')
                path = folder/f'frame-{index}.png'
                avif.write_png(path, signal)
                paths.append(path)
            source = folder/'offset-source.png'
            apng.encode(paths, source, 'hlg', 'rec2020')
            facts, frames = apng.inspect_and_decode(source, folder/'decoded')
            self.assertEqual(facts['frame_rectangles'][1], [20, 40, 40, 16])
            np.testing.assert_array_equal(frames[1], avif.read_png(paths[1]))
            self.assertTrue(np.all(frames[1][45:48, 30:33, :3] > 0))
            self.assertTrue(np.all(frames[1][45:48, 30:33, 3] == 0))

    def test_inspected_animation_candidates_are_prepared_for_pending_manual_review(self):
        import suite
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            result = apng.run(folder/'work', specs=[next(apng.fixture_specs())],
                              geometries=('contain', 'orientation'), motions=('preserve',))
            (folder/'results').mkdir()
            # Only the evidence destination changes; every fixture and candidate
            # above uses its real native encoder and independent decoder.
            with patch.object(suite, 'ROOT', folder), patch.object(suite, 'RESULTS', folder/'results'):
                files = suite.candidate_files(result['evidence'], result['fixtures'])
            self.assertEqual(len(files), 12)
            self.assertTrue(all(entry['consumer_status'] == 'pending manual review' for entry in files))
            candidates = [entry for entry in files if entry['case_id']]
            self.assertEqual(len(candidates), 10)
            self.assertTrue(all(entry['codec_status'] == 'qualified' for entry in candidates))
            self.assertTrue(all(entry['sha256'] == avif.digest(folder/'results/manual'/entry['file']) for entry in files))

    def test_crop_stretch_upscale_and_real_orientation_preserve_animation(self):
        spec = next(spec for spec in apng.fixture_specs()
                    if spec['transfer'] == 'hlg' and spec['gamut'] == 'rec2020')
        with tempfile.TemporaryDirectory() as temporary:
            result = apng.run(Path(temporary), specs=[spec],
                              geometries=('cover', 'fill', 'upscale', 'orientation'), motions=('preserve',))
        self.assertEqual(len(result['evidence']), 20)
        self.assertEqual(len(result['fixtures']), 2)
        for case in result['evidence']:
            with self.subTest(case=case['case_id']):
                self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertTrue(case['measurements']['sequence_white_control']['passed'])
                self.assertGreater(case['measurements']['sequence_white_control']['samples'], 0)
                self.assertTrue(case['structural_checks']['orientation_baked'])
                if case['geometry'] == 'orientation':
                    self.assertEqual(case['source_facts']['orientation'], 8)
                    self.assertEqual(case['source_facts']['display_width'], 64)
                    self.assertTrue(case['fixture_id'].endswith('-orientation-8'))
                    self.assertTrue(all(case['orientation_source']['exact_rotation_frames']))

    def test_explicit_static_extraction_selects_first_frame_and_coerces_alpha(self):
        spec = next(apng.fixture_specs())
        with tempfile.TemporaryDirectory() as temporary:
            result = apng.run(Path(temporary), specs=[spec],
                              geometries=('contain', 'orientation'), motions=('static',))
            png = next(case for case in result['evidence']
                       if case['geometry'] == 'contain' and case['cell_id'] == 'hdr-png:hdr:png')
            actual = avif.decode_transfer(avif.read_png(png['artifacts']['output'])[..., :3], 'pq', 'p3')
            # The first source frame peaks at 1000 nits; frame 2 contains 4000 nits.
            # This binds selection to real decoded pixels, not a reported label.
            self.assertLess(float(np.max(actual)), 1001)
        self.assertEqual(len(result['evidence']), 14)
        for case in result['evidence']:
            with self.subTest(case=case['case_id']):
                if case['selectors']['format'] == 'gif' and case['geometry'] == 'orientation':
                    self.assertEqual(case['status'], 'tested and failed')
                    self.assertEqual(case['blockers'], ['Failed appearance check'])
                    self.assertTrue(all(case['checks'][key] for key in
                        ('native_encoder', 'independent_decoder', 'structure', 'privacy')))
                    self.assertFalse(case['checks']['appearance'])
                    self.assertGreater(case['measurements']['frames'][0]['regions']['shadow']['delta_e_itp']['mean'], 1)
                else:
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                self.assertEqual(case['selectors']['motion'], 'static')
                self.assertEqual(case['frame_selection'], 'first fully composed frame')
                self.assertEqual(len(case['measurements']['frames']), 1)
                self.assertIsNone(case['measurements']['sequence_white_control'])
                self.assertTrue(case['structural_checks']['frames'])
                self.assertTrue(case['structural_checks']['alpha'])
                if case['selectors']['format'] in ('jpg', 'gif'):
                    self.assertEqual(case['selectors']['transparency'], 'coerce')
                    self.assertEqual(case['facts']['alpha_measurement']['maximum_absolute_error'], 0)
                else:
                    self.assertEqual(case['selectors']['transparency'], 'preserve')
        rejected = [control for control in result['controls'] if control.get('variant', '').endswith('preserve-alpha')]
        self.assertEqual(len(rejected), 2)
        self.assertTrue(all(control['passed'] for control in rejected))


if __name__ == '__main__':
    unittest.main()
