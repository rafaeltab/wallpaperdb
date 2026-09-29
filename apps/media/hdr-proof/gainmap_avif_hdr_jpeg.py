"""Bounded ICC-aware HDR JPEG from an independently defined gain-map AVIF.

The existing native source/geometry/PQ PNG preparation supplies HDR intent.
The existing native authored SDR PNG supplies gamma-3.2 JPEG base samples.
Reference arrays never enter either encoder. The fixed source renderer uses
direct dav1d base/map samples, actual tmap fractions and the already declared
bilinear8/linear-Lanczos convention. Both final HDR readers and the authored
SDR endpoint must pass unchanged photographic gates.

One established midpoint-offset/gamma1.5 FLOAT map recipe is declared before
measurement. Original native source-sampling and PNG-aspect failures remain
nested diagnostics. Stock sRGB-assuming readers and physical consumers have
separate statuses. This proves only the full-headroom endpoint, not partial
adaptation, another renderer convention or a production generation policy.
"""
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_avif
import gainmap_avif_hdr
import gainmap_avif_hdr_png
import gainmap_avif_jpeg
import gainmap_avif_png
import gainmap_sdr
import icc_gainmap
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_iso import ISO_ID, segments
from gainmap_metadata import check_metadata
from gamma_icc import decode_signal_to_nits, profile_facts
from matrix import GAINMAP_GEOMETRIES


SELECTORS = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
SIZES = {'contain': (173, 130), 'cover': (173, 173), 'fill': (173, 211), 'upscale': (769, 576)}
POLICY = {**gainmap_avif_hdr.POLICY,
    'output_scope': 'One identity-oriented static opaque HDR JPEG containment at 173x130; actual RGB8 base and RGB8 map preserve both source coded depths',
    'hdr_reference_revision': gainmap_avif_hdr.POLICY['reference_revision'],
    'sdr_reference_revision': gainmap_avif_png.POLICY['reference_revision'],
    'sdr_profile': 'gainmap-sdr', 'hdr_profile': 'gainmap-hdr',
    'sdr_reference': 'Direct dav1d authored SDR base, independent Pillow RGB8 Lanczos containment, nominal 100-nit SDR white; unchanged authored grade',
    'native_hdr_input': 'Checked native float32 source/geometry then RGB16 PQ PNG, with actual CICP 1/16/0/1 and square pixels; independent source/reference pixels are never input',
    'native_sdr_input': 'Checked native AOM base and native RGB8 geometry, gamma 3.2 coding, native libjpeg quality 100 RGB baseline JPEG; actual matrix ICC supplies color semantics',
    'recipe': 'Existing native midpointoffset 1/16384, gamma 1.5 gain codes and FLOAT DCT RGB8 map against the actual compressed ICC base; no parameter search or new allowance',
    'depth_scope': 'The native compute AVIF bridge declares an alternate depth of 12 bits. The requested JPEG output must have two independently inspected layers at 8 bits each',
    'endpoint_scope': 'Display boost 16 and source/output gain weight 1 only; regenerated gain metadata is measured. Intermediate adaptation remains unqualified',
    'consumer_scope': 'ICC-aware independent/native file readers only; stock-reader diagnostic and browser/OS wallpaper qualification remain separate and pending manual review'}
GEOMETRY_POLICY = {**POLICY,
    'output_scope': 'Only identity-oriented static opaque HDR JPEG contain, cover, fill and upscale; actual RGB8 base and map preserve both source coded depths',
    'geometry_reference': gainmap_avif_hdr.GEOMETRY_POLICY['geometry_reference'],
    'sdr_reference': 'Direct dav1d authored SDR base, independent Pillow RGB8 Lanczos with matched contain/cover/fill/upscale geometry, nominal 100-nit SDR white; unchanged authored grade',
    'orientation_scope': 'No transformed source or extra crop selector is admitted without a separately verified real fixture'}


