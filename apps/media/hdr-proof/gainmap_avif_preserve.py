"""One regenerated gain-map AVIF containment with actual eight-bit layer depths.

The SDR reference is the authored base; the HDR reference is the existing
gainmap-avif-hdr-bilinear8-lanczosfloat-v1 renderer at log2 headroom four.
Native AOM, zimg, FFmpeg and libavif produce all candidate pixels. Independent
dav1d packet samples and parsed tmap fractions provide the output reference
reader; native libavif gain application is a separately measured second reader.

The regenerated map has different headroom and offsets. Passing both endpoints
here establishes only the named full-headroom rendering, not intermediate
display adaptation or general consumer interoperability. Stock map/color
failures and alternate-depth12 incompatibility remain separate evidence.
"""
import hashlib
import json
from pathlib import Path
import shutil
import struct

import numpy as np
from PIL import Image

import avif
import gainmap_avif
import gainmap_avif_hdr
import gainmap_avif_hdr_png
import gainmap_avif_proof
import hdr_png
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap import array_geometry, geometry, private_metadata_tags
from gainmap_avif import _Reader, _boxes, _fractions, _unique
from gainmap_hdr import read_linear
from gainmap_linear import resample_linear
from gainmap_sdr import _axis


SELECTORS = {**gainmap_avif_hdr.SELECTORS, 'depth': 'preserve'}
POLICY = {**gainmap_avif_hdr.POLICY,
    'output_scope': 'One static opaque gain-map AVIF containment173x130, source primaries and actual base/map/alternate depth8 preserved',
    'sdr_profile': 'gainmap-sdr', 'sdr_reference_revision': gainmap_avif_proof.POLICY['reference_revision'],
    'sdr_reference': 'Independent dav1d authored RGB8 base, Pillow RGB8 Lanczos containment, existing photographic SDR grade at 100-nit white',
    'adaptation_scope': 'Only log2 display headroom4 is measured; regenerated metadata differs from source, so intermediate adaptation remains untested',
    'native_depth_rationale': 'Pinned libavif src/gainmap.c assigns alternate depth from the decoded alternate image; combine -d8 actually quantizes the native PQ input to8 before computing the map. Actual AV1 packet depths and alternate pixi must all remain8',
    'native_depth_source': 'https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/gainmap.c#L889',
    'output_reader': 'Exact direct dav1d RGB8 AV1 item samples, independently parsed per-channel tmap fractions, inverse sRGB and gain application at 203-nit SDR white',
    'map_precision': 'Regenerated map matches the base dimensions, so neither output HDR reader needs map resampling',
    'negative_components': 'Clamp reconstructed negative linear components to zero, matching the existing ISO reference and native PQ transfer domain; retain counts and minimum before clamp',
    'stock_diagnostic': 'Stock matrix2 map is unqualified. Its separate diagnostic explicitly uses BT.601 for the unspecified YUV map, then measures both readers; no source or output color inference authorizes qualification'}


def validate_selectors(selectors):
    if selectors != SELECTORS:
        raise ValueError('Only the exact depth-preserving gain-map AVIF containment selectors are admitted')


def source_decision(source, directory, *, source_lock=gainmap_avif.SOURCE_LOCK):
    return gainmap_avif_hdr.source_decision(source, directory, source_lock=source_lock)


