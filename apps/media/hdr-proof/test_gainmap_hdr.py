"""Native float geometry must retain HDR light and the declared edge convention."""

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from appearance import compare_appearance
from gainmap import array_geometry, independent_hdr
from gainmap_hdr import decode_source, resample_pq, read_linear
from avif import native, write_png

ROOT = Path(__file__).parent


class NativeGainMapHdrGeometryTests(unittest.TestCase):
    def test_iso_source_native_repack_retains_independently_reconstructed_hdr(self):
        from gainmap import inspect
        from gainmap_iso import decode_iso_source
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = ROOT/'fixtures/gainmap/gainmap-android-iso.jpg'
            inspect(source, directory/'reference')
            reference = decode_iso_source(source.read_bytes(), (directory/'reference/map.jpg').read_bytes())
            pq = decode_source(source, directory/'native', 'p3')
            evidence = json.loads((directory/'native/iso-native-evidence.json').read_text())
            self.assertEqual(evidence['decoded_color_facts']['gamut'], 1)
            self.assertEqual(evidence['decoded_color_facts']['requested_display_boost'], 16)
            tags = json.loads(native(['exiftool', '-j', '-n', pq]))[0]
            self.assertEqual([tags[key] for key in ('ColorPrimaries', 'TransferCharacteristics',
                                                   'MatrixCoefficients', 'VideoFullRangeFlag')],
                             [12, 16, 0, 1])
            self.assertEqual(tags['BitDepth'], 16)
            with Image.open(directory/'reference/map.jpg') as image:
                expected_map = np.asarray(image.convert('RGB').resize((384, 512), Image.Resampling.BILINEAR))
            with Image.open(directory/'native/map-full.png') as image:
                np.testing.assert_array_equal(np.asarray(image), expected_map)
            with Image.open(source) as image, Image.open(directory/'native/base-native.png') as base:
                np.testing.assert_array_equal(np.asarray(base), np.asarray(image.convert('RGB')))
            for operation in ('contain', 'cover', 'fill', 'upscale', 'crop', 'orientation'):
                with self.subTest(geometry=operation):
                    orientation = 6 if operation == 'orientation' else 1
                    result = resample_pq(pq, directory/f'{operation}.gbrapf32', operation,
                                         orientation, gamut='p3')
                    expected = array_geometry(reference['linear_rgb_nits'], operation, orientation)
                    measured = compare_appearance(expected, read_linear(result), reference_gamut='p3',
                                                  actual_gamut=result['gamut'], fixture_class='gainmap-hdr')
                    self.assertTrue(measured['passed'], measured['failures'])

    def test_fractional_hdr_cover_matches_the_existing_reference_without_rounding_crop(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, gamut in (("apple-new", "p3"), ("android-xmp", "srgb")):
                with self.subTest(source=name):
                    case_dir = directory/name
                    (case_dir/'reference').mkdir(parents=True)
                    source = ROOT/'fixtures/gainmap'/f'gainmap-{name}.jpg'
                    reference = independent_hdr(source, case_dir/'reference', gamut)
                    pq = decode_source(source, case_dir/'native', gamut)
                    result = resample_pq(pq, case_dir/'cover.gbrapf32', 'cover')
                    measured = compare_appearance(array_geometry(reference, 'cover'), read_linear(result),
                        reference_gamut='rec2020', actual_gamut='rec2020', fixture_class='gainmap-hdr')
                    self.assertTrue(measured['passed'], measured['failures'])

    def test_real_native_hdr_geometry_matches_unchanged_independent_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, gamut in (("apple-old", "p3"), ("apple-new", "p3"), ("android-xmp", "srgb")):
                with self.subTest(source=name):
                    case_dir = directory / name
                    case_dir.mkdir()
                    source = ROOT / "fixtures/gainmap" / f"gainmap-{name}.jpg"
                    (case_dir / "reference").mkdir()
                    reference = independent_hdr(source, case_dir / "reference", gamut)
                    pq = decode_source(source, case_dir / "native", gamut)
                    for operation in ('contain', 'cover', 'fill', 'upscale', 'crop', 'orientation'):
                        with self.subTest(geometry=operation):
                            orientation = 6 if operation == 'orientation' else 1
                            result = resample_pq(pq, case_dir / f"{operation}.gbrapf32", operation, orientation)
                            actual = read_linear(result)
                            measured = compare_appearance(array_geometry(reference, operation, orientation), actual,
                                                          reference_gamut="rec2020", actual_gamut="rec2020",
                                                          fixture_class="gainmap-hdr")
                            self.assertTrue(measured["passed"], measured["failures"])
                            self.assertGreater(float(actual.max()), 203)
                            # An alpha-drop conversion previously forced 16-bit linear
                            # values, losing dark colors despite a float file suffix.
                            lattice = actual / 10000 * 65535
                            self.assertGreater(float(np.max(np.abs(lattice - np.round(lattice)))), 0.1)

    def test_constants_linear_gradients_and_edge_impulses_match_float_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            scenes = {}
            scenes["constant"] = np.full((19, 23, 3), 0.5)
            ramp = np.linspace(0, 800, 23)[None, :, None]
            scenes["gradient"] = np.broadcast_to(ramp, (19, 23, 3)).copy()
            impulse = np.zeros((19, 23, 3))
            impulse[0, 0] = [800, 200, 100]
            impulse[9, 11] = [50, 400, 1000]
            scenes["impulses"] = impulse
            for name, scene in scenes.items():
                with self.subTest(scene=name):
                    m1, m2, c1, c2, c3 = 2610/16384, 2523/32, 3424/4096, 2413/128, 2392/128
                    value = (scene / 10000) ** m1
                    signal = ((c1 + c2 * value) / (1 + c3 * value)) ** m2
                    source = directory / f"{name}.png"
                    write_png(source, np.concatenate((signal, np.ones((*scene.shape[:2], 1))), axis=-1))
                    # Account only for the explicitly encoded fixture precision.
                    encoded = np.round(signal * 65535) / 65535
                    inverse = encoded ** (1/m2)
                    reference = 10000 * (np.maximum(inverse-c1, 0)/(c2-c3*inverse)) ** (1/m1)
                    result = resample_pq(source, directory / f"{name}.gbrapf32", "contain")
                    actual = read_linear(result)
                    expected = array_geometry(reference, "contain")
                    measured = compare_appearance(expected, actual, reference_gamut="rec2020",
                                                  actual_gamut="rec2020", fixture_class="gainmap-hdr")
                    self.assertTrue(measured["passed"], measured["failures"])


if __name__ == "__main__":
    unittest.main()
