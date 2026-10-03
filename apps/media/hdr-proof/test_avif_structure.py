"""Single-layer AVIF proof requires independent structure and every decoded frame."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import ImageCms

import avif


class AvifStructureTests(unittest.TestCase):
    def encode(self, directory, *, count=1, profile=None, matrix=0, full_range=True):
        paths = []
        for index in range(count):
            samples = np.full((8, 12, 4), .25 + index / 8)
            samples[..., 3] = np.linspace(0, 1, 12)[None, :]
            path = directory/f'input-{index}.png'
            avif.write_png(path, samples)
            paths.append(path)
        output = directory/'output.avif'
        if profile is None and matrix == 0 and full_range:
            avif.encode_avif(paths, output, 'pq', 'rec2020', 10)
        else:
            command = ['avifenc', '-j', '1', '-s', '8', '-q', '100', '--qalpha', '100',
                       '-y', '444', '-d', '10', '--cicp', f'9/16/{matrix}',
                       '--range', 'full' if full_range else 'limited']
            if profile:
                command += ['--icc', profile]
            avif.native(command + [paths[0], output])
        facts = avif.inspect_avif(output)
        frames = avif.decode_avif(output, directory, count)
        return facts, frames

    def checks(self, facts, frames, reference, *, count=1, transfer='pq', gamut='rec2020', depth=10):
        return avif.structure_checks(facts, frames, {'alpha': True, 'frames': count},
                                     reference, transfer, gamut, depth, count)

    def test_native_icc_and_auxiliary_gain_map_cannot_qualify_single_layer_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            facts, frames = self.encode(directory)
            self.assertTrue(all(self.checks(facts, frames, frames).values()))
            profile = directory/'conflicting.icc'
            profile.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
            facts, frames = self.encode(directory, profile=profile)
            self.assertFalse(self.checks(facts, frames, frames)['icc_absent'])
            gainmapped = directory/'gain-map.avif'
            source = Path(__file__).parent/'fixtures/gainmap/gainmap-android-xmp.jpg'
            avif.native(['avifgainmaputil', 'convert', source, gainmapped, '--cicp', '1/13/0',
                         '--ignore-profile', '-d', '8', '-y', '444', '-q', '100',
                         '--qgain-map', '100', '-s', '10'])
            facts = avif.inspect_avif(gainmapped)
            frames = avif.decode_avif(gainmapped, directory, 1)
            self.assertFalse(self.checks(facts, frames, frames, transfer='srgb', gamut='srgb',
                                         depth=8)['gain_map_absent'])

    def test_native_nonidentity_matrix_and_limited_range_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for full_range in (True, False):
                with self.subTest(full_range=full_range):
                    facts, frames = self.encode(directory, matrix=9, full_range=full_range)
                    self.assertEqual(facts['exiftool']['MatrixCoefficients'], 9)
                    self.assertEqual(facts['exiftool']['VideoFullRangeFlag'], int(full_range))
                    self.assertFalse(self.checks(facts, frames, frames)['matrix_full_range'])

    def test_independent_matrix_and_range_facts_must_be_present_and_agree(self):
        with tempfile.TemporaryDirectory() as temporary:
            facts, frames = self.encode(Path(temporary))
            for field, conflicting in (('MatrixCoefficients', 6), ('VideoFullRangeFlag', 0)):
                for value in (None, conflicting):
                    with self.subTest(field=field, observed=value):
                        changed = deepcopy(facts)
                        if value is None:
                            changed['exiftool'].pop(field)
                        else:
                            changed['exiftool'][field] = value
                        # Tamper with an inspector result, never with an
                        # encoder. Its disagreement cannot authorize a file.
                        self.assertFalse(self.checks(changed, frames, frames)['matrix_full_range'])

    def test_native_sequence_requires_every_decoded_and_reference_frame(self):
        with tempfile.TemporaryDirectory() as temporary:
            facts, frames = self.encode(Path(temporary), count=2)
            self.assertTrue(all(self.checks(facts, frames, frames, count=2).values()))
            for actual, reference in ((frames[:1], frames), (frames, frames[:1]), ([], frames),
                                      (frames, []), (frames + frames[:1], frames)):
                with self.subTest(decoded=len(actual), references=len(reference)):
                    checks = self.checks(facts, actual, reference, count=2)
                    self.assertFalse(checks['frames'])
                    self.assertFalse(checks['dimensions'])
                    self.assertFalse(checks['alpha'])
            mismatched = [frames[0][:-1], frames[1]]
            checks = self.checks(facts, mismatched, frames, count=2)
            self.assertFalse(checks['dimensions'])
            self.assertFalse(checks['alpha'])


if __name__ == '__main__':
    unittest.main()
