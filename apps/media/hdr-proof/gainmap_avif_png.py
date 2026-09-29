"""One explicit authored-SDR PNG8 derivative from the locked gain-map AVIF.

Declare the unchanged gainmap-sdr profile before measurements. The reference
uses actual dav1d-decoded base samples and independent Pillow Lanczos geometry;
the earlier JPEG import contributes no derivative error allowance. AOM supplies
candidate pixels, native zimg resizes them, and native FFmpeg writes RGB8 PNG.
Exact lossless storage is an additional gate, never an appearance substitute.
This preserves the authored SDR grade, without applying a new HDR tone map.
HDR reconstruction, other selectors and physical consumers stay unqualified.
The native SDR encoder writes sRGB/cHRM/gAMA, not CICP. The initial CICP-only
inspector assumption was corrected without changing coded RGB or appearance
gates. The final writer also declares square pixels explicitly. Inspect the
actual standard triplet and use its authoritative sRGB curve:
https://www.w3.org/TR/png-3/#11sRGB
"""
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

import avif
import gainmap_avif
import hdr_png
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap import geometry
from gainmap_sdr import _axis


SELECTORS = {'format': 'png', 'range': 'sdr', 'gamut': 'preserve', 'depth': 'preserve',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
POLICY = {
    'declared_before_native_measurements': True,
    'profile': 'gainmap-sdr',
    'rationale': 'Existing authored photographic SDR gates apply to actual source base samples at nominal 100 nit white; lossless output receives no extra allowance',
    'source_quantization': 'JPEG-to-AVIF import is separate and excluded from derivative error budgets',
    'reference_revision': 'gainmap-avif-authored-base-pillow-lanczos-v1',
    'geometry': 'Independent Pillow RGB8 Lanczos from actual dav1d base samples to 173 x 130',
    'output': 'Opaque static RGB8 PNG, square pixels, standard sRGB/cHRM/gAMA signaling, exact native geometry codes',
    'color_signaling': 'The actual sRGB chunk defines the transfer; gAMA 45455 is its standard compatibility approximation, not a different grade',
    'scope': 'Only the exact explicit authored-SDR PNG8 containment tuple; identity-oriented locked source',
    'hdr_scope': 'No HDR reconstruction or HDR derivative qualification',
}


def validate_selectors(selectors):
    if selectors != SELECTORS:
        raise ValueError('Only the exact explicit SDR PNG containment selectors are admitted')


def inspect_and_decode(path):
    """Check the actual restricted PNG structure before independent libpng decode."""
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    kinds = [kind for kind, _ in chunks]
    if (any(kind not in (b'IHDR', b'sRGB', b'cHRM', b'gAMA', b'pHYs', b'IDAT', b'IEND') for kind in kinds)
            or any(kinds.count(kind) != 1 for kind in (b'IHDR', b'sRGB', b'cHRM', b'gAMA', b'pHYs', b'IEND'))
            or b'IDAT' not in kinds
            or any(kinds.index(kind) > kinds.index(b'IDAT') for kind in (b'sRGB', b'cHRM', b'gAMA'))
            or any(kind != b'IDAT' for kind in kinds[kinds.index(b'IDAT'):-1])):
        raise ValueError('PNG output has missing, ambiguous or unsupported color/frame/metadata chunks')
    header = next(payload for kind, payload in chunks if kind == b'IHDR')
    color = {kind: payload for kind, payload in chunks if kind in (b'sRGB', b'cHRM', b'gAMA')}
    chromaticities = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000]
    if (len(header) != 13 or color[b'sRGB'] != bytes((1,))
            or color[b'gAMA'] != struct.pack('>I', 45455)
            or color[b'cHRM'] != struct.pack('>8I', *chromaticities)):
        raise ValueError('Expected actual RGB8 SDR PNG signaling')
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', header)
    if (not 0 < width <= 4096 or not 0 < height <= 4096 or depth != 8 or color_type != 2
            or (compression, filtering, interlace) != (0, 0, 0)):
        raise ValueError('Expected bounded non-interlaced opaque RGB8 PNG')
    physical = next(payload for kind, payload in chunks if kind == b'pHYs')
    if physical != struct.pack('>IIB', 1, 1, 0):
        raise ValueError('Expected explicit square PNG pixels with unspecified physical density')
    exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
    if (exif.get('FileType'), exif.get('ImageWidth'), exif.get('ImageHeight'), exif.get('BitDepth'),
            exif.get('ColorType'), exif.get('Orientation', 1)) != ('PNG', width, height, 8, 2, 1):
        raise ValueError('Independent ExifTool disagrees with actual PNG structure/orientation')
    if (exif.get('SRGBRendering') != 1 or exif.get('Gamma') != 2.2
            or [exif.get(key) for key in ('WhitePointX', 'WhitePointY', 'RedX', 'RedY',
                                          'GreenX', 'GreenY', 'BlueX', 'BlueY')]
                != [value / 100000 for value in chromaticities]):
        raise ValueError('Independent ExifTool disagrees with actual PNG sRGB/cHRM/gAMA')
    if [exif.get(key) for key in ('PixelsPerUnitX', 'PixelsPerUnitY', 'PixelUnits')] != [1, 1, 0]:
        raise ValueError('Independent ExifTool disagrees with actual PNG pixel aspect ratio')
    raw = avif.native(['hdr-proof-png-decode', path])
    if len(raw) != 12 + width * height * 8 or struct.unpack('<III', raw[:12]) != (width, height, 8):
        raise ValueError('Independent libpng disagrees with actual PNG precision/dimensions')
    coded = np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4)
    if np.any(coded % 257) or np.any(coded[..., 3] != 65535):
        raise ValueError('Independent libpng did not recover opaque expanded RGB8 samples')
    pixels = coded.astype(float)/65535
    return {'width': width, 'height': height, 'depth': depth, 'color_type': color_type,
            'color_signaling': 'sRGB with consistent cHRM/gAMA', 'gamut': 'srgb', 'transfer': 'srgb',
            'srgb_rendering_intent': 1, 'encoded_gamma': 45455, 'chromaticities': chromaticities,
            'physical_pixel_dimensions': [1, 1, 0], 'square_pixels': True,
            'orientation': 1, 'frames': 1, 'opaque': True,
            'libpng_source_depth': 8, 'decoder': 'Independent native libpng; unchanged coded RGB and alpha',
            'chunk_order': [kind.decode() for kind in kinds],
            'exiftool': {key: value for key, value in exif.items() if key not in (
                'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')}}, pixels