def _selectors(operation):
    return {**{key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')},
            **GAINMAP_GEOMETRIES[operation]}


def validate_selectors(selectors, *, operation='contain'):
    if operation not in SIZES:
        raise ValueError('Unsupported HDR JPEG geometry')
    if selectors != _selectors(operation):
        label = 'containment' if operation == 'contain' else operation
        raise ValueError(f'Only the exact HDR JPEG {label} selectors are admitted')


def source_decision(source, directory, *, source_lock=gainmap_avif.SOURCE_LOCK):
    return gainmap_avif_hdr.source_decision(source, directory, source_lock=source_lock)


def _layer_structure(data, dimensions):
    """Inspect the bounded native RGB8 layer and reject unknown metadata."""
    headers = list(segments(data))
    allowed = (0xC0, 0xC4, 0xDB, 0xE0, 0xE1, 0xE2, 0xEE)
    if any(marker not in allowed for marker, _ in headers):
        raise ValueError('Unknown JPEG frame or private metadata segment')
    frames = [value for marker, value in headers if marker == 0xC0]
    width, height = dimensions
    if (len(frames) != 1 or len(frames[0]) != 15 or frames[0][:6] != struct.pack('>BHHB', 8, height, width, 3)
            or frames[0][6::3] != b'RGB' or frames[0][7::3] != b'\x11'*3):
        raise ValueError('Expected actual contained baseline RGB8 without subsampling')
    aspect = []
    for marker, value in headers:
        if marker == 0xE0:
            if (len(value) != 14 or value[:5] != b'JFIF\0' or value[7] != 0
                    or int.from_bytes(value[8:10], 'big') != int.from_bytes(value[10:12], 'big')
                    or not int.from_bytes(value[8:10], 'big') or value[12:] != bytes(2)):
                raise ValueError('Unknown or nonsquare JPEG pixel-aspect override')
            aspect.append('JFIF equal nonzero unitless density')
        if marker == 0xE1 and not value.startswith(b'http://ns.adobe.com/xap/1.0/\0'):
            raise ValueError('Unknown JPEG orientation or private APP1 metadata')
        if marker == 0xE2 and not value.startswith((b'ICC_PROFILE\0', b'MPF\0', ISO_ID)):
            raise ValueError('Unknown JPEG APP2 metadata')
        if marker == 0xEE and value != b'Adobe\x00\x64'+bytes(5):
            raise ValueError('Unknown JPEG RGB transform')
    position = 2+sum(len(value)+4 for _, value in headers)
    if data[position:position+2] != b'\xff\xda' or position+4 > len(data):
        raise ValueError('Missing native RGB JPEG scan')
    size = int.from_bytes(data[position+2:position+4], 'big')
    scan = data[position+4:position+size+2]
    if len(scan) != 10 or scan[0] != 3 or scan[1:7:2] != b'RGB' or scan[-3:] != b'\x00\x3f\x00':
        raise ValueError('Expected one full sequential RGB scan')
    position += size+2
    start = position
    while position+1 < len(data):
        if data[position] != 255:
            position += 1
        elif data[position+1] == 0:
            position += 2
        elif data[position:position+2] == b'\xff\xd9' and position > start and position+2 == len(data):
            break
        else:
            raise ValueError('Unexpected extra JPEG scan, image or trailing payload')
    else:
        raise ValueError('Incomplete JPEG entropy data')
    return {'rgb8_dimensions': [width, height], 'orientation': 1,
            'pixel_aspect': aspect or ['No explicit pixel-aspect override'],
            'header_markers': [hex(marker) for marker, _ in headers]}


def inspect_output(path, directory, *, dimensions=(173, 130)):
    if tuple(dimensions) not in SIZES.values():
        raise ValueError('Expected one of the bounded HDR JPEG geometries')
    width, height = dimensions
    path, directory = Path(path), Path(directory)
    facts = gainmap.inspect(path, directory)
    if (not facts.get('gain_map_present') or not facts.get('iso_metadata')
            or not facts.get('android_xmp_properties') or facts['private_tags']
            or facts['frame_count'] != 1 or not facts['opaque']):
        raise ValueError('Expected private-metadata-free static opaque dual-metadata gain-map JPEG')
    for layer in ('base', 'map'):
        observed = facts[layer]
        if any(observed.get(key) != value for key, value in
               {'width': width, 'height': height, 'depth': 8, 'components': 3, 'sof': 0}.items()):
            raise ValueError('Unknown emitted JPEG base/map geometry or coded depth')
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
        raise ValueError('Expected exactly the two declared JPEG layers without extra payload')
    facts['layer_structure'] = {'base': _layer_structure(data[:base_size], dimensions), 'map': _layer_structure(map_data, dimensions)}
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
    decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=3.2, expected_gamut='srgb')
    with Image.open(directory/'map.jpg') as image:
        if image.info.get('icc_profile'):
            raise ValueError('A gain map must not carry a display ICC profile')
    facts['actual_base_icc'] = profile_facts(profile)
    probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', path]))
    agreement = check_metadata(facts, probe)
    if not all(agreement['checks'].values()):
        raise ValueError('Independent ISO, XMP and native gain metadata disagree')
    channels = facts['iso_metadata']['channels']
    if (len(channels) != 3 or probe['gamma'] != [1.5]*3
            or any(channel['gamma'] != 1.5 or channel[field] != 1/16384
                   for channel in channels for field in ('base_offset', 'alternate_offset'))):
        raise ValueError('Emitted gain metadata does not match the declared native recipe')
    if (probe['hdr_capacity_min'] != 1 or not 1 < probe['hdr_capacity_max'] <= 16
            or not 0 < facts['iso_metadata']['alternate_headroom'] <= 4):
        raise ValueError('Actual gain-map capacities do not establish the full-headroom endpoint')
    facts['metadata_agreement'] = agreement
    facts['native_metadata_probe'] = probe
    return facts


