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
                   'libavif_local_patch_sha256':avif.digest(ROOT/'libavif-sequence-transform.patch'),
                   'avifenc_binary_sha256':avif.digest(Path('/usr/local/bin/avifenc')),
                   'libultrahdr_build_recipe_sha256':avif.digest(ROOT/'native-gainmap-build.sh'),
                   'libultrahdr_xmp_patch_sha256':avif.digest(ROOT/'libultrahdr-xmp-arrays.patch'),
                   'independent_iso_reader_sha256':avif.digest(ROOT/'gainmap_iso.py'),
                   'libultrahdr_variant_binaries':Path('/opt/proof/ultrahdr/binary-sha256.txt').read_text(),
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
        if spec and (spec['depth'] in (10,16) or spec['frames']==2):
            suffix = Path(fixture['path']).suffix
            copy(fixture['path'], f'source-{fixture["id"]}{suffix}', 'Inspected synthetic HDR source', facts=fixture['facts'])
    for source in (ROOT/'fixtures/gainmap').glob('*.jpg'):
        copy(source,f'source-{source.name}','Provenance-documented gain-map source; exact original')
    selected = [case for case in evidence if (case.get('fixture_id') in ('avif-pq-rec2020-10-opaque','avif-hlg-rec2020-10-opaque','animated-pq-alpha','png-pq-rec2020-16-alpha','png-hlg-p3-16-opaque') and case.get('geometry') in ('contain','identity')) or (case.get('fixture_id') in ('gainmap-apple-new','gainmap-android-xmp') and case.get('geometry')=='contain')]
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
        write_json(path,{'generator':'avif.py, hdr_png.py and selector_probes.py; native versions locked by environment/ and Dockerfile', 'sha256':generated})
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
    lines += ['', 'These counts cover the declared corpus only. A ledger cell can retain failed exact-selector candidates while its required product requests have qualified alternatives. Consumer review and a usable SDR wallpaper download remain separate requirements. The original fixed-plan outcomes below remain visible.', '']
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


