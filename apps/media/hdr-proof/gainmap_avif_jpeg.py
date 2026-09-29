"""Authored SDR JPEG geometries from the locked gain-map AVIF source.

Keep the existing photographic gainmap-sdr reference and thresholds. The
verified native PNG preparation supplies candidate pixels; Pillow's native
libjpeg writes baseline quality100 RGB JPEG with a deterministic native
LittleCMS sRGB profile. FFmpeg's independent MJPEG decoder reads the actual
RGB8 samples. The actual ICC matrix/TRC semantics, JPEG structure, single
frame, dimensions, orientation and privacy must pass independently.

The decoded authored base defines SDR intent. No HDR interpretation, new tone
grade, source-import error allowance or physical-display claim is introduced.
JPEG compression may fail appearance despite valid structure; retain that
failure rather than inferring support from successful encoding.
"""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

import avif
import gainmap_avif
import gainmap_avif_png
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap import private_metadata_tags
from gainmap_iso import _base_color_facts
from matrix import GAINMAP_GEOMETRIES


SELECTORS = {**gainmap_avif_png.SELECTORS, 'format': 'jpg'}
SIZES = {'contain': (173, 130), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 576)}
POLICY = {**gainmap_avif_png.POLICY,
    'rationale': 'Existing authored photographic SDR gates at nominal100-nit white apply unchanged to this lossy native JPEG; no extra compression or source-import allowance',
    'output': 'Static opaque baseline SOF0 RGB8 JPEG, quality100, no chroma subsampling, actual sRGB matrix/TRC ICC',
    'scope': 'Only explicit authored SDR JPEG containment173x130 from the identity-oriented locked source',
    'color_signaling': 'Independent ICC matrix/TRC inspection must prove actual sRGB semantics; profile names alone are insufficient',
    'storage_gate': 'Native RGB JPEG compression is measured separately against the actual inspected PNG input; it must also pass the independent authored-source geometry reference',
    'aspect_scope': 'Actual173x130 pixel raster without an aspect override; no explicit1:1 aspect declaration is claimed',
    'decoder_diagnostics': 'FFmpeg MJPEG defaults such as bt470bg are not emitted JPEG color declarations. Actual RGB component IDs, Adobe identity transform and ICC define color; exact planar-to-packed RGB agreement rejects an accidental conversion',
    'baseline_candidate': 'Standard sRGB transfer and native libjpeg quality100 RGB8; no alternate transfer candidate is implied'}
GEOMETRY_POLICY = {**POLICY,
    'geometry': gainmap_avif_png.GEOMETRY_POLICY['geometry'],
    'scope': 'Only authored SDR JPEG contain, cover, fill and upscale from the identity-oriented locked source',
    'aspect_scope': 'Actual requested pixel raster without an aspect override; no explicit1:1 aspect declaration is claimed'}