def _hdr_measure(reference, actual):
    return compare_appearance(reference, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')


def _case(root, hdr, sdr, sampling, *, operation='contain'):
    selectors = _selectors(operation)
    validate_selectors(selectors, operation=operation)
    width, height = SIZES[operation]
    root = root if operation == 'contain' else root/operation
    original = next(row for row in hdr['evidence'] if row['candidate'] == 'native-pq16-square-pixels' and row['geometry'] == operation)
    authored = next(row for row in sdr['evidence'] if row['geometry'] == operation)
    source = Path(original['artifacts']['source'])
    case = {'case_id': gainmap_avif.FIXTURE_ID+f':hdr:jpg:preserve:preserve:{operation}:icc-midpoint-gamma15-float',
        'cell_id': 'avif-gainmap:hdr:jpg', 'fixture_id': gainmap_avif.FIXTURE_ID,
        'candidate': 'native-icc-midpoint-gamma15-float', 'geometry': operation, 'selectors': selectors,
        'source_sha256': original['source_sha256'], 'source_facts': original['source_facts'],
        'threshold_scope': {**(POLICY if operation == 'contain' else GEOMETRY_POLICY),
                            'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': 'Experimental ICC-aware native and independent file readers at the full-headroom '
            'endpoint with display boost 16 only, under the declared gain-map AVIF renderer convention; physical consumers remain pending manual review',
        'known_consumer_limitations': ['Gain application must interpret the actual gamma 3.2 base ICC. '
            'The pinned stock native reader assumes sRGB; its stock_native_srgb measurement remains separate.',
            'Intermediate adaptation and browser/OS wallpaper behavior remain unqualified.'],
        'native_preparation': {'hdr_png': hdr, 'sdr_png': sdr, 'source_sampling_diagnostics': sampling},
        'checks': {key: False for key in ('native_hdr_preparation', 'native_sdr_preparation', 'native_transfer',
            'native_encoder', 'independent_decoder', 'full_headroom', 'structure', 'appearance', 'privacy')},
        'measurements': {}, 'artifacts': {}, 'blockers': []}
    try:
        for label, preparation in (('hdr', original), ('sdr', authored)):
            case['checks'][f'native_{label}_preparation'] = (preparation['status'] == 'qualified'
                and all(preparation['checks'].values()) and not preparation['blockers'])
        if not all(case['checks'][key] for key in ('native_hdr_preparation', 'native_sdr_preparation')):
            raise ValueError('Source, geometry and native intent preparation must qualify before JPEG encoding')
        source_hash = avif.digest(source)
        if (authored['source_sha256'] != source_hash or original['source_sha256'] != source_hash
                or original['native_source']['weight'] != 1):
            raise ValueError('The two endpoints must describe the same established full-headroom source')
        hdr_path, sdr_path = Path(original['artifacts']['output']), Path(authored['artifacts']['output'])
        if (avif.digest(hdr_path) != original['artifacts']['sha256']
                or avif.digest(sdr_path) != authored['artifacts']['sha256']):
            raise ValueError('Native endpoint input changed after independent inspection')
        hdr_facts, _ = gainmap_avif_hdr_png.inspect_and_decode(hdr_path)
        gainmap_avif_png.inspect_and_decode(sdr_path)
        if (hdr_facts['width'], hdr_facts['height']) != (width, height):
            raise ValueError('Native HDR intent geometry changed')
        reference_hdr, reference_sdr = original['reference_hdr'], authored['reference_sdr']
        if any(avif.digest(value['path']) != value['sha256'] for value in (reference_hdr, reference_sdr)):
            raise ValueError('Independent endpoint reference changed')
        hdr_reference = gainmap.array_geometry(np.load(reference_hdr['path']), operation)
        with Image.open(reference_sdr['path']) as image:
            sdr_reference = sdr_signal_to_nits(np.asarray(image).astype(float)/255)
        base, output = root/'gamma32-base.jpg', root/'output.jpg'
        root.mkdir(parents=True, exist_ok=True)
        base_encoding = gainmap_avif_jpeg._encode(sdr_path, base, gamma32=True)
        case['checks']['native_transfer'] = base_encoding['transfer_stage']['passed']
        candidate = icc_gainmap.pack(base, hdr_path, output,
                                    map_policy='midpointoffset', map_gamma=1.5, map_method='float')
        case['checks']['native_encoder'] = True
        case['native_candidate'] = {**candidate, 'base_encoding': base_encoding}
        case['artifacts'] = {'source': str(source), 'source_sha256': source_hash,
                             'output': str(output), 'sha256': avif.digest(output)}
        facts = inspect_output(output, root/'inspection', dimensions=(width, height))
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='srgb', gamma=3.2)
        native_hdr, native_facts = icc_gainmap.native_decode(output, root/'native.rgbf32', boost=16)
        independent_hdr, independent_facts = icc_gainmap.independent_decode(output, root/'inspection/map.jpg', boost=16)
        measured_sdr = compare_appearance(sdr_reference, actual_sdr,
            reference_gamut='srgb', actual_gamut='rec2020', fixture_class='gainmap-sdr')
        measurements = {'authored_sdr': measured_sdr, 'native_hdr': _hdr_measure(hdr_reference, native_hdr),
            'independent_hdr': _hdr_measure(hdr_reference, independent_hdr),
            'cross_decoder_hdr': _hdr_measure(independent_hdr, native_hdr)}
        probe = facts['native_metadata_probe']
        native_weight = min(np.log2(16)/np.log2(probe['hdr_capacity_max']), 1)
        structure = {'geometry': actual_sdr.shape == native_hdr.shape == independent_hdr.shape == hdr_reference.shape == (height, width, 3),
            'gamut': sdr_facts['gamut'] == native_facts['gamut'] == independent_facts['gamut'] == 'srgb',
            'actual_base_icc': sdr_facts['icc_sha256'] == base_encoding['icc_sha256'],
            'actual_rgb8_layers': all(facts[layer]['depth'] == 8 and facts[layer]['sof'] == 0 for layer in ('base','map')),
            'source_rgb8_layers': original['source_facts']['base']['depths'] == [8, 8, 8] and original['source_facts']['map']['depths'] == [8],
            'native_intent': hdr_facts['square_pixels'] and hdr_facts['cicp'] == [1, 16, 0, 1] and hdr_facts['depth'] == 16}
        case['checks'].update({'independent_decoder': measurements['cross_decoder_hdr']['passed'],
            'full_headroom': bool(independent_facts['gain_map_weight'] == native_weight == 1),
            'structure': all(structure.values()), 'appearance': all(value['passed'] for value in measurements.values()),
            'privacy': not facts['private_tags'] and sdr_facts['privacy']})
        case.update({'facts': facts, 'structural_checks': structure, 'measurements': measurements,
            'reference_hdr': reference_hdr, 'reference_sdr': reference_sdr,
            'sdr_decoder_evidence': sdr_facts,
            'hdr_decoder_evidence': {'native': native_facts, 'independent': independent_facts},
            'endpoint': {'display_boost': 16, 'source_weight': original['native_source']['weight'],
                'native_weight_derived_from_verified_inputs': float(native_weight),
                'native_weight_scope': 'Derived from verified native probe capacities and the recorded boost 16 invocation; not a returned native decoder field',
                'independent_weight': independent_facts['gain_map_weight'], 'partial_adaptation': 'untested'},
            'privacy_measurement': {'passed': case['checks']['privacy'], 'private_tags': facts['private_tags']}})
        diagnostic = {'status': 'tested and failed', 'consumer_status': 'pending manual review',
                      'scope': 'Separate pinned native reader that assumes sRGB transfer; no physical consumer qualification'}
        start = len(avif.COMMANDS)
        try:
            raw = root/'stock-native.gbrpf32'
            stock = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'decode-linear', output, raw, '16']))
            values = np.fromfile(raw, '<f4').reshape(3, stock['height'], stock['width'])[[2, 0, 1]].transpose(1, 2, 0)*203
            diagnostic['measurement'] = compare_appearance(hdr_reference, values, reference_gamut='srgb',
                actual_gamut={0: 'srgb', 1: 'p3', 2: 'rec2020'}[stock['gamut']], fixture_class='gainmap-hdr')
            diagnostic['facts'], diagnostic['raw_sha256'] = stock, avif.digest(raw)
            if diagnostic['measurement']['passed']:
                diagnostic['status'] = 'qualified'
        except Exception as error:
            diagnostic['failure'] = str(error)
        diagnostic['commands'] = avif.COMMANDS[start:]
        case['consumer_decoder_diagnostics'] = {'stock_native_srgb': diagnostic}
        case['known_consumer_limitations'].append(f"stock_native_srgb file diagnostic: {diagnostic['status']}.")
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def run(directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None, geometries=('contain',)):
    geometries = tuple(geometries)
    if not geometries or len(set(geometries)) != len(geometries) or any(operation not in SIZES for operation in geometries):
        raise ValueError('Expected distinct contain, cover, fill or upscale geometries')
    if selectors is not None:
        if len(geometries) != 1:
            raise ValueError('Explicit selectors require one declared geometry')
        validate_selectors(selectors, operation=geometries[0])
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    sampling = gainmap_avif_hdr.run(root/'sampling-diagnostics', source_lock=source_lock, geometries=geometries)
    hdr = gainmap_avif_hdr_png.run(root/'native-hdr-png', source_lock=source_lock, geometries=geometries)
    sdr = gainmap_avif_png.run(root/'native-sdr-png', source_lock=source_lock, geometries=geometries)
    cases = [_case(root, hdr, sdr, sampling, operation=operation) for operation in geometries]
    controls = [{**row, 'case_id': row['case_id'].replace('gainmap-avif-hdr-png16-', 'gainmap-avif-hdr-jpeg-')}
                for row in hdr['controls'] if 'original' in row['case_id']]
    for name, change in (('depth16', {'depth': '16'}), ('other-gamut', {'gamut': 'p3'}),
                         ('orientation', {'orientation': 8}), ('other-geometry', {'fit': 'cover'})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': f'gainmap-avif-hdr-jpeg-{name}-withheld', 'passed': rejected,
                         'status': 'passed' if rejected else 'tested and failed'})
    logs = []
    for path in sorted(root.rglob('*.log')):
        content = path.read_text()
        try:
            record = json.loads(content)
        except json.JSONDecodeError:
            record = {'text': content}
        logs.append({'path': str(path), 'sha256': avif.digest(path), 'record': record})
    return {'evidence': cases, 'source_fixtures': hdr['source_fixtures'], 'fixtures': [], 'controls': controls,
            'source_reconstruction_profiles': sampling['source_reconstruction_profiles'],
            'commands': avif.COMMANDS[start:], 'scope': POLICY if geometries == ('contain',) else GEOMETRY_POLICY,
            'consumer_status': 'pending manual review',
            'native_log_artifacts': logs}
