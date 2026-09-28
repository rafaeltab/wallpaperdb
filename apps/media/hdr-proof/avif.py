"""Native AVIF conversion probes. Color equations below are fixture/oracle code only."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

import numpy as np
from PIL import Image

PRIMARIES = {'srgb': 1, 'p3': 12, 'rec2020': 9}
TRANSFERS = {'srgb': 13, 'pq': 16, 'hlg': 18}
LUMA = {'srgb': [.2126, .7152, .0722], 'p3': [.2289746, .6917385, .0792869], 'rec2020': [.2627, .678, .0593]}
COMMANDS = []


def native(args, *, data=None):
    result = subprocess.run([str(a) for a in args], input=data, capture_output=True, timeout=180)
    COMMANDS.append({'argv': [str(a) for a in args], 'exit_code': result.returncode,
                     'stderr': re.sub(r'0x[0-9a-fA-F]+', '0xADDRESS', result.stderr.decode(errors='replace'))[-6000:]})
    if result.returncode:
        raise RuntimeError(f'{args[0]} exited {result.returncode}: {COMMANDS[-1]['stderr'][-3000:]}')
    return result.stdout


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def encode_transfer(rgb, transfer, gamut):
    rgb = np.maximum(rgb, 0)
    if transfer == 'pq':
        p = (rgb / 10000) ** (2610 / 16384)
        return ((3424 / 4096 + 2413 / 128 * p) / (1 + 2392 / 128 * p)) ** (2523 / 32)
    if transfer == 'srgb':
        x = rgb / 100
        return np.where(x <= .0031308, 12.92*x, 1.055*x**(1/2.4)-.055)
    # BT.2100 HLG reference display, 1000 cd/m2, system gamma 1.2, zero black.
    display = rgb / 1000
    y = np.sum(display * LUMA[gamut], axis=-1, keepdims=True)
    scene = display / np.maximum(y, 1e-30) ** (1/6)
    a, b, c = .17883277, .28466892, .55991073
    return np.where(scene <= 1/12, np.sqrt(3*scene), a*np.log(np.maximum(12*scene-b, 1e-30))+c)


def decode_transfer(signal, transfer, gamut):
    signal = np.maximum(signal, 0)
    if transfer == 'pq':
        p = signal ** (32 / 2523)
        return 10000 * (np.maximum(p-3424/4096, 0) / (2413/128-2392/128*p)) ** (16384/2610)
    if transfer == 'srgb':
        return 100*np.where(signal <= .04045, signal/12.92, ((signal+.055)/1.055)**2.4)
    a, b, c = .17883277, .28466892, .55991073
    scene = np.where(signal <= .5, signal**2/3, (np.exp((signal-c)/a)+b)/12)
    y = np.sum(scene * LUMA[gamut], axis=-1, keepdims=True)
    return 1000 * scene * y**.2


def make_scene(alpha):
    image = np.ones((64, 96, 4), dtype=np.float64)
    ramp = np.concatenate((np.geomspace(.01, 9, 16), np.linspace(10, 203, 32), np.linspace(210, 1000, 48)))
    image[:32, :, :3] = ramp[None, :, None]
    for i, rgb in enumerate(([203]*3, [0]*3, [18]*3, [203, 0, 0], [0, 203, 0], [0, 0, 203])):
        image[32:, 16*i:16*(i+1), :3] = rgb
    if alpha:
        image[..., 3] = np.linspace(0, 1, 96)[None, :]
        image[:32, :, 3] = 1  # Neutral controls remain visible.
        image[40:56, 4:12, 3] = .5
    return image


def geometry_reference(rgba, mode):
    if mode in ('identity', 'static'):
        return rgba.copy()
    if mode == 'orientation':
        rgba = np.rot90(rgba)
    height, width = rgba.shape[:2]
    size = {'contain': (57, 38), 'cover': (40, 40), 'fill': (40, 48), 'upscale': (120, 80), 'orientation': (58, 87)}[mode]
    box = None
    if mode == 'cover':
        left = (width-height)/2
        box = (left, 0, left+height, height)
    # Pillow's native floating-point resampler is independent of libplacebo.
    # Straight alpha must be premultiplied for filtering, then unpremultiplied.
    premul = rgba.copy()
    premul[..., :3] *= premul[..., 3:4]
    resized = np.stack([np.asarray(Image.fromarray(premul[..., c].astype('float32')).resize(size, Image.Resampling.BILINEAR, box=box)) for c in range(4)], axis=-1).astype(float)
    resized[..., :3] /= np.maximum(resized[..., 3:4], 1e-15)
    return resized


def write_png(path, signal):
    h, w = signal.shape[:2]
    raw = np.rint(np.clip(signal, 0, 1)*65535).astype('<u2').tobytes()
    native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba64le', '-s', f'{w}x{h}', '-i', 'pipe:0', '-frames:v', '1', '-threads', '1', str(path)], data=raw)


def read_png(path):
    raw = native(['hdr-proof-png-decode', path])
    width, height, depth = np.frombuffer(raw[:12], dtype='<u4')
    if depth not in (8,16):
        raise ValueError('Unsupported PNG source precision')
    return np.frombuffer(raw[12:], dtype='<u2').reshape(int(height), int(width), 4).astype(float)/65535


def encode_avif(paths, output, transfer, gamut, depth, *, orientation=False, private=False):
    cmd = ['avifenc', '-c', 'aom', '-j', '1', '-s', '8', '-q', '100', '--qalpha', '100', '-y', '444', '-d', str(depth), '--cicp', f'{PRIMARIES[gamut]}/{TRANSFERS[transfer]}/0', '--ignore-exif', '--ignore-xmp', '--ignore-profile', '--timescale', '10', '--repetition-count', '2', '--creation-time', '1', '--modification-time', '1']
    if orientation:
        cmd += ['--irot', '1']
    if private:
        xmp = output.parent/'private.xmp'
        xmp.write_text('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" exif:GPSLatitude="51,0,0N" tiff:Make="HDR-PROOF-PRIVATE-CAMERA"/></rdf:RDF></x:xmpmeta>')
        cmd += ['--xmp', xmp]
    for i, path in enumerate(paths):
        cmd += ['--duration', str((3, 7)[i % 2]), path]
    native(cmd + [output])


def inspect_avif(path):
    info = native(['avifdec', '-j', '1', '-c', 'dav1d', '--info', path]).decode()
    exif = json.loads(native(['exiftool', '-j', '-n', path]))[0]
    def find(pattern):
        found = re.search(pattern, info)
        return found.group(1) if found else None
    return {'info': info, 'exiftool': {k:v for k,v in exif.items() if k not in ('SourceFile', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate', 'Directory')},
            'width': int(find(r'Resolution\s*:\s*(\d+)') or 0),
            'height': int(find(r'Resolution\s*:\s*\d+x(\d+)') or 0),
            'depth': int(find(r'Bit Depth\s*:\s*(\d+)') or 0),
            'primaries': int(find(r'Color Primaries\s*:\s*(\d+)') or 0),
            'transfer': int(find(r'Transfer Char\.\s*:\s*(\d+)') or 0),
            'matrix': int(find(r'Matrix Coeffs\.\s*:\s*(\d+)') or 0),
            'alpha': find(r'Alpha\s*:\s*(\w+)'),
            'sha256': digest(path)}


def decode_avif(path, directory, count):
    frames = []
    for index in range(count):
        png = directory / f'decoded-{index}.png'
        native(['avifdec', '-j', '1', '-c', 'dav1d', '-d', '16', '--index', str(index), path, png])
        frames.append(read_png(png))
    return frames


def convert_frame(source, output, transfer, gamut, mode, *, sdr=False, mapper=None, peak_nits=None):
    with Image.open(source) as image:
        width, height = image.size
    outw, outh = {'identity': (width,height), 'static': (width,height), 'orientation': (58,87), 'contain': (57,38), 'cover': (40,40), 'fill': (40,48), 'upscale': (120,80)}[mode]
    if not sdr:
        _convert_hdr_frame(source, output, transfer, gamut, mode, outw, outh)
        return
    if mapper is None:
        from sdr_candidate import convert
        if peak_nits is None:
            raise ValueError('The calibrated SDR candidate requires a declared sequence peak in nits')
        intermediate = Path(output).with_name(Path(output).stem + '-hdr.png')
        _convert_hdr_frame(source, intermediate, transfer, gamut, mode, outw, outh)
        convert(intermediate, output, transfer, gamut, peak_nits=peak_nits)
        return
    target_gamut = 'srgb' if sdr else gamut
    target_transfer = 'srgb' if sdr else transfer
    options = f'w={outw}:h={outh}:colorspace=0:color_primaries={PRIMARIES[target_gamut]}:color_trc={TRANSFERS[target_transfer]}:range=pc:peak_detect=0:tonemapping={mapper if sdr else "clip"}:gamut_mode={"perceptual" if sdr else "clip"}:contrast_recovery=0:dithering=none:upscaler=bilinear:downscaler=bilinear:sigmoid=0:alpha_mode=straight'
    if mode == 'cover':
        options += ':crop_w=ih:crop_h=ih:crop_x=(iw-ih)/2:crop_y=0'
    filters = f'format=rgba64le,setparams=range=full:color_primaries={PRIMARIES[gamut]}:color_trc={TRANSFERS[transfer]}:colorspace=0,hwupload,libplacebo={options},hwdownload,format=rgba64le'
    native(['ffmpeg', '-v', 'error', '-y', '-init_hw_device', 'vulkan=vk:0', '-filter_hw_device', 'vk', '-i', source, '-vf', filters, '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])


def _convert_hdr_frame(source, output, transfer, gamut, mode, width, height):
    from native_transfer import hlg_to_linear, linear_to_hlg

    # Geometry operates on display-linear light. A 10000-nit normalization
    # preserves the full PQ domain in float without changing absolute exposure.
    base = (f'primariesin={PRIMARIES[gamut]}:primaries={PRIMARIES[gamut]}:'
            'matrixin=0:matrix=0:rangein=full:range=full:npl=10000:agamma=0')
    source_transfer = TRANSFERS[transfer]
    linearize = (f'zscale={base}:transferin={source_transfer}:transfer=linear,'
                 'format=gbrapf32le:alpha_modes=premultiplied,setparams=alpha_mode=straight')
    encode = f'zscale={base}:transferin=linear:transfer={source_transfer}'
    if transfer == 'hlg':
        # zimg's HLG transfer applies gamma per channel. BT.2100 display light
        # instead couples the system gamma to luminance, including for P3.
        linearize = (f'zscale={base}:transferin={source_transfer}:transfer={source_transfer},'
                     'format=gbrapf32le:alpha_modes=premultiplied,setparams=alpha_mode=straight,'
                     + hlg_to_linear(gamut, 10000)
                     + ',setparams=color_trc=linear')
        encode = (linear_to_hlg(gamut, 10000)
                  + f',setparams=color_trc={source_transfer},zscale={base}:'
                  f'transferin={source_transfer}:transfer={source_transfer}')

    crop = 'crop=ih:ih:(iw-ih)/2:0,' if mode == 'cover' else ''
    # zimg otherwise premultiplies *nonlinear* values before a transfer change.
    # During transfer-only stages both negotiated alpha modes are therefore
    # marked premultiplied to suppress its implicit association changes. The
    # actual multiplication occurs explicitly below, after linearization.
    filters = (
        'format=gbrap16le,setparams=alpha_mode=premultiplied,' + linearize + ','
        'premultiply=inplace=1,setparams=alpha_mode=premultiplied,' + crop
        + f'zscale=w={width}:h={height}:filter=bilinear,'
        'format=gbrapf32le:alpha_modes=premultiplied,unpremultiply=inplace=1,'
        'setparams=alpha_mode=premultiplied,' + encode + ','
        'format=gbrap16le:alpha_modes=premultiplied,setparams=alpha_mode=straight,'
        'format=rgba64le:alpha_modes=straight'
    )
    native(['ffmpeg', '-v', 'error', '-y', '-filter_threads', '1', '-i', source,
            '-vf', filters, '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])


def fixture_specs():
    for transfer in ('pq', 'hlg'):
        for gamut in ('p3', 'rec2020'):
            for depth in (8, 10, 12):
                for alpha in (False, True):
                    yield {'id': f'avif-{transfer}-{gamut}-{depth}-{"alpha" if alpha else "opaque"}', 'transfer': transfer, 'gamut': gamut, 'depth': depth, 'alpha': alpha, 'frames': 1}
    for transfer in ('pq', 'hlg'):
        yield {'id': f'animated-{transfer}-alpha', 'transfer': transfer, 'gamut': 'rec2020', 'depth': 10, 'alpha': True, 'frames': 2}


def generate_fixture(spec, directory):
    directory.mkdir(parents=True, exist_ok=True)
    scene = make_scene(spec['alpha'])
    frames = [scene]
    if spec['frames'] == 2:
        other = scene.copy()
        other[32:, :, :] = np.roll(other[32:, :, :], 16, axis=1)
        # This HLG fixture declares a 1000 nit reference display. A 4000 nit
        # HLG patch would clip before encoding and invalidate its oracle.
        other[:16, 80:, :3] = 4000 if spec['transfer'] == 'pq' else 1000
        frames.append(other)
    paths = []
    for i, frame in enumerate(frames):
        signal = frame.copy()
        signal[..., :3] = encode_transfer(signal[..., :3], spec['transfer'], spec['gamut'])
        png = directory/f'frame-{i}.png'
        write_png(png, signal)
        paths.append(png)
    path = directory/f'{spec["id"]}.avif'
    encode_avif(paths, path, spec['transfer'], spec['gamut'], spec['depth'], private=True)
    facts = inspect_avif(path)
    return path, facts, frames


def timing(facts):
    return [int(x) for x in re.findall(r'duration [\d.]+ \((\d+) timescales\)', facts['info'])]


def structure_checks(facts, frames, spec, reference, transfer, gamut, depth, count):
    shape = reference[0].shape
    checks = {
        'dimensions': (facts['width'], facts['height']) == (shape[1], shape[0]),
        'depth': facts['depth'] == depth,
        'transfer': facts['transfer'] == TRANSFERS[transfer] == facts['exiftool'].get('TransferCharacteristics'),
        'gamut': facts['primaries'] == PRIMARIES[gamut] == facts['exiftool'].get('ColorPrimaries'),
        'matrix_full_range': facts['matrix'] == 0 and 'Range          : Full' in facts['info'],
        'orientation_baked': 'Transformations: None' in facts['info'],
        'frames': len(timing(facts)) == count,
        'timing': timing(facts) == ([3, 7] if count == 2 else [1]),
        'loop': 'Repeat Count   : 2' in facts['info'] if count == 2 else True,
        'alpha': all(np.max(np.abs(frame[..., 3]-ref[..., 3])) <= 2/(2**depth-1) for frame,ref in zip(frames, reference)),
    }
    return checks


def sdr_tone_control(source, output, reference, authored, transfer, gamut, *, peak_nits):
    from appearance import evaluate_sdr_tone_map
    from sdr_reference import reference_srgb

    convert_frame(source, output, transfer, gamut, 'identity', sdr=True, peak_nits=peak_nits)
    actual = read_png(output)
    # Probe identity comes from the authored fixture, not an arbitrary tolerance
    # search in a quantized decode. Eight-bit PQ can move 203 nits beyond the
    # default two-nit search window while retaining a valid ordinary-white patch.
    white = np.all(np.isclose(authored[..., :3], 203, atol=1e-6, rtol=0), axis=-1)
    measurement = evaluate_sdr_tone_map(
        reference[..., :3], actual[..., :3], source_gamut=gamut,
        probe_masks={'ordinary_white': white}, alpha=reference[..., 3],
        reference_srgb=reference_srgb(reference[..., :3], gamut, peak_nits=peak_nits),
    )
    return {'passed': measurement['passed'], 'measurement': measurement,
            'source': str(source), 'output': str(output), 'sha256': digest(output),
            'peak_nits': peak_nits, 'geometry': 'identity',
            'scope': 'Native identity controls for the shared tone/gamut recipe; encoded derivative appearance and structure are checked separately.'}


def run(output_dir):
    from appearance import compare_appearance, sdr_signal_to_nits, RGB_TO_XYZ
    from sdr_reference import reference_srgb
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    evidence, fixtures = [], []
    for spec in fixture_specs():
        folder = output_dir/spec['id']
        source, source_facts, analytic = generate_fixture(spec, folder)
        source_frames = decode_avif(source, folder, spec['frames'])
        reference_source = []
        for decoded in source_frames:
            ref = decoded.copy()
            ref[..., :3] = decode_transfer(decoded[..., :3], spec['transfer'], spec['gamut'])
            reference_source.append(ref)
        source_errors = [compare_appearance(a[..., :3], b[..., :3], reference_gamut=spec['gamut'], actual_gamut=spec['gamut'], fixture_class=f'avif-{spec["depth"]}', alpha=a[..., 3]) for a,b in zip(analytic, reference_source)]
        source_structure = structure_checks(source_facts, source_frames, spec, analytic,
                                            spec['transfer'], spec['gamut'], spec['depth'], spec['frames'])
        source_valid = (all(source_structure.values()) and all(m['passed'] for m in source_errors)
                        and bool(source_facts['exiftool'].get('GPSLatitude')))
        fixtures.append({'id': spec['id'], 'path': str(source), 'sha256': digest(source), 'spec': spec,
                         'facts': source_facts, 'analytic_measurements': source_errors,
                         'structural_checks': source_structure, 'source_valid': source_valid})
        # One declared peak is shared by every frame. Per-frame exposure would
        # make the animation's unchanged ordinary-white patch flicker.
        peak_nits = 4000 if spec['frames'] == 2 and spec['transfer'] == 'pq' else 1000
        tone_controls = []
        for i, (reference, authored) in enumerate(zip(reference_source, analytic)):
            try:
                control = sdr_tone_control(folder/f'decoded-{i}.png', folder/f'sdr-control-{i}.png',
                                           reference, authored, spec['transfer'], spec['gamut'], peak_nits=peak_nits)
            except Exception as error:
                control = {'passed': False, 'peak_nits': peak_nits, 'error': str(error)}
            tone_controls.append(control)
        fixtures[-1]['sdr_tone_controls'] = tone_controls
        source_id = 'static-avif' if spec['frames'] == 1 else f'animated-{spec["transfer"]}'
        operations = [(dynamic_range, 'avif', motion, geometry) for dynamic_range in ('hdr','sdr') for geometry in ('contain','cover','fill','upscale','orientation') for motion in ('preserve',)]
        if spec['frames'] == 2:
            operations += [('hdr', 'avif', 'static', g) for g in ('contain','cover','fill','upscale','orientation')]
            operations += [('sdr', 'webp', 'preserve', g) for g in ('contain','cover','fill','upscale','orientation')]
        # Viable additional encodings on every source-depth/gamut/alpha tuple.
        operations += [('sdr', ext, 'static' if spec['frames']==2 else 'preserve', 'identity') for ext in ('jpg','png','webp','gif')]
        operations += [('hdr', ext, 'static' if spec['frames']==2 else 'preserve', 'identity') for ext in ('png','webp','jpg')]
        for dynamic_range, ext, motion, geometry in operations:
            sdr = dynamic_range == 'sdr'
            target_gamut = 'srgb' if sdr else spec['gamut']
            target_transfer = 'srgb' if sdr else spec['transfer']
            depth = (8 if sdr else spec['depth']) if ext == 'avif' else (16 if ext == 'png' else 8)
            selector_gamut = 'srgb' if sdr else 'preserve'
            case_id = f'{spec["id"]}:{dynamic_range}:{ext}:{selector_gamut}:{motion}:{geometry}'
            case_dir = folder/f'{dynamic_range}-{ext}-{motion}-{geometry}'
            case_dir.mkdir(exist_ok=True)
            selectors = {'format': ext, 'range': dynamic_range, 'gamut': selector_gamut, 'depth': 'preserve' if ext == 'avif' and not sdr else str(depth), 'motion': motion, 'transparency': 'coerce' if ext in ('jpg','gif') and spec['alpha'] else 'preserve'}
            selectors.update({'contain': {'w':58,'h':38,'fit':'contain'}, 'cover': {'w':40,'h':40,'fit':'cover'}, 'fill': {'w':40,'h':48,'fit':'fill'}, 'upscale': {'w':120,'h':80,'fit':'contain'}, 'orientation': {'w':58,'fit':'contain'}, 'identity': {}}[geometry])
            item = {'case_id':case_id, 'fixture_id':spec['id'], 'cell_id':f'{source_id}:{dynamic_range}:{ext}', 'selectors':selectors, 'geometry':geometry, 'status':'tested and failed', 'checks':{k:False for k in ('native_encoder','independent_decoder','structure','appearance','privacy')}, 'blockers':[], 'artifacts':{}, 'measurements':{}}
            try:
                count = 1 if motion == 'static' else spec['frames']
                refs = [geometry_reference(frame, geometry) for frame in reference_source[:count]]
                inputs = [folder/f'decoded-{i}.png' for i in range(count)]
                if geometry == 'orientation':
                    oriented = case_dir/'oriented-source.avif'
                    encode_avif([folder/f'frame-{i}.png' for i in range(count)], oriented, spec['transfer'], spec['gamut'], spec['depth'], orientation=True, private=True)
                    orient_facts = inspect_avif(oriented)
                    if 'irot (Rotation)      : 1' not in orient_facts['info']:
                        raise ValueError('Orientation fixture lacks the requested irot property')
                    decode_avif(oriented, case_dir, count)
                    inputs = [case_dir/f'decoded-{i}.png' for i in range(count)]
                    item['orientation_source'] = {'sha256': digest(oriented), 'facts': orient_facts}
                converted = []
                for i, input_file in enumerate(inputs):
                    png = case_dir/f'converted-{i}.png'
                    convert_frame(input_file, png, spec['transfer'], spec['gamut'], geometry,
                                  sdr=sdr, peak_nits=peak_nits if sdr else None)
                    converted.append(png)
                target = case_dir/f'output.{ext}'
                if ext == 'avif':
                    encode_avif(converted, target, target_transfer, target_gamut, depth)
                    item['checks']['native_encoder'] = True
                    facts = inspect_avif(target)
                    actual = decode_avif(target, case_dir, count)
                    detail = structure_checks(facts, actual, spec, refs, target_transfer, target_gamut, depth, count)
                else:
                    facts, actual, detail = encode_other(converted, target, ext, target_transfer, target_gamut, refs, count, spec)
                item['checks']['native_encoder'] = True
                item['checks']['independent_decoder'] = True
                item['facts'] = facts
                item['structural_checks'] = detail
                item['checks']['structure'] = source_valid and all(detail.values())
                if not source_valid:
                    item['blockers'].append('Generated source failed independent structural or predeclared analytic-fixture checks; derivative measurements cannot qualify this fixture.')
                item['checks']['privacy'] = b'HDR-PROOF-PRIVATE' not in target.read_bytes() and not any(k in facts.get('exiftool', {}) for k in ('GPSLatitude','GPSLongitude','Make','Model','SerialNumber','OwnerName'))
                if ext == 'avif':
                    item['checks']['privacy'] &= all(re.search(r'\* '+kind+r' Metadata\s*:\s*Absent',facts['info']) is not None for kind in ('Exif','XMP'))
                measurements = []
                for i, (ref, decoded) in enumerate(zip(refs,actual)):
                    if sdr:
                        expected = reference_srgb(ref[..., :3], spec['gamut'], peak_nits=peak_nits)
                        measured = compare_appearance(
                            sdr_signal_to_nits(expected), sdr_signal_to_nits(decoded[..., :3]),
                            reference_gamut='srgb', actual_gamut='srgb', fixture_class='sdr-8',
                            alpha=None if ext == 'jpg' else ref[..., 3],
                            region_reference_luminance_nits=ref[..., :3] @ RGB_TO_XYZ[spec['gamut']][1],
                        )
                        measured['tone_control_passed'] = tone_controls[i]['passed']
                        measured['passed'] &= tone_controls[i]['passed']
                        if not tone_controls[i]['passed']:
                            measured['failures'].append('identity_tone_control')
                    else:
                        measured = compare_appearance(ref[..., :3], decode_transfer(decoded[..., :3], target_transfer, target_gamut), reference_gamut=spec['gamut'], actual_gamut=target_gamut, fixture_class=f'avif-{spec["depth"]}', alpha=None if ext=='jpg' else ref[..., 3])
                    measurements.append(measured)
                item['measurements']['frames'] = measurements
                item['checks']['appearance'] = all(m['passed'] for m in measurements)
                if sdr:
                    item['measurements']['tone_controls'] = tone_controls[:count]
                    item['sdr_candidate'] = {'algorithm': 'CPU Mobius knee 0.6; exposure 1.1; output scale 0.99',
                                             'peak_nits': peak_nits,
                                             'gamut_mapping': 'Relative colorimetric D65 primary conversion with explicit sRGB channel clipping'}
                if ext == 'jpg' and not sdr:
                    item['checks']['structure'] = False
                    item['blockers'].append('Single-layer JPEG is not the required dual-metadata gain-map representation.')
                item['artifacts'] = {'output': str(target), 'sha256': digest(target), 'source': str(source), 'source_sha256': digest(source)}
                item['blockers'] += [f'Failed {key} check' for key,value in item['checks'].items() if not value]
                if all(item['checks'].values()) and not item['blockers']:
                    item['status'] = 'qualified'
            except Exception as error:
                item['blockers'].append(str(error))
            evidence.append(item)
        print(f'AVIF {spec["id"]}: {len(operations)} native cases', flush=True)
    return {'evidence':evidence, 'fixtures':fixtures, 'commands':COMMANDS}


def encode_other(paths, target, ext, transfer, gamut, refs, count, spec):
    # Native FFmpeg writers. Alpha coercion is explicit, with no invented matte.
    options = ['ffmpeg', '-v', 'error', '-y']
    if count == 2:
        concat = target.parent/'frames.txt'
        concat.write_text("file 'converted-0.png'\nduration 0.3\nfile 'converted-1.png'\nduration 0.7\n")
        options += ['-f','concat','-safe','0','-i',concat]
    else:
        options += ['-i',paths[0]]
    options += ['-map_metadata','-1','-threads','1']
    if ext == 'webp':
        options += ['-c:v','libwebp_anim' if count==2 else 'libwebp','-lossless','1','-loop','3','-pix_fmt','bgra','-fps_mode','passthrough']
    elif ext == 'jpg':
        options += ['-q:v','1','-pix_fmt','yuvj444p','-frames:v','1']
    elif ext == 'gif':
        options += ['-filter_complex','[0:v]format=rgba,split[image][palette];[palette]palettegen=reserve_transparent=1[pal];[image][pal]paletteuse=alpha_threshold=128','-frames:v','1']
    else:
        options += ['-pix_fmt','rgba64be','-color_primaries',str(PRIMARIES[gamut]),'-color_trc',str(TRANSFERS[transfer]),'-frames:v','1']
    if transfer == 'srgb' and ext in ('jpg', 'webp') and count == 1:
        native(['node', Path(__file__).parent/'encode-sdr.cjs'],
               data=json.dumps({'input': str(paths[0]), 'output': str(target), 'format': ext}).encode())
    elif ext == 'webp' and count == 2:
        native(['node', Path(__file__).parent/'webp-sequence.cjs', json.dumps({'inputs':[str(p) for p in paths], 'output':str(target)})])
    else:
        native(options+[target])
    exif = json.loads(native(['exiftool','-j','-n',target]))[0]
    facts = {'exiftool':{k:v for k,v in exif.items() if k not in ('SourceFile','FileModifyDate','FileAccessDate','FileInodeChangeDate','Directory')}, 'sha256':digest(target)}
    # Pillow uses native libjpeg for JPEG, an independent GIF reader and
    # libwebp's decoder. It also exposes fully composed WebP animation frames.
    # The 16-bit PNG diagnostic remains explicitly unqualified for independence.
    actual = []
    if ext == 'webp' and count==2:
        with Image.open(target) as image:
            facts['durations_ms'] = []
            facts['loop'] = image.info.get('loop')
            for i in range(image.n_frames):
                image.seek(i)
                actual.append(np.asarray(image.convert('RGBA')).astype(float)/255)
                facts['durations_ms'].append(image.info.get('duration'))
    elif ext != 'png':
        with Image.open(target) as image:
            actual = [np.asarray(image.convert('RGBA')).astype(float)/255]
    else:
        actual = [read_png(target)]
    signaled_srgb = (exif.get('SRGBRendering') is not None
                     or 'srgb' in str(exif.get('ProfileDescription', '')).lower()
                     or (exif.get('TransferCharacteristics') == 13 and exif.get('ColorPrimaries') == 1))
    actual_type = str(exif.get('FileType', '')).upper()
    depth_verified = (exif.get('BitDepth') == 16 if ext == 'png' else
                      exif.get('BitsPerSample') == 8 if ext == 'jpg' else
                      'WEBP' in actual_type if ext == 'webp' else actual_type == 'GIF')
    detail = {'dimensions':all(a.shape == r.shape for a,r in zip(actual,refs)), 'frames':len(actual)==count,
              'color_signaling': signaled_srgb if transfer=='srgb' else exif.get('TransferCharacteristics')==TRANSFERS[transfer],
              'gamut': signaled_srgb if gamut=='srgb' else exif.get('ColorPrimaries')==PRIMARIES[gamut],
              'alpha': all(np.max(np.abs(a[...,3]-r[...,3]))<=2/255 for a,r in zip(actual,refs)) if ext not in ('jpg','gif') else all(np.array_equal(a[...,3], np.ones_like(r[...,3]) if ext=='jpg' else (r[...,3]>=.5)) for a,r in zip(actual,refs)),
              'depth': depth_verified,
              'timing': facts.get('durations_ms')==[300,700] if count==2 else True,
              'loop': facts.get('loop')==3 if count==2 else True}
    return facts,actual,detail
