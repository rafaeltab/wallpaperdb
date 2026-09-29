"""Native APNG proof for bounded SOURCE rectangles with no disposal.

The independent reader keeps compressed frame data unchanged and delegates
sample decoding to native libpng. It rejects composition modes it cannot prove.
This experiment adds no source-admission or generation policy.
"""
from fractions import Fraction
import json
from pathlib import Path
import struct
import zlib

import numpy as np

import avif
from hdr_png import _png_chunks, inspect_privacy


def pack_chunks(chunks):
    """Wrap untouched compressed frame data for the independent PNG decoder."""
    data = bytearray(b'\x89PNG\r\n\x1a\n')
    for kind, payload in chunks:
        data.extend(struct.pack('>I', len(payload)) + kind + payload
                    + struct.pack('>I', zlib.crc32(kind + payload)))
    return bytes(data)


def encode(paths, output, transfer, gamut):
    if len(paths) != 2:
        raise ValueError('This native APNG candidate requires exactly two frames')
    output = Path(output)
    concat = output.with_suffix('.frames.txt')
    if any("'" in str(path) or '\n' in str(path) for path in paths):
        raise ValueError('Unexpected delimiter in proof frame path')
    concat.write_text(''.join(f"file '{Path(path).resolve()}'\noption framerate 1000\nduration {duration}\n"
                              for path, duration in zip(paths, ('0.3', '0.7'))))
    filters = ('sidedata=mode=delete,'
               f'setparams=color_primaries={avif.PRIMARIES[gamut]}:'
               f'color_trc={avif.TRANSFERS[transfer]}:colorspace=gbr:range=full')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
                 '-vf', filters, '-pix_fmt', 'rgba64be', '-c:v', 'apng', '-f', 'apng',
                 '-fps_mode', 'passthrough', '-plays', '3', '-final_delay', '7/10',
                 '-frames:v', '2', '-map_metadata', '-1', '-threads', '1', output])