def _selectors(operation):
    return {**{key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')},
            **GAINMAP_GEOMETRIES[operation]}


def validate_selectors(selectors, *, operation='contain'):
    if operation not in SIZES:
        raise ValueError('Unsupported authored SDR JPEG geometry')
    if selectors != _selectors(operation):
        label = 'containment' if operation == 'contain' else operation
        raise ValueError(f'Only the exact authored SDR JPEG {label} selectors are admitted')


def source_decision(source, directory, *, source_lock=gainmap_avif.SOURCE_LOCK):
    try:
        gainmap_avif.parse_source(Path(source).read_bytes())
        expected = json.loads(Path(source_lock).read_text())['sha256'][gainmap_avif.FIXTURE_ID]
        if avif.digest(source) != expected:
            raise ValueError('Unknown gain-map AVIF source hash; original only')
        facts, _ = gainmap_avif.inspect_source(source, directory)
        return {'action': 'authored SDR candidate only', 'source_valid': True,
                'facts': facts, 'sha256': avif.digest(source)}
    except (ValueError, RuntimeError) as error:
        return {'action': 'original only', 'source_valid': False, 'reason': str(error), 'sha256': avif.digest(source)}


def _parse_jpeg(data, *, dimensions=(173, 130)):
    """Bounded generated SOF0/one-scan RGB JPEG; reject unknown APP metadata."""
    if tuple(dimensions) not in SIZES.values():
        raise ValueError('Expected a bounded authored SDR JPEG geometry')
    width, height = dimensions
    if data[:2] != b'\xff\xd8':
        raise ValueError('Missing JPEG start marker')
    position, headers = 2, []
    while position+4 <= len(data):
        if data[position] != 255:
            raise ValueError('Invalid JPEG header marker')
        marker = data[position+1]
        size = int.from_bytes(data[position+2:position+4], 'big')
        if size < 2 or position+2+size > len(data):
            raise ValueError('Truncated JPEG segment')
        value = data[position+4:position+2+size]
        position += size+2
        if marker == 0xDA:
            if len(value) != 10 or value[0] != 3 or value[1:7:2] != b'RGB' or value[-3:] != b'\x00\x3f\x00':
                raise ValueError('Expected one complete sequential RGB JPEG scan')
            break
        if marker not in (0xC0, 0xC4, 0xDB, 0xE2, 0xEE):
            raise ValueError('Unknown JPEG frame, orientation, aspect or private metadata')
        if marker == 0xE2 and not value.startswith(b'ICC_PROFILE\x00'):
            raise ValueError('Only the known RGB ICC profile may be carried in JPEG APP2')
        headers.append((marker, value))
    else:
        raise ValueError('Missing JPEG scan')
    scan_start = position
    while position+1 < len(data):
        if data[position] != 255:
            position += 1
            continue
        marker = data[position+1]
        if marker == 0:
            position += 2
            continue
        if marker == 0xD9 and position > scan_start and position+2 == len(data):
            break
        raise ValueError('Unknown extra JPEG image, scan, private payload or missing entropy data')
    else:
        raise ValueError('Truncated JPEG entropy data or missing end marker')
    def one(marker):
        values = [value for observed, value in headers if observed == marker]
        if len(values) != 1:
            raise ValueError('Expected one unambiguous JPEG frame and RGB transform')
        return values[0]
    frame = one(0xC0)
    if (len(frame) != 15 or struct.unpack('>BHHB', frame[:6]) != (8, height, width, 3)
            or frame[6::3] != b'RGB' or frame[7::3] != b'\x11\x11\x11'):
        raise ValueError('Expected actual baseline RGB8 geometry without subsampling')
    if one(0xEE) != b'Adobe\x00\x64'+bytes(5):
        raise ValueError('Expected the native Adobe RGB identity transform')
    if not all(any(marker == wanted for marker, _ in headers) for wanted in (0xDB, 0xC4)):
        raise ValueError('JPEG quantization or entropy tables missing')
    color = _base_color_facts(data)
    if color['gamut'] != 'srgb' or color['transfer'] != 'srgb':
        raise ValueError('Expected actual sRGB ICC matrix and transfer semantics')
    return {'width': width, 'height': height, 'depth': 8, 'sof': 0, 'components': 3,
            'gamut': 'srgb', 'transfer': 'srgb', 'color': color,
            'icc_sha256': color['icc_sha256'], 'orientation': 1, 'frames': 1, 'opaque': True,
            'no_aspect_override': True, 'aspect_ratio_explicitly_signaled': False,
            'pixel_aspect': 'Absent; no JFIF/EXIF aspect override. The requested pixel raster is independently verified',
            'adobe_color_transform': 0, 'component_identifiers': 'RGB', 'component_sampling': [17, 17, 17],
            'header_markers': [hex(marker) for marker, _ in headers], 'gain_map': 'absent', 'private_metadata_segments': []}


def inspect_and_decode(path, *, dimensions=(173, 130)):
    path = Path(path)
    facts = _parse_jpeg(path.read_bytes(), dimensions=dimensions)
    width, height = facts['width'], facts['height']
    packet = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'mjpeg', '-count_frames',
                                     '-show_frames', '-show_streams', '-of', 'json', path]))
    frames, streams = packet.get('frames', []), packet.get('streams', [])
    if len(frames) != 1 or len(streams) != 1 or streams[0].get('codec_name') != 'mjpeg':
        raise ValueError('Expected exactly one independently decoded JPEG frame')
    for observed in (frames[0], streams[0]):
        if (observed.get('width'), observed.get('height'), observed.get('pix_fmt')) != (width, height, 'gbrp'):
            raise ValueError('Independent JPEG decoder disagrees with actual RGB8 geometry')
        if observed.get('sample_aspect_ratio') not in (None, '1:1'):
            raise ValueError('Independent JPEG decoder reports a conflicting aspect override')
    if (streams[0].get('profile') != 'Baseline' or streams[0].get('nb_read_frames') != '1'
            or streams[0].get('bits_per_raw_sample') != '8'
            or any(frames[0].get(key, 0) != 0 for key in ('crop_top', 'crop_bottom', 'crop_left', 'crop_right'))):
        raise ValueError('Unexpected JPEG precision, frame count or crop')
    raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', path, '-frames:v', '1',
                       '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    if len(raw) != width*height*3:
        raise ValueError('Independent JPEG decoded sample count disagrees with actual dimensions')
    codes = np.frombuffer(raw, np.uint8).reshape(height, width, 3)
    planar = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', path, '-frames:v', '1',
                          '-f', 'rawvideo', '-pix_fmt', 'gbrp', 'pipe:1'])
    if (len(planar) != len(raw) or not np.array_equal(codes,
            np.moveaxis(np.frombuffer(planar, np.uint8).reshape(3, height, width)[[2, 0, 1]], 0, -1))):
        raise ValueError('Native planar-to-packed RGB decoding altered JPEG component samples')
    tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', path]))[0]
    tags = {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}
    expected = {'File:FileType': 'JPEG', 'File:ImageWidth': width, 'File:ImageHeight': height,
                'File:BitsPerSample': 8, 'File:ColorComponents': 3, 'Adobe:ColorTransform': 0}
    if any(tags.get(key) != value for key, value in expected.items()):
        raise ValueError('Independent ExifTool disagrees with actual JPEG structure or RGB transform')
    private = private_metadata_tags(tags)
    if private:
        raise ValueError('JPEG output retains private metadata')
    facts.update({'decoder': 'Independent native FFmpeg MJPEG decoder', 'packet_facts': packet,
                  'rgb_packing_exact': True,
                  'rgb8_sha256': hashlib.sha256(raw).hexdigest(), 'metadata': tags,
                  'privacy': {'passed': True, 'private_tags': private, 'metadata': tags}})
    return facts, codes


