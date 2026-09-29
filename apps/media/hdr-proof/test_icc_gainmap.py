"""Native ICC interpretation controls precede experimental HDR qualification."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from avif import native
from gamma_icc import make_profile, profile_facts

TOOL = '/opt/proof/icc-gainmap/hdr-proof-icc-gainmap'


class IccGainmapTests(unittest.TestCase):
    def test_actual_packed_file_agrees_at_zero_fractional_and_full_headroom(self):
        self._headroom_control('moderateoffset')

    def test_smalloffset_actual_file_keeps_same_analytic_headroom_controls(self):
        self._headroom_control('smalloffset')

    def test_smalloffset_gamma2_uses_real_metadata_at_all_display_headrooms(self):
        self._headroom_control('smalloffset', map_gamma=2)

    def test_midpointoffset_gamma2_uses_real_metadata_at_all_display_headrooms(self):
        self._headroom_control('midpointoffset', map_gamma=2)

    def test_midpointoffset_gamma2_islow_map_preserves_headroom_controls(self):
        self._headroom_control('midpointoffset', map_gamma=2, map_method='islow')

    def test_midpointoffset_gamma15_preserves_fractional_metadata_and_headroom(self):
        self._headroom_control('midpointoffset', map_gamma=1.5)

    def test_midpointoffset_gamma15_islow_preserves_fractional_metadata_and_headroom(self):
        self._headroom_control('midpointoffset', map_gamma=1.5, map_method='islow')

    def _headroom_control(self, map_policy, *, map_gamma=1, map_method='float'):
        from avif import encode_transfer
        from icc_gainmap import pack, independent_decode, native_decode
        from appearance import compare_appearance
        import gainmap
        from gainmap_metadata import check_metadata
        codes = np.array([[0, 0, 0], [1, 1, 1], [2, 2, 2], [16, 32, 64],
                          [64, 128, 192], [255, 255, 255]], dtype=np.uint8)
        pixels = np.repeat(np.repeat(codes[None], 8, axis=0), 8, axis=1)
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            base, hdr, output = folder/'base.jpg', folder/'hdr.png', folder/'output.jpg'
            profile = make_profile(gamma=3.2, gamut='p3')
            Image.fromarray(pixels).save(base, quality=100, subsampling=0, keep_rgb=True, icc_profile=profile)
            linear = (pixels/255) ** profile_facts(profile)['gammas']
            pq = np.rint(encode_transfer(linear*406, 'pq', 'p3')*65535).astype('<u2')
            native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb48le',
                '-s', '48x8', '-i', 'pipe:0', '-vf', 'format=gbrp16le,zscale=transferin=16:transfer=16:primariesin=12:primaries=12:matrixin=0:matrix=0:rangein=full:range=full,format=rgb48le',
                '-frames:v', '1', '-color_primaries', '12',
                '-color_trc', '16', '-colorspace', '0', '-color_range', '2', hdr], data=pq.tobytes())
            evidence = pack(base, hdr, output, map_policy=map_policy, map_gamma=map_gamma, map_method=map_method)
            facts = gainmap.inspect(output, folder/'inspection')
            self.assertEqual((facts['base']['sof'], facts['map']['sof']), (0, 0))
            self.assertEqual((evidence['coded_base_depth'], evidence['coded_map_depth']), (8, 8))
            with Image.open(output) as decoded:
                self.assertEqual(decoded.info['icc_profile'], profile)
            probe = json.loads(native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
            self.assertTrue(all(check_metadata(facts, probe)['checks'].values()))
            self.assertEqual(probe['gamma'], [map_gamma]*3)
            self.assertTrue(all(channel['gamma'] == map_gamma for channel in facts['iso_metadata']['channels']))
            expected_offset = {'moderateoffset': 1/4096, 'smalloffset': 1/65536, 'midpointoffset': 1/16384}[map_policy]
            self.assertTrue(all(channel[field] == expected_offset for channel in facts['iso_metadata']['channels']
                                for field in ('base_offset', 'alternate_offset')))
            if map_gamma != 1:
                from avif import decode_transfer, read_png
                metadata = facts['iso_metadata']['channels']
                metadata *= 3 if len(metadata) == 1 else 1
                minimum = np.array([channel['minimum'] for channel in metadata])
                maximum = np.array([channel['maximum'] for channel in metadata])
                offset = np.array([channel['base_offset'] for channel in metadata])
                target = decode_transfer(read_png(hdr)[..., :3], 'pq', 'p3')/203
                normalized = np.clip((np.log2((target+offset)/(linear+offset))-minimum)/(maximum-minimum), 0, 1)
                expected_codes = normalized**map_gamma*255
                map_codes = np.asarray(Image.open(evidence['computed_map']).convert('RGB'))
                self.assertTrue(np.any((expected_codes > 16) & (expected_codes < 239)))
                # Half a code is nearest-integer quantization. The extra
                # 0.01 code bounds native float PQ/ICC and metadata rounding.
                self.assertLessEqual(float(np.max(np.abs(map_codes-expected_codes))), .51)
                # A fractional-gamma packer must reject gamma1 metadata, even
                # though both sets of JPEG sample arrays are decodable.
                gamma1 = folder/'gamma1.avif'
                native([TOOL.replace('/hdr-proof-', '/smalloffset/hdr-proof-'),
                        'compute', base, hdr, gamma1])
                variant = 'midpointoffset-gamma15' if map_gamma == 1.5 else f'{map_policy}-gamma2'
                gamma_tool = TOOL.replace('/hdr-proof-', f'/{variant}/hdr-proof-')
                mode = ('pack-gamma15-midpoint' if map_gamma == 1.5 else
                        'pack-gamma2-midpoint' if map_policy == 'midpointoffset' else 'pack-gamma2')
                rejected = folder/'wrong-gamma.jpg'
                with self.assertRaisesRegex(RuntimeError, 'gamma/offset'):
                    native([gamma_tool, mode, gamma1, base,
                            folder/'output-icc-parts/map.jpg', rejected])
                self.assertFalse(rejected.exists())
                for wrong_mode in ('pack-gamma2', 'pack-gamma2-midpoint', 'pack-gamma15-midpoint'):
                    if wrong_mode == mode:
                        continue
                    with self.subTest(mode=wrong_mode), self.assertRaisesRegex(RuntimeError, 'gamma/offset'):
                        native([gamma_tool, wrong_mode, folder/'output-icc-parts/combined.avif', base,
                                folder/'output-icc-parts/map.jpg', rejected])
                    self.assertFalse(rejected.exists())
                with self.assertRaisesRegex(RuntimeError, 'gamma 1'):
                    native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'pack-avif',
                            folder/'output-icc-parts/combined.avif', base,
                            folder/'output-icc-parts/map.jpg', rejected])
                self.assertFalse(rejected.exists())
            for boost in (1, 2**.5, 2, 16):
                expected, oracle = independent_decode(output, folder/'inspection/map.jpg', boost=boost)
                actual, native_facts = native_decode(output, folder/f'{boost}.rgbf32', boost=boost)
                self.assertEqual(native_facts['gamut'], oracle['gamut'])
                self.assertTrue(np.allclose(actual, expected, rtol=3e-6, atol=2e-5),
                                float(np.max(np.abs(actual-expected))))
                if boost == 1:
                    self.assertTrue(np.allclose(actual, linear*203, rtol=3e-5, atol=2e-8))
                    self.assertGreater(float(actual[0, 8, 0]), 0)
                if boost == 16:
                    measurement = compare_appearance(linear*406, actual, reference_gamut='p3',
                        actual_gamut='p3', fixture_class='gainmap-hdr')
                    self.assertTrue(measurement['passed'], measurement['failures'])
            # Rejection protects the original-only boundary; no guessed
            # transfer can produce a derivative from these altered facts.
            from hdr_png import _png_chunks
            import struct
            import zlib
            chunks = _png_chunks(hdr.read_bytes())
            for label in ('missing', 'wrong', 'bad-crc'):
                modified = bytearray(b'\x89PNG\r\n\x1a\n')
                for kind, payload in chunks:
                    if kind == b'cICP' and label == 'missing':
                        continue
                    if kind == b'cICP' and label == 'wrong':
                        payload = bytes([12, 18, 0, 1])
                    crc = zlib.crc32(kind+payload) ^ int(kind == b'cICP' and label == 'bad-crc')
                    modified.extend(struct.pack('>I', len(payload))+kind+payload+struct.pack('>I', crc))
                wrong = folder/f'{label}.png'
                wrong.write_bytes(modified)
                with self.subTest(label=label), self.assertRaisesRegex(RuntimeError, 'PNG'):
                    pack(base, wrong, folder/f'{label}.jpg', map_policy=map_policy, map_gamma=map_gamma, map_method=map_method)
                self.assertFalse((folder/f'{label}.jpg').exists())
            # Without HDR output qualification, an unknown ICC must still
            # stop the native HDR decoder before applying gain.
            native(['exiftool', '-overwrite_original', '-ICC_Profile=', output])
            with self.assertRaisesRegex(RuntimeError, 'ICC'):
                native_decode(output, folder/'unknown.rgbf32')

    def test_unsupported_gamma_and_offset_combinations_stop_before_encoding(self):
        from icc_gainmap import pack
        import avif
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)/'unknown.jpg'
            for policy, gamma in (('moderateoffset', 2), ('smalloffset', 0),
                                  ('smalloffset', 3), ('smalloffset', True),
                                  ('unknown', 1), ('smalloffset', float('nan')), ('midpointoffset', 1),
                                  ('smalloffset', 1.5), ('moderateoffset', 1.5)):
                before = len(avif.COMMANDS)
                with self.subTest(policy=policy, gamma=gamma), self.assertRaises(ValueError):
                    pack('missing-base.jpg', 'missing-intent.png', output,
                         map_policy=policy, map_gamma=gamma)
                self.assertEqual(len(avif.COMMANDS), before)
                self.assertFalse(output.exists())
            for policy, gamma, method in (('smalloffset', 2, 'islow'),
                    ('moderateoffset', 1, 'islow'), ('midpointoffset', 2, 'unknown')):
                before = len(avif.COMMANDS)
                with self.subTest(policy=policy, method=method), self.assertRaises(ValueError):
                    pack('missing-base.jpg', 'missing-intent.png', output,
                         map_policy=policy, map_gamma=gamma, map_method=method)
                self.assertEqual(len(avif.COMMANDS), before)
                self.assertFalse(output.exists())

    def test_native_lcms_reads_actual_gamma_profile_and_near_black_codes(self):
        codes = np.array([[0, 0, 0], [1, 1, 1], [2, 2, 2], [4, 2, 1],
                          [64, 32, 128], [255, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8)
        pixels = np.repeat(np.repeat(codes[None], 8, axis=0), 8, axis=1)
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for gamut in ('srgb', 'p3'):
                profile = make_profile(gamma=3.2, gamut=gamut)
                source, output = folder/f'{gamut}.jpg', folder/f'{gamut}.rgbf32'
                Image.fromarray(pixels).save(source, quality=100, subsampling=0,
                                            keep_rgb=True, icc_profile=profile)
                facts = json.loads(native([TOOL, 'linearize', source, output]))
                decoded = np.frombuffer(native(['ffmpeg', '-v', 'error', '-i', source,
                    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']), np.uint8).reshape(pixels.shape)
                expected = (decoded.astype(float)/255) ** np.array(profile_facts(profile)['gammas'])
                actual = np.fromfile(output, '<f4').reshape(pixels.shape)
                self.assertEqual(facts['gamut'], gamut)
                self.assertEqual(facts['lcms_version'], 2190)
                self.assertEqual(facts['base_depth'], 8)
                self.assertTrue(np.allclose(actual, expected, rtol=3e-5, atol=2e-8),
                                float(np.max(np.abs(actual-expected))))
                self.assertGreater(float(actual[0, 8, 0]), 0)
                self.assertTrue(np.array_equal(actual[0, 0], [0, 0, 0]))

    def test_missing_unknown_and_tampered_icc_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            gamma32 = make_profile(gamma=3.2)
            # A2B0 may override matrix/TRC semantics even if its payload is
            # malformed. It must never silently fall back to the matrix.
            lut = gamma32.replace(b'chrm', b'A2B0', 1)
            for label, profile in (('missing', None), ('gamma22', make_profile(gamma=2.2)),
                                   ('lut', lut), ('truncated', gamma32[:-12])):
                source = folder/f'{label}.jpg'
                Image.new('RGB', (8, 8), (64, 32, 16)).save(source, quality=100,
                    keep_rgb=True, icc_profile=profile)
                with self.subTest(label=label), self.assertRaisesRegex(RuntimeError, 'ICC'):
                    native([TOOL, 'linearize', source, folder/f'{label}.raw'])
                self.assertFalse((folder/f'{label}.raw').exists())

    def test_bounded_original_iso_candidate_stays_failed_when_independent_decoder_fails(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary))['cases'][0]
            self.assertEqual(case['status'], 'tested and failed', case['blockers'])
            self.assertTrue(case['checks']['native_encoder'])
            self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
            self.assertTrue(case['measurements']['reconstructed_hdr']['passed'])
            self.assertFalse(case['measurements']['independent_hdr']['passed'])
            self.assertFalse(case['checks']['independent_decoder'])
            self.assertFalse(case['checks']['appearance'])
            self.assertTrue(case['checks']['structure'])
            self.assertTrue(case['checks']['privacy'])
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['artifacts']['sha256'], '8779b4f315b847692c25551a673ffdf435d99cf3e354f0a4365f498a1fc9f94a')
            diagnostic = case['sample_precision_diagnostics']
            self.assertEqual(diagnostic['pixel_xy'], [436, 371])
            self.assertEqual(diagnostic['base']['native_codes'], [24, 29, 44])
            self.assertEqual(diagnostic['base']['independent_codes'], [25, 29, 43])
            self.assertEqual(diagnostic['map']['native_codes'], diagnostic['map']['independent_codes'])

    def test_smaller_offset_retains_midtone_and_highlight_failures(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), map_policy='smalloffset')
            case = report['cases'][0]
            self.assertEqual(case['status'], 'tested and failed', case['blockers'])
            self.assertTrue(case['checks']['independent_decoder'])
            self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
            self.assertFalse(case['measurements']['reconstructed_hdr']['passed'])
            self.assertIn('highlight.delta_e_max', case['measurements']['reconstructed_hdr']['failures'])
            self.assertEqual(case['artifacts']['sha256'], '3f902ea8d4f3811bb3a0244cda81862fe38ee10cb3e28c860edc327b8d76202c')
            self.assertTrue(report['commands'])
            self.assertTrue(report['gainmap_commands'])
            self.assertIn('lcms2.h', report['native_source_hashes'])

    def test_gamma2_retains_real_source_appearance_failures(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), map_policy='smalloffset', map_gamma=2)
            case = report['cases'][0]
            self.assertEqual(case['status'], 'tested and failed', case['blockers'])
            self.assertEqual(case['blockers'], ['Failed appearance check'])
            self.assertTrue(case['checks']['independent_decoder'])
            self.assertTrue(case['structural_checks']['requested_map_gamma'])
            self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
            for decoder in ('reconstructed_hdr', 'independent_hdr'):
                failures = case['measurements'][decoder]['failures']
                self.assertIn('shadow.delta_e_max', failures)
                self.assertIn('midtone.delta_e_mean', failures)
                self.assertIn('highlight.delta_e_mean', failures)
                self.assertNotIn('highlight.delta_e_max', failures)
            self.assertEqual(case['artifacts']['sha256'], '3bc969bc0e724859f1f2ddebc138f05fc5b8db1522898f5aa80b6460e7d2d633')
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
            self.assertTrue(case['case_id'].endswith('map-gamma2:gainmap-hdr-target-gamut-v1'))

    def test_midpoint_gamma2_retains_shadow_and_reader_failures(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), map_policy='midpointoffset', map_gamma=2)
            case = report['cases'][0]
            self.assertEqual(case['status'], 'tested and failed', case['blockers'])
            self.assertEqual(case['blockers'], ['Failed independent_decoder check', 'Failed appearance check'])
            self.assertTrue(case['checks']['structure'])
            self.assertTrue(case['checks']['privacy'])
            self.assertTrue(case['structural_checks']['requested_map_offsets'])
            self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
            for decoder in ('reconstructed_hdr', 'independent_hdr', 'independent_hdr_cross_decoder'):
                self.assertEqual(case['measurements'][decoder]['failures'], ['shadow.delta_e_max'])
            self.assertEqual(case['artifacts']['sha256'], 'b1d0e22f2c31f7c328c13e713f750a26115f3de7f3c3db28b4166fa463e175d7')
            self.assertEqual(case['native_candidate']['base_sha256'], '5177870d6a7e34011d293ec0da6758d0b02778c095958d024d6a700ef32fff4a')
            self.assertEqual(case['native_candidate']['computed_map_sha256'], '0fda8bd2d28eaa61d02e39657f2405d34af28556e45fd77b3b6abd24749d496d')
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
            self.assertIn('midpointoffset', case['case_id'])

    def test_islow_map_retains_failure_with_identical_base_and_native_map_input(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary), map_policy='midpointoffset', map_gamma=2, map_method='islow')['cases'][0]
            self.assertEqual(case['status'], 'tested and failed', case['blockers'])
            self.assertEqual(case['blockers'], ['Failed independent_decoder check', 'Failed appearance check'])
            self.assertTrue(case['checks']['structure'])
            self.assertTrue(case['checks']['privacy'])
            self.assertTrue(case['measurements']['authored_sdr_base']['passed'])
            for decoder in ('reconstructed_hdr', 'independent_hdr', 'independent_hdr_cross_decoder'):
                self.assertEqual(case['measurements'][decoder]['failures'], ['shadow.delta_e_max'])
            self.assertEqual(case['artifacts']['sha256'], 'c08d5f0e1f6c301dbc35730e51a064b3b40e7d0522b13ced6673811690309905')
            self.assertEqual(case['native_candidate']['base_sha256'], '5177870d6a7e34011d293ec0da6758d0b02778c095958d024d6a700ef32fff4a')
            self.assertEqual(case['native_candidate']['computed_map_sha256'], '0fda8bd2d28eaa61d02e39657f2405d34af28556e45fd77b3b6abd24749d496d')
            self.assertEqual(case['native_candidate']['map_encoding']['method'], 'islow')
            self.assertIn('dct-islow-map', case['case_id'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_gamma15_midpoint_qualifies_only_the_explicit_icc_aware_file_path(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary), map_policy='midpointoffset', map_gamma=1.5)
            case = report['cases'][0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
            self.assertTrue(case['structural_checks']['requested_map_gamma'])
            self.assertTrue(case['structural_checks']['requested_map_offsets'])
            self.assertEqual(case['native_metadata_probe']['gamma'], [1.5]*3)
            self.assertEqual(case['artifacts']['sha256'], '37376e5629f11d61debb2664cd2568fd1965d30268e1d0acc76810e01e6826a2')
            self.assertEqual(case['native_candidate']['base_sha256'], '5177870d6a7e34011d293ec0da6758d0b02778c095958d024d6a700ef32fff4a')
            self.assertEqual(case['native_candidate']['computed_map_sha256'], 'cfac5baf0333f8db5c9ef6fc40e9809035d3594de18fe3ce6a2495d5fe062d25')
            self.assertTrue(case['case_id'].endswith('map-gamma1.5:gainmap-hdr-target-gamut-v1'))
            self.assertIn('Experimental native ICC-aware file path only', case['qualification_scope'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_xmp_scope_rejects_unproved_recipes_and_sources_before_native_calls(self):
        import avif
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for arguments in ({'source_id': 'gainmap-apple-new'},
                    {'source_id': 'gainmap-android-xmp'},
                    {'source_id': 'gainmap-android-xmp', 'map_policy': 'midpointoffset', 'map_gamma': 2}):
                before = len(avif.COMMANDS)
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    run(Path(temporary), **arguments)
                self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_apple_old_scope_rejects_other_geometries_before_native_calls(self):
        import avif
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for source_id, operation in (('gainmap-apple-old', 'fill'), ('gainmap-apple-old', 'crop'),
                                        ('gainmap-android-xmp', 'contain'), ('gainmap-android-iso', 'contain')):
                before = len(avif.COMMANDS)
                with self.subTest(source=source_id, operation=operation), self.assertRaises(ValueError):
                    run(Path(temporary), source_id=source_id, operation=operation,
                        map_policy='midpointoffset', map_gamma=1.5)
                self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_old_apple_without_headroom_makernotes_has_no_native_hdr_derivative(self):
        import avif
        import gainmap_hdr
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            changed = folder/'unknown-headroom.jpg'
            changed.write_bytes((Path(__file__).parent/'fixtures/gainmap/gainmap-apple-old.jpg').read_bytes())
            native(['exiftool', '-overwrite_original', '-MakerNotes=', changed])
            before = avif.digest(changed)
            tags = json.loads(native(['exiftool', '-json', '-G1', '-s', changed]))[0]
            self.assertNotIn('Apple:HDRHeadroom', tags)
            self.assertNotIn('Apple:HDRGain', tags)
            with self.assertRaises(RuntimeError):
                gainmap_hdr.decode_source(changed, folder/'native', 'p3')
            self.assertFalse((folder/'native/source-pq-rec2020.png').exists())
            self.assertEqual(avif.digest(changed), before)

    def test_old_apple_contain_and_upscale_qualify_with_actual_makernote_headroom(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for operation, expected_size, expected_hash in (
                    ('contain', (173, 231), '067ffe32fe8c5f99b9ac1152faa414c5c557f56c8b2457fe692fb66b7c24f3a3'),
                    ('upscale', (769, 1025), 'd156cf699b0e3adfcbf0eb2efb958b2747925ba050b6c2e6cbd8ae82c3ad01e9')):
                with self.subTest(operation=operation):
                    case = run(Path(temporary)/operation, source_id='gainmap-apple-old', operation=operation,
                               map_policy='midpointoffset', map_gamma=1.5)['cases'][0]
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertTrue(all(case['checks'].values()))
                    self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
                    self.assertEqual(case['source_precision'], 'pq16')
                    self.assertIn('MakerNotes33/48', case['source_model_evidence']['headroom_origin'])
                    self.assertAlmostEqual(case['source_model_evidence']['exiftool_hdr_headroom'], 1.518931985)
                    self.assertEqual(case['source_model_evidence']['exiftool_hdr_gain'], 0)
                    self.assertEqual(case['hdr_intent']['facts']['metadata']['PNG-cICP:ColorPrimaries'], 12)
                    self.assertEqual((case['facts']['base']['width'], case['facts']['base']['height']), expected_size)
                    self.assertEqual((case['facts']['base']['depth'], case['facts']['map']['depth']), (8, 8))
                    self.assertEqual(case['artifacts']['sha256'], expected_hash)
                    self.assertEqual(case['geometry'], operation)
                    self.assertFalse(case['facts']['private_tags'])
                    self.assertFalse(any(key.startswith('Apple:') for key in case['facts']['metadata']))
                    self.assertEqual(case['consumer_status'], 'pending manual review')
                    self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_new_apple_scope_rejects_other_geometries_before_native_calls(self):
        import avif
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for operation in ('cover', 'fill', 'crop', 'noop'):
                before = len(avif.COMMANDS)
                with self.subTest(operation=operation), self.assertRaises(ValueError):
                    run(Path(temporary), source_id='gainmap-apple-new', operation=operation,
                        map_policy='midpointoffset', map_gamma=1.5)
                self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_gamma15_islow_is_bounded_to_new_apple_upscale(self):
        import avif
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for source, operation in (('gainmap-android-iso', 'upscale'),
                    ('gainmap-android-xmp', 'upscale'), ('gainmap-apple-old', 'upscale'),
                    ('gainmap-apple-new', 'contain')):
                before = len(avif.COMMANDS)
                with self.subTest(source=source, operation=operation), self.assertRaises(ValueError):
                    run(Path(temporary), source_id=source, operation=operation,
                        map_policy='midpointoffset', map_gamma=1.5, map_method='islow')
                self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_new_apple_islow_map_retains_failure_with_identical_base_and_native_map_input(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary), source_id='gainmap-apple-new', operation='upscale',
                       map_policy='midpointoffset', map_gamma=1.5, map_method='islow')['cases'][0]
            self.assertEqual(case['status'], 'tested and failed')
            self.assertEqual(case['blockers'], ['Failed appearance check'])
            self.assertTrue(all(value for key, value in case['checks'].items() if key != 'appearance'))
            self.assertFalse(case['checks']['appearance'])
            self.assertEqual(case['measurements']['reconstructed_hdr']['failures'], ['highlight.delta_e_p95'])
            self.assertEqual(case['measurements']['independent_hdr']['failures'],
                             ['shadow.delta_e_max', 'highlight.delta_e_p95'])
            self.assertEqual(case['artifacts']['sha256'],
                             '44cde5862e2438eaaad2ab9ed38faa63ba1a35bbbc915bfda96680c01a37488f')
            self.assertEqual(case['native_candidate']['base_sha256'],
                             'd235565259e4348657c42acca6c50d94b9aa16e51c8fcc76b91e5233a6d356ea')
            self.assertEqual(case['native_candidate']['computed_map_sha256'],
                             '96c24593b0a1f81a84dea9a6c488a386fd2ade34e053262cfeb8f6fe8d1dd8c3')
            self.assertEqual(case['native_candidate']['map_encoding']['method'], 'islow')
            self.assertEqual(case['native_candidate']['map_gamma'], 1.5)
            self.assertIn('dct-islow-map', case['case_id'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_float_base_is_bounded_to_new_apple_upscale_with_float_gamma15_map(self):
        import avif
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for changed in ({'source_id': 'gainmap-android-iso'}, {'source_id': 'gainmap-android-xmp'},
                    {'source_id': 'gainmap-apple-old'}, {'operation': 'contain'}, {'operation': 'cover'},
                    {'map_method': 'islow'}, {'map_gamma': 2}, {'map_policy': 'smalloffset'},
                    {'base_method': 'ifast'}):
                arguments = {'source_id': 'gainmap-apple-new', 'operation': 'upscale',
                             'map_policy': 'midpointoffset', 'map_gamma': 1.5,
                             'map_method': 'float', 'base_method': 'float', **changed}
                before = len(avif.COMMANDS)
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    run(Path(temporary), **arguments)
                self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_new_apple_float_base_qualifies_from_identical_native_gamma_input_and_icc(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            case = run(Path(temporary), source_id='gainmap-apple-new', operation='upscale',
                       map_policy='midpointoffset', map_gamma=1.5, base_method='float')['cases'][0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
            encoding = case['native_candidate']['base_encoding']
            self.assertEqual(encoding['dct_encoding']['method'], 'float')
            self.assertEqual(encoding['dct_encoding']['input_sha256'],
                             'b982285d8a105e995636e771dba403f0b247eb559838154c9721766cb131a949')
            self.assertEqual(encoding['icc_sha256'],
                             '2515f8942127a705efdd516a77a8eac81a84a364a195cbe72de0a7184ef420db')
            self.assertEqual(encoding['preparation_islow_base']['sha256'],
                             'd235565259e4348657c42acca6c50d94b9aa16e51c8fcc76b91e5233a6d356ea')
            self.assertNotEqual(case['native_candidate']['base_sha256'], encoding['preparation_islow_base']['sha256'])
            self.assertEqual(case['native_candidate']['base_sha256'],
                             '6fd817503458547b1981284f72db9965a92b5dd7fb8eea0dcdf1ed706a080173')
            self.assertEqual(case['native_candidate']['computed_map_sha256'],
                             '605612c86176c65a7a8b0a0547b37cd8bca6e6e9c56ad5eb7d2a5fd55ec45cfb')
            self.assertEqual(case['artifacts']['sha256'],
                             '1a62ee6cd3a58a12eeb6a149b8b5a0fe9e27b184d6e347f740c7b12ba8691c6d')
            self.assertEqual(case['native_candidate']['map_encoding']['method'], 'float')
            self.assertEqual(case['native_candidate']['map_gamma'], 1.5)
            self.assertIn('base-dct-float', case['case_id'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_new_apple_xmp_headroom_is_authoritative_and_unknown_models_are_rejected(self):
        import avif
        import gainmap
        import gainmap_hdr
        from icc_gainmap import _new_apple_source_model
        source = gainmap.FIXTURES/'gainmap-apple-new.jpg'
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            original = gainmap_hdr.decode_source(source, folder/'original', 'p3')
            stripped = folder/'no-makernotes.jpg'
            stripped.write_bytes(source.read_bytes())
            native(['exiftool', '-overwrite_original', '-MakerNotes=', stripped])
            facts = gainmap.inspect(stripped, folder/'stripped-inspection')
            model = _new_apple_source_model(facts, folder/'stripped-inspection/map.jpg')
            self.assertIsNone(model['exiftool_hdr_headroom'])
            self.assertIsNone(model['exiftool_hdr_gain'])
            self.assertEqual(model['xmp_linear_headroom'], 4.532783)
            self.assertEqual(avif.digest(gainmap_hdr.decode_source(stripped, folder/'stripped', 'p3')),
                             avif.digest(original))
            for label, old, new in (
                    ('unknown-version', b'>131072<', b'>999999<'),
                    ('unknown-model', b'2020:aux:hdrgainmap', b'2020:aux:unknownmap'),
                    ('nonfinite-headroom', b'>4.532783<', b'>nan     <'),
                    ('zero-headroom', b'>4.532783<', b'>0.000000<'),
                    ('missing-headroom', b'HDRGainMapHeadroom', b'UnknownMapHeadroom')):
                with self.subTest(label=label):
                    self.assertEqual(len(old), len(new))
                    self.assertIn(old, source.read_bytes())
                    changed = folder/f'{label}.jpg'
                    changed.write_bytes(source.read_bytes().replace(old, new))
                    before = avif.digest(changed)
                    inspection = folder/f'{label}-inspection'
                    facts = gainmap.inspect(changed, inspection)
                    with self.assertRaisesRegex(ValueError, 'XMP'):
                        _new_apple_source_model(facts, inspection/'map.jpg')
                    if label == 'zero-headroom':
                        with self.assertRaises((RuntimeError, ValueError)):
                            gainmap_hdr.decode_source(changed, folder/label, 'p3')
                        self.assertFalse((folder/label/'source-pq-rec2020.png').exists())
                    self.assertEqual(avif.digest(changed), before)
            unknown = folder/'missing-headroom.jpg'
            native(['exiftool', '-overwrite_original', '-MakerNotes=', unknown])
            before = avif.digest(unknown)
            with self.assertRaises((RuntimeError, ValueError)):
                gainmap_hdr.decode_source(unknown, folder/'unknown-headroom', 'p3')
            self.assertFalse((folder/'unknown-headroom/source-pq-rec2020.png').exists())
            self.assertEqual(avif.digest(unknown), before)

    def test_new_apple_contain_qualifies_and_upscale_retains_appearance_failure(self):
        from icc_gainmap import run
        with tempfile.TemporaryDirectory() as temporary:
            for operation, expected_size in (('contain', (173, 231)), ('upscale', (769, 1025))):
                with self.subTest(operation=operation):
                    case = run(Path(temporary)/operation, source_id='gainmap-apple-new', operation=operation,
                               map_policy='midpointoffset', map_gamma=1.5)['cases'][0]
                    if operation == 'contain':
                        self.assertEqual(case['status'], 'qualified', case['blockers'])
                        self.assertTrue(all(case['checks'].values()))
                        self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
                    else:
                        self.assertEqual(case['status'], 'tested and failed')
                        self.assertEqual(case['blockers'], ['Failed appearance check'])
                        self.assertTrue(all(value for key, value in case['checks'].items() if key != 'appearance'))
                        self.assertFalse(case['checks']['appearance'])
                        self.assertTrue(case['measurements']['reconstructed_hdr']['passed'])
                        self.assertEqual(case['measurements']['independent_hdr']['failures'], ['shadow.delta_e_max'])
                        self.assertGreater(case['measurements']['independent_hdr']['regions']['shadow']['delta_e_itp']['maximum'], 8)
                    self.assertEqual(case['source_precision'], 'pq16')
                    self.assertEqual(case['source_model_evidence']['xmp_version'], 131072)
                    self.assertEqual(case['source_model_evidence']['xmp_linear_headroom'], 4.532783)
                    self.assertIn('XMP', case['source_model_evidence']['headroom_origin'])
                    self.assertAlmostEqual(case['source_model_evidence']['exiftool_hdr_headroom'], 1.518931985)
                    self.assertEqual(case['source_model_evidence']['exiftool_hdr_gain'], 0)
                    self.assertEqual(case['hdr_intent']['facts']['metadata']['PNG-cICP:ColorPrimaries'], 12)
                    self.assertEqual((case['facts']['base']['width'], case['facts']['base']['height']), expected_size)
                    self.assertEqual((case['facts']['base']['depth'], case['facts']['map']['depth']), (8, 8))
                    self.assertEqual(case['artifacts']['sha256'], {
                        'contain': '12cef3e234b7c187d013426697b1624b1b7e79ddd4b6e12224bb72d286875b46',
                        'upscale': 'b2d03efba21ee73c3716447d4dce09bea89d59bfce81408cfcb35cfa9ea19804'}[operation])
                    self.assertEqual(case['geometry'], operation)
                    self.assertFalse(case['facts']['private_tags'])
                    self.assertFalse(any(key.startswith('Apple:') for key in case['facts']['metadata']))
                    self.assertEqual(case['consumer_status'], 'pending manual review')
                    self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')

    def test_xmp_upscale_uses_inspected_pq_source_and_qualifies_both_hdr_readers(self):
        from icc_gainmap import run, _pq_source
        from hdr_png import _png_chunks
        import struct
        import zlib
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            case = run(folder, source_id='gainmap-android-xmp', map_policy='midpointoffset', map_gamma=1.5)['cases'][0]
            self.assertEqual(case['status'], 'qualified', case['blockers'])
            self.assertTrue(all(case['checks'].values()))
            self.assertTrue(all(value['passed'] for value in case['measurements'].values()))
            self.assertEqual(case['source_precision'], 'pq16')
            source = case['source_precision_evidence']
            self.assertEqual((source['gamut'], source['transfer'], source['coded_depth'], source['native_requested_depth']),
                             ('rec2020', 'pq', 16, 12))
            self.assertIn('shares native libavif gain application', source['reference_relationship'])
            self.assertEqual(case['hdr_intent']['facts']['metadata']['PNG-cICP:ColorPrimaries'], 1)
            self.assertEqual(case['facts']['base']['depth'], 8)
            self.assertEqual(case['facts']['map']['depth'], 8)
            self.assertEqual(case['artifacts']['sha256'], 'a3a9191c6e6854b3cf5e982f9364d3448bb548ca7c85a2ba600e2cc411e51e53')
            self.assertIn('source-pq16-map-gamma1.5', case['case_id'])
            self.assertEqual(case['consumer_status'], 'pending manual review')
            self.assertEqual(case['consumer_decoder_diagnostics']['stock_native_srgb']['status'], 'tested and failed')
            pq = Path(source['path'])
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                _pq_source(pq, folder/'wrong-size', [404, 302])
            bad = folder/'wrong-color.png'
            rewritten = bytearray(b'\x89PNG\r\n\x1a\n')
            for kind, payload in _png_chunks(pq.read_bytes()):
                if kind == b'cICP':
                    payload = bytes([2, 16, 0, 1])
                rewritten.extend(struct.pack('>I', len(payload))+kind+payload+struct.pack('>I', zlib.crc32(kind+payload)))
            bad.write_bytes(rewritten)
            with self.assertRaisesRegex(ValueError, 'signaling'):
                _pq_source(bad, folder/'wrong-color', [403, 302])
            bad.write_bytes(pq.read_bytes())
            native(['exiftool', '-overwrite_original', '-Orientation#=6', bad])
            with self.assertRaisesRegex(ValueError, 'orientation'):
                _pq_source(bad, folder/'wrong-orientation', [403, 302])


if __name__ == '__main__':
    unittest.main()
