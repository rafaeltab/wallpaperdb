"""Two real RGB8 gain-map JPEG representations of one opaque PQ8/P3 AVIF.

The fixed native1000-nit Mobius grade supplies the SDR base. Native zimg
changes its coding to P3/gamma3.2, with either no dither or ordered dither;
neither choice changes the grade. Native gain computation uses the actual
compressed base and the source's exact native AOM samples. Independent dav1d,
libpng, ICC/ISO parsing and JPEG pixels supply the references and measurements.

The source's unchanged avif-8 HDR gates and separate sdr-8/tone gates apply.
Ordered dither can preserve more median highlight levels but increases color
error; every encoded base must pass the tone gate. No photographic allowance
or other source/depth/alpha/geometry claim follows from this bounded proof.
"""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

import avif
import dct_jpeg
import gainmap
import gainmap_sdr
import hdr_png
import icc_gainmap
from appearance import (RGB_TO_XYZ, THRESHOLDS, THRESHOLDS_SHA256, compare_appearance,
                        evaluate_sdr_tone_map, sdr_signal_to_nits)
from gainmap_avif_hdr_jpeg import _layer_structure
from gainmap_metadata import check_metadata
from gamma_icc import decode_signal_to_nits, make_profile, profile_facts
from sdr_reference import reference_srgb

FIXTURE_ID = 'avif-pq-p3-8-opaque'
SELECTORS = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': '8',
             'motion': 'preserve', 'transparency': 'preserve'}
LOCK = Path(__file__).with_name('fixtures')/'generated-sha256.json'
POLICY = {
    'scope': 'Only opaque static PQ8/P3 identity96x64, explicit RGB8 base/map JPEG, full display boost16',
    'hdr_profile': 'avif-8', 'sdr_profile': 'sdr-8',
    'source_reference': 'Original independent dav1d samples and PQ equations; source quantization versus analytic fixture is separate',
    'sdr_reference': 'Existing independent1000-nit Mobius exposure/knee/gamut reference, matched identity geometry',
    'native_recipe': 'Actual AOM source samples, unchanged native Mobius SDR, native P3 gamma3.2 coding, '
        'FLOAT RGB JPEG base, midpointoffset1/16384 gamma1.5 FLOAT RGB gain map',
    'dither_rationale': 'No-dither is retained. Native ordered dither tests whether RGB8 quantization preserves '
        'median highlight levels without changing the SDR grade, reference or appearance gates',
    'gamma_precision': 'Native float gamma and RGB8 quantization must remain within1.01 codes of the '
        'analytic coding of the actual native float input: one code for ordered quantization plus0.01 for float evaluation',
    'tone_display': 'Nominal100-nit sRGB display, explicit relative-colorimetric channel clipping only for '
        'tone probes. SDR color appearance compares the unclipped actual ICC colors',
    'adaptation': 'No intermediate gain-map adaptation oracle is asserted for this original static PQ source',
    'thresholds_sha256': THRESHOLDS_SHA256}
DEPENDENCIES = ('static_avif_hdr_jpeg.py', 'test_static_avif_hdr_jpeg.py', 'avif.py', 'appearance.py',
    'thresholds.json', 'sdr_candidate.py', 'sdr_reference.py', 'hdr_png.py', 'gainmap.py',
    'gainmap_sdr.py', 'gainmap_iso.py', 'gainmap_metadata.py', 'gainmap_avif_hdr_jpeg.py',
    'gamma_icc.py', 'icc_gainmap.py', 'dct_jpeg.py', 'native_icc_gainmap.cpp', 'native_dct_jpeg.c',
    'fixtures/generated-sha256.json')
