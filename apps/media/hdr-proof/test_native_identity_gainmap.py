"""RGB gain-map code values must avoid an unnecessary YCbCr rounding stage."""

from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image

import test_native_avif_gainmap


class NativeIdentityGainMapTests(unittest.TestCase):
    def test_native_identity_matrix_preserves_rgb_codes_and_is_emitted_for_gain_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            values = np.random.default_rng(263284).integers(0, 256, size=(32, 32, 3), dtype=np.uint8)
            source = directory/'codes.png'
            Image.fromarray(values).save(source)
            for matrix in (2, 0):
                output, png = directory/f'codes-{matrix}.avif', directory/f'codes-{matrix}.png'
                subprocess.run(['avifenc', '-y', '444', '-d', '8', '-q', '100', '-s', '10',
                                '--cicp', f'2/2/{matrix}', str(source), str(output)],
                               check=True, capture_output=True, timeout=30)
                subprocess.run(['avifdec', '-c', 'dav1d', '-d', '8', str(output), str(png)],
                               check=True, capture_output=True, timeout=30)
                with Image.open(png) as image:
                    actual = np.asarray(image.convert('RGB'))
                if matrix == 2:
                    self.assertGreater(np.count_nonzero(actual != values), 0)
                else:
                    np.testing.assert_array_equal(actual, values)

            base, _, _, _ = test_native_avif_gainmap.NativeAvifGainMapTests().fixture(directory)
            output = directory/'identity.avif'
            subprocess.run(['/opt/proof/libavif/identity/avifgainmaputil', 'combine', str(base),
                            str(directory/'hdr.png'), str(output), '--cicp-base', '1/13/0',
                            '--cicp-alternate', '1/16/0', '--ignore-profile', '--downscaling', '1',
                            '--depth-gain-map', '8', '--qgain-map', '100', '--yuv-gain-map', '444',
                            '-y', '444', '-d', '0', '-q', '100', '-s', '10'],
                           check=True, capture_output=True, timeout=30)
            facts = subprocess.run(['avifdec', '--info', '-c', 'dav1d', str(output)],
                                   check=True, capture_output=True, text=True, timeout=30).stdout
            self.assertRegex(facts, r'Gain map\s*:[^\n]+8 bit, YUV444, Full Range, Matrix Coeffs\. 0')


if __name__ == '__main__':
    unittest.main()
