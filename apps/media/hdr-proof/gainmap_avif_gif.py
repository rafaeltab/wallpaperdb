"""One native authored-SDR GIF containment, including retained palette error.

GIF89a structure follows https://www.w3.org/Graphics/GIF/spec-gif89a.txt.
ICC application framing follows ICC.1:2010 Annex B.5. Neither specification
nor successful decoding qualifies appearance: the unchanged photographic
SDR gates measure the actual palette against both native input and reference.
"""
import hashlib
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

import avif
import gainmap_avif
import gainmap_avif_png
from appearance import THRESHOLDS, compare_appearance, linear_rgb_to_itp, sdr_signal_to_nits
from gainmap_iso import srgb_profile_facts

SELECTORS = {**gainmap_avif_png.SELECTORS, 'format': 'gif'}
POLICY = {**gainmap_avif_png.POLICY,
    'scope': 'Only opaque static authored SDR GIF containment of the locked identity-oriented source',
    'output': 'Native FFmpeg RGB8 palette, 256 colors, Sierra2_4A dithering; actual standard sRGB ICC',
    'palette_policy': 'Use the full opaque palette; no reference pixels feed palette generation',
    'threshold_reason': 'The existing photographic gainmap-sdr profile applies to this same authored base. '
        'Both palette-only and full-reference errors must pass without changes to color, grade or thresholds.'}


def validate_selectors(selectors):
    if selectors != SELECTORS:
        raise ValueError('Only the exact authored SDR GIF containment selectors are admitted')


def _structure(data):
    position = 0

    def take(size):
        nonlocal position
        if position+size > len(data):
            raise ValueError('Truncated GIF structure')
        result = data[position:position+size]
        position += size
        return result

    def blocks():
        chunks = []
        while True:
            size = take(1)[0]
            if not size:
                return b''.join(chunks)
            chunks.append(take(size))

    if take(6) != b'GIF89a':
        raise ValueError('Expected native GIF89a')
    width, height, flags, background, aspect = struct.unpack('<HHBBB', take(7))
    if not width or not height or not flags & 128 or aspect not in (0, 49):
        raise ValueError('Unsupported GIF canvas, palette or aspect')
    global_colors = 2**((flags & 7)+1)
    if background >= global_colors:
        raise ValueError('GIF background exceeds palette')
    take(3*global_colors)
    profiles, frames, delays, palettes, unused_indices = [], 0, [], [], []
    while True:
        marker = take(1)[0]
        if marker == 0x3b:
            if position != len(data):
                raise ValueError('Unexpected trailing GIF bytes')
            break
        if marker == 0x21:
            label = take(1)[0]
            if label == 0xff:
                if take(1)[0] != 11 or take(11) != b'ICCRGBG1012':
                    raise ValueError('Unsupported GIF application extension')
                profiles.append(blocks())
            elif label == 0xf9:
                if take(1)[0] != 4:
                    raise ValueError('Invalid GIF graphic control extension')
                control, delay, transparent = struct.unpack('<BHB', take(4))
                if control not in (0, 4) or take(1) != b'\0' or frames or delays:
                    raise ValueError('Unsupported GIF alpha, disposal or control extension')
                # GIF89a 23.c: the index is meaningful only when bit0 is set.
                # Both admitted controls leave bit0 clear; both decoders must
                # still establish every actual output alpha sample is opaque.
                unused_indices.append(transparent)
                delays.append(delay*10)
            else:
                raise ValueError('Unsupported or private GIF extension')
        elif marker == 0x2c:
            x, y, w, h, flags = struct.unpack('<HHHHB', take(9))
            if (x, y, w, h) != (0, 0, width, height) or flags & 0x78 or frames:
                raise ValueError('Expected one complete noninterlaced GIF raster')
            count = 2**((flags & 7)+1) if flags & 128 else global_colors
            if flags & 128:
                take(3*count)
            palettes.append(count)
            if not 2 <= take(1)[0] <= 8 or not blocks():
                raise ValueError('Invalid GIF LZW image data')
            frames += 1
        else:
            raise ValueError('Unsupported GIF block')
    if frames != 1 or len(profiles) != 1:
        raise ValueError('Expected one GIF frame and one actual ICC profile')
    return {'width': width, 'height': height, 'frames': frames, 'palette_channel_depth': 8,
            'global_palette_colors': global_colors, 'frame_palette_colors': palettes,
            'pixel_aspect_byte': aspect, 'pixel_aspect': None if aspect == 0 else [1, 1],
            'aspect_scope': 'Logical raster dimensions; zero has no separate aspect declaration',
            'unused_transparency_indices': unused_indices,
            'durations_ms': delays or [None], 'loop': None, 'opaque': True}, profiles[0]


