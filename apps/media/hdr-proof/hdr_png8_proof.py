"""Containment-only conversion proof for the separately locked PNG8 fixtures.

Output gates were selected before native measurements. HDR PNG8 and AVIF8
reuse avif-8 because both quantize the same PQ/HLG signal to eight bits. The
reference is independently decoded source intent after premultiplied geometry;
authored-source quantization is measured separately and is never added to the
conversion budget. Explicit SDR outputs use the unchanged sdr-8 appearance and
1000-nit tone/gamut policy. Alpha limits remain two output codes: 2/255 for
eight-bit outputs and 2/65535 for SDR PNG16. No production admission changes.

The optional normalized-source candidate adds a native exact eight-to-sixteen
bit boundary before conversion. This changes storage precision only: independent
libpng must recover every normalized RGBA sample exactly. Original direct-input
candidates and their measured failures remain separate, unchanged evidence.
"""
import json
from pathlib import Path
import struct
import zlib

import numpy as np

import avif
import gamma_sdr
import hdr_png
import hdr_png8
from appearance import RGB_TO_XYZ, compare_appearance, sdr_signal_to_nits
from matrix import exact_original, request_decision
from sdr_reference import reference_srgb


SOURCE_LOCK = Path(__file__).with_name('fixtures')/'png8-source-sha256.json'
OUTPUT_POLICY = {
    'declared_before_native_measurements': True,
    'geometry': 'contain58x38 producing57x38; independent premultiplied Pillow bilinear reference',
    'hdr_profile': 'avif-8', 'sdr_profile': 'sdr-8',
    'rationale': ('HDR outputs both have eight coded bits; their error is measured against the '
                  'independently decoded source after matched geometry. Source quantization '
                  'is separate. SDR retains the previously declared tone/gamut reference and ceiling.'),
    'alpha_limits': {'8': 2 / 255, '16': 2 / 65535},
    'scope': 'These exact fixture/containment/output tuples only; physical consumers remain pending',
}

NORMALIZATION_POLICY = {
    'declared_before_native_measurements': True,
    'method': 'Native planar RGB8/RGBA8 to zimg full-range, no-dither RGB16/RGBA16',
    'requirement': 'Every independently decoded normalized RGB and alpha sample must equal its source sample exactly',
    'maximum_sample_error': 0,
    'scope': 'Exact storage expansion only; no transfer, gamut, geometry or alpha change',
}