NATIVE_PATHS = ('/usr/bin/ffmpeg', '/usr/local/bin/avifdec', '/usr/local/bin/avifenc',
    '/usr/local/bin/hdr-proof-png-decode', '/usr/local/bin/hdr-proof-dct-jpeg',
    '/opt/proof/icc-gainmap/hdr-proof-icc-gainmap',
    '/opt/proof/icc-gainmap/midpointoffset-gamma15/hdr-proof-icc-gainmap',
    '/opt/proof/ultrahdr/precise/hdr-proof-uhdr', '/usr/lib/liblcms2.so.2', '/bin/dd')


def source_decision(source):
    actual = avif.digest(source)
    expected = json.loads(LOCK.read_text())['sha256'][FIXTURE_ID]
    admitted = actual == expected
    return {'delivery': 'proof-source-inspection' if admitted else 'original-only',
        'metadata_state': 'inspect-actual-bytes' if admitted else 'pending',
        'original_sha256': actual, 'expected_sha256': expected}


def _check_bindings(bindings):
    for path, expected in bindings.items():
        if avif.digest(path) != expected:
            raise ValueError(f'Native proof integrity changed: {path}')


def inspect_hdr_intent(path):
    facts = hdr_png.inspect_source(path)
    pixels = avif.read_png(path)
    if (tuple(facts[key] for key in ('width', 'height', 'depth', 'primaries', 'transfer', 'matrix', 'orientation'))
            != (96, 64, 16, 12, 16, 0, 1) or pixels.shape != (64, 96, 4)
            or not np.all(pixels[..., 3] == 1)):
        raise ValueError('Native HDR intent must be identity opaque96x64 RGB16 P3 PQ')
    return facts, pixels


def inspect_output(path, directory):
    path, directory = Path(path), Path(directory)
    facts = gainmap.inspect(path, directory)
    if (not facts.get('gain_map_present') or not facts.get('iso_metadata')
            or not facts.get('android_xmp_properties') or facts['private_tags']
            or facts['frame_count'] != 1 or not facts['opaque']):
        raise ValueError('Expected private-metadata-free static opaque dual-metadata HDR JPEG')
    data, map_data = path.read_bytes(), (directory/'map.jpg').read_bytes()
    tags = facts['metadata']
    base_size, map_size = tags.get('MPImage1:MPImageLength'), tags.get('MPImage2:MPImageLength')
    if (type(base_size) is not int or type(map_size) is not int or min(base_size, map_size) <= 0
            or base_size+map_size != len(data) or map_size != len(map_data) or data[base_size:] != map_data
            or tags.get('MPF0:NumberOfImages') != 2 or tags.get('MPImage1:MPImageStart') != 0
            or tags.get('MPImage2:MPImageStart') != base_size
            or tags.get('XMP-GContainer:DirectoryItemSemantic') != ['Primary', 'GainMap']
            or tags.get('XMP-GContainer:DirectoryItemMime') != ['image/jpeg']*2
            or tags.get('XMP-GContainer:DirectoryItemLength') != map_size):
        raise ValueError('Expected exactly two declared JPEG layers without trailing payload')
    facts['layer_structure'] = {'base': _layer_structure(data[:base_size], (96, 64)),
                               'map': _layer_structure(map_data, (96, 64))}
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
    decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=3.2, expected_gamut='p3')
    with Image.open(directory/'map.jpg') as image:
        if image.info.get('icc_profile'):
            raise ValueError('Gain samples cannot carry a display ICC')
    facts['actual_base_icc'] = profile_facts(profile)
    probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', path]))
    agreement = check_metadata(facts, probe)
    channels = facts['iso_metadata']['channels']
    if (not all(agreement['checks'].values()) or len(channels) != 3 or probe['gamma'] != [1.5]*3
            or any(channel['gamma'] != 1.5 or channel[field] != 1/16384
                   for channel in channels for field in ('base_offset', 'alternate_offset'))
            or probe['hdr_capacity_min'] != 1 or not 1 < probe['hdr_capacity_max'] <= 16
            or not 0 < facts['iso_metadata']['alternate_headroom'] <= 4):
        raise ValueError('Emitted ISO/XMP/native metadata do not establish the declared recipe and full endpoint')
    facts['metadata_agreement'], facts['native_metadata_probe'] = agreement, probe
    facts['inspected_map_sha256'] = hashlib.sha256(map_data).hexdigest()
    return facts