def render_report(matrix, evidence, fixtures, tone, controls, native_versions, errors, manual, precision):
    counts = Counter(case['status'] for case in evidence)
    cell_counts = Counter(cell['status'] for cell in matrix['cells'] if cell['in_hdr_ledger'])
    stages = matrix['diagnostic_summary']['all_cases']
    lines = ['# HDR conversion proof results','',
             'The HDR milestone remains blocked. Automated codec results do not qualify browser HDR presentation, native viewers, or OS wallpaper setters. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.','',
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
             'All comparisons use display-referred linear light. PQ uses ST 2084 absolute luminance. HLG uses a declared 1000-nit reference display and gamma 1.2 OOTF. Geometry references use independent Pillow floating-point bilinear resampling with premultiplied alpha. The comparison includes patch boundaries; interpolation differences are measured rather than hidden by discarding edges. These synthetic charts stress conversion and do not represent every photographic or artistic source.','',
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
    lines += ['', 'The tunable Mobius and Reinhard trials use maintained native functions with fixed parameters. Their failures do not change the white target. Adaptive peak detection is disabled in the candidate conversion path; separate controls record frame-to-frame white shifts and repeat hashes with it enabled and disabled. Persistent temporal-filter history is not qualified by these per-frame trials.', '', '## Blockers and scope limits','',
              '- The pinned Apple fixes remove the retained-layer encoding error and correct new-Apple headroom. Required Apple geometries now encode and independently decode, but regional SDR-base and HDR reconstruction errors still exceed the fixed limits. Resampling the base and logarithmic map separately does not commute with resizing reconstructed HDR in linear light. Native regeneration against the retained authored base is also measured, with separate libultrahdr and libavif source decoders. These alternatives still exceed appearance limits and remain unqualified.',
              '- The retained native JPEG writer emits independently parsed ISO plus per-channel Android metadata. Android element-style XMP now encodes and independently reconstructs. The validated ISO source reader removes a source-evidence gap within its declared scope. The separate native libavif regeneration route still rejects ISO-only input. Fractional map-coordinate crops in the retained-map route remain explicit failures.',
              '- Same-transfer AVIF geometry operates in display-linear light with explicit alpha handling. Cover resizing filters before cropping. A separate native coverage resample normalizes image-edge weights to the unchanged independent reference. The declared required static and animated HDR AVIF requests have qualified file evidence; this does not extend to untested photographs or consumers.',
              '- Calibrated static and sequence-wide SDR tone/gamut controls pass. Eight-bit sRGB-transfer failures remain visible. Higher-depth and correctly declared gamma-2.2 candidates retain the same predeclared sdr-8 appearance ceiling and distinct case IDs. Qualified alternatives can satisfy matching product selectors; they never change a failed representation into a passing one. The gamma transfer must be interpreted correctly by each consumer.',
              '- Animated outputs retain separate checks for fully composed frames, unequal durations, repetition count and fractional alpha. Only the matching qualified representation can fulfill the requested animation and transparency selectors.',
              '- Static 16-bit HDR PNG sources have separate PQ/HLG, P3/Rec.2020 and alpha evidence for identity and contain. Their source and HDR conversions use the unchanged stricter avif-12 appearance gates. Matching same-format identity requests are byte-exact controls. APNG, unlisted PNG geometries, HDR WebP, gain-map AVIF and other unexecuted accepted-source requests remain untested. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.',
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
    from precision import run as run_precision
    precision = run_precision(WORK, WORK/'precision')
    write_json(RESULTS/'precision.json', precision)
    gainmap_result = gainmap.run(WORK)
    from crossformat import run as run_crossformat
    crossformat_result = run_crossformat(WORK)
    from tone_probes import run as run_tone
    tone = run_tone(WORK)
    controls = run_selectors(WORK/'selectors')
    controls['controls'].extend(png_result['controls'])
    evidence = avif_result['evidence'] + png_result['evidence'] + gainmap_result['cases'] + crossformat_result + controls.get('evidence',[])
    generated_fixtures = avif_result['fixtures'] + png_result['fixtures'] + controls.get('fixtures',[])
    fixtures = generated_fixtures + gainmap_result['fixtures']
    matrix = build_matrix(evidence)
    errors = matrix['evidence_errors'] + fixture_lock(generated_fixtures,args.update_fixture_lock)
    matrix['selector_control_failures'] = [c['case_id'] for c in controls.get('controls',[]) if c.get('status')!='passed']
    matrix['suite_integrity_errors'] = errors
    matrix['native_run_completed'] = True
    matrix['unit_tests'] = {'run':unit.testsRun,'failures':len(unit.failures),'errors':len(unit.errors)}
    write_json(RESULTS/'native-versions.json',environment)
    write_json(RESULTS/'fixtures.json',fixtures)
    write_json(RESULTS/'measurements.json',{'cases':evidence, 'tone_controls':tone,'selector_controls':controls})
    for cell in matrix['cells']:
        for key in ('evidence','qualified_cases'):
            cell[key] = [{field:item[field] for field in ('case_id','fixture_id','selectors','status','checks','blockers','diagnostics') if field in item} | {'measurements_file':'measurements.json','measurement_case_id':item['case_id']} for item in cell[key]]
    write_json(RESULTS/'conversion-matrix.json',matrix)
    write_json(RESULTS/'commands.json',{'avif_and_controls':avif.COMMANDS, 'gainmap_log_files':[str(p.relative_to(ROOT)) for p in (WORK/'gainmap').rglob('*.log')], 'native_gainmap_commands':[{'path':str(p.relative_to(ROOT)), 'commands':json.loads(p.read_text())} for p in sorted(WORK.rglob('native-commands.json'))], 'gainmap_logs':[{ 'path':str(p.relative_to(ROOT)), 'text':p.read_text(errors='replace')} for p in sorted(WORK.rglob('native-encoder*.log'))]})
    manual = candidate_files(evidence,generated_fixtures)
    (RESULTS/'report.md').write_text(render_report(matrix,evidence,fixtures,tone,controls,environment,errors,manual,precision))
    counts = Counter(case['status'] for case in evidence)
    print(json.dumps({'completed':True,'native_cases':len(evidence),'case_statuses':counts,'integrity_errors':errors,'milestone_qualified':False,'report':'hdr-proof/results/report.md'},indent=2))
    return 1 if errors else 2


if __name__ == '__main__':
    sys.exit(main())
