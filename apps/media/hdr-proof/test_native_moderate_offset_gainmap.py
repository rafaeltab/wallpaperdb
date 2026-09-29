"""Bound the map interval without losing black or authored SDR samples."""

from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance
from avif import write_png
from combined_gainmap_proof import run
from gainmap_iso import decode_iso_source
from lossless_jpeg import encode as encode_lossless
from test_native_gainmap import native


class NativeModerateOffsetGainMapTests(unittest.TestCase):
    def test_near_black_and_highlight_intents_pass_unchanged_gates(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            base = directory/'base.jpg'
            Image.new('RGB', (64, 64), (40, 40, 40)).save(
                base, quality=100, subsampling=0, keep_rgb=True, icc_profile=profile)
            levels = np.repeat([0, .001, .01, .1, .3, 1, 2, 500], 8)
            expected = np.broadcast_to(levels[None, :, None], (64, 64, 3))
            value = (expected/10000)**(2610/16384)
            signal = ((3424/4096+2413/128*value)/(1+2392/128*value))**(2523/32)
            hdr = directory/'hdr.png'
            write_png(hdr, np.concatenate((signal, np.ones((64, 64, 1))), axis=-1))
            avif, png, gain, output, raw = (directory/f'moderateoffset.{suffix}'
                for suffix in ('avif', 'png', 'map.jpg', 'jpg', 'gbrpf32'))
            subprocess.run(['/opt/proof/libavif/moderateoffset/avifgainmaputil', 'combine', str(base),
                            str(hdr), str(avif), '--cicp-base', '1/13/0', '--cicp-alternate', '1/16/0',
                            '--ignore-profile', '--downscaling', '1', '--depth-gain-map', '8',
                            '--qgain-map', '100', '--yuv-gain-map', '444', '-y', '444', '-d', '0',
                            '-q', '100', '-s', '10'], check=True, capture_output=True, timeout=30)
            subprocess.run(['avifgainmaputil', 'extractgainmap', str(avif), str(png)],
                           check=True, capture_output=True, timeout=30)
            encode_lossless(png, gain)
            packed = native('precise', 'pack-avif', avif, base, gain, output)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            decoded = native('precise', 'decode-linear', output, raw)
            self.assertEqual(decoded.returncode, 0, decoded.stderr)
            actual = np.fromfile(raw, dtype='<f4').reshape(3, 64, 64)[[2, 0, 1]].transpose(1, 2, 0)*203
            measured = compare_appearance(expected, actual, reference_gamut='srgb',
                                          actual_gamut='srgb', fixture_class='gainmap-hdr')
            self.assertTrue(measured['passed'], measured['failures'])
            base_part, map_part = directory/'base-part.jpg', directory/'map-part.jpg'
            extracted = native('precise', 'extract', output, base_part, map_part)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)
            independent = decode_iso_source(output.read_bytes(), map_part.read_bytes())
            checked = compare_appearance(expected, independent['linear_rgb_nits'], reference_gamut='srgb',
                                         actual_gamut=independent['gamut'], fixture_class='gainmap-hdr')
            self.assertTrue(checked['passed'], checked['failures'])
            for channel in independent['evidence']['iso_metadata']['channels']:
                self.assertEqual(channel['base_offset'], 1/4096)
                self.assertEqual(channel['alternate_offset'], 1/4096)
            with Image.open(output) as image:
                np.testing.assert_array_equal(np.asarray(image), np.full((64, 64, 3), 40))

    def test_apple_upscale_has_a_separate_qualified_representation(self):
        with tempfile.TemporaryDirectory() as temporary:
            cases = run(Path(temporary), names=('gainmap-apple-old', 'gainmap-apple-new'),
                        geometries=('upscale',), policies=('moderateoffset',))
            for case in cases:
                with self.subTest(source=case['fixture_id']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertIn('native-combine-moderateoffset-lossless-rgb', case['case_id'])
                    self.assertTrue(all(case['checks'].values()), case['checks'])


if __name__ == '__main__':
    unittest.main()