def _prepare(source, root, spec, analytic, source_hash):
    facts = avif.inspect_avif(source)
    (root/'source-decoded').mkdir(parents=True, exist_ok=True)
    decoded = avif.decode_avif(source, root/'source-decoded', 1)[0]
    reference = decoded.copy()
    reference[..., :3] = avif.decode_transfer(decoded[..., :3], 'pq', 'p3')
    source_measure = compare_appearance(analytic[..., :3], reference[..., :3],
        reference_gamut='p3', actual_gamut='p3', fixture_class='avif-8')
    source_structure = avif.structure_checks(facts, [decoded], spec, [analytic], 'pq', 'p3', 8, 1)
    if not source_measure['passed'] or not all(source_structure.values()):
        raise ValueError('Independent source facts or analytic source quantization failed; original-only')
    aom, tone_path, hdr = root/'source-aom.png', root/'native-sdr.png', root/'native-hdr-intent.png'
    avif.native(['avifdec', '-j', '1', '-c', 'aom', '-d', '16', source, aom])
    aom_hash = avif.digest(aom)
    aom_exact = bool(np.array_equal(avif.read_png(aom), decoded))
    if not aom_exact:
        raise ValueError('Native AOM samples differ from independent dav1d')
    tone = avif.sdr_tone_control(aom, tone_path, reference, analytic, 'pq', 'p3', peak_nits=1000)
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', aom, '-vf',
        'format=rgb48le,setparams=color_primaries=12:color_trc=16:colorspace=0:range=full,setsar=1',
        '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', hdr])
    hdr_hash = avif.digest(hdr)
    hdr_facts, hdr_pixels = inspect_hdr_intent(hdr)
    hdr_exact = bool(np.array_equal(hdr_pixels, decoded))
    if not hdr_exact:
        raise ValueError('Native HDR intent changed actual source samples')
    reference_hdr, reference_sdr = root/'reference-hdr.npy', root/'reference-sdr.npy'
    expected_sdr = reference_srgb(reference[..., :3], 'p3', peak_nits=1000)
    np.save(reference_hdr, reference[..., :3], allow_pickle=False)
    np.save(reference_sdr, expected_sdr, allow_pickle=False)
    display_reference = root/'reference-sdr.png'
    reference_profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    reference_profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    reference_profile[84:100] = bytes(16)
    Image.fromarray(np.rint(expected_sdr*255).astype('uint8')).save(display_reference, icc_profile=bytes(reference_profile))
    files = (aom, tone_path, hdr, reference_hdr, reference_sdr, display_reference, LOCK)
    bindings = {str(path): avif.digest(path) for path in files}
    bindings.update({str(aom): aom_hash, str(hdr): hdr_hash})
    bindings[str(source)] = source_hash
    return {'source_facts': facts, 'source_measurement': source_measure, 'source_structure': source_structure,
        'tone': tone, 'aom_dav1d_samples_exact': aom_exact, 'hdr_intent_samples_exact': hdr_exact,
        'hdr_intent': {'path': str(hdr), 'sha256': hdr_hash, 'facts': hdr_facts},
        'reference_hdr': {'path': str(reference_hdr), 'sha256': avif.digest(reference_hdr), 'dimensions': [96, 64]},
        'reference_sdr': {'path': str(display_reference), 'sha256': avif.digest(display_reference), 'dimensions': [96, 64],
            'role': 'Independent reference-only8-bit sRGB view; quantitative gate uses full float64 signal array',
            'quantitative_array': {'path': str(reference_sdr), 'sha256': avif.digest(reference_sdr)}},
        'bound_files': bindings}, reference[..., :3], expected_sdr


