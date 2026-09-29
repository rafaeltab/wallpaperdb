"""Explicit PQ16 P3 PNG containment of the documented old Apple full effect.

Declared before encoding: unchanged gainmap-hdr gates apply to native source,
float Lanczos geometry and the independently decoded output, with no source
precision allowance. Native JPEG samples feed float FFmpeg/zimg and PNG;
independent documented reference arrays are used only for measurements.
This single-layer file does not embed an authored SDR base or qualify display
adaptation. Only the locked source and explicit selectors are admitted.
"""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

import apple_native_source
import apple_source_model
import avif
import gainmap
import gainmap_hdr
import gainmap_linear
import hdr_png
import hdr_png8_precision
from appearance import compare_appearance, THRESHOLDS_SHA256

SELECTORS = {'format': 'png', 'range': 'hdr', 'gamut': 'preserve', 'depth': '16',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
CHROMATICITIES = [31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000]
DEPENDENCIES = ('apple_hdr_png.py', 'test_apple_hdr_png.py', *apple_native_source.DEPENDENCIES,
                'gainmap_linear.py', 'gainmap_hdr.py', 'hdr_png.py', 'hdr_png8_precision.py')


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')


def encode(linear, output):
    if (linear.get('format') != 'gbrapf32le' or linear.get('gamut') != 'p3'
            or linear.get('normalization_nits') != 203
            or (linear.get('width'), linear.get('height')) != (173, 231)):
        raise ValueError('Only the declared P3 float containment is admitted')
    filters = ('setparams=alpha_mode=premultiplied,zscale=agamma=0:transferin=linear:transfer=16:'
        'primariesin=12:primaries=12:matrixin=0:matrix=0:rangein=full:range=full:npl=203,'
        'format=gbrapf32le:alpha_modes=premultiplied,format=gbrpf32le,'
        'zscale=agamma=0:transferin=16:transfer=16:primariesin=12:primaries=12:'
        'matrixin=0:matrix=0:rangein=full:range=full:npl=10000,format=rgb48le,setsar=1')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
        '-s', '173x231', '-i', linear['path'], '-vf', filters, '-frames:v', '1',
        '-map_metadata', '-1', '-threads', '1', output])
    return {'filters': filters, 'input': linear, 'encoder': 'Native FFmpeg PNG after float32 zimg transfer'}


def inspect_output(path):
    """Validate the actual bounded RGB16/CICP PNG subset through two decoders."""
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    kinds = [kind for kind, _ in chunks]
    unique = (b'IHDR', b'cICP', b'cHRM', b'pHYs', b'IEND')
    if (any(kind not in (*unique, b'IDAT') for kind in kinds)
            or any(kinds.count(kind) != 1 for kind in unique) or b'IDAT' not in kinds
            or any(kinds.index(kind) > kinds.index(b'IDAT') for kind in unique[:-1])
            or any(kind != b'IDAT' for kind in kinds[kinds.index(b'IDAT'):-1])):
        raise ValueError('Missing, conflicting or private PNG color/frame/metadata chunks')
    data = {kind: payload for kind, payload in chunks if kind != b'IDAT'}
    if (data[b'cICP'] != bytes((12, 16, 0, 1))
            or data[b'cHRM'] != struct.pack('>8I', *CHROMATICITIES)
            or data[b'pHYs'] != struct.pack('>IIB', 1, 1, 0)):
        raise ValueError('Expected actual full-range P3 PQ and square pixels')
    facts, rgba = hdr_png8_precision.inspect_hdr_png16(path)
    if ((facts['width'], facts['height'], facts['depth'], facts['color_type'], facts['orientation'])
            != (173, 231, 16, 2, 1) or not np.all(rgba[..., 3] == 1)):
        raise ValueError('Expected static opaque identity-oriented containment PNG16')
    tags = facts['exiftool']
    if ([tags.get(key) for key in ('WhitePointX', 'WhitePointY', 'RedX', 'RedY', 'GreenX', 'GreenY', 'BlueX', 'BlueY')]
            != [value/100000 for value in CHROMATICITIES]
            or [tags.get(key) for key in ('PixelsPerUnitX', 'PixelsPerUnitY', 'PixelUnits')] != [1, 1, 0]
            or gainmap.private_metadata_tags(tags)):
        raise ValueError('Independent ExifTool disagrees with color, aspect or privacy')
    raw = avif.native(['ffmpeg', '-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo',
                       '-pix_fmt', 'rgb48le', 'pipe:1'])
    expected = np.rint(rgba[..., :3]*65535).astype('<u2')
    if len(raw) != expected.nbytes or not np.array_equal(np.frombuffer(raw, '<u2').reshape(expected.shape), expected):
        raise ValueError('Independent native libpng and FFmpeg RGB16 samples disagree')
    facts.update({'physical_pixel_dimensions': [1, 1, 0], 'square_pixels': True, 'frames': 1, 'opaque': True,
        'native_decoders_agree': True, 'decoded_rgb16_sha256': hashlib.sha256(expected.tobytes()).hexdigest(),
        'chunk_order': [kind.decode() for kind in kinds]})
    return facts, rgba


