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
    if (type(map_gamma) not in (int, float) or map_gamma not in (1, 1.5, 2)
            or map_gamma != 1 and map_policy == 'moderateoffset'
            or map_policy == 'midpointoffset' and map_gamma not in (1.5, 2)
            or map_gamma == 1.5 and map_policy != 'midpointoffset'):
        raise ValueError('Only the declared gamma1, gamma2 and midpointoffset gamma1.5 candidates are supported')
    if (map_method not in ('float', 'islow') or map_method == 'islow'
            and (map_policy != 'midpointoffset' or map_gamma not in (1.5, 2))):
        raise ValueError('The separate ISLOW map candidates require midpointoffset and gamma1.5 or gamma2')
    variant = ('midpointoffset-gamma15' if map_gamma == 1.5 else
               f'{map_policy}-gamma2' if map_gamma == 2 else 'smalloffset')
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
    mode = ('pack-gamma15-midpoint' if map_gamma == 1.5 else
            'pack-gamma2-midpoint' if map_policy == 'midpointoffset' else 'pack-gamma2')
    packer = ([tool, mode] if map_gamma != 1 else
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


def _pq_source(path, directory, expected_size):
    """Inspect the existing XMP/Apple PQ bridge without widening native support."""
    import gainmap_hdr
    path = Path(path)
    if gainmap_hdr._pq_source_primaries(path) != 9:
        raise ValueError('Native source bridge must carry actual Rec.2020 PQ signaling')
    facts = gainmap.inspect(path, directory)
    signal = avif.read_png(path)
    if (facts['coded_depth'] != 16 or facts['frame_count'] != 1 or not facts['opaque']
            or facts['private_tags'] or facts['metadata'].get('IFD0:Orientation', 1) != 1
            or signal.shape[1::-1] != tuple(expected_size)):
        raise ValueError('Native source bridge has unsupported precision, dimensions, orientation, motion or metadata')
    return avif.decode_transfer(signal[..., :3], 'pq', 'rec2020'), {
        'path': str(path), 'sha256': avif.digest(path), 'gamut': 'rec2020', 'transfer': 'pq',
        'coded_depth': 16, 'native_requested_depth': 12, 'facts': facts,
        'scope': 'Existing native libavif reconstruction to PQ16 PNG; not the ISO-only float32 source decoder',
        'reference_relationship': 'The established source reference shares native libavif gain application; '
            'independent PNG readback verifies transport precision. Final HDR output uses separate '
            'native ICC-aware and FFmpeg/ISO reconstruction gates.'}


def _new_apple_source_model(source_facts, map_path):
    """Admit the locked XMP dialect without silently assuming EXIF headroom."""
    tags = json.loads(avif.native(['exiftool', '-json', '-n', '-G1', '-s', map_path]))[0]
    version = tags.get('XMP-HDRGainMap:HDRGainMapVersion')
    headroom = tags.get('XMP-HDRGainMap:HDRGainMapHeadroom')
    auxiliary_type = tags.get('XMP-apdi:AuxiliaryImageType')
    if (version != 131072 or auxiliary_type != 'urn:com:apple:photo:2020:aux:hdrgainmap'
            or type(headroom) not in (int, float) or not np.isfinite(headroom) or headroom <= 1
            or source_facts['metadata'].get('IFD0:Orientation', 1) != 1):
        raise ValueError('New Apple source requires established XMP version/model/headroom and identity orientation')
    return {'dialect': 'new Apple gain-map JPEG', 'xmp_version': version,
        'xmp_auxiliary_type': auxiliary_type, 'xmp_linear_headroom': headroom,
        'xmp_log2_headroom': float(np.log2(headroom)),
        'headroom_origin': 'Pinned native libavif reads XMP HDRGainMapHeadroom as linear headroom; '
            'present XMP takes precedence over Apple EXIF MakerNotes33/48',
        'exiftool_hdr_headroom': source_facts['metadata'].get('Apple:HDRHeadroom'),
        'exiftool_hdr_gain': source_facts['metadata'].get('Apple:HDRGain'),
        'native_reader_source': 'https://raw.githubusercontent.com/AOMediaCodec/libavif/v1.4.1/apps/shared/avifjpeg.c',
        'scope': 'Locked new Apple XMP model only; MakerNotes are recorded source facts, not required '
            'headroom input, and all private source metadata must be removed from output'}


def run(directory, *, map_policy='moderateoffset', map_gamma=1, map_method='float',
        source_id='gainmap-android-iso', operation='upscale', base_method='islow'):
    """Bounded ISO experiments, XMP upscale, and Apple contain/upscale."""
    import gainmap_combine
    import gainmap_hdr
    from gainmap_metadata import check_metadata
    from gainmap_reference import reference
    from appearance import compare_appearance, sdr_signal_to_nits, delta_e_itp
    from matrix import GAINMAP_GEOMETRIES
    _encoder(map_policy, map_gamma, map_method)
    if source_id not in ('gainmap-android-iso', 'gainmap-android-xmp', 'gainmap-apple-old', 'gainmap-apple-new'):
        raise ValueError('Only the four pinned ISO, XMP and Apple sources are supported')
    if (base_method not in ('islow', 'float') or base_method == 'float' and
            (source_id, operation, map_policy, map_gamma, map_method) !=
            ('gainmap-apple-new', 'upscale', 'midpointoffset', 1.5, 'float')):
        raise ValueError('FLOAT base coding is bounded to new Apple upscale with midpointoffset gamma1.5 FLOAT map')
    new_apple_islow = (source_id, operation, map_policy, map_gamma, map_method) == (
        'gainmap-apple-new', 'upscale', 'midpointoffset', 1.5, 'islow')
    if map_gamma == 1.5 and map_method == 'islow' and not new_apple_islow:
        raise ValueError('The gamma1.5 ISLOW candidate is bounded to new Apple upscale')
    if (source_id != 'gainmap-android-iso'
            and (map_policy, map_gamma, map_method) != ('midpointoffset', 1.5, 'float') and not new_apple_islow):
        raise ValueError('The XMP/Apple experiments admit only their predeclared midpointoffset gamma1.5 maps')
    allowed_geometry = ('contain', 'upscale') if source_id in ('gainmap-apple-old', 'gainmap-apple-new') else ('upscale',)
    if operation not in allowed_geometry:
        raise ValueError('Only the exact predeclared source/geometry tuples are admitted')
    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    name = source_id
    gamut = 'srgb' if name == 'gainmap-android-xmp' else 'p3'
    source_precision = 'float32' if name == 'gainmap-android-iso' else 'pq16'
    source = gainmap.FIXTURES/f'{name}.jpg'
    fixture = next(f for f in json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures'] if f['id'] == name)
    if avif.digest(source) != fixture['sha256']:
        raise ValueError('Pinned gain-map source fixture hash changed')
    revision = 'gainmap-hdr-target-gamut-v1'
    candidate = f'native-combine-icc-gamma32-{map_policy}-dct-{map_method}-map-source-{source_precision}'
    if map_gamma != 1:
        candidate += f'-map-gamma{map_gamma:g}'
    if base_method != 'islow':
        candidate += f'-base-dct-{base_method}'
    case = {'case_id': f'{name}:hdr:jpg:preserve:preserve:{operation}:{candidate}:{revision}',
        'fixture_id': name, 'source_sha256': fixture['sha256'], 'cell_id': 'gainmap-jpeg:hdr:jpg',
        'candidate': candidate, 'geometry': operation, 'source_reference_revision': revision,
        'source_precision': source_precision,
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
        if name == 'gainmap-apple-old':
            # This dialect has no XMP HDR headroom. The pinned native reader
            # requires Apple EXIF MakerNotes33/48 rather than assuming gamma
            # or headroom from the source filename.
            tags = source_facts['metadata']
            apple_headroom, apple_gain = tags.get('Apple:HDRHeadroom'), tags.get('Apple:HDRGain')
            if (not isinstance(apple_headroom, (int, float)) or not np.isfinite(apple_headroom) or apple_headroom <= 0
                    or not isinstance(apple_gain, (int, float)) or not np.isfinite(apple_gain)
                    or tags.get('IFD0:Orientation', 1) != 1):
                raise ValueError('Old Apple source requires established MakerNote headroom/gain and identity orientation')
            case['source_model_evidence'] = {'dialect': 'old Apple gain-map JPEG',
                'headroom_origin': 'Pinned native libavif Apple EXIF MakerNotes33/48 fallback; no XMP headroom assumption',
                'exiftool_hdr_headroom': apple_headroom, 'exiftool_hdr_gain': apple_gain,
                'native_reader_source': 'https://raw.githubusercontent.com/AOMediaCodec/libavif/v1.4.1/apps/shared/avifjpeg.c',
                'scope': 'Locked old Apple fixture only; private MakerNotes are source facts and must be removed from output'}
        elif name == 'gainmap-apple-new':
            case['source_model_evidence'] = _new_apple_source_model(source_facts, folder/'source-inspection/map.jpg')
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
            map_policy='moderateoffset', geometry_revision=revision, source_precision=source_precision)
        base, output = folder/'gamma32-base.jpg', folder/'output.jpg'
        base_encoding = gainmap_sdr.encode(source, base, operation, gamut=gamut, gamma=3.2)
        if base_method == 'float':
            from dct_jpeg import encode
            # Preserve the existing native pixel/ICC preparation and its
            # original JPEG. Only the baseline DCT arithmetic changes.
            control = folder/'gamma32-base-islow-control.jpg'
            base.rename(control)
            with Image.open(control) as image:
                base_profile = image.info['icc_profile']
            dct_encoding = encode(folder/'gamma32-base-gamma32.png', base,
                                  icc_profile=base_profile, method='float')
            base_encoding = {**base_encoding, 'native_encoder': dct_encoding['native_encoder'],
                'output_sha256': dct_encoding['output_sha256'], 'dct_encoding': dct_encoding,
                'preparation_islow_base': {'path': str(control), 'sha256': avif.digest(control),
                    'purpose': 'Unchanged native gamma3.2 preparation control; not the packed base'}}
        case['native_candidate'] = pack(base, preparation['hdr_intent_pq_png'], output,
            map_policy=map_policy, map_gamma=map_gamma, map_method=map_method)
        case['native_candidate'].update({'base_encoding': base_encoding, 'source_preparation': preparation})
        case['checks']['native_encoder'] = True
        if source_precision == 'float32':
            native_source = preparation['hdr_source']
            values = np.fromfile(native_source['path'], '<f4').reshape(3, native_source['height'], native_source['width'])
            values = values[[2, 0, 1]].transpose(1, 2, 0)*native_source['normalization_nits']
        else:
            source_pq = Path(preparation['parts_directory'])/'hdr-source/source-pq-rec2020.png'
            values, native_source = _pq_source(source_pq, folder/'source-pq-inspection',
                [fixture['expected']['width'], fixture['expected']['height']])
        case['source_precision_evidence'] = native_source
        source_measure = compare_appearance(hdr_source, values, reference_gamut=source_gamut,
            actual_gamut=native_source['gamut'], fixture_class='gainmap-hdr')
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
        case['checks']['hdr_intent'] = (intent_measure['passed'] and intent_cicp == [{'p3':12,'srgb':1}[gamut],16,0,1]
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
    report = {'scope': f'One predeclared {name}-{operation} ICC-aware native HDR candidate; unchanged appearance gates',
        'source_policy': {'fixture': name, 'geometry': operation, 'native_precision': source_precision,
            'reference_revision': revision, 'gamut': gamut,
            'base_method': base_method,
            'declaration': 'XMP upscale and old/new Apple contain/upscale admit the unchanged midpointoffset gamma1.5 FLOAT map recipe; '
                'one separate ISLOW map candidate is admitted only for new Apple upscale. '
                'One separate FLOAT-base/FLOAT-map candidate is also admitted only for new Apple upscale. '
                'the ISO-only float32 source guard remains unchanged. Source, geometry, native HDR intent, '
                'authored SDR and both final HDR readers must pass the existing gates.'},
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
            'new_apple_islow_rationale': 'Declared before encoding: new Apple upscale has one pixel above '
                '8 deltaE. Its native map input [0,5,9] decodes [0,6,9] in both JPEG readers, while '
                'the compressed base decodes [82,70,60] natively and [82,71,60] independently. '
                'Each isolated error passes, but together they reach 8.082252. One ISLOW map trial '
                'preserves the exact compressed base and pre-JPEG map to test native DCT quantization.',
            'new_apple_float_base_rationale': 'Declared before encoding: both map DCT methods retain '
                'the same 70/71 base-reader difference at the sole failing shadow pixel. One native '
                'FLOAT-DCT base trial keeps the native gamma3.2 PNG and actual P3 ICC byte-identical '
                'and recomputes the original midpointoffset gamma1.5 FLOAT map against that compressed base. '
                'No source pixel, reference, transfer, offset, gamma or threshold changes.',
            'gamma15_rationale': 'Declared before encoding: at the retained midpoint gamma2 worst black '
                'pixel, normalized gain 0.020102 makes the local inverse code sensitivity for gamma1.5 '
                '18.9% of gamma2. At the measured highlight median 0.613469 it rises 4.43%. '
                'One gamma3/2 float-DCT map tests this tradeoff, with unchanged base pixels, offsets and gates.',
            'upstream_sources': [
                'https://raw.githubusercontent.com/AOMediaCodec/libavif/v1.4.1/src/gainmap.c',
                'https://raw.githubusercontent.com/google/libultrahdr/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/gainmapmath.cpp']},
        'cases': [case], 'commands': avif.COMMANDS[start:], 'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json')),
        'gainmap_commands': logged_commands,
        'source_hashes': {name: avif.digest(Path(__file__).with_name(name)) for name in
            ('icc_gainmap.py', 'native_icc_gainmap.cpp', 'icc-gainmap-build.sh', 'libavif-icc-linear-base.patch',
             'libavif-gamma2-gain.patch', 'libavif-midpoint-offset-gain.patch', 'libavif-gamma15-gain.patch',
             'dct_jpeg.py', 'native_dct_jpeg.c', 'gainmap_combine.py', 'gainmap_hdr.py')},
        'native_hashes': Path('/opt/proof/icc-gainmap/binary-sha256.txt').read_text(),
        'native_source_hashes': Path('/opt/proof/icc-gainmap/source-sha256.txt').read_text()}
    (folder/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