def _base(tone_path, root, dither):
    rgba, rgb, coded = root/'sdr-p3-linear.gbrapf32', root/'sdr-p3-linear.gbrpf32', root/'base-gamma32.png'
    filters = ('format=gbrap16le,setparams=alpha_mode=premultiplied,'
        'zscale=agamma=0:transferin=13:transfer=linear:primariesin=1:primaries=12:matrixin=0:matrix=0:'
        'rangein=full:range=full:npl=100,format=gbrapf32le:alpha_modes=premultiplied')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', tone_path, '-vf', filters,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le', rgba])
    bindings = {str(rgba): avif.digest(rgba)}
    plane = 96*64*4
    raw = rgba.read_bytes()
    if len(raw) != 4*plane or not np.all(np.frombuffer(raw[3*plane:], '<u4') == 0x3f800000):
        raise ValueError('Native SDR float alpha is not exactly opaque')
    avif.native(['dd', f'if={rgba}', f'of={rgb}', f'bs={plane}', 'count=3', 'status=none'])
    bindings[str(rgb)] = avif.digest(rgb)
    if rgb.read_bytes() != raw[:3*plane]:
        raise ValueError('Native opaque plane removal changed RGB samples')
    curve = 'geq='+':'.join(f"{c}='pow(max({c}(X,Y),0),1/3.2)'" for c in 'rgb')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', '96x64', '-i', rgb,
        '-vf', curve+f',zscale=rangein=full:range=full:dither={dither},format=gbrp,format=rgb24',
        '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', coded])
    bindings[str(coded)] = avif.digest(coded)
    native_linear = np.frombuffer(rgb.read_bytes(), '<f4').reshape(3, 64, 96)[[2, 0, 1]].transpose(1, 2, 0)
    with Image.open(coded) as image:
        codes = np.asarray(image).astype(float)
    expected = 255*np.clip(np.maximum(native_linear.astype(float), 0)**(1/3.2), 0, 1)
    error = float(np.max(abs(codes-expected)))
    if error > 1.01:
        raise ValueError('Native gamma coding exceeded the predeclared RGB8 quantization bound')
    base = root/'base.jpg'
    encoding = dct_jpeg.encode(coded, base, icc_profile=make_profile(gamma=3.2, gamut='p3'), method='float')
    bindings[str(base)] = avif.digest(base)
    _check_bindings(bindings)
    return base, {'opaque_float_plane_copy_exact': True, 'gamma_code_maximum_error': error,
        'gamma_code_error_limit': 1.01, 'encoding': encoding,
        'bound_files': bindings}


