"""Bounded gain-map AVIF source inspection, independent of its native encoder.

Only the locked static RGB8 sRGB base with a monochrome eight-bit map is admitted.
The BMFF parser reads actual item associations and tmap fractions. Direct AV1
items are decoded by FFmpeg/dav1d and checked against libavif/dav1d PNG samples.
This inspector establishes the authored SDR base. HDR reconstruction requires
the separate, explicitly named renderer profiles in gainmap_avif_hdr.py.
No decoded reference array is supplied to a native encoder.
"""
import hashlib
import json
from pathlib import Path
import shutil
import struct

import numpy as np

import avif
from gainmap import private_metadata_tags


ROOT = Path(__file__).parent
SOURCE_LOCK = ROOT/'fixtures/gainmap-avif-source-sha256.json'
FIXTURE_ID = 'avif-gainmap-from-android-xmp'


class _Reader:
    def __init__(self, data):
        self.data, self.position = data, 0

    def take(self, count):
        if count < 0 or self.position + count > len(self.data):
            raise ValueError('Truncated gain-map AVIF metadata')
        value = self.data[self.position:self.position + count]
        self.position += count
        return value

    def number(self, count, *, signed=False):
        return int.from_bytes(self.take(count), 'big', signed=signed)

    def end(self):
        if self.position != len(self.data):
            raise ValueError('Unexpected trailing gain-map AVIF metadata')


def _boxes(data, offset=0):
    reader = _Reader(data)
    result = []
    while reader.position < len(data):
        start = reader.position
        size, kind = struct.unpack('>I4s', reader.take(8))
        if size < 8:
            raise ValueError('Only bounded 32-bit BMFF boxes are admitted')
        result.append((kind, reader.take(size - 8), offset + start + 8))
    return result


def _unique(boxes, kind):
    found = [item for item in boxes if item[0] == kind]
    if len(found) != 1:
        raise ValueError(f'Expected one {kind.decode()} box')
    return found[0]


def _fractions(payload):
    reader = _Reader(payload)
    if reader.take(5) != bytes(5):
        raise ValueError('Unknown gain-map metadata version; original only')
    flags = reader.number(1)
    if flags & 63:
        raise ValueError('Unknown gain-map metadata flags; original only')
    def fraction(signed=False):
        pair = [reader.number(4, signed=signed), reader.number(4)]
        if pair[1] == 0:
            raise ValueError('Unknown gain-map fraction denominator; original only')
        return pair
    result = {'use_base_color_space': bool(flags & 64), 'base_headroom': fraction(),
              'alternate_headroom': fraction()}
    names = ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')
    channels = [[fraction(signed=name != 'gamma') for name in names]
                for _ in range(3 if flags & 128 else 1)]
    if len(channels) == 1:
        channels *= 3
    for index, name in enumerate(names):
        result[name] = [channel[index] for channel in channels]
    reader.end()
    if (result['base_headroom'][0] != 0 or result['alternate_headroom'][0] <= 0
            or not result['use_base_color_space']):
        raise ValueError('Known SDR base and positive alternate headroom are required')
    for low, high, gamma, base_offset, alternate_offset in channels:
        if (low[0]/low[1] > high[0]/high[1] or gamma[0] <= 0
                or base_offset[0] < 0 or alternate_offset[0] < 0):
            raise ValueError('Unsupported gain-map metadata values')
    return result