def _parse_output(data, *, diagnostic_stock_matrix=False):
    """Bounded independent BMFF graph parser, before any native decoding."""
    top = _boxes(data)
    if sorted(kind for kind, _, _ in top) != [b'ftyp', b'mdat', b'meta']:
        raise ValueError('Expected only static AVIF file, metadata and local media boxes')
    brand = _unique(top, b'ftyp')[1]
    if (len(brand) < 12 or len(brand) % 4 or brand[:8] != b'avif'+bytes(4)
            or b'tmap' not in [brand[i:i+4] for i in range(8, len(brand), 4)]):
        raise ValueError('Expected AVIF and tone-map item brands')
    _, media, media_offset = _unique(top, b'mdat')
    _, meta, meta_offset = _unique(top, b'meta')
    if meta[:4] != bytes(4):
        raise ValueError('Unknown AVIF meta version')
    boxes = _boxes(meta[4:], meta_offset+4)
    if sorted(kind for kind, _, _ in boxes) != sorted((b'hdlr', b'pitm', b'iloc', b'iinf', b'iref', b'iprp', b'grpl')):
        raise ValueError('Unexpected image or metadata graph boxes')
    if _unique(boxes, b'hdlr')[1] != bytes(8)+b'pict'+bytes(13):
        raise ValueError('Unknown image handler metadata')
    pitm = _unique(boxes, b'pitm')[1]
    if len(pitm) != 6 or pitm[:4] != bytes(4):
        raise ValueError('Unknown primary item reference')
    primary = int.from_bytes(pitm[4:], 'big')
    locations = _Reader(_unique(boxes, b'iloc')[1])
    if locations.take(6) != b'\x00\x00\x00\x00\x44\x00':
        raise ValueError('Unknown item extent representation')
    items, extents = {}, []
    for _ in range(locations.number(2)):
        item, reference, count = locations.number(2), locations.number(2), locations.number(2)
        start, length = locations.number(4), locations.number(4)
        if (item in items or reference != 0 or count != 1 or length == 0
                or start < media_offset or start+length > media_offset+len(media)):
            raise ValueError('Unknown, external or invalid image extent')
        items[item] = data[start:start+length]
        extents.append((start, start+length))
    locations.end()
    ordered = sorted(extents)
    if (not ordered or ordered[0][0] != media_offset or ordered[-1][1] != media_offset+len(media)
            or any(a[1] != b[0] for a, b in zip(ordered, ordered[1:]))):
        raise ValueError('Media payload must contain exactly the non-overlapping known image items')
    information = _unique(boxes, b'iinf')[1]
    if len(information) < 6 or information[:4] != bytes(4):
        raise ValueError('Unknown item information version')
    entries, types = _boxes(information[6:]), {}
    if len(entries) != int.from_bytes(information[4:6], 'big'):
        raise ValueError('Item count mismatch')
    for kind, entry, _ in entries:
        if (kind != b'infe' or len(entry) < 13 or entry[:4] not in (b'\x02\x00\x00\x00', b'\x02\x00\x00\x01')
                or entry[6:8] != bytes(2) or entry[12:] not in (b'Color\x00', b'GMap\x00')):
            raise ValueError('Unknown, protected or privately named image item')
        item = int.from_bytes(entry[4:6], 'big')
        if item in types:
            raise ValueError('Duplicate image item')
        types[item] = entry[8:12]
    if set(types) != set(items) or sorted(types.values()) != [b'av01', b'av01', b'tmap']:
        raise ValueError('Expected exactly two AV1 images and one tone-map item; no private metadata')
    tone = next(item for item, kind in types.items() if kind == b'tmap')
    refs = _unique(boxes, b'iref')[1]
    if refs[:4] != bytes(4):
        raise ValueError('Unknown item reference version')
    links = _boxes(refs[4:])
    if len(links) != 1 or links[0][0] != b'dimg' or len(links[0][1]) != 8:
        raise ValueError('Expected exactly the base/map derived-image reference')
    owner, count, base, gain = struct.unpack('>HHHH', links[0][1])
    if owner != tone or count != 2 or base != primary or base == gain or types.get(base) != b'av01' or types.get(gain) != b'av01':
        raise ValueError('Unknown tone-map derivation or primary rendition')
    groups = _boxes(_unique(boxes, b'grpl')[1])
    if (len(groups) != 1 or groups[0][0] != b'altr'
            or groups[0][1] != struct.pack('>IIIII', 0, 4, 2, tone, base)):
        raise ValueError('Unknown alternate rendition group')
    properties = _boxes(_unique(boxes, b'iprp')[1])
    if sorted(kind for kind, _, _ in properties) != [b'ipco', b'ipma']:
        raise ValueError('Unknown property container')
    property_list = _boxes(_unique(properties, b'ipco')[1])
    associations = _Reader(_unique(properties, b'ipma')[1])
    if associations.take(4) != bytes(4):
        raise ValueError('Unknown property association version')
    attached, used = {}, set()
    for _ in range(associations.number(4)):
        item, count = associations.number(2), associations.number(1)
        if item in attached:
            raise ValueError('Duplicate property association')
        attached[item] = []
        for _ in range(count):
            index = associations.number(1) & 127
            if index < 1 or index > len(property_list):
                raise ValueError('Invalid property index')
            used.add(index)
            attached[item].append(property_list[index-1])
    associations.end()
    if set(attached) != {base, gain, tone} or used != set(range(1, len(property_list)+1)):
        raise ValueError('Unknown or unassociated image properties')
    def image_facts(item, coded):
        props = attached[item]
        allowed = (b'ispe', b'pixi', b'colr', b'av1C') if coded else (b'ispe', b'pixi', b'colr')
        if sorted(kind for kind, _, _ in props) != sorted(allowed):
            raise ValueError('Unknown or conflicting depth, ICC, color, aspect or orientation properties')
        size, pixels, color = (_unique(props, kind)[1] for kind in (b'ispe', b'pixi', b'colr'))
        if (len(size) != 12 or size[:4] != bytes(4) or pixels[:5] != bytes(4)+b'\x03' or len(pixels) != 8
                or len(color) != 11 or color[:4] != b'nclx' or color[-1] & 127):
            raise ValueError('Invalid dimensions, plane depths or CICP representation')
        dimensions, depths = list(struct.unpack('>II', size[4:])), list(pixels[5:])
        if dimensions != [173, 130] or depths not in ([[8, 8, 8]] if coded else [[8, 8, 8], [12, 12, 12]]):
            raise ValueError('Unexpected containment dimensions or base/map/alternate precision')
        facts = {'item_id': item, 'dimensions': dimensions, 'depths': depths,
                 'cicp': [*struct.unpack('>HHH', color[4:10]), color[-1] >> 7],
                 'icc': 'absent', 'transformations': 'none', 'pixel_aspect': 'square; pasp absent'}
        if coded:
            config = _unique(props, b'av1C')[1]
            if config != b'\x81\x20\x00\x00':
                raise ValueError('Unknown AV1 configuration depth, profile, subsampling or reserved flags')
            facts['av1_configuration_hex'] = config.hex()
        return facts
    facts = {'base': image_facts(base, True), 'map': image_facts(gain, True),
             'alternate': image_facts(tone, False), 'metadata': _fractions(items[tone])}
    map_color = facts['map']['cicp']
    if (facts['base']['cicp'] != [1, 13, 0, 1] or facts['alternate']['cicp'] != [1, 16, 0, 1]
            or not (map_color == [2, 2, 0, 1] or diagnostic_stock_matrix and map_color == [2, 2, 2, 1])):
        raise ValueError('Unknown or unsupported base/map/alternate color signaling')
    facts.update({'orientation': 1, 'frames': 1, 'motion': 'static', 'alpha': 'none', 'square_pixels': True,
                  'known_map_matrix': map_color == [2, 2, 0, 1], 'private_metadata_items': []})
    return facts, {'base': items[base], 'map': items[gain]}