def _tone(reference, actual_sdr, expected, analytic):
    linear = actual_sdr@RGB_TO_XYZ['rec2020'].T@np.linalg.inv(RGB_TO_XYZ['srgb']).T/100
    signal = np.where(linear <= .0031308, 12.92*linear, 1.055*np.maximum(linear, 0)**(1/2.4)-.055)
    clipped = np.clip(signal, 0, 1)
    white = np.all(np.isclose(analytic[..., :3], 203, atol=1e-6, rtol=0), axis=-1)
    neutral = np.ptp(reference, axis=-1) <= np.maximum(.01, np.mean(reference, axis=-1)*.005)
    y = reference@RGB_TO_XYZ['p3'][1]
    levels, inverse = np.unique(np.round(y[neutral], 6), return_inverse=True)
    curves = [np.array([np.median(np.mean(value[neutral], axis=-1)[inverse == i])
                       for i in range(len(levels))]) for value in (signal, clipped)]
    limits = THRESHOLDS['tone_map']
    curve_checks = []
    curve_measurements = []
    for value, curve in zip((signal, clipped), curves):
        highlights = curve[levels > 205]
        white_level = float(np.median(np.mean(value[white], axis=-1)))
        checks = {'monotonic': bool(np.min(np.diff(curve)) >= -limits['highlight_monotonic_tolerance']),
            'headroom': bool(highlights[-1]-white_level >= limits['highlight_headroom_min']),
            'continuity': bool(np.max(np.diff(highlights)) <= limits['highlight_signal_step_max']),
            'early_clipping': bool(not np.any(highlights[:-1] >= limits['early_clip_signal'])),
            'flattening': bool(np.count_nonzero(np.diff(highlights) > .25/255) >= .5*(len(highlights)-1))}
        curve_checks.append(checks)
        curve_measurements.append({'highlight_levels': len(highlights),
            'resolved_highlight_steps': int(np.count_nonzero(np.diff(highlights) > .25/255)),
            'ordinary_white_signal': white_level, 'maximum_signal': float(curve.max()),
            'maximum_highlight_step': float(np.max(np.diff(highlights))), 'checks': checks})
    masks = {'neutral': neutral, 'ordinary_white': white, 'shadow': neutral & (y > 0) & (y <= 10),
             'midtone': neutral & (y > 10) & (y <= 100), 'highlight': neutral & (y > 205)}
    clipping = {name: {'affected_pixels': int(np.count_nonzero(np.any(signal[mask] != clipped[mask], axis=-1))),
        'maximum_signal_change': float(np.max(abs(signal[mask]-clipped[mask]), initial=0))} for name, mask in masks.items()}
    gate = evaluate_sdr_tone_map(reference, clipped, source_gamut='p3',
        probe_masks={'ordinary_white': white}, reference_srgb=expected)
    clipping_safe = (curve_checks[0] == curve_checks[1]
        and not any(clipping[name]['affected_pixels'] for name in ('ordinary_white', 'shadow', 'midtone')))
    return gate, {'scope': POLICY['tone_display'], 'linear_minimum': float(linear.min()),
        'linear_maximum': float(linear.max()), 'negative_components': int(np.count_nonzero(linear < 0)),
        'above_one_components': int(np.count_nonzero(linear > 1)), 'probe_clipping': clipping,
        'unclipped_neutral_curve': curve_measurements[0], 'clipped_neutral_curve': curve_measurements[1],
        'clipping_does_not_hide_tone_failure': clipping_safe,
        'initial_domain_diagnostic': 'Unclipped actual ICC-to-sRGB signals outside[0,1] cannot enter the SDR signal-domain tone API; '
            'they remain the actual colors used by the separate SDR appearance comparison'}


