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
from matrix import build_matrix, required_cases

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
    def copy(source, name, role, case=None, facts=None):
        source = Path(source)
        if not source.exists():
            return
        destination = manual/name
        shutil.copyfile(source,destination)
        entries.append({'file': name, 'sha256':avif.digest(destination), 'role':role,
                        'case_id':case.get('case_id') if case else None,
                        'codec_status':case.get('status') if case else 'source reference, not a conversion qualification',
                        'consumer_status':'pending manual review', 'facts':facts or (case.get('facts') if case else None),
                        'warning':'A failed candidate is a diagnostic comparison, not an approved download or SDR fallback.' if case and case['status']!='qualified' else None})
    for fixture in fixtures:
        spec = fixture.get('spec')
        if spec and (spec['depth']==10 or spec['frames']==2):
            copy(fixture['path'], f'source-{fixture["id"]}.avif', 'Inspected synthetic HDR source', facts=fixture['facts'])
    for source in (ROOT/'fixtures/gainmap').glob('*.jpg'):
        copy(source,f'source-{source.name}','Provenance-documented gain-map source; exact original')
    selected = [case for case in evidence if (case.get('fixture_id') in ('avif-pq-rec2020-10-opaque','avif-hlg-rec2020-10-opaque','animated-pq-alpha') and case.get('geometry') in ('contain','identity')) or (case.get('fixture_id') in ('gainmap-apple-new','gainmap-android-xmp') and case.get('geometry')=='contain')]
    for case in selected:
        artifacts = case.get('artifacts')
        values = [artifacts.get('output')] if isinstance(artifacts,dict) else artifacts or []
        for value in values[:1]:
            if not value:
                continue
            source = artifact_path(value)
            suffix = source.suffix
            if suffix not in ('.jpg','.avif','.png','.webp','.gif'):
                continue
            name = re.sub(r'[^a-zA-Z0-9_-]','-',case['case_id'])+suffix
            copy(source,name,'Inspected native conversion candidate',case=case)
        reference = case.get('reference_sdr')
        if reference:
            name = re.sub(r'[^a-zA-Z0-9_-]','-',case['case_id'])+'-reference-sdr.png'
            copy(artifact_path(reference['path']),name,'Independent matched-geometry authored SDR reference',facts={'reference_sha256':reference['sha256'],'case_id':case['case_id']})
    write_json(manual/'manifest.json',{'status':'pending manual review','files':entries})
    return entries


def fixture_lock(fixtures, update):
    generated = {f['id']:f['sha256'] for f in fixtures if f.get('spec') or f.get('generator')}
    path = ROOT/'fixtures/generated-sha256.json'
    if update:
        write_json(path,{'generator':'avif.py; native versions locked by environment/ and Dockerfile', 'sha256':generated})
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