def inspect_packet(path, name, dimensions, *, diagnostic_stock_matrix=False):
    if name not in ('base', 'map'):
        raise ValueError('Expected a base or map AV1 packet')
    result = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu',
                                     '-count_frames', '-show_frames', '-show_streams', '-of', 'json', path]))
    frames, streams = result.get('frames', []), result.get('streams', [])
    if len(frames) != 1 or len(streams) != 1 or streams[0].get('codec_name') != 'av1':
        raise ValueError('Expected exactly one decoded AV1 item frame')
    stock = name == 'map' and diagnostic_stock_matrix
    expected_color = ['gbr', 'bt709', 'iec61966-2-1'] if name == 'base' else [None if stock else 'gbr', None, None]
    for observed in (frames[0], streams[0]):
        if observed.get('pix_fmt') != ('yuv444p' if stock else 'gbrp'):
            raise ValueError('AV1 packet native pixel format/depth disagrees with RGB8 layer facts')
        if ([observed.get('width'), observed.get('height')] != dimensions or observed.get('color_range') != 'pc'
                or observed.get('sample_aspect_ratio') != '1:1'):
            raise ValueError('AV1 packet dimensions, full range or square pixels disagree with container')
        if [observed.get(key) for key in ('color_space', 'color_primaries', 'color_transfer')] != expected_color:
            raise ValueError('AV1 packet color signaling disagrees with container')
    if (streams[0].get('profile') != 'High' or streams[0].get('nb_read_frames') != '1'
            or any(frames[0].get(key, 0) != 0 for key in ('crop_top', 'crop_bottom', 'crop_left', 'crop_right'))):
        raise ValueError('Unknown packet profile, frame count or crop')
    return result