def inspect_and_decode(path):
    path = Path(path)
    facts, profile = _structure(path.read_bytes())
    color = srgb_profile_facts(profile)
    if color['gamut'] != 'srgb':
        raise ValueError('GIF requires actual sRGB ICC color facts')
    extracted = avif.native(['exiftool', '-b', '-ICC_Profile', path])
    if extracted != profile:
        raise ValueError('Independent GIF ICC extraction disagrees')
    with Image.open(path) as image:
        if image.format != 'GIF' or image.n_frames != 1 or image.info.get('loop') is not None:
            raise ValueError('Expected static GIF without looping')
        codes = np.asarray(image.convert('RGBA'))
        if image.info.get('duration') != facts['durations_ms'][0]:
            raise ValueError('Independent GIF delay inspection disagrees')
    raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'gif', '-i', path, '-frames:v', '1',
                       '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])
    native = np.frombuffer(raw, np.uint8).reshape(facts['height'], facts['width'], 4)
    if not np.array_equal(codes, native) or not np.all(codes[..., 3] == 255):
        raise ValueError('Independent GIF pixels or opacity disagree')
    facts.update({'format': 'gif', 'depth': 8, 'depth_basis': 'RGB palette entries have eight-bit channels',
        'gamut': 'srgb', 'transfer': 'srgb', 'icc': color, 'icc_sha256': hashlib.sha256(profile).hexdigest(),
        'orientation': 1, 'privacy': True, 'decoder': 'Pillow GIF and native FFmpeg GIF with exact RGBA agreement',
        'rgb8_sha256': hashlib.sha256(codes[..., :3].tobytes()).hexdigest()})
    return facts, codes, sdr_signal_to_nits(codes[..., :3]/255)


def _encode(source, output):
    filters = ('[0:v]format=rgb24,split[image][palette];'
               '[palette]palettegen=max_colors=256:reserve_transparent=0[pal];'
               '[image][pal]paletteuse=dither=sierra2_4a')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-filter_complex_threads', '1', '-i', source,
        '-filter_complex', filters, '-frames:v', '1', '-loop', '-1', '-map_metadata', '-1', '-threads', '1', output])
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)
    icc = output.with_suffix('.icc')
    icc.write_bytes(profile)
    avif.native(['exiftool', '-overwrite_original', f'-ICC_Profile<={icc}', output])
    return {'encoder': 'Native pinned FFmpeg palettegen, paletteuse and GIF encoder', 'native_filters': filters,
            'input': str(source), 'input_sha256': avif.digest(source),
            'icc_sha256': hashlib.sha256(profile).hexdigest(), 'output_sha256': avif.digest(output)}


def _palette_bound(output, reference, reference_path):
    """Read-only lower bound; no candidate encoder uses these reference pixels."""
    with Image.open(output) as image:
        palette = np.asarray(image.getpalette(), dtype=float).reshape(-1, 3)/255
    colors = linear_rgb_to_itp(sdr_signal_to_nits(palette), 'srgb')
    pixels = linear_rgb_to_itp(reference, 'srgb').reshape(-1, 3)
    minimum = np.concatenate([720*np.linalg.norm(
        pixels[start:start+512, None, :]-colors[None, :, :], axis=-1).min(axis=1)
        for start in range(0, len(pixels), 512)])
    limit = THRESHOLDS['profiles']['gainmap-sdr']['delta_e_max']
    return {'scope': 'Lower bound for this exact palette only, even with optimal per-pixel choice. '
                'No converter qualification or impossibility claim for other palettes.',
        'output_sha256': avif.digest(output), 'reference_sha256': avif.digest(reference_path),
        'palette_entries': len(palette), 'total_pixels': len(pixels), 'fixed_maximum': limit,
        'minimum_error_mean': float(minimum.mean()), 'minimum_error_p95': float(np.percentile(minimum, 95)),
        'minimum_error_max': float(minimum.max()), 'pixels_above_fixed_maximum': int(np.count_nonzero(minimum > limit))}


