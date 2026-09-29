"""Measure separate native JPEGli SDR bases; never qualify an HDR derivative."""
import argparse
import itertools
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

from appearance import compare_appearance, sdr_signal_to_nits, THRESHOLDS_SHA256
import avif
from avif import native
import gainmap
import gainmap_sdr
import jpegli

# These eight geometries fail the existing ISLOW/FLOAT SOF0 union. Keeping the
# diagnostic corpus explicit prevents selective reporting after a trial.
REMAINING_DCT_CASES = (
    ('gainmap-android-iso', 'contain'), ('gainmap-android-iso', 'cover'),
    ('gainmap-android-iso', 'upscale'), ('gainmap-android-xmp', 'upscale'),
    ('gainmap-apple-old', 'contain'), ('gainmap-apple-old', 'upscale'),
    ('gainmap-apple-new', 'contain'), ('gainmap-apple-new', 'upscale'),
)
OPTIONS = tuple(itertools.product(('uint8', 'float32'), ('standard', 'jpegli'), (False, True)))


def run(directory, *, corpus=REMAINING_DCT_CASES, options=OPTIONS):
    command_start = len(avif.COMMANDS)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    fixtures = {item['id']: item for item in json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures']}
    cases = []
    for name, geometry in corpus:
        source = gainmap.FIXTURES/f'{name}.jpg'
        fixture = fixtures[name]
        if gainmap.digest(source) != fixture['sha256']:
            raise ValueError('JPEGli source fixture hash changed')
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
        for input_type, tables, adaptive in options:
            trial = f'jpegli-{input_type}-{tables}-adaptive{int(adaptive)}'
            output = folder/f'{trial}.jpg'
            case = {'case_id': f'{name}:{geometry}:{trial}', 'fixture_id': name, 'geometry': geometry,
                'source_sha256': gainmap.digest(source), 'gamut': gamut,
                'options': {'input_type': input_type, 'tables': tables, 'adaptive': adaptive},
                'status': 'tested and failed', 'consumer_status': 'pending manual review',
                'qualification_scope': 'Authored SDR base codec experiment only; no gain-map or HDR derivative qualification',
                'reference_sdr': {'path': str(reference_path), 'sha256': gainmap.digest(reference_path),
                                  'gamut': gamut, 'transfer': 'srgb'},
                'native_geometry': geometry_evidence, 'checks': {}, 'blockers': []}
            try:
                encoded = jpegli.encode(authored, output, icc_profile=bytes(profile), input_type=input_type,
                                         tables=tables, adaptive=adaptive)
                actual, facts = gainmap_sdr.decode(output, gamut=gamut)
                measurement = compare_appearance(reference_linear, sdr_signal_to_nits(actual),
                    reference_gamut=gamut, actual_gamut=gamut, fixture_class='gainmap-sdr')
                checks = {'native_encoder': True, 'independent_decoder': True,
                    'coded_structure': facts['sof'] == 0 and facts['depth'] == 8
                        and facts['components'] == 3 and encoded['sampling_factors'] == [17, 17, 17],
                    'dimensions': actual.shape == np.asarray(reference).shape,
                    'color': facts['gamut'] == gamut and facts['transfer'] == 'srgb',
                    'orientation': facts['metadata'].get('IFD0:Orientation', 1) == 1,
                    'privacy': facts['privacy'], 'appearance': measurement['passed']}
                case.update({'checks': checks, 'native_candidate': encoded, 'facts': facts,
                    'measurement': measurement, 'artifacts': {'output': str(output), 'sha256': gainmap.digest(output)}})
                case['blockers'] = [f'Failed {key} check' for key, passed in checks.items() if not passed]
                if all(checks.values()):
                    case['status'] = 'qualified'
            except Exception as error:
                case['blockers'].append(str(error))
            cases.append(case)
    root = Path(__file__).parent
    return {'scope': 'Native JPEGli SOF0 RGB8 authored SDR base experiments only',
        'consumer_status': 'pending manual review', 'thresholds_sha256': THRESHOLDS_SHA256,
        'native_versions': {'jpegli': 'libjxl 0.11.2', 'highway': '1.2.0',
                            'ffmpeg': native(['ffmpeg', '-version']).decode().splitlines()[0]},
        'source_hashes': {name: gainmap.digest(root/name) for name in (
            'jpegli.py', 'jpegli_proof.py', 'native_jpegli.cpp', 'jpegli.cmake', 'jpegli-build.sh',
            'gainmap_sdr.py', 'gainmap.py', 'gainmap_iso.py', 'appearance.py', 'thresholds.json',
            'environment/apk-lock.json', 'fixtures/gainmap/manifest.json')},
        'native_encoder_binary_sha256': gainmap.digest(jpegli.HELPER),
        'commands': avif.COMMANDS[command_start:],
        'cases': cases}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = run(args.output)
    (args.output/'results.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'qualified_sdr_base_trials': sum(case['status'] == 'qualified' for case in result['cases']),
                      'total_trials': len(result['cases']), 'results': str(args.output/'results.json')}))
