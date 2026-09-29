"""Explicit PQ PNG16 containment from the verified gain-map AVIF renderer.

Keep the existing native source reconstruction, independent renderer convention
and gainmap-hdr limits. The original native PNG has pHYs 0:1, which does not
establish this request's square-pixel geometry. A separate native setsar=1
writer preserves every decoded RGB16/alpha sample and declares pHYs 1:1.
This is a failed proof gate for the first representation, not a claim that PNG
forbids zero density values. PNG's unit-zero pHYs carries pixel aspect:
https://www.w3.org/TR/png-3/#11pHYs

Only the emitted RGB16/CICP 1/16/0/1 subset is inspected here. This does not
widen source admission, qualify other PNG renderers or certify physical HDR.
"""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

import avif
import gainmap_avif
import gainmap_avif_hdr
import hdr_png
from appearance import compare_appearance
from gainmap import array_geometry, private_metadata_tags
from gainmap_hdr import read_linear
from gainmap_linear import resample_linear


SELECTORS = {**gainmap_avif_hdr.SELECTORS, 'format': 'png', 'depth': '16'}
POLICY = {**gainmap_avif_hdr.POLICY,
    'output_scope': 'Explicit single-layer PQ PNG16 containment in actual source sRGB primaries; opaque, static, identity orientation and explicit square pixels',
    'storage_gate': 'Independent native libpng and FFmpeg RGB16 samples must agree exactly; correcting pixel-aspect metadata must preserve every decoded RGB/alpha sample',
    'aspect_scope': 'The original pHYs 0:1 does not establish requested square-pixel geometry; its structure failure remains separate from the corrected pHYs 1:1 representation',
    'png_specification': 'https://www.w3.org/TR/png-3/#11pHYs'}
CHROMATICITIES = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000]


def validate_selectors(selectors):
    if selectors != SELECTORS:
        raise ValueError('Only the exact explicit PQ PNG16 containment selectors are admitted')


def inspect_and_decode(path, *, diagnostic_undefined_aspect=False):
    """Inspect this emitted PNG subset; baseline aspect opt-in never qualifies it."""
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    kinds = [kind for kind, _ in chunks]
    unique = (b'IHDR', b'cICP', b'cHRM', b'pHYs', b'IEND')
    if (any(kind not in (*unique, b'IDAT') for kind in kinds)
            or any(kinds.count(kind) != 1 for kind in unique) or b'IDAT' not in kinds
            or any(kinds.index(kind) > kinds.index(b'IDAT') for kind in unique[:-1])
            or any(kind != b'IDAT' for kind in kinds[kinds.index(b'IDAT'):-1])):
        raise ValueError('Missing, conflicting or unsupported PNG color/frame/metadata chunks')
    data = {kind: payload for kind, payload in chunks if kind != b'IDAT'}
    if len(data[b'IHDR']) != 13:
        raise ValueError('Expected a bounded native PNG16 header')
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', data[b'IHDR'])
    if (not 0 < width <= 4096 or not 0 < height <= 4096 or depth != 16 or color_type != 2
            or (compression, filtering, interlace) != (0, 0, 0)):
        raise ValueError('Expected non-interlaced static opaque RGB16 PNG')
    if data[b'cICP'] != bytes((1, 16, 0, 1)) or data[b'cHRM'] != struct.pack('>8I', *CHROMATICITIES):
        raise ValueError('Expected actual full-range RGB PQ with source sRGB primaries')
    physical = data[b'pHYs']
    square = physical == struct.pack('>IIB', 1, 1, 0)
    diagnostic = diagnostic_undefined_aspect and physical == struct.pack('>IIB', 0, 1, 0)
    if not square and not diagnostic:
        raise ValueError('PNG does not establish this proof request\'s square-pixel geometry')
    physical_values = list(struct.unpack('>IIB', physical))
    exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
    expected = {'FileType': 'PNG', 'ImageWidth': width, 'ImageHeight': height, 'BitDepth': 16, 'ColorType': 2,
                'ColorPrimaries': 1, 'TransferCharacteristics': 16, 'MatrixCoefficients': 0, 'VideoFullRangeFlag': 1,
                'PixelsPerUnitX': physical_values[0], 'PixelsPerUnitY': physical_values[1], 'PixelUnits': 0}
    if any(exif.get(key) != value for key, value in expected.items()) or exif.get('Orientation', 1) != 1:
        raise ValueError('Independent ExifTool disagrees with actual PNG16 color, depth, aspect or orientation')
    if [exif.get(key) for key in ('WhitePointX', 'WhitePointY', 'RedX', 'RedY', 'GreenX', 'GreenY', 'BlueX', 'BlueY')] != [value/100000 for value in CHROMATICITIES]:
        raise ValueError('Independent ExifTool disagrees with actual source primaries')
    raw = avif.native(['hdr-proof-png-decode', path])
    if len(raw) != 12+width*height*8 or struct.unpack('<III', raw[:12]) != (width, height, 16):
        raise ValueError('Independent libpng disagrees with native PNG precision or dimensions')
    rgba = np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4)
    if not np.all(rgba[..., 3] == 65535):
        raise ValueError('Independent libpng did not recover the established opaque alpha')
    other = avif.native(['ffmpeg', '-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', 'pipe:1'])
    if len(other) != width*height*6 or not np.array_equal(np.frombuffer(other, dtype='<u2').reshape(height, width, 3), rgba[..., :3]):
        raise ValueError('Independent libpng samples disagree with native FFmpeg RGB16 decoding')
    facts = {'width': width, 'height': height, 'depth': 16, 'color_type': 2, 'cicp': [1, 16, 0, 1],
             'gamut': 'srgb', 'transfer': 'pq', 'chromaticities': CHROMATICITIES,
             'physical_pixel_dimensions': physical_values, 'square_pixels': square,
             'orientation': 1, 'frames': 1, 'opaque': True, 'libpng_source_depth': 16,
             'native_decoders_agree': True, 'decoder': 'Independent native libpng, exact RGB16 agreement with FFmpeg',
             'rgba16_sha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
             'chunk_order': [kind.decode() for kind in kinds],
             'exiftool': {key: value for key, value in exif.items() if key not in (
                 'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')}}
    return facts, rgba.astype(float)/65535


