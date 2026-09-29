"""Cross-format HDR evidence must decode the emitted native bytes independently."""
from pathlib import Path
import json
import tempfile
import unittest

from combined_gainmap_proof import run as run_combined
from gainmap_crossformat import run


class GainMapCrossformatTests(unittest.TestCase):
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
