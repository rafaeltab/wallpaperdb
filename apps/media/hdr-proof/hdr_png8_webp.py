"""Explicit SDR WebP containment candidates from normalized PNG8 sources.

Before measurement, retain the unchanged 1000-nit tone/gamut reference, sdr-8
regional appearance gates and fractional-alpha limit 2/255. The representation
uses native gamma-2.2 coding with an independently parsed ICC matrix profile;
it preserves the same SDR grade. Source quantization stays separate. Native
FFmpeg WebP decoding must agree exactly with Pillow/libwebp and the coded PNG8
encoder input, but those checks never replace the independent appearance gate.

The restricted static VP8L container reader follows these primary references:
https://developers.google.com/speed/webp/docs/riff_container
https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification
"""
import json
from pathlib import Path
import struct

import numpy as np

import avif
import gamma_icc
import hdr_png
import hdr_png8
import hdr_png8_proof
from appearance import RGB_TO_XYZ, compare_appearance, sdr_signal_to_nits
from matrix import request_decision
from sdr_reference import reference_srgb


SOURCE_LOCK = hdr_png8_proof.SOURCE_LOCK
WEBP_POLICY = {
    'declared_before_native_measurements': True,
    'representation': 'Static lossless VP8L RGB8/RGBA8 with sRGB primaries and gamma-2.2 ICC',
    'output_profile': 'sdr-8', 'alpha_error_limit': 2 / 255,
    'reference_grade': 'Unchanged independent 1000-nit HDR-to-SDR tone/gamut reference at nominal SDR 100 nits',
    'rationale': ('The gamma-2.2 representation retains the existing SDR grade; actual embedded ICC '
                  'semantics determine decoded appearance. Source quantization is measured separately. '
                  'Lossless storage and decoder agreement are additional exact-code checks.'),
    'geometry': 'Contain 58 x 38 producing 57 x 38 with independent premultiplied bilinear geometry',
    'scope': 'Only these explicit SDR WebP containment tuples; physical consumers remain pending',
}
NEAREST_POLICY = {
    'declared_before_native_measurements': True,
    'method': 'Native full-range zscale, no dither, nearest 16-to-8-bit normalized RGBA codes',
    'maximum_sample_error_limit': .5 / 255,
    'rationale': ('Every emitted RGB and alpha code must equal independent nearest integer rounding '
                  'of the decoded gamma16 input. This stage gate does not replace or relax the '
                  'unchanged sdr-8 appearance, 1000-nit SDR grade or 2/255 geometry-alpha gates.'),
}


def _container(data):
    if (len(data) < 12 or data[:4] != b'RIFF' or data[8:12] != b'WEBP'
            or struct.unpack_from('<I', data, 4)[0] + 8 != len(data)):
        raise ValueError('Expected a complete WebP RIFF file without trailing bytes')
    chunks, position = {}, 12
    while position < len(data):
        if position + 8 > len(data):
            raise ValueError('Truncated WebP chunk header')
        kind, size = struct.unpack_from('<4sI', data, position)
        end = position + 8 + size
        if kind in chunks or kind not in (b'VP8X', b'ICCP', b'VP8L') or end + size % 2 > len(data):
            raise ValueError('Duplicate, truncated or unsupported static WebP chunk')
        if size % 2 and data[end] != 0:
            raise ValueError('WebP RIFF padding must be zero')
        chunks[kind] = data[position+8:end]
        position = end + size % 2
    if tuple(chunks) != (b'VP8X', b'ICCP', b'VP8L'):
        raise ValueError('Expected ordered VP8X, one ICC profile and one static VP8L frame')
    extended, payload = chunks[b'VP8X'], chunks[b'VP8L']
    if (len(extended) != 10 or extended[0] not in (0x20, 0x30) or extended[1:4] != bytes(3)
            or len(payload) < 5 or payload[0] != 0x2f):
        raise ValueError('WebP animation, metadata, reserved fields or lossless signature disagree')
    bits = struct.unpack_from('<I', payload, 1)[0]
    width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
    alpha_flag, alpha_hint = bool(extended[0] & 0x10), bool((bits >> 28) & 1)
    if (bits >> 29 or alpha_flag != alpha_hint
            or (int.from_bytes(extended[4:7], 'little') + 1,
                int.from_bytes(extended[7:10], 'little') + 1) != (width, height)):
        raise ValueError('WebP canvas, alpha declarations or VP8L version disagree')
    return {'width': width, 'height': height, 'depth': 8, 'alpha_flag': alpha_flag,
            'alpha_hint': alpha_hint, 'frames': 1, 'animation': False,
            'coding': 'VP8L version 0, RGB8/RGBA8',
            'chunk_order': [kind.decode() for kind in chunks]}, chunks[b'ICCP']


