"""Explicit P3 PQ PNG8 containment from the documented old Apple full effect.

Before measurements: retain the photographic gainmap-hdr gates used by both
PNG16 candidates. Native zimg rounds the inspected native PQ16 codes to RGB8;
libpng and FFmpeg must independently recover those exact nearest codes.
Reference arrays never feed an encoder. The two existing PNG16 files remain
nested evidence. Their comparison describes a change of requested depth, not
a claim that coarser output improves precision or display compatibility.
"""
import copy
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

import apple_hdr_png
import apple_hdr_png_precision
import apple_source_model
import avif
import gainmap
import hdr_png
import hdr_png8
from appearance import compare_appearance
from apple_hdr_avif_precision import _regional_changes

SELECTORS = {**apple_hdr_png.SELECTORS, 'depth': '8'}
DEPENDENCIES = ('apple_hdr_png8.py', 'test_apple_hdr_png8.py', 'hdr_png8.py',
                'apple_hdr_avif_precision.py', *apple_hdr_png_precision.DEPENDENCIES)


def inspect_output(path):
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    kinds = [kind for kind, _ in chunks]
    unique = (b'IHDR', b'cICP', b'cHRM', b'pHYs', b'IEND')
    if (any(kind not in (*unique, b'IDAT') for kind in kinds)
            or any(kinds.count(kind) != 1 for kind in unique) or b'IDAT' not in kinds
            or any(kinds.index(kind) > kinds.index(b'IDAT') for kind in unique[:-1])
            or any(kind != b'IDAT' for kind in kinds[kinds.index(b'IDAT'):-1])):
        raise ValueError('Missing, conflicting or private PNG8 color/frame/metadata chunks')
    data = {kind: payload for kind, payload in chunks if kind != b'IDAT'}
    if (data[b'IHDR'] != struct.pack('>IIBBBBB', 173, 231, 8, 2, 0, 0, 0)
            or data[b'cICP'] != bytes((12, 16, 0, 1))
            or data[b'cHRM'] != struct.pack('>8I', *apple_hdr_png.CHROMATICITIES)
            or data[b'pHYs'] != struct.pack('>IIB', 1, 1, 0)):
        raise ValueError('Expected actual static opaque RGB8 P3 PQ containment and square pixels')
    facts, pixels = hdr_png8.inspect_and_decode(path)
    if ((facts['width'], facts['height'], facts['depth'], facts['color_type'], facts['orientation']) != (173, 231, 8, 2, 1)
            or facts['libpng_source_depth'] != 8 or not np.all(pixels[..., 3] == 1)):
        raise ValueError('Independent native PNG8 dimensions, opacity or depth disagree')
    tags = facts['exiftool']
    if ([tags.get(key) for key in ('WhitePointX', 'WhitePointY', 'RedX', 'RedY', 'GreenX', 'GreenY', 'BlueX', 'BlueY')]
            != [value/100000 for value in apple_hdr_png.CHROMATICITIES]
            or [tags.get(key) for key in ('PixelsPerUnitX', 'PixelsPerUnitY', 'PixelUnits')] != [1, 1, 0]
            or gainmap.private_metadata_tags(tags)):
        raise ValueError('Independent ExifTool disagrees with PNG8 color, aspect or privacy')
    raw = avif.native(['ffmpeg', '-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    expected = np.rint(pixels[..., :3]*255).astype('u1').tobytes()
    if raw != expected:
        raise ValueError('Independent native libpng and FFmpeg RGB8 samples disagree')
    facts.update({'physical_pixel_dimensions': [1, 1, 0], 'square_pixels': True, 'frames': 1, 'opaque': True,
        'native_decoders_agree': True, 'decoded_rgb8_sha256': hashlib.sha256(expected).hexdigest(),
        'chunk_order': [kind.decode() for kind in kinds]})
    return facts, pixels


def encode(source, output, *, expected_source_sha256):
    source, output = Path(source), Path(output)
    if avif.digest(source) != expected_source_sha256:
        raise ValueError('Native PNG16 intent integrity changed before quantization')
    facts, _ = apple_hdr_png.inspect_output(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = output.parent/'native-rgb8.raw'
    filters = 'format=gbrp16le,zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', filters,
                 '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
    if raw.stat().st_size != 173*231*3:
        raise ValueError('Native RGB8 quantization raster dimensions changed')
    signaling = 'setparams=color_primaries=12:color_trc=16:colorspace=0:range=full,setsar=1'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '173x231',
        '-i', raw, '-vf', signaling, '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])
    bound = {str(source): expected_source_sha256, str(raw): avif.digest(raw), str(output): avif.digest(output)}
    if any(avif.digest(path) != sha for path, sha in bound.items()):
        raise ValueError('Native intent or PNG8 encoding artifact integrity changed')
    return {'input': str(source), 'input_sha256': expected_source_sha256, 'input_facts': facts,
            'rgb8': {'path': str(raw), 'sha256': bound[str(raw)], 'format': 'rgb24'},
            'quantization_filter': filters, 'signaling_filter': signaling, 'bound_files': bound}


def run(directory, *, source=apple_source_model.SOURCE, selectors=None):
    if ((selectors is not None and selectors != SELECTORS)
            or avif.digest(source) != apple_source_model.SOURCE_SHA256):
        raise ValueError('Only the locked source and exact explicit PNG8 containment selectors are admitted; original only otherwise')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    first = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).parent/name) for name in DEPENDENCIES}
    baseline = apple_hdr_png_precision.run(directory/'baseline', source=source)
    old = baseline['cases'][0]
    case = copy.deepcopy(old)
    case.update({'case_id': 'gainmap-apple-old:hdr:png:preserve:8:contain:documented-full-native:precision-opaque-nearest8',
        'candidate': 'documented-full-native-pq8-opaque-nearest', 'proof_module': 'apple_hdr_png8', 'selectors': dict(SELECTORS),
        'status': 'tested and failed', 'blockers': [], 'measurements': {}, 'artifacts': {},
        'qualification_scope': 'One explicit P3 PNG8 containment with native nearest-code quantization of inspected PQ16 intent. '
            'Documented full effect only; other selectors and physical consumers require separate evidence.'})
    case['checks'] = {key: False for key in ('native_encoder', 'independent_source_decoder', 'native_source_precision',
        'native_geometry', 'native_preparation', 'independent_decoder', 'structure', 'privacy', 'native_storage',
        'nearest_code', 'appearance', 'integrity')}
    for key in ('facts', 'native_writer', 'bound_files', 'precision_diagnostic', 'storage_checks', 'baseline_output'):
        case.pop(key, None)
    report = {'baseline': baseline, 'cases': [case]}
    try:
        if old['status'] != 'qualified' or not all(old['checks'].values()):
            raise ValueError('Native source, geometry and precise PNG16 preparation did not qualify')
        protected = dict(old['bound_files'])
        if any(avif.digest(path) != sha for path, sha in protected.items()):
            raise ValueError('Source, reference or native PNG16 intent integrity changed before encoding')
        output = directory/'output.png'
        writer = encode(old['artifacts']['output'], output, expected_source_sha256=old['artifacts']['sha256'])
        case['checks']['native_encoder'] = True
        protected.update(writer['bound_files'])
        case['artifacts'] = {**old['artifacts'], 'output': str(output), 'sha256': protected[str(output)]}
        if any(avif.digest(path) != sha for path, sha in protected.items()):
            raise ValueError('Source, native intent or PNG8 integrity changed before output decoding')
        facts, pixels = inspect_output(output)
        _, intent_pixels = apple_hdr_png.inspect_output(old['artifacts']['output'])
        codes = np.rint(pixels[..., :3]*255).astype('u1')
        nearest = np.floor(intent_pixels[..., :3]*255+.5).astype('u1')
        mismatches = int(np.count_nonzero(codes != nearest))
        stored_equal = Path(writer['rgb8']['path']).read_bytes() == codes.tobytes()
        reference = np.load(old['reference_hdr']['path'])
        measurements = {**old['measurements'], 'native_intent': old['measurements']['hdr'],
            'hdr': compare_appearance(reference, avif.decode_transfer(pixels[..., :3], 'pq', 'p3'),
                reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')}
        comparison = _regional_changes(old['measurements']['hdr'], measurements['hdr'])
        comparison['selector_scope'] = 'Different requested depth: precise PNG16 versus explicit PNG8, not a same-selector quality comparison'
        case.update({'facts': facts, 'native_writer': writer, 'measurements': measurements,
            'storage_measurement': {'nearest_code_mismatches': mismatches, 'native_rgb8_equals_independent_png': stored_equal,
                'rule': 'Nearest full-range RGB8 code to the actual independently decoded native PQ16 intent'},
            'regional_change_from_depth16': comparison,
            'baseline_output': {'case_id': old['case_id'], 'sha256': old['artifacts']['sha256'],
                'path': old['artifacts']['output'], 'selectors': old['selectors']}})
        case['checks'].update({'independent_source_decoder': old['checks']['independent_source_decoder'],
            'native_source_precision': old['checks']['native_source_precision'], 'native_geometry': old['checks']['native_geometry'],
            'native_preparation': True, 'independent_decoder': True, 'structure': True, 'privacy': True,
            'native_storage': stored_equal, 'nearest_code': mismatches == 0,
            'appearance': all(measurement['passed'] for measurement in measurements.values())})
        if (any(avif.digest(path) != sha for path, sha in protected.items())
                or any(avif.digest(Path(__file__).parent/name) != sha for name, sha in hashes.items())):
            raise ValueError('Source, reference, native intent or output integrity changed during decoding')
        case['bound_files'] = protected
        case['checks']['integrity'] = True
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    report.update({'source_hashes': hashes, 'commands': avif.COMMANDS[first:]})
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