def parse_source(data):
    """Inspect the narrow static item representation; reject unknown semantics."""
    top = _boxes(data)
    if any(kind not in (b'ftyp', b'meta', b'mdat') for kind, _, _ in top):
        raise ValueError('Only the bounded static AVIF item representation is admitted')
    brand = _unique(top, b'ftyp')[1]
    if len(brand) < 12 or len(brand) % 4 or brand[:4] != b'avif' or b'tmap' not in [brand[i:i+4] for i in range(8, len(brand), 4)]:
        raise ValueError('Expected AVIF and tone-map item brand declarations')
    _, media, media_offset = _unique(top, b'mdat')
    _, meta, meta_offset = _unique(top, b'meta')
    if meta[:4] != bytes(4):
        raise ValueError('Unsupported AVIF meta version')
    boxes = _boxes(meta[4:], meta_offset + 4)
    pitm = _unique(boxes, b'pitm')[1]
    if len(pitm) != 6 or pitm[:4] != bytes(4):
        raise ValueError('Unsupported primary item reference')
    primary = int.from_bytes(pitm[4:], 'big')
    locations = _Reader(_unique(boxes, b'iloc')[1])
    if locations.take(6) != b'\x00\x00\x00\x00\x44\x00':
        raise ValueError('Unsupported AVIF item location representation')
    items, extents = {}, []
    for _ in range(locations.number(2)):
        item, reference, count = locations.number(2), locations.number(2), locations.number(2)
        start, length = locations.number(4), locations.number(4)
        if (item in items or reference != 0 or count != 1 or length == 0
                or start < media_offset or start + length > media_offset + len(media)):
            raise ValueError('Invalid or external AVIF item extent')
        items[item] = data[start:start + length]
        extents.append((start, start + length))
    locations.end()
    if any(a[1] > b[0] for a, b in zip(sorted(extents), sorted(extents)[1:])):
        raise ValueError('Overlapping AVIF item extents')
    information = _unique(boxes, b'iinf')[1]
    if information[:4] != bytes(4) or len(information) < 6:
        raise ValueError('Unsupported AVIF item information')
    entries, types = _boxes(information[6:]), {}
    if len(entries) != int.from_bytes(information[4:6], 'big'):
        raise ValueError('AVIF item count mismatch')
    for kind, entry, _ in entries:
        if kind != b'infe' or len(entry) < 13 or entry[:4] not in (b'\x02\x00\x00\x00', b'\x02\x00\x00\x01') or entry[6:8] != bytes(2):
            raise ValueError('Unsupported or protected AVIF item')
        item = int.from_bytes(entry[4:6], 'big')
        if item in types:
            raise ValueError('Duplicate AVIF item identity')
        types[item] = entry[8:12]
    if set(types) != set(items) or sorted(types.values()) != [b'Exif', b'av01', b'av01', b'mime', b'tmap']:
        raise ValueError('Unknown source image or metadata item set')
    tone_item = next(item for item, kind in types.items() if kind == b'tmap')
    refs = _unique(boxes, b'iref')[1]
    if refs[:4] != bytes(4):
        raise ValueError('Unsupported item-reference version')
    derived = [entry for kind, entry, _ in _boxes(refs[4:]) if kind == b'dimg']
    if len(derived) != 1 or len(derived[0]) != 8:
        raise ValueError('One base/map derived-image reference is required')
    owner, count, base, gain = struct.unpack('>HHHH', derived[0])
    if owner != tone_item or count != 2 or base != primary or base == gain or types.get(base) != b'av01' or types.get(gain) != b'av01':
        raise ValueError('Gain-map source does not identify the authored primary base')
    properties = _boxes(_unique(boxes, b'iprp')[1])
    property_list = _boxes(_unique(properties, b'ipco')[1])
    associations = _Reader(_unique(properties, b'ipma')[1])
    if associations.take(4) != bytes(4):
        raise ValueError('Unsupported item-property association version')
    attached = {}
    for _ in range(associations.number(4)):
        item, count = associations.number(2), associations.number(1)
        if item in attached:
            raise ValueError('Duplicate item-property association')
        attached[item] = []
        for _ in range(count):
            index = associations.number(1) & 127
            if index < 1 or index > len(property_list):
                raise ValueError('Invalid AVIF property index')
            attached[item].append(property_list[index - 1])
    associations.end()
    if set(attached) != {base, gain, tone_item}:
        raise ValueError('Unexpected AVIF item properties')
    def image_facts(item, coded):
        props = attached[item]
        allowed = (b'ispe', b'pixi', b'colr', b'av1C') if coded else (b'ispe', b'pixi', b'colr')
        if sorted(kind for kind, _, _ in props) != sorted(allowed):
            raise ValueError('Unknown, missing or conflicting source properties, color profile or orientation')
        size, pixel, color = (_unique(props, kind)[1] for kind in (b'ispe', b'pixi', b'colr'))
        if len(size) != 12 or size[:4] != bytes(4) or len(pixel) < 6 or pixel[:4] != bytes(4) or len(pixel) != 5 + pixel[4]:
            raise ValueError('Invalid image dimensions/depth properties')
        if len(color) != 11 or color[:4] != b'nclx' or color[-1] & 127:
            raise ValueError('Known unambiguous CICP color signaling is required')
        dimensions = list(struct.unpack('>II', size[4:]))
        depths = list(pixel[5:])
        cicp = [*struct.unpack('>HHH', color[4:10]), color[-1] >> 7]
        if min(dimensions) <= 0 or max(dimensions) > 4096 or any(depth != 8 for depth in depths):
            raise ValueError('Only bounded eight-bit source images are admitted')
        if coded:
            config = _unique(props, b'av1C')[1]
            # Exact bounded RGB444 profile1/level0 and monochrome profile0/
            # level1 configurations. This also rejects tier, high_bitdepth,
            # twelve_bit, reserved and initial-presentation-delay changes.
            expected = b'\x81\x20\x00\x00' if len(depths) == 3 else b'\x81\x01\x1c\x00'
            if config != expected:
                raise ValueError('Unsupported AV1 configuration, depth, profile or subsampling')
        result = {'item_id': item, 'dimensions': dimensions, 'depths': depths, 'cicp': cicp,
                  'icc': 'absent', 'transformations': 'none'}
        if coded:
            result['av1_configuration_hex'] = config.hex()
        return result
    facts = {'base': image_facts(base, True), 'map': image_facts(gain, True),
             'alternate': image_facts(tone_item, False), 'metadata': _fractions(items[tone_item])}
    if (facts['base']['cicp'] != [1, 13, 0, 1] or facts['base']['depths'] != [8, 8, 8]
            or facts['map']['cicp'] != [2, 2, 6, 1] or facts['map']['depths'] != [8]
            or facts['alternate']['cicp'] != [1, 16, 0, 1]
            or facts['alternate']['depths'] != [8, 8, 8]
            or facts['alternate']['dimensions'] != facts['base']['dimensions']):
        raise ValueError('Unknown or unsupported base/map color/depth facts; original only')
    facts.update({'orientation': 1, 'frames': 1, 'motion': 'static', 'alpha': 'none',
                  'authored_sdr_basis': 'Primary sRGB image with zero base headroom in independently parsed tmap metadata',
                  'hdr_reconstruction': 'untested'})
    return facts, items[base], items[gain]