def _encode(source, output):
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)
    with Image.open(source) as image:
        # These are only inspected native PNG candidate samples. A fresh image
        # prevents incidental PNG metadata from becoming JPEG metadata.
        clean = Image.frombytes('RGB', image.size, image.convert('RGB').tobytes())
        clean.save(output, format='JPEG', quality=100, subsampling=0, keep_rgb=True,
                   optimize=False, progressive=False, icc_profile=bytes(profile))
    return {'encoder': 'Pillow native libjpeg '+Image.core.jpeglib_version,
            'input': str(source), 'input_sha256': avif.digest(source), 'icc_sha256': hashlib.sha256(profile).hexdigest(),
            'options': {'quality': 100, 'subsampling': 0, 'keep_rgb': True, 'optimize': False, 'progressive': False},
            'output_sha256': avif.digest(output)}


def _case(root, original):
    operation = original['geometry']
    selectors = {**original['selectors'], 'format': 'jpg'}
    validate_selectors(selectors, operation=operation)
    root = root if operation == 'contain' else root/operation
    root.mkdir(parents=True, exist_ok=True)
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:sdr:jpg:preserve:preserve:{operation}:authored-srgb-rgb8',
        'cell_id': 'avif-gainmap:sdr:jpg', 'fixture_id': gainmap_avif.FIXTURE_ID,
        'candidate': 'native-authored-base-jpeg-srgb', 'selectors': selectors, 'geometry': operation,
        'source_facts': original['source_facts'], 'source_sha256': original['source_sha256'],
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'threshold_scope': {**(POLICY if operation == 'contain' else GEOMETRY_POLICY),
                            'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'checks': {key: False for key in ('native_encoder', 'native_preparation', 'independent_source_decoder',
            'independent_decoder', 'structure', 'native_storage_appearance', 'appearance', 'privacy')},
        'measurements': {}, 'artifacts': {}, 'blockers': [], 'native_preparation': original}
    try:
        case['checks']['native_preparation'] = (original['status'] == 'qualified'
            and all(original['checks'].values()) and not original['blockers'])
        case['checks']['independent_source_decoder'] = original['checks']['independent_source_decoder']
        if not case['checks']['native_preparation']:
            raise ValueError('Native authored SDR source/geometry preparation did not qualify')
        source, output = Path(original['artifacts']['output']), root/'output.jpg'
        if avif.digest(source) != original['artifacts']['sha256']:
            raise ValueError('Native PNG preparation changed after inspection')
        _, native_pixels = gainmap_avif_png.inspect_and_decode(source)
        case['native_candidate'] = _encode(source, output)
        case['checks']['native_encoder'] = True
        case['artifacts'] = {'output': str(output), 'sha256': avif.digest(output),
                             'source': original['artifacts']['source'], 'source_sha256': original['source_sha256']}
        facts, codes = inspect_and_decode(output, dimensions=SIZES[operation])
        reference = original['reference_sdr']
        reference_path = Path(reference['path'])
        if avif.digest(reference_path) != reference['sha256']:
            raise ValueError('Independent authored SDR reference changed')
        with Image.open(reference_path) as image:
            expected = sdr_signal_to_nits(np.asarray(image).astype(float)/255)
        actual = sdr_signal_to_nits(codes/255)
        measured = compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        stored = compare_appearance(sdr_signal_to_nits(native_pixels[..., :3]), actual,
                                    reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        case['checks'].update({'independent_decoder': True, 'native_storage_appearance': stored['passed'],
            'structure': facts['icc_sha256'] == case['native_candidate']['icc_sha256'],
            'appearance': measured['passed'], 'privacy': facts['privacy']['passed']})
        case.update({'facts': facts, 'reference_sdr': reference, 'measurements': {'sdr': measured, 'native_storage': stored},
            'storage_measurement': {'mismatched_rgb8_samples': int(np.count_nonzero(codes != np.rint(native_pixels[..., :3]*255))),
                'maximum_absolute_code_difference': int(np.max(np.abs(codes.astype(int)-np.rint(native_pixels[..., :3]*255))))},
            'privacy_measurement': facts['privacy']})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def run(directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None, geometries=('contain',)):
    geometries = tuple(geometries)
    if not geometries or len(set(geometries)) != len(geometries) or any(operation not in SIZES for operation in geometries):
        raise ValueError('Expected distinct contain, cover, fill or upscale geometries')
    if selectors is not None:
        if len(geometries) != 1:
            raise ValueError('Explicit selectors require one declared geometry')
        validate_selectors(selectors, operation=geometries[0])
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    prepared = gainmap_avif_png.run(root/'native-png', source_lock=source_lock, geometries=geometries)
    cases = [_case(root, original) for original in prepared['evidence']]
    controls = [{**row, 'case_id': row['case_id'].replace('gainmap-avif-png-', 'gainmap-avif-jpeg-')}
                for row in prepared['controls'] if row.get('original')]
    for label, change in (('hdr', {'range': 'hdr'}), ('depth16', {'depth': '16'}),
                          ('other-gamut', {'gamut': 'p3'}), ('other-geometry', {'w': 174})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': 'gainmap-avif-jpeg-'+label+'-withheld', 'passed': rejected,
                         'status': 'passed' if rejected else 'tested and failed'})
    return {'evidence': cases, 'source_fixtures': prepared['source_fixtures'], 'fixtures': [],
            'controls': controls, 'commands': avif.COMMANDS[start:], 'scope': POLICY if geometries == ('contain',) else GEOMETRY_POLICY,
            'consumer_status': 'pending manual review'}
