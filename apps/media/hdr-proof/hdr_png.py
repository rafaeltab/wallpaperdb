"""Native proof for static, explicitly signaled 16-bit PQ/HLG PNG sources.

These fixtures do not change source admission or APNG policy. The source must
have recognized CICP signaling before these experiments use any converter.
Sixteen-bit HDR samples must meet the existing strict avif-12 appearance gate;
all SDR representations retain the existing tone policy and sdr-8 gate.
"""
import json
from pathlib import Path
import re

import numpy as np

import avif
import gamma_gif
import gamma_icc
import gamma_sdr
from appearance import RGB_TO_XYZ, compare_appearance, sdr_signal_to_nits
from matrix import exact_original, request_decision
from sdr_reference import reference_srgb


def fixture_specs():
    for transfer in ('pq', 'hlg'):
        for gamut in ('p3', 'rec2020'):
            for alpha in (False, True):
                yield {'id': f'png-{transfer}-{gamut}-16-{ "alpha" if alpha else "opaque"}',
                       'transfer': transfer, 'gamut': gamut, 'depth': 16,
                       'alpha': alpha, 'frames': 1}


def inspect_source(path):
    exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
    if (exif.get('FileType') != 'PNG' or exif.get('BitDepth') != 16
            or exif.get('ColorPrimaries') not in (9, 12)
            or exif.get('TransferCharacteristics') not in (16, 18)
            or exif.get('MatrixCoefficients') != 0 or exif.get('VideoFullRangeFlag') != 1
            or exif.get('ColorType') not in (2, 6) or exif.get('Orientation', 1) != 1
            or 'SRGBRendering' in exif or 'ProfileDescription' in exif):
        raise ValueError('The PNG lacks this proof subset\'s recognized HDR signaling; keep it original-only')
    return {'width': exif['ImageWidth'], 'height': exif['ImageHeight'], 'depth': exif['BitDepth'],
            'primaries': exif['ColorPrimaries'], 'transfer': exif['TransferCharacteristics'],
            'matrix': 0, 'full_range': True,
            'gamut': {9: 'rec2020', 12: 'p3'}[exif['ColorPrimaries']],
            'transfer_name': {16: 'pq', 18: 'hlg'}[exif['TransferCharacteristics']],
            'exiftool': {key: value for key, value in exif.items() if key not in (
                'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')}}


def generate_fixture(spec, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    scene = avif.make_scene(spec['alpha'])
    signal = scene.copy()
    signal[..., :3] = avif.encode_transfer(scene[..., :3], spec['transfer'], spec['gamut'])
    intermediate, source = directory/'authored-signal.png', directory/f'{spec["id"]}.png'
    avif.write_png(intermediate, signal)
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', intermediate,
                 '-vf', f'setparams=color_primaries={avif.PRIMARIES[spec["gamut"]]}:'
                        f'color_trc={avif.TRANSFERS[spec["transfer"]]}:colorspace=gbr:range=full',
                 '-pix_fmt', 'rgba64be' if spec['alpha'] else 'rgb48be',
                 '-color_primaries', str(avif.PRIMARIES[spec['gamut']]),
                 '-color_trc', str(avif.TRANSFERS[spec['transfer']]),
                 '-colorspace', 'rgb', '-color_range', 'pc', '-frames:v', '1',
                 '-map_metadata', '-1', '-threads', '1', source])
    avif.native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE',
                 '-XMP-dc:Creator=HDR-PROOF-PRIVATE', '-GPSLatitude=51.5', '-GPSLatitudeRef=N',
                 '-GPSLongitude=4.5', '-GPSLongitudeRef=E', '-Model=Test Camera',
                 '-SerialNumber=987654', source])
    return source, inspect_source(source), scene


def _original_control(source, output, facts):
    selectors = {'format': 'png', 'range': 'hdr', 'gamut': facts['gamut'], 'depth': '16',
                 'motion': 'static', 'transparency': 'preserve', 'w': facts['width'], 'h': facts['height']}
    before = len(avif.COMMANDS)
    decision = request_decision(facts, selectors)
    original = source.read_bytes()
    output.write_bytes(exact_original(original, decision))
    result = {'name': source.stem + ':explicit-matching-hdr-png-no-op',
              'scope': 'Exact-original selector control, not conversion qualification',
              'selectors': selectors, 'decision': decision,
              'exact_bytes': output.read_bytes() == original,
              'no_native_calls': len(avif.COMMANDS) == before,
              'retained_source_metadata': b'HDR-PROOF-PRIVATE' in output.read_bytes(),
              'metadata_policy': 'Existing metadata is retained for the exact-byte no-op required by #250',
              'source_sha256': avif.digest(source), 'output_sha256': avif.digest(output)}
    result['passed'] = result['exact_bytes'] and result['no_native_calls'] and result['retained_source_metadata']
    result['case_id'] = result['name']
    result['status'] = 'passed' if result['passed'] else 'failed'
    result['checks'] = {key: result[key] for key in ('exact_bytes', 'no_native_calls', 'retained_source_metadata')}
    result['codec_qualification'] = False
    return result


