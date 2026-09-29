"""Old Apple HDR JPEG geometries using the independently documented full effect.

Contain, cover, fill, upscale and real EXIF6 orientation at display boost 16 are measured. The source's full headroom
is 8, and no intermediate Apple adaptation model is inferred. Native float
source preparation, native geometry and PQ intent are separately checked
before the existing midpoint-offset/gamma1.5 FLOAT map encoder. The original
native authored SDR base and legacy endpoint remain unchanged controls.
"""
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

import apple_native_source
import apple_orientation_source
import apple_source_model
import avif
import gainmap
import gainmap_hdr
import gainmap_linear
import gainmap_sdr
import hdr_png
import icc_gainmap
from appearance import compare_appearance, sdr_signal_to_nits, THRESHOLDS_SHA256
from gainmap_avif_hdr_jpeg import _layer_structure
from gainmap_metadata import check_metadata
from gamma_icc import decode_signal_to_nits, profile_facts
from matrix import GAINMAP_GEOMETRIES

SELECTORS = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
SIZES = {'contain': (173, 231), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 1025),
         'orientation': (173, 130)}
REVISION = apple_source_model.REFERENCE_REVISION
DEPENDENCIES = ('apple_hdr_jpeg.py', 'test_apple_hdr_jpeg.py', *apple_native_source.DEPENDENCIES,
                'gainmap_linear.py', 'gainmap_hdr.py', 'icc_gainmap.py', 'gainmap_metadata.py',
                'gainmap_avif_hdr_jpeg.py', 'gamma_icc.py', 'dct_jpeg.py', 'native_icc_gainmap.cpp',
                'native_dct_jpeg.c', 'gainmap_combine.py', 'gainmap_reference.py', 'matrix.py',
                *apple_orientation_source.DEPENDENCIES)


def _selectors(operation):
    return {**{key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')},
            **GAINMAP_GEOMETRIES[operation]}


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')


def _intent(geometry, path, *, operation='contain'):
    if operation not in SIZES:
        raise ValueError('Unproved native HDR geometry')
    width, height = SIZES[operation]
    if (geometry.get('format') != 'gbrapf32le' or geometry.get('gamut') != 'p3'
            or geometry.get('normalization_nits') != 203 or (geometry.get('width'), geometry.get('height')) != (width, height)):
        raise ValueError('Known P3 float geometry and 203-nit normalization are required')
    filters = ('setparams=alpha_mode=premultiplied,zscale=agamma=0:transferin=linear:transfer=16:'
        'primariesin=12:primaries=12:matrixin=0:matrix=0:rangein=full:range=full:npl=203,'
        'format=gbrapf32le:alpha_modes=premultiplied,format=gbrpf32le,'
        'zscale=agamma=0:transferin=16:transfer=16:primariesin=12:primaries=12:'
        'matrixin=0:matrix=0:rangein=full:range=full:npl=10000,format=rgb48le,setsar=1')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
        '-s', f'{width}x{height}', '-i', geometry['path'], '-vf', filters, '-frames:v', '1',
        '-map_metadata', '-1', '-threads', '1', path])
    return filters


