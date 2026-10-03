"""Explicit PQ AVIF12 geometries from one locked gain-map AVIF source.

The original failed experiment declared Pillow RGB8 antialiased bilinear map
sampling, followed by linear-light Pillow float Lanczos geometry. That renderer
convention stays fixed here. Android's primary Ultra HDR display specification
allows bilinear-or-better, implementation-defined sampling. AVIF delegates tmap
to HEIF; this proof does not claim that ISO uniquely mandates Pillow's kernel.
The original libavif sampling route remains a distinct failed diagnostic.

Candidate pixels come from native AV1 decoding, native zimg map resampling and
FFmpeg float gain application. Independent dav1d samples and NumPy/Pillow HDR
references are used only for measurement. The output is single-layer PQ12,
with no claim about gain-map-preserving output or display interoperability.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap_avif
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap import array_geometry, private_metadata_tags
from gainmap_hdr import read_linear, resample_pq
from gainmap_linear import resample_linear
from matrix import GAINMAP_GEOMETRIES


SELECTORS = {'format': 'avif', 'range': 'hdr', 'gamut': 'preserve', 'depth': '12',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
GEOMETRIES = ('contain', 'cover', 'fill', 'upscale')
POLICY = {
    'declared_before_native_measurements': True,
    'profile': 'gainmap-hdr',
    'reference_revision': 'gainmap-avif-hdr-bilinear8-lanczosfloat-v1',
    'rationale': 'Unchanged photographic reconstructed-HDR regional gates at the actual source sRGB primaries and 203-nit SDR white',
    'source_reference': 'Direct dav1d AV1 base/map samples; Pillow antialiased BILINEAR monochrome8 map at base size; independent actual tmap per-channel gain application',
    'geometry_reference': 'Pillow float linear-light Lanczos with matched containment173x130 and negative components clamped to zero',
    'sampling_rationale': 'A predeclared renderer convention within bilinear-or-better implementation-defined fixture semantics, not a uniquely mandated ISO kernel; libavif point bilinear remains a valid distinct sampling diagnostic',
    'sampling_precision_gate': 'Native resampled map remains opaque RGB8 with equal channels. Code differences from the reference are diagnostic and receive no additional error allowance; source and derivative appearance must independently pass unchanged gainmap-hdr gates',
    'display_headroom_log2': 4,
    'output_scope': 'Explicit single-layer PQ AVIF12 in source sRGB primaries; gain-map-preserving AVIF and other selector tuples remain unqualified',
    'source_scope': 'Only the identity-oriented locked static opaque source; source import quantization is separate from derivative precision',
    'primary_sources': [
        'https://developer.android.com/media/platform/hdr-image-format',
        'https://aomediacodec.github.io/av1-avif/v1.2.0.html#tone-map-derivation',
        'https://webstore.ansi.org/preview-pages/BSI/preview_30476827.pdf',
    ],
    'native_source_rationale': [
        {'url': 'https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/gainmap.c#L180-L208',
         'finding': 'The pinned implementation scales the coded map before gain application; lines 230-275 apply per-channel gamma, gain, offsets and primaries conversion'},
        {'url': 'https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/scale.c#L22',
         'finding': 'The scaler requests kFilterBox; vendored third_party/libyuv/source/scale_common.c:428-477 reduces this to bilinear for the 512x384 to 403x302 ratio'},
        {'file': 'libavif1.4.1/third_party/libyuv/source/scale.c:258-312',
         'finding': 'The x86 scaler filters vertically then horizontally with fixed-point rounding; scale_common.c:185-215 uses seven horizontal fraction bits and row_common.c:46-76 uses eight vertical fraction bits'},
    ],
    'native_source_archive_sha256': 'd4aea31a4becb3273ba7968221be2e48148ba05eb8a68d14e671963e17785648',
}
GEOMETRY_POLICY = {**POLICY,
    'geometry_reference': 'Pillow float linear-light Lanczos with matched contain 173x130, fractional centered cover 173x173, fill 173x211 and upscale 769x576; negative components clamped to zero',
    'orientation_scope': 'Only the original identity-oriented locked source; unverified transformed sources remain original-only'}


def _selectors(operation):
    return {**{key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')},
            **GAINMAP_GEOMETRIES[operation]}


def validate_selectors(selectors, *, operation='contain'):
    if operation not in GEOMETRIES:
        raise ValueError('Unsupported explicit HDR geometry')
    if selectors != _selectors(operation):
        label = 'containment' if operation == 'contain' else operation
        raise ValueError(f'Only the exact explicit PQ AVIF12 {label} selectors are admitted')


def _admit_source(source, directory, source_lock):
    gainmap_avif.parse_source(Path(source).read_bytes())
    expected = json.loads(Path(source_lock).read_text())['sha256'][gainmap_avif.FIXTURE_ID]
    if avif.digest(source) != expected:
        raise ValueError('Unknown gain-map AVIF source hash; original only')
    return gainmap_avif.inspect_source(source, directory)


def source_decision(source, directory, *, source_lock=gainmap_avif.SOURCE_LOCK):
    try:
        facts, _ = _admit_source(source, directory, source_lock)
        return {'action': 'HDR reconstruction candidate only', 'source_valid': True,
                'facts': facts, 'sha256': avif.digest(source),
                'appearance_gate': 'Each candidate must separately pass the predeclared source reconstruction reference'}
    except (ValueError, RuntimeError) as error:
        return {'action': 'original only', 'source_valid': False, 'reason': str(error), 'sha256': avif.digest(source)}


def _fraction(pair):
    return pair[0]/pair[1]


def _reference(facts, base_codes, inspection):
    width, height = facts['map']['dimensions']
    raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu', '-i', inspection/'map.obu',
                       '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'])
    if len(raw) != width*height or hashlib.sha256(raw).hexdigest() != facts['packet_samples']['map']['decoded_sha256']:
        raise ValueError('Independent map samples changed after source inspection')
    samples = np.frombuffer(raw, dtype=np.uint8).reshape(height, width)
    mapped = np.asarray(Image.fromarray(samples).resize(tuple(facts['base']['dimensions']), Image.Resampling.BILINEAR))
    metadata = facts['metadata']
    low, high, gamma, base_offset, alternate_offset = [np.array([_fraction(pair) for pair in metadata[key]])
        for key in ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
    base_headroom, alternate_headroom = [_fraction(metadata[key]) for key in ('base_headroom', 'alternate_headroom')]
    weight = np.clip((POLICY['display_headroom_log2']-base_headroom)/(alternate_headroom-base_headroom), 0, 1)
    gain = low+(high-low)*(mapped[..., None]/255)**(1/gamma)
    base = sdr_signal_to_nits(base_codes/255, nominal_white_nits=203)/203
    return ((base+base_offset)*2**(gain*weight)-alternate_offset)*203, mapped


def _read_rgb8(path, dimensions):
    raw = avif.native(['hdr-proof-png-decode', path])
    width, height, depth = map(int, np.frombuffer(raw[:12], dtype='<u4'))
    if [width, height] != list(dimensions) or depth != 8 or len(raw) != 12+width*height*8:
        raise ValueError('Native map/base PNG storage depth or dimensions changed')
    rgba16 = np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4)
    if not np.all(rgba16[..., 3] == 65535) or not np.all(rgba16 % 257 == 0):
        raise ValueError('Expected exact opaque eight-bit PNG samples')
    return (rgba16[..., :3]//257).astype(np.uint8)


def _map_axis(source, output, width, height):
    # Zero padding plus coverage division implements truncated edge weights.
    # Planar8 -> zscale -> float avoids swscale's biased packed8 expansion.
    scale = f'zscale=w={3*width}:h={3*height}:filter=bilinear:rangein=full:range=full,format=gbrpf32le,crop={width}:{height}:{width}:{height}'
    mask = 'between(X,W/3,2*W/3-1)*between(Y,H/3,2*H/3-1)'
    coverage = 'geq='+':'.join(f"{channel}='{mask}'" for channel in 'rgb')
    filters = ('[0:v]pad=iw*3:ih*3:iw:ih:color=black,format=gbrp,zscale=rangein=full:range=full,format=gbrpf32le,split[pixels][coverage];'
               f'[pixels]{scale}[p];[coverage]{coverage},{scale}[c];'
               "[p][c]blend=all_expr='if(gt(B,0),A/B,0)',zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24[out]")
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-filter_complex', filters, '-filter_complex_threads', '1',
                 '-map', '[out]', '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])
    return filters


def _reconstruct(source, facts, inspection, mapped_reference, folder):
    width, height = facts['base']['dimensions']
    base = folder/'base-aom.png'
    avif.native(['avifdec', '-j', '1', '-c', 'aom', '-d', '8', source, base])
    base_codes = _read_rgb8(base, (width, height))
    if hashlib.sha256(base_codes.tobytes()).hexdigest() != facts['packet_samples']['base']['decoded_sha256']:
        raise ValueError('Native AOM source base disagrees with independent dav1d samples')
    horizontal, mapped = folder/'map-horizontal.png', folder/'map-resampled.png'
    filters = [_map_axis(inspection/'map-native.png', horizontal, width, facts['map']['dimensions'][1]),
               _map_axis(horizontal, mapped, width, height)]
    codes = _read_rgb8(mapped, (width, height))
    difference = np.abs(codes.astype(int)-mapped_reference[..., None].astype(int))
    sampling = {'maximum_code_difference': int(np.max(difference)),
                'changed_pixels': int(np.count_nonzero(np.any(difference, axis=2))),
                'mean_absolute_code_difference': float(np.mean(difference)),
                'passed': bool(np.all(codes == codes[..., :1])),
                'pass_scope': 'Native opaque RGB8 samples at base dimensions with equal channels; code differences are diagnostic and appearance has separate unchanged gates',
                'output_dimensions': [width, height], 'depth': 8, 'opaque': True,
                'pixel_sha256': hashlib.sha256(codes.tobytes()).hexdigest(),
                'precision': 'Native normalized antialiased bilinear, horizontal then vertical, RGB8 rounding after each axis',
                'filters': filters, 'path': str(mapped), 'sha256': avif.digest(mapped)}
    metadata = facts['metadata']
    low, high, gamma, base_offset, alternate_offset = [[_fraction(pair) for pair in metadata[key]]
        for key in ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
    base_headroom, alternate_headroom = [_fraction(metadata[key]) for key in ('base_headroom', 'alternate_headroom')]
    weight = min(max((POLICY['display_headroom_log2']-base_headroom)/(alternate_headroom-base_headroom), 0), 1)
    inverse = 'geq='+':'.join(f"{c}='if(lte({c}(X,Y),0.04045),{c}(X,Y)/12.92,pow(({c}(X,Y)+0.055)/1.055,2.4))'" for c in 'rgb')
    normalized = 'format=gbrp,zscale=rangein=full:range=full,format=gbrpf32le'
    gains = []
    # FFmpeg planar float order is G, B, R; tmap fractions are R, G, B.
    for plane, channel in enumerate((1, 2, 0)):
        exponent = f'({low[channel]:.17g}+{high[channel]-low[channel]:.17g}*pow(B,{1/gamma[channel]:.17g}))*{weight:.17g}'
        gains.append(f"c{plane}_expr='(A+{base_offset[channel]:.17g})*pow(2,{exponent})-{alternate_offset[channel]:.17g}'")
    expression = f'[0:v]{normalized},{inverse}[base];[1:v]{normalized}[map];[base][map]blend='+':'.join(gains)+'[out]'
    output = folder/'source-linear.gbrpf32'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', base, '-i', mapped, '-filter_complex', expression,
                 '-filter_complex_threads', '1', '-map', '[out]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', output])
    native = {'path': str(output), 'sha256': avif.digest(output), 'format': 'gbrpf32le',
              'width': width, 'height': height, 'gamut': 'srgb', 'normalization_nits': 203, 'alpha': False,
              'source_sha256': avif.digest(source), 'precision': 'Native float32 gain application from exact RGB8 base and resampled map',
              'gain_filter': expression, 'metadata': metadata, 'weight': weight,
              'display_headroom_log2': POLICY['display_headroom_log2'], 'map_sampling': sampling,
              'base_decoder_agreement': True, 'base_decoder': 'libavif/AOM, checked against direct dav1d AV1 samples',
              'base_input': {'path': str(base), 'sha256': avif.digest(base),
                             'pixel_sha256': hashlib.sha256(base_codes.tobytes()).hexdigest()},
              'map_input': {'path': str(inspection/'map-native.png'), 'sha256': avif.digest(inspection/'map-native.png'),
                            'decoder_agreement': facts['map_decoder_agreement'],
                            'independent_gray_pixel_sha256': facts['packet_samples']['map']['decoded_sha256']}}
    raw = np.frombuffer(output.read_bytes(), dtype='<f4')
    if raw.size != width*height*3 or not np.all(np.isfinite(raw)) or np.any(raw < 0):
        raise ValueError('Native reconstruction has invalid float samples')
    actual = raw.reshape(3, height, width)[[2, 0, 1]].transpose(1, 2, 0).astype(float)*203
    return native, actual


def _encode(linear, folder):
    if (linear.get('normalization_nits') not in (203, 10000) or linear.get('gamut') != 'srgb'
            or linear.get('format') != 'gbrapf32le'):
        raise ValueError('Known opaque linear source normalization, primaries and precision are required')
    pq = ('setparams=alpha_mode=premultiplied,zscale=agamma=0:transferin=linear:transfer=16:'
          f'primariesin=1:primaries=1:matrixin=0:matrix=0:rangein=full:range=full:npl={linear["normalization_nits"]},'
          'format=gbrapf32le:alpha_modes=premultiplied,format=gbrpf32le,'
          'zscale=agamma=0:transferin=16:transfer=16:primariesin=1:primaries=1:'
          'matrixin=0:matrix=0:rangein=full:range=full:npl=10000,format=rgb48le')
    png = folder/'hdr-pq16.png'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
                 '-s', f'{linear["width"]}x{linear["height"]}', '-i', linear['path'], '-vf', pq,
                 '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', png])
    output = folder/'output.avif'
    avif.encode_avif([png], output, 'pq', 'srgb', 12)
    return output


def _pixel_aspect(path):
    # The bounded single-layer output declares square pixels by omitting pasp.
    # Inspect actual properties, not byte-string matches in compressed AV1.
    top = gainmap_avif._boxes(Path(path).read_bytes())
    meta = gainmap_avif._unique(top, b'meta')[1]
    if meta[:4] != bytes(4):
        raise ValueError('Unknown AVIF pixel-aspect metadata version')
    boxes = gainmap_avif._boxes(meta[4:])
    properties = gainmap_avif._boxes(gainmap_avif._unique(boxes, b'iprp')[1])
    image_properties = gainmap_avif._boxes(gainmap_avif._unique(properties, b'ipco')[1])
    aspects = [payload.hex() for kind, payload, _ in image_properties if kind == b'pasp']
    return {'pasp_properties': aspects, 'passed': not aspects,
            'scope': 'The bounded output omits pixel-aspect properties; independent ffprobe must also report square pixels'}


def _case(source, facts, inspection, reference, mapped_reference, folder, candidate, operation):
    selectors = _selectors(operation)
    validate_selectors(selectors, operation=operation)
    folder.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:hdr:avif:preserve:12:{operation}:{candidate}',
            'cell_id': 'avif-gainmap:hdr:avif', 'fixture_id': gainmap_avif.FIXTURE_ID,
            'selectors': selectors, 'geometry': operation, 'candidate': candidate,
            'source_facts': facts, 'source_sha256': avif.digest(source),
            'status': 'tested and failed', 'consumer_status': 'pending manual review',
            'threshold_scope': {**(POLICY if operation == 'contain' else GEOMETRY_POLICY),
                                'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
            'checks': {key: False for key in ('known_source', 'native_encoder', 'independent_decoder', 'map_sampling',
                                             'source_appearance', 'linear_geometry_appearance', 'structure', 'appearance', 'privacy')},
            'blockers': [], 'measurements': {}, 'artifacts': {}}
    try:
        case['checks']['known_source'] = True
        if candidate == 'libavif-native-map-sampling-pq12':
            png = folder/'source-pq.png'
            avif.native(['avifgainmaputil', 'tonemap', source, png, '--headroom', '4',
                         '--cicp-output', '1/16/0', '--ignore-profile', '-d', '12', '-y', '444'])
            actual_source = avif.decode_transfer(avif.read_png(png)[..., :3], 'pq', 'srgb')
            native_source = {'path': str(png), 'sha256': avif.digest(png), 'metadata': facts['metadata'],
                             'display_headroom_log2': 4, 'precision': 'Pinned libavif native map sampling, gain application and PQ12 PNG output',
                             'sampling_scope': 'Valid distinct native sampling convention; measured against the unchanged predeclared reference',
                             'map_sampling': {'passed': True, 'pass_scope': 'Known native sampler and RGB8 source map precision from the pinned implementation; no claim of equal reference samples'}}
            linear = resample_pq(png, folder/'hdr-linear.gbrapf32', operation, gamut='srgb')
            case['checks']['map_sampling'] = True
        else:
            native_source, actual_source = _reconstruct(source, facts, inspection, mapped_reference, folder)
            case['checks']['map_sampling'] = native_source['map_sampling']['passed']
            linear = resample_linear(native_source, folder/'hdr-linear.gbrapf32', operation)
        case['native_source'] = native_source
        reference_geometry = array_geometry(reference, operation)
        height, width = reference_geometry.shape[:2]
        for name, expected, actual in (('source', reference, actual_source), ('linear_geometry', reference_geometry, read_linear(linear))):
            case['measurements'][name] = compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')
        case['checks']['source_appearance'] = case['measurements']['source']['passed']
        case['checks']['linear_geometry_appearance'] = case['measurements']['linear_geometry']['passed']
        # Failed source measurements are retained, and downstream diagnostics
        # still execute. They cannot override the source qualification gate.
        output = _encode(linear, folder)
        case['checks']['native_encoder'] = True
        emitted = avif.inspect_avif(output)
        frames = avif.decode_avif(output, folder, 1)
        expected_rgba = np.concatenate((reference_geometry, np.ones((*reference_geometry.shape[:2], 1))), axis=-1)
        checks = avif.structure_checks(emitted, frames, {}, [expected_rgba], 'pq', 'srgb', 12, 1)
        checks['opaque_source_retained'] = bool(emitted['alpha'] == 'Absent' and np.all(frames[0][..., 3] == 1))
        packet = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-count_frames',
            '-show_entries', 'stream=codec_name,width,height,pix_fmt,color_space,color_transfer,color_primaries,color_range,nb_read_frames,sample_aspect_ratio,display_aspect_ratio',
            '-of', 'json', output]))
        streams = packet.get('streams', [])
        checks['native_av1_depth_color_frames'] = len(streams) == 1 and all(streams[0].get(key) == value for key, value in
            {'codec_name': 'av1', 'width': width, 'height': height, 'pix_fmt': 'gbrp12le', 'color_space': 'gbr',
             'color_transfer': 'smpte2084', 'color_primaries': 'bt709', 'color_range': 'pc', 'nb_read_frames': '1'}.items())
        aspect = _pixel_aspect(output)
        checks['square_pixels'] = (aspect['passed'] and len(streams) == 1
                                   and streams[0].get('sample_aspect_ratio') == '1:1'
                                   and streams[0].get('display_aspect_ratio') == f'{width//math.gcd(width, height)}:{height//math.gcd(width, height)}')
        tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', output]))[0]
        tags = {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}
        private = private_metadata_tags(tags)
        privacy = not private and 'XMP Metadata   : Absent' in emitted['info'] and 'Exif Metadata  : Absent' in emitted['info']
        measured = compare_appearance(reference_geometry, avif.decode_transfer(frames[0][..., :3], 'pq', 'srgb'),
                                      reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')
        case['measurements']['hdr'] = measured
        case['checks'].update({'independent_decoder': True, 'structure': all(checks.values()),
                              'appearance': measured['passed'], 'privacy': privacy})
        case.update({'facts': emitted, 'structural_checks': {key: bool(value) for key, value in checks.items()},
                     'output_packet_facts': packet, 'pixel_aspect': aspect, 'native_geometry': linear,
                     'privacy_measurement': {'passed': privacy, 'private_tags': private, 'metadata': tags},
                     'artifacts': {'source': str(source), 'source_sha256': avif.digest(source),
                                   'output': str(output), 'sha256': avif.digest(output),
                                   'linear_geometry': linear['path'], 'linear_geometry_sha256': avif.digest(linear['path'])}})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    case['commands'] = avif.COMMANDS[start:]
    case['native_log_artifacts'] = [{'path': str(path), 'sha256': avif.digest(path), 'record': json.loads(path.read_text())}
                                    for path in sorted(folder.glob('*.log'))]
    return case


def _controls(source, root):
    root.mkdir(parents=True, exist_ok=True)
    original = root/'original.avif'
    exact = gainmap_avif.copy_original(source, original)
    controls = [{'case_id': 'gainmap-avif-hdr-original-exact-bytes', 'passed': exact['exact_bytes'],
                 'source_sha256': avif.digest(source), 'output_sha256': avif.digest(original)}]
    data = source.read_bytes()
    before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
    if data.count(before) != 1:
        raise ValueError('HDR source control requires one base color declaration')
    changed = root/'unknown-color.avif'
    changed.write_bytes(data.replace(before, b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
    decision = source_decision(changed, root/'unknown-color')
    copied = gainmap_avif.copy_original(changed, root/'unknown-original.avif')
    controls.append({'case_id': 'gainmap-avif-hdr-unknown-color-original-only',
                     'passed': decision['action'] == 'original only' and copied['exact_bytes'], 'decision': decision, 'original': copied})
    for name, change in (('depth-preserve', {'depth': 'preserve'}), ('different-gamut', {'gamut': 'p3'}),
                         ('different-geometry', {'w': 174}), ('animated', {'motion': 'animate'})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': f'gainmap-avif-hdr-{name}-withheld', 'passed': rejected})
    return [{**item, 'status': 'passed' if item['passed'] else 'tested and failed'} for item in controls]


def run(output_directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None, geometries=('contain',)):
    geometries = tuple(geometries)
    if not geometries or len(set(geometries)) != len(geometries) or any(item not in GEOMETRIES for item in geometries):
        raise ValueError('Expected distinct contain, cover, fill or upscale geometries')
    if selectors is not None:
        if len(geometries) != 1:
            raise ValueError('Explicit selectors require one declared geometry')
        validate_selectors(selectors, operation=geometries[0])
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source, fixture = gainmap_avif.generate_source(root/'source', source_lock=source_lock)
    inspection = root/'source-inspection'
    facts, base = _admit_source(source, inspection, source_lock)
    reference, mapped = _reference(facts, base, inspection)
    reference_path = root/'reference-source-nits.npy'
    np.save(reference_path, reference)
    fixture.update({'facts': facts, 'source_valid': True,
                    'valid_scope': 'Actual locked source facts; HDR appearance established separately for each named reconstruction profile'})
    candidates = ('libavif-native-map-sampling-pq12', 'native-antialiased-bilinear8-float32')
    cases = [_case(source, facts, inspection, reference, mapped,
                   root/name if operation == 'contain' else root/operation/name, name, operation)
             for operation in geometries for name in candidates]
    profiles, source_candidates = [], set()
    for case in cases:
        case['reference_hdr'] = {'path': str(reference_path), 'sha256': avif.digest(reference_path), 'gamut': 'srgb',
                                 'normalization_nits': 203, 'revision': POLICY['reference_revision'], 'usage': 'Independent reference only; never encoder input'}
        if case['candidate'] in source_candidates:
            continue
        source_candidates.add(case['candidate'])
        profiles.append({'candidate': case['candidate'], 'reference_revision': POLICY['reference_revision'],
                         'status': 'qualified' if case['checks']['known_source'] and case['checks']['map_sampling'] and case['checks']['source_appearance'] else 'tested and failed',
                         'measurement': case['measurements'].get('source'), 'native_source': case.get('native_source'),
                         'scope': 'Source reconstruction under this renderer convention only; output and display qualification are separate'})
    fixture['source_reconstruction_profiles'] = profiles
    controls = _controls(source, root/'controls')
    return {'evidence': cases, 'source_fixtures': [fixture], 'fixtures': [], 'controls': controls,
            'commands': avif.COMMANDS[start:], 'scope': POLICY if geometries == ('contain',) else GEOMETRY_POLICY,
            'source_reconstruction_profiles': profiles, 'consumer_status': 'pending manual review'}
