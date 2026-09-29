"""Explicit PQ8/PQ10/PQ12 P3 AVIF geometries from documented old Apple full HDR.

Declared before measurements: unchanged photographic gainmap-hdr regional
gates apply to source, float Lanczos geometry, native PQ intent and final AV1
decoding. No source quantization allowance is added. Native source pixels feed
FFmpeg/zimg and AOM; the documented reference is used only for measurement.
Only contain, cover, fill, upscale and a separately locked EXIF6 variant are
admitted at explicit 8/10/12-bit depth. Orientation applies exactly once after
the documented full effect in original stored raster coordinates.
This single-layer output measures full HDR only. It neither preserves an
authored SDR base inside the output nor establishes intermediate adaptation.
"""
import json
from pathlib import Path

import numpy as np

import apple_native_source
import apple_orientation_source
import apple_source_model
import avif
import gainmap
import gainmap_hdr
import gainmap_linear
import hdr_png8_precision
from appearance import compare_appearance, THRESHOLDS_SHA256
from gainmap_avif_hdr import _pixel_aspect
from matrix import GAINMAP_GEOMETRIES

SELECTORS = {'format': 'avif', 'range': 'hdr', 'gamut': 'preserve', 'depth': '12',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
SIZES = {'contain': (173, 231), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 1025),
         'orientation': (173, 130)}
DEPTHS = (8, 10, 12)
DEPENDENCIES = ('apple_hdr_avif.py', 'test_apple_hdr_avif.py', *apple_native_source.DEPENDENCIES,
                'gainmap_linear.py', 'gainmap_hdr.py', 'hdr_png8_precision.py', 'gainmap_avif_hdr.py', 'matrix.py',
                *apple_orientation_source.DEPENDENCIES)


def _selectors(operation, depth):
    return {**{key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')},
            **GAINMAP_GEOMETRIES[operation], 'depth': str(depth)}


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')


def _encode(linear, directory, *, operation='contain', depth=12):
    if operation not in SIZES or type(depth) is not int or depth not in DEPTHS:
        raise ValueError('Only the declared explicit8/10/12-bit native geometries are admitted')
    width, height = SIZES[operation]
    if (linear.get('format') != 'gbrapf32le' or linear.get('gamut') != 'p3'
            or linear.get('normalization_nits') != 203
            or (linear.get('width'), linear.get('height')) != (width, height)):
        raise ValueError('Only the declared P3 float geometry is admitted')
    png, output = directory/'native-intent-pq.png', directory/'output.avif'
    filters = ('setparams=alpha_mode=premultiplied,zscale=agamma=0:transferin=linear:transfer=16:'
        'primariesin=12:primaries=12:matrixin=0:matrix=0:rangein=full:range=full:npl=203,'
        'format=gbrapf32le:alpha_modes=premultiplied,format=gbrpf32le,'
        'zscale=agamma=0:transferin=16:transfer=16:primariesin=12:primaries=12:'
        'matrixin=0:matrix=0:rangein=full:range=full:npl=10000,format=rgb48le,setsar=1')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
        '-s', f'{width}x{height}', '-i', linear['path'], '-vf', filters, '-frames:v', '1',
        '-map_metadata', '-1', '-threads', '1', png])
    facts, pixels = hdr_png8_precision.inspect_hdr_png16(png)
    if ((facts['primaries'], facts['transfer'], facts['color_type']) != (12, 16, 2)
            or pixels.shape != (height, width, 4) or not np.all(pixels[..., 3] == 1)):
        raise ValueError('Native PQ intent signaling, dimensions or opacity differ')
    avif.encode_avif([png], output, 'pq', 'p3', depth)
    return output, {'path': str(png), 'sha256': avif.digest(png), 'facts': facts,
        'filters': filters, 'purpose': 'Native encoding intent, not independent reference'}, pixels