def _controls(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    original = gainmap_avif.copy_original(source, directory/'original.avif')
    controls = [{'case_id': 'gainmap-avif-png-original-exact-bytes', 'passed': original['exact_bytes'],
                 'source_sha256': avif.digest(source), 'original': original}]
    before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
    data = source.read_bytes()
    if data.count(before) != 1:
        raise ValueError('PNG proof controls require one unambiguous actual source base color property')
    for name, after in (('unknown-color', b'nclx\x00\x02\x00\x0d\x00\x00\x80'),
                        ('unknown-transfer', b'nclx\x00\x01\x00\x02\x00\x00\x80')):
        changed = directory/f'{name}.avif'
        changed.write_bytes(data.replace(before, after))
        native_facts = avif.inspect_avif(changed)
        decision = gainmap_avif.source_decision(changed, directory/name)
        copied = gainmap_avif.copy_original(changed, directory/f'{name}-original.avif')
        controls.append({'case_id': f'gainmap-avif-png-{name}-original-only',
            'passed': decision['action'] == 'original only' and copied['exact_bytes'],
            'decision': decision, 'native_file_facts': native_facts, 'original': copied})
    for name, change in (('hdr', {'range': 'hdr'}), ('depth16', {'depth': '16'}),
                         ('other-geometry', {'w': 174}), ('other-gamut', {'gamut': 'p3'})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': f'gainmap-avif-png-unproved-{name}-withheld', 'passed': rejected})
    return [{**control, 'status': 'passed' if control['passed'] else 'tested and failed'} for control in controls]


def run(output_directory, *, source_lock=gainmap_avif.SOURCE_LOCK):
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source, fixture = gainmap_avif.generate_source(root/'source', source_lock=source_lock)
    source_facts, base_codes = gainmap_avif.inspect_source(source, root/'source-inspection')
    fixture.update({'facts': source_facts, 'source_valid': True,
                    'valid_scope': 'Established authored SDR base only; HDR reconstruction untested'})
    controls = _controls(source, root/'controls')
    selectors = dict(SELECTORS)
    validate_selectors(selectors)
    folder = root/'contain'
    folder.mkdir(exist_ok=True)
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:sdr:png:preserve:preserve:contain:authored-rgb8',
        'fixture_id': gainmap_avif.FIXTURE_ID, 'cell_id': 'avif-gainmap:sdr:png',
        'selectors': selectors, 'geometry': 'contain', 'candidate': 'native-authored-base-png8',
        'source_facts': source_facts, 'source_sha256': avif.digest(source),
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'independent_source_decoder',
                                        'structure', 'appearance', 'privacy')},
        'blockers': [], 'measurements': {}, 'artifacts': {},
        'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}}
    try:
        reference = geometry(Image.fromarray(base_codes), 'contain')
        reference_path = folder/'reference-sdr.png'
        reference.save(reference_path)
        expected = np.asarray(reference).astype(float)/255
        case['reference_sdr'] = {'path': str(reference_path), 'sha256': avif.digest(reference_path),
            'gamut': 'srgb', 'transfer': 'srgb', 'revision': POLICY['reference_revision']}
        # Reference arrays never enter the candidate decoder or encoder.
        base = folder/'base-aom.png'
        avif.native(['avifdec', '-j', '1', '-c', 'aom', '-d', '8', source, base])
        native_codes = np.rint(avif.read_png(base)[..., :3]*255).astype(np.uint8)
        agreement = bool(np.array_equal(native_codes, base_codes))
        if not agreement:
            raise ValueError('Native candidate source samples disagree with independent dav1d')
        case['checks']['independent_source_decoder'] = True
        horizontal, resized, target = folder/'horizontal.png', folder/'authored.png', folder/'output.png'
        source_width, source_height = source_facts['base']['dimensions']
        width = selectors['w']
        height = int(source_height * width / source_width + .5)
        first = _axis(['-i', base], horizontal, width, source_height)
        second = _axis(['-i', horizontal], resized, width, height)
        # AOM's PNG bridge has an unspecified 0:1 sample aspect. Declare square
        # pixels without changing the coded RGB, then prove actual pHYs below.
        filters = 'format=rgb24,setsar=1,sidedata=mode=delete,setparams=color_primaries=1:color_trc=13:colorspace=0:range=full'
        avif.native(['ffmpeg', '-v', 'error', '-y', '-i', resized, '-vf', filters,
                     '-pix_fmt', 'rgb24', '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', target])
        case['checks']['native_encoder'] = True
        facts, actual = inspect_and_decode(target)
        coded_input = avif.read_png(resized)
        mismatch = int(np.count_nonzero(actual != coded_input)) if actual.shape == coded_input.shape else -1
        facts['lossless_storage'] = {'passed': mismatch == 0, 'mismatched_rgba_samples': mismatch,
            'reference': 'Independent libpng readback of actual native geometry RGB8 encoder input',
            'input': str(resized), 'input_sha256': avif.digest(resized)}
        structure = {'dimensions': actual.shape[:2] == expected.shape[:2], 'depth': facts['depth'] == 8,
            'color_signaling': facts['gamut'] == facts['transfer'] == 'srgb', 'opaque_source_retained': facts['opaque'],
            'square_pixels': facts['square_pixels'],
            'orientation_baked': facts['orientation'] == 1, 'static': facts['frames'] == 1,
            'exact_lossless_storage': facts['lossless_storage']['passed']}
        privacy = hdr_png.inspect_privacy(target, facts, 'png')
        measured = compare_appearance(sdr_signal_to_nits(expected), sdr_signal_to_nits(actual[..., :3]),
            reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        case['checks'].update({'independent_decoder': True, 'structure': all(structure.values()),
                              'appearance': measured['passed'], 'privacy': privacy['passed']})
        case.update({'facts': facts, 'structural_checks': structure, 'privacy_measurement': privacy,
            'native_candidate': {'source_decoder': 'AOM AV1 via libavif', 'source_samples_match_dav1d': agreement,
                'geometry_filters': [first, second], 'png_filter': filters, 'encoder': 'Native FFmpeg RGB8 PNG'},
            'measurements': {'sdr': measured},
            'artifacts': {'output': str(target), 'sha256': avif.digest(target),
                          'source': str(source), 'source_sha256': avif.digest(source)}})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return {'evidence': [case], 'fixtures': [], 'source_fixtures': [fixture], 'controls': controls,
            'commands': avif.COMMANDS[start:], 'scope': POLICY, 'hdr_status': 'untested',
            'hdr_blocker': 'Independent matched-source HDR reconstruction and gain-map geometry remain unproved'}