def inspect_privacy(path, facts, extension):
    emitted = json.loads(avif.native(['exiftool', '-j', '-G1', '-EXIF:all', '-XMP:all', path]))[0]
    emitted = {key: value for key, value in emitted.items() if key != 'SourceFile'}
    private_names = ('GPSLatitude', 'GPSLongitude', 'Make', 'Model', 'SerialNumber',
                     'OwnerName', 'Artist', 'Creator', 'Author', 'XMPToolkit')
    private = [key for key in private_names if key in facts.get('exiftool', {})]
    avif_absent = (all(re.search(r'\* ' + kind + r' Metadata\s*:\s*Absent', facts.get('info', ''))
                      is not None for kind in ('Exif', 'XMP')) if extension == 'avif' else True)
    return {'passed': not emitted and not private and avif_absent and facts.get('privacy', True)
                      and b'HDR-PROOF-PRIVATE' not in Path(path).read_bytes(),
            'exif_xmp_tags': emitted, 'private_tags': private,
            'avif_exif_xmp_absent': avif_absent if extension == 'avif' else None}


def _icc_output(paths, target, extension, reference):
    adapter = gamma_gif if extension == 'gif' else gamma_icc
    if extension == 'gif':
        adapter.encode(paths, target)
    else:
        adapter.encode(paths, target, extension)
    facts, frames, profile = adapter.inspect_and_decode(target)
    alpha = (np.ones_like(reference[..., 3]) if extension == 'jpg' else
             (reference[..., 3] >= .5).astype(float) if extension == 'gif' else reference[..., 3])
    limit = 0 if extension in ('jpg', 'gif') else 2 / 255
    facts['alpha_maximum_error'] = max(float(np.max(np.abs(frame[..., 3] - alpha))) for frame in frames)
    detail = {'dimensions': all(frame.shape == reference.shape for frame in frames),
              'frames': len(frames) == 1, 'depth': facts['depth'] == 8,
              'color_signaling': facts['icc']['gamma22_srgb_primaries'],
              'gamut': facts['icc']['gamma22_srgb_primaries'],
              'alpha': facts['alpha_maximum_error'] <= limit,
              'orientation_baked': facts['exiftool'].get('Orientation', 1) == 1}
    return facts, frames, detail, gamma_icc.decode_signal_to_nits(frames[0][..., :3], profile)