def source_rejection_controls(source, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    original_chunks = hdr_png._png_chunks(Path(source).read_bytes())
    variants = {
        'missing-cicp': [(kind, payload) for kind, payload in original_chunks if kind != b'cICP'],
        'unknown-transfer': [(kind, bytes((payload[0], 2, 0, 1)) if kind == b'cICP' else payload)
                             for kind, payload in original_chunks],
    }
    controls = []
    for variant, chunks in variants.items():
        data = bytearray(b'\x89PNG\r\n\x1a\n')
        for kind, payload in chunks:
            data.extend(struct.pack('>I', len(payload)) + kind + payload
                        + struct.pack('>I', zlib.crc32(kind + payload)))
        path, output = directory/f'{variant}.png', directory/f'{variant}-original.png'
        path.write_bytes(data)
        start, rejection = len(avif.COMMANDS), None
        try:
            hdr_png8.inspect_and_decode(path)
        except ValueError as error:
            rejection = str(error)
        facts = {'format': 'png', 'range': None}
        original = request_decision(facts, {})
        transformed = request_decision(facts, {'format': 'avif', 'range': 'hdr', 'w': 58})
        output.write_bytes(exact_original(path.read_bytes(), original))
        checks = {'source_rejected': rejection is not None,
                  'exact_original_bytes': path.read_bytes() == output.read_bytes(),
                  'transformations_withheld': transformed['action'] == 'metadata-pending',
                  'no_native_calls': len(avif.COMMANDS) == start,
                  'coded_pixels_unchanged': [payload for kind, payload in chunks if kind == b'IDAT']
                    == [payload for kind, payload in original_chunks if kind == b'IDAT']}
        name = f'png8:source-signaling:{variant}'
        controls.append({'case_id': name, 'name': name, 'kind': 'unknown-source', 'variant': variant,
            'passed': all(checks.values()), 'status': 'passed' if all(checks.values()) else 'failed',
            'checks': checks, 'codec_qualification': False, 'source': str(path),
            'source_sha256': avif.digest(path), 'original_sha256': avif.digest(output),
            'parent_source_sha256': avif.digest(source), 'source_rejection': rejection,
            'original_decision': original, 'transformed_decision': transformed,
            'provenance': 'Metadata-only mutation of a locked native PNG8 fixture; IDAT bytes unchanged'})
    return controls


def _original_control(source, output, known):
    selectors = {'format': 'png', 'range': 'hdr', 'gamut': known['gamut'], 'depth': '8',
                 'motion': 'static', 'transparency': 'preserve', 'w': known['width'], 'h': known['height']}
    start = len(avif.COMMANDS)
    decision = request_decision(known, selectors)
    original = source.read_bytes()
    output.write_bytes(exact_original(original, decision))
    checks = {'exact_bytes': output.read_bytes() == original,
              'no_native_calls': len(avif.COMMANDS) == start,
              'retained_source_metadata': b'HDR-PROOF-PRIVATE' in output.read_bytes()}
    name = source.stem + ':explicit-matching-hdr-png-no-op'
    return {'case_id': name, 'name': name, 'kind': 'matching-original',
            'passed': all(checks.values()), 'status': 'passed' if all(checks.values()) else 'failed',
            'checks': checks, 'codec_qualification': False, 'selectors': selectors, 'decision': decision,
            'source_sha256': avif.digest(source), 'output_sha256': avif.digest(output),
            'scope': 'Exact-original selector control; no conversion qualification',
            'metadata_policy': 'Retain source metadata for the exact-byte original required by #250'}


def _encode_hdr_png8(source, target, facts):
    # zimg performs native nearest-code depth conversion without dithering.
    # Matching alpha-mode labels suppress implicit nonlinear association.
    packed = 'rgba' if facts['alpha_channel'] else 'rgb24'
    filters = ('format=gbrap16le,setparams=alpha_mode=premultiplied,'
               'zscale=rangein=full:range=full:dither=none,format=gbrap,'
               'setparams=alpha_mode=straight,sidedata=mode=delete,'
               f'setparams=color_primaries={facts["primaries"]}:color_trc={facts["transfer"]}:'
               'colorspace=gbr:range=full')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', filters,
                 '-pix_fmt', packed, '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', target])


def _inspect_sdr_png16(path):
    """Require unambiguous SDR color, native source depth and opaque/fractional pixels."""
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    headers = [payload for kind, payload in chunks if kind == b'IHDR']
    cicp = [payload for kind, payload in chunks if kind == b'cICP']
    srgb = [payload for kind, payload in chunks if kind == b'sRGB']
    if (len(headers) != 1 or len(headers[0]) != 13 or len(cicp) > 1 or len(srgb) > 1
            or any(kind in (b'iCCP', b'tRNS', b'acTL', b'fcTL', b'fdAT') for kind, _ in chunks)
            or not (cicp or srgb) or (cicp and cicp != [bytes((1, 13, 0, 1))])
            or (srgb and (len(srgb[0]) != 1 or srgb[0][0] > 3))):
        raise ValueError('SDR PNG output has missing, ambiguous or unsupported color/frame signaling')
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', headers[0])
    if depth != 16 or color_type not in (2, 6) or (compression, filtering, interlace) != (0, 0, 0):
        raise ValueError('SDR PNG output is outside the declared native 16-bit RGB/RGBA subset')
    exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
    if (exif.get('FileType'), exif.get('ImageWidth'), exif.get('ImageHeight'),
            exif.get('BitDepth'), exif.get('ColorType'), exif.get('Orientation', 1)) != (
            'PNG', width, height, depth, color_type, 1):
        raise ValueError('Independent ExifTool disagrees with SDR PNG structure')
    if (cicp and any(exif.get(key) != value for key, value in zip(
            ('ColorPrimaries', 'TransferCharacteristics', 'MatrixCoefficients', 'VideoFullRangeFlag'), (1, 13, 0, 1)))):
        raise ValueError('Independent ExifTool disagrees with SDR PNG CICP')
    if srgb and exif.get('SRGBRendering') != srgb[0][0]:
        raise ValueError('Independent ExifTool disagrees with SDR PNG sRGB chunk')
    raw = avif.native(['hdr-proof-png-decode', path])
    if len(raw) != 12 + width * height * 8 or struct.unpack('<III', raw[:12]) != (width, height, depth):
        raise ValueError('Independent native libpng SDR precision/dimensions disagree')
    pixels = np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4).astype(float)/65535
    facts = {'width': width, 'height': height, 'depth': depth, 'color_type': color_type,
             'primaries': 1, 'transfer': 13, 'matrix': 0, 'full_range': True, 'orientation': 1,
             'alpha_channel': color_type == 6, 'libpng_source_depth': depth,
             'decoder': 'independent native libpng; unchanged coded RGB and alpha',
             'exiftool': {key: value for key, value in exif.items() if key not in (
                 'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')}}
    return facts, pixels


