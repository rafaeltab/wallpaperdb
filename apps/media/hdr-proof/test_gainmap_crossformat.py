"""Cross-format HDR evidence must decode the emitted native bytes independently."""
from pathlib import Path
import json
import tempfile
import unittest

from PIL import ImageCms

import avif

from combined_gainmap_proof import run as run_combined
from gainmap_crossformat import run, single_layer_avif_checks


class GainMapCrossformatTests(unittest.TestCase):
    def test_auxiliary_map_icc_and_disagreeing_matrix_cannot_qualify_single_layer_hdr(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent = run_combined(root/'combined', names=('gainmap-android-iso',),
                                  geometries=('contain',), policies=('moderateoffset',))[0]
            encoded = parent['native_candidate']
            gainmapped = avif.inspect_avif(Path(encoded['parts_directory'])/'combined.avif')
            self.assertFalse(single_layer_avif_checks(gainmapped)['gain_map_absent'])
            profile = root/'conflicting.icc'
            profile.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
            output = root/'conflicting.avif'
            avif.native(['avifenc', '-j', '1', '-s', '8', '-q', '100', '-y', '444', '-d', '12',
                '--cicp', '12/16/0', '--icc', profile, encoded['hdr_intent_pq_png'], output])
            facts = avif.inspect_avif(output)
            self.assertFalse(single_layer_avif_checks(facts)['icc_absent'])
            facts['exiftool']['MatrixCoefficients'] = 6
            self.assertFalse(single_layer_avif_checks(facts)['independent_matrix'])

    def test_native_pq_outputs_preserve_iso_source_hdr_and_exact_selectors(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            combined = run_combined(root/'combined', names=('gainmap-android-iso',),
                                    geometries=('contain', 'orientation'), policies=('moderateoffset',))
            cases = run(root/'crossformat', combined)
            json.dumps(cases, allow_nan=False)
            self.assertEqual(len(cases), 4)
            for case in cases:
                with self.subTest(case=case['case_id']):
                    self.assertEqual(case['status'], 'qualified', case['blockers'])
                    self.assertTrue(all(case['checks'].values()))
                    self.assertEqual(case['selectors']['depth'], '16' if case['selectors']['format'] == 'png' else '12')
                    self.assertEqual(case['selectors']['range'], 'hdr')
                    self.assertEqual(case['selectors']['gamut'], 'preserve')
                    self.assertEqual(case['consumer_status'], 'pending manual review')
                    self.assertEqual(case['source_depths'], {'base': 8, 'map': 8})
                    self.assertTrue(case['measurements']['reconstructed_hdr']['passed'])
                    if case['geometry'] == 'orientation':
                        self.assertEqual(case['orientation_source']['orientation'], 6)

    def test_changed_native_intent_cannot_supply_encoder_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            combined = run_combined(root/'combined', names=('gainmap-android-xmp',),
                                    geometries=('contain',), policies=('moderateoffset',))
            Path(combined[0]['hdr_intent']['path']).write_bytes(b'changed-after-native-encoding')
            cases = run(root/'crossformat', combined)
            self.assertEqual(len(cases), 2)
            for case in cases:
                self.assertEqual(case['status'], 'tested and failed')
                self.assertFalse(case['checks']['native_encoder'])
                self.assertTrue(any('hash' in blocker for blocker in case['blockers']))


if __name__ == '__main__':
    unittest.main()