def _case(source, root, dither, preparation, reference, expected_sdr, analytic):
    root.mkdir(parents=True, exist_ok=True)
    case = {'case_id': f'{FIXTURE_ID}:hdr:jpg:preserve:preserve:identity:icc-gamma32-{dither}',
        'cell_id': 'static-avif:hdr:jpg', 'fixture_id': FIXTURE_ID, 'proof_module': 'static_avif_hdr_jpeg',
        'candidate': f'native-icc-gamma32-{dither}', 'geometry': 'identity', 'selectors': SELECTORS.copy(),
        'status': 'tested and failed', 'source_sha256': preparation['bound_files'][str(source)],
        'source_facts': preparation['source_facts'], 'threshold_scope': POLICY,
        'qualification_scope': 'ICC-aware file readers, full display boost16 only, fixed PQ8/P3 opaque identity source; physical consumers pending',
        'consumer_status': 'pending manual review', 'known_consumer_limitations': [
            'Stock readers that assume sRGB instead of actual gamma3.2 ICC are measured separately.',
            'No intermediate adaptation oracle or physical browser/wallpaper qualification.'],
        'rendering_scope': {'display_boost': 16, 'intermediate_adaptation_qualified': False},
        'checks': {name: False for name in ('source', 'native_encoder', 'independent_decoder', 'structure',
            'privacy', 'native_precision', 'appearance', 'encoded_sdr_tone', 'full_headroom', 'integrity')},
        'measurements': {}, 'artifacts': {}, 'blockers': [], 'bound_files': dict(preparation['bound_files'])}
    try:
        _check_bindings(case['bound_files'])
        base, base_evidence = _base(Path(preparation['hdr_intent']['path']).with_name('native-sdr.png'), root, dither)
        case['bound_files'].update(base_evidence['bound_files'])
        output = root/'output.jpg'
        packed = icc_gainmap.pack(base, preparation['hdr_intent']['path'], output,
            map_policy='midpointoffset', map_gamma=1.5, map_method='float')
        case['checks']['native_encoder'] = True
        case['native_preparation'] = {**preparation, **base_evidence, 'packing': packed}
        case['hdr_intent'] = preparation['hdr_intent']
        case['bound_files'][packed['computed_map']] = packed['computed_map_sha256']
        case['artifacts'] = {'source': str(source), 'source_sha256': case['source_sha256'],
            'output': str(output), 'sha256': avif.digest(output)}
        case['bound_files'][str(output)] = case['artifacts']['sha256']
        facts = inspect_output(output, root/'inspection')
        _check_bindings(case['bound_files'])
        extracted = root/'inspection/map.jpg'
        case['bound_files'][str(extracted)] = facts['inspected_map_sha256']
        _check_bindings(case['bound_files'])
        native, native_facts = icc_gainmap.native_decode(output, root/'native.rgbf32', boost=16)
        _check_bindings(case['bound_files'])
        independent, independent_facts = icc_gainmap.independent_decode(output, extracted, boost=16)
        sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='p3', gamma=3.2)
        def hdr_measure(a, b):
            return compare_appearance(a, b, reference_gamut='p3', actual_gamut='p3', fixture_class='avif-8')
        measured = {'source': preparation['source_measurement'], 'native_sdr_tone': preparation['tone'],
            'sdr': compare_appearance(sdr_signal_to_nits(expected_sdr), sdr, reference_gamut='srgb',
                actual_gamut='rec2020', fixture_class='sdr-8',
                region_reference_luminance_nits=reference@RGB_TO_XYZ['p3'][1]),
            'native_hdr': hdr_measure(reference, native), 'independent_hdr': hdr_measure(reference, independent),
            'cross_decoder_hdr': hdr_measure(independent, native)}
        measured['encoded_sdr_tone'], display = _tone(reference, sdr, expected_sdr, analytic)
        case.update({'facts': facts, 'measurements': measured, 'sdr_display_mapping': display,
            'sdr_decoder_evidence': sdr_facts, 'hdr_decoder_evidence': {'native': native_facts, 'independent': independent_facts},
            'reference_hdr': preparation['reference_hdr'], 'reference_sdr': preparation['reference_sdr']})
        structure = {'dimensions': sdr.shape == native.shape == independent.shape == (64, 96, 3),
            'gamut': sdr_facts['gamut'] == native_facts['gamut'] == independent_facts['gamut'] == 'p3',
            'base_icc': sdr_facts['icc_sha256'] == facts['actual_base_icc']['sha256'],
            'layers': all(facts[layer]['sof'] == 0 and facts[layer]['depth'] == 8 for layer in ('base', 'map'))}
        case['structural_checks'] = structure
        case['checks'].update({'source': all(preparation['source_structure'].values()) and measured['source']['passed'],
            'native_precision': preparation['aom_dav1d_samples_exact'] and preparation['hdr_intent_samples_exact']
                and base_evidence['opaque_float_plane_copy_exact'],
            'independent_decoder': measured['cross_decoder_hdr']['passed'], 'structure': all(structure.values()),
            'privacy': not facts['private_tags'] and sdr_facts['privacy'],
            'appearance': all(value['passed'] for key, value in measured.items() if key != 'encoded_sdr_tone'),
            'encoded_sdr_tone': measured['encoded_sdr_tone']['passed'] and display['clipping_does_not_hide_tone_failure'],
            'full_headroom': independent_facts['gain_map_weight'] == 1})
        stock_raw = root/'stock-native.gbrpf32'
        stock_facts = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr',
            'decode-linear', output, stock_raw, '16']))
        stock = np.fromfile(stock_raw, '<f4').reshape(3, 64, 96)[[2, 0, 1]].transpose(1, 2, 0)*203
        diagnostic = compare_appearance(reference, stock, reference_gamut='p3',
            actual_gamut={0: 'srgb', 1: 'p3', 2: 'rec2020'}[stock_facts['gamut']], fixture_class='avif-8')
        case['consumer_decoder_diagnostics'] = {'stock_native_srgb': {
            'status': 'qualified' if diagnostic['passed'] else 'tested and failed', 'measurement': diagnostic,
            'facts': stock_facts, 'scope': 'Separate sRGB-assuming native file reader at boost16; no physical consumer claim'}}
        case['known_consumer_limitations'].append('stock_native_srgb file diagnostic: '+
            case['consumer_decoder_diagnostics']['stock_native_srgb']['status']+'.')
        case['bound_files'].update({str(path): avif.digest(path) for path in (root/'native.rgbf32', stock_raw)})
        _check_bindings(case['bound_files'])
        case['checks']['integrity'] = True
        case['blockers'] = [f'Failed {name} check' for name, value in case['checks'].items() if not value]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def run(directory, *, source=None, selectors=None, dithers=('none', 'ordered')):
    if selectors is not None and selectors != SELECTORS:
        raise ValueError('Only the exact opaque PQ8/P3 identity HDR JPEG selectors are admitted')
    dithers = tuple(dithers)
    if not dithers or len(set(dithers)) != len(dithers) or any(value not in ('none', 'ordered') for value in dithers):
        raise ValueError('Expected distinct native none/ordered dither candidates')
    if source is not None and source_decision(source)['delivery'] == 'original-only':
        raise ValueError('Unknown source bytes or facts remain original-only with metadata pending')
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    source_hashes = {name: avif.digest(Path(__file__).with_name(name) if '/' not in name else Path(__file__).parent/name)
                     for name in DEPENDENCIES}
    native_hashes = {path: avif.digest(path) for path in NATIVE_PATHS}
    start = len(avif.COMMANDS)
    spec = next(value for value in avif.fixture_specs() if value['id'] == FIXTURE_ID)
    analytic = avif.make_scene(False)
    if source is None:
        source, _, frames = avif.generate_fixture(spec, root/'source')
        analytic = frames[0]
    source = Path(source)
    decision = source_decision(source)
    if decision['delivery'] == 'original-only':
        raise ValueError('Generated source hash changed; keep original-only before conversion')
    preparation, reference, expected_sdr = _prepare(source, root, spec, analytic, decision['original_sha256'])
    cases = [_case(source, root/dither, dither, preparation, reference, expected_sdr, analytic) for dither in dithers]
    fixture = {'id': FIXTURE_ID, 'path': str(source), 'sha256': decision['original_sha256'], 'spec': spec,
        'facts': preparation['source_facts'], 'structural_checks': preparation['source_structure'],
        'analytic_measurements': [preparation['source_measurement']], 'source_valid': True}
    for name, expected in source_hashes.items():
        if avif.digest(Path(__file__).parent/name) != expected:
            raise ValueError('Proof source changed during the native run')
    _check_bindings(native_hashes)
    logs = [{'path': str(path), 'sha256': avif.digest(path)} for path in sorted(root.rglob('*.log'))]
    report = {'schema_version': 1, 'cases': cases, 'source_fixtures': [fixture], 'fixtures': [], 'controls': [],
        'scope': POLICY, 'source_hashes': source_hashes, 'commands': avif.COMMANDS[start:],
        'native_binary_sha256': native_hashes, 'native_log_artifacts': logs,
        'consumer_status': 'pending manual review'}
    (root/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