def inspect_packet(path, name, dimensions):
    """Check native AV1 payload facts before any requested raw-depth conversion."""
    if name not in ('base', 'map'):
        raise ValueError('Expected a base or map AV1 packet')
    entries = ('frame=media_type,width,height,pix_fmt,color_range,color_space,color_primaries,color_transfer,crop_top,crop_bottom,crop_left,crop_right:'
               'stream=codec_name,codec_type,profile,width,height,pix_fmt,color_range,color_space,color_primaries,color_transfer,nb_read_frames')
    result = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu',
                                     '-show_frames', '-show_streams', '-show_entries', entries, '-of', 'json', path]))
    frames, streams = result.get('frames', []), result.get('streams', [])
    if len(frames) != 1 or len(streams) != 1 or streams[0].get('codec_name') != 'av1':
        raise ValueError('Expected exactly one decoded AV1 packet image')
    pixel_format = 'gbrp' if name == 'base' else 'gray'
    for observed in (frames[0], streams[0]):
        if observed.get('pix_fmt') != pixel_format:
            raise ValueError('AV1 packet native pixel format/depth disagrees with the eight-bit source')
        if [observed.get('width'), observed.get('height')] != dimensions or observed.get('color_range') != 'pc':
            raise ValueError('AV1 packet dimensions or full range disagree with the source container')
        expected_color = ['gbr', 'bt709', 'iec61966-2-1'] if name == 'base' else ['smpte170m', None, None]
        if [observed.get(key) for key in ('color_space', 'color_primaries', 'color_transfer')] != expected_color:
            raise ValueError('AV1 packet color signaling disagrees with the source container')
    if (streams[0].get('profile') != ('High' if name == 'base' else 'Main')
            or streams[0].get('nb_read_frames') != '1'
            or any(frames[0].get(key, 0) != 0 for key in ('crop_top', 'crop_bottom', 'crop_left', 'crop_right'))):
        raise ValueError('Unexpected AV1 packet profile, frame count or crop')
    return result