def inspect_intent(path, directory, *, dimensions=(173, 231)):
    if tuple(dimensions) not in SIZES.values():
        raise ValueError('Unproved native HDR intent dimensions')
    width, height = dimensions
    color = hdr_png.inspect_source(path)
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    kinds = [kind for kind, _ in chunks]
    required = (b'IHDR', b'cICP', b'cHRM', b'pHYs', b'IEND')
    if (any(kind not in (*required, b'IDAT') for kind in kinds)
            or any(kinds.count(kind) != 1 for kind in required) or b'IDAT' not in kinds
            or any(kinds.index(kind) > kinds.index(b'IDAT') for kind in required[:-1])):
        raise ValueError('Unknown native HDR PNG structure or private metadata')
    fields = {kind: payload for kind, payload in chunks if kind != b'IDAT'}
    if (fields[b'IHDR'] != struct.pack('>IIBBBBB', width, height, 16, 2, 0, 0, 0)
            or fields[b'pHYs'] != struct.pack('>IIB', 1, 1, 0)
            or fields[b'cICP'] != bytes((12, 16, 0, 1))
            or fields[b'cHRM'] != struct.pack('>8I', 31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000)
            or any(color.get(key) != value for key, value in {'width': width, 'height': height,
                'depth': 16, 'primaries': 12, 'transfer': 16, 'orientation': 1}.items())):
        raise ValueError('Native HDR intent has unknown color, depth, geometry or pixel aspect')
    facts = gainmap.inspect(Path(path), Path(directory))
    pixels = avif.read_png(path)
    if (facts['private_tags'] or facts['frame_count'] != 1 or not facts['opaque']
            or [facts['metadata'].get('PNG-pHYs:'+key) for key in ('PixelsPerUnitX', 'PixelsPerUnitY', 'PixelUnits')] != [1, 1, 0]
            or pixels.shape != (height, width, 4) or not np.all(pixels[..., 3] == 1)):
        raise ValueError('Independent PNG reader does not establish private-metadata-free static opaque intent')
    return {'path': str(path), 'sha256': avif.digest(path), 'color': color, 'facts': facts,
            'square_pixels': True, 'purpose': 'Native PQ16 encoding intent, not independent reference'}, avif.decode_transfer(pixels[..., :3], 'pq', 'p3')


def inspect_output(path, directory, *, dimensions=(173, 231)):
    if tuple(dimensions) not in SIZES.values():
        raise ValueError('Unproved HDR JPEG dimensions')
    width, height = dimensions
    path, directory = Path(path), Path(directory)
    facts = gainmap.inspect(path, directory)
    if (not facts.get('gain_map_present') or not facts.get('iso_metadata') or not facts.get('android_xmp_properties')
            or facts['private_tags'] or facts['frame_count'] != 1 or not facts['opaque']):
        raise ValueError('Unknown HDR JPEG gain metadata, privacy, motion or alpha')
    expected = {'depth': 8, 'width': width, 'height': height, 'components': 3, 'sof': 0}
    if any(facts[layer] != expected for layer in ('base', 'map')):
        raise ValueError('Expected actual contained baseline RGB8 base and map')
    data, gain = path.read_bytes(), (directory/'map.jpg').read_bytes()
    tags = facts['metadata']
    base_size, map_size = tags.get('MPImage1:MPImageLength'), tags.get('MPImage2:MPImageLength')
    if (type(base_size) is not int or type(map_size) is not int or min(base_size, map_size) <= 0
            or base_size+map_size != len(data) or map_size != len(gain) or data[base_size:] != gain
            or tags.get('MPF0:NumberOfImages') != 2 or tags.get('MPImage1:MPImageStart') != 0
            or tags.get('MPImage2:MPImageStart') != base_size
            or tags.get('XMP-GContainer:DirectoryItemSemantic') != ['Primary', 'GainMap']
            or tags.get('XMP-GContainer:DirectoryItemMime') != ['image/jpeg']*2
            or tags.get('XMP-GContainer:DirectoryItemLength') != map_size):
        raise ValueError('Emitted file does not establish exactly two declared JPEG layers')
    facts['layer_structure'] = {'base': _layer_structure(data[:base_size], dimensions),
                               'map': _layer_structure(gain, dimensions)}
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
    decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=3.2, expected_gamut='p3')
    facts['actual_base_icc'] = profile_facts(profile)
    with Image.open(directory/'map.jpg') as image:
        if image.info.get('icc_profile'):
            raise ValueError('The gain map must not carry a display ICC')
    probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', path]))
    agreement = check_metadata(facts, probe)
    if (not all(agreement['checks'].values()) or probe['gamma'] != [1.5]*3
            or len(facts['iso_metadata']['channels']) != 3
            or any(channel[key] != 1/16384 for channel in facts['iso_metadata']['channels']
                   for key in ('base_offset', 'alternate_offset'))):
        raise ValueError('Actual native/ISO/XMP metadata differs from the declared map recipe')
    facts['native_metadata_probe'], facts['metadata_agreement'] = probe, agreement
    return facts