def inspect_and_decode(path):
    container, embedded_icc = _container(Path(path).read_bytes())
    facts, frames, profile = gamma_icc.inspect_and_decode(path)
    if (facts['format'] != 'WEBP' or profile != embedded_icc or not facts['icc']['gamma22_srgb_primaries']
            or len(frames) != 1 or (facts['width'], facts['height']) != (container['width'], container['height'])
            or (facts['exiftool'].get('ImageWidth'), facts['exiftool'].get('ImageHeight'))
                != (container['width'], container['height'])):
        raise ValueError('Independent WebP metadata, decoded dimensions or actual ICC semantics disagree')
    raw = avif.native(['ffmpeg', '-v', 'error', '-err_detect', 'explode', '-c:v', 'webp', '-i', path,
                       '-frames:v', '1', '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])
    if len(raw) != container['width'] * container['height'] * 4:
        raise ValueError('Independent native FFmpeg WebP decoder returned unexpected dimensions/channels')
    pixels = np.frombuffer(raw, dtype=np.uint8).reshape(container['height'], container['width'], 4).astype(float)/255
    mismatch = int(np.count_nonzero(pixels != frames[0]))
    if mismatch:
        raise ValueError('Independent FFmpeg and Pillow/libwebp decoded RGBA samples disagree')
    facts.update({'depth': container['depth'], 'container': container,
                  'decoder': 'Independent FFmpeg native WebP decoder; exact Pillow/libwebp cross-check',
                  'independent_decoder_agreement': {'passed': True, 'mismatched_rgba_samples': mismatch},
                  'alpha_flag_matches_pixels': container['alpha_flag'] == bool(np.any(pixels[..., 3] < 1)),
                  'timing_scope': 'Static VP8L frame; ANIM and ANMF chunks are absent'})
    return facts, pixels, profile


def inspect_quantization(gamma16_path, gamma8_path):
    """Prove the actual native stage against integer code rounding, including alpha."""
    decoded, depths = [], []
    for path in (gamma16_path, gamma8_path):
        raw = avif.native(['hdr-proof-png-decode', path])
        width, height, depth = struct.unpack('<III', raw[:12])
        if len(raw) != 12 + width * height * 8:
            raise ValueError('Independent libpng quantization-stage dimensions disagree')
        decoded.append(np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4).astype(float)/65535)
        depths.append(depth)
    before, after = decoded
    if before.shape != after.shape or depths != [16, 8]:
        raise ValueError('Expected matched actual sixteen-bit and eight-bit quantization stages')
    expected = np.rint(before * 255) / 255
    mismatch = int(np.count_nonzero(after != expected))
    rgb_error = float(np.max(np.abs(after[..., :3] - before[..., :3])))
    alpha_error = float(np.max(np.abs(after[..., 3] - before[..., 3])))
    return {**NEAREST_POLICY,
        'passed': mismatch == 0 and max(rgb_error, alpha_error) <= NEAREST_POLICY['maximum_sample_error_limit'],
        'mismatched_nearest_codes': mismatch,
        'maximum_rgb_error': rgb_error, 'maximum_alpha_error': alpha_error,
        'source_depth': depths[0], 'coded_depth': depths[1],
        'source': str(gamma16_path), 'source_sha256': avif.digest(gamma16_path),
        'coded': str(gamma8_path), 'coded_sha256': avif.digest(gamma8_path)}


def run(output_directory, *, specs=None, source_lock=SOURCE_LOCK, nearest_quantization=False):
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    expected_hashes = json.loads(Path(source_lock).read_text())['sha256']
    sources, evidence = [], []
    for spec in (hdr_png8.fixture_specs() if specs is None else specs):
        source, fixture = hdr_png8.generate_fixture(spec, root/spec['id'])
        if not fixture['source_valid'] or fixture['sha256'] != expected_hashes.get(spec['id']):
            raise ValueError(f'PNG8 WebP source hash/qualification mismatch for {spec["id"]}; conversion withheld')
        fixture['source_lock'] = {'passed': True, 'sha256': fixture['sha256'], 'path': str(source_lock),
                                  'lock_sha256': avif.digest(source_lock)}
        sources.append(fixture)
    for fixture in sources:
        source = Path(fixture['path'])
        folder = source.parent
        source_facts, pixels = hdr_png8.inspect_and_decode(source)
        transfer, gamut = source_facts['transfer_name'], source_facts['gamut']
        reference_source = pixels.copy()
        reference_source[..., :3] = avif.decode_transfer(pixels[..., :3], transfer, gamut)
        reference = avif.geometry_reference(reference_source, 'contain')
        selectors = {'format': 'webp', 'range': 'sdr', 'gamut': 'srgb', 'depth': '8',
                     'motion': 'preserve', 'transparency': 'preserve', 'w': 58, 'h': 38, 'fit': 'contain'}
        for quantization in (('native', 'nearest') if nearest_quantization else ('native',)):
            case_id = (f'{fixture["id"]}:sdr:webp:srgb:preserve:contain:normalized-source16:gamma22-icc'
                       + (':nearest8' if quantization == 'nearest' else ''))
            directory = folder/case_id.replace(':', '-')
            directory.mkdir(exist_ok=True)
            item = {'case_id': case_id, 'fixture_id': fixture['id'], 'cell_id': 'hdr-png:sdr:webp',
                'selectors': selectors, 'geometry': 'contain', 'status': 'tested and failed',
                'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                'blockers': [], 'measurements': {}, 'artifacts': {}, 'source_facts': source_facts,
                'consumer_status': 'pending manual review',
                'threshold_scope': {**WEBP_POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}}
            try:
                normalized = folder/'normalized-source.png'
                normalization = hdr_png8_proof.normalize_source(source, normalized)
                item['source_normalization'] = normalization
                if not normalization['passed']:
                    raise ValueError('Exact native source normalization failed; SDR WebP conversion withheld')
                known = {'format': 'png', 'range': 'hdr', 'gamut': gamut, 'depth': source_facts['depth'],
                         'width': source_facts['width'], 'height': source_facts['height'], 'motion': 'static',
                         'alpha': 'fractional' if np.any((pixels[..., 3] > 0) & (pixels[..., 3] < 1)) else 'none',
                         'alpha_capable': True, 'orientation': source_facts['orientation']}
                item['request_decision'] = request_decision(known, selectors)
                if item['request_decision']['action'] != 'unqualified':
                    raise ValueError('The explicit SDR WebP tuple is outside this native experiment')
                tone = avif.sdr_tone_control(normalized, folder/'sdr-control.png', reference_source,
                    avif.make_scene(source_facts['alpha_channel']), transfer, gamut, peak_nits=1000)
                converted, target = directory/'converted.png', directory/'output.webp'
                avif.convert_frame(normalized, converted, transfer, gamut, 'contain', sdr=True, peak_nits=1000)
                gamma_icc.encode([converted], target, 'webp', quantization=quantization)
                item['checks']['native_encoder'] = True
                facts, actual, profile = inspect_and_decode(target)
                coded = avif.read_png(directory/'output-gamma22-8-0.png')
                mismatches = int(np.count_nonzero(actual != coded)) if actual.shape == coded.shape else -1
                facts['lossless_storage'] = {'passed': mismatches == 0, 'mismatched_rgba_samples': mismatches,
                    'reference': 'Independent libpng decode of actual gamma-2.2 RGB8/RGBA8 encoder input'}
                alpha_error = float(np.max(np.abs(actual[..., 3] - reference[..., 3])))
                facts['alpha_measurement'] = {'maximum_absolute_error': alpha_error,
                    'absolute_error_limit': WEBP_POLICY['alpha_error_limit'],
                    'comparison': 'Independent premultiplied matched-geometry source alpha'}
                detail = {'dimensions': actual.shape == reference.shape, 'depth': facts['depth'] == 8,
                    'color_signaling': facts['icc']['gamma22_srgb_primaries'],
                    'gamut': facts['icc']['gamut'] == 'srgb', 'frames': facts['container']['frames'] == 1,
                    'static_container': not facts['container']['animation'],
                    'orientation_baked': facts['exiftool'].get('Orientation', 1) == 1,
                    'alpha': alpha_error <= WEBP_POLICY['alpha_error_limit'],
                    'alpha_signaling': facts['alpha_flag_matches_pixels'],
                    'exact_lossless_storage': facts['lossless_storage']['passed']}
                if quantization == 'nearest':
                    item['quantization_measurement'] = inspect_quantization(
                        directory/'output-gamma22-0.png', directory/'output-gamma22-8-0.png')
                    detail['nearest_code_rounding'] = item['quantization_measurement']['passed']
                privacy = hdr_png.inspect_privacy(target, facts, 'webp')
                expected = sdr_signal_to_nits(reference_srgb(reference[..., :3], gamut, peak_nits=1000))
                actual_linear = gamma_icc.decode_signal_to_nits(actual[..., :3], profile)
                measured = compare_appearance(expected, actual_linear, reference_gamut='srgb', actual_gamut='rec2020',
                    fixture_class='sdr-8', alpha=reference[..., 3],
                    region_reference_luminance_nits=reference[..., :3] @ RGB_TO_XYZ[gamut][1])
                measured['tone_control_passed'] = tone['passed']
                measured['passed'] &= tone['passed']
                item['measurements'] = {'frames': [measured], 'tone_controls': [tone]}
                item['checks'].update({'independent_decoder': True, 'structure': all(detail.values()),
                                      'appearance': bool(measured['passed']), 'privacy': privacy['passed']})
                item['facts'], item['structural_checks'], item['privacy_measurement'] = facts, detail, privacy
                item['representation'] = {'primaries': 'srgb', 'transfer': 'ICC gamma 2.2', 'depth': 8,
                                          'grade': WEBP_POLICY['reference_grade']}
                item['artifacts'] = {'output': str(target), 'sha256': avif.digest(target),
                                     'source': str(source), 'source_sha256': avif.digest(source)}
                item['blockers'] += [f'Failed {key} check' for key, passed in item['checks'].items() if not passed]
                if all(item['checks'].values()) and not item['blockers']:
                    item['status'] = 'qualified'
            except Exception as error:
                item['blockers'].append(str(error))
            evidence.append(item)
        print(f'PNG8 {fixture["id"]}: native SDR WebP containment measured', flush=True)
    return {'evidence': evidence, 'fixtures': [], 'source_fixtures': sources, 'controls': [],
            'commands': avif.COMMANDS[start:], 'scope': WEBP_POLICY}