def run(directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None):
    validate_selectors(SELECTORS if selectors is None else selectors)
    root = Path(directory)
    start = len(avif.COMMANDS)
    prepared = gainmap_avif_png.run(root/'native-png', source_lock=source_lock)
    original = prepared['evidence'][0]
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:sdr:gif:preserve:preserve:contain:authored-srgb256-sierra24',
        'cell_id': 'avif-gainmap:sdr:gif', 'fixture_id': gainmap_avif.FIXTURE_ID,
        'candidate': 'native-authored-base-gif-srgb256-sierra24', 'selectors': dict(SELECTORS), 'geometry': 'contain',
        'source_facts': original['source_facts'], 'source_sha256': original['source_sha256'],
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': 'One opaque static authored SDR palette; no HDR or physical consumer qualification',
        'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'checks': {key: False for key in ('native_encoder', 'native_preparation', 'independent_source_decoder',
            'independent_decoder', 'structure', 'native_palette', 'appearance', 'privacy')},
        'measurements': {}, 'artifacts': {}, 'blockers': [], 'native_preparation': original}
    try:
        case['checks']['native_preparation'] = (original['status'] == 'qualified'
            and all(original['checks'].values()) and not original['blockers'])
        case['checks']['independent_source_decoder'] = original['checks']['independent_source_decoder']
        if not case['checks']['native_preparation']:
            raise ValueError('Native authored SDR source/geometry preparation did not qualify')
        source, output = Path(original['artifacts']['output']), root/'output.gif'
        if avif.digest(source) != original['artifacts']['sha256']:
            raise ValueError('Native preparation changed after inspection')
        _, native_pixels = gainmap_avif_png.inspect_and_decode(source)
        case['native_candidate'] = _encode(source, output)
        case['checks']['native_encoder'] = True
        case['artifacts'] = {'output': str(output), 'sha256': avif.digest(output)}
        facts, _, linear = inspect_and_decode(output)
        palette = compare_appearance(sdr_signal_to_nits(native_pixels[..., :3]), linear,
            reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        reference = original['reference_sdr']
        reference_path = Path(reference['path'])
        if avif.digest(reference_path) != reference['sha256']:
            raise ValueError('Independent authored SDR reference changed')
        with Image.open(reference_path) as image:
            expected = sdr_signal_to_nits(np.asarray(image).astype(float)/255)
        measured = compare_appearance(expected, linear, reference_gamut='srgb', actual_gamut='srgb',
                                     fixture_class='gainmap-sdr')
        case['palette_lower_bound'] = _palette_bound(output, expected, reference_path)
        case['checks'].update({'independent_decoder': True, 'native_palette': palette['passed'],
            'structure': (facts['width'], facts['height'], facts['depth'], facts['orientation'], facts['frames'])
                == (expected.shape[1], expected.shape[0], 8, 1, 1) and facts['opaque']
                and facts['icc_sha256'] == case['native_candidate']['icc_sha256'],
            'appearance': measured['passed'], 'privacy': facts['privacy']})
        case.update({'facts': facts, 'reference_sdr': reference, 'measurements': {'sdr': measured, 'palette': palette}})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    controls = [{**row, 'case_id': row['case_id'].replace('gainmap-avif-png-', 'gainmap-avif-gif-')}
                for row in prepared['controls'] if row.get('original')]
    for label, change in (('hdr', {'range': 'hdr'}), ('depth16', {'depth': '16'}),
                          ('other-gamut', {'gamut': 'p3'}), ('other-geometry', {'w': 174})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': 'gainmap-avif-gif-'+label+'-withheld', 'passed': rejected,
                         'status': 'passed' if rejected else 'tested and failed'})
    return {'evidence': [case], 'source_fixtures': prepared['source_fixtures'], 'fixtures': [],
            'controls': controls, 'commands': avif.COMMANDS[start:], 'scope': POLICY,
            'source_hashes': {name: avif.digest(Path(__file__).with_name(name)) for name in
                ('gainmap_avif_gif.py', 'gainmap_avif_png.py', 'gainmap_avif.py', 'gainmap_iso.py',
                 'appearance.py', 'thresholds.json')},
            'consumer_status': 'pending manual review'}