def normalize_source(source, output):
    """Validate an exact native precision boundary before attempting conversion."""
    facts, pixels = hdr_png8.inspect_and_decode(source)
    filters = ('format=gbrap,zscale=rangein=full:range=full:dither=none,format=gbrap16le,'
               'sidedata=mode=delete,'
               f'setparams=color_primaries={facts["primaries"]}:color_trc={facts["transfer"]}:'
               'colorspace=gbr:range=full')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', filters,
                 '-pix_fmt', 'rgba64be', '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])
    normalized_facts = hdr_png.inspect_source(output)
    headers = [payload for kind, payload in hdr_png._png_chunks(Path(output).read_bytes()) if kind == b'IHDR']
    expected_header = (facts['width'], facts['height'], 16, 6, 0, 0, 0)
    if len(headers) != 1 or len(headers[0]) != 13 or struct.unpack('>IIBBBBB', headers[0]) != expected_header:
        raise ValueError('Native normalization changed the PNG dimensions, channel structure or precision')
    raw = avif.native(['hdr-proof-png-decode', output])
    if (len(raw) != 12 + facts['width'] * facts['height'] * 8
            or struct.unpack('<III', raw[:12]) != (facts['width'], facts['height'], 16)):
        raise ValueError('Independent native libpng did not establish normalized-source precision')
    normalized = np.frombuffer(raw[12:], dtype='<u2').reshape(pixels.shape).astype(float)/65535
    mismatches = int(np.count_nonzero(normalized != pixels))
    checks = {'exact_rgba_samples': mismatches == 0,
              'color_signaling': all(normalized_facts[key] == facts[key]
                                    for key in ('primaries', 'transfer', 'matrix', 'full_range', 'orientation')),
              'dimensions': (normalized_facts['width'], normalized_facts['height'])
                            == (facts['width'], facts['height']),
              'source_depth': facts['depth'] == 8, 'normalized_depth': normalized_facts['depth'] == 16}
    return {'passed': all(checks.values()), 'checks': checks, 'policy': NORMALIZATION_POLICY,
            'source': str(source), 'source_sha256': avif.digest(source),
            'output': str(output), 'sha256': avif.digest(output),
            'source_depth': facts['depth'], 'normalized_depth': normalized_facts['depth'],
            'source_facts': facts, 'normalized_facts': normalized_facts,
            'mismatched_samples': mismatches,
            'maximum_rgb_error': float(np.max(np.abs(normalized[..., :3] - pixels[..., :3]))),
            'maximum_alpha_error': float(np.max(np.abs(normalized[..., 3] - pixels[..., 3])))}