def inspect_source(path, directory):
    path, directory = Path(path), Path(directory)
    facts, base_packet, map_packet = parse_source(path.read_bytes())
    directory.mkdir(parents=True, exist_ok=True)
    native = avif.inspect_avif(path)
    exif = native['exiftool']
    map_width, map_height = facts['map']['dimensions']
    map_description = f'Gain map       : {map_width}x{map_height} pixels, 8 bit, YUV400, Full Range, Matrix Coeffs. 6,'
    if ([native['width'], native['height']] != facts['base']['dimensions']
            or native['depth'] != 8 or native['alpha'] != 'Absent' or avif.timing(native) != [1]
            or [native['primaries'], native['transfer'], native['matrix']] != facts['base']['cicp'][:3]
            or 'Transformations: None' not in native['info']
            or [exif.get(key) for key in ('ColorPrimaries', 'TransferCharacteristics', 'MatrixCoefficients', 'VideoFullRangeFlag')] != facts['base']['cicp']
            or exif.get('Orientation', 1) != 1 or exif.get('ImagePixelDepth') != '8 8 8'
            or map_description not in native['info']):
        raise ValueError('Native source decoder/ExifTool disagrees with inspected source facts')
    tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', path]))[0]
    tags = {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}
    facts.update({'native_information': native, 'privacy_metadata': tags, 'private_tags': private_metadata_tags(tags),
                  'native_metadata_printer': avif.native(['avifgainmaputil', 'printmetadata', path]).decode(),
                  'metadata_printer_limitation': 'Pinned libavif 1.4.1 FormatFractions prints channel zero three times; the independent tmap fractions above are authoritative'})
    packets = {}
    decoded = {}
    for name, packet, pixel_format, channels in (('base', base_packet, 'rgb24', 3), ('map', map_packet, 'gray', 1)):
        obu = directory/f'{name}.obu'
        obu.write_bytes(packet)
        width, height = facts[name]['dimensions']
        packet_facts = inspect_packet(obu, name, [width, height])
        raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu', '-i', obu,
                           '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', pixel_format, 'pipe:1'])
        if len(raw) != width * height * channels:
            raise ValueError('Independent AV1 packet decoder dimensions disagree with source metadata')
        decoded[name] = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, channels)
        packets[name] = {'sha256': hashlib.sha256(packet).hexdigest(), 'decoded_sha256': hashlib.sha256(raw).hexdigest(),
                         'native_facts': packet_facts,
                         'decoder': 'FFmpeg/libdav1d from exact BMFF AV1 item bytes, without AVIF re-encoding'}
    avif.native(['avifdec', '-j', '1', '-c', 'dav1d', '-d', '8', path, directory/'base-dav1d.png'])
    avif.native(['avifgainmaputil', 'extractgainmap', path, directory/'map-native.png', '-q', '100', '-s', '10'])
    base_png = np.rint(avif.read_png(directory/'base-dav1d.png')[..., :3] * 255).astype(np.uint8)
    map_png = np.rint(avif.read_png(directory/'map-native.png')[..., :3] * 255).astype(np.uint8)
    facts.update({'base_decoder_agreement': bool(np.array_equal(base_png, decoded['base'])),
                  'map_decoder_agreement': bool(np.array_equal(map_png, np.repeat(decoded['map'], 3, axis=2))),
                  'packet_samples': packets})
    if not facts['base_decoder_agreement'] or not facts['map_decoder_agreement']:
        raise ValueError('Independent source base/map AV1 samples disagree')
    return facts, decoded['base']


def source_decision(path, directory):
    path = Path(path)
    try:
        facts, _ = inspect_source(path, directory)
        return {'action': 'authored SDR candidate only', 'source_valid': True, 'facts': facts, 'sha256': avif.digest(path)}
    except (ValueError, RuntimeError) as error:
        return {'action': 'original only', 'source_valid': False, 'reason': str(error), 'sha256': avif.digest(path)}


def copy_original(source, output):
    shutil.copyfile(source, output)
    return {'exact_bytes': Path(source).read_bytes() == Path(output).read_bytes(), 'sha256': avif.digest(output)}


def generate_source(directory, *, source_lock=SOURCE_LOCK):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    lock = json.loads(Path(source_lock).read_text())
    parent = ROOT/'fixtures'/lock['parent']['path']
    if avif.digest(parent) != lock['parent']['sha256']:
        raise ValueError('Gain-map AVIF parent source hash mismatch; conversion withheld')
    output = directory/f'{FIXTURE_ID}.avif'
    avif.native(['avifgainmaputil', 'convert', parent, output, '--cicp', '1/13/0', '--ignore-profile',
                 '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'])
    digest = avif.digest(output)
    if digest != lock['sha256'].get(FIXTURE_ID):
        raise ValueError('Gain-map AVIF source hash mismatch; conversion withheld')
    return output, {'id': FIXTURE_ID, 'path': str(output), 'sha256': digest,
                    'parent': {'path': str(parent), 'sha256': avif.digest(parent),
                               'provenance': 'fixtures/gainmap/manifest.json'},
                    'source_lock': {'passed': True, 'path': str(source_lock), 'lock_sha256': avif.digest(source_lock)}}