def inspect_output(path, directory, *, diagnostic_stock_matrix=False):
    path, directory = Path(path), Path(directory)
    facts, packets = _parse_output(path.read_bytes(), diagnostic_stock_matrix=diagnostic_stock_matrix)
    directory.mkdir(parents=True, exist_ok=True)
    native = avif.inspect_avif(path)
    exif, info = native['exiftool'], native['info']
    alt = info.split(' * Alternate image:', 1)
    expected = {'ImageWidth': 173, 'ImageHeight': 130, 'ColorPrimaries': 1, 'TransferCharacteristics': 13,
                'MatrixCoefficients': 0, 'VideoFullRangeFlag': 1, 'ImagePixelDepth': '8 8 8'}
    if (any(exif.get(key) != value for key, value in expected.items()) or exif.get('Orientation', 1) != 1
            or [native['width'], native['height'], native['depth']] != [173, 130, 8]
            or [native['primaries'], native['transfer'], native['matrix']] != [1, 13, 0]
            or native['alpha'] != 'Absent' or avif.timing(native) != [1]
            or not all(value in info for value in ('Transformations: None', 'ICC Profile    : Absent',
                'Exif Metadata  : Absent', 'XMP Metadata   : Absent',
                f'Gain map       : 173x130 pixels, 8 bit, YUV444, Full Range, Matrix Coeffs. {facts["map"]["cicp"][2]},'))
            or len(alt) != 2 or not all(value in alt[1] for value in ('Color Primaries: 1', 'Transfer Char. : 16',
                'Matrix Coeffs. : 0', 'ICC Profile    : Absent', f'Bit Depth      : {facts["alternate"]["depths"][0]}', 'Planes         : 3'))):
        raise ValueError('Independent native AVIF decoder or ExifTool disagrees with actual output facts')
    facts['native_information'] = native
    codes, packet_facts = {}, {}
    for name, packet in packets.items():
        obu = directory/f'{name}.obu'
        obu.write_bytes(packet)
        stock = name == 'map' and not facts['known_map_matrix']
        packet_facts[name] = inspect_packet(obu, name, facts[name]['dimensions'], diagnostic_stock_matrix=stock)
        # This explicit fallback exists only for retained stock diagnostics.
        # Their structural gate remains false regardless of appearance.
        filters = ['-vf', 'scale=in_color_matrix=bt601:in_range=full:out_range=full'] if stock else []
        raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu', '-i', obu,
                           *filters, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
        if len(raw) != 173*130*3:
            raise ValueError('Independent AV1 packet decoded sample count disagrees with actual dimensions')
        codes[name] = np.frombuffer(raw, dtype=np.uint8).reshape(130, 173, 3)
        packet_facts[name].update({'path': str(obu), 'sha256': avif.digest(obu),
                                  'decoded_sha256': hashlib.sha256(raw).hexdigest()})
    avif.native(['avifdec', '-j', '1', '-c', 'dav1d', '-d', '8', path, directory/'base-native.png'])
    avif.native(['avifgainmaputil', 'extractgainmap', path, directory/'map-native.png', '-q', '100', '-s', '10'])
    facts['base_decoder_agreement'] = bool(np.array_equal(gainmap_avif_hdr._read_rgb8(directory/'base-native.png', (173, 130)), codes['base']))
    map_codes = gainmap_avif_hdr._read_rgb8(directory/'map-native.png', (173, 130))
    facts['map_decoder_agreement'] = bool(np.array_equal(map_codes, codes['map']))
    facts['map_decoder_maximum_code_difference'] = int(np.max(np.abs(map_codes.astype(int)-codes['map'].astype(int))))
    return facts, packet_facts, codes


def _measure(reference, actual, profile='gainmap-hdr'):
    return compare_appearance(reference, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class=profile)


