"""Read-only evidence for the six remaining SOF0 shadow-precision failures."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_sdr
from appearance import (compare_appearance, delta_e_itp, RGB_TO_XYZ,
                        sdr_signal_to_nits, THRESHOLDS, THRESHOLDS_SHA256)
from mozjpeg_proof import LAMBDA_CORPUS

HELPER = Path('/usr/local/bin/hdr-proof-jpeg-coefficients')


def coefficients(path, point, reference_point):
    coordinates = (*point, *reference_point)
    if len(coordinates) != 4 or any(type(value) is not int or not 0 <= value <= 4095 for value in coordinates):
        raise ValueError('Coefficient coordinates must be bounded nonnegative integers')
    return json.loads(avif.native([HELPER, path, *map(str, coordinates)]))


def _validate(case, fixtures):
    if case['source_sha256'] != fixtures[case['fixture_id']]['sha256']:
        raise ValueError('Diagnostic source fixture hash mismatch')
    if case['gamut'] != fixtures[case['fixture_id']]['expected']['gamut']:
        raise ValueError('Diagnostic source gamut mismatch')
    output = Path(case['artifacts']['output'])
    if gainmap.digest(output) != case['artifacts']['sha256']:
        raise ValueError('Diagnostic output hash mismatch')
    reference = Path(case['reference_sdr']['path'])
    if gainmap.digest(reference) != case['reference_sdr']['sha256']:
        raise ValueError('Diagnostic reference hash mismatch')
    authored = output.parent/'native-authored.png'
    if gainmap.digest(authored) != case['native_candidate']['input_sha256']:
        raise ValueError('Diagnostic native input hash mismatch')
    if not all(case['checks'].get(key) for key in ('native_encoder', 'independent_decoder',
                'coded_structure', 'dimensions', 'color', 'orientation', 'privacy')):
        raise ValueError('Diagnostic input did not pass native file and decoder checks')


def _pixels(case):
    with Image.open(case['reference_sdr']['path']) as image:
        reference = np.array(image)
    with Image.open(Path(case['artifacts']['output']).parent/'native-authored.png') as image:
        authored = np.array(image)
    actual, facts = gainmap_sdr.decode(Path(case['artifacts']['output']), gamut=case['gamut'])
    actual = np.rint(actual*255).astype(np.uint8)
    if (reference.dtype != np.uint8 or authored.dtype != np.uint8 or reference.ndim != 3
            or reference.shape[2] != 3 or actual.shape != reference.shape or authored.shape != reference.shape
            or facts['depth'] != 8 or facts['sof'] != 0):
        raise ValueError('Diagnostic images must have matched RGB8 geometry and SOF0 coding')
    linear = sdr_signal_to_nits(reference/255)
    difference = delta_e_itp(linear, sdr_signal_to_nits(actual/255),
                            reference_gamut=case['gamut'], actual_gamut=case['gamut'])
    return reference, authored, actual, linear, difference


def run(directory, baseline_report, lambda_report, *, corpus=LAMBDA_CORPUS):
    if not corpus or any(item not in LAMBDA_CORPUS for item in corpus):
        raise ValueError('Coefficient diagnosis is bounded to the six declared remaining cases')
    start = len(avif.COMMANDS)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    fixtures = {item['id']: item for item in json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures']}
    selected = {}
    for fixture, geometry in corpus:
        original = [case for case in baseline_report['cases'] if case['fixture_id'] == fixture
                    and case['geometry'] == geometry and not case['options']['deringing']]
        higher = [case for case in lambda_report['cases'] if case['fixture_id'] == fixture
                  and case['geometry'] == geometry and case['options']['lambda_scale1'] != 14.75]
        if len(original) != 4 or len(higher) != 4:
            raise ValueError('Diagnosis needs all four original profiles and four higher-lambda profiles')
        if ({(c['options']['method'], c['options']['trellis']) for c in original}
                != {(method, trellis) for method in ('islow', 'float') for trellis in (False, True)}
                or {(c['options']['method'], c['options']['lambda_scale1']) for c in higher}
                != {(method, scale) for method in ('islow', 'float') for scale in (18.75, 22.75)}
                or any(not c['options']['trellis'] or c['options']['deringing'] for c in higher)
                or any(c['options'].get('lambda_scale1', 14.75) != 14.75 for c in original)
                or any(not c['options']['optimized_huffman']
                       or c['options'].get('lambda_scale2', 16.5) != 16.5 for c in original+higher)):
            raise ValueError('Diagnostic native option profiles do not match the declared experiment')
        original.sort(key=lambda c: (('islow', 'float').index(c['options']['method']), c['options']['trellis']))
        higher.sort(key=lambda c: (('islow', 'float').index(c['options']['method']), c['options']['lambda_scale1']))
        selected[fixture, geometry] = original+higher
        for case in selected[fixture, geometry]:
            _validate(case, fixtures)
    cases = []
    for (fixture, geometry), inputs in selected.items():
        anchor = min(inputs[:4], key=lambda case: case['measurement']['regions']['shadow']['delta_e_itp']['maximum'])
        reference, authored, _, _, difference = _pixels(anchor)
        fixed_y, fixed_x = map(int, np.unravel_index(difference.argmax(), difference.shape))
        geometry_measurement = compare_appearance(sdr_signal_to_nits(reference/255),
            sdr_signal_to_nits(authored/255), reference_gamut=anchor['gamut'], actual_gamut=anchor['gamut'],
            fixture_class='gainmap-sdr')
        rows, all_dc = [], {}
        for case in inputs:
            reference, authored, actual, linear, difference = _pixels(case)
            y, x = map(int, np.unravel_index(difference.argmax(), difference.shape))
            native = coefficients(case['artifacts']['output'], (x, y), (fixed_x, fixed_y))
            if any(component['quantization'] != [1]*64 for component in native['components']):
                raise ValueError('Diagnosis requires the measured q100 unit quantization tables')
            if [native['height'], native['width']] != list(reference.shape[:2]):
                raise ValueError('Native coefficient and decoded raster dimensions disagree')
            block = np.array([component['blocks'] for component in native['components']])
            dc = np.array([component['dc'] for component in native['components']])
            method = case['options']['method']
            if not case['options']['trellis']:
                all_dc[method] = dc
            row = {'case_id': case['case_id'], 'input_status': case['status'], 'options': case['options'],
                'output_sha256': case['artifacts']['sha256'], 'native_input_sha256': case['native_candidate']['input_sha256'],
                'reference_sha256': case['reference_sdr']['sha256'], 'libjpeg_api': native['libjpeg_api'],
                'worst_pixel': {'coordinate': [x, y], 'reference_rgb8': reference[y, x].tolist(),
                    'native_authored_rgb8': authored[y, x].tolist(), 'decoded_rgb8': actual[y, x].tolist(),
                    'delta_e_itp': float(difference[y, x])},
                'actual_worst_block_coefficients_rgb': block[:, 0].tolist(),
                'fixed_block_coefficients_rgb': block[:, 1].tolist()}
            baseline_dc = all_dc[method]
            row['worst_block_dc_change_from_no_trellis'] = (dc[:, y//8, x//8]-baseline_dc[:, y//8, x//8]).tolist()
            unchanged = np.all(dc == baseline_dc, axis=0)
            same_pixels = np.repeat(np.repeat(unchanged, 8, axis=0), 8, axis=1)[:reference.shape[0], :reference.shape[1]]
            shadow = linear @ RGB_TO_XYZ[case['gamut']][1] <= THRESHOLDS['regions']['shadow']['maximum_nits']
            failing = shadow & (difference > THRESHOLDS['profiles']['gainmap-sdr']['delta_e_max'])
            row['unchanged_dc_blocks'] = {'total_blocks': int(unchanged.size),
                'unchanged_blocks': int(np.count_nonzero(unchanged)),
                'total_failing_shadow_pixels': int(np.count_nonzero(failing)),
                'failing_pixel_count': int(np.count_nonzero(failing & same_pixels)),
                'maximum_shadow_delta_e': float(difference[shadow & same_pixels].max())}
            rows.append(row)
        for row in rows:
            default = next(other for other in rows if other['options']['method'] == row['options']['method']
                and other['options']['trellis'] and other['options'].get('lambda_scale1', 14.75) == 14.75)
            row['bytes_changed_from_default_lambda'] = row['output_sha256'] != default['output_sha256']
            row['fixed_block_ac_changes_from_default_lambda'] = int(np.count_nonzero(
                np.array(row['fixed_block_coefficients_rgb'])[:, 1:]-np.array(default['fixed_block_coefficients_rgb'])[:, 1:]))
        cases.append({'fixture_id': fixture, 'geometry': geometry, 'fixed_block_pixel': [fixed_x, fixed_y],
            'fixed_block_selection': 'Worst pixel in the best original profile, held fixed across coefficient comparisons',
            'native_geometry_measurement': geometry_measurement, 'profiles': rows})
    root = Path(__file__).parent
    result = {'qualification_scope': 'none; diagnostic only', 'consumer_status': 'pending manual review',
        'interpretation_scope': 'Quantized AC and IDCT error is an inference from native coefficients and decoded '
            'samples. Unchanged-DC blocks test the DC-only explanation; they do not prove mathematical impossibility '
            'or qualify any converter or consumer.',
        'thresholds_sha256': THRESHOLDS_SHA256, 'cases': cases, 'commands': avif.COMMANDS[start:],
        'input_report_canonical_sha256': {name: hashlib.sha256(json.dumps(report, sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode()).hexdigest()
            for name, report in (('baseline', baseline_report), ('lambda', lambda_report))},
        'source_hashes': {name: gainmap.digest(root/name) for name in ('mozjpeg_diagnostics.py',
            'native_jpeg_coefficients.c', 'Dockerfile', 'environment/apk-lock.json', 'appearance.py',
            'gainmap_sdr.py', 'gainmap.py', 'mozjpeg_proof.py', 'avif.py', 'fixtures/gainmap/manifest.json')},
        'native_reader_binary_sha256': gainmap.digest(HELPER),
        'native_libjpeg_binary_sha256': gainmap.digest(Path('/usr/lib/libjpeg.so.8'))}
    (directory/'results.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--lambda-report', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = run(args.output, json.loads(args.baseline.read_text()), json.loads(args.lambda_report.read_text()))
    print(json.dumps({'diagnostic_cases': len(report['cases']), 'qualification_scope': report['qualification_scope']}))