def _write_original(linear, path):
    if (linear.get('normalization_nits') != 203 or linear.get('gamut') != 'srgb'
            or linear.get('format') != 'gbrapf32le' or [linear.get('width'), linear.get('height')] != [173, 130]):
        raise ValueError('Known source normalization, primaries, precision and containment geometry are required')
    filters = ('setparams=alpha_mode=premultiplied,zscale=agamma=0:transferin=linear:transfer=16:'
               f'primariesin=1:primaries=1:matrixin=0:matrix=0:rangein=full:range=full:npl={linear["normalization_nits"]},'
               'format=gbrapf32le:alpha_modes=premultiplied,format=gbrpf32le,'
               'zscale=agamma=0:transferin=16:transfer=16:primariesin=1:primaries=1:'
               'matrixin=0:matrix=0:rangein=full:range=full:npl=10000,format=rgb48le')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
                 '-s', '173x130', '-i', linear['path'], '-vf', filters, '-frames:v', '1',
                 '-map_metadata', '-1', '-threads', '1', path])
    return filters


def _write_square(source, output):
    filters = 'format=rgb48le,setsar=1,sidedata=mode=delete,setparams=color_primaries=1:color_trc=16:colorspace=0:range=full'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', filters, '-pix_fmt', 'rgb48le',
                 '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])
    return filters