def inspect_native_hdr(path):
    """Read the native gain-application bridge without inferring its transfer."""
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    kinds = [kind for kind, _ in chunks]
    expected = (b'IHDR', b'cHRM', b'cICP', b'IEND')
    if (any(kind not in (*expected, b'IDAT') for kind in kinds)
            or any(kinds.count(kind) != 1 for kind in expected) or b'IDAT' not in kinds
            or any(kinds.index(kind) > kinds.index(b'IDAT') for kind in expected[:-1])
            or any(kind != b'IDAT' for kind in kinds[kinds.index(b'IDAT'):-1])):
        raise ValueError('Unexpected native PQ bridge color, frame or metadata chunks')
    data = {kind: payload for kind, payload in chunks if kind != b'IDAT'}
    if (data[b'IHDR'] != struct.pack('>IIBBBBB', 173, 130, 16, 2, 0, 0, 0)
            or data[b'cICP'] != bytes((1, 16, 0, 1))
            or data[b'cHRM'] != struct.pack('>8I', *gainmap_avif_hdr_png.CHROMATICITIES)):
        raise ValueError('Expected static opaque native PQ RGB16 bridge in source sRGB primaries')
    exif = json.loads(avif.native(['exiftool', '-j', '-n', path]))[0]
    declared = {'ImageWidth': 173, 'ImageHeight': 130, 'BitDepth': 16, 'ColorType': 2,
                'ColorPrimaries': 1, 'TransferCharacteristics': 16, 'MatrixCoefficients': 0, 'VideoFullRangeFlag': 1}
    if any(exif.get(key) != value for key, value in declared.items()) or exif.get('Orientation', 1) != 1:
        raise ValueError('Independent ExifTool disagrees with native HDR reader bridge facts')
    raw = avif.native(['hdr-proof-png-decode', path])
    if len(raw) != 12+173*130*8 or struct.unpack('<III', raw[:12]) != (173, 130, 16):
        raise ValueError('Independent libpng disagrees with native HDR reader bridge precision or dimensions')
    rgba = np.frombuffer(raw[12:], dtype='<u2').reshape(130, 173, 4)
    if not np.all(rgba[..., 3] == 65535):
        raise ValueError('Native HDR reader bridge lost established opacity')
    facts = {'dimensions': [173, 130], 'cicp': [1, 16, 0, 1], 'libpng_source_depth': 16,
             'requested_native_precision': 12, 'opaque': True, 'static': True,
             'orientation': 1, 'pixel_aspect': 'square; pHYs absent',
             'rgba16_sha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
             'scope': 'Native libavif gain application requests precision12, stored by its PNG writer as actual RGB16; independent libpng reads the stored codes'}
    return facts, avif.decode_transfer(rgba[..., :3].astype(float)/65535, 'pq', 'srgb')