def run(output_directory, *, specs=None, source_lock=SOURCE_LOCK, normalize_sources=False):
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    expected_hashes = json.loads(Path(source_lock).read_text())['sha256']
    prepared, fixtures, evidence, controls = [], [], [], []
    # Validate the entire requested source set before any candidate converter.
    for spec in (hdr_png8.fixture_specs() if specs is None else specs):
        source, fixture = hdr_png8.generate_fixture(spec, output_directory/spec['id'])
        expected = expected_hashes.get(spec['id'])
        if expected is None or fixture['sha256'] != expected:
            raise ValueError(f'PNG8 source hash mismatch for {spec["id"]}; conversion withheld')
        if not fixture['source_valid']:
            raise ValueError(f'PNG8 source qualification failed for {spec["id"]}; conversion withheld')
        fixture['source_lock'] = {'passed': True, 'sha256': expected, 'path': str(source_lock),
                                  'lock_sha256': avif.digest(source_lock)}
        facts, decoded = hdr_png8.inspect_and_decode(source)
        reference_source = decoded.copy()
        reference_source[..., :3] = avif.decode_transfer(decoded[..., :3], facts['transfer_name'], facts['gamut'])
        fixtures.append(fixture)
        prepared.append((spec, source, facts, reference_source))
    if prepared:
        controls.extend(source_rejection_controls(prepared[0][1], output_directory/'source-signaling-controls'))
    for spec, source, source_facts, reference_source in prepared:
        folder = source.parent
        transfer, gamut = source_facts['transfer_name'], source_facts['gamut']
        alpha = reference_source[..., 3]
        alpha_kind = 'fractional' if np.any((alpha > 0) & (alpha < 1)) else 'binary' if np.any(alpha == 0) else 'none'
        known = {'format': 'png', 'range': 'hdr', 'gamut': gamut, 'depth': source_facts['depth'],
                 'width': source_facts['width'], 'height': source_facts['height'], 'motion': 'static',
                 'alpha': alpha_kind, 'alpha_capable': True, 'orientation': source_facts['orientation']}
        controls.append(_original_control(source, folder/'exact-original.png', known))
        reference = avif.geometry_reference(reference_source, 'contain')
        try:
            tone = avif.sdr_tone_control(source, folder/'sdr-control.png', reference_source,
                avif.make_scene(source_facts['alpha_channel']), transfer, gamut, peak_nits=1000)
        except Exception as error:
            tone = {'passed': False, 'error': str(error)}
        normalized, normalization, normalized_tone = folder/'normalized-source.png', None, None
        if normalize_sources:
            try:
                normalization = normalize_source(source, normalized)
                if not normalization['passed']:
                    raise ValueError('Native normalized-source samples or signaling changed; conversion withheld')
                normalized_tone = avif.sdr_tone_control(normalized, folder/'normalized-source-sdr-control.png',
                    reference_source, avif.make_scene(source_facts['alpha_channel']), transfer, gamut, peak_nits=1000)
            except Exception as error:
                if normalization is None:
                    normalization = {'passed': False, 'error': str(error), 'policy': NORMALIZATION_POLICY}
                normalized_tone = {'passed': False, 'error': str(error)}
        operations = [(dynamic_range, extension, depth, False) for dynamic_range, extension, depth in (
            ('hdr', 'png', 8), ('hdr', 'avif', 8), ('sdr', 'png', 16), ('sdr', 'avif', 8))]
        if normalize_sources:
            operations += [(dynamic_range, extension, depth, True) for dynamic_range, extension, depth, _ in operations]
        for dynamic_range, extension, depth, use_normalized in operations:
            sdr = dynamic_range == 'sdr'
            out_gamut, out_transfer = ('srgb', 'gamma22' if extension == 'avif' else 'srgb') if sdr else (gamut, transfer)
            selectors = {'format': extension, 'range': dynamic_range, 'gamut': 'srgb' if sdr else 'preserve',
                'depth': str(depth), 'motion': 'preserve', 'transparency': 'preserve', 'w': 58, 'h': 38, 'fit': 'contain'}
            case_id = f'{spec["id"]}:{dynamic_range}:{extension}:{selectors["gamut"]}:preserve:contain'
            if use_normalized:
                case_id += ':normalized-source16'
            directory = folder/case_id.replace(':', '-')
            directory.mkdir(exist_ok=True)
            item = {'case_id': case_id, 'fixture_id': spec['id'], 'cell_id': f'hdr-png:{dynamic_range}:{extension}',
                'selectors': selectors, 'geometry': 'contain', 'status': 'tested and failed',
                'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                'blockers': [], 'measurements': {}, 'artifacts': {}, 'source_facts': source_facts,
                'threshold_scope': {**OUTPUT_POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
                'consumer_status': 'pending manual review'}
            if use_normalized:
                item['source_normalization'] = normalization
            try:
                if use_normalized and not normalization['passed']:
                    raise ValueError('Exact normalized-source boundary failed; candidate conversion withheld')
                item['request_decision'] = request_decision(known, selectors)
                if item['request_decision']['action'] != 'unqualified':
                    raise ValueError('Requested tuple is outside this native conversion experiment')
                converted, target = directory/'converted.png', directory/f'output.{extension}'
                avif.convert_frame(normalized if use_normalized else source, converted, transfer, gamut,
                                   'contain', sdr=sdr, peak_nits=1000 if sdr else None)
                if extension == 'avif':
                    if sdr:
                        gamma_sdr.encode([converted], target, depth=depth)
                    else:
                        avif.encode_avif([converted], target, out_transfer, out_gamut, depth)
                    item['checks']['native_encoder'] = True
                    facts = avif.inspect_avif(target)
                    frames = avif.decode_avif(target, directory, 1)
                    detail = avif.structure_checks(facts, frames, spec, [reference], out_transfer, out_gamut, depth, 1)
                    linear = (gamma_sdr.decode_signal_to_nits(frames[0][..., :3]) if sdr else
                              avif.decode_transfer(frames[0][..., :3], out_transfer, out_gamut))
                else:
                    if sdr:
                        avif.encode_other([converted], target, 'png', out_transfer, out_gamut, [reference], 1, spec)
                        item['checks']['native_encoder'] = True
                        facts, frame = _inspect_sdr_png16(target)
                    else:
                        _encode_hdr_png8(converted, target, source_facts)
                        item['checks']['native_encoder'] = True
                        facts, frame = hdr_png8.inspect_and_decode(target)
                    frames = [frame]
                    detail = {'dimensions': frame.shape == reference.shape, 'depth': facts['depth'] == depth,
                        'transfer': facts['transfer'] == avif.TRANSFERS[out_transfer],
                        'gamut': facts['primaries'] == avif.PRIMARIES[out_gamut],
                        'matrix_full_range': facts['matrix'] == 0 and facts['full_range'],
                        'orientation_baked': facts['orientation'] == 1, 'frames': True,
                        'alpha': np.max(np.abs(frame[..., 3] - reference[..., 3])) <= OUTPUT_POLICY['alpha_limits'][str(depth)]}
                    linear = avif.decode_transfer(frame[..., :3], out_transfer, out_gamut)
                detail = {key: bool(value) for key, value in detail.items()}
                alpha_error = float(np.max(np.abs(frames[0][..., 3] - reference[..., 3])))
                facts['alpha_measurement'] = {'maximum_absolute_error': alpha_error,
                    'absolute_error_limit': OUTPUT_POLICY['alpha_limits'][str(depth)],
                    'comparison': 'Independent premultiplied matched-geometry source alpha'}
                privacy = hdr_png.inspect_privacy(target, facts, extension)
                expected = sdr_signal_to_nits(reference_srgb(reference[..., :3], gamut, peak_nits=1000)) if sdr else reference[..., :3]
                measured = compare_appearance(expected, linear, reference_gamut=out_gamut, actual_gamut=out_gamut,
                    fixture_class='sdr-8' if sdr else 'avif-8', alpha=reference[..., 3],
                    region_reference_luminance_nits=reference[..., :3] @ RGB_TO_XYZ[gamut][1])
                if sdr:
                    actual_tone = normalized_tone if use_normalized else tone
                    item['measurements']['tone_controls'] = [actual_tone]
                    measured['tone_control_passed'] = actual_tone['passed']
                    measured['passed'] &= actual_tone['passed']
                item['measurements']['frames'] = [measured]
                item['checks'].update({'independent_decoder': True, 'structure': all(detail.values()),
                                      'appearance': bool(measured['passed']), 'privacy': privacy['passed']})
                item['facts'], item['structural_checks'], item['privacy_measurement'] = facts, detail, privacy
                item['representation'] = {'primaries': out_gamut, 'transfer': out_transfer, 'depth': depth}
                item['artifacts'] = {'output': str(target), 'sha256': avif.digest(target),
                                     'source': str(source), 'source_sha256': avif.digest(source)}
                item['blockers'] += [f'Failed {key} check' for key, passed in item['checks'].items() if not passed]
                if all(item['checks'].values()) and not item['blockers']:
                    item['status'] = 'qualified'
            except Exception as error:
                item['blockers'].append(str(error))
            evidence.append(item)
        print(f'PNG8 {spec["id"]}: {len(operations)} native containment outputs measured', flush=True)
    return {'evidence': evidence, 'fixtures': fixtures, 'controls': controls,
            'commands': avif.COMMANDS[start:], 'scope': OUTPUT_POLICY}