def _control(directory, operation, *, source=apple_source_model.SOURCE):
    if operation in ('contain', 'upscale'):
        return icc_gainmap.run(directory, source_id='gainmap-apple-old', operation=operation,
                              map_policy='midpointoffset', map_gamma=1.5, map_method='float')
    # These additional requests reuse only the established native authored-SDR
    # stage; this control adds no legacy HDR interpretation or qualification.
    directory.mkdir(parents=True, exist_ok=True)
    source, base = Path(source), directory/'gamma32-base.jpg'
    encoding = gainmap_sdr.encode(source, base, operation, gamut='p3', gamma=3.2)
    reference = gainmap.geometry(gainmap.source_image(source, 'preserve'), operation, 6 if operation == 'orientation' else 1)
    profile = reference.info.get('icc_profile')
    reference.info.clear()
    ref_path = directory/'reference-sdr.png'
    reference.save(ref_path, icc_profile=profile)
    actual, facts = gainmap_sdr.decode_linear(base, gamut='p3', gamma=3.2)
    measure = compare_appearance(sdr_signal_to_nits(np.asarray(reference)/255), actual,
        reference_gamut='p3', actual_gamut='rec2020', fixture_class='gainmap-sdr')
    return {'scope': 'Authored SDR control only; no additional legacy HDR interpretation or endpoint is qualified',
        'cases': [{'status': 'qualified' if measure['passed'] and facts['privacy'] else 'tested and failed',
            'geometry': operation, 'native_candidate': {'base': str(base), 'base_sha256': avif.digest(base), 'base_encoding': encoding},
            'measurements': {'authored_sdr_base': measure}, 'sdr_decoder_evidence': facts,
            'reference_sdr': {'path': str(ref_path), 'sha256': avif.digest(ref_path), 'gamut': 'p3',
                'transfer': 'srgb', 'purpose': 'Independent matched-geometry authored SDR base'}}]}