def render_report(matrix, evidence, fixtures, tone, controls, native_versions, errors, manual):
    counts = Counter(case['status'] for case in evidence)
    cell_counts = Counter(cell['status'] for cell in matrix['cells'] if cell['in_hdr_ledger'])
    lines = ['# HDR conversion proof results','',
             'The HDR milestone remains blocked. Automated codec results do not qualify browser HDR presentation, native viewers, or OS wallpaper setters. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.','',
             'Reproduce from the repository root with `make run PACKAGE=media SCRIPT=proof:hdr`. Docker must support linux/amd64. The default command returns exit 2 while required codec cases or physical checks are unqualified. This is an intentional qualification failure, not a passing release gate.','',
             f'Executed {len(evidence)} native conversion cases over {len(fixtures)} fixture records. Case outcomes: '+', '.join(f'{value} {key}' for key,value in sorted(counts.items()))+'.',
             f'The inventory covers {matrix["ledger_cell_count"]} HDR-ledger cells and {matrix["generic_sdr_control_count"]} labeled SDR controls. Ledger outcomes: '+', '.join(f'{value} {key}' for key,value in sorted(cell_counts.items()))+'.','',
             f'The finite required plan contains {matrix["required_case_count"]} cases. Unexecuted required cases: {sum(len(cell["missing_cases"]) for cell in matrix["cells"])}. Unlisted cross-products are untested, even when a neighboring case passes.','',
             '## Environment and reproducibility','',
             'The image uses the same Node 22 Alpine/musl deployment shape as Media. This is a proposed native proof pipeline, not the existing Sharp 0.33 production worker. No service dependency was upgraded. CPU lavapipe runs libplacebo without a host GPU. Network access is disabled during tests.','',
             f'- Node: `{native_versions["node"]}`',
             f'- AVIF tools: `{native_versions["avif"].splitlines()[0]}`',
             f'- FFmpeg: `{native_versions["ffmpeg"].splitlines()[0]}`',
             f'- ExifTool: `{native_versions["exiftool"]}`',
             f'- Fixed threshold file SHA-256: `{native_versions["thresholds_sha256"]}`','',
             'The base image is pinned by digest. Every additional APK is pinned by URL and SHA-256, the full package inventory is checked, npm uses its integrity lock, and native source archives have checked hashes. See [native versions](native-versions.json), [dependency locks](../environment/), [commands](commands.json), [fixture facts and hashes](fixtures.json), and [generator hashes](../fixtures/generated-sha256.json).','',
             '## How to read the evidence','',
             'A qualified case requires a real encoder, a separate decoder, exact structural checks, fixed appearance thresholds, and metadata privacy. Independent AV1 decoding uses dav1d, while encoding uses AOM. ExifTool independently reads emitted signaling. Other decoder limitations remain explicit blockers. ISO gain-map calculations supplement the measurements but do not replace an unavailable maintained independent ISO reader.','',
             'All comparisons use display-referred linear light. PQ uses ST 2084 absolute luminance. HLG uses a declared 1000-nit reference display and gamma 1.2 OOTF. Geometry references use independent Pillow floating-point bilinear resampling with premultiplied alpha. The comparison includes patch boundaries; interpolation differences are measured rather than hidden by discarding edges. These synthetic charts stress conversion and do not represent every photographic or artistic source.','',
             'The predeclared [thresholds](../thresholds.json) report BT.2124 Delta E ITP and luminance error separately for shadows, midtones, and highlights. Best-effort SDR additionally requires 203-nit ordinary white near 0.90 sRGB signal, retained shadows/midtones, smooth highlight detail, and an independent chromatic mapping reference. Merely selecting libplacebo perceptual gamut mapping does not satisfy that last gate. Authored JPEG SDR bases bypass automatic HDR tone mapping.','',
             'Read [measurements](measurements.json) for each case, including native failures, facts, region statistics, source/output hashes and artifact paths. Full artifacts remain under `../work/` after a run; selected inspected files are committed under [manual](manual/manifest.json). Failed candidates are diagnostic files, not approved fallbacks.','',
             '## Required and candidate paths','',
             '| Source family | Range | Output | Policy | Automated status | Missing required cases |',
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
    lines += ['', 'The tunable Mobius and Reinhard trials use maintained native functions with fixed parameters. Their failures do not change the white target. Adaptive peak detection is disabled in the candidate conversion path; separate controls record frame-to-frame white shifts and repeat hashes with it enabled and disabled. Persistent temporal-filter history is not qualified by these per-frame trials.', '', '## Blockers and scope limits','',
              '- Apple gain-map retention on musl must preserve the authored base and reconstructed HDR together. Native failure or measured regeneration drift remains a blocker.',
              '- ISO-only output needs a maintained independent reconstruction path and validated ISO plus Android metadata. A test-only reconstruction equation cannot certify interoperability.',
              '- Same-transfer AVIF geometry must meet the fixed regional appearance and alpha gates for every required depth/gamut/transfer combination. Native interpolation differences, orientation failures and any source-validation failures stay visible in the case results.',
              '- HDR-only SDR outputs need a controlled native tone-map configuration meeting the ordinary-white, shadow, highlight and gamut-reference checks. The tested BT.2446A and tunable trials are not accepted automatically.',
              '- Animated outputs need exact fully composed frames, unequal durations, repetition count and fractional alpha. Failed animation or alpha cases remain required blockers.',
              '- Unexecuted optional HDR PNG/APNG, HDR WebP, gain-map AVIF and other accepted-source rows remain untested. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.',
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
    gainmap_result = gainmap.run(WORK)
    from crossformat import run as run_crossformat
    crossformat_result = run_crossformat(WORK)
    from tone_probes import run as run_tone
    tone = run_tone(WORK)
    controls = run_selectors(WORK/'selectors')
    evidence = avif_result['evidence'] + gainmap_result['cases'] + crossformat_result + controls.get('evidence',[])
    fixtures = avif_result['fixtures'] + gainmap_result['fixtures'] + controls.get('fixtures',[])
    matrix = build_matrix(evidence)
    errors = matrix['evidence_errors'] + fixture_lock(avif_result['fixtures']+controls.get('fixtures',[]),args.update_fixture_lock)
    matrix['selector_control_failures'] = [c['case_id'] for c in controls.get('controls',[]) if c.get('status')!='passed']
    matrix['suite_integrity_errors'] = errors
    matrix['native_run_completed'] = True
    matrix['unit_tests'] = {'run':unit.testsRun,'failures':len(unit.failures),'errors':len(unit.errors)}
    write_json(RESULTS/'native-versions.json',environment)
    write_json(RESULTS/'fixtures.json',fixtures)
    write_json(RESULTS/'measurements.json',{'cases':evidence, 'tone_controls':tone,'selector_controls':controls})
    for cell in matrix['cells']:
        for key in ('evidence','qualified_cases'):
            cell[key] = [{field:item[field] for field in ('case_id','fixture_id','selectors','status','checks','blockers') if field in item} | {'measurements_file':'measurements.json','measurement_case_id':item['case_id']} for item in cell[key]]
    write_json(RESULTS/'conversion-matrix.json',matrix)
    write_json(RESULTS/'commands.json',{'avif_and_controls':avif.COMMANDS, 'gainmap_log_files':[str(p.relative_to(ROOT)) for p in (WORK/'gainmap').rglob('*.log')], 'gainmap_logs':[{ 'path':str(p.relative_to(ROOT)), 'text':p.read_text(errors='replace')} for p in sorted(WORK.rglob('native-encoder*.log'))]})
    manual = candidate_files(evidence,avif_result['fixtures'])
    (RESULTS/'report.md').write_text(render_report(matrix,evidence,fixtures,tone,controls,environment,errors,manual))
    counts = Counter(case['status'] for case in evidence)
    print(json.dumps({'completed':True,'native_cases':len(evidence),'case_statuses':counts,'integrity_errors':errors,'milestone_qualified':False,'report':'hdr-proof/results/report.md'},indent=2))
    return 1 if errors else 2


if __name__ == '__main__':
    sys.exit(main())