def _measure(reference, actual):
    return compare_appearance(reference, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')


def _case(source, source_facts, native_source, reference, actual_source, geometry_reference, linear, output,
          candidate, initial_pixels, writer):
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:hdr:png:preserve:16:contain:{candidate}',
            'cell_id': 'avif-gainmap:hdr:png', 'fixture_id': gainmap_avif.FIXTURE_ID, 'candidate': candidate,
            'selectors': SELECTORS.copy(), 'geometry': 'contain', 'source_facts': source_facts,
            'source_sha256': avif.digest(source), 'native_source': native_source, 'native_geometry': linear,
            'status': 'tested and failed', 'consumer_status': 'pending manual review',
            'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
            'checks': {key: False for key in ('known_source', 'native_encoder', 'independent_decoder', 'map_sampling',
                'source_appearance', 'linear_geometry_appearance', 'structure', 'native_storage', 'appearance', 'privacy')},
            'measurements': {}, 'blockers': [], 'artifacts': {'source': str(source), 'source_sha256': avif.digest(source),
                                                           'output': str(output), 'sha256': avif.digest(output)}}
    try:
        native_linear = read_linear(linear)
        case['measurements'].update({'source': _measure(reference, actual_source),
                                     'linear_geometry': _measure(geometry_reference, native_linear)})
        case['checks'].update({'known_source': True, 'native_encoder': True,
            'map_sampling': native_source['map_sampling']['passed'],
            'source_appearance': case['measurements']['source']['passed'],
            'linear_geometry_appearance': case['measurements']['linear_geometry']['passed']})
        facts, actual = inspect_and_decode(output, diagnostic_undefined_aspect=candidate == 'native-pq16-unspecified-aspect')
        mismatch = int(np.count_nonzero(actual != initial_pixels)) if actual.shape == initial_pixels.shape else -1
        facts['lossless_metadata_correction'] = {'passed': mismatch == 0, 'mismatched_rgba_samples': mismatch,
            'scope': 'Exact independent decoded RGB16/alpha agreement with original native PQ PNG; no reference pixels supplied to writer'}
        detail = {'dimensions': actual.shape[:2] == geometry_reference.shape[:2] == (130, 173),
                  'depth': facts['depth'] == 16, 'cicp': facts['cicp'] == [1, 16, 0, 1],
                  'square_pixels': facts['square_pixels'], 'opaque': facts['opaque'],
                  'static': facts['frames'] == 1, 'orientation_baked': facts['orientation'] == 1,
                  'native_decoder_agreement': facts['native_decoders_agree'], 'exact_metadata_correction': mismatch == 0}
        tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', output]))[0]
        tags = {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}
        private = private_metadata_tags(tags)
        actual_nits = avif.decode_transfer(actual[..., :3], 'pq', 'srgb')
        case['measurements'].update({'hdr': _measure(geometry_reference, actual_nits),
                                     'native_storage': _measure(native_linear, actual_nits)})
        case['checks'].update({'independent_decoder': True, 'structure': all(detail.values()),
                              'appearance': case['measurements']['hdr']['passed'],
                              'native_storage': case['measurements']['native_storage']['passed'], 'privacy': not private})
        case.update({'facts': facts, 'structural_checks': detail, 'native_png_writer': writer,
                     'privacy_measurement': {'passed': not private, 'private_tags': private, 'metadata': tags}})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def _controls(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    copied = gainmap_avif.copy_original(source, directory/'original.avif')
    controls = [{'case_id': 'gainmap-avif-hdr-png16-original-exact-bytes', 'passed': copied['exact_bytes'], 'original': copied}]
    before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
    data = source.read_bytes()
    if data.count(before) != 1:
        raise ValueError('Expected one original source base color declaration')
    changed = directory/'unknown-source-color.avif'
    changed.write_bytes(data.replace(before, b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
    decision = gainmap_avif_hdr.source_decision(changed, directory/'unknown-source')
    original = gainmap_avif.copy_original(changed, directory/'unknown-original.avif')
    controls.append({'case_id': 'gainmap-avif-hdr-png16-unknown-source-original-only',
                     'passed': decision['action'] == 'original only' and original['exact_bytes'], 'decision': decision, 'original': original})
    for label, change in (('depth-preserve', {'depth': 'preserve'}), ('other-gamut', {'gamut': 'p3'}),
                          ('other-geometry', {'fit': 'cover'}), ('animation', {'motion': 'animate'})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': f'gainmap-avif-hdr-png16-{label}-withheld', 'passed': rejected})
    return [{**item, 'status': 'passed' if item['passed'] else 'tested and failed'} for item in controls]


def run(output_directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None):
    validate_selectors(SELECTORS if selectors is None else selectors)
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source, fixture = gainmap_avif.generate_source(root/'source', source_lock=source_lock)
    inspection = root/'source-inspection'
    facts, base = gainmap_avif_hdr._admit_source(source, inspection, source_lock)
    reference, mapped = gainmap_avif_hdr._reference(facts, base, inspection)
    reference_path = root/'reference-source-nits.npy'
    np.save(reference_path, reference)
    reconstruction = root/'source-reconstruction'
    reconstruction.mkdir(exist_ok=True)
    native_source, actual_source = gainmap_avif_hdr._reconstruct(source, facts, inspection, mapped, reconstruction)
    linear = resample_linear(native_source, root/'hdr-linear.gbrapf32', 'contain')
    geometry_reference = array_geometry(reference, 'contain')
    initial, corrected = root/'original-pq16.png', root/'output.png'
    original_filter = _write_original(linear, initial)
    correction_filter = _write_square(initial, corrected)
    _, initial_pixels = inspect_and_decode(initial, diagnostic_undefined_aspect=True)
    cases = [_case(source, facts, native_source, reference, actual_source, geometry_reference, linear, path,
                   candidate, initial_pixels, writer)
             for path, candidate, writer in (
                 (initial, 'native-pq16-unspecified-aspect', {'filter': original_filter}),
                 (corrected, 'native-pq16-square-pixels', {'filter': correction_filter, 'native_input': str(initial), 'input_sha256': avif.digest(initial)}))]
    for case in cases:
        case['reference_hdr'] = {'path': str(reference_path), 'sha256': avif.digest(reference_path),
                                'revision': POLICY['reference_revision'], 'gamut': 'srgb', 'usage': 'Independent reference only; never encoder input'}
    profile = {'candidate': 'native-antialiased-bilinear8-float32', 'reference_revision': POLICY['reference_revision'],
               'status': 'qualified' if cases[1]['checks']['map_sampling'] and cases[1]['checks']['source_appearance'] else 'tested and failed',
               'measurement': cases[1]['measurements'].get('source'), 'native_source': native_source,
               'scope': 'Source reconstruction under this renderer convention only; PNG output and physical qualification remain separate'}
    fixture.update({'facts': facts, 'source_valid': True, 'source_reconstruction_profiles': [profile],
                    'valid_scope': 'Actual locked source facts and separately scoped native reconstruction profile'})
    controls = _controls(source, root/'controls')
    return {'evidence': cases, 'source_fixtures': [fixture], 'fixtures': [], 'controls': controls,
            'source_reconstruction_profiles': [profile], 'scope': POLICY, 'commands': avif.COMMANDS[start:],
            'native_log_artifacts': [{'path': str(path), 'sha256': avif.digest(path), 'record': json.loads(path.read_text())}
                                     for path in sorted(root.glob('*.log'))],
            'consumer_status': 'pending manual review'}
