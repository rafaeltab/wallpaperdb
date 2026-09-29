"""Measure all declared native MozJPEG SDR-base trials against fixed gates."""
import argparse
from collections import Counter
import itertools
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance, sdr_signal_to_nits, THRESHOLDS_SHA256
import avif
import gainmap
import gainmap_sdr
import mozjpeg

# Declared before measuring: the seven remaining SOF0-union failures. q100,
# RGB8, source grade, ICC transfer, geometry, references, and gates are fixed.
CORPUS = (
    ('gainmap-android-iso', 'cover'), ('gainmap-android-iso', 'upscale'),
    ('gainmap-android-xmp', 'upscale'), ('gainmap-apple-old', 'contain'),
    ('gainmap-apple-old', 'upscale'), ('gainmap-apple-new', 'contain'),
    ('gainmap-apple-new', 'upscale'),
)
OPTIONS = tuple(itertools.product(('islow', 'float'), (False, True), (False, True)))
# Bounded follow-up declared before measuring: unchanged q100 and samples;
# increase the native cost of coefficient distortion for the remaining six.
LAMBDA_CORPUS = CORPUS[1:]
LAMBDA_OPTIONS = (('islow', True, False), ('float', True, False))
LAMBDAS = ((14.75, 16.5), (18.75, 16.5), (22.75, 16.5))
LAMBDA_RATIONALE = {
    'source': 'https://github.com/mozilla/mozjpeg/blob/v4.1.5/README-mozilla.txt',
    'implementation': 'https://github.com/mozilla/mozjpeg/blob/v4.1.5/jcdctmgr.c',
    'native_objective': 'R + lambda * D; scale1 raises the native coefficient-distortion penalty',
    'hypothesis': 'More coefficient precision may avoid measured one-code near-black errors; '
        'it does not change authored samples, reference grade, transfer, depth or acceptance gates',
    'scope': 'Three predeclared lambda settings; every result is retained, including default controls',
}
UPSTREAM = {'version': '4.1.5',
    'url': 'https://codeload.github.com/mozilla/mozjpeg/tar.gz/refs/tags/v4.1.5',
    'sha256': '9fcbb7171f6ac383f5b391175d6fb3acde5e64c4c4727274eade84ed0998fcc1'}


