"""Evidence bookkeeping must retain inspected files and every decoder gate."""
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

import suite
from matrix import build_matrix, required_cases


class EvidenceFileTests(unittest.TestCase):
    def test_manual_bundle_keeps_identity_conversion_and_each_rendering_scope(self):
        # Bookkeeping only; these bytes cannot qualify a conversion.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            output, reference = root/'identity.jpg', root/'reference.png'
            output.write_bytes(b'output-copy-test-only')
            reference.write_bytes(b'reference-copy-test-only')
            cases = [{'case_id': f'identity-{label}', 'fixture_id': 'avif-gainmap-from-android-xmp',
                      'geometry': 'identity', 'proof_module': 'gainmap_avif_identity_jpeg',
                      'status': 'qualified', 'qualification_scope': f'No resize, rendering {label}',
                      'rendering_scope': {'label': label, 'headroom_is_product_selector': False},
                      'known_consumer_limitations': ['Physical review pending'],
                      'consumer_decoder_diagnostics': {'stock': {'status': 'tested and failed'}},
                      'artifacts': {'output': str(output), 'sha256': suite.avif.digest(output)},
                      'reference_sdr': {'path': str(reference), 'sha256': suite.avif.digest(reference)}}
                     for label in ('boost2', 'source-full', 'boost16')]
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, [])
            self.assertEqual(len(files), 6)
            for case in cases:
                candidate = next(entry for entry in files if entry['case_id'] == case['case_id'])
                self.assertEqual(candidate['qualification_scope'], case['qualification_scope'])
                self.assertEqual(candidate['rendering_scope'], case['rendering_scope'])
                self.assertEqual(candidate['known_consumer_limitations'], case['known_consumer_limitations'])
                self.assertEqual(candidate['consumer_decoder_diagnostics'], case['consumer_decoder_diagnostics'])
                self.assertEqual(candidate['sha256'], suite.avif.digest(output))
                self.assertEqual(candidate['consumer_status'], 'pending manual review')

    def test_manual_bundle_keeps_each_iso_geometry_rendering_scope(self):
        # Bookkeeping only; these bytes cannot qualify a conversion.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            output = root/'same-file.jpg'
            output.write_bytes(b'file-copy-test-only')
            cases = [{'case_id': f'iso-{geometry}-boost{boost}', 'fixture_id': 'gainmap-android-iso',
                      'geometry': geometry, 'proof_module': 'iso_geometry_headroom',
                      'status': 'qualified' if boost == 16 else 'tested and failed',
                      'qualification_scope': f'One actual file at boost {boost}',
                      'artifacts': {'output': str(output), 'sha256': suite.avif.digest(output)}}
                     for geometry in ('contain', 'cover', 'fill', 'orientation') for boost in (2, 16, 64)]
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, [])
            self.assertEqual(len(files), 12)
            for case, entry in zip(cases, files):
                self.assertEqual(entry['case_id'], case['case_id'])
                self.assertEqual(entry['qualification_scope'], case['qualification_scope'])
                self.assertEqual(entry['codec_status'], case['status'])
                self.assertEqual(entry['sha256'], suite.avif.digest(output))
                self.assertEqual(entry['consumer_status'], 'pending manual review')

    def test_reconstruction_profiles_extend_only_the_exact_source_record(self):
        fixture = {'id': 'source', 'sha256': 'a'*64, 'facts': {'hdr_reconstruction': 'untested'}}
        profiles = [{'candidate': 'original', 'status': 'tested and failed'},
                    {'candidate': 'separate-native', 'status': 'qualified'}]
        reconstructed = {**fixture, 'source_reconstruction_profiles': profiles}
        enriched = suite.merge_reconstruction_profiles([fixture], [reconstructed])
        self.assertEqual(len(enriched), 1)
        self.assertEqual(enriched[0]['source_reconstruction_profiles'], profiles)
        self.assertEqual(enriched[0]['facts'], fixture['facts'])
        self.assertNotIn('source_reconstruction_profiles', fixture)
        self.assertIn('named reconstruction profiles', enriched[0]['valid_scope'])

    def test_reconstruction_profiles_reject_unknown_or_different_source_bytes(self):
        fixture = {'id': 'source', 'sha256': 'a'*64}
        for changed in ({'id': 'unknown', 'sha256': 'a'*64}, {'id': 'source', 'sha256': 'b'*64},
                        {'id': 'source', 'sha256': None}):
            with self.subTest(source=changed):
                with self.assertRaisesRegex(ValueError, 'source identity'):
                    suite.merge_reconstruction_profiles([fixture], [{**changed, 'source_reconstruction_profiles': []}])
        reconstructed = {**fixture, 'source_reconstruction_profiles': []}
        for fixtures, records in (([fixture, fixture], [reconstructed]),
                                  ([fixture], [reconstructed, reconstructed])):
            with self.assertRaisesRegex(ValueError, 'source identity'):
                suite.merge_reconstruction_profiles(fixtures, records)

    def test_manual_bundle_keeps_all_gainmap_avif_geometry_pairs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            output, reference = root/'candidate.avif', root/'reference.png'
            output.write_bytes(b'output-copy-test-only')
            reference.write_bytes(b'reference-copy-test-only')
            cases = [{'case_id': f'avif-gainmap-from-android-xmp:sdr:avif:{geometry}',
                'fixture_id': 'avif-gainmap-from-android-xmp', 'geometry': geometry,
                'status': 'qualified',
                'artifacts': {'output': str(output), 'sha256': suite.avif.digest(output)},
                'reference_sdr': {'path': str(reference), 'sha256': suite.avif.digest(reference)}}
                for geometry in ('contain', 'cover', 'fill', 'upscale')]
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, [])
            self.assertEqual(len(files), 8)
            self.assertEqual(len({entry['file'] for entry in files}), 8)
            for case in cases:
                pair = [entry for entry in files if entry['case_id'] == case['case_id']
                        or (entry.get('facts') or {}).get('case_id') == case['case_id']]
                self.assertEqual({entry['sha256'] for entry in pair},
                                 {suite.avif.digest(output), suite.avif.digest(reference)})
            self.assertTrue(all(entry['consumer_status'] == 'pending manual review' for entry in files))

    def test_manual_bundle_includes_verified_gainmap_avif_without_a_synthetic_scene_spec(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            source = root/'native-gainmap.avif'
            source.write_bytes(b'file-copy-test-only')
            fixture = {'id': 'avif-gainmap-from-android-xmp', 'path': str(source),
                'sha256': suite.avif.digest(source), 'facts': {'hdr_reconstruction': 'untested'}}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([], [fixture])
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]['facts']['hdr_reconstruction'], 'untested')
            self.assertEqual(files[0]['sha256'], fixture['sha256'])
            self.assertNotIn('synthetic', files[0]['role'])
            self.assertEqual(files[0]['consumer_status'], 'pending manual review')

    def test_manual_selector_sources_preserve_native_inspection_and_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            fixtures = []
            for dynamic_range in ('sdr', 'hdr'):
                source = root/f'{dynamic_range}.avif'
                source.write_bytes(b'file-copy-test-only-'+dynamic_range.encode())
                fixtures.append({'id': 'selector-'+dynamic_range, 'path': str(source),
                    'sha256': suite.avif.digest(source), 'generator': 'selector_probes.alpha_scene',
                    'native_facts': {'depth': 12, 'transfer': 16 if dynamic_range == 'hdr' else 13}})
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([], fixtures)
                self.assertEqual(len(files), 2)
                for entry, fixture in zip(files, fixtures):
                    self.assertEqual(entry['facts'], fixture['native_facts'])
                    self.assertEqual(entry['sha256'], fixture['sha256'])
                    self.assertEqual(entry['consumer_status'], 'pending manual review')
                Path(fixtures[0]['path']).write_bytes(b'changed-after-inspection')
                with self.assertRaisesRegex(ValueError, 'changed after inspection'):
                    suite.candidate_files([], fixtures)

    def test_manual_source_without_inspection_facts_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            source = root/'source.avif'
            source.write_bytes(b'file-copy-test-only')
            fixture = {'id': 'uninspected', 'path': str(source), 'sha256': suite.avif.digest(source)}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'Missing source inspection facts'):
                    suite.candidate_files([], [fixture])

    def test_manual_bundle_includes_complete_mozjpeg_hdr_crop(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            source = root/'native.jpg'
            source.write_bytes(b'file-copy-test-only')
            case = {'case_id': 'gainmap-android-iso:hdr:jpg:cover:mozjpeg',
                'fixture_id': 'gainmap-android-iso', 'geometry': 'cover', 'status': 'qualified',
                'candidate': 'native-combine-moderateoffset-mozjpeg-base-dct-float-map',
                'artifacts': {'output': str(source), 'sha256': suite.avif.digest(source)}}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([case], [])
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]['case_id'], case['case_id'])
            self.assertEqual(files[0]['consumer_status'], 'pending manual review')

    def test_manual_bundle_labels_icc_hdr_failures_as_diagnostic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            source = root/'failed.jpg'
            source.write_bytes(b'file-copy-test-only')
            cases = [{'case_id': 'iso-upscale-icc-'+policy,
                'fixture_id': 'gainmap-android-iso', 'geometry': 'upscale', 'status': 'tested and failed',
                'candidate': 'native-combine-icc-gamma32-'+policy,
                'artifacts': {'output': str(source), 'sha256': suite.avif.digest(source)}}
                for policy in ('moderateoffset', 'smalloffset')]
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files(cases, [])
            self.assertEqual(len(files), 2)
            for entry in files:
                self.assertEqual(entry['codec_status'], 'tested and failed')
                self.assertIn('not an approved download', entry['warning'])
                self.assertEqual(entry['consumer_status'], 'pending manual review')

    def test_manual_bundle_keeps_qualified_icc_reader_scope_and_stock_failure(self):
        # Bookkeeping only: these bytes never exercise or qualify an encoder.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            source = root/'scoped.jpg'
            source.write_bytes(b'file-copy-test-only')
            case = {'case_id': 'iso-upscale-icc-gamma15',
                'fixture_id': 'gainmap-android-iso', 'geometry': 'upscale', 'status': 'qualified',
                'candidate': 'native-combine-icc-gamma32-midpointoffset',
                'qualification_scope': 'Experimental native ICC-aware file path only',
                'known_consumer_limitations': ['Stock reader assumes sRGB base transfer'],
                'consumer_decoder_diagnostics': {'stock_native_srgb': {'status': 'tested and failed'}},
                'artifacts': {'output': str(source), 'sha256': suite.avif.digest(source)}}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([case], [])
            self.assertEqual(len(files), 1)
            for field in ('qualification_scope', 'known_consumer_limitations', 'consumer_decoder_diagnostics'):
                self.assertEqual(files[0][field], case[field])
            self.assertEqual(files[0]['codec_status'], 'qualified')
            self.assertEqual(files[0]['consumer_status'], 'pending manual review')

    def test_manual_bundle_rejects_missing_inspected_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            case = {'case_id': 'avif-pq-p3-8-opaque:contain:missing-output',
                'fixture_id': 'avif-pq-p3-8-opaque', 'geometry': 'contain',
                'status': 'qualified', 'artifacts': {'output': str(root/'missing.avif'),
                                                    'sha256': '0'*64}}
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'Inspected manual file is missing'):
                    suite.candidate_files([case], [])

    def test_manual_gainmap_original_is_bound_to_committed_fixture_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'results').mkdir()
            fixture_dir = root/'fixtures/gainmap'
            fixture_dir.mkdir(parents=True)
            source = fixture_dir/'gainmap-apple-old.jpg'
            source.write_bytes(b'file-copy-test-only')
            expected_hash = suite.avif.digest(source)
            (fixture_dir/'manifest.json').write_text(json.dumps({'fixtures': [{
                'id': 'gainmap-apple-old', 'file': source.name, 'sha256': expected_hash}]}))
            with patch.object(suite, 'RESULTS', root/'results'), patch.object(suite, 'ROOT', root):
                files = suite.candidate_files([], [])
                self.assertEqual(len(files), 1)
                self.assertEqual(files[0]['sha256'], expected_hash)
                source.write_bytes(b'changed-after-inspection')
                with self.assertRaisesRegex(ValueError, 'changed after inspection'):
                    suite.candidate_files([], [])

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
