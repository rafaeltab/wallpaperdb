"""Native direct-float geometry retains source precision before PQ encoding."""
import hashlib
from pathlib import Path
import tempfile
import unittest

import numpy as np

from appearance import compare_appearance
from gainmap import array_geometry
from gainmap_hdr import read_linear
from gainmap_linear import decode_iso_linear, resample_linear
from gainmap_iso import decode_iso_source

ROOT = Path(__file__).parent


def analytic_input(directory, rgb):
    # These are deterministic source fixtures, not reconstructed references
    # supplied to a production encoder or converter.
    path = directory/'source.gbrpf32'
    path.write_bytes(rgb[..., [1, 2, 0]].transpose(2, 0, 1).astype('<f4').tobytes())
    return {'path': str(path), 'width': rgb.shape[1], 'height': rgb.shape[0],
            'gamut': 'p3', 'normalization_nits': 203, 'format': 'gbrpf32le',
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'alpha': False}


class NativeDirectFloatGeometryTests(unittest.TestCase):
    def test_float_precision_hdr_range_and_opaque_alpha_survive_native_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            # The fractional values span a dark level below one 16-bit linear
            # step, ordinary light, and HDR beyond normalized one.
            scene = np.full((19, 23, 3), [0.000000713, 0.1234567, 3.7654321], dtype=np.float32)
            source = analytic_input(directory, scene)
            for operation in ('contain', 'cover', 'upscale', 'orientation'):
                with self.subTest(geometry=operation):
                    result = resample_linear(source, directory/f'{operation}.raw', operation, orientation=6)
                    actual = read_linear(result)
                    reference = array_geometry(scene.astype(np.float64)*203, operation,
                                               6 if operation == 'orientation' else 1)
                    np.testing.assert_allclose(actual, reference, atol=.0005, rtol=.00001)
                    alpha = np.fromfile(result['path'], dtype='<f4').reshape(4, result['height'], result['width'])[3]
                    np.testing.assert_array_equal(alpha, np.ones_like(alpha))
                    self.assertGreater(float(actual[..., 2].min()), 700)
                    self.assertGreater(float(actual[..., 0].min()), 0)
                    lattice = actual/10000*65535
                    self.assertGreater(float(np.max(np.abs(lattice-np.round(lattice)))), .1)

    def test_native_iso_linear_geometry_matches_unchanged_independent_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            original = ROOT/'fixtures/gainmap/gainmap-android-iso.jpg'
            source = decode_iso_linear(original, directory/'source', gamut='p3')
            base, gain = directory/'source/source-base.jpg', directory/'source/source-map.jpg'
            reference = decode_iso_source(base.read_bytes(), gain.read_bytes())['linear_rgb_nits']
            self.assertEqual(source['source_sha256'], hashlib.sha256(original.read_bytes()).hexdigest())
            self.assertEqual(source['sha256'], hashlib.sha256(Path(source['path']).read_bytes()).hexdigest())
            for operation in ('contain', 'cover', 'fill', 'upscale', 'crop', 'orientation'):
                with self.subTest(geometry=operation):
                    orientation = 6 if operation == 'orientation' else 1
                    result = resample_linear(source, directory/f'{operation}.raw', operation, orientation)
                    measured = compare_appearance(array_geometry(reference, operation, orientation),
                        read_linear(result), reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')
                    self.assertTrue(measured['passed'], measured['failures'])

    def test_unproven_alpha_or_modified_float_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = analytic_input(directory, np.zeros((3, 5, 3), dtype=np.float32))
            with self.assertRaisesRegex(ValueError, 'opaque'):
                resample_linear({**source, 'alpha': True}, directory/'alpha.raw', 'contain')
            Path(source['path']).write_bytes(bytes(3*5*3*4))
            # Mutate a genuine finite input sample while retaining the old hash.
            data = bytearray(Path(source['path']).read_bytes())
            data[2] = 1
            Path(source['path']).write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'hash'):
                resample_linear(source, directory/'modified.raw', 'contain')


if __name__ == '__main__':
    unittest.main()