def run(directory, *, source=apple_source_model.SOURCE, selectors=None):
    source = Path(source)
    if ((selectors is not None and selectors != SELECTORS)
            or avif.digest(source) != apple_source_model.SOURCE_SHA256):
        raise ValueError('Only the locked source and explicit PQ16 P3 containment selectors are admitted; original only otherwise')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in DEPENDENCIES}
    case = {'case_id': 'gainmap-apple-old:hdr:png:preserve:16:contain:documented-full-native',
        'cell_id': 'gainmap-jpeg:hdr:png', 'fixture_id': 'gainmap-apple-old',
        'source_sha256': apple_source_model.SOURCE_SHA256, 'source_reference_revision': apple_source_model.REFERENCE_REVISION,
        'proof_module': 'apple_hdr_png', 'candidate': 'documented-full-native-pq16',
        'geometry': 'contain', 'selectors': dict(SELECTORS), 'status': 'tested and failed',
        'consumer_status': 'pending manual review',
        'qualification_scope': 'One explicit single-layer PQ16 P3 PNG at documented full Apple effect, after containment. '
            'Other depths, geometries, source models and physical consumers require separate evidence.',
        'known_consumer_limitations': ['No embedded authored SDR base or gain map. '
            'Display tone mapping and OS wallpaper behavior remain pending physical review.'],
        'rendering_scope': {'source_full_headroom': 8, 'source_reference_revision': apple_source_model.REFERENCE_REVISION,
            'output': 'Fixed absolute PQ luminance, not an adaptive gain map', 'intermediate_adaptation_qualified': False},
        'threshold_scope': {'declared_before_native_measurements': True, 'profile': 'gainmap-hdr',
            'thresholds_sha256': THRESHOLDS_SHA256, 'source_quantization_allowance': 0,
            'reference': 'Documented full Rec709/linear old Apple source, then unchanged independent P3 float Lanczos containment'},
        'checks': {key: False for key in ('native_encoder', 'independent_source_decoder', 'native_source_precision',
            'native_geometry', 'independent_decoder', 'structure', 'appearance', 'privacy', 'integrity')},
        'measurements': {}, 'artifacts': {}, 'blockers': []}
    report = {'cases': [case]}
    try:
        prepared = apple_native_source.run(directory/'source')
        report['source_preparation'] = prepared
        if prepared['status'] != 'qualified source preparation' or not all(prepared['checks'].values()):
            raise ValueError('Documented native source preparation did not qualify')
        reference = gainmap.array_geometry(np.load(prepared['reference']['path']), 'contain')
        reference_path = directory/'independent-full-reference.npy'
        np.save(reference_path, reference)
        sdr = gainmap.geometry(gainmap.source_image(apple_source_model.SOURCE, 'preserve'), 'contain', 1)
        profile = sdr.info.get('icc_profile')
        sdr.info.clear()
        sdr_path = directory/'reference-sdr.png'
        sdr.save(sdr_path, icc_profile=profile)
        linear = gainmap_linear.resample_linear(prepared['native_source'], directory/'native-geometry.gbrapf32', 'contain')
        output = directory/'output.png'
        writer = encode(linear, output)
        bound = {**prepared['bound_files'], str(source): apple_source_model.SOURCE_SHA256,
            str(output): avif.digest(output), str(reference_path): avif.digest(reference_path),
            str(sdr_path): avif.digest(sdr_path), str(linear['path']): avif.digest(linear['path'])}
        case['checks']['native_encoder'] = True
        case['artifacts'] = {'source': str(source), 'source_sha256': apple_source_model.SOURCE_SHA256,
                             'output': str(output), 'sha256': bound[str(output)]}
        facts, pixels = inspect_output(output)
        measurements = {'native_source': prepared['measurement'],
            'native_geometry': _measure(reference, gainmap_hdr.read_linear(linear)),
            'hdr': _measure(reference, avif.decode_transfer(pixels[..., :3], 'pq', 'p3'))}
        case.update({'source_facts': prepared['native_source']['source_facts']['facts'],
            'source_decoder_evidence': prepared, 'native_geometry': linear, 'native_writer': writer,
            'reference_hdr': {'path': str(reference_path), 'sha256': bound[str(reference_path)],
                'dimensions': [173, 231], 'gamut': 'p3', 'transfer': 'linear', 'units': 'cd/m2',
                'source_reference_revision': apple_source_model.REFERENCE_REVISION},
            'reference_sdr': {'path': str(sdr_path), 'sha256': bound[str(sdr_path)], 'gamut': 'p3',
                'purpose': 'Matched authored SDR for manual comparison; the single-layer HDR output has no SDR-base qualification'},
            'facts': facts, 'measurements': measurements})
        case['checks'].update({'independent_source_decoder': True, 'native_source_precision': prepared['measurement']['passed'],
            'native_geometry': measurements['native_geometry']['passed'], 'independent_decoder': True,
            'structure': True, 'appearance': all(row['passed'] for row in measurements.values()), 'privacy': True})
        if (any(avif.digest(path) != sha for path, sha in bound.items())
                or any(avif.digest(Path(__file__).with_name(name)) != sha for name, sha in hashes.items())):
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
