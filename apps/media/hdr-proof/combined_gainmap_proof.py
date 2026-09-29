"""Measure native SDR/HDR-intent gain-map candidates with explicit reference revisions."""

import json
from pathlib import Path

import numpy as np

import avif
import gainmap
import gainmap_combine
import gainmap_hdr
import gainmap_sdr
from gainmap_iso import decode_iso_source
from gainmap_metadata import check_metadata
from appearance import compare_appearance, sdr_signal_to_nits
from matrix import GAINMAP_GEOMETRIES


def run(directory, *, names=gainmap.NAMES, geometries=gainmap.GEOMETRIES,
        policies=('identity', 'moderateoffset'), reference_revision='gainmap-hdr-target-gamut-v1',
        coding='lossless-rgb', source_precision='pq16'):
    if source_precision not in ('pq16', 'float32'):
        raise ValueError('Unknown native HDR source precision candidate')
    if source_precision == 'float32' and any(name != 'gainmap-android-iso' for name in names):
        raise ValueError('Native float32 source precision is proven only for the pinned ISO fixture')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    fixtures = json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures']
    fixtures = {fixture['id']: fixture for fixture in fixtures}
    cases = []
    for name in names:
        source = gainmap.FIXTURES/f'{name}.jpg'
        if gainmap.digest(source) != fixtures[name]['sha256']:
            raise ValueError('Gain-map source fixture hash changed')
        gamut = fixtures[name]['expected']['gamut']
        source_directory = directory/'sources'/name
        source_facts = gainmap.inspect(source, source_directory)
        source_hdr, source_hdr_gamut, source_decoder = gainmap.source_hdr(source, source_directory, gamut)
        for policy in policies:
            for operation in geometries:
                source_suffix = '-source-float32' if source_precision == 'float32' else ''
                candidate = f'native-combine-{policy}-{coding}{source_suffix}'
                case_id = f'{name}:hdr:jpg:preserve:preserve:{operation}:{candidate}:{reference_revision}'
                folder = directory/case_id.replace(':', '-')
                folder.mkdir(exist_ok=True)
                selectors = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
                             'motion': 'preserve', 'transparency': 'preserve'}
                selectors.update(GAINMAP_GEOMETRIES[operation] if operation in GAINMAP_GEOMETRIES else
                                 {'w': 173, 'h': 153, 'fit': 'fill'})
                case = {'case_id': case_id, 'fixture_id': name, 'cell_id': 'gainmap-jpeg:hdr:jpg',
                        'candidate': candidate, 'geometry': operation, 'selectors': selectors,
                        'source_precision': source_precision,
                        'source_reference_revision': reference_revision, 'source_sha256': gainmap.digest(source),
                        'status': 'tested and failed', 'consumer_status': 'pending manual review',
                        'known_consumer_limitations': ([
                            'Pinned native libavif cannot read JPEG SOF3 predictive base/map coding; '
                            'physical browser and wallpaper consumers have not been tested.'] if coding == 'lossless-rgb' else [
                            'Pinned libavif can read SOF0 but converts RGB gain-map samples to 8-bit BT.601 YCbCr '
                            'during its AVIF reconstruction route; that additional rounding has separate appearance failures. '
                            'Physical browser and wallpaper consumers have not been tested.']),
                        'checks': {key: False for key in ('native_encoder', 'independent_source_decoder',
                            'independent_decoder', 'native_geometry', 'structure', 'appearance', 'privacy')},
                        'blockers': [], 'artifacts': {}, 'measurements': {}, 'reference_revision_diagnostics': {}}
                if operation == 'crop':
                    case['probe_crop_rectangle'] = {'left': 13, 'top': 17, 'width': 271, 'height': 239}
                try:
                    orientation = 6 if operation == 'orientation' else 1
                    case['checks']['independent_source_decoder'] = True
                    case['source_decoder_evidence'] = source_decoder
                    case['source_facts'] = source_facts
                    old_reference = gainmap.array_geometry(source_hdr, operation, orientation)
                    if reference_revision == 'decoder-gamut-v1':
                        hdr_reference, reference_gamut = old_reference, source_hdr_gamut
                        case['reference_method'] = {'revision': reference_revision,
                            'gamut': reference_gamut, 'clipping': 'Clip negative decoder-coordinate channels after Lanczos'}
                    else:
                        from gainmap_reference import reference
                        hdr_reference, reference_evidence = reference(source_hdr, source_hdr_gamut, gamut,
                                                                      operation, orientation)
                        if reference_evidence['revision'] != reference_revision:
                            raise ValueError('Reference revision differs from the requested proof revision')
                        reference_gamut = gamut
                        case['reference_method'] = reference_evidence
                        case['reference_revision_diagnostics']['superseded_reference_difference'] = compare_appearance(
                            old_reference, hdr_reference, reference_gamut=source_hdr_gamut,
                            actual_gamut=reference_gamut, fixture_class='gainmap-hdr')
                    sdr_reference = gainmap.geometry(gainmap.source_image(source, 'preserve'), operation, orientation)
                    profile = sdr_reference.info.get('icc_profile')
                    sdr_reference.info.clear()
                    reference_sdr = folder/'reference-sdr.png'
                    sdr_reference.save(reference_sdr, icc_profile=profile)
                    case['reference_sdr'] = {'path': str(reference_sdr), 'sha256': gainmap.digest(reference_sdr),
                        'gamut': gamut, 'transfer': 'srgb',
                        'purpose': 'Independent matched-geometry authored SDR base for HDR JPEG comparison'}
                    target = folder/'output.jpg'
                    encoded = gainmap_combine.encode(source, target, operation, gamut=gamut, map_policy=policy,
                        orientation=orientation, geometry_revision=reference_revision, coding=coding,
                        source_precision=source_precision)
                    case['checks']['native_encoder'] = True
                    case['native_candidate'] = encoded
                    if source_precision == 'float32':
                        native_source = encoded['hdr_source']
                        native_pixels = np.fromfile(native_source['path'], dtype='<f4').reshape(
                            3, native_source['height'], native_source['width'])
                        native_pixels = native_pixels[[2, 0, 1]].transpose(1, 2, 0).astype(np.float64)
                        native_pixels *= native_source['normalization_nits']
                        source_measurement = compare_appearance(source_hdr, native_pixels,
                            reference_gamut=source_hdr_gamut, actual_gamut=native_source['gamut'],
                            fixture_class='gainmap-hdr')
                        case['source_precision_evidence'] = native_source
                        case['measurements']['native_hdr_source'] = source_measurement
                        case['checks']['native_source_precision'] = source_measurement['passed']
                    if 'orientation_source' in encoded:
                        case['orientation_source'] = encoded['orientation_source']
                    actual_geometry = gainmap_hdr.read_linear(encoded['hdr_geometry'])
                    geometry_measurement = compare_appearance(hdr_reference, actual_geometry,
                        reference_gamut=reference_gamut, actual_gamut=encoded['hdr_geometry']['gamut'],
                        fixture_class='gainmap-hdr')
                    case['measurements']['native_hdr_geometry'] = geometry_measurement
                    case['checks']['native_geometry'] = geometry_measurement['passed']
                    hdr_intent = Path(encoded['hdr_intent_pq_png'])
                    intent_facts = gainmap.inspect(hdr_intent, folder/'hdr-intent-inspection')
                    intent_tags = intent_facts['metadata']
                    intent_signal = avif.read_png(hdr_intent)
                    intent_cicp = [intent_tags.get('PNG-cICP:'+field) for field in (
                        'ColorPrimaries', 'TransferCharacteristics', 'MatrixCoefficients', 'VideoFullRangeFlag')]
                    intent_structure = (intent_cicp == [{'srgb': 1, 'p3': 12}[gamut], 16, 0, 1]
                        and intent_facts['coded_depth'] == 16
                        and intent_signal.shape[:2] == hdr_reference.shape[:2]
                        and intent_facts['frame_count'] == 1 and intent_facts['opaque']
                        and intent_tags.get('IFD0:Orientation', 1) == 1 and not intent_facts['private_tags'])
                    intent_measurement = compare_appearance(hdr_reference,
                        avif.decode_transfer(intent_signal[..., :3], 'pq', gamut), reference_gamut=reference_gamut,
                        actual_gamut=gamut, fixture_class='gainmap-hdr')
                    case['measurements']['native_hdr_intent_png'] = intent_measurement
                    case['hdr_intent'] = {'path': str(hdr_intent), 'sha256': gainmap.digest(hdr_intent),
                        'facts': intent_facts, 'purpose': 'Native HDR intent comparison file; '
                        'independently inspected and measured, not an independent reference or consumer qualification'}
                    facts = gainmap.inspect(target, folder/'inspection')
                    actual_sdr, sdr_facts = gainmap_sdr.decode(target, gamut=gamut)
                    sdr_measurement = compare_appearance(sdr_signal_to_nits(np.asarray(sdr_reference)/255),
                        sdr_signal_to_nits(actual_sdr), reference_gamut=gamut, actual_gamut=gamut,
                        fixture_class='gainmap-sdr')
                    raw = folder/'independent-native-hdr.gbrpf32'
                    native_facts = json.loads(gainmap.command(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr',
                        'decode-linear', target, raw, '16'], folder/'independent-native-hdr.log'))
                    hdr_gamut = {0: 'srgb', 1: 'p3', 2: 'rec2020'}[native_facts['gamut']]
                    actual_hdr = np.fromfile(raw, dtype='<f4').reshape(3, native_facts['height'], native_facts['width'])
                    actual_hdr = actual_hdr[[2, 0, 1]].transpose(1, 2, 0)*203
                    decoded_iso = decode_iso_source(target.read_bytes(), (folder/'inspection/map.jpg').read_bytes())
                    cross_decoder = compare_appearance(decoded_iso['linear_rgb_nits'], actual_hdr,
                        reference_gamut=decoded_iso['gamut'], actual_gamut=hdr_gamut, fixture_class='gainmap-hdr')
                    case['checks']['independent_decoder'] = cross_decoder['passed']
                    hdr_measurement = compare_appearance(hdr_reference, actual_hdr, reference_gamut=reference_gamut,
                                                        actual_gamut=hdr_gamut, fixture_class='gainmap-hdr')
                    case['measurements'].update({'authored_sdr_base': sdr_measurement,
                        'reconstructed_hdr': hdr_measurement, 'independent_hdr_cross_decoder': cross_decoder})
                    case['checks']['appearance'] = (sdr_measurement['passed'] and hdr_measurement['passed']
                                                   and intent_measurement['passed'])
                    native_metadata = json.loads(gainmap.command([
                        '/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', target],
                        folder/'independent-native-metadata.log'))
                    metadata_agreement = check_metadata(facts, native_metadata)
                    case['gain_map_metadata_agreement'] = metadata_agreement
                    case['native_metadata_probe'] = native_metadata
                    structure = {'dimensions': actual_hdr.shape == hdr_reference.shape and actual_sdr.shape == hdr_reference.shape,
                        'coded_depths': facts['base']['depth'] == 8 and facts['map']['depth'] == 8,
                        'gamut': sdr_facts['gamut'] == gamut and hdr_gamut == gamut and decoded_iso['gamut'] == gamut,
                        'orientation': facts['metadata'].get('IFD0:Orientation', 1) == 1,
                        'static_opaque': facts['frame_count'] == 1 and facts['opaque'],
                        'hdr_intent_png': intent_structure,
                        'dual_metadata': bool(facts['iso_identifier'] and facts['android_xmp_properties']),
                        'metadata_agreement': all(metadata_agreement['checks'].values()),
                        'hdr_capacity': facts['iso_metadata']['alternate_headroom'] > facts['iso_metadata']['base_headroom']}
                    case['structural_checks'] = structure
                    case['checks']['structure'] = all(structure.values())
                    case['checks']['privacy'] = not facts['private_tags']
                    case['facts'] = facts
                    case['sdr_decoder_evidence'] = sdr_facts
                    case['hdr_decoder_evidence'] = {'native': native_facts, 'iso': decoded_iso['evidence']}
                    case['artifacts'] = {'output': str(target), 'sha256': gainmap.digest(target),
                        'reference_sdr': str(reference_sdr), 'reference_sdr_sha256': gainmap.digest(reference_sdr)}
                    if coding in ('dct-rgb', 'dct-float-rgb'):
                        # Keep this third decoder route's extra native map
                        # conversion visible. It is neither the encoder nor a
                        # physical consumer, and it must not erase its failures
                        # when the independent JPEG/ISO reconstruction passes.
                        decoder_directory = folder/'baseline-libavif-decoder'
                        decoder_directory.mkdir(exist_ok=True)
                        diagnostic = {'decoded': False, 'status': 'tested and failed',
                            'scope': 'Pinned libavif JPEG to AVIF to PQ raster route; RGB map samples '
                                     'are converted to 8-bit BT.601 YCbCr. No physical consumer qualification.'}
                        try:
                            libavif_hdr = gainmap.independent_hdr(target, decoder_directory, gamut)
                            diagnostic['decoded'] = True
                            diagnostic['measurement'] = compare_appearance(hdr_reference, libavif_hdr,
                                reference_gamut=reference_gamut, actual_gamut='rec2020', fixture_class='gainmap-hdr')
                            if diagnostic['measurement']['passed']:
                                diagnostic['status'] = 'qualified'
                        except Exception as error:
                            diagnostic['failure'] = str(error)
                        case['consumer_decoder_diagnostics'] = {'baseline_libavif': diagnostic}
                    case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
                    if all(case['checks'].values()):
                        case['status'] = 'qualified'
                except Exception as error:
                    case['blockers'].append(str(error))
                cases.append(case)
    return cases