def _inspect(path):
    rejection = 'Unsupported or ambiguous APNG proof subset'
    try:
        chunks = _png_chunks(Path(path).read_bytes())
        header = [payload for kind, payload in chunks if kind == b'IHDR']
        animations = [payload for kind, payload in chunks if kind == b'acTL']
        colors = [payload for kind, payload in chunks if kind == b'cICP']
        srgb = [payload for kind, payload in chunks if kind == b'sRGB']
        cicp_signaled = len(colors) == 1 and len(colors[0]) == 4 and not srgb
        srgb_signaled = len(srgb) == 1 and len(srgb[0]) == 1 and srgb[0][0] <= 3 and not colors
        if (len(header) != 1 or len(header[0]) != 13 or len(animations) != 1
                or len(animations[0]) != 8 or not (cicp_signaled or srgb_signaled)
                or any(kind in (b'iCCP', b'tRNS') for kind, _ in chunks)):
            raise ValueError('Required unique color, animation and image headers are missing')
        width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', header[0])
        frame_count, plays = struct.unpack('>II', animations[0])
        primaries, transfer, matrix, full_range = colors[0] if cicp_signaled else (1, 13, 0, 1)
        color_chunk = (b'cICP', colors[0]) if cicp_signaled else (b'sRGB', srgb[0])
        if (not 0 < width <= 8192 or not 0 < height <= 8192 or depth != 16
                or color_type not in (2, 6) or (compression, filtering, interlace) != (0, 0, 0)
                or not 2 <= frame_count <= 32 or primaries not in (1, 9, 12)
                or transfer not in (13, 16, 18) or matrix != 0 or full_range != 1):
            raise ValueError('Unrecognized source dimensions, precision, frame count or color signaling')
        frames, sequence, current, animation_seen, color_seen = [], 0, None, False, False
        for kind, payload in chunks:
            if kind == b'acTL':
                if frames:
                    raise ValueError('Animation header follows frame data')
                animation_seen = True
            elif kind in (b'cICP', b'sRGB'):
                if frames:
                    raise ValueError('Color header follows frame data')
                color_seen = True
            elif kind == b'fcTL':
                if not animation_seen or not color_seen or len(payload) != 26:
                    raise ValueError('Invalid frame control order or size')
                number, fw, fh, x, y, numerator, denominator, dispose, blend = struct.unpack('>IIIIIHHBB', payload)
                if (number != sequence or not 0 < fw <= width or not 0 < fh <= height
                        or x + fw > width or y + fh > height
                        or dispose != 0 or blend != 0 or numerator == 0):
                    raise ValueError('Only ordered bounded SOURCE rectangles, no disposal and positive timing are proved')
                if not frames and (fw, fh, x, y) != (width, height, 0, 0):
                    raise ValueError('The first default-image frame must fill the canvas')
                sequence += 1
                current = {'duration': Fraction(numerator, denominator or 100), 'chunks': [],
                           'rectangle': [x, y, fw, fh]}
                frames.append(current)
            elif kind in (b'IDAT', b'fdAT'):
                if current is None:
                    raise ValueError('Default image must be the first fully composed animation frame')
                if kind == b'IDAT':
                    if len(frames) != 1:
                        raise ValueError('IDAT appears after the first frame')
                else:
                    if len(frames) < 2 or len(payload) < 5 or struct.unpack('>I', payload[:4])[0] != sequence:
                        raise ValueError('Invalid frame-data sequence')
                    sequence += 1
                    payload = payload[4:]
                current['chunks'].append((b'IDAT', payload))
        if len(frames) != frame_count or any(not frame['chunks'] for frame in frames):
            raise ValueError('Animation frame count or compressed data is incomplete')
        exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
        expected = {'FileType': 'APNG', 'BitDepth': depth, 'ImageWidth': width, 'ImageHeight': height,
                    'AnimationFrames': frame_count, 'AnimationPlays': plays}
        expected.update({'ColorPrimaries': primaries, 'TransferCharacteristics': transfer,
                         'MatrixCoefficients': 0, 'VideoFullRangeFlag': 1} if cicp_signaled else
                        {'SRGBRendering': srgb[0][0]})
        if any(exif.get(key) != value for key, value in expected.items()) or exif.get('Orientation', 1) not in (1, 8):
            raise ValueError('Independent ExifTool signaling disagrees or orientation is unsupported')
    except (ValueError, struct.error) as error:
        raise ValueError(f'{rejection}: {error}') from error
    facts = {'width': width, 'height': height, 'depth': depth, 'primaries': primaries,
             'transfer': transfer, 'matrix': matrix, 'full_range': bool(full_range),
             'frames': frame_count, 'plays': plays, 'durations_ms': [float(frame['duration'] * 1000) for frame in frames],
             'duration_fractions': [[frame['duration'].numerator, frame['duration'].denominator] for frame in frames],
             'alpha': color_type == 6, 'orientation': exif.get('Orientation', 1),
             'display_width': height if exif.get('Orientation', 1) == 8 else width,
             'display_height': width if exif.get('Orientation', 1) == 8 else height,
             'color_signaling': 'cICP' if cicp_signaled else 'sRGB chunk',
             'composition': 'bounded SOURCE rectangles, no disposal',
             'frame_rectangles': [frame['rectangle'] for frame in frames],
             'exiftool': {key: value for key, value in exif.items() if key not in (
                 'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')},
             'sha256': avif.digest(path)}
    return facts, frames, header[0], color_chunk


def inspect_and_decode(path, directory):
    facts, frames, header, color = _inspect(path)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    pixels, paths = [], []
    canvas = np.zeros((facts['height'], facts['width'], 4), dtype=float)
    for index, frame in enumerate(frames):
        x, y, width, height = frame['rectangle']
        output = directory/f'frame-{index}.png'
        rectangle = directory/f'rectangle-{index}.png'
        rectangle_header = struct.pack('>II', width, height) + header[8:]
        rectangle.write_bytes(pack_chunks([(b'IHDR', rectangle_header), color]
                                      + frame['chunks'] + [(b'IEND', b'')]))
        decoded = avif.read_png(rectangle)
        # SOURCE replaces all channels, including RGB below zero alpha. There
        # is no blending arithmetic or disposal in this independently checked
        # subset. The first full-canvas frame also resets every repeated play.
        canvas[y:y+height, x:x+width] = decoded
        pixels.append(canvas.copy())
        if (x, y, width, height) == (0, 0, facts['width'], facts['height']):
            output.write_bytes(rectangle.read_bytes())
        else:
            # This native PNG is only a composed decoder intermediate for the
            # candidate pipeline. Verification above reads libpng's samples.
            avif.write_png(output, canvas)
        paths.append(str(output))
    facts['decoder'] = 'independent APNG chunk reader and native libpng'
    facts['decoded_paths'] = paths
    return facts, pixels


