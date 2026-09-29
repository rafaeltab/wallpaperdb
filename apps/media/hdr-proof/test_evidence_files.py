"""Evidence bookkeeping must retain inspected files and every decoder gate."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import suite
from matrix import build_matrix, required_cases


class EvidenceFileTests(unittest.TestCase):
    def test_manual_bundle_covers_every_png8_source_containment_and_orientation_representation(self):
        from hdr_png8 import fixture_specs
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            fixtures, cases = [], []
            for spec in fixture_specs():
                source = root/f'{spec["id"]}.png'
                source.write_bytes(b'file-copy-test-only')
                fixtures.append({'id': spec['id'], 'path': str(source), 'spec': spec, 'facts': spec})
                for dynamic_range in ('hdr', 'sdr'):
                    for extension in ('png', 'avif'):
                        for candidate in ('direct', 'normalized-source16'):
                            for geometry in ('contain', 'orientation'):
                                cases.append({'case_id': f'{spec["id"]}:{dynamic_range}:{extension}:{geometry}:{candidate}',
                                    'fixture_id': spec['id'], 'geometry': geometry, 'status': 'tested and failed',
                                    'artifacts': {'output': str(source)}})
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, fixtures)
            self.assertEqual(len(files), 136)
            self.assertEqual({entry['case_id'] for entry in files if entry['case_id']},
                             {case['case_id'] for case in cases})
            self.assertTrue(all(entry['consumer_status'] == 'pending manual review' for entry in files))

    def test_manual_bundle_rejects_bytes_changed_after_fixture_or_output_inspection(self):
        for role in ('fixture', 'output', 'reference'):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root/'results').mkdir()
                source = root/'inspected.png'
                source.write_bytes(b'file-copy-test-only')
                inspected_hash = suite.avif.digest(source)
                fixture = {'id': 'avif-pq-p3-8-opaque', 'path': str(source),
                    'spec': {'depth': 8, 'frames': 1}, 'facts': {}, 'sha256': inspected_hash}
                case = {'case_id': 'avif-pq-p3-8-opaque:contain:copy-test',
                    'fixture_id': fixture['id'], 'geometry': 'contain', 'status': 'qualified'}
                if role == 'output':
                    case['artifacts'] = {'output': str(source), 'sha256': inspected_hash}
                if role == 'reference':
                    case['reference_sdr'] = {'path': str(source), 'sha256': inspected_hash}
                source.write_bytes(b'changed-after-inspection')
                with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                    with self.assertRaisesRegex(ValueError, 'changed after inspection'):
                        suite.candidate_files([] if role == 'fixture' else [case],
                                              [fixture] if role == 'fixture' else [])

    def test_manual_bundle_covers_every_static_avif_transfer_gamut_depth_and_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            fixtures, cases = [], []
            for spec in suite.avif.fixture_specs():
                if spec['frames'] != 1:
                    continue
                source = root/f'{spec["id"]}.avif'
                source.write_bytes(b'file-copy-test-only')
                fixtures.append({'id': spec['id'], 'path': str(source), 'spec': spec, 'facts': spec})
                cases.append({'case_id': spec['id']+':hdr:avif:contain:copy-test',
                    'fixture_id': spec['id'], 'geometry': 'contain', 'status': 'tested and failed',
                    'artifacts': {'output': str(source)}})
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, fixtures)
            self.assertEqual(len(files), 48)
            self.assertEqual({entry['case_id'] for entry in files if entry['case_id']},
                             {case['case_id'] for case in cases})
            self.assertTrue(all(entry['consumer_status'] == 'pending manual review' for entry in files))

    def test_manual_hdr_intent_keeps_inspection_and_distinguishes_native_comparison(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            intent = root/'intent.png'
            intent.write_bytes(b'file-copy-test-only')
            facts = {'depth': 16, 'width': 192, 'height': 256, 'cicp': [12, 16, 0, 1]}
            case = {'case_id': 'gainmap-android-iso:hdr:jpg:contain:copy-test',
                'fixture_id': 'gainmap-android-iso', 'geometry': 'contain', 'status': 'qualified',
                'native_candidate': {'coding_scope': 'JPEG SOF3'},
                'hdr_intent': {'path': str(intent), 'sha256': suite.avif.digest(intent), 'facts': facts}}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([case], [])
            self.assertEqual(len(files), 1)
            entry = files[0]
            self.assertEqual(entry['sha256'], suite.avif.digest(intent))
            self.assertEqual(entry['facts'], facts)
            self.assertEqual(entry['case_id'], case['case_id'])
            self.assertEqual(entry['consumer_status'], 'pending manual review')
            self.assertEqual(entry['codec_status'], 'inspected native HDR intent; not a conversion qualification')
            self.assertNotIn('SOF3', entry['coding_scope'])
            self.assertNotIn('Independent', entry['role'])
            intent.write_bytes(b'changed-after-inspection')
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'changed after inspection'):
                    suite.candidate_files([case], [])

    def test_manual_bundle_includes_old_apple_and_iso_candidates_with_coding_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            cases = []
            for name in ('gainmap-apple-old', 'gainmap-android-iso'):
                output = root/f'{name}.jpg'
                output.write_bytes(b'file-copy-test-only')
                cases.append({'case_id': name+':hdr:jpg:contain:copy-test', 'fixture_id': name,
                    'geometry': 'contain', 'status': 'tested and failed', 'artifacts': {'output': str(output)},
                    'native_candidate': {'coding_scope': 'JPEG SOF3; physical consumer qualification pending'}})
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, [])
            self.assertEqual(len(files), 2)
            for entry in files:
                self.assertIn('SOF3', entry['coding_scope'])
                self.assertEqual(entry['codec_status'], 'tested and failed')
                self.assertEqual(entry['consumer_status'], 'pending manual review')

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
