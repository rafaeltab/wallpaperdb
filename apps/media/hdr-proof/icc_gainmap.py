"""Separate gamma3.2 ICC-aware native gain-map experiment.

The compressed base keeps its authored SDR appearance in a declared matrix
ICC encoding. Native LCMS performs color interpretation; native libavif
computes gains; native libultrahdr packs and applies gains. Independent JPEG
samples, ICC parsing and ISO equations measure the emitted file. Stock-reader
diagnostics remain separate failures and physical consumers remain pending.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_sdr
from gamma_icc import profile_facts
from gainmap_iso import iso_metadata, jpeg_facts, segments

TOOL = '/opt/proof/icc-gainmap/hdr-proof-icc-gainmap'


def _encoder(map_policy, map_gamma, map_method='float'):
    if map_policy not in ('moderateoffset', 'smalloffset', 'midpointoffset'):
        raise ValueError('Only the three predeclared native offset policies are supported')
    if (type(map_gamma) not in (int, float) or map_gamma not in (1, 2)
            or map_gamma == 2 and map_policy == 'moderateoffset'
            or map_policy == 'midpointoffset' and map_gamma != 2):
        raise ValueError('Only the declared gamma1 and separate smalloffset/midpointoffset gamma2 candidates are supported')
    if (map_method not in ('float', 'islow') or map_method == 'islow'
            and (map_policy != 'midpointoffset' or map_gamma != 2)):
        raise ValueError('The separate ISLOW map candidate requires midpointoffset and gamma2')
    variant = f'{map_policy}-gamma2' if map_gamma == 2 else 'smalloffset'
    return TOOL if map_policy == 'moderateoffset' else str(Path(TOOL).parent/variant/Path(TOOL).name)


def pack(base, hdr_intent, output, *, map_policy='moderateoffset', map_gamma=1, map_method='float'):
    """Regenerate a native RGB8 map against the actual compressed ICC base."""
    from dct_jpeg import encode
    tool = _encoder(map_policy, map_gamma, map_method)
    output = Path(output)
    folder = output.with_name(output.stem+'-icc-parts')
    folder.mkdir(parents=True, exist_ok=True)
    combined, png, jpg = folder/'combined.avif', folder/'map.png', folder/'map.jpg'
    facts = json.loads(avif.native([tool, 'compute', base, hdr_intent, combined]))
    avif.native(['avifgainmaputil', 'extractgainmap', combined, png])
    map_encoding = encode(png, jpg, method=map_method)
    mode = 'pack-gamma2-midpoint' if map_policy == 'midpointoffset' else 'pack-gamma2'
    packer = ([tool, mode] if map_gamma == 2 else
              ['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'pack-avif'])
    avif.native([*packer, combined, base, jpg, output])
    return {'native_icc': facts, 'map_encoding': map_encoding,
            'base': str(base), 'base_sha256': avif.digest(base), 'hdr_intent': str(hdr_intent),
            'hdr_intent_sha256': avif.digest(hdr_intent), 'output_sha256': avif.digest(output),
            'computed_map': str(png), 'computed_map_sha256': avif.digest(png),
            'native_encoder_sha256': avif.digest(tool), 'map_policy': map_policy, 'map_method': map_method,
            'map_gamma': map_gamma, 'native_packer_sha256': avif.digest(packer[0]),
            'coded_base_depth': 8, 'coded_map_depth': 8,
            'working_precision': 'Native LCMS float32 base linearization; native gain equations',
            'consumer_status': 'pending manual review'}


def independent_decode(path, map_path, *, boost=16):
    """Read actual ICC and ISO fields independently; FFmpeg supplies JPEG pixels."""
    if not np.isfinite(boost) or boost < 1:
        raise ValueError('Display boost must be finite and at least one')
    path, map_path = Path(path), Path(map_path)
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
        if image.getexif().get(274, 1) != 1:
            raise ValueError('ICC candidate requires identity stored orientation')
    color = profile_facts(profile)
    if color['gamut'] not in ('srgb', 'p3') or not np.allclose(color['gammas'], [3.2]*3, atol=1/65536, rtol=0):
        raise ValueError('ICC candidate requires established gamma3.2 matrix color facts')
    base_signal, base_facts = gainmap_sdr.decode(path, gamut=color['gamut'], gamma=3.2)
    if base_facts['sof'] != 0:
        raise ValueError('ICC candidate requires a baseline JPEG base')
    metadata = iso_metadata(map_path.read_bytes())
    facts = jpeg_facts(map_path.read_bytes())
    if (facts['sof'] != 0 or facts['depth'] != 8 or facts['components'] != 3 or
        [facts['width'], facts['height']] != [base_facts['width'], base_facts['height']]):
        raise ValueError('ICC candidate requires equal-size baseline RGB8 base and map')
    with Image.open(map_path) as image:
        if image.getexif().get(274, 1) != 1 or image.info.get('icc_profile'):
            raise ValueError('Gain samples must have identity orientation and no display ICC')
    if not any(marker == 0xC0 and value[6::3] == b'RGB' and value[7::3] == b'\x11'*3
               for marker, value in segments(map_path.read_bytes())):
        raise ValueError('Gain-map RGB coding is not independently signaled')
    if (metadata['backward'] or not metadata['use_base_colour_space'] or metadata['base_headroom'] != 0
            or metadata['alternate_headroom'] <= 0):
        raise ValueError('Only forward SDR-base ISO metadata is supported')
    gain = np.frombuffer(avif.native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', map_path,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']), np.uint8).reshape(base_signal.shape)/255
    linear = base_signal ** np.asarray(color['gammas'])
    weight = float(np.clip(np.log2(boost)/metadata['alternate_headroom'], 0, 1))
    if weight:
        channels = metadata['channels']*(3 if len(metadata['channels']) == 1 else 1)
        for channel, parameters in enumerate(channels):
            logarithm = parameters['minimum'] + gain[..., channel]**(1/parameters['gamma'])*(
                parameters['maximum']-parameters['minimum'])
            linear[..., channel] = (linear[..., channel]+parameters['base_offset'])*2**(logarithm*weight)-parameters['alternate_offset']
    return np.maximum(linear, 0)*203, {'gamut': color['gamut'], 'icc': color, 'iso_metadata': metadata,
        'base': base_facts, 'map': facts, 'display_boost': boost, 'gain_map_weight': weight,
        'decoder': 'FFmpeg MJPEG plus independent matrix ICC/ISO parsing and gain equations'}


def native_decode(path, output, *, boost=16):
    facts = json.loads(avif.native([TOOL, 'decode', path, output, str(boost)]))
    values = np.fromfile(output, '<f4').reshape(facts['height'], facts['width'], 3).astype(float)*203
    return values, facts


def run(directory, *, map_policy='moderateoffset', map_gamma=1, map_method='float'):
    """Bounded first experiment: the pinned ISO gain-map JPEG upscale only."""
    import gainmap_combine
    import gainmap_hdr
    from gainmap_metadata import check_metadata
    from gainmap_reference import reference
    from appearance import compare_appearance, sdr_signal_to_nits, delta_e_itp
    from matrix import GAINMAP_GEOMETRIES
    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True)
    _encoder(map_policy, map_gamma, map_method)
    start = len(avif.COMMANDS)
    name, operation, gamut = 'gainmap-android-iso', 'upscale', 'p3'
    source = gainmap.FIXTURES/f'{name}.jpg'
    fixture = next(f for f in json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures'] if f['id'] == name)
    if avif.digest(source) != fixture['sha256']:
        raise ValueError('Pinned ISO source fixture hash changed')
    revision = 'gainmap-hdr-target-gamut-v1'
    candidate = f'native-combine-icc-gamma32-{map_policy}-dct-{map_method}-map-source-float32'
    if map_gamma != 1:
        candidate += f'-map-gamma{map_gamma:g}'
    case = {'case_id': f'{name}:hdr:jpg:preserve:preserve:{operation}:{candidate}:{revision}',
        'fixture_id': name, 'source_sha256': fixture['sha256'], 'cell_id': 'gainmap-jpeg:hdr:jpg',
        'candidate': candidate, 'geometry': operation, 'source_reference_revision': revision,
        'selectors': {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
            'motion': 'preserve', 'transparency': 'preserve', **GAINMAP_GEOMETRIES[operation]},
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': 'Experimental native ICC-aware file path only; stock native HDR readers '
            'assume sRGB or reject ICC, and physical consumers have not been qualified',
        'known_consumer_limitations': ['Pinned libultrahdr assumes sRGB base transfer. '
            'Pinned libavif rejects ICC gain computation/application. These gamma3.2 files need ICC-aware gain application.'],
        'checks': {key: False for key in ('native_encoder', 'independent_source_decoder', 'native_source_precision',
            'native_geometry', 'hdr_intent', 'independent_decoder', 'structure', 'appearance', 'privacy')},
        'measurements': {}, 'artifacts': {}, 'blockers': []}
    try:
        source_facts = gainmap.inspect(source, folder/'source-inspection')
        hdr_source, source_gamut, decoder = gainmap.source_hdr(source, folder/'source-inspection', gamut)
        case['checks']['independent_source_decoder'] = True
        case['source_facts'], case['source_decoder_evidence'] = source_facts, decoder
        hdr_reference, ref_facts = reference(hdr_source, source_gamut, gamut, operation, 1)
        case['reference_method'] = ref_facts
        sdr_reference = gainmap.geometry(gainmap.source_image(source, 'preserve'), operation, 1)
        profile = sdr_reference.info.get('icc_profile')
        sdr_reference.info.clear()
        ref_png = folder/'reference-sdr.png'
        sdr_reference.save(ref_png, icc_profile=profile)
        case['reference_sdr'] = {'path': str(ref_png), 'sha256': avif.digest(ref_png), 'gamut': gamut,
            'transfer': 'srgb', 'purpose': 'Independent matched-geometry authored SDR base'}
        # Reuse the unchanged pinned native source/geometry stage. Its old
        # JPEG is a recorded preparation artifact and cannot qualify this one.
        preparation = gainmap_combine.encode(source, folder/'preparation.jpg', operation, gamut=gamut,
            map_policy='moderateoffset', geometry_revision=revision, source_precision='float32')
        base, output = folder/'gamma32-base.jpg', folder/'output.jpg'
        base_encoding = gainmap_sdr.encode(source, base, operation, gamut=gamut, gamma=3.2)
        case['native_candidate'] = pack(base, preparation['hdr_intent_pq_png'], output,
            map_policy=map_policy, map_gamma=map_gamma, map_method=map_method)
        case['native_candidate'].update({'base_encoding': base_encoding, 'source_preparation': preparation})
        case['checks']['native_encoder'] = True
        native_source = preparation['hdr_source']
        values = np.fromfile(native_source['path'], '<f4').reshape(3, native_source['height'], native_source['width'])
        values = values[[2, 0, 1]].transpose(1, 2, 0)*native_source['normalization_nits']
        source_measure = compare_appearance(hdr_source, values, reference_gamut=source_gamut,
            actual_gamut=gamut, fixture_class='gainmap-hdr')
        geometry_measure = compare_appearance(hdr_reference, gainmap_hdr.read_linear(preparation['hdr_geometry']),
            reference_gamut=gamut, actual_gamut=gamut, fixture_class='gainmap-hdr')
        case['checks']['native_source_precision'] = source_measure['passed']
        case['checks']['native_geometry'] = geometry_measure['passed']
        intent = Path(preparation['hdr_intent_pq_png'])
        intent_facts = gainmap.inspect(intent, folder/'intent-inspection')
        intent_signal = avif.read_png(intent)
        intent_measure = compare_appearance(hdr_reference, avif.decode_transfer(intent_signal[..., :3], 'pq', gamut),
            reference_gamut=gamut, actual_gamut=gamut, fixture_class='gainmap-hdr')
        intent_cicp = [intent_facts['metadata'].get('PNG-cICP:'+field) for field in
            ('ColorPrimaries', 'TransferCharacteristics', 'MatrixCoefficients', 'VideoFullRangeFlag')]
        case['hdr_intent'] = {'path': str(intent), 'sha256': avif.digest(intent), 'facts': intent_facts,
            'purpose': 'Inspected native HDR intent comparison; not an independent reference'}
        case['checks']['hdr_intent'] = (intent_measure['passed'] and intent_cicp == [12,16,0,1]
            and intent_facts['coded_depth'] == 16 and intent_facts['frame_count'] == 1 and intent_facts['opaque']
            and not intent_facts['private_tags'] and intent_signal.shape[:2] == hdr_reference.shape[:2])
        facts = gainmap.inspect(output, folder/'inspection')
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut=gamut, gamma=3.2)
        sdr_measure = compare_appearance(sdr_signal_to_nits(np.asarray(sdr_reference)/255), actual_sdr,
            reference_gamut=gamut, actual_gamut='rec2020', fixture_class='gainmap-sdr')
        actual_hdr, native_facts = native_decode(output, folder/'native.rgbf32')
        independent, independent_facts = independent_decode(output, folder/'inspection/map.jpg')
        cross = compare_appearance(independent, actual_hdr, reference_gamut=gamut,
            actual_gamut=gamut, fixture_class='gainmap-hdr')
        hdr_measure = compare_appearance(hdr_reference, actual_hdr, reference_gamut=gamut,
            actual_gamut=gamut, fixture_class='gainmap-hdr')
        independent_measure = compare_appearance(hdr_reference, independent, reference_gamut=gamut,
            actual_gamut=gamut, fixture_class='gainmap-hdr')
        probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
        agreement = check_metadata(facts, probe)
        case['gain_map_metadata_agreement'] = agreement
        case['native_metadata_probe'] = probe
        case['structural_checks'] = {'dimensions': actual_hdr.shape == hdr_reference.shape == actual_sdr.shape,
            'baseline_depths': all(facts[layer]['sof'] == 0 and facts[layer]['depth'] == 8 for layer in ('base','map')),
            'gamut': sdr_facts['gamut'] == native_facts['gamut'] == independent_facts['gamut'] == gamut,
            'orientation': facts['metadata'].get('IFD0:Orientation',1) == 1,
            'static_opaque': facts['frame_count'] == 1 and facts['opaque'],
            'dual_metadata': bool(facts['iso_identifier'] and facts['android_xmp_properties']),
            'metadata_agreement': all(agreement['checks'].values()),
            'requested_map_gamma': probe['gamma'] == [map_gamma]*3,
            'requested_map_offsets': all(channel[field] == {'moderateoffset': 1/4096,
                'smalloffset': 1/65536, 'midpointoffset': 1/16384}[map_policy]
                for channel in facts['iso_metadata']['channels'] for field in ('base_offset', 'alternate_offset')),
            'actual_base_icc': sdr_facts['icc_sha256'] == base_encoding['icc_sha256']}
        case['checks'].update({'independent_decoder': cross['passed'],
            'structure': all(case['structural_checks'].values()),
            'appearance': sdr_measure['passed'] and hdr_measure['passed'] and independent_measure['passed'],
            'privacy': not facts['private_tags'] and sdr_facts['privacy']})
        case['facts'], case['sdr_decoder_evidence'] = facts, sdr_facts
        case['hdr_decoder_evidence'] = {'native': native_facts, 'independent': independent_facts}
        case['measurements'] = {'native_hdr_source': source_measure, 'native_hdr_geometry': geometry_measure,
            'native_hdr_intent_png': intent_measure, 'authored_sdr_base': sdr_measure,
            'reconstructed_hdr': hdr_measure, 'independent_hdr': independent_measure,
            'independent_hdr_cross_decoder': cross}
        case['artifacts'] = {'output': str(output), 'sha256': avif.digest(output)}
        difference = delta_e_itp(independent, actual_hdr, reference_gamut=gamut, actual_gamut=gamut)
        y, x = np.unravel_index(np.argmax(difference), difference.shape)
        sample_diagnostic = {'scope': 'Worst native/independent HDR disagreement; diagnostic only',
            'pixel_xy': [int(x), int(y)], 'delta_e_itp': float(difference[y, x]),
            'independent_hdr_nits': independent[y, x].tolist(), 'native_hdr_nits': actual_hdr[y, x].tolist()}
        for layer, path in (('base', output), ('map', folder/'inspection/map.jpg')):
            raw = folder/f'diagnostic-native-{layer}.rgb8'
            avif.native([TOOL, 'jpeg-samples', path, raw])
            native_samples = np.fromfile(raw, np.uint8).reshape(actual_hdr.shape)
            independent_samples = np.frombuffer(avif.native(['ffmpeg', '-v', 'error', '-i', path,
                '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']), np.uint8).reshape(actual_hdr.shape)
            sample_diagnostic[layer] = {'native_codes': native_samples[y, x].tolist(),
                'independent_codes': independent_samples[y, x].tolist(),
                'different_channel_samples': int(np.count_nonzero(native_samples != independent_samples)),
                'native_raw_sha256': avif.digest(raw)}
        case['sample_precision_diagnostics'] = sample_diagnostic
        diagnostic = {'status': 'tested and failed', 'scope': 'Pinned sRGB-assuming native reader diagnostic; '
            'no physical consumer qualification', 'consumer_status': 'pending manual review'}
        try:
            raw = folder/'stock-native.gbrpf32'
            stock = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'decode-linear', output, raw, '16']))
            values = np.fromfile(raw, '<f4').reshape(3, stock['height'], stock['width'])[[2,0,1]].transpose(1,2,0)*203
            diagnostic['measurement'] = compare_appearance(hdr_reference, values, reference_gamut=gamut,
                actual_gamut={0:'srgb',1:'p3',2:'rec2020'}[stock['gamut']], fixture_class='gainmap-hdr')
            if diagnostic['measurement']['passed']:
                diagnostic['status'] = 'qualified'
        except Exception as error:
            diagnostic['failure'] = str(error)
        case['consumer_decoder_diagnostics'] = {'stock_native_srgb': diagnostic}
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if all(case['checks'].values()):
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    logged_commands = []
    for log in sorted(folder.rglob('*.log')):
        try:
            value = json.loads(log.read_text())
            if isinstance(value, dict) and 'command' in value:
                logged_commands.append({'log': str(log), **value})
        except (UnicodeError, json.JSONDecodeError):
            pass
    report = {'scope': 'One predeclared ISO-upscale ICC-aware native HDR candidate; unchanged appearance gates',
        'map_representation': {'policy': map_policy, 'encoding_gamma': map_gamma, 'coded_depth': 8,
            'encoding': f'Native pow(normalized log gain, gamma), rounded to RGB8; native {map_method} DCT JPEG',
            'map_dct_method': map_method,
            'decoding': 'Actual emitted map code raised to reciprocal gamma before affine log-gain recovery',
            'gamma2_rationale': 'Smalloffset gamma1 measured highlight median normalized log gain 0.590619. '
                'Local quantization sensitivity is log-gain interval/(gamma*u**(gamma-1)); '
                'gamma2 is the single predeclared option near the local optimum 1.90, without pixel prebias.',
            'midpoint_rationale': 'The single 1/16384 offset is the logarithmic midpoint of retained '
                '1/4096 and 1/65536 candidates. It tests a narrower log-gain quantization interval '
                'while limiting near-black offset amplification. All previous candidates and gates remain unchanged.',
            'islow_rationale': 'The retained midpoint gamma2 float-DCT map has 17 reference pixels above '
                '8 deltaE, versus zero before JPEG coding; its worst cross-reader error has equal base '
                'samples and a one-code map difference. One ISLOW map trial changes only native DCT coding.',
            'upstream_sources': [
                'https://raw.githubusercontent.com/AOMediaCodec/libavif/v1.4.1/src/gainmap.c',
                'https://raw.githubusercontent.com/google/libultrahdr/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/gainmapmath.cpp']},
        'cases': [case], 'commands': avif.COMMANDS[start:], 'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json')),
        'gainmap_commands': logged_commands,
        'source_hashes': {name: avif.digest(Path(__file__).with_name(name)) for name in
            ('icc_gainmap.py', 'native_icc_gainmap.cpp', 'icc-gainmap-build.sh', 'libavif-icc-linear-base.patch',
             'libavif-gamma2-gain.patch', 'libavif-midpoint-offset-gain.patch', 'dct_jpeg.py', 'native_dct_jpeg.c')},
        'native_hashes': Path('/opt/proof/icc-gainmap/binary-sha256.txt').read_text(),
        'native_source_hashes': Path('/opt/proof/icc-gainmap/source-sha256.txt').read_text()}
    (folder/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