def run(directory, *, corpus=CORPUS, options=OPTIONS, optimized_huffman=True, lambdas=((14.75, 16.5),)):
    command_start = len(avif.COMMANDS)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    fixtures = {item['id']: item for item in json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures']}
    cases = []
    for name, geometry in corpus:
        source = gainmap.FIXTURES/f'{name}.jpg'
        fixture = fixtures[name]
        if gainmap.digest(source) != fixture['sha256']:
            raise ValueError('MozJPEG source fixture hash changed')
        gamut = fixture['expected']['gamut']
        folder = directory/f'{name}-{geometry}'
        folder.mkdir(parents=True, exist_ok=True)
        authored = folder/'native-authored.png'
        geometry_evidence = gainmap_sdr.prepare(source, authored, geometry, gamut=gamut)
        reference = gainmap.geometry(gainmap.source_image(source, 'preserve'), geometry, 1)
        reference_path = folder/'reference-sdr.png'
        reference.save(reference_path)
        reference_linear = sdr_signal_to_nits(np.asarray(reference)/255)
        if gamut == 'p3':
            with Image.open(source) as image:
                profile = bytearray(image.info['icc_profile'])
        else:
            profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
        profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
        profile[84:100] = bytes(16)
        for (method, trellis, deringing), (lambda_scale1, lambda_scale2) in itertools.product(options, lambdas):
            trial = f'mozjpeg-q100-{method}-trellis{int(trellis)}-deringing{int(deringing)}'
            trial += '-huffman-' + ('optimized' if optimized_huffman else 'standard')
            if (lambda_scale1, lambda_scale2) != (14.75, 16.5):
                trial += f'-lambda-{lambda_scale1}-{lambda_scale2}'
            output = folder/f'{trial}.jpg'
            case = {'case_id': f'{name}:{geometry}:{trial}', 'fixture_id': name, 'geometry': geometry,
                'source_sha256': gainmap.digest(source), 'gamut': gamut,
                'options': {'method': method, 'trellis': trellis, 'deringing': deringing, 'quality': 100,
                            'optimized_huffman': optimized_huffman,
                            'lambda_scale1': lambda_scale1, 'lambda_scale2': lambda_scale2},
                'status': 'tested and failed', 'consumer_status': 'pending manual review',
                'qualification_scope': 'Authored SDR base codec experiment only; no gain-map or HDR derivative qualification',
                'reference_sdr': {'path': str(reference_path), 'sha256': gainmap.digest(reference_path),
                                  'gamut': gamut, 'transfer': 'srgb'},
                'native_geometry': geometry_evidence,
                'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'coded_structure',
                    'dimensions', 'color', 'orientation', 'privacy', 'appearance')}, 'blockers': []}
            decoder_start = None
            try:
                encoded = mozjpeg.encode(authored, output, icc_profile=bytes(profile), method=method,
                                         trellis=trellis, deringing=deringing, optimized_huffman=optimized_huffman,
                                         lambda_scale1=lambda_scale1, lambda_scale2=lambda_scale2)
                case.update({'native_candidate': encoded,
                    'artifacts': {'output': str(output), 'sha256': gainmap.digest(output)}})
                case['checks']['native_encoder'] = True
                decoder_start = len(avif.COMMANDS)
                actual, facts = gainmap_sdr.decode(output, gamut=gamut)
                decoder_commands = [command for command in avif.COMMANDS[decoder_start:]
                                    if command['argv'][0] == 'ffmpeg']
                decoder_clean = bool(decoder_commands) and all(command['exit_code'] == 0
                    and not command['stderr'] for command in decoder_commands)
                facts['decoder_clean'] = decoder_clean
                facts['decoder_diagnostics'] = decoder_commands
                facts['appearance_evaluated'] = True
                measurement = compare_appearance(reference_linear, sdr_signal_to_nits(actual),
                    reference_gamut=gamut, actual_gamut=gamut, fixture_class='gainmap-sdr')
                checks = {'native_encoder': True, 'independent_decoder': decoder_clean,
                    'coded_structure': facts['sof'] == 0 and facts['depth'] == 8
                        and facts['components'] == 3 and encoded['sampling_factors'] == [17, 17, 17],
                    'dimensions': actual.shape == np.asarray(reference).shape,
                    'color': facts['gamut'] == gamut and facts['transfer'] == 'srgb',
                    'orientation': facts['metadata'].get('IFD0:Orientation', 1) == 1,
                    'privacy': facts['privacy'], 'appearance': measurement['passed']}
                case.update({'checks': checks, 'facts': facts, 'measurement': measurement})
                case['blockers'] = [f'Failed {key} check' for key, passed in checks.items() if not passed]
                if all(checks.values()):
                    case['status'] = 'qualified'
            except Exception as error:
                if decoder_start is not None:
                    case['facts'] = {'decoder_clean': False, 'appearance_evaluated': False,
                        'decoder_diagnostics': [command for command in avif.COMMANDS[decoder_start:]
                            if Path(command['argv'][0]).name == 'ffmpeg']}
                    case['blockers'].append('Failed independent_decoder check')
                case['blockers'].append(str(error))
            cases.append(case)
    root = Path(__file__).parent
    return {'scope': 'Native MozJPEG SOF0 RGB8 authored SDR base experiments only',
        'consumer_status': 'pending manual review', 'thresholds_sha256': THRESHOLDS_SHA256,
        'declared_trial_plan': {'corpus': corpus, 'native_options': options,
            'option_fields': ['method', 'trellis', 'deringing'], 'quality': 100,
            'optimized_huffman': optimized_huffman,
            'lambdas': lambdas, 'lambda_fields': ['lambda_scale1', 'lambda_scale2'],
            'reference': 'Unchanged independently decoded authored SDR with matched geometry',
            'selection': 'Every declared option is recorded, including failures'},
        'upstream_source': UPSTREAM, 'lambda_rationale': LAMBDA_RATIONALE,
        'native_versions': {'mozjpeg': '4.1.5; static, SIMD disabled',
                            'ffmpeg': avif.native(['ffmpeg', '-version']).decode().splitlines()[0]},
        'source_hashes': {name: gainmap.digest(root/name) for name in (
            'mozjpeg.py', 'mozjpeg_proof.py', 'native_mozjpeg.c', 'mozjpeg-build.sh',
            'avif.py', 'gainmap_sdr.py', 'gainmap.py', 'gainmap_iso.py', 'appearance.py', 'thresholds.json',
            'environment/apk-lock.json', 'fixtures/gainmap/manifest.json')},
        'native_encoder_binary_sha256': gainmap.digest(mozjpeg.HELPER),
        'commands': avif.COMMANDS[command_start:], 'cases': cases,
        'status_counts': dict(Counter(case['status'] for case in cases)),
        'failed_check_counts': dict(Counter(key for case in cases for key, passed in case['checks'].items()
            if not passed))}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--standard-huffman', action='store_true',
                        help='Replay the retained failed initial Huffman-table setup')
    parser.add_argument('--lambda-sweep', action='store_true',
                        help='Run the predeclared 36 native trellis lambda trials on six remaining failures')
    args = parser.parse_args()
    if args.lambda_sweep and args.standard_huffman:
        parser.error('The declared lambda experiment requires optimized Huffman tables')
    result = (run(args.output, corpus=LAMBDA_CORPUS, options=LAMBDA_OPTIONS, lambdas=LAMBDAS)
              if args.lambda_sweep else run(args.output, optimized_huffman=not args.standard_huffman))
    (args.output/'results.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'qualified_sdr_base_trials': sum(case['status'] == 'qualified' for case in result['cases']),
                      'total_trials': len(result['cases']), 'results': str(args.output/'results.json')}))