def fixture_specs():
    for transfer in ('pq', 'hlg'):
        for gamut in ('p3', 'rec2020'):
            yield {'id': f'apng-{transfer}-{gamut}-16-alpha', 'transfer': transfer,
                   'gamut': gamut, 'depth': 16, 'alpha': True, 'frames': 2,
                   'peak_nits': 4000 if transfer == 'pq' else 1000}


def generate_orientation_fixture(source, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    output = directory/f'{Path(source).stem}-orientation-8.png'
    output.write_bytes(Path(source).read_bytes())
    avif.native(['exiftool', '-overwrite_original', '-Orientation#=8', output])
    facts, frames = inspect_and_decode(output, directory/'decoded-source')
    return output, facts, frames


def _sequence_white_control(frames, references, geometry):
    # Every tap must come from the unchanged neutral neighborhood in source
    # coordinates. The independent geometry oracle maps its coverage. This
    # region check supplements, and never masks, full-frame appearance tests.
    coverage = np.zeros((64, 96, 4))
    coverage[..., 3] = 1
    coverage[2:28, 44:51, :3] = 1
    mask = avif.geometry_reference(coverage, geometry)[..., 0] == 1
    if geometry == 'contain':
        # Keep the original contain control's exact 48-pixel region unchanged.
        mask[:] = False
        mask[:16, 27:30] = True
    identical = np.array_equal(references[0][..., :3][mask], references[1][..., :3][mask])
    difference = float(np.max(np.abs(frames[0][..., :3][mask] - frames[1][..., :3][mask]))) if np.any(mask) else None
    return {'source_region_xywh': [44, 0, 8, 28] if geometry == 'contain' else [44, 2, 7, 26],
            'region_xywh': [27, 0, 3, 16] if geometry == 'contain' else None, 'geometry': geometry,
            'samples': int(np.count_nonzero(mask)), 'reference_samples_identical': bool(identical),
            'maximum_signal_difference': difference,
            'passed': bool(np.any(mask) and identical and difference == 0),
            'scope': 'Exact unchanged ordinary-white filter neighborhood; no frame-adaptive grade'}


def generate_fixture(spec, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    first = avif.make_scene(True)
    second = first.copy()
    second[32:] = np.roll(second[32:], 16, axis=1)
    # A boundary shadow change plus bottom-half motion keeps full-canvas
    # encoding while the ordinary-white neighborhood remains fixed. Reversing
    # the ramp would change that neighborhood and its resized white samples.
    second[0, 0, :3] = .02
    if spec['transfer'] == 'pq':
        second[:16, 80:, :3] = 4000
    authored, paths = [first, second], []
    for index, frame in enumerate(authored):
        signal = frame.copy()
        signal[..., :3] = avif.encode_transfer(signal[..., :3], spec['transfer'], spec['gamut'])
        path = directory/f'frame-{index}.png'
        avif.write_png(path, signal)
        paths.append(path)
    source = directory/f'{spec["id"]}.png'
    encode(paths, source, spec['transfer'], spec['gamut'])
    avif.native(['exiftool', '-overwrite_original', '-Artist=HDR-PROOF-PRIVATE',
                 '-XMP-dc:Creator=HDR-PROOF-PRIVATE', '-GPSLatitude=51.5', '-GPSLatitudeRef=N',
                 '-GPSLongitude=4.5', '-GPSLongitudeRef=E', '-Model=Test Camera',
                 '-SerialNumber=987654', source])
    facts, _ = inspect_and_decode(source, directory/'decoded-source')
    return source, facts, authored


def _rejection_controls(source, directory):
    from matrix import exact_original, request_decision
    directory.mkdir(parents=True, exist_ok=True)
    chunks = _png_chunks(source.read_bytes())
    controls = []
    for variant, field, value in (('over-blend', 8, 1), ('previous-disposal', 7, 2),
                                   ('partial-default-frame', 1, 95)):
        changed, modified = False, []
        for kind, payload in chunks:
            if kind == b'fcTL' and not changed:
                fields = list(struct.unpack('>IIIIIHHBB', payload))
                fields[field] = value
                payload = struct.pack('>IIIIIHHBB', *fields)
                changed = True
            modified.append((kind, payload))
        path = directory/f'{variant}.png'
        path.write_bytes(pack_chunks(modified))
        before, error = len(avif.COMMANDS), None
        try:
            inspect_and_decode(path, directory/variant)
        except ValueError as rejected:
            error = str(rejected)
        facts = {'format': 'png', 'motion': None}
        original = request_decision(facts, {})
        transformed = request_decision(facts, {'format': 'avif', 'range': 'hdr', 'w': 58})
        original_bytes = exact_original(path.read_bytes(), original)
        checks = {'unsupported_composition_rejected': error is not None,
                  'no_native_pixel_calls': len(avif.COMMANDS) == before,
                  'exact_original_bytes': original_bytes == path.read_bytes(),
                  'transformations_withheld': transformed['action'] == 'metadata-pending'}
        name = f'apng:source-composition:{variant}'
        controls.append({'case_id': name, 'name': name, 'variant': variant,
            'status': 'passed' if all(checks.values()) else 'failed', 'passed': all(checks.values()),
            'checks': checks, 'codec_qualification': False, 'source': str(path),
            'sha256': avif.digest(path), 'source_rejection': error,
            'transformed_decision': transformed, 'original_decision': original,
            'scope': 'Unsupported source composition remains unqualified; exact original bytes remain available'})
    return controls


def run(output_directory, *, specs=None,
        geometries=('contain', 'cover', 'fill', 'upscale', 'orientation'),
        motions=('preserve', 'static'), animated_gif=False):
    from appearance import RGB_TO_XYZ, compare_appearance, sdr_signal_to_nits
    import gamma_icc
    import gamma_sdr
    from matrix import ProofRequestError, exact_original, request_decision
    from sdr_reference import reference_srgb
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    evidence, fixtures, controls = [], [], []
    start_commands = len(avif.COMMANDS)
    if not motions or any(motion not in ('preserve', 'static') for motion in motions):
        raise ValueError('Unknown APNG proof motion selector')
    for spec in (fixture_specs() if specs is None else specs):
        folder = output_directory/spec['id']
        source, source_facts, analytic = generate_fixture(spec, folder)
        source_facts, decoded = inspect_and_decode(source, folder/'decoded-source')
        source_paths = [Path(path) for path in source_facts['decoded_paths']]
        references = []
        for frame in decoded:
            reference = frame.copy()
            reference[..., :3] = avif.decode_transfer(frame[..., :3], spec['transfer'], spec['gamut'])
            references.append(reference)
        source_measurements = [compare_appearance(authored[..., :3], reference[..., :3],
            reference_gamut=spec['gamut'], actual_gamut=spec['gamut'], fixture_class='avif-12',
            alpha=authored[..., 3]) for authored, reference in zip(analytic, references)]
        source_valid = (all(result['passed'] for result in source_measurements)
            and all(np.array_equal(frame, avif.read_png(folder/f'frame-{index}.png')) for index, frame in enumerate(decoded)))
        tone_controls = [avif.sdr_tone_control(path, folder/f'sdr-control-{index}.png', reference,
            authored, spec['transfer'], spec['gamut'], peak_nits=spec['peak_nits'])
            for index, (path, reference, authored) in enumerate(zip(source_paths, references, analytic))]
        fixtures.append({'id': spec['id'], 'path': str(source), 'sha256': avif.digest(source),
            'spec': spec, 'generator': 'apng.py:generate_fixture', 'facts': source_facts,
            'source_valid': source_valid, 'source_appearance': source_measurements,
            'sdr_tone_controls': tone_controls,
            'threshold_scope': 'Existing avif-12 ceiling for finer 16-bit source samples; SDR gates unchanged'})
        known = {'format': 'png', 'range': 'hdr', 'gamut': spec['gamut'], 'depth': 16,
                 'width': 96, 'height': 64, 'motion': 'animated',
                 'alpha': 'fractional', 'alpha_capable': True, 'orientation': 1}
        before = len(avif.COMMANDS)
        original_decision = request_decision(known, {'format': 'png', 'range': 'hdr', 'depth': '16',
            'gamut': spec['gamut'], 'motion': 'animated', 'w': 96, 'h': 64})
        original = folder/'exact-original.png'
        original.write_bytes(exact_original(source.read_bytes(), original_decision))
        checks = {'exact_original_bytes': original.read_bytes() == source.read_bytes(),
                  'no_native_calls': len(avif.COMMANDS) == before,
                  'metadata_retained': b'HDR-PROOF-PRIVATE' in original.read_bytes()}
        name = spec['id'] + ':exact-original'
        controls.append({'case_id': name, 'name': name, 'status': 'passed' if all(checks.values()) else 'failed',
            'passed': all(checks.values()), 'checks': checks, 'codec_qualification': False,
            'decision': original_decision, 'source_sha256': avif.digest(source), 'output_sha256': avif.digest(original)})
        if len(fixtures) == 1:
            controls.extend(_rejection_controls(source, output_directory/'source-composition-controls'))
            for extension in ('jpg', 'gif'):
                selectors = {'format': extension, 'range': 'sdr', 'gamut': 'srgb',
                    'motion': 'static', 'depth': '8', 'transparency': 'preserve', 'w': 58}
                before, status, reason = len(avif.COMMANDS), None, None
                try:
                    request_decision(known, selectors)
                except ProofRequestError as error:
                    status, reason = error.status, str(error)
                checks = {'preserve_alpha_rejected': status == 422,
                          'no_native_calls': len(avif.COMMANDS) == before}
                name = f'apng:static:{extension}:preserve-alpha'
                controls.append({'case_id': name, 'name': name, 'variant': f'{extension}-preserve-alpha',
                    'status': 'passed' if all(checks.values()) else 'failed', 'passed': all(checks.values()),
                    'checks': checks, 'codec_qualification': False, 'selectors': selectors,
                    'http_status': status, 'reason': reason})
        geometry_selectors = {'contain': {'w': 58, 'h': 38, 'fit': 'contain'},
            'cover': {'w': 40, 'h': 40, 'fit': 'cover'}, 'fill': {'w': 40, 'h': 48, 'fit': 'fill'},
            'upscale': {'w': 120, 'h': 80, 'fit': 'contain'}, 'orientation': {'w': 58, 'fit': 'contain'}}
        for geometry in geometries:
            if geometry not in geometry_selectors:
                raise ValueError('Unknown APNG proof geometry')
            actual_id, actual_source, actual_facts = spec['id'], source, source_facts
            actual_known, conversion_paths, geometry_valid = known, source_paths, source_valid
            orientation_evidence = None
            if geometry == 'orientation':
                from hdr_png import bake_orientation, inspect_source
                actual_id = spec['id'] + '-orientation-8'
                actual_source, actual_facts, oriented_frames = generate_orientation_fixture(source, folder/'orientation')
                conversion_paths, rotations, baked_facts = [], [], []
                for index, path in enumerate(actual_facts['decoded_paths']):
                    baked = folder/'orientation'/f'baked-{index}.png'
                    bake_orientation(path, baked, actual_facts)
                    conversion_paths.append(baked)
                    rotations.append(bool(np.array_equal(oriented_frames[index], decoded[index])
                        and np.array_equal(avif.read_png(baked), np.rot90(decoded[index]))))
                    baked_facts.append(inspect_source(baked))
                geometry_valid = bool(source_valid and all(rotations) and all(
                    facts['orientation'] == 1 and facts['gamut'] == spec['gamut']
                    and facts['transfer_name'] == spec['transfer'] for facts in baked_facts))
                actual_known = {**known, 'orientation': 8, 'width': 64, 'height': 96}
                orientation_evidence = {'source_sha256': avif.digest(actual_source),
                    'exact_rotation_frames': rotations, 'baked_facts': baked_facts,
                    'independent_reference': 'numpy.rot90 of independently decoded coded RGBA16 frames'}
                fixtures.append({'id': actual_id, 'path': str(actual_source), 'sha256': avif.digest(actual_source),
                    'spec': {**spec, 'id': actual_id, 'orientation': 8}, 'facts': actual_facts,
                    'generator': 'apng.py:generate_orientation_fixture', 'source_valid': geometry_valid,
                    'base_sha256': avif.digest(source), 'orientation': orientation_evidence})
            resized_references = [avif.geometry_reference(reference, geometry) for reference in references]
            operations = [(dynamic_range, extension, motion, None) for motion in motions
                for dynamic_range, extension in (('hdr', 'png'), ('hdr', 'avif'),
                    ('sdr', 'png'), ('sdr', 'avif'), ('sdr', 'webp'))]
            if 'static' in motions:
                operations.extend([('sdr', 'jpg', 'static', None), ('sdr', 'gif', 'static', None),
                                   ('sdr', 'gif', 'static', 'gamma3.2-nearest')])
            if animated_gif and 'preserve' in motions:
                operations.append(('sdr', 'gif', 'preserve', 'gamma3.2-nearest-animation'))
            for dynamic_range, extension, motion, representation in operations:
                count = 1 if motion == 'static' else 2
                selected_references = resized_references[:count]
                sdr = dynamic_range == 'sdr'
                depth = 16 if extension == 'png' else 8 if sdr else 12
                transfer, gamut = (('srgb' if extension == 'png' else 'gamma22'), 'srgb') if sdr else (spec['transfer'], spec['gamut'])
                case_id = f'{actual_id}:{dynamic_range}:{extension}:{motion}:{geometry}'
                if representation:
                    case_id += ':' + representation
                case_directory = folder/case_id.replace(':', '-')
                case_directory.mkdir(exist_ok=True)
                selectors = {'format': extension, 'range': dynamic_range, 'depth': str(depth),
                             'gamut': 'srgb' if sdr else 'preserve', 'motion': motion,
                             'transparency': 'coerce' if extension in ('jpg', 'gif') else 'preserve',
                             **geometry_selectors[geometry]}
                item = {'case_id': case_id, 'fixture_id': actual_id, 'cell_id': f'hdr-png:{dynamic_range}:{extension}',
                        'selectors': selectors, 'geometry': geometry, 'status': 'tested and failed',
                        'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                        'blockers': [], 'measurements': {}, 'artifacts': {},
                        'source_facts': actual_facts, 'consumer_status': 'pending manual review'}
                if representation:
                    item['representation'] = representation
                if orientation_evidence is not None:
                    item['orientation_source'] = orientation_evidence
                try:
                    decision = request_decision(actual_known, selectors)
                    if decision['action'] != 'unqualified':
                        raise ValueError('Tuple is not eligible for a native conversion experiment')
                    item['frame_selection'] = decision['frame_selection']
                    converted = []
                    for index, path in enumerate(conversion_paths[:count]):
                        output = case_directory/f'converted-{index}.png'
                        avif.convert_frame(path, output, spec['transfer'], spec['gamut'], geometry,
                                           sdr=sdr, peak_nits=spec['peak_nits'] if sdr else None)
                        converted.append(output)
                    target = case_directory/f'output.{extension}'
                    if extension == 'png' and count == 1:
                        facts, frames, detail = avif.encode_other(converted, target, extension,
                            transfer, gamut, selected_references, 1, spec)
                        item['checks']['native_encoder'] = True
                        item['checks']['independent_decoder'] = True
                        detail['orientation_baked'] = facts['exiftool'].get('Orientation', 1) == 1
                        linear = [avif.decode_transfer(frames[0][..., :3], transfer, gamut)]
                        actual_gamut = gamut
                    elif extension == 'png':
                        encode(converted, target, transfer, gamut)
                        item['checks']['native_encoder'] = True
                        facts, frames = inspect_and_decode(target, case_directory/'decoded')
                        item['checks']['independent_decoder'] = True
                        detail = {'depth': facts['depth'] == depth,
                            'color_signaling': facts['primaries'] == avif.PRIMARIES[gamut] and facts['transfer'] == avif.TRANSFERS[transfer],
                            'dimensions': all(frame.shape == reference.shape for frame, reference in zip(frames, resized_references)),
                            'frames': len(frames) == 2, 'timing': facts['durations_ms'] == [300, 700],
                            'loop': facts['plays'] == 3, 'orientation_baked': facts['orientation'] == 1,
                            'alpha': all(np.max(np.abs(frame[..., 3] - reference[..., 3])) <= 2 / 65535
                                         for frame, reference in zip(frames, resized_references))}
                        linear = [avif.decode_transfer(frame[..., :3], transfer, gamut) for frame in frames]
                        actual_gamut = gamut
                    elif extension == 'avif':
                        if sdr:
                            gamma_sdr.encode(converted, target, depth=depth)
                        else:
                            avif.encode_avif(converted, target, transfer, gamut, depth)
                        item['checks']['native_encoder'] = True
                        facts = avif.inspect_avif(target)
                        frames = avif.decode_avif(target, case_directory, count)
                        item['checks']['independent_decoder'] = True
                        detail = avif.structure_checks(facts, frames, spec, selected_references, transfer, gamut, depth, count)
                        linear = [(gamma_sdr.decode_signal_to_nits(frame[..., :3]) if sdr else
                                   avif.decode_transfer(frame[..., :3], transfer, gamut)) for frame in frames]
                        actual_gamut = gamut
                    else:
                        gif_options = {'gif_gamma': 3.2, 'gif_quantization': 'nearest'} if representation else {}
                        facts, frames, detail, profile = avif.encode_gamma_other(
                            converted, target, extension, selected_references, count, **gif_options)
                        linear = [gamma_icc.decode_signal_to_nits(frame[..., :3], profile,
                            expected_gamma=3.2 if representation else 2.2) for frame in frames]
                        actual_gamut = 'rec2020'
                    privacy = inspect_privacy(target, facts, extension)
                    white_control = _sequence_white_control(frames, resized_references, geometry) if count == 2 else None
                    measurements = []
                    for reference, actual in zip(selected_references, linear):
                        expected = (sdr_signal_to_nits(reference_srgb(reference[..., :3], spec['gamut'], peak_nits=spec['peak_nits']))
                                    if sdr else reference[..., :3])
                        measurements.append(compare_appearance(expected, actual,
                            reference_gamut='srgb' if sdr else gamut, actual_gamut=actual_gamut,
                            fixture_class='sdr-8' if sdr else 'avif-12',
                            alpha=(None if extension == 'jpg' else (reference[..., 3] >= .5).astype(float)
                                   if extension == 'gif' else reference[..., 3]),
                            region_reference_luminance_nits=reference[..., :3] @ RGB_TO_XYZ[spec['gamut']][1]))
                    item['privacy_measurement'] = privacy
                    item['checks'].update({'native_encoder': True, 'independent_decoder': True,
                        'structure': bool(geometry_valid and all(detail.values())), 'privacy': privacy['passed'],
                        'appearance': all(measurement['passed'] for measurement in measurements)
                                      and (white_control is None or white_control['passed'])
                                      and (not sdr or all(control['passed'] for control in tone_controls))})
                    item['measurements'] = {'frames': measurements, 'tone_controls': tone_controls if sdr else [],
                                            'sequence_white_control': white_control}
                    item['facts'], item['structural_checks'] = facts, detail
                    item['artifacts'] = {'output': str(target), 'sha256': avif.digest(target),
                                         'source': str(actual_source), 'source_sha256': avif.digest(actual_source)}
                    if not geometry_valid:
                        item['blockers'].append('Source analytic or exact native-sample checks failed')
                    item['blockers'] += [f'Failed {key} check' for key, passed in item['checks'].items() if not passed]
                    if all(item['checks'].values()) and not item['blockers']:
                        item['status'] = 'qualified'
                except Exception as error:
                    item['blockers'].append(str(error))
                evidence.append(item)
        print(f'APNG {spec["id"]}: native {"/".join(geometries)} animation evidence recorded', flush=True)
    return {'fixtures': fixtures, 'evidence': evidence, 'controls': controls,
            'commands': avif.COMMANDS[start_commands:]}