def _run_one(directory, *, source, selectors=None, operation='contain'):
    source, directory = Path(source), Path(directory)
    admitted_source_hash = avif.digest(source)
    if (operation not in SIZES or (selectors is not None and selectors != _selectors(operation))
            or admitted_source_hash != apple_source_model.SOURCE_SHA256):
        raise ValueError('Only the locked old Apple source and exact declared HDR JPEG selectors are admitted')
    width, height = SIZES[operation]
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).parent/name) for name in DEPENDENCIES}
    parent_source = source
    if operation == 'orientation':
        source = apple_orientation_source.generate(directory/'orientation-fixture', parent=parent_source)
        if avif.digest(source) != apple_orientation_source.SOURCE_SHA256:
            raise ValueError('Generated EXIF6 source changed before native conversion')
    actual_source_hash = avif.digest(source)
    orientation = 6 if operation == 'orientation' else 1
    control = _control(directory/'legacy-converter', operation, source=source)
    legacy = control['cases'][0]
    candidate = 'native-combine-icc-gamma32-midpointoffset-dct-float-map-source-apple-documented-full'
    case = {'case_id': f'gainmap-apple-old:hdr:jpg:preserve:preserve:{operation}:{candidate}:{REVISION}:render-boost16',
        'cell_id': 'gainmap-jpeg:hdr:jpg', 'fixture_id': 'gainmap-apple-old', 'proof_module': 'apple_hdr_jpeg',
        'candidate': candidate, 'geometry': operation, 'selectors': _selectors(operation),
        'source_sha256': apple_source_model.SOURCE_SHA256, 'source_reference_revision': REVISION,
        'source_precision': 'documented full-effect float32', 'status': 'tested and failed',
        'consumer_status': 'pending manual review',
        'qualification_scope': 'ICC-aware native and independent file readers at display boost 16 only; '
            'the original Apple full effect has source headroom 8. No intermediate adaptation or physical display qualification.',
        'known_consumer_limitations': ['The encoded gamma 3.2 base requires actual ICC interpretation. '
            'The stock sRGB-assuming reader remains a separate diagnostic.',
            'Source boost 2 semantics and browser/OS wallpaper behavior remain unqualified.'],
        'rendering_scope': {'display_boost': 16, 'source_full_headroom': 8, 'source_gain_map_weight': 1,
            'source_reference_revision': REVISION, 'scope': 'Documented full effect only; no inferred partial Apple adaptation'},
        'threshold_scope': {'source_reference_revision': REVISION, 'thresholds_sha256': THRESHOLDS_SHA256,
            'hdr_profile': 'gainmap-hdr', 'sdr_profile': 'gainmap-sdr',
            'geometry': 'Unchanged independent float32 Lanczos in P3 after full source reconstruction',
            'base': ('Unchanged native authored SDR containment, actual gamma3.2 P3 ICC, baseline RGB8 JPEG'
                     if operation == 'contain' else 'Established native authored SDR geometry, actual gamma3.2 P3 ICC, baseline RGB8 JPEG'),
            'recipe': 'Existing native midpointoffset1/16384, gamma1.5, FLOAT DCT RGB8 map against actual compressed base'},
        'checks': {name: False for name in ('native_encoder', 'independent_source_decoder', 'native_source_precision',
            'native_geometry', 'hdr_intent', 'independent_decoder', 'structure', 'appearance', 'privacy',
            'full_headroom', 'integrity')}, 'measurements': {}, 'artifacts': {}, 'blockers': []}
    report = {'converter_control': control, 'cases': [case], 'reference_revision': REVISION,
              'scope': f'One separately encoded old Apple {operation} under the documented full model; legacy evidence is unchanged'}
    try:
        prepared = (apple_orientation_source.run(directory/'documented-source', source=source)
                    if operation == 'orientation' else apple_native_source.run(directory/'documented-source'))
        report['native_source_preparation'] = prepared
        if prepared['status'] != 'qualified source preparation' or not all(prepared['checks'].values()):
            raise ValueError('Documented Apple source preparation did not qualify')
        if not legacy['measurements']['authored_sdr_base']['passed']:
            raise ValueError('Unchanged authored SDR preparation control failed')
        native = prepared['native_source']
        if operation == 'orientation':
            if (native.get('source_orientation') != 6 or native.get('orientation_applied') is not False
                    or prepared['orientation_source']['sha256'] != actual_source_hash
                    or prepared['orientation_source']['path'] != str(source)):
                raise ValueError('Actual EXIF6 source must remain unrotated until derivative geometry')
            case['orientation_source'] = prepared['orientation_source']
            case['rendering_scope'].update({'source_orientation': 6, 'orientation_applications': 1})
            case['threshold_scope']['geometry'] = 'Independently reconstruct the unchanged stored raster, rotate EXIF6 clockwise once, then the established P3 float32 Lanczos containment'
        geometry = gainmap_linear.resample_linear(native, directory/'geometry.gbrapf32', operation, orientation)
        intent = directory/'native-intent-pq.png'
        filters = _intent(geometry, intent, operation=operation)
        intent_facts, intent_nits = inspect_intent(intent, directory/'intent-inspection', dimensions=(width, height))
        base, output = Path(legacy['native_candidate']['base']), directory/'output.jpg'
        if avif.digest(base) != legacy['native_candidate']['base_sha256']:
            raise ValueError('Native authored SDR base integrity changed')
        candidate_facts = icc_gainmap.pack(base, intent, output, map_policy='midpointoffset', map_gamma=1.5, map_method='float')
        case['checks']['native_encoder'] = True
        case['artifacts'] = {'source': str(source), 'source_sha256': actual_source_hash,
                             'output': str(output), 'sha256': avif.digest(output)}
        expected = gainmap.array_geometry(np.load(prepared['reference']['path']), operation, orientation)
        reference_path = directory/'independent-documented-full.npy'
        np.save(reference_path, expected)
        reference = {'path': str(reference_path), 'sha256': avif.digest(reference_path), 'gamut': 'p3',
            'transfer': 'linear', 'units': 'cd/m2', 'dimensions': [width, height], 'display_boost': 16,
            'source_reference_revision': REVISION, 'purpose': 'Independent documented full effect, then unchanged matched geometry'}
        facts = inspect_output(output, directory/'inspection', dimensions=(width, height))
        output_map = directory/'inspection/map.jpg'
        bound = {**prepared['bound_files'], str(source): actual_source_hash, str(parent_source): admitted_source_hash,
            str(base): candidate_facts['base_sha256'], str(output): avif.digest(output),
            str(output_map): avif.digest(output_map), str(intent): intent_facts['sha256'],
            str(geometry['path']): avif.digest(geometry['path']), str(reference_path): reference['sha256'],
            legacy['reference_sdr']['path']: legacy['reference_sdr']['sha256']}
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='p3', gamma=3.2)
        actual_hdr, native_facts = icc_gainmap.native_decode(output, directory/'native-hdr.rgbf32', boost=16)
        independent, independent_facts = icc_gainmap.independent_decode(output, output_map, boost=16)
        with Image.open(legacy['reference_sdr']['path']) as image:
            reference_sdr = sdr_signal_to_nits(np.asarray(image.convert('RGB'))/255)
        measurements = {'native_hdr_source': prepared['measurement'],
            'native_hdr_geometry': _measure(expected, gainmap_hdr.read_linear(geometry)),
            'native_hdr_intent_png': _measure(expected, intent_nits),
            'authored_sdr_base': compare_appearance(reference_sdr, actual_sdr, reference_gamut='p3',
                                                   actual_gamut='rec2020', fixture_class='gainmap-sdr'),
            'reconstructed_hdr': _measure(expected, actual_hdr), 'independent_hdr': _measure(expected, independent),
            'independent_hdr_cross_decoder': _measure(independent, actual_hdr)}
        probe = facts['native_metadata_probe']
        structural = {'dimensions': actual_sdr.shape == actual_hdr.shape == independent.shape == expected.shape == (height, width, 3),
            'gamut': native_facts['gamut'] == independent_facts['gamut'] == sdr_facts['gamut'] == 'p3',
            'actual_base_icc': sdr_facts['icc_sha256'] == legacy['native_candidate']['base_encoding']['icc_sha256'],
            'source_coded_depths': all(native['source_facts']['facts'][layer]['depth'] == 8 for layer in ('base', 'map')),
            'metadata_agreement': all(facts['metadata_agreement']['checks'].values())}
        full = (probe['hdr_capacity_min'] == 1 and 1 < probe['hdr_capacity_max'] <= 16
                and independent_facts['gain_map_weight'] == 1)
        case['rendering_scope'].update({'output_gain_map_weight': independent_facts['gain_map_weight'],
            'output_capacity_headroom_log2': independent_facts['iso_metadata']['alternate_headroom'],
            'native_weight_derived_from_verified_metadata': float(min(np.log2(16)/np.log2(probe['hdr_capacity_max']), 1)),
            'native_weight_basis': 'Derived from verified capacities and recorded boost16 call, not a native returned observation'})
        case.update({'source_facts': native['source_facts']['facts'], 'source_decoder_evidence': prepared,
            'native_candidate': candidate_facts, 'source_precision_evidence': native, 'native_geometry': geometry,
            'hdr_intent': {**intent_facts, 'filters': filters}, 'facts': facts, 'structural_checks': structural,
            'gain_map_metadata_agreement': facts['metadata_agreement'], 'native_metadata_probe': probe,
            'measurements': measurements, 'reference_hdr': reference, 'reference_sdr': legacy['reference_sdr'],
            'sdr_decoder_evidence': sdr_facts, 'hdr_decoder_evidence': {'native': native_facts, 'independent': independent_facts}})
        case['checks'].update({'independent_source_decoder': True, 'native_source_precision': prepared['measurement']['passed'],
            'native_geometry': measurements['native_hdr_geometry']['passed'], 'hdr_intent': measurements['native_hdr_intent_png']['passed'],
            'independent_decoder': measurements['independent_hdr_cross_decoder']['passed'], 'structure': all(structural.values()),
            'appearance': all(value['passed'] for value in measurements.values()),
            'privacy': not facts['private_tags'] and sdr_facts['privacy'], 'full_headroom': bool(full)})
        diagnostic = {'status': 'tested and failed', 'display_boost': 16,
            'scope': 'Pinned sRGB-assuming reader, independent of ICC-aware qualification', 'consumer_status': 'pending manual review'}
        try:
            raw = directory/'stock-native.gbrpf32'
            stock = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'decode-linear', output, raw, '16']))
            values = np.fromfile(raw, '<f4').reshape(3, stock['height'], stock['width'])[[2, 0, 1]].transpose(1, 2, 0)*203
            diagnostic['measurement'] = compare_appearance(expected, values, reference_gamut='p3',
                actual_gamut={0: 'srgb', 1: 'p3', 2: 'rec2020'}[stock['gamut']], fixture_class='gainmap-hdr')
            diagnostic.update({'facts': stock, 'raw_path': str(raw), 'raw_sha256': avif.digest(raw)})
            if diagnostic['measurement']['passed']:
                diagnostic['status'] = 'qualified'
        except Exception as error:
            diagnostic['failure'] = str(error)
        case['consumer_decoder_diagnostics'] = {'stock_native_srgb': diagnostic}
        case['known_consumer_limitations'].append(f"stock_native_srgb file diagnostic at boost 16: {diagnostic['status']}.")
        if (any(avif.digest(path) != sha for path, sha in bound.items())
                or any(avif.digest(Path(__file__).parent/name) != sha for name, sha in hashes.items())):
            raise ValueError('Source, reference or emitted output integrity changed during decoding')
        case['checks']['integrity'] = True
        case['bound_files'] = bound
        case['blockers'] = [f'Failed {name} check' for name, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    report['commands'], report['source_hashes'] = avif.COMMANDS[start:], hashes
    report['gainmap_commands'] = []
    for log in sorted(directory.rglob('*.log')):
        try:
            record = json.loads(log.read_text())
            if isinstance(record, dict) and 'command' in record:
                report['gainmap_commands'].append({'log': str(log), **record})
        except (UnicodeError, json.JSONDecodeError):
            pass
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


def run(directory, *, source=apple_source_model.SOURCE, selectors=None, geometries=('contain',)):
    geometries = tuple(geometries)
    if (not geometries or len(set(geometries)) != len(geometries) or any(operation not in SIZES for operation in geometries)
            or selectors is not None and (len(geometries) != 1 or selectors != _selectors(geometries[0]))):
        raise ValueError('Expected distinct proved geometries and at most one exact selector request')
    directory = Path(directory)
    reports = [_run_one(directory if operation == 'contain' else directory/operation,
                        source=source, selectors=selectors, operation=operation) for operation in geometries]
    report = reports[0]
    if len(reports) > 1:
        report['additional_geometry_results'] = reports[1:]
        report['cases'] = [case for result in reports for case in result['cases']]
        report['commands'] = [command for result in reports for command in result['commands']]
        report['gainmap_commands'] = [command for result in reports for command in result['gainmap_commands']]
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