def run(output_directory, *, specs=None, geometries=('identity', 'contain')):
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    start_commands = len(avif.COMMANDS)
    evidence, fixtures, controls = [], [], []
    for spec in (fixture_specs() if specs is None else specs):
        folder = output_directory/spec['id']
        source, source_facts, analytic = generate_fixture(spec, folder)
        decoded_source = avif.read_png(source)
        reference_source = decoded_source.copy()
        reference_source[..., :3] = avif.decode_transfer(decoded_source[..., :3], spec['transfer'], spec['gamut'])
        source_measurement = compare_appearance(analytic[..., :3], reference_source[..., :3],
            reference_gamut=spec['gamut'], actual_gamut=spec['gamut'], fixture_class='avif-12', alpha=analytic[..., 3])
        source_valid = (source_measurement['passed'] and source_facts['gamut'] == spec['gamut']
                        and source_facts['transfer_name'] == spec['transfer']
                        and (source_facts['width'], source_facts['height']) == (decoded_source.shape[1], decoded_source.shape[0])
                        and decoded_source.shape == analytic.shape
                        and np.max(np.abs(decoded_source[..., 3] - analytic[..., 3])) <= 1 / 65535)
        fixtures.append({'id': spec['id'], 'path': str(source), 'sha256': avif.digest(source),
                         'spec': spec, 'generator': 'hdr_png.py:generate_fixture', 'facts': source_facts,
                         'source_appearance': source_measurement, 'source_valid': bool(source_valid),
                         'threshold_scope': 'The existing avif-12 ceiling also constrains these finer 16-bit PNG fixtures'})
        known = {'format': 'png', 'range': 'hdr', 'gamut': spec['gamut'], 'depth': 16,
                 'width': 96, 'height': 64, 'motion': 'static',
                 'alpha': 'fractional' if spec['alpha'] else 'none', 'alpha_capable': True, 'orientation': 1}
        tone_control = avif.sdr_tone_control(source, folder/'sdr-control.png', reference_source,
            analytic, spec['transfer'], spec['gamut'], peak_nits=1000)
        for geometry in geometries:
            if geometry not in ('identity', 'contain'):
                raise ValueError('This PNG-source increment covers identity and contain geometry only')
            reference = avif.geometry_reference(reference_source, geometry)
            for dynamic_range, extension in (('hdr', 'avif'), ('hdr', 'png'),
                ('sdr', 'avif'), ('sdr', 'png'), ('sdr', 'jpg'), ('sdr', 'webp'), ('sdr', 'gif')):
                if dynamic_range == 'hdr' and extension == 'png' and geometry == 'identity':
                    controls.append(_original_control(source, folder/'exact-original.png', known))
                    continue
                sdr = dynamic_range == 'sdr'
                depth = 16 if extension == 'png' else 12 if not sdr else 8
                gamut, transfer = ('srgb', 'gamma22' if extension != 'png' else 'srgb') if sdr else (spec['gamut'], spec['transfer'])
                case_id = f'{spec["id"]}:{dynamic_range}:{extension}:{"srgb" if sdr else "preserve"}:preserve:{geometry}'
                case_directory = folder/case_id.replace(':', '-')
                case_directory.mkdir(exist_ok=True)
                selectors = {'format': extension, 'range': dynamic_range,
                    'gamut': 'srgb' if sdr else 'preserve', 'depth': str(depth), 'motion': 'preserve',
                    'transparency': 'coerce' if spec['alpha'] and extension in ('jpg', 'gif') else 'preserve'}
                if geometry == 'contain':
                    selectors.update({'w': 58, 'h': 38, 'fit': 'contain'})
                item = {'case_id': case_id, 'fixture_id': spec['id'], 'cell_id': f'hdr-png:{dynamic_range}:{extension}',
                        'selectors': selectors, 'geometry': geometry, 'status': 'tested and failed',
                        'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                        'blockers': [], 'measurements': {}, 'artifacts': {},
                        'source_facts': source_facts, 'consumer_status': 'pending manual review'}
                try:
                    decision = request_decision(known, selectors)
                    if decision['action'] != 'unqualified':
                        raise ValueError('The tuple is not an eligible native conversion experiment')
                    converted = case_directory/'converted.png'
                    avif.convert_frame(source, converted, spec['transfer'], spec['gamut'], geometry,
                                       sdr=sdr, peak_nits=1000 if sdr else None)
                    target = case_directory/f'output.{extension}'
                    if extension == 'avif':
                        if sdr:
                            gamma_sdr.encode([converted], target, depth=depth)
                        else:
                            avif.encode_avif([converted], target, transfer, gamut, depth)
                        facts = avif.inspect_avif(target)
                        frames = avif.decode_avif(target, case_directory, 1)
                        detail = avif.structure_checks(facts, frames, spec, [reference], transfer, gamut, depth, 1)
                        linear = (gamma_sdr.decode_signal_to_nits(frames[0][..., :3]) if sdr else
                                  avif.decode_transfer(frames[0][..., :3], transfer, gamut))
                        actual_gamut = gamut
                    elif extension == 'png':
                        facts, frames, detail = avif.encode_other([converted], target, extension,
                            transfer, gamut, [reference], 1, spec)
                        linear = avif.decode_transfer(frames[0][..., :3], transfer, gamut)
                        actual_gamut = gamut
                    else:
                        facts, frames, detail, linear = _icc_output([converted], target, extension, reference)
                        actual_gamut = 'rec2020'
                    privacy = inspect_privacy(target, facts, extension)
                    item['privacy_measurement'] = privacy
                    item['checks'].update({'native_encoder': True, 'independent_decoder': True,
                        'structure': bool(source_valid and all(detail.values())), 'privacy': privacy['passed']})
                    visibility = (None if extension == 'jpg' else
                                  (reference[..., 3] >= .5).astype(float) if extension == 'gif' else reference[..., 3])
                    expected = sdr_signal_to_nits(reference_srgb(reference[..., :3], spec['gamut'], peak_nits=1000)) if sdr else reference[..., :3]
                    measured = compare_appearance(expected, linear, reference_gamut='srgb' if sdr else gamut,
                        actual_gamut=actual_gamut, fixture_class='sdr-8' if sdr else 'avif-12', alpha=visibility,
                        region_reference_luminance_nits=reference[..., :3] @ RGB_TO_XYZ[spec['gamut']][1])
                    if sdr:
                        measured['tone_control_passed'] = tone_control['passed']
                        measured['passed'] &= tone_control['passed']
                        item['measurements']['tone_controls'] = [tone_control]
                        item['representation'] = {'primaries': 'srgb', 'transfer': transfer,
                            'reference_grade': 'Unchanged independently declared 1000-nit SDR grade'}
                    item['measurements']['frames'] = [measured]
                    item['checks']['appearance'] = bool(measured['passed'])
                    item['facts'], item['structural_checks'] = facts, detail
                    item['artifacts'] = {'output': str(target), 'sha256': avif.digest(target),
                                         'source': str(source), 'source_sha256': avif.digest(source)}
                    if not source_valid:
                        item['blockers'].append('Source signaling or independent analytic fixture checks failed')
                    item['blockers'] += [f'Failed {key} check' for key, passed in item['checks'].items() if not passed]
                    if all(item['checks'].values()) and not item['blockers']:
                        item['status'] = 'qualified'
                except Exception as error:
                    item['blockers'].append(str(error))
                evidence.append(item)
        print(f'HDR PNG {spec["id"]}: native identity/contain evidence recorded', flush=True)
    return {'evidence': evidence, 'fixtures': fixtures, 'controls': controls,
            'commands': avif.COMMANDS[start_commands:]}