def _reconstruct_output(facts, codes):
    metadata = facts['metadata']
    low, high, gamma, base_offset, alternate_offset = [np.array([a/b for a, b in metadata[key]])
        for key in ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
    base_headroom, alternate_headroom = [a/b for a, b in (metadata['base_headroom'], metadata['alternate_headroom'])]
    weight = float(np.clip((POLICY['display_headroom_log2']-base_headroom)/(alternate_headroom-base_headroom), 0, 1))
    gain = low+(high-low)*(codes['map']/255)**(1/gamma)
    base = sdr_signal_to_nits(codes['base']/255, nominal_white_nits=203)/203
    actual = ((base+base_offset)*2**(gain*weight)-alternate_offset)*203
    if not np.all(np.isfinite(actual)):
        raise ValueError('Independent output HDR reconstruction is not finite')
    diagnostic = {'weight': weight, 'minimum_nits_before_clamp': float(actual.min()),
                  'negative_components_before_clamp': int(np.count_nonzero(actual < 0)),
                  'map_resampling': 'none; actual map and base dimensions agree'}
    return np.maximum(actual, 0), diagnostic


def _case(source, source_facts, native_source, linear, measurements, reference_sdr, reference_hdr, base, hdr, folder,
          candidate, tool, depth):
    folder.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    output = folder/'output.avif'
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:hdr:avif:preserve:preserve:contain:{candidate}',
            'cell_id': 'avif-gainmap:hdr:avif', 'fixture_id': gainmap_avif.FIXTURE_ID, 'candidate': candidate,
            'geometry': 'contain', 'selectors': SELECTORS, 'source_sha256': avif.digest(source), 'source_facts': source_facts,
            'native_source': native_source, 'native_geometry': linear,
            'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
            'checks': {name: False for name in ('known_source', 'source_appearance', 'map_sampling', 'linear_geometry_appearance',
                'native_hdr_storage', 'native_encoder', 'independent_decoder', 'structure', 'selectors',
                'base_storage', 'sdr_appearance', 'independent_hdr', 'native_hdr', 'decoder_agreement', 'appearance', 'privacy')},
            'measurements': dict(measurements), 'status': 'tested and failed', 'blockers': [],
            'consumer_status': 'pending manual review', 'artifacts': {}}
    try:
        avif.native([tool, 'combine', base, hdr, output, '--cicp-base', '1/13/0', '--cicp-alternate', '1/16/0', '--ignore-profile',
                     '--downscaling', '1', '--depth-gain-map', '8', '--qgain-map', '100', '--yuv-gain-map', '444',
                     '-y', '444', '-d', str(depth), '-q', '100', '-s', '10'])
        case['artifacts'] = {'source': str(source), 'source_sha256': avif.digest(source), 'output': str(output), 'sha256': avif.digest(output)}
        facts, packets, codes = inspect_output(output, folder/'inspection', diagnostic_stock_matrix=candidate.startswith('stock-'))
        selector_checks = {'base_depth_preserved': facts['base']['depths'] == source_facts['base']['depths'],
            'map_depth_preserved': set(facts['map']['depths']) == set(source_facts['map']['depths']),
            'alternate_depth_preserved': facts['alternate']['depths'] == source_facts['alternate']['depths']}
        actual_hdr, reconstruction = _reconstruct_output(facts, codes)
        native_path = folder/'native-hdr-pq.png'
        avif.native(['avifgainmaputil', 'tonemap', output, native_path, '--headroom', '4', '--cicp-output', '1/16/0',
                     '--ignore-profile', '-d', '12', '-y', '444'])
        native_hdr_facts, native_hdr = inspect_native_hdr(native_path)
        case['measurements'].update({'sdr': _measure(sdr_signal_to_nits(reference_sdr), sdr_signal_to_nits(codes['base']/255), 'gainmap-sdr'),
            'independent_hdr': _measure(reference_hdr, actual_hdr), 'native_hdr': _measure(reference_hdr, native_hdr),
            'decoder_agreement': _measure(actual_hdr, native_hdr)})
        tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', output]))[0]
        tags = {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}
        private = private_metadata_tags(tags)
        structure = {'known_map_matrix': facts['known_map_matrix'], 'base_decoder_agreement': facts['base_decoder_agreement'],
            'map_decoder_agreement': facts['map_decoder_agreement'], 'dimensions': all(facts[name]['dimensions'] == [173, 130] for name in ('base', 'map', 'alternate')),
            'square_pixels': facts['square_pixels'], 'opaque': facts['alpha'] == 'none', 'static': facts['frames'] == 1, 'orientation': facts['orientation'] == 1,
            'full_headroom_rendering': reconstruction['weight'] == 1 and native_source['weight'] == 1}
        checks = case['checks']
        checks.update({'known_source': True, 'source_appearance': measurements['source']['passed'], 'map_sampling': native_source['map_sampling']['passed'],
            'linear_geometry_appearance': measurements['linear_geometry']['passed'], 'native_hdr_storage': measurements['native_hdr_storage']['passed'],
            'native_encoder': True, 'independent_decoder': True, 'structure': all(structure.values()), 'selectors': all(selector_checks.values()),
            'base_storage': bool(np.array_equal(codes['base'], gainmap_avif_hdr._read_rgb8(base, (173, 130)))),
            'sdr_appearance': case['measurements']['sdr']['passed'], 'privacy': not private})
        checks.update({name: case['measurements'][name]['passed'] for name in ('independent_hdr', 'native_hdr', 'decoder_agreement')})
        checks['appearance'] = all(checks[name] for name in ('sdr_appearance', 'independent_hdr', 'native_hdr'))
        case.update({'facts': facts, 'packet_facts': packets, 'structural_checks': structure, 'selector_checks': selector_checks,
            'privacy_measurement': {'passed': not private, 'private_tags': private, 'metadata': tags},
            'output_reconstruction': reconstruction, 'native_hdr_artifact': {'path': str(native_path), 'sha256': avif.digest(native_path), 'facts': native_hdr_facts},
            'native_combine': {'tool': tool, 'sha256': avif.digest(shutil.which(tool)), 'requested_decode_depth': depth,
                'source_files': {name: avif.digest(Path(__file__).with_name(name)) for name in (
                    'gainmap-build.sh', 'libavif-full-range-gain.patch', 'libavif-small-offset-gain.patch',
                    'libavif-identity-gain.patch', 'libavif-moderate-offset-gain.patch')},
                'base_input': {'path': str(base), 'sha256': avif.digest(base)}, 'hdr_input': {'path': str(hdr), 'sha256': avif.digest(hdr)}},
            'adaptation_scope': {'qualified_display_headroom_log2': [4] if all(checks.values()) else [],
                'measured_display_headroom_log2': [4], 'intermediate_adaptation': 'untested',
                'source_alternate_headroom': source_facts['metadata']['alternate_headroom'],
                'output_alternate_headroom': facts['metadata']['alternate_headroom'],
                'scope': 'Authored SDR endpoint and declared full-headroom HDR endpoint only; no preservation claim for the source adaptation curve'}})
        case['blockers'] = [f'Failed {name} check' for name, passed in checks.items() if not passed]
        case['status'] = ('incompatible with the requested selectors' if not all(selector_checks.values())
                          else 'tested and failed' if case['blockers'] else 'qualified')
    except Exception as error:
        case['blockers'].append(str(error))
    case['commands'] = avif.COMMANDS[start:]
    return case


