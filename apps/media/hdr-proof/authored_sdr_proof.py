"""Measure native authored-base alternatives without replacing failed routes."""
import json
from pathlib import Path
import shutil

import numpy as np

import avif
import gainmap
import gainmap_sdr
from appearance import compare_appearance, sdr_signal_to_nits
from matrix import GAINMAP_GEOMETRIES


def run(directory, *, names=gainmap.NAMES,
        geometries=('identity', *gainmap.GEOMETRIES),
        gamuts=('preserve', 'srgb'), gammas=(None, 3.2), formats=('jpg',)):
    if not formats or any(fmt not in ('jpg', 'avif', 'png', 'webp') for fmt in formats):
        raise ValueError('Authored SDR candidates support JPEG, AVIF, PNG, and WebP')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    provenance = json.loads((gainmap.FIXTURES/'manifest.json').read_text())
    sources = {item['id']: item for item in provenance['fixtures']}
    evidence = []
    for name in names:
        original = gainmap.FIXTURES/f'{name}.jpg'
        if avif.digest(original) != sources[name]['sha256']:
            raise ValueError(f'Authored SDR fixture hash changed: {name}')
        source_gamut = sources[name]['expected']['gamut']
        for gamut_selector in gamuts:
            gamut = source_gamut if gamut_selector == 'preserve' else gamut_selector
            representations = [(fmt, gamma) for fmt in formats for gamma in (gammas if fmt == 'jpg' else (None,))]
            for fmt, gamma in representations:
                representation = (('rgb-jpeg-srgb-transfer' if gamma is None else f'rgb-jpeg-gamma{gamma}')
                                  if fmt == 'jpg' else f'lossless-{fmt}-srgb-transfer')
                for operation in geometries:
                    case_id = f'{name}:sdr:{fmt}:{gamut_selector}:preserve:{operation}:{representation}'
                    folder = directory/case_id.replace(':', '-')
                    folder.mkdir(exist_ok=True)
                    selectors = {'format': fmt, 'range': 'sdr', 'gamut': gamut_selector,
                                 'depth': 'preserve', 'motion': 'preserve', 'transparency': 'preserve'}
                    selectors.update(GAINMAP_GEOMETRIES.get(operation, {}))
                    if operation == 'crop':
                        selectors.update({'w': 173, 'h': 153, 'fit': 'fill'})
                    case = {'case_id': case_id, 'fixture_id': name, 'cell_id': f'gainmap-jpeg:sdr:{fmt}',
                            'selectors': selectors, 'geometry': operation, 'candidate': representation,
                            'status': 'tested and failed', 'consumer_status': 'pending manual review',
                            'checks': {key: False for key in ('native_encoder', 'independent_decoder',
                                       'structure', 'appearance', 'privacy')},
                            'blockers': [], 'measurements': {}, 'artifacts': {},
                            'source_sha256': avif.digest(original), 'established_source_gamut': source_gamut}
                    if operation == 'crop':
                        case['probe_crop_rectangle'] = {'left': 13, 'top': 17, 'width': 271, 'height': 239}
                    try:
                        source = original
                        if operation == 'orientation':
                            source = folder/'source-orientation-6.jpg'
                            shutil.copyfile(original, source)
                            avif.native(['exiftool', '-overwrite_original', '-Orientation#=6', source])
                            case['orientation_source'] = {'path': str(source), 'sha256': avif.digest(source),
                                                          'orientation': 6}
                        reference_image = gainmap.source_image(original, gamut_selector)
                        if operation != 'identity':
                            reference_image = gainmap.geometry(reference_image, operation,
                                                                6 if operation == 'orientation' else 1)
                        profile = reference_image.info.get('icc_profile')
                        reference_image.info.clear()
                        reference_path = folder/'reference-sdr.png'
                        reference_image.save(reference_path, icc_profile=profile)
                        case['reference_sdr'] = {'path': str(reference_path), 'sha256': avif.digest(reference_path),
                                                'gamut': gamut, 'transfer': 'srgb',
                                                'purpose': 'Unchanged independent matched-geometry authored SDR base'}
                        target = folder/f'output.{fmt}'
                        arguments = {'gamut': gamut}
                        if gamma is not None:
                            arguments['gamma'] = gamma
                        if fmt == 'jpg':
                            codec = gainmap_sdr
                        elif fmt == 'avif':
                            import authored_avif
                            codec = authored_avif
                        else:
                            import authored_lossless
                            codec = authored_lossless
                        encoded = codec.encode(source, target, operation, **arguments)
                        case['checks']['native_encoder'] = True
                        actual, facts = codec.decode_linear(target, **arguments)
                        case['checks']['independent_decoder'] = True
                        reference = sdr_signal_to_nits(np.asarray(reference_image) / 255)
                        measured = compare_appearance(reference, actual, reference_gamut=gamut,
                            actual_gamut='rec2020', fixture_class='gainmap-sdr')
                        tags = facts['metadata']
                        structure = {'dimensions': actual.shape == reference.shape,
                                     'base_depth': facts['depth'] == sources[name]['expected']['base_depth'],
                                     'color_signaling': facts.get('gamut', facts.get('color', {}).get('gamut')) == gamut,
                                     'orientation_baked': tags.get('IFD0:Orientation', 1) == 1,
                                     'static_opaque_rgb': facts['components'] == 3,
                                     'gain_map_removed': not any(key.endswith(':MPImage2') for key in tags)}
                        case['checks'].update({'structure': all(structure.values()),
                                               'appearance': measured['passed'], 'privacy': facts['privacy']})
                        case['structural_checks'] = structure
                        case['facts'] = facts
                        case['native_candidate'] = encoded
                        case['measurements']['authored_sdr_base'] = measured
                        case['artifacts'] = {'output': str(target), 'sha256': avif.digest(target)}
                        case['blockers'] = [f'Failed {key} check' for key, value in case['checks'].items() if not value]
                        if all(case['checks'].values()) and not case['blockers']:
                            case['status'] = 'qualified'
                    except Exception as error:
                        case['blockers'].append(str(error))
                    evidence.append(case)
    return evidence
