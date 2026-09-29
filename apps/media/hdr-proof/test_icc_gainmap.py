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

    def _headroom_control(self, map_policy):
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
            evidence = pack(base, hdr, output, map_policy=map_policy)
            facts = gainmap.inspect(output, folder/'inspection')
            self.assertEqual((facts['base']['sof'], facts['map']['sof']), (0, 0))
            self.assertEqual((evidence['coded_base_depth'], evidence['coded_map_depth']), (8, 8))
            with Image.open(output) as decoded:
                self.assertEqual(decoded.info['icc_profile'], profile)
            probe = json.loads(native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
            self.assertTrue(all(check_metadata(facts, probe)['checks'].values()))
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
                    pack(base, wrong, folder/f'{label}.jpg', map_policy=map_policy)
                self.assertFalse((folder/f'{label}.jpg').exists())
            # Without HDR output qualification, an unknown ICC must still
            # stop the native HDR decoder before applying gain.
            native(['exiftool', '-overwrite_original', '-ICC_Profile=', output])
            with self.assertRaisesRegex(RuntimeError, 'ICC'):
                native_decode(output, folder/'unknown.rgbf32')

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


if __name__ == '__main__':
    unittest.main()