def _controls(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    original = gainmap_avif.copy_original(source, directory/'original.avif')
    controls = [{'case_id': 'gainmap-avif-preserve-original-exact-bytes', 'passed': original['exact_bytes'], 'original': original}]
    data = source.read_bytes()
    before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
    if data.count(before) != 1:
        raise ValueError('Expected one source base color declaration')
    changed = directory/'unknown-source.avif'
    changed.write_bytes(data.replace(before, b'nclx\x00\x02\x00\x0d\x00\x00\x80'))
    decision = source_decision(changed, directory/'unknown')
    copied = gainmap_avif.copy_original(changed, directory/'unknown-original.avif')
    controls.append({'case_id': 'gainmap-avif-preserve-unknown-source-original-only',
                     'passed': decision['action'] == 'original only' and copied['exact_bytes'], 'decision': decision, 'original': copied})
    for label, change in (('explicit-depth', {'depth': '8'}), ('other-gamut', {'gamut': 'p3'}),
                          ('other-geometry', {'fit': 'cover'}), ('animation', {'motion': 'animate'})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        controls.append({'case_id': f'gainmap-avif-preserve-{label}-withheld', 'passed': rejected})
    return [{**item, 'status': 'passed' if item['passed'] else 'tested and failed'} for item in controls]


def run(output_directory, *, source_lock=gainmap_avif.SOURCE_LOCK, selectors=None):
    validate_selectors(SELECTORS if selectors is None else selectors)
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source, fixture = gainmap_avif.generate_source(root/'source', source_lock=source_lock)
    inspection = root/'source-inspection'
    facts, base_codes = gainmap_avif_hdr._admit_source(source, inspection, source_lock)
    reference, mapped = gainmap_avif_hdr._reference(facts, base_codes, inspection)
    reference_path = root/'reference-source-nits.npy'
    np.save(reference_path, reference)
    reconstruction = root/'source-reconstruction'
    reconstruction.mkdir(exist_ok=True)
    native_source, actual_source = gainmap_avif_hdr._reconstruct(source, facts, inspection, mapped, reconstruction)
    linear = resample_linear(native_source, root/'hdr-linear.gbrapf32', 'contain')
    expected_hdr = array_geometry(reference, 'contain')
    initial, hdr = root/'initial-pq16.png', root/'hdr-pq16.png'
    gainmap_avif_hdr_png._write_original(linear, initial)
    gainmap_avif_hdr_png._write_square(initial, hdr)
    hdr_facts, hdr_pixels = gainmap_avif_hdr_png.inspect_and_decode(hdr)
    _, initial_pixels = gainmap_avif_hdr_png.inspect_and_decode(initial, diagnostic_undefined_aspect=True)
    if not np.array_equal(hdr_pixels, initial_pixels):
        raise ValueError('Native HDR square-pixel metadata correction changed input samples')
    native_linear = read_linear(linear)
    measurements = {'source': _measure(reference, actual_source), 'linear_geometry': _measure(expected_hdr, native_linear),
                    'native_hdr_storage': _measure(native_linear, avif.decode_transfer(hdr_pixels[..., :3], 'pq', 'srgb'))}
    sdr_reference = geometry(Image.fromarray(base_codes), 'contain')
    sdr_reference_path = root/'reference-sdr.png'
    sdr_reference.save(sdr_reference_path)
    horizontal, resized, base = root/'base-horizontal.png', root/'base-resized.png', root/'base-clean.png'
    sdr_filters = [_axis(['-i', reconstruction/'base-aom.png'], horizontal, 173, facts['base']['dimensions'][1]),
                   _axis(['-i', horizontal], resized, 173, 130)]
    clean_filter = 'format=rgb24,setsar=1,sidedata=mode=delete,setparams=color_primaries=1:color_trc=13:colorspace=0:range=full'
    avif.native(['ffmpeg', '-v', 'error', '-y', '-i', resized, '-vf', clean_filter, '-pix_fmt', 'rgb24',
                 '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', base])
    if not np.array_equal(gainmap_avif_hdr._read_rgb8(base, (173, 130)), gainmap_avif_hdr._read_rgb8(resized, (173, 130))):
        raise ValueError('Native SDR metadata cleanup changed authored base samples')
    cases = [_case(source, facts, native_source, linear, measurements, np.asarray(sdr_reference)/255, expected_hdr, base, hdr,
                   root/name, name, tool, depth) for name, tool, depth in (
        ('stock-auto', 'avifgainmaputil', 0), ('stock-depth8', 'avifgainmaputil', 8),
        ('moderateoffset-auto', '/opt/proof/libavif/moderateoffset/avifgainmaputil', 0),
        ('moderateoffset-depth8', '/opt/proof/libavif/moderateoffset/avifgainmaputil', 8))]
    for case in cases:
        case.update({'reference_hdr': {'path': str(reference_path), 'sha256': avif.digest(reference_path), 'revision': POLICY['reference_revision'], 'usage': 'Independent reference only; never native encoder input'},
            'reference_sdr': {'path': str(sdr_reference_path), 'sha256': avif.digest(sdr_reference_path), 'revision': POLICY['sdr_reference_revision'], 'usage': 'Independent reference only; never native encoder input'},
            'native_inputs': {'sdr_filters': sdr_filters, 'sdr_metadata_filter': clean_filter, 'sdr_cleanup_exact_samples': True,
                              'hdr_facts': hdr_facts, 'hdr_metadata_correction_exact_samples': True}})
    profile = {'candidate': 'native-antialiased-bilinear8-float32', 'reference_revision': POLICY['reference_revision'],
               'status': 'qualified' if native_source['map_sampling']['passed'] and measurements['source']['passed'] else 'tested and failed',
               'measurement': measurements['source'], 'native_source': native_source,
               'scope': 'Locked source reconstruction at log2 headroom4 only; output qualification and intermediate adaptation are separate'}
    fixture.update({'facts': facts, 'source_valid': True, 'source_reconstruction_profiles': [profile]})
    controls = _controls(source, root/'controls')
    return {'evidence': cases, 'fixtures': [], 'source_fixtures': [fixture], 'source_reconstruction_profiles': [profile],
            'controls': controls, 'scope': POLICY, 'commands': avif.COMMANDS[start:], 'consumer_status': 'pending manual review',
            'native_log_artifacts': [{'path': str(path), 'sha256': avif.digest(path), 'record': json.loads(path.read_text())}
                                     for path in sorted(root.rglob('*.log'))]}
