"""Authored SDR WebP containment from the locked gain-map AVIF source.

The existing native PNG stage supplies candidate pixels, never reference
pixels. Native libwebp stores them losslessly with an actual sRGB ICC profile.
FFmpeg's independent WebP decoder, strict container/ICC parsing and the same
photographic SDR reference must all pass. This is one opaque static tuple;
HDR rendering and physical consumer behavior are separate qualifications.
"""
import hashlib
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms, features

import authored_lossless
import avif
import gainmap_avif
import gainmap_avif_png
from appearance import compare_appearance, sdr_signal_to_nits


SELECTORS = {**gainmap_avif_png.SELECTORS, 'format': 'webp'}
POLICY = {**gainmap_avif_png.POLICY,
    'output': 'Opaque static lossless RGB8 WebP; independently verified sRGB ICC and exact native geometry codes',
    'scope': 'Only explicit authored SDR WebP containment from the identity-oriented locked source',
    'color_signaling': 'Actual native LittleCMS sRGB matrix/TRC profile; no new tone grade',
    'storage_gate': 'Native FFmpeg WebP decoding must match native libwebp and the inspected PNG intermediate in every RGB8 sample'}


def validate_selectors(selectors):
    if selectors != SELECTORS:
        raise ValueError('Only the exact authored SDR WebP containment selectors are admitted')


def inspect_and_decode(path):
    linear, facts = authored_lossless.decode_linear(path, gamut='srgb')
    if facts['format'] != 'webp' or not facts['privacy']:
        raise ValueError('Expected a private-metadata-free WebP')
    raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'webp', '-i', path, '-frames:v', '1',
                       '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    codes = np.frombuffer(raw, np.uint8).reshape(facts['height'], facts['width'], 3)
    with Image.open(path) as image:
        if (getattr(image, 'n_frames', 1) != 1 or image.getexif().get(274, 1) != 1
                or image.mode != 'RGB' or not np.array_equal(np.asarray(image), codes)):
            raise ValueError('WebP native libwebp and independent FFmpeg RGB8 disagree')
    facts.update({'frames': 1, 'opaque': True, 'orientation': 1, 'square_pixels': True,
                  'aspect_scope': 'WebP canvas has no separate pixel-aspect declaration',
                  'native_decoders_agree': True, 'rgb8_sha256': hashlib.sha256(raw).hexdigest()})
    return facts, codes, linear


def _encode(source, output):
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)
    with Image.open(source) as image:
        # Only actual native candidate samples enter this native encoder.
        # A fresh image prevents incidental source metadata from carrying over.
        clean = Image.frombytes('RGB', image.size, image.convert('RGB').tobytes())
        clean.save(output, format='WEBP', lossless=True, exact=True, method=6, icc_profile=bytes(profile))
    return {'encoder': 'Pillow native libwebp '+features.version('webp'),
            'input': str(source), 'input_sha256': avif.digest(source),
            'icc_sha256': hashlib.sha256(profile).hexdigest(),
            'options': {'lossless': True, 'exact': True, 'method': 6},
            'output_sha256': avif.digest(output)}


def run(directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None):
    validate_selectors(SELECTORS if selectors is None else selectors)
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    prepared = gainmap_avif_png.run(root/'native-png', source_lock=source_lock)
    original = prepared['evidence'][0]
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:sdr:webp:preserve:preserve:contain:authored-rgb8',
        'cell_id': 'avif-gainmap:sdr:webp', 'fixture_id': gainmap_avif.FIXTURE_ID,
        'candidate': 'native-authored-base-webp8', 'selectors': SELECTORS.copy(), 'geometry': 'contain',
        'source_facts': original['source_facts'], 'source_sha256': original['source_sha256'],
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'checks': {key: False for key in ('native_encoder', 'native_preparation', 'independent_source_decoder',
            'independent_decoder', 'structure', 'native_storage', 'appearance', 'privacy')},
        'measurements': {}, 'artifacts': {}, 'blockers': []}
    try:
        case['native_preparation'] = original
        case['checks']['native_preparation'] = (original['status'] == 'qualified'
            and all(original['checks'].values()) and not original['blockers'])
        case['checks']['independent_source_decoder'] = original['checks']['independent_source_decoder']
        if not case['checks']['native_preparation']:
            raise ValueError('Native authored SDR source/geometry preparation did not qualify')
        source, output = Path(original['artifacts']['output']), root/'output.webp'
        if avif.digest(source) != original['artifacts']['sha256']:
            raise ValueError('Native preparation changed after inspection')
        _, native_pixels = gainmap_avif_png.inspect_and_decode(source)
        case['native_candidate'] = _encode(source, output)
        case['checks']['native_encoder'] = True
        case['artifacts'] = {'output': str(output), 'sha256': avif.digest(output)}
        facts, codes, linear = inspect_and_decode(output)
        expected_codes = np.rint(native_pixels[..., :3]*255).astype(np.uint8)
        mismatch = int(np.count_nonzero(codes != expected_codes)) if codes.shape == expected_codes.shape else -1
        case['storage_measurement'] = {'passed': mismatch == 0, 'mismatched_samples': mismatch,
            'input': str(source), 'input_sha256': avif.digest(source),
            'scope': 'Exact native encoder-input RGB8 storage; independent appearance is still required'}
        reference = original['reference_sdr']
        reference_path = Path(reference['path'])
        if avif.digest(reference_path) != reference['sha256']:
            raise ValueError('Independent authored SDR reference changed')
        with Image.open(reference_path) as image:
            expected = sdr_signal_to_nits(np.asarray(image).astype(float)/255)
        measured = compare_appearance(expected, linear, reference_gamut='srgb', actual_gamut='rec2020',
                                     fixture_class='gainmap-sdr')
        case['checks'].update({'independent_decoder': True, 'native_storage': mismatch == 0,
            'structure': (facts['width'], facts['height'], facts['depth'], facts['orientation'], facts['frames']) == (173, 130, 8, 1, 1)
                and facts['opaque'] and facts['square_pixels'] and facts['gamut'] == facts['transfer'] == 'srgb'
                and facts['icc_sha256'] == case['native_candidate']['icc_sha256'],
            'appearance': measured['passed'], 'privacy': facts['privacy']})
        case.update({'facts': facts, 'reference_sdr': reference, 'measurements': {'sdr': measured}})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    # The source controls execute before the WebP encoder in the shared native
    # preparation. Do not inherit that module's PNG-specific selector claims.
    controls = [{**row, 'case_id': row['case_id'].replace('gainmap-avif-png-', 'gainmap-avif-webp-')}
                for row in prepared['controls'] if row.get('original')]
    for label, change in (('hdr', {'range': 'hdr'}), ('depth16', {'depth': '16'}),
                          ('other-gamut', {'gamut': 'p3'}), ('other-geometry', {'w': 174})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': 'gainmap-avif-webp-'+label+'-withheld', 'passed': rejected,
                         'status': 'passed' if rejected else 'tested and failed'})
    return {'evidence': [case], 'source_fixtures': prepared['source_fixtures'], 'fixtures': [],
            'controls': controls, 'commands': avif.COMMANDS[start:], 'scope': POLICY,
            'consumer_status': 'pending manual review'}
