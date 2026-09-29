"""Run the pinned native qualification suite and write reviewable evidence."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest

import avif
import gainmap
from matrix import (CHECKS, ProofRequestError, _has_rejected_measurement,
                    _source_transform_matches, build_matrix, required_cases, validate_selectors)

ROOT = Path(__file__).resolve().parent
WORK = ROOT/'work'
RESULTS = ROOT/'results'


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Native diagnostics include ASLR addresses, which are not measurement data.
    text = json.dumps(value, indent=2, allow_nan=False)
    path.write_text(re.sub(r'0x[0-9a-fA-F]{6,}', '0xADDRESS', text)+'\n')


def versions():
    commands = {
        'node': ['node','--version'],
        'sharp': ['node','-e','console.log(JSON.stringify(require("sharp").versions))'],
        'avif': ['avifenc','--version'],
        'ffmpeg': ['ffmpeg','-version'],
        'exiftool': ['exiftool','-ver'],
        'packages': ['apk','info','-v'],
        'python': ['python3','--version'],
    }
    values = {name: avif.native(command).decode().strip() for name,command in commands.items()}
    values.update({'os_release':Path('/etc/os-release').read_text(),
                   'architecture':'linux/amd64',
                   'vulkan_driver':'Mesa lavapipe CPU renderer; no host GPU is passed into the container',
                   'network_at_test_time':'disabled',
                   'dockerfile_sha256':avif.digest(ROOT/'Dockerfile'),
                   'apk_lock_sha256':avif.digest(ROOT/'environment/apk-lock.json'),
                   'npm_lock_sha256':avif.digest(ROOT/'environment/package-lock.json'),
                   'png_decoder_source_sha256':avif.digest(ROOT/'png_decode.c'),
                   'libavif_local_patch_sha256':avif.digest(ROOT/'libavif-sequence-transform.patch'),
                   'avifenc_binary_sha256':avif.digest(Path('/usr/local/bin/avifenc')),
                   'libultrahdr_build_recipe_sha256':avif.digest(ROOT/'native-gainmap-build.sh'),
                   'libultrahdr_xmp_patch_sha256':avif.digest(ROOT/'libultrahdr-xmp-arrays.patch'),
                   'independent_iso_reader_sha256':avif.digest(ROOT/'gainmap_iso.py'),
                   'native_zimg_window_source_sha256':avif.digest(ROOT/'native_zimg_window.c'),
                   'native_zimg_build_recipe_sha256':avif.digest(ROOT/'native-zimg-build.sh'),
                   'native_zimg_window_binary_sha256':avif.digest(Path('/usr/local/bin/hdr-proof-zimg-window')),
                   'native_lossless_jpeg_source_sha256':avif.digest(ROOT/'native_lossless_jpeg.c'),
                   'native_lossless_jpeg_binary_sha256':avif.digest(Path('/usr/local/bin/hdr-proof-lossless-jpeg')),
                   'native_dct_jpeg_source_sha256':avif.digest(ROOT/'native_dct_jpeg.c'),
                   'native_dct_jpeg_binary_sha256':avif.digest(Path('/usr/local/bin/hdr-proof-dct-jpeg')),
                   'native_jpegli_binary_sha256':avif.digest(Path('/opt/proof/jpegli/hdr-proof-jpegli')),
                   'native_mozjpeg_binary_sha256':avif.digest(Path('/opt/proof/mozjpeg/hdr-proof-mozjpeg')),
                   'native_jpeg_coefficient_reader_sha256':avif.digest(Path('/usr/local/bin/hdr-proof-jpeg-coefficients')),
                   'native_icc_gainmap_binaries':Path('/opt/proof/icc-gainmap/binary-sha256.txt').read_text(),
                   'native_icc_gainmap_sources':Path('/opt/proof/icc-gainmap/source-sha256.txt').read_text(),
                   'native_gainmap_capacity_binary_sha256':avif.digest(Path('/opt/proof/gainmap-capacity/hdr-proof-gainmap-capacity')),
                   'native_gainmap_capacity_provenance':Path('/opt/proof/gainmap-capacity/provenance-sha256.txt').read_text(),
                   'proof_source_sha256':{path.name:avif.digest(path) for path in sorted(ROOT.iterdir())
                       if path.is_file() and (path.name == 'Dockerfile' or path.suffix in ('.py','.c','.cpp','.cjs','.sh','.patch','.cmake'))},
                   'libultrahdr_variant_binaries':Path('/opt/proof/ultrahdr/binary-sha256.txt').read_text(),
                   'libavif_variant_binaries':{str(path.relative_to('/opt/proof/libavif')):avif.digest(path)
                       for path in sorted(Path('/opt/proof/libavif').glob('*/avifgainmaputil'))},
                   'thresholds_sha256':avif.digest(ROOT/'thresholds.json')})
    return values


def artifact_path(value):
    path = Path(value)
    return path if path.is_absolute() else WORK/path


def candidate_files(evidence, fixtures):
    manual = RESULTS/'manual'
    manual.mkdir(exist_ok=True)
    entries = []
    previous_manifest = manual/'manifest.json'
    if previous_manifest.exists():
        for entry in json.loads(previous_manifest.read_text()).get('files',[]):
            name = entry['file']
            if Path(name).name != name:
                raise ValueError('Manual manifest contains a nonlocal path')
            (manual/name).unlink(missing_ok=True)
    def copy(source, name, role, case=None, facts=None, codec_status=None, coding_scope=None, expected_sha256=None):
        source = Path(source)
        if not source.exists():
            if expected_sha256 is not None or (case and case['status'] == 'qualified'):
                raise ValueError(f'Inspected manual file is missing: {name}')
            return
        destination = manual/name
        shutil.copyfile(source,destination)
        copied_hash = avif.digest(destination)
        if expected_sha256 is not None and copied_hash != expected_sha256:
            destination.unlink()
            raise ValueError(f'Manual file changed after inspection: {name}')
        entries.append({'file': name, 'sha256':copied_hash, 'role':role,
                        'case_id':case.get('case_id') if case else None,
                        'codec_status':codec_status or (case.get('status') if case else 'source reference, not a conversion qualification'),
                        'consumer_status':'pending manual review', 'facts':facts or (case.get('facts') if case else None),
                        'coding_scope':coding_scope or (case.get('native_candidate',{}).get('coding_scope') if case else None),
                        'qualification_scope':case.get('qualification_scope') if case else None,
                        'rendering_scope':case.get('rendering_scope') if case else None,
                        'known_consumer_limitations':case.get('known_consumer_limitations', []) if case else [],
                        'consumer_decoder_diagnostics':case.get('consumer_decoder_diagnostics', {}) if case else {},
                        'warning':'A failed candidate is a diagnostic comparison, not an approved download or SDR fallback.' if case and case['status']!='qualified' else None})
    for fixture in fixtures:
        suffix = Path(fixture['path']).suffix
        if suffix in ('.jpg', '.avif', '.png', '.webp', '.gif'):
            facts = fixture.get('facts', fixture.get('native_facts'))
            if not isinstance(facts, dict):
                raise ValueError(f'Missing source inspection facts: {fixture["id"]}')
            copy(fixture['path'], f'source-{fixture["id"]}{suffix}', 'Inspected source fixture',
                 facts=facts, expected_sha256=fixture.get('sha256'))
    gainmap_directory = ROOT/'fixtures/gainmap'
    if gainmap_directory.exists():
        for fixture in json.loads((gainmap_directory/'manifest.json').read_text())['fixtures']:
            name = fixture['file']
            if Path(name).name != name:
                raise ValueError('Gain-map fixture manifest contains a nonlocal path')
            copy(gainmap_directory/name, f'source-{name}',
                 'Provenance-documented gain-map source; exact original',
                 expected_sha256=fixture['sha256'])
    selected = [case for case in evidence
        if (case.get('fixture_id', '').startswith('avif-') and case.get('geometry') == 'contain')
        or (case.get('fixture_id') == 'avif-gainmap-from-android-xmp'
            and case.get('geometry') in ('cover', 'fill', 'upscale'))
        or (case.get('fixture_id', '').startswith('png-') and '-8-' in case['fixture_id']
            and case.get('geometry') in ('contain', 'orientation'))
        or (case.get('fixture_id') in ('animated-pq-alpha', 'animated-hlg-alpha',
                                     'png-pq-rec2020-16-alpha', 'png-hlg-p3-16-opaque')
            and case.get('geometry') in ('contain', 'identity'))
        or (case.get('fixture_id') in gainmap.NAMES and case.get('geometry') == 'contain')
        or case.get('candidate') == 'native-combine-moderateoffset-mozjpeg-base-dct-float-map'
        or case.get('candidate', '').startswith('native-combine-icc-gamma32-')
        or case.get('proof_module') in ('iso_geometry_headroom', 'gainmap_avif_identity_jpeg')
        or (case.get('fixture_id', '').startswith('apng-') and case.get('geometry') in ('contain', 'orientation'))]
    for case in selected:
        artifacts = case.get('artifacts')
        values = [artifacts.get('output')] if isinstance(artifacts,dict) else artifacts or []
        image_values = [value for value in values if value and Path(value).suffix in ('.jpg','.avif','.png','.webp','.gif')]
        for value in image_values[:1]:
            if not value:
                continue
            source = artifact_path(value)
            suffix = source.suffix
            if suffix not in ('.jpg','.avif','.png','.webp','.gif'):
                continue
            name = re.sub(r'[^a-zA-Z0-9_-]','-',case['case_id'])+suffix
            inspected_hash = (artifacts.get('sha256') if isinstance(artifacts, dict) else None)
            inspected_hash = inspected_hash or case.get('facts', {}).get('sha256')
            copy(source,name,'Inspected native conversion candidate',case=case, expected_sha256=inspected_hash)
        reference = case.get('reference_sdr')
        if reference:
            name = re.sub(r'[^a-zA-Z0-9_-]','-',case['case_id'])+'-reference-sdr.png'
            copy(artifact_path(reference['path']),name,'Independent matched-geometry authored SDR reference',
                 facts={'reference_sha256':reference['sha256'],'case_id':case['case_id']},
                 expected_sha256=reference['sha256'])
        hdr_intent = case.get('hdr_intent', {})
        if hdr_intent.get('facts'):
            intent = artifact_path(hdr_intent['path'])
            if avif.digest(intent) != hdr_intent['sha256']:
                raise ValueError('Native HDR intent changed after inspection')
            name = re.sub(r'[^a-zA-Z0-9_-]','-',case['case_id'])+'-native-hdr-intent.png'
            copy(intent, name, 'Inspected native matched-geometry HDR intent comparison', case=case,
                 facts=hdr_intent['facts'],
                 expected_sha256=hdr_intent['sha256'],
                 codec_status='inspected native HDR intent; not a conversion qualification',
                 coding_scope='16-bit PQ PNG; native encoder intent, not an independent source reference')
    write_json(manual/'manifest.json',{'status':'pending manual review','files':entries})
    return entries


def merge_reconstruction_profiles(fixtures, source_records):
    known = {fixture['id']: fixture for fixture in fixtures}
    records = {record['id']: record for record in source_records}
    if len(known) != len(fixtures) or len(records) != len(source_records):
        raise ValueError('Ambiguous reconstruction source identity')
    for identity, record in records.items():
        digest = record.get('sha256')
        if (identity not in known or not isinstance(digest, str)
                or re.fullmatch('[0-9a-f]{64}', digest) is None or digest != known[identity].get('sha256')):
            raise ValueError('Reconstruction source identity or inspected bytes differ')
    return [{**fixture,
             'source_reconstruction_profiles': records[fixture['id']]['source_reconstruction_profiles'],
             'valid_scope': 'Established authored SDR base; HDR appearance is limited to the named reconstruction profiles, with output and consumer qualification separate'}
            if fixture['id'] in records else fixture for fixture in fixtures]


def fixture_lock(fixtures, update):
    generated = {f['id']:f['sha256'] for f in fixtures if f.get('spec') or f.get('generator')}
    path = ROOT/'fixtures/generated-sha256.json'
    if update:
        write_json(path,{'generator':'avif.py, hdr_png.py, apng.py and selector_probes.py; native versions locked by environment/ and Dockerfile', 'sha256':generated})
    if not path.exists():
        return ['Missing generated fixture hash lock; capture once with --update-fixture-lock before committing.']
    expected = json.loads(path.read_text())['sha256']
    if expected != generated:
        return ['Generated fixture hashes differ from committed lock: '+', '.join(k for k in sorted(expected.keys()|generated.keys()) if expected.get(k)!=generated.get(k))]
    return []


def compact_case(case):
    copy = dict(case)
    for key in ('facts','orientation_source','source_facts','independent_information'):
        if key in copy:
            copy[key] = case[key]
    return copy


def diagnostic_report(matrix):
    summary = matrix['diagnostic_summary']
    required = summary['required_cases']
    all_cases = summary['all_cases']
    lines = [
        '## Failure stages', '',
        f'Of {summary["required_plan_size"]} original fixed-plan cases, {required["cases"]} have exact fixture/selector evidence and {required["qualified"]} qualify. This plan chose eight-bit SDR AVIF; that choice is not a product requirement when depth is omitted. Native encoding completed in {required["native_completed"]}; {required["native_operation_failures"]} stopped at a native operation. A native failure can occur while preparing an input fixture, before the final encoder is reached.', '',
        f'Across all recorded cases, {all_cases["measured_failure_cases"]} have measured check failures and {all_cases["missing_evidence_cases"]} lack required evidence. These counts overlap. A missing ordinary-white patch after cropping or an unavailable independent gamut reference is an evidence gap, not a measured change to those pixels.', '',
        'False downstream flags on a failed native operation are unevaluated. They do not establish additional appearance, decoder, or metadata privacy failures. Successful encoding also does not establish qualification. The original status enums and required passing criteria remain unchanged.', '',
        '| Fixed coverage path | Planned | Observed | Native completed | Native failure | Measured failure | Missing evidence | Qualified |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ]
    for row in summary['required_cells']:
        lines.append(f'| `{row["cell_id"]}` | {row["planned_cases"]} | {row["cases"]} | {row["native_completed"]} | {row["native_operation_failures"]} | {row["measured_failure_cases"]} | {row["missing_evidence_cases"]} | {row["qualified"]} |')
    lines += ['', 'Measured failures and evidence gaps count cases once per column, even when several frames fail. Per-check counts and case diagnostics are in [the matrix](conversion-matrix.json); raw measurements and native errors remain in [measurements](measurements.json).', '']
    return lines


def product_coverage_report(matrix):
    coverage = matrix['product_coverage']
    lines = ['## Accepted product coverage', '',
             f'{coverage["qualified_count"]} of {coverage["required_count"]} declared product fixture/geometry requirements have qualified codec evidence. {coverage["untested_count"]} have no matching tested tuple.', '',
             'The accepted contract permits a suitable supported depth when depth is omitted. Required SDR AVIF requests therefore accept exact qualified 8-, 10-, or 12-bit evidence. This does not qualify a failed explicit depth=8 request. WebP retains its eight-bit output constraint. Every other selector, source fixture, geometry, and qualification gate must match. No runtime depth-selection policy is implemented here.', '',
             '| Required product path | Fixture/geometry requirements | Qualified | Untested |',
             '| --- | ---: | ---: | ---: |']
    for row in coverage['cells']:
        lines.append(f'| `{row["cell_id"]}` | {row["required_count"]} | {row["qualified_count"]} | {row["untested_count"]} |')
    lines += ['', 'These counts cover the declared corpus only. Gain-map HDR counts describe the original display boost 16 comparisons; they do not qualify intermediate display headroom. A ledger cell can retain failed exact-selector candidates while its endpoint requests have qualified alternatives. Consumer review and a usable SDR wallpaper download remain separate requirements. The original fixed-plan outcomes below remain visible.', '']
    rendering = matrix['rendering_coverage']
    lines += [f'{rendering["qualified_count"]} of {rendering["required_count"]} additional HDR rendering requirements qualify. An unqualified row blocks faithful-HDR qualification independently of the endpoint counts and pending physical checks.', '',
              '| Exact rendering requirement | Display boost | Status |', '| --- | ---: | --- |']
    for row in rendering['requirements']:
        lines.append(f'| `{row["requirement_id"]}` | {row["display_boost"]} | {row["status"]} |')
    lines += ['', 'Source and output must use the same display boost and the declared independent reference. A passing endpoint or another headroom value cannot satisfy this gate. No new product selector or runtime generation policy is introduced.', '']
    same_file = rendering['same_file_requirement']
    boosts = ', '.join(str(value) for value in same_file['display_boosts'])
    lines += [f'One identical output file at display boosts {boosts}: {same_file["status"]}. '
              'Different output files cannot jointly satisfy adaptive-HDR qualification; the matrix joins their actual SHA-256 hashes across every rendering point.', '']
    lines += [f'{rendering["same_file_qualified_count"]} of {rendering["same_file_required_count"]} required gain-map fixture/geometry tuples pass every declared same-file rendering. '
              'Every tuple needs boost 2 and 16; the ISO source also needs boost 64 to reach full source capacity. '
              'Untested source models and geometries remain unqualified. Endpoint evidence without an explicit display boost cannot satisfy the same-file join.', '']
    return lines


def precision_report(precision):
    lines = ['## Scoped eight-bit precision diagnostic', '',
             f'The exhaustive diagnostic evaluates all {precision["enumerated_codes_per_reference"]:,} full-range sRGB RGB8 triples for each selected reference color. It finds {precision["selected_samples_with_impossible_maximum_gate"]} of {precision["shadow_samples"]} visible shadow samples that cannot meet the fixed maximum Delta E ITP gate in this representation.', '',
             '| Reference sRGB code units | Matching shadow pixels | Best RGB8 code | Minimum Delta E ITP |',
             '| --- | ---: | --- | ---: |']
    for row in precision['references']:
        lines.append(f'| {row["reference_rgb8_code_units"]} | {row["visible_matching_samples"]} | {row["best_rgb8_code"]} | {row["minimum_delta_e_itp"]:.6f} |')
    lines += ['',
              f'The native AOM encode and independent dav1d decode preserve the supplied RGB8 codes exactly: {precision["native_counterexample"]["decoded_exactly_matches_supplied_rgb8"]}. The encoder cannot recover precision absent from those codes. The [diagnostic record](precision.json) includes reference, source, metric and threshold hashes, native commands, and six additional YUV encoding trials.', '',
              'This is a floating-point enumeration for one unchanged grade and one representation. It does not establish that eight-bit AVIF, another declared transfer, every YUV encoding, or another independently justified SDR grade is impossible. The diagnostic cannot qualify any conversion or physical display.', '']
    return lines


def gainmap_candidate_report(evidence):
    groups = {}
    readers = {}
    sof0_requests = {}
    required = {(case['fixture_id'], case['geometry'], json.dumps(validate_selectors(case['selectors']), sort_keys=True)): case
                for case in required_cases() if case['cell_id'] == 'gainmap-jpeg:hdr:jpg'}
    for case in evidence:
        if not case.get('candidate', '').startswith('native-combine-'):
            continue
        key = (case['fixture_id'], case['candidate'], case['source_reference_revision'])
        groups.setdefault(key, []).append(case)
        for reader, diagnostic in case.get('consumer_decoder_diagnostics', {}).items():
            readers.setdefault(reader, Counter())[diagnostic['status']] += 1
        facts = case.get('facts', {})
        if (case.get('checks', {}).get('native_encoder') is not True
                or any(type(facts.get(layer, {}).get('sof')) is not int or facts[layer]['sof'] != 0
                       for layer in ('base', 'map'))
                or not re.fullmatch(r'[0-9a-f]{64}', case.get('source_sha256', ''))
                or not case.get('geometry') or not case.get('source_reference_revision')
                or not isinstance(case.get('selectors'), dict)):
            continue
        try:
            selectors = validate_selectors(case['selectors'])
        except ProofRequestError:
            continue
        if selectors.get('format') != 'jpg' or selectors['range'] != 'hdr':
            continue
        encoded_selectors = json.dumps(selectors, sort_keys=True)
        orientation = case.get('orientation_source', {})
        request = (case['fixture_id'], case['source_sha256'], case['geometry'], encoded_selectors,
                   json.dumps(case.get('probe_crop_rectangle'), sort_keys=True),
                   orientation.get('sha256'), orientation.get('orientation'))
        sof0_requests.setdefault((case['source_reference_revision'], request), []).append(case)

    def passes_original_checks(case):
        checks = case.get('checks', {})
        return (case.get('status') == 'qualified' and not case.get('blockers')
                and all(checks.get(key) is True for key in set(CHECKS) | set(checks))
                and not _has_rejected_measurement(case.get('measurements', {})))

    def largest(cases, measurement, metric, statistic):
        values = [region[metric][statistic] for case in cases
                  for region in case.get('measurements', {}).get(measurement, {}).get('regions', {}).values()
                  if region.get('samples', 0) and statistic in region.get(metric, {})]
        return f'{max(values):.4f}' if values else 'missing'

    lines = ['## Native gain-map candidate measurements', '',
             'Each value is the maximum of the recorded regional statistic across the tested geometries in that row. Means are not pooled across regions or images. Empty regions are excluded; absent measurements remain missing. Qualification still requires every original structural, privacy and appearance check. Exact case IDs, all shadow/midtone/highlight statistics and individual blockers remain in [measurements](measurements.json).', '',
             '| Fixture | Candidate | Reference revision | Qualified/attempted | SDR Delta E mean | SDR Delta E max | HDR Delta E mean | HDR Delta E max | HDR mean absolute luminance error, nits |',
             '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for (fixture, candidate, revision), cases in sorted(groups.items()):
        values = [largest(cases, 'authored_sdr_base', 'delta_e_itp', 'mean'),
                  largest(cases, 'authored_sdr_base', 'delta_e_itp', 'maximum'),
                  largest(cases, 'reconstructed_hdr', 'delta_e_itp', 'mean'),
                  largest(cases, 'reconstructed_hdr', 'delta_e_itp', 'maximum'),
                  largest(cases, 'reconstructed_hdr', 'luminance_absolute_error_nits', 'mean')]
        qualified = sum(case['status'] == 'qualified' for case in cases)
        lines.append(f'| `{fixture}` | `{candidate}` | `{revision}` | {qualified}/{len(cases)} | '
                     + ' | '.join(values) + ' |')
    if readers:
        lines += ['', 'The following separate decoder diagnostics do not alter the file qualification above. The original reader results remain recorded. A successful readback still leaves every physical consumer pending manual review.', '',
                  '| Independent reader diagnostic | Attempted | Appearance passed | Failed or unqualified |',
                  '| --- | ---: | ---: | ---: |']
        for reader, statuses in sorted(readers.items()):
            attempted, qualified = sum(statuses.values()), statuses['qualified']
            lines.append(f'| `{reader}` | {attempted} | {qualified} | {attempted-qualified} |')
    if sof0_requests:
        coverage = {}
        for (revision, request), cases in sof0_requests.items():
            row = coverage.setdefault(revision, Counter())
            row['observed'] += 1
            row['qualified'] += any(passes_original_checks(case) for case in cases)
            fixture, _, geometry, selectors, crop, _, _ = request
            planned = required.get((fixture, geometry, selectors)) if crop == 'null' else None
            if planned:
                row['required_observed'] += 1
                row['required_qualified'] += any(passes_original_checks(case) and _source_transform_matches(case, planned)
                                                 for case in cases)
        lines += ['', 'The SOF0 union below counts each exact observed request once across native alternatives with independently inspected SOF0 base and map layers. Fixture and source hash, normalized selectors, geometry, crop and source-orientation facts, and reference revision must match. A request qualifies only when an exact alternative passes all original checks without blockers or rejected measurements. The per-candidate failures above remain unchanged.', '',
                  '| Reference revision | Qualified/observed exact SOF0 requests | Qualified/observed required requests |',
                  '| --- | ---: | ---: |']
        for revision, row in sorted(coverage.items()):
            lines.append(f'| `{revision}` | {row["qualified"]}/{row["observed"]} | '
                         f'{row["required_qualified"]}/{row["required_observed"]} |')
        lines += ['', 'These denominators cover the observed corpus only; the required column matches the fixed plan within that corpus. Unobserved requests remain untested. This summary selects no runtime encoder and changes no matrix status. Physical browser and OS wallpaper qualification remains pending manual review.']
    return lines + ['']


def jpegli_experiment_report(base, quality):
    base_passed = sum(case['status'] == 'qualified' for case in base['cases'])
    quality_passed = sum(case['status'] == 'qualified' for case in quality['cases'])
    return [
        f'The separate [JPEGli base experiment](jpegli-base-experiment.json) records {len(base["cases"])} native SOF0 RGB8 trials, of which {base_passed} pass the unchanged authored-SDR base checks. Each failed trial retains its regional measurements.', '',
        f'The bounded [JPEGli quality experiment](jpegli-quality-experiment.json) records {len(quality["cases"])} native trials, with {quality_passed} passing and {len(quality["cases"])-quality_passed} failed or unqualified. It retains every declared quality/table/adaptive option for the remaining source/geometry corpus under the same authored-SDR reference and thresholds.', '',
        'Both base experiments do not qualify an HDR derivative and are excluded from the conversion-attempt counts above. A JPEGli HDR candidate must independently regenerate and validate its gain map and reconstructed HDR output. Physical consumer review remains pending.', '',
    ]


def mozjpeg_experiment_report(base, historical, lambdas):
    lines = ['## Native MozJPEG base experiments', '',
        'These separate authored-SDR base experiments are excluded from the conversion-attempt counts. A passing base still needs a regenerated gain map and complete independent HDR qualification. Every physical consumer remains pending manual review.', '',
        '| Native setup | Trials | Qualified SDR bases | Measured appearance failures | Decoder errors |',
        '| --- | ---: | ---: | ---: | ---: |']
    for name, result in (('Optimized Huffman', base), ('Retained standard Huffman', historical),
                         ('Bounded trellis precision', lambdas)):
        cases = result['cases']
        passed = sum(case['status'] == 'qualified' for case in cases)
        appearance_failed = sum(case.get('measurement', {}).get('passed') is False for case in cases)
        decoder_failed = sum(any(command.get('exit_code') or command.get('stderr')
            for command in case.get('facts', {}).get('decoder_diagnostics', [])) for case in cases)
        lines.append(f'| {name} | {len(cases)} | {passed} | {appearance_failed} | {decoder_failed} |')
    return lines + ['',
        'The [optimized-Huffman trials](mozjpeg-base-experiment.json) retain every declared DCT/trellis/deringing option. The [initial standard-Huffman setup](mozjpeg-standard-huffman-experiment.json) remains reproducible, including malformed streams that FFmpeg conceals despite exiting zero. Both native command runners now reject error-level decoder diagnostics; concealed rasters cannot supply appearance evidence.', '',
        'The [bounded trellis-precision follow-up](mozjpeg-lambda-experiment.json) increases the native coefficient-distortion penalty for the remaining six source/geometry cases. It retains default controls, unchanged quality-100 quantizers, authored samples and appearance gates. Failure of these declared options does not prove every baseline JPEG encoder impossible.', '']


def coefficient_diagnostic_report(diagnosis):
    lines = ['## Remaining baseline JPEG precision evidence', '',
        'This read-only [native coefficient diagnostic](mozjpeg-coefficient-diagnosis.json) cannot qualify a converter or physical consumer. It retains the failed input statuses and checks output, reference and native-input hashes before reading actual JPEG coefficients.', '',
        '| Source | Geometry | Profiles | Native geometry passes | Smallest full-image maximum Delta E | Minimum failing shadow pixels in unchanged-DC blocks |',
        '| --- | --- | ---: | --- | ---: | ---: |']
    for case in diagnosis['cases']:
        profiles = case['profiles']
        maximum = min(profile['worst_pixel']['delta_e_itp'] for profile in profiles)
        remaining = min(profile['unchanged_dc_blocks']['failing_pixel_count'] for profile in profiles)
        lines.append(f'| `{case["fixture_id"]}` | {case["geometry"]} | {len(profiles)} | {case["native_geometry_measurement"]["passed"]} | {maximum:.4f} | {remaining} |')
    return lines + ['',
        'Failures persist in blocks whose DC coefficients match the no-trellis control. The higher-lambda trials change real output bytes and AC coefficients. Quantized AC/IDCT error is an inference from those coefficients and decoded samples; these observations do not prove every possible baseline JPEG encoder incapable of meeting the fixed gates.', '']


def render_report(matrix, evidence, fixtures, tone, controls, native_versions, errors, manual, precision, jpegli, jpegli_quality, mozjpeg, mozjpeg_historical, mozjpeg_lambdas, mozjpeg_diagnosis):
    counts = Counter(case['status'] for case in evidence)
    cell_counts = Counter(cell['status'] for cell in matrix['cells'] if cell['in_hdr_ledger'])
    stages = matrix['diagnostic_summary']['all_cases']
    lines = ['# HDR conversion proof results','',
             'The HDR milestone remains blocked. Required conversion and display-headroom rendering gates must pass separately from browser HDR presentation, native viewers, and OS wallpaper checks. Automated codec results cannot qualify those physical consumers. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.','',
             'Reproduce from the repository root with `make run PACKAGE=media SCRIPT=proof:hdr`. Docker must support linux/amd64. The default command returns exit 2 while required codec cases or physical checks are unqualified. This is an intentional qualification failure, not a passing release gate.','',
             f'Recorded {len(evidence)} conversion attempts over {len(fixtures)} fixture records: {stages["native_completed"]} completed native encoding, {stages["native_operation_failures"]} stopped at a native operation, and {stages["native_not_established"]} lack a confirmed native outcome. Qualification outcomes: '+', '.join(f'{value} {key}' for key,value in sorted(counts.items()))+'.',
             f'The inventory covers {matrix["ledger_cell_count"]} HDR-ledger cells and {matrix["generic_sdr_control_count"]} labeled SDR controls. Ledger outcomes: '+', '.join(f'{value} {key}' for key,value in sorted(cell_counts.items()))+'.','',
             f'The original fixed coverage plan contains {matrix["required_case_count"]} cases. Unexecuted fixed-plan cases: {sum(len(cell["missing_cases"]) for cell in matrix["cells"])}. Unlisted cross-products are untested, even when a neighboring case passes.','',
             *product_coverage_report(matrix),
             *diagnostic_report(matrix),
             *precision_report(precision),
             '## Environment and reproducibility','',
             'The image uses the same Node 22 Alpine/musl deployment shape as Media. This is a proposed native proof pipeline, not the existing Sharp 0.33 production worker. No service dependency was upgraded. HDR geometry uses native FFmpeg/zimg float processing and luminance-coupled HLG transforms. The calibrated SDR candidate uses the native CPU Mobius filter. CPU lavapipe runs the retained libplacebo comparison trials without a host GPU. Network access is disabled during tests.','',
             f'- Node: `{native_versions["node"]}`',
             f'- AVIF tools: `{native_versions["avif"].splitlines()[0]}`',
             f'- FFmpeg: `{native_versions["ffmpeg"].splitlines()[0]}`',
             f'- ExifTool: `{native_versions["exiftool"]}`',
             f'- Unchanged threshold file SHA-256: `{native_versions["thresholds_sha256"]}`','',
             'The base image is pinned by digest. Every additional APK is pinned by URL and SHA-256, the full package inventory is checked, npm uses its integrity lock, and native source archives have checked hashes. See [native versions](native-versions.json), [dependency locks](../environment/), [commands](commands.json), [fixture facts and hashes](fixtures.json), and [generator hashes](../fixtures/generated-sha256.json).','',
             '## How to read the evidence','',
             'A qualified case requires a real encoder, a separate decoder, exact structural checks, fixed appearance thresholds, and metadata privacy. Independent AV1 decoding uses dav1d, while encoding uses AOM. ExifTool independently reads emitted signaling. The locally patched libavif sequence writer retains animated orientation; its patch and binary hashes are recorded. Gain-map JPEG uses pinned experimental libultrahdr PR484 and PR491 patches and a local per-channel XMP parser/writer patch, with dual ISO/Android metadata. These are proof builds, not upstream releases. ISO-only source reconstruction uses a separately validated native-libjpeg/ISO reader for verified sRGB-transfer RGB bases, supported sRGB/P3 ICC matrices and forward ISO metadata. Analytic vectors and independent native libavif/XMP controls test this narrow reader; unknown color facts or metadata layouts are rejected.','',
             'All comparisons use display-referred linear light. PQ uses ST 2084 absolute luminance. HLG uses a declared 1000-nit reference display and gamma 1.2 OOTF. Synthetic AVIF/PNG geometry references use independent Pillow floating-point bilinear resampling with premultiplied alpha. Gain-map references use separately declared Lanczos geometry. The comparison includes patch boundaries; interpolation differences are measured rather than hidden by discarding edges. These synthetic charts stress conversion and do not represent every photographic or artistic source.','',
             'Authored SDR JPEG candidates additionally use a correctly declared gamma-3.2 ICC transfer with sRGB or P3 primaries. They preserve the independently referenced authored SDR grade and existing acceptance gates while testing the forty required gain-map source/gamut/geometry requests. The native RGB JPEG encoder and independent FFmpeg MJPEG decoder check emitted pixels; the actual ICC matrix and curves determine their color interpretation. Native zimg fractional crop windows retain the filter samples needed at cover boundaries. Standard sRGB-transfer candidates and their failures remain separate. The accepted gamut selectors identify primaries, so a different correctly signaled transfer does not change those selectors. ICC interpretation by physical consumers remains pending.','',
             'Authored SDR lossless PNG and WebP candidates pass all four gain-map sources, two requested gamuts and seven geometries using 8-bit samples with independently verified sRGB transfer and sRGB or P3 ICC primaries. Their 112 cases keep the authored SDR grade and unchanged appearance gates; physical consumer interpretation remains pending.','',
             'The predeclared [thresholds](../thresholds.json) report BT.2124 Delta E ITP and luminance error separately for shadows, midtones, and highlights. Best-effort SDR additionally requires 203-nit ordinary white near 0.90 sRGB signal, retained shadows/midtones, smooth highlight detail, and an independent chromatic mapping reference. The 1000-nit candidate uses a fixed Mobius knee of 0.6 and exposure 1.1. The 4000-nit sequence uses knee 0.54 and exposure 1.2 across both frames. Both use peak output scale 0.99. Its explicit relative-colorimetric gamut mapping clips out-of-gamut sRGB channels after primary conversion; it does not claim perceptual gamut compression. The independent reference derives the shoulder from boundary conditions and converts through D65 XYZ. Identity controls test tone policy before crop, while every encoded derivative is compared at its actual geometry, grouped by source HDR luminance region. Authored JPEG SDR bases bypass automatic HDR tone mapping. Separate gamma-2.2 candidates preserve the same SDR grade with sRGB primaries and a correctly declared coding transfer. AVIF uses CICP 1/4/0; JPEG/WebP/GIF use an independently parsed ICC matrix/TRC profile. GIF requires explicit binary-alpha coercion when the source has fractional alpha. They are not standard sRGB-transfer files. Every emitted representation needs its own consumer review.','',
             'Read [measurements](measurements.json) for each case, including native failures, facts, region statistics, source/output hashes and artifact paths. Full artifacts remain under `../work/` after a run; selected inspected files are committed under [manual](manual/manifest.json). Failed candidates are diagnostic files, not approved fallbacks.','',
             '## Required and candidate paths','',
             '| Source family | Range | Output | Policy | Exact-case aggregate status | Missing fixed-plan cases |',
             '| --- | --- | --- | --- | --- | ---: |']
    for cell in matrix['cells']:
        if cell['in_hdr_ledger']:
            lines.append(f'| {cell["source_id"]} | {cell["range"]} | {cell["output"]} | {cell["policy"]} | {cell["status"]} | {len(cell["missing_cases"])} |')
    lines += ['', 'The [machine-readable matrix](conversion-matrix.json) retains exact selectors, qualified cases, alternative static/coercion requests, missing coverage, and blockers. A failed case does not qualify because another request to the same extension passed.', '', '## Measured tone-map controls','', '| Source | Native algorithm | Ordinary-white SDR signal | Tone policy | Repeat pixels |','| --- | --- | ---: | --- | --- |']
    for row in tone:
        if 'measurement' in row:
            measure = row['measurement']
            white = measure['measurements'].get('ordinary_white_signal',{}).get('mean')
            lines.append(f'| {Path(row["source"]).parent.name} | {row["algorithm"]} | {white:.5f} | {"pass" if measure["tone_curve_passed"] else "fail"} | {row["repeat_identical_pixels"]} |' if white is not None else f'| {row["source"]} | {row["algorithm"]} | missing probe | fail | {row["repeat_identical_pixels"]} |')
    lines += ['', '## Representative regional measurements', '',
              '| Exact case | Region | Delta E ITP p95 | Mean absolute luminance error, nits |',
              '| --- | --- | ---: | ---: |']
    examples = {
        'avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain',
        'avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain',
        'animated-pq-alpha:hdr:avif:preserve:preserve:contain',
        'gainmap-apple-new:sdr:jpg:preserve:preserve:contain',
        'gainmap-android-xmp:sdr:jpg:srgb:preserve:contain',
    }
    for case in evidence:
        if case['case_id'] not in examples:
            continue
        measurement = case.get('measurements', {})
        image = (measurement.get('frames') or [measurement.get('authored_sdr_base', {})])[0]
        for region, values in image.get('regions', {}).items():
            if values.get('samples', 0):
                lines.append(f"| `{case['case_id']}` | {region} | {values['delta_e_itp']['p95']:.4f} | {values['luminance_absolute_error_nits']['mean']:.4f} |")
    lines += ['', 'The tunable Mobius and Reinhard trials use maintained native functions with fixed parameters. Their failures do not change the white target. Adaptive peak detection is disabled in the candidate conversion path; separate controls record frame-to-frame white shifts and repeat hashes with it enabled and disabled. Persistent temporal-filter history is not qualified by these per-frame trials.', '',
              *gainmap_candidate_report(evidence),
              *jpegli_experiment_report(jpegli, jpegli_quality),
              *mozjpeg_experiment_report(mozjpeg, mozjpeg_historical, mozjpeg_lambdas),
              *coefficient_diagnostic_report(mozjpeg_diagnosis),
              '## Blockers and scope limits','',
              '- The [ISO intermediate-headroom proof](iso-intermediate-boost2.json) fails at display boost 2 against an independently reconstructed source at that same boost. Both actual output readers agree within the existing limits, but reconstructed appearance does not. The source capacity is about 49.26 times SDR white; the regenerated file is about 4.47. Read-only pre-JPEG-map and ideal-gain diagnostics retain large errors. A normalized-weight diagnostic reduces broad bias but still fails; normalizing capacity to the boost-16 reference endpoint is insufficient in that diagnostic. Other capacity choices remain untested. The separate display-boost-16 endpoint remains measured; the boost-2 rendering requirement blocks faithful-HDR qualification independently of endpoint counts and physical review.',
              '- The [ISO full-source-headroom proof](iso-full-headroom-boost64.json) also fails. At display boost 64 both source and output gain weights equal one, but the output remains identical to its boost-16 rendering while the source becomes brighter. Its shadow maximum is 129.3897 Delta E ITP and highlight mean is 25.0703. The matrix requires one identical output file to pass boosts 2, 16 and 64; different files cannot jointly qualify adaptation.',
              '- A separate [native full-source candidate](iso-full-source-candidate.json) reconstructs the ISO source at boost 64 before geometry and gain-map regeneration. That full-source rendering passes, with independent shadow maximum 7.79985 under the unchanged limit of 8. The exact same output fails boosts 2 and 16, so it does not clear the joint adaptation requirement. Its regenerated capacity is 3.089498 log2 versus the source 5.622376. The original output and all earlier failures remain separate evidence.',
              '- The [source-capacity candidate](iso-source-capacity.json) copies only the original capacity fields through the pinned native packer. Compressed base/map coding, actual ICC bytes and every other ISO field remain exact; ISO/XMP/native metadata agree. Source and output weights match at all three boosts. Highlight mean error improves from 20.4759 to 0.62918 at boost 2 and from 26.6022 to 1.02007 at boost 16, but shadow and midtone maxima still fail. Boost-64 pixels and measurements remain exactly equal to the qualified full-source control. This corrects the capacity mismatch without qualifying adaptation.',
              '- The [ISO geometry rendering proof](iso-geometry-headroom.json) reruns the existing qualified containment, crop, stretch and EXIF6 orientation recipes. It preserves their exact files and every original endpoint measurement. Each passes display boost 16 and fails appearance at 2 and 64; all other gates pass. The twelve rendering records retain their separate references and manual-file labels. These measurements cover all five required ISO geometries together with the upscale proofs, while XMP and Apple intermediate rendering remains untested.',
              '- The [fractional map-gamma-1.5 candidate](icc-gainmap-midpointoffset-gamma1.5.json) passes the unchanged SDR, native HDR, independent HDR and cross-reader gates for ISO JPEG upscale. It retains the gamma-3.2 compressed base, eight-bit SOF0 layers and midpoint offsets. Qualification requires the experimental ICC-aware readers at display boost 16; the stock sRGB-assuming reader still fails and physical consumers remain pending. All five preceding failed representations remain separate.',
              '- The [Android XMP fractional-gamma upscale](icc-gainmap-xmp-midpointoffset-gamma1.5.json) passes the same file gates using the existing PQ16 source bridge with requested native depth 12. Its source reference shares libavif gain application; source transport agreement is not a claim of a second source-renderer implementation. Independent final HDR readers still qualify the output. The ISO-only float32 guard, stock-reader failure and pending physical status are unchanged.',
              '- New Apple containment passes the same ICC-aware JPEG recipe, while the original upscale remains failed at independent HDR shadow maximum 8.08225 against the unchanged limit 8. Native source/geometry/intent, SDR appearance and cross-reader agreement pass. A separate integer-DCT map keeps that shadow failure and adds highlight p95 failures in both HDR readers, with identical base and pre-JPEG map samples. A separately named FLOAT-base/FLOAT-map upscale preserves native gamma3.2 input and P3 ICC bytes, regenerates the map against its actual compressed base, and passes all gates at maximum HDR error 6.77896. The observed SOF0 union now covers 24/24 tuples, including 20/20 required, within the declared reader scope. Exact auxiliary XMP model/version/headroom facts govern this source; removing its non-authoritative MakerNotes leaves native reconstruction byte-identical, while unknown required XMP facts reject transformation.',
              '- Old Apple containment and upscale also pass the exact midpoint-offset fractional-gamma recipe through the experimental ICC-aware readers. Native source reconstruction requires the original Apple headroom MakerNotes, with a real stripped-source rejection control. Final native and independent HDR gates remain separate from the shared-libavif source reference. Stock-reader failures and physical review stay pending.',
              '- The gain-map AVIF authored SDR GIF containment remains failed despite valid native encoding, actual sRGB ICC, opaque one-frame structure and independent decoding. Palette-only and full-reference errors both exceed the fixed photographic gates. The read-only exact-palette lower bound identifies 900 pixels for which changing dithering cannot meet the existing maximum; it makes no claim about other palettes or encoders. A separate native libimagequant candidate also fails, with 951 pixels outside the fixed maximum for its exact palette. Its native package version and differing library API report are recorded separately. The separate gamma3.2 ICC/libimagequant palette improves shadow maximum to 46.78 and its bound to 794 pixels, but still fails the fixed shadow and midtone gates. All three photographic palettes remain unqualified.',
              '- The [integer-DCT map alternative](icc-gainmap-midpointoffset-gamma2-islow.json) retains the exact midpoint gamma-2 compressed base and native pre-JPEG map. It changes only native map JPEG coding. Both HDR readers still fail shadow maxima and their agreement worsens; its original floating-DCT counterpart remains separate.',
              '- Separately regenerated gain-map AVIF containment, crop, stretch and upscale check actual base, map and alternate precision against the source. Each native moderate-offset depth-8 candidate passes authored SDR and both HDR readers at log2 display headroom 4. The four stock depth-8 results fail; all eight automatic-depth variants declare alternate depth 12 and remain incompatible with the requested preservation selectors. Regenerated headroom and offsets differ from the source, so intermediate display adaptation remains untested. This is a declared endpoint proof, with physical consumers pending.',
              '- The [logarithmic midpoint-offset candidate](icc-gainmap-midpointoffset-gamma2.json) fixes the gamma-2 trial at ISO offsets 1/16384. Both HDR readers pass the existing midtone/highlight gates but fail their shadow maxima; their cross-comparison also fails in shadows. This separate result narrows the precision tradeoff without qualifying the JPEG or changing the original gates.',
              '- The [separate map-gamma-2 experiment](icc-gainmap-smalloffset-gamma2.json) retains the small ISO offset and both eight-bit JPEG layers. AVIF/ISO/XMP/native gamma values and zero/fractional/full-headroom controls must agree. Highlight error improves, but shadow error and regional means remain failed under the same gates. Earlier gamma-1 bytes and failed cases stay separate.',
              '- Separate ICC-aware HDR JPEG experiments use the actual gamma-3.2 base profile, native LittleCMS float32 linearization and native gain computation. Both the [moderate-offset](icc-gainmap-moderateoffset.json) and [small-offset](icc-gainmap-smalloffset.json) cases remain in the matrix. The former fails independent shadow reconstruction and decoder agreement; the latter improves agreement but fails midtone/highlight appearance. The fixed references, RGB8 layer depths and appearance gates are unchanged. Stock readers that assume sRGB or reject ICC remain separately recorded limitations. Their inspected files are diagnostic, with physical consumers pending.',
              '- Single-layer HDR PNG16 from the verified gain-map AVIF renderer retains a distinct original aspect failure: pHYs 0:1 does not establish the requested square pixels. A separate native setsar=1 rewrite must preserve every decoded RGB16 and alpha sample while establishing 1:1. Independent chunk parsing, ExifTool, libpng and FFmpeg check color, depth, geometry, privacy and storage; unchanged source, geometry and HDR appearance gates still apply. Neither representation certifies physical HDR presentation.',
              '- The locked gain-map AVIF source has separately qualified standard-sRGB RGB8 JPEG containment, crop and stretch. Its standard-sRGB upscale remains failed at shadow maximum 25.49485 in both native-input and full-reference comparisons. A separate gamma-3.2 ICC upscale passes the same gates with shadow maximum 3.83562. Exhaustive native transfer checks preserve the authored SDR reference and primaries; regional mean errors increase but stay within their unchanged limits. Actual ICC semantics, RGB components and Adobe transform establish color; raw decoder defaults remain diagnostics. Native JPEG coding error and full authored-reference error must both pass unchanged photographic gates. No separate JPEG aspect declaration is invented, and physical compatibility remains pending.',
              '- The gain-map AVIF source has separately qualified HDR JPEG containment, crop, stretch and upscale through ICC-aware readers at display boost 16. Native authored SDR and corrected PQ16 HDR preparations supply encoder pixels; direct dav1d source samples and parsed tmap metadata supply the independent reference. Actual RGB8 SOF0 layers, ISO/XMP/native agreement, privacy and both endpoint appearances pass unchanged gates. Independent HDR maximum across these geometries is 6.10543; original containment bytes and measurements remain exact. These endpoint measurements retain stock-reader limitations; separate intermediate rendering and physical consumer checks remain necessary.',
              '- A separate gain-map AVIF-to-HDR-JPEG containment proof renders that exact file at display boost 2. Both readers agree but fail the unchanged appearance gates, with independent shadow maximum 75.26896. Capacity-normalized and uncompressed-map diagnostics retain shadow errors. The original authored SDR geometry remains fixed; replacing it with linear-light geometry would fail its existing reference. This measured adaptation failure does not create an additional required product path or change the passing boost-16 endpoint.',
              '- An optional unresized gain-map AVIF-to-HDR-JPEG conversion retains the original raster and checked source gain metadata. One actual RGB8 file passes authored SDR and both HDR readers at boosts 2, source-full and 16. Independent HDR maximum is 4.666031 across those renderings; SDR maximum is 3.962015. Actual ICC interpretation remains necessary. Candidate/reference pairs are prepared for physical review. This identity result does not qualify resizing, crop, orientation or unmeasured headrooms; the failed resized candidates remain unchanged.',
              '- A separate native AVIF-to-HDR-JPEG trial retains original source gain metadata while resizing its map and authored base separately. It restores matching source/output weights and preserves the SDR measurement exactly, but fails HDR appearance at boost 2, source-full headroom and boost 16. Independent shadow maxima are 146.7847 at boost 2 and 171.395 at full headroom. Read-only reference diagnostics identify exact nonmonotonic channel samples that an equal-offset gain curve cannot reproduce exactly; they do not prove that every approximate encoding must fail the regional limits.',
              '- Authored SDR WebP containment, crop, stretch and upscale from the locked gain-map AVIF uses the same verified native source/geometry preparation. Actual lossless RGB8 WebP and native sRGB ICC semantics are independently inspected. FFmpeg and libwebp must recover every native input sample exactly; the independent authored SDR reference and unchanged photographic limits still determine appearance qualification. HDR and physical consumer interpretation are separate.',
              '- Original Sharp, retained-map and native-regeneration candidates keep their measured failures. Resampling a base and logarithmic map separately does not commute with resizing reconstructed HDR in linear light. The native combined candidate instead resizes the authored SDR and reconstructed HDR intents separately, computes a new map, and retains both compressed RGB8 JPEG layers exactly. Independent FFmpeg SDR decoding, native libultrahdr HDR reconstruction and a separately validated ISO reader check the emitted file.',
              '- The separately versioned gainmap-hdr-target-gamut-v1 reference filters and clips negative Lanczos excursions in the requested output primaries. Clipping in the earlier Rec.2020 decoder coordinates could create negative components in the requested P3 or sRGB gamut. Analytic commutation, out-of-gamut and identity controls verify this correction. Old references and failed case IDs remain visible; new cases record the reference revision and diagnostic differences. Appearance thresholds are unchanged.',
              '- Combined gain-map candidates use JPEG SOF3 predictive RGB8 coding and proof-local native patches. The pinned libavif JPEG reader rejects SOF3, while the separately tested native JPEG/ISO and patched libultrahdr readers decode it. File qualification does not establish browser or wallpaper compatibility. Every exact representation still requires the listed physical consumer checks.',
              '- Separate SOF0 RGB8 DCT candidates compute a gain map against their actual compressed SDR base. SOF0 layer coding alone does not establish ICC-aware gain-map reconstruction; DCT shadow errors still disqualify other cases. The baseline libavif JPEG-to-AVIF-to-PQ decoder route adds eight-bit YCbCr map rounding. A separate native RGB reader preserves map samples without that conversion. Both reader results retain their own measurements and failures without changing any conversion gate. Neither decoder result qualifies a physical browser or wallpaper setter.',
              '- A separate moderate-offset native gain-map candidate uses offsets of 1/4096 to reduce the eight-bit map interval while retaining near-black accuracy. Analytic dark controls and unchanged regional appearance gates check the tradeoff. All ISO, ExifTool XMP and native probe channel extrema, gamma, offsets and headroom must agree within documented serialization precision. The prior identity-policy upscale failures stay visible.',
              '- Separate ISO float32 source candidates reuse the native codec transfer/gain functions before half-float storage and retain native float geometry. They must pass independent source, geometry, PQ intent and emitted-JPEG measurements. Floating-DCT alternatives use the native JDCT_FLOAT encoder while retaining the existing sRGB base transfer. Earlier source-precision and integer-DCT failures remain recorded.',
              '- Single-layer PQ PNG16 and AVIF12 candidates independently decode the executed native HDR intent against the gain-map source reference. They explicitly request output depth and preserve source primaries. The native PNG inspection file is also included as a manual comparison; its presence alone never qualifies a separate conversion. Explicit SDR requests continue to select the authored base.',
              '- The retained native JPEG writer emits independently parsed ISO plus per-channel Android metadata. Android element-style XMP now encodes and independently reconstructs. The validated ISO source reader removes a source-evidence gap within its declared scope. The separate native libavif regeneration route still rejects ISO-only input. Fractional map-coordinate crops in the retained-map route remain explicit failures.',
              '- Same-transfer AVIF geometry operates in display-linear light with explicit alpha handling. Cover resizing filters before cropping. A separate native coverage resample normalizes image-edge weights to the unchanged independent reference. The declared required static and animated HDR AVIF requests have qualified file evidence; this does not extend to untested photographs or consumers.',
              '- Calibrated static and sequence-wide SDR tone/gamut controls pass. Eight-bit sRGB-transfer failures remain visible. Higher-depth and correctly declared gamma-2.2 candidates retain the same predeclared sdr-8 appearance ceiling and distinct case IDs. Qualified alternatives can satisfy matching product selectors; they never change a failed representation into a passing one. The gamma transfer must be interpreted correctly by each consumer.',
              '- Animated outputs retain separate checks for fully composed frames, unequal durations, repetition count and fractional alpha. Only the matching qualified representation can fulfill the requested animation and transparency selectors.',
              '- Every two-frame AVIF and APNG output also checks exact encoded-white stability where the independent references prove an unchanged source neighborhood. A one-code signal shift fails that control. Full-frame regional appearance and tone checks still apply.',
              '- Additional gamma-3.2 GIF candidates use native nearest rounding and retain the same SDR reference and fixed thresholds. Static AVIF/APNG cases have separate IDs from gamma-2.2 failures. Optional animated APNG-to-GIF cases preserve 300/700 ms timing and three total plays, encoded as two GIF repeats. Explicit binary coercion compares exact threshold decisions. Quantized half-alpha mismatches remain failed and record the reference, encoder-input and decoded values.',
              '- A further animated GIF candidate resamples alpha separately with native zimg and rounds to sixteen bits after each axis. Independent checks require identical RGB16 samples, intermediate alpha error within the existing PNG16 ceiling and exact final binary decisions. These candidates preserve the original SDR grade and keep the earlier half-alpha failures visible.',
              '- Static 16-bit HDR PNG sources have separate PQ/HLG, P3/Rec.2020 and alpha evidence for identity, contain, cover, fill, upscale and independently checked EXIF-8 orientation. Their source and HDR conversions use the unchanged stricter avif-12 appearance gates. Matching same-format identity requests are byte-exact controls. Six conflicting/unknown PNG signaling controls retain exact originals and withhold transforms.',
              '- Separate eight-bit PQ/HLG PNG sources use their own reviewed source hash lock. Their containment cases cover HDR PNG8/AVIF8 and explicit SDR PNG16/AVIF8. The direct-input failures remain recorded. A separate native zimg storage expansion must preserve every independently decoded RGBA sample exactly before conversion; it changes neither the reference intent nor the fixed output gates. The normalized candidate also covers crop, fill, upscale and real EXIF-8 orientation under the same gates. Eight separately hashed orientation sources require unchanged coded samples and an exact independent rotation check before resampling. Matching requests retain exact originals, and unknown CICP facts withhold transformations. Unlisted PNG8 geometries and formats remain untested.',
              '- Four animated RGBA16 APNG sources cover PQ/HLG and P3/Rec.2020 with full-canvas SOURCE frames, no disposal, 300/700 ms timing and three plays. An independent chunk reader verifies animation/color metadata and passes unchanged compressed frame data to native libpng. Contain, cover, fill, upscale and independently checked EXIF-8 orientation derivatives cover HDR APNG/AVIF and explicit SDR APNG/AVIF/WebP under unchanged gates. Four orientation sources have distinct hashes and every native rotation matches the independently decoded frames exactly. PQ uses one 4000-nit sequence peak; HLG uses its 1000-nit reference display. HDR APNG has CICP, SDR APNG has standard sRGB signaling, and SDR AVIF/WebP have gamma-2.2 CICP/ICC. Native SOURCE rectangles are independently reconstructed by exact RGBA replacement; out-of-bounds rectangles, partial default images, OVER blending and disposal remain rejected. Static extraction checks the first fully composed frame for HDR PNG/AVIF and SDR PNG/AVIF/WebP/JPEG/GIF at each tested geometry. JPEG opacity and GIF binary alpha require explicit coercion; preserve-alpha requests are rejected. The two original gamma-2.2 PQ static GIF orientation cases exceed the fixed shadow color-error ceiling and remain unqualified. The newer gamma-3.2 cases retain separate measurements and qualification. Unlisted APNG geometries remain untested.',
              '- Additional PNG8-to-HDR PNG16 and AVIF12 cases use the stricter existing avif-12 output gates across contain, cover, fill, upscale and real EXIF-8 orientation. Source quantization is measured separately. Native rotation must match the independently decoded original samples before geometry changes; alpha must remain within two codes at the actual output depth.',
              '- Separate PNG8-to-SDR WebP candidates cover containment, crop, stretch, upscale and real EXIF-8 orientation with both original and nearest-code quantization. They use the unchanged tone/gamut grade and gamma-2.2 ICC coding. The static VP8L reader checks dimensions, alpha signaling, metadata and chunk structure. Independent native FFmpeg decoding must match Pillow/libwebp and the actual encoder-input codes exactly. Nearest-code candidates must also match independently rounded input samples within half a code. Those exact storage checks do not replace appearance, tone or alpha thresholds.',
              '- One separately locked gain-map AVIF source has authored-SDR AVIF containment, crop, stretch and upscale candidates. Independent BMFF/tmap parsing, actual AV1 packet depth/signaling, dav1d samples and AOM candidate decoding establish the source base. Native metadata text repeats channel-zero gain values; the independently parsed per-channel fractions remain authoritative. Unknown color, depth, orientation or metadata withholds transformation and preserves exact originals. Nonidentity orientation remains original-only. The SDR result does not establish HDR qualification.',
              '- Additional authored-SDR PNG8 containment, crop, stretch and upscale candidates use the same gain-map AVIF base and unchanged photographic SDR reference. Their native sRGB/cHRM/gAMA signaling and square-pixel pHYs are independently parsed and cross-checked with ExifTool. Native libpng must recover every actual encoder-input RGB8 sample exactly. Appearance and privacy remain separate gates; source import error receives no additional allowance.',
              '- Gain-map AVIF HDR containment, crop, stretch and upscale each have two distinct native candidates against the same predeclared bilinear-map renderer convention. Original libavif source, linear-geometry and emitted-output failures remain recorded. The separate native antialiased-map and float32 gain candidate must pass all three unchanged appearance gates and independent single-layer PQ AVIF12 signaling, depth, opacity, square-pixel and privacy checks. Each input normalization is retained during PQ encoding. Its renderer convention is not claimed as a uniquely mandated ISO filter or as physical interoperability. Named source-reconstruction profiles are bound to the canonical fixture hash without changing the original SDR inspection facts.',
              '- Unlisted PNG/APNG cross-products, HDR WebP and other unexecuted accepted-source requests remain untested. Other gain-map AVIF selector and adaptation combinations remain unqualified. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.',
              '- These are proof-side selector and byte-delivery controls. Production endpoint integration, byte-free metadata persistence and generation-owned facts still need implementation tests; this suite does not claim those endpoints exist.',
              '- The fixtures include synthetic charts and the documented upstream gain-map corpus. Additional independent real-device photographs, gain-map depth/layout variants and wider motion/composition corpora remain coverage gaps.',
              '- Safari on the named Mac and iPad, Chrome on Windows/Galaxy, Firefox SDR fallbacks, downloaded files, native viewers and built-in wallpaper setters all remain pending user review. An OS that flattens HDR does not remove the HDR download; a usable SDR download still must qualify.', '',
              f'Prepared {len(manual)} inspected source/candidate files with hashes. Follow [the physical-device checklist](../MANUAL.md). No UI, migration, generation policy, caching, source-admission or production delivery behavior changed.', '',
              '## Suite integrity','',f'Proof-side controls: {len(controls.get("controls",[]))}. Unit tests run before native conversions. Evidence validation errors: {len(errors)}.']
    for error in errors:
        lines.append('- '+error)
    lines += ['', 'Policy authority: [HDR resolution](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153), [complete ledger](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681), [proof ticket](https://github.com/rafaeltab/wallpaperdb/issues/284), [delivery contract](https://github.com/rafaeltab/wallpaperdb/issues/250). Native algorithm references: [FFmpeg libplacebo filter](https://ffmpeg.org/ffmpeg-filters.html#libplacebo), [libplacebo options](https://libplacebo.org/options/), [libavif tools](https://github.com/AOMediaCodec/libavif/tree/v1.4.1/apps), [Sharp gain-map API](https://sharp.pixelplumbing.com/api-output/#keepgainmap).','']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--unit-only',action='store_true')
    parser.add_argument('--selectors-only',action='store_true')
    parser.add_argument('--update-fixture-lock',action='store_true')
    args = parser.parse_args()
    WORK.mkdir(exist_ok=True)
    RESULTS.mkdir(exist_ok=True)
    tests = unittest.defaultTestLoader.discover(str(ROOT), pattern='test_*.py')
    unit = unittest.TextTestRunner(verbosity=1).run(tests)
    if not unit.wasSuccessful():
        return 1
    if args.unit_only:
        return 0
    from selector_probes import run as run_selectors
    if args.selectors_only:
        value = run_selectors(WORK/'selectors')
        write_json(WORK/'selector-evidence.json',value)
        return 0 if all(c.get('status')=='passed' for c in value['controls']) else 2
    environment = versions()
    avif_result = avif.run(WORK/'avif')
    write_json(WORK/'avif-evidence.json',avif_result)
    from hdr_png import run as run_hdr_png
    png_result = run_hdr_png(WORK/'hdr-png')
    write_json(WORK/'hdr-png-evidence.json',png_result)
    from hdr_png8_proof import run as run_hdr_png8
    png8_result = run_hdr_png8(WORK/'hdr-png8', normalize_sources=True)
    write_json(WORK/'hdr-png8-evidence.json',png8_result)
    from hdr_png8_geometry import run as run_hdr_png8_geometry
    png8_geometry_result = run_hdr_png8_geometry(WORK/'hdr-png8-geometry')
    write_json(WORK/'hdr-png8-geometry-evidence.json',png8_geometry_result)
    from hdr_png8_precision import run as run_hdr_png8_precision
    png8_precision_result = run_hdr_png8_precision(WORK/'hdr-png8-precision',
        geometries=('contain', 'cover', 'fill', 'upscale', 'orientation'))
    write_json(WORK/'hdr-png8-precision-evidence.json',png8_precision_result)
    from hdr_png8_webp import run as run_hdr_png8_webp
    png8_webp_result = run_hdr_png8_webp(WORK/'hdr-png8-webp', nearest_quantization=True,
        geometries=('contain', 'cover', 'fill', 'upscale', 'orientation'))
    write_json(WORK/'hdr-png8-webp-evidence.json',png8_webp_result)
    from apng import run as run_apng
    apng_result = run_apng(WORK/'apng', animated_gif=True)
    write_json(WORK/'apng-evidence.json',apng_result)
    from precision import run as run_precision
    precision = run_precision(WORK, WORK/'precision')
    write_json(RESULTS/'precision.json', precision)
    from jpegli_proof import QUALITY_CORPUS, QUALITY_OPTIONS, run as run_jpegli
    jpegli_result = run_jpegli(WORK/'jpegli-base-experiment')
    write_json(RESULTS/'jpegli-base-experiment.json', jpegli_result)
    jpegli_quality_result = run_jpegli(WORK/'jpegli-quality-experiment',
                                     corpus=QUALITY_CORPUS, options=QUALITY_OPTIONS)
    write_json(RESULTS/'jpegli-quality-experiment.json', jpegli_quality_result)
    from mozjpeg_proof import LAMBDA_CORPUS, LAMBDA_OPTIONS, LAMBDAS, run as run_mozjpeg
    mozjpeg_result = run_mozjpeg(WORK/'mozjpeg-base-experiment')
    write_json(RESULTS/'mozjpeg-base-experiment.json', mozjpeg_result)
    mozjpeg_historical = run_mozjpeg(WORK/'mozjpeg-standard-huffman-experiment', optimized_huffman=False)
    write_json(RESULTS/'mozjpeg-standard-huffman-experiment.json', mozjpeg_historical)
    mozjpeg_lambdas = run_mozjpeg(WORK/'mozjpeg-lambda-experiment',
        corpus=LAMBDA_CORPUS, options=LAMBDA_OPTIONS, lambdas=LAMBDAS)
    write_json(RESULTS/'mozjpeg-lambda-experiment.json', mozjpeg_lambdas)
    from mozjpeg_diagnostics import run as run_mozjpeg_diagnosis
    mozjpeg_diagnosis = run_mozjpeg_diagnosis(WORK/'mozjpeg-coefficient-diagnosis', mozjpeg_result, mozjpeg_lambdas)
    write_json(RESULTS/'mozjpeg-coefficient-diagnosis.json', mozjpeg_diagnosis)
    from gainmap_avif_proof import run as run_gainmap_avif
    gainmap_avif_result = run_gainmap_avif(WORK/'gainmap-avif-authored-sdr',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-evidence.json', gainmap_avif_result)
    from gainmap_avif_png import run as run_gainmap_avif_png
    gainmap_avif_png_result = run_gainmap_avif_png(WORK/'gainmap-avif-authored-png',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-png-evidence.json', gainmap_avif_png_result)
    from gainmap_avif_webp import run as run_gainmap_avif_webp
    gainmap_avif_webp_result = run_gainmap_avif_webp(WORK/'gainmap-avif-authored-webp',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-webp-evidence.json', gainmap_avif_webp_result)
    from gainmap_avif_hdr import run as run_gainmap_avif_hdr
    gainmap_avif_hdr_result = run_gainmap_avif_hdr(WORK/'gainmap-avif-hdr-geometries',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-hdr-evidence.json', gainmap_avif_hdr_result)
    from gainmap_avif_hdr_png import run as run_gainmap_avif_hdr_png
    gainmap_avif_hdr_png_result = run_gainmap_avif_hdr_png(WORK/'gainmap-avif-hdr-png-geometries',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-hdr-png-evidence.json', gainmap_avif_hdr_png_result)
    from gainmap_avif_preserve import run as run_gainmap_avif_preserve
    gainmap_avif_preserve_result = run_gainmap_avif_preserve(WORK/'gainmap-avif-preserve',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-preserve-evidence.json', gainmap_avif_preserve_result)
    from gainmap_avif_jpeg import run as run_gainmap_avif_jpeg
    gainmap_avif_jpeg_result = run_gainmap_avif_jpeg(WORK/'gainmap-avif-jpeg',
        geometries=('contain', 'cover', 'fill', 'upscale'), gamma32_upscale=True)
    write_json(WORK/'gainmap-avif-jpeg-evidence.json', gainmap_avif_jpeg_result)
    from gainmap_avif_hdr_jpeg import run as run_gainmap_avif_hdr_jpeg
    gainmap_avif_hdr_jpeg_result = run_gainmap_avif_hdr_jpeg(WORK/'gainmap-avif-hdr-jpeg',
        geometries=('contain', 'cover', 'fill', 'upscale'))
    write_json(WORK/'gainmap-avif-hdr-jpeg-evidence.json', gainmap_avif_hdr_jpeg_result)
    from gainmap_avif_hdr_jpeg_headroom import run as run_gainmap_avif_hdr_jpeg_headroom
    gainmap_avif_hdr_jpeg_headroom_result = run_gainmap_avif_hdr_jpeg_headroom(WORK/'gainmap-avif-hdr-jpeg-boost2')
    write_json(WORK/'gainmap-avif-hdr-jpeg-boost2-evidence.json', gainmap_avif_hdr_jpeg_headroom_result)
    from gainmap_avif_separate_map import run as run_gainmap_avif_separate_map
    gainmap_avif_separate_map_result = run_gainmap_avif_separate_map(WORK/'gainmap-avif-separate-map')
    write_json(WORK/'gainmap-avif-separate-map-evidence.json', gainmap_avif_separate_map_result)
    from gainmap_avif_identity_jpeg import run as run_gainmap_avif_identity_jpeg
    gainmap_avif_identity_jpeg_result = run_gainmap_avif_identity_jpeg(WORK/'gainmap-avif-identity-jpeg')
    write_json(WORK/'gainmap-avif-identity-jpeg-evidence.json', gainmap_avif_identity_jpeg_result)
    from gainmap_avif_gif import run as run_gainmap_avif_gif
    gainmap_avif_gif_result = run_gainmap_avif_gif(WORK/'gainmap-avif-gif')
    write_json(WORK/'gainmap-avif-gif-evidence.json', gainmap_avif_gif_result)
    gainmap_avif_gif_liq = run_gainmap_avif_gif(WORK/'gainmap-avif-gif-libimagequant', palette='libimagequant')
    write_json(WORK/'gainmap-avif-gif-libimagequant-evidence.json', gainmap_avif_gif_liq)
    gainmap_avif_gif_gamma32 = run_gainmap_avif_gif(WORK/'gainmap-avif-gif-gamma32', palette='libimagequant-gamma32')
    write_json(WORK/'gainmap-avif-gif-gamma32-evidence.json', gainmap_avif_gif_gamma32)
    from icc_gainmap import run as run_icc_gainmap
    icc_results = []
    for policy, gamma, method in (('moderateoffset', 1, 'float'), ('smalloffset', 1, 'float'),
                                  ('smalloffset', 2, 'float'), ('midpointoffset', 2, 'float'),
                                  ('midpointoffset', 2, 'islow'), ('midpointoffset', 1.5, 'float')):
        name = f'icc-gainmap-{policy}'+(f'-gamma{gamma:g}' if gamma != 1 else '')
        name += '-islow' if method == 'islow' else ''
        result = run_icc_gainmap(WORK/name, map_policy=policy, map_gamma=gamma, map_method=method)
        write_json(RESULTS/f'{name}.json', result)
        icc_results.extend(result['cases'])
    xmp_icc = run_icc_gainmap(WORK/'icc-gainmap-xmp-midpointoffset-gamma1.5',
        source_id='gainmap-android-xmp', map_policy='midpointoffset', map_gamma=1.5)
    write_json(RESULTS/'icc-gainmap-xmp-midpointoffset-gamma1.5.json', xmp_icc)
    icc_results.extend(xmp_icc['cases'])
    for source_id in ('gainmap-apple-old', 'gainmap-apple-new'):
        for operation in ('contain', 'upscale'):
            name = f'icc-{source_id}-{operation}-midpointoffset-gamma1.5'
            result = run_icc_gainmap(WORK/name, source_id=source_id, operation=operation,
                map_policy='midpointoffset', map_gamma=1.5)
            write_json(RESULTS/f'{name}.json', result)
            icc_results.extend(result['cases'])
    name = 'icc-gainmap-apple-new-upscale-midpointoffset-gamma1.5-islow'
    result = run_icc_gainmap(WORK/name, source_id='gainmap-apple-new', operation='upscale',
        map_policy='midpointoffset', map_gamma=1.5, map_method='islow')
    write_json(RESULTS/f'{name}.json', result)
    icc_results.extend(result['cases'])
    name = 'icc-gainmap-apple-new-upscale-midpointoffset-gamma1.5-float-base'
    result = run_icc_gainmap(WORK/name, source_id='gainmap-apple-new', operation='upscale',
        map_policy='midpointoffset', map_gamma=1.5, base_method='float')
    write_json(RESULTS/f'{name}.json', result)
    icc_results.extend(result['cases'])
    from iso_intermediate_headroom import run as run_iso_intermediate
    iso_intermediate = run_iso_intermediate(WORK/'iso-intermediate-boost2')
    write_json(RESULTS/'iso-intermediate-boost2.json', iso_intermediate)
    icc_results.extend(iso_intermediate['cases'])
    iso_full_headroom = run_iso_intermediate(WORK/'iso-full-headroom-boost64', display_boost=64)
    write_json(RESULTS/'iso-full-headroom-boost64.json', iso_full_headroom)
    icc_results.extend(iso_full_headroom['cases'])
    from iso_full_headroom_candidate import run as run_iso_full_source
    iso_full_source = run_iso_full_source(WORK/'iso-full-source-candidate')
    write_json(RESULTS/'iso-full-source-candidate.json', iso_full_source)
    icc_results.extend(iso_full_source['cases'])
    from iso_source_capacity import run as run_iso_source_capacity
    iso_source_capacity = run_iso_source_capacity(WORK/'iso-source-capacity')
    write_json(RESULTS/'iso-source-capacity.json', iso_source_capacity)
    icc_results.extend(iso_source_capacity['cases'])
    from iso_geometry_headroom import run as run_iso_geometry_headroom
    iso_geometry_headroom = run_iso_geometry_headroom(WORK/'iso-geometry-headroom')
    write_json(RESULTS/'iso-geometry-headroom.json', iso_geometry_headroom)
    icc_results.extend(iso_geometry_headroom['cases'])
    gainmap_result = gainmap.run(WORK)
    from authored_sdr_proof import run as run_authored_sdr
    authored_sdr_result = run_authored_sdr(WORK/'authored-sdr', formats=('jpg','avif','png','webp'))
    write_json(WORK/'authored-sdr-evidence.json',authored_sdr_result)
    from combined_gainmap_proof import run as run_combined_gainmap
    combined_gainmap_result = run_combined_gainmap(WORK/'combined-gainmap')
    combined_gainmap_result += run_combined_gainmap(WORK/'combined-gainmap-dct',
                                                   policies=('moderateoffset',), coding='dct-rgb')
    combined_gainmap_result += run_combined_gainmap(WORK/'combined-gainmap-dct-float',
                                                   policies=('moderateoffset',), coding='dct-float-rgb')
    combined_gainmap_result += run_combined_gainmap(WORK/'combined-gainmap-jpegli',
        policies=('moderateoffset',), coding='jpegli-base-dct-float-map')
    combined_gainmap_result += run_combined_gainmap(WORK/'combined-gainmap-mozjpeg',
        names=('gainmap-android-iso',), geometries=('cover',),
        policies=('moderateoffset',), coding='mozjpeg-base-dct-float-map')
    combined_gainmap_result += run_combined_gainmap(WORK/'combined-iso-float32',
        names=('gainmap-android-iso',), policies=('moderateoffset',), source_precision='float32')
    write_json(WORK/'combined-gainmap-evidence.json',combined_gainmap_result)
    from gainmap_crossformat import run as run_gainmap_crossformat
    gainmap_crossformat_result = run_gainmap_crossformat(WORK/'gainmap-crossformat', combined_gainmap_result)
    write_json(WORK/'gainmap-crossformat-evidence.json', gainmap_crossformat_result)
    from crossformat import run as run_crossformat
    crossformat_result = run_crossformat(WORK)
    from tone_probes import run as run_tone
    tone = run_tone(WORK)
    controls = run_selectors(WORK/'selectors')
    controls['controls'].extend(png_result['controls'])
    controls['controls'].extend(png8_result['controls'])
    controls['controls'].extend(gainmap_avif_result['controls'])
    controls['controls'].extend(gainmap_avif_png_result['controls'])
    controls['controls'].extend(gainmap_avif_webp_result['controls'])
    controls['controls'].extend(gainmap_avif_hdr_result['controls'])
    controls['controls'].extend(gainmap_avif_hdr_png_result['controls'])
    controls['controls'].extend(gainmap_avif_preserve_result['controls'])
    controls['controls'].extend(gainmap_avif_jpeg_result['controls'])
    controls['controls'].extend(gainmap_avif_hdr_jpeg_result['controls'])
    controls['controls'].extend(gainmap_avif_hdr_jpeg_headroom_result['controls'])
    controls['controls'].extend(gainmap_avif_separate_map_result['controls'])
    controls['controls'].extend(gainmap_avif_identity_jpeg_result['controls'])
    controls['controls'].extend(gainmap_avif_gif_result['controls'])
    controls['controls'].extend(gainmap_avif_gif_liq['controls'])
    controls['controls'].extend(gainmap_avif_gif_gamma32['controls'])
    controls['controls'].extend(apng_result['controls'])
    evidence = avif_result['evidence'] + png_result['evidence'] + png8_result['evidence'] + png8_geometry_result['evidence'] + png8_precision_result['evidence'] + png8_webp_result['evidence'] + gainmap_avif_result['evidence'] + gainmap_avif_png_result['evidence'] + gainmap_avif_hdr_result['evidence'] + gainmap_avif_hdr_png_result['evidence'] + icc_results + apng_result['evidence'] + gainmap_result['cases'] + authored_sdr_result + combined_gainmap_result + gainmap_crossformat_result + crossformat_result + controls.get('evidence',[])
    evidence += gainmap_avif_webp_result['evidence']
    evidence += gainmap_avif_preserve_result['evidence']
    evidence += gainmap_avif_jpeg_result['evidence']
    evidence += gainmap_avif_hdr_jpeg_result['evidence']
    evidence += gainmap_avif_hdr_jpeg_headroom_result['evidence']
    evidence += gainmap_avif_separate_map_result['evidence']
    evidence += gainmap_avif_identity_jpeg_result['evidence']
    evidence += gainmap_avif_gif_result['evidence']
    evidence += gainmap_avif_gif_liq['evidence']
    evidence += gainmap_avif_gif_gamma32['evidence']
    locked_fixtures = avif_result['fixtures'] + png_result['fixtures'] + apng_result['fixtures'] + controls.get('fixtures',[])
    # PNG8 validates its separate source lock before any conversion. Preserve
    # the original generated corpus lock, including its PNG16 hashes.
    generated_fixtures = locked_fixtures + png8_result['fixtures'] + png8_geometry_result['fixtures'] + gainmap_avif_result['source_fixtures']
    generated_fixtures = merge_reconstruction_profiles(generated_fixtures, gainmap_avif_hdr_result['source_fixtures'])
    fixtures = generated_fixtures + gainmap_result['fixtures']
    matrix = build_matrix(evidence)
    errors = matrix['evidence_errors'] + fixture_lock(locked_fixtures,args.update_fixture_lock)
    matrix['selector_control_failures'] = [c['case_id'] for c in controls.get('controls',[]) if c.get('status')!='passed']
    matrix['suite_integrity_errors'] = errors
    matrix['native_run_completed'] = True
    matrix['unit_tests'] = {'run':unit.testsRun,'failures':len(unit.failures),'errors':len(unit.errors)}
    write_json(RESULTS/'native-versions.json',environment)
    write_json(RESULTS/'fixtures.json',fixtures)
    write_json(RESULTS/'measurements.json',{'cases':evidence, 'tone_controls':tone,'selector_controls':controls})
    for cell in matrix['cells']:
        for key in ('evidence','qualified_cases'):
            cell[key] = [{field:item[field] for field in ('case_id','fixture_id','selectors','status','checks','blockers','diagnostics','source_reference_revision') if field in item} | {'measurements_file':'measurements.json','measurement_case_id':item['case_id']} for item in cell[key]]
    write_json(RESULTS/'conversion-matrix.json',matrix)
    write_json(RESULTS/'commands.json',{'avif_and_controls':avif.COMMANDS, 'gainmap_log_files':[str(p.relative_to(ROOT)) for p in (WORK/'gainmap').rglob('*.log')], 'native_gainmap_commands':[{'path':str(p.relative_to(ROOT)), 'commands':json.loads(p.read_text())} for p in sorted(WORK.rglob('native-commands.json'))], 'gainmap_logs':[{ 'path':str(p.relative_to(ROOT)), 'text':p.read_text(errors='replace')} for p in sorted(WORK.rglob('native-encoder*.log'))]})
    manual = candidate_files(evidence,generated_fixtures)
    (RESULTS/'report.md').write_text(render_report(matrix,evidence,fixtures,tone,controls,environment,errors,manual,precision,jpegli_result,jpegli_quality_result,mozjpeg_result,mozjpeg_historical,mozjpeg_lambdas,mozjpeg_diagnosis))
    counts = Counter(case['status'] for case in evidence)
    print(json.dumps({'completed':True,'native_cases':len(evidence),'case_statuses':counts,'integrity_errors':errors,'milestone_qualified':False,'report':'hdr-proof/results/report.md'},indent=2))
    return 1 if errors else 2


if __name__ == '__main__':
    sys.exit(main())
