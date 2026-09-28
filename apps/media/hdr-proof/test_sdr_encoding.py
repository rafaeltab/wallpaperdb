"""Native SDR output signaling and independent appearance decoding."""
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from appearance import compare_appearance, sdr_signal_to_nits
from avif import native, write_png

ROOT = Path(__file__).parent


class NativeSdrEncodingTests(unittest.TestCase):
    def test_jpeg_and_webp_have_explicit_srgb_and_preserve_the_mapped_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            ramp = np.linspace(0, 1, 96)
            rgba = np.ones((64, 96, 4))
            rgba[..., :3] = ramp[None, :, None]
            rgba[32:, :32, :3] = [.8, .2, .1]
            rgba[32:, 32:64, :3] = [.1, .7, .2]
            rgba[32:, 64:, :3] = [.2, .1, .8]
            source = folder/'source.png'
            write_png(folder/'untagged.png', rgba)
            native(['ffmpeg','-v','error','-y','-i',folder/'untagged.png',
                    '-color_primaries','1','-color_trc','13','-frames:v','1',source])
            for extension in ('jpg', 'webp'):
                with self.subTest(extension=extension):
                    output = folder/f'output.{extension}'
                    native(['node', ROOT/'encode-sdr.cjs'], data=json.dumps({
                        'input':str(source), 'output':str(output), 'format':extension}).encode())
                    facts = json.loads(native(['exiftool','-j',output]))[0]
                    self.assertIn('srgb', facts['ProfileDescription'].lower())
                    with Image.open(output) as image:
                        actual = np.asarray(image.convert('RGB'))/255
                    measured = compare_appearance(sdr_signal_to_nits(rgba[..., :3]),
                        sdr_signal_to_nits(actual), reference_gamut='srgb', actual_gamut='srgb',
                        fixture_class='sdr-8')
                    self.assertTrue(measured['passed'], measured)
