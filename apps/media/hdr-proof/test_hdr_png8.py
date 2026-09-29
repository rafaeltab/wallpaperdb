"""Eight-bit HDR PNG fixtures require native pixels and measured quantization."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

import numpy as np

import avif
import hdr_png
import hdr_png8


def _pack(chunks):
    result = bytearray(b'\x89PNG\r\n\x1a\n')
    for kind, payload in chunks:
        result.extend(struct.pack('>I', len(payload)) + kind + payload
                      + struct.pack('>I', zlib.crc32(kind + payload)))
    return bytes(result)


class HdrPngEightBitTests(unittest.TestCase):
    def test_all_native_sources_are_deterministic_and_meet_declared_source_gates(self):
        specifications = list(hdr_png8.fixture_specs())
        self.assertEqual(len(specifications), 8)
        lock = json.loads(Path(__file__).with_name('fixtures').joinpath('png8-source-sha256.json').read_text())['sha256']
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for spec in specifications:
                with self.subTest(source=spec['id']):
                    source, fixture = hdr_png8.generate_fixture(spec, root/'first'/spec['id'])
                    repeated, _ = hdr_png8.generate_fixture(spec, root/'repeated'/spec['id'])
                    self.assertEqual(source.read_bytes(), repeated.read_bytes())
                    self.assertEqual(avif.digest(source), lock[spec['id']])
                    facts, pixels = hdr_png8.inspect_and_decode(source)
                    self.assertEqual((facts['width'], facts['height'], facts['depth']), (96, 64, 8))
                    self.assertEqual(facts['color_type'], 6 if spec['alpha'] else 2)
                    self.assertEqual(facts['gamut'], spec['gamut'])
                    self.assertEqual(facts['transfer_name'], spec['transfer'])
                    self.assertEqual(facts['libpng_source_depth'], 8)
                    self.assertEqual(facts['orientation'], 1)
                    self.assertEqual(pixels.shape, (64, 96, 4))
                    self.assertEqual(bool(np.any((pixels[..., 3] > 0) & (pixels[..., 3] < 1))), spec['alpha'])
                    self.assertEqual(fixture['source_appearance']['fixture_class'], 'avif-8')
                    self.assertTrue(fixture['source_valid'], fixture)
                    self.assertTrue(all(fixture['source_checks'].values()), fixture['source_checks'])
                    self.assertEqual(fixture['quantization']['mismatched_coded_samples'], 0)
                    self.assertLessEqual(fixture['quantization']['maximum_signal_error'], .5 / 255 + 1e-12)
                    self.assertLessEqual(fixture['quantization']['maximum_alpha_error'], .5 / 255 + 1e-12)
                    self.assertEqual(fixture['threshold_scope']['profile'], 'avif-8')
                    self.assertFalse(fixture['conversion_qualification'])
                    self.assertEqual(fixture['consumer_status'], 'pending manual review')
                    for tag in ('GPSLatitude', 'GPSLongitude', 'Model', 'SerialNumber'):
                        self.assertIn(tag, facts['exiftool'])

    def test_existing_sixteen_bit_fixtures_and_recognized_subset_stay_unchanged(self):
        lock = json.loads(Path(__file__).with_name('fixtures').joinpath('generated-sha256.json').read_text())['sha256']
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source8, _ = hdr_png8.generate_fixture(next(hdr_png8.fixture_specs()), root/'eight-bit')
            with self.assertRaisesRegex(ValueError, 'recognized HDR signaling'):
                hdr_png.inspect_source(source8)
            for spec in hdr_png.fixture_specs():
                with self.subTest(source=spec['id']):
                    source16, facts, _ = hdr_png.generate_fixture(spec, root/spec['id'])
                    self.assertEqual(avif.digest(source16), lock[spec['id']])
                    self.assertEqual(facts['depth'], 16)
                    with self.assertRaisesRegex(ValueError, 'recognized eight-bit HDR PNG'):
                        hdr_png8.inspect_and_decode(source16)

    def test_source_facts_are_not_inferred_from_fixture_names_or_expected_gamut(self):
        spec = next(hdr_png8.fixture_specs())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, _ = hdr_png8.generate_fixture(spec, root)
            chunks = hdr_png._png_chunks(source.read_bytes())
            changed = [(kind, bytes((9, payload[1], 0, 1)) if kind == b'cICP' else payload)
                       for kind, payload in chunks]
            source.write_bytes(_pack(changed))
            fixture = hdr_png8.qualify_fixture(source, spec)
        self.assertEqual(fixture['facts']['gamut'], 'rec2020')
        self.assertFalse(fixture['source_checks']['color_signaling'])
        self.assertFalse(fixture['source_valid'])

    def test_unknown_ambiguous_and_nonstatic_signaling_is_rejected_before_pixel_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, _ = hdr_png8.generate_fixture(next(hdr_png8.fixture_specs()), root)
            chunks = hdr_png._png_chunks(source.read_bytes())
            cicp = next(payload for kind, payload in chunks if kind == b'cICP')
            variants = {
                'missing-cicp': [(kind, payload) for kind, payload in chunks if kind != b'cICP'],
                'unknown-transfer': [(kind, bytes((cicp[0], 2, 0, 1)) if kind == b'cICP' else payload)
                                     for kind, payload in chunks],
                'duplicate-cicp': chunks[:1] + [(b'cICP', cicp)] + chunks[1:],
                'conflicting-srgb': chunks[:1] + [(b'sRGB', b'\0')] + chunks[1:],
                'animated': chunks[:1] + [(b'acTL', struct.pack('>II', 2, 3))] + chunks[1:],
                'indexed-transparency': chunks[:1] + [(b'tRNS', bytes(6))] + chunks[1:],
            }
            for variant, modified in variants.items():
                with self.subTest(variant=variant):
                    path = root/f'{variant}.png'
                    path.write_bytes(_pack(modified))
                    start = len(avif.COMMANDS)
                    with self.assertRaisesRegex(ValueError, 'recognized eight-bit HDR PNG'):
                        hdr_png8.inspect_and_decode(path)
                    self.assertFalse(any(command['argv'][0] == 'hdr-proof-png-decode'
                                         for command in avif.COMMANDS[start:]))


if __name__ == '__main__':
    unittest.main()