def _run_one(directory, *, source, selectors, operation, depth):
    source = Path(source)
    requested = _selectors(operation, depth)
    width, height = SIZES[operation]
    if ((selectors is not None and selectors != requested)
            or avif.digest(source) != apple_source_model.SOURCE_SHA256):
        raise ValueError('Only the locked source and exact explicit-depth P3 selectors are admitted; original only otherwise')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).parent/name) for name in DEPENDENCIES}
    case = {'case_id': f'gainmap-apple-old:hdr:avif:preserve:{depth}:{operation}:documented-full-native',
        'cell_id': 'gainmap-jpeg:hdr:avif', 'fixture_id': 'gainmap-apple-old',
        'source_sha256': apple_source_model.SOURCE_SHA256, 'source_reference_revision': apple_source_model.REFERENCE_REVISION,
        'proof_module': 'apple_hdr_avif', 'candidate': f'documented-full-native-pq{depth}',
        'geometry': operation, 'selectors': requested, 'status': 'tested and failed',
        'consumer_status': 'pending manual review',
        'qualification_scope': f'One explicit single-layer PQ{depth} P3 AVIF at documented full Apple effect, after '
            + ('containment. ' if operation == 'contain' else operation+'. ') +
            'Other depths, geometries, source models and physical consumers require separate evidence.',
        'known_consumer_limitations': ['The output has no embedded authored SDR base or gain map. '
            'Automatic display tone mapping and OS wallpaper behavior remain pending physical review.'],
        'rendering_scope': {'source_full_headroom': 8, 'source_reference_revision': apple_source_model.REFERENCE_REVISION,
            'output': 'Fixed absolute PQ luminance, not an adaptive gain map', 'intermediate_adaptation_qualified': False},
        'threshold_scope': {'declared_before_native_measurements': True, 'profile': 'gainmap-hdr',
            'thresholds_sha256': THRESHOLDS_SHA256, 'source_quantization_allowance': 0,
            'reference': 'Documented full Rec709/linear old Apple source, then unchanged independent P3 float Lanczos '
                + ('containment' if operation == 'contain' else operation)},
        'checks': {key: False for key in ('native_encoder', 'independent_source_decoder', 'native_source_precision',
            'native_geometry', 'hdr_intent', 'independent_decoder', 'structure', 'appearance', 'privacy', 'integrity')},
        'measurements': {}, 'artifacts': {}, 'blockers': []}
    report = {'cases': [case]}
    try:
        actual_source = source
        orientation = 6 if operation == 'orientation' else 1
        source_hash = apple_source_model.SOURCE_SHA256
        if operation == 'orientation':
            actual_source = apple_orientation_source.generate(directory/'orientation-fixture', parent=source)
            source_hash = apple_orientation_source.SOURCE_SHA256
            if avif.digest(actual_source) != source_hash:
                raise ValueError('Generated EXIF6 source changed before native preparation')
        prepared = (apple_orientation_source.run(directory/'source', source=actual_source)
                    if operation == 'orientation' else apple_native_source.run(directory/'source'))
        report['source_preparation'] = prepared
        if prepared['status'] != 'qualified source preparation' or not all(prepared['checks'].values()):
            raise ValueError('Documented native source preparation did not qualify')
        if operation == 'orientation':
            native = prepared['native_source']
            if (native.get('source_orientation') != 6 or native.get('orientation_applied') is not False
                    or prepared['orientation_source']['sha256'] != source_hash
                    or prepared['orientation_source']['path'] != str(actual_source)):
                raise ValueError('Actual EXIF6 source must remain unrotated until derivative geometry')
            case['orientation_source'] = prepared['orientation_source']
            case['rendering_scope'].update({'source_orientation': 6, 'orientation_applications': 1})
            case['threshold_scope']['reference'] = 'Documented full effect in the original stored raster, one independent EXIF6 clockwise rotation, then unchanged P3 float Lanczos containment'
        reference = gainmap.array_geometry(np.load(prepared['reference']['path']), operation, orientation)
        reference_path = directory/'independent-full-reference.npy'
        np.save(reference_path, reference)
        sdr = gainmap.geometry(gainmap.source_image(actual_source, 'preserve'), operation, orientation)
        profile = sdr.info.get('icc_profile')
        sdr.info.clear()
        sdr_path = directory/'reference-sdr.png'
        sdr.save(sdr_path, icc_profile=profile)
        linear = gainmap_linear.resample_linear(prepared['native_source'], directory/'native-geometry.gbrapf32', operation, orientation)
        output, intent, intent_pixels = _encode(linear, directory, operation=operation, depth=depth)
        bound = {**prepared['bound_files'], str(source): apple_source_model.SOURCE_SHA256,
            str(actual_source): source_hash,
            str(output): avif.digest(output), str(reference_path): avif.digest(reference_path),
            str(sdr_path): avif.digest(sdr_path),
            str(linear['path']): avif.digest(linear['path']), intent['path']: intent['sha256']}
        case['checks']['native_encoder'] = True
        case['artifacts'] = {'source': str(actual_source), 'source_sha256': source_hash,
                             'output': str(output), 'sha256': bound[str(output)]}
        facts = avif.inspect_avif(output)
        frames = avif.decode_avif(output, directory, 1)
        if avif.digest(output) != bound[str(output)]:
            raise ValueError('Emitted output integrity changed during native decoding')
        rgba = np.concatenate((reference, np.ones((*reference.shape[:2], 1))), axis=-1)
        structural = avif.structure_checks(facts, frames, {}, [rgba], 'pq', 'p3', depth, 1)
        structural['opaque'] = bool(facts['alpha'] == 'Absent' and np.all(frames[0][..., 3] == 1))
        packet = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-count_frames',
            '-show_entries', 'stream=codec_name,width,height,pix_fmt,color_space,color_transfer,color_primaries,color_range,nb_read_frames,sample_aspect_ratio,display_aspect_ratio',
            '-of', 'json', output]))
        streams = packet.get('streams', [])
        structural['independent_packet_facts'] = len(streams) == 1 and all(streams[0].get(key) == value
            for key, value in {'codec_name': 'av1', 'width': width, 'height': height,
                'pix_fmt': 'gbrp' if depth == 8 else f'gbrp{depth}le',
                'color_space': 'gbr', 'color_transfer': 'smpte2084', 'color_primaries': 'smpte432',
                'color_range': 'pc', 'nb_read_frames': '1', 'sample_aspect_ratio': '1:1',
                'display_aspect_ratio': f'{width}:{height}' if width != height else '1:1'}.items())
        structural['pixel_aspect'] = _pixel_aspect(output)['passed']
        tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', output]))[0]
        private = gainmap.private_metadata_tags(tags)
        privacy = not private and 'XMP Metadata   : Absent' in facts['info'] and 'Exif Metadata  : Absent' in facts['info']
        measurements = {'native_source': prepared['measurement'],
            'native_geometry': _measure(reference, gainmap_hdr.read_linear(linear)),
            'native_intent': _measure(reference, avif.decode_transfer(intent_pixels[..., :3], 'pq', 'p3')),
            'hdr': _measure(reference, avif.decode_transfer(frames[0][..., :3], 'pq', 'p3'))}
        case.update({'source_facts': prepared['native_source']['source_facts']['facts'],
            'source_decoder_evidence': prepared, 'native_geometry': linear, 'hdr_intent': intent,
            'reference_hdr': {'path': str(reference_path), 'sha256': bound[str(reference_path)],
                'dimensions': [width, height], 'gamut': 'p3', 'transfer': 'linear', 'units': 'cd/m2',
                'source_reference_revision': apple_source_model.REFERENCE_REVISION},
            'reference_sdr': {'path': str(sdr_path), 'sha256': bound[str(sdr_path)], 'gamut': 'p3',
                'purpose': 'Matched authored SDR for manual comparison; this single-layer HDR file has no SDR-base qualification'},
            'facts': facts, 'structural_checks': structural, 'output_packet_facts': packet,
            'measurements': measurements, 'privacy_measurement': {'passed': privacy, 'private_tags': private}})
        case['checks'].update({'independent_source_decoder': True, 'native_source_precision': prepared['measurement']['passed'],
            'native_geometry': measurements['native_geometry']['passed'], 'hdr_intent': measurements['native_intent']['passed'],
            'independent_decoder': True, 'structure': all(structural.values()),
            'appearance': all(row['passed'] for row in measurements.values()), 'privacy': privacy})
        if (any(avif.digest(path) != sha for path, sha in bound.items())
                or any(avif.digest(Path(__file__).parent/name) != sha for name, sha in hashes.items())):
            raise ValueError('Source, reference or emitted output integrity changed during decoding')
        case['bound_files'] = bound
        case['checks']['integrity'] = True
        case['blockers'] = [f'Failed {name} check' for name, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    report.update({'commands': avif.COMMANDS[start:], 'source_hashes': hashes,
        'native_geometry_logs': [{'path': str(path), 'sha256': avif.digest(path), 'record': json.loads(path.read_text())}
                                 for path in sorted(directory.glob('*.log'))]})
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


def run(directory, *, source=apple_source_model.SOURCE, selectors=None, depths=(12,), geometries=('contain',)):
    depths, geometries = tuple(depths), tuple(geometries)
    if (not depths or any(type(depth) is not int or depth not in DEPTHS for depth in depths)
            or len(set(depths)) != len(depths)
            or not geometries or any(type(operation) is not str or operation not in SIZES for operation in geometries)
            or len(set(geometries)) != len(geometries)
            or selectors is not None and (len(depths) != 1 or len(geometries) != 1
                                         or selectors != _selectors(geometries[0], depths[0]))):
        raise ValueError('Expected distinct proved depths/geometries and at most one exact selector request')
    directory = Path(directory)
    reports = [_run_one(directory if (depth, operation) == (12, 'contain') else directory/f'{operation}-{depth}',
                        source=source, selectors=selectors, operation=operation, depth=depth)
               for depth in depths for operation in geometries]
    report = reports[0]
    if len(reports) > 1:
        report['additional_tuple_results'] = reports[1:]
        report['cases'] = [case for result in reports for case in result['cases']]
        report['commands'] = [command for result in reports for command in result['commands']]
        report['native_geometry_logs'] = [log for result in reports for log in result['native_geometry_logs']]
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
