"""Native gain application can expose float precision before half storage."""
import json
import subprocess
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageCms

from avif import native
from gainmap import array_geometry
from gainmap_hdr import read_linear
from gainmap_iso import decode_iso_source
from gainmap_linear import decode_iso_linear, resample_linear
from appearance import compare_appearance
from lossless_jpeg import encode

ROOT = Path(__file__).parent
HELPER = '/opt/proof/ultrahdr/float32/hdr-proof-uhdr'


class NativeFloat32GainTests(unittest.TestCase):
    def test_iso_native_float32_source_retains_accuracy_before_upscale(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = ROOT/'fixtures/gainmap/gainmap-android-iso.jpg'
            baseline = decode_iso_linear(source, directory/'native', gamut='p3')
            precise = decode_iso_linear(source, directory/'precise', gamut='p3', precision='float32')
            output = Path(precise['path'])
            facts = precise['native_source']['float32_native_facts']
            reference = decode_iso_source((directory/'native/source-base.jpg').read_bytes(),
                                          (directory/'native/source-map.jpg').read_bytes())['linear_rgb_nits']
            actual = np.fromfile(output, dtype='<f4').reshape(3, facts['height'], facts['width'])
            actual = actual[[2, 0, 1]].transpose(1, 2, 0).astype(np.float64)*203
            self.assertEqual(facts['gamut'], 1)
            self.assertEqual(facts['requested_display_boost'], 16)
            self.assertEqual(facts['native_precision'], 'float32 gain application before half-float storage')
            self.assertLess(float(np.abs(actual-reference).max()), .005)
            # Compare two native candidates against the same independent
            # unchanged reference and thresholds, without feeding it back.
            self.assertEqual(precise['precision'], facts['native_precision'])
            self.assertEqual(len(precise['native_source']['float32_helper_sha256']), 64)
            errors = []
            for name, candidate in (('half', baseline), ('float32', precise)):
                result = resample_linear(candidate, directory/f'{name}-upscale.raw', 'upscale')
                measured = compare_appearance(array_geometry(reference, 'upscale'), read_linear(result),
                    reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')
                self.assertTrue(measured['passed'], measured['failures'])
                errors.append(measured['regions']['shadow']['delta_e_itp']['maximum'])
            self.assertLess(errors[1], errors[0]/4)

    def test_native_float32_distinct_channel_gain_and_display_headrooms_match_iso_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            base = np.array([[[0, 1, 255], [64, 127, 192], [255, 64, 32]],
                             [[8, 32, 128], [192, 255, 64], [17, 119, 221]]], dtype=np.uint8)
            gain = np.array([[[255, 32, 0], [64, 128, 192], [0, 255, 127]],
                             [[128, 0, 255], [32, 128, 192], [255, 255, 255]]], dtype=np.uint8)
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            for name, samples in (('base', base), ('map', gain)):
                png = directory/f'{name}.png'
                Image.fromarray(samples).save(png)
                encode(png, directory/f'{name}.jpg', icc_profile=profile if name == 'base' else b'')
            metadata = ROOT/'fixtures/gainmap/gainmap-android-xmp.jpg'
            packed = directory/'source.jpg'
            native([HELPER, 'pack', metadata, directory/'base.jpg', directory/'map.jpg', packed])
            native([HELPER, 'extract', packed, directory/'actual-base.jpg', directory/'actual-map.jpg'])
            for boost in (1, 2, 16):
                with self.subTest(display_boost=boost):
                    output = directory/f'boost{boost}.gbrpf32'
                    facts = json.loads(native([HELPER, 'decode-linear32', packed, output, str(boost)]))
                    reference = decode_iso_source((directory/'actual-base.jpg').read_bytes(),
                        (directory/'actual-map.jpg').read_bytes(), headroom=np.log2(boost))['linear_rgb_nits']
                    actual = np.fromfile(output, dtype='<f4').reshape(3, 2, 3)[[2, 0, 1]].transpose(1, 2, 0)*203
                    np.testing.assert_allclose(actual, reference, atol=.003, rtol=.000003)
                    self.assertEqual(facts['gamut'], 0)
                    self.assertEqual(facts['requested_display_boost'], boost)

    def test_native_float32_requires_equal_map_geometry_and_explicit_valid_headroom(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = ROOT/'fixtures/gainmap/gainmap-android-iso.jpg'
            for boost in ('16', 'nan', '.5', '16x'):
                with self.subTest(boost=boost):
                    result = subprocess.run([HELPER, 'decode-linear32', str(source),
                        str(directory/'rejected.raw'), boost], capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((directory/'rejected.raw').exists())


if __name__ == '__main__':
    unittest.main()
