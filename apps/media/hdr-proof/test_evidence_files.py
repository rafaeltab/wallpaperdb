"""Evidence bookkeeping must retain inspected files and every decoder gate."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import suite
from matrix import build_matrix, required_cases


class EvidenceFileTests(unittest.TestCase):
    def test_manual_copy_finds_output_after_native_command_log(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            output = root/'output.jpg'
            output.write_bytes(b'file-copy-test-only')
            case = {'case_id':'gainmap-apple-new:hdr:jpg:preserve:preserve:contain',
                    'fixture_id':'gainmap-apple-new', 'geometry':'contain',
                    'status':'tested and failed', 'artifacts':[str(root/'commands.json'), str(output)]}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([case], [])
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]['sha256'], suite.avif.digest(output))
            self.assertEqual(files[0]['codec_status'], 'tested and failed')
            self.assertEqual(files[0]['consumer_status'], 'pending manual review')

    def test_additional_source_decoder_failure_cannot_qualify(self):
        planned = next(row for row in required_cases() if row['cell_id']=='gainmap-jpeg:hdr:jpg')
        case = {**planned, 'status':'qualified', 'checks':{
            'native_encoder':True, 'independent_decoder':True, 'structure':True,
            'appearance':True, 'privacy':True, 'independent_source_decoder':False}}
        report = build_matrix([case])
        cell = next(row for row in report['cells'] if row['id']=='gainmap-jpeg:hdr:jpg')
        self.assertEqual(cell['evidence'][0]['status'], 'tested and failed')
        self.assertTrue(report['evidence_errors'])

    def test_manual_png_source_retains_its_actual_container_and_pending_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            source = root/'source.png'
            source.write_bytes(b'file-copy-test-only')
            fixture = {'id': 'png-pq-rec2020-16-opaque', 'path': str(source),
                       'spec': {'depth': 16, 'frames': 1}, 'facts': {'depth': 16}}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([], [fixture])
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]['file'], 'source-png-pq-rec2020-16-opaque.png')
            self.assertEqual(files[0]['sha256'], suite.avif.digest(source))
            self.assertEqual(files[0]['consumer_status'], 'pending manual review')
