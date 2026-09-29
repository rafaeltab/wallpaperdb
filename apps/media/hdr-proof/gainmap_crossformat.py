"""Independently measure explicit-depth PQ outputs from native gain-map intents.

The combined runner already executes the native source reconstruction, geometry
and PNG encoder. Reuse those exact inspected bytes, then independently decode
each output against the source again. No JPEG qualification is inherited.
"""
import json
from pathlib import Path
import shutil

import numpy as np

import avif
import gainmap
from appearance import compare_appearance
from gainmap_reference import REVISION, reference


def run(directory, combined_cases):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    fixtures = {item['id']: item for item in json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures']}
    sources, cases = {}, []
    for parent in combined_cases:
        if parent.get('candidate') != 'native-combine-moderateoffset-lossless-rgb':
            continue
        name, geometry = parent['fixture_id'], parent['geometry']
        for extension, depth in (('png', 16), ('avif', 12)):
            case_id = f'{name}:hdr:{extension}:preserve:preserve:{geometry}:native-pq-depth-{depth}:{REVISION}'
            folder = directory/case_id.replace(':', '-')
            folder.mkdir(exist_ok=True)
            case = {'case_id': case_id, 'cell_id': f'gainmap-jpeg:hdr:{extension}', 'fixture_id': name,
                'geometry': geometry, 'selectors': {**parent['selectors'], 'format': extension, 'depth': str(depth)},
                'candidate': 'native-reconstructed-pq', 'source_reference_revision': REVISION,
                'status': 'tested and failed', 'consumer_status': 'pending manual review',
                'representation': {'transfer': 'pq', 'coded_depth': depth,
                    'scope': 'Single-layer HDR output; explicit SDR requests still use the source authored base'},
                'checks': {key: False for key in ('native_encoder', 'independent_source_decoder',
                    'independent_decoder', 'structure', 'appearance', 'privacy')},
                'blockers': [], 'measurements': {}, 'artifacts': {}}
            if 'probe_crop_rectangle' in parent:
                case['probe_crop_rectangle'] = parent['probe_crop_rectangle']
            try:
                fixture = fixtures[name]
                source = gainmap.FIXTURES/f'{name}.jpg'
                if gainmap.digest(source) != fixture['sha256'] or parent['source_sha256'] != fixture['sha256']:
                    raise ValueError('Pinned source hash disagrees with native input evidence')
                case['source_sha256'] = fixture['sha256']
                gamut = fixture['expected']['gamut']
                intent = parent['hdr_intent']
                native_png = Path(intent['path'])
                if gainmap.digest(native_png) != intent['sha256']:
                    raise ValueError('Native HDR intent hash changed after encoding')
                encoder = parent['native_candidate']
                if (Path(encoder['hdr_intent_pq_png']) != native_png
                        or encoder['source_sha256'] != fixture['sha256']
                        or encoder['source_reference_revision'] != REVISION
                        or parent['source_reference_revision'] != REVISION
                        or not parent['checks']['native_encoder']):
                    raise ValueError('Native HDR intent provenance is incomplete')
                if name not in sources:
                    source_folder = directory/'sources'/name
                    source_facts = gainmap.inspect(source, source_folder)
                    source_hdr, source_gamut, source_decoder = gainmap.source_hdr(source, source_folder, gamut)
                    sources[name] = source_facts, source_hdr, source_gamut, source_decoder
                source_facts, source_hdr, source_gamut, source_decoder = sources[name]
                case['source_facts'] = source_facts
                case['source_depths'] = {layer: source_facts[layer]['depth'] for layer in ('base', 'map')}
                case['source_decoder_evidence'] = source_decoder
                case['checks']['independent_source_decoder'] = True
                orientation = 6 if geometry == 'orientation' else 1
                expected, reference_facts = reference(source_hdr, source_gamut, gamut, geometry, orientation)
                case['reference_method'] = reference_facts
                if geometry == 'orientation':
                    case['orientation_source'] = parent['orientation_source']
                target = folder/f'output.{extension}'
                if extension == 'png':
                    shutil.copyfile(native_png, target)
                    case['encoder_evidence'] = {'native_pipeline': encoder,
                        'native_png_sha256': intent['sha256'],
                        'transport': 'Exact bytes of the executed native FFmpeg PNG encoder'}
                else:
                    avif.encode_avif([native_png], target, 'pq', gamut, depth)
                    case['encoder_evidence'] = {'native_pipeline': encoder, 'encoder': 'libavif/AOM',
                        'native_png_sha256': intent['sha256']}
                case['checks']['native_encoder'] = True
                if extension == 'png':
                    actual = avif.read_png(target)
                    facts = gainmap.inspect(target, folder/'inspection')
                    tags = facts['metadata']
                    cicp = [tags.get('PNG-cICP:'+field) for field in (
                        'ColorPrimaries', 'TransferCharacteristics', 'MatrixCoefficients', 'VideoFullRangeFlag')]
                    structure = {'dimensions': actual.shape[:2] == expected.shape[:2],
                        'depth': facts['coded_depth'] == depth,
                        'color': cicp == [avif.PRIMARIES[gamut], 16, 0, 1],
                        'orientation': tags.get('IFD0:Orientation', 1) == 1,
                        'static_opaque': facts['frame_count'] == 1 and facts['opaque'] and bool(np.all(actual[..., 3] == 1))}
                    private = facts['private_tags']
                    decoder = 'Independent native libpng samples; ExifTool signaling'
                else:
                    facts = avif.inspect_avif(target)
                    actual = avif.decode_avif(target, folder, 1)[0]
                    expected_alpha = np.concatenate((expected, np.ones((*expected.shape[:2], 1))), axis=-1)
                    structure = avif.structure_checks(facts, [actual], {}, [expected_alpha], 'pq', gamut, depth, 1)
                    structure['static_opaque'] = facts['alpha'] == 'Absent' and bool(np.all(actual[..., 3] == 1))
                    inspected = gainmap.inspect(target, folder/'inspection')
                    private = inspected['private_tags']
                    decoder = 'Independent dav1d AV1 decode and native libpng samples; ExifTool signaling'
                case['checks']['independent_decoder'] = True
                measured = compare_appearance(expected, avif.decode_transfer(actual[..., :3], 'pq', gamut),
                    reference_gamut=gamut, actual_gamut=gamut, fixture_class='gainmap-hdr')
                case['measurements']['reconstructed_hdr'] = measured
                case['checks']['appearance'] = measured['passed']
                case['checks']['structure'] = all(structure.values())
                case['checks']['privacy'] = not private
                case['structural_checks'] = structure
                case['facts'] = facts
                case['decoder_evidence'] = decoder
                case['artifacts'] = {'output': str(target), 'sha256': gainmap.digest(target)}
                case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
                if all(case['checks'].values()):
                    case['status'] = 'qualified'
            except Exception as error:
                case['blockers'].append(str(error))
            cases.append(case)
    return cases
