"""Original-size XMP JPEG to gain-map AVIF under the declared source renderer.

The native encoder preserves the actual base/map samples and gain parameters,
while stripping source EXIF/XMP. Independent BMFF/AV1 and original JPEG/XML
readers are measured at the same three display boosts. No resize, orientation,
other headroom or physical-consumer qualification follows from these cases.
"""
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_avif
import gainmap_xmp
import hdr_png
from appearance import compare_appearance, sdr_signal_to_nits, THRESHOLDS_SHA256
from gainmap_avif import _Reader, _boxes, _fractions, _unique
from gainmap_avif_hdr import _read_rgb8

SOURCE = gainmap_xmp.SOURCE
SOURCE_SHA256 = gainmap_xmp.SOURCE_SHA256
SELECTORS = {'format': 'avif', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
             'motion': 'preserve', 'transparency': 'preserve'}
POLICY = {
    'declared_before_native_measurements': True,
    'hdr_profile': 'gainmap-hdr', 'sdr_profile': 'gainmap-sdr', 'thresholds_sha256': THRESHOLDS_SHA256,
    'source_model': 'Locked legacy EXIF-sRGB JPEG, original native libjpeg samples, independent XML gain metadata and declared point-bilinear8 map sampling',
    'output_model': 'Direct dav1d AV1 packet samples and independently parsed tmap fractions; same declared point-bilinear8 map sampling',
    'source_sampling_revision': gainmap_xmp.SAMPLING_REVISION,
    'geometry': 'No resize, crop, orientation or raster transformation',
    'rationale': 'Original photographic authored SDR and same-boost HDR references use the unchanged regional gates; no import or codec allowance',
    'native_encoder': 'Pinned libavif/AOM lossless RGB8 base and grayscale8 map; source gain metadata retained',
    'privacy': 'Native avifenc ignores output EXIF/XMP independently of gain-map import; graph must contain only two AV1 items and one tmap',
    'primary_native_source': 'https://raw.githubusercontent.com/AOMediaCodec/libavif/v1.4.1/apps/shared/avifjpeg.c',
    'scope': 'Optional original-size conversion at boosts 2, source-full and 16 only; legacy source lacks the ICC required by the Android container specification',
}
DEPENDENCIES = ('xmp_identity_avif.py', 'test_xmp_identity_avif.py', 'gainmap_xmp.py', 'gainmap_avif.py',
    'gainmap_avif_hdr.py', 'gainmap.py', 'gainmap_iso.py', 'appearance.py', 'avif.py', 'hdr_png.py',
    'gainmap-build.sh', 'Dockerfile')


def parse_output(data):
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
        size, pixel, color = (_unique(props, kind)[1] for kind in (b'ispe', b'pixi', b'colr'))
        expected_size = [512, 384] if item == gain else [403, 302]
        expected_depth = [8] if item == gain else [8, 8, 8]
        if (len(size) != 12 or size[:4] != bytes(4) or pixel != bytes(4)+bytes([len(expected_depth), *expected_depth])
                or len(color) != 11 or color[:4] != b'nclx' or color[-1] & 127):
            raise ValueError('Invalid dimensions, plane depths or CICP representation')
        dimensions = list(struct.unpack('>II', size[4:]))
        if dimensions != expected_size:
            raise ValueError('Unexpected original base/map/alternate dimensions')
        facts = {'item_id': item, 'dimensions': dimensions, 'depths': list(pixel[5:]),
                 'cicp': [*struct.unpack('>HHH', color[4:10]), color[-1] >> 7],
                 'icc': 'absent', 'transformations': 'none', 'pixel_aspect': 'square; pasp absent'}
        if coded:
            config = _unique(props, b'av1C')[1]
            expected_config = b'\x81\x01\x1c\x00' if item == gain else b'\x81\x20\x00\x00'
            if config != expected_config:
                raise ValueError('Unknown AV1 configuration depth, profile, subsampling or reserved flags')
            facts['av1_configuration_hex'] = config.hex()
        return facts
    facts = {'base': image_facts(base, True), 'map': image_facts(gain, True),
             'alternate': image_facts(tone, False), 'metadata': _fractions(items[tone])}
    if (facts['base']['cicp'] != [1, 13, 0, 1] or facts['map']['cicp'] != [2, 2, 6, 1]
            or facts['alternate']['cicp'] != [1, 16, 0, 1]):
        raise ValueError('Unknown or unsupported base/map/alternate color signaling')
    facts.update({'orientation': 1, 'frames': 1, 'motion': 'static', 'alpha': 'none',
                  'square_pixels': True, 'private_metadata_items': []})
    return facts, {'base': items[base], 'map': items[gain]}


def match_metadata(source, output):
    fields = {'minimum': 'gain_map_min', 'maximum': 'gain_map_max', 'gamma': 'gamma',
              'base_offset': 'base_offset', 'alternate_offset': 'alternate_offset'}
    agreement = {name: source[name] == [n/d for n, d in output[other]] for name, other in fields.items()}
    agreement.update({name: source[name] == output[name][0]/output[name][1]
                      for name in ('base_headroom', 'alternate_headroom')})
    agreement['use_base_color_space'] = output['use_base_color_space'] is True
    if not all(agreement.values()):
        raise ValueError('Original XMP and actual output tmap gain metadata disagree')
    return agreement


def inspect_output(path, directory):
    path, directory = Path(path), Path(directory)
    facts, packets = parse_output(path.read_bytes())
    directory.mkdir(parents=True, exist_ok=True)
    native = avif.inspect_avif(path)
    info, exif = native['info'], native['exiftool']
    expected = {'ImageWidth': 403, 'ImageHeight': 302, 'ColorPrimaries': 1, 'TransferCharacteristics': 13,
                'MatrixCoefficients': 0, 'VideoFullRangeFlag': 1, 'ImagePixelDepth': '8 8 8'}
    alternate = info.split(' * Alternate image:', 1)
    if (any(exif.get(key) != value for key, value in expected.items()) or exif.get('Orientation', 1) != 1
            or [native[key] for key in ('width', 'height', 'depth', 'primaries', 'transfer', 'matrix')] != [403, 302, 8, 1, 13, 0]
            or native['alpha'] != 'Absent' or avif.timing(native) != [1]
            or not all(value in info for value in ('Transformations: None', 'ICC Profile    : Absent',
                'Exif Metadata  : Absent', 'XMP Metadata   : Absent',
                'Gain map       : 512x384 pixels, 8 bit, YUV400, Full Range, Matrix Coeffs. 6,'))
            or len(alternate) != 2 or not all(value in alternate[1] for value in ('Color Primaries: 1',
                'Transfer Char. : 16', 'Matrix Coeffs. : 0', 'ICC Profile    : Absent', 'Bit Depth      : 8', 'Planes         : 3'))):
        raise ValueError('Native decoder or ExifTool disagrees with independently parsed AVIF structure')
    tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', path]))[0]
    private = gainmap.private_metadata_tags(tags)
    if private:
        raise ValueError('Output retains private metadata')
    codes, packet_facts = {}, {}
    for name, packet in packets.items():
        obu = directory/f'{name}.obu'
        packet_binding = {'path': str(obu), 'sha256': hashlib.sha256(packet).hexdigest()}
        obu.write_bytes(packet)
        width, height = facts[name]['dimensions']
        inspected = gainmap_avif.inspect_packet(obu, name, [width, height])
        raw = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu', '-i', obu,
                           '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24' if name == 'base' else 'gray', 'pipe:1'])
        shape = (height, width, 3) if name == 'base' else (height, width)
        if len(raw) != math.prod(shape):
            raise ValueError('Independent AV1 packet sample count disagrees with actual dimensions')
        _recheck([packet_binding])
        codes[name] = np.frombuffer(raw, np.uint8).reshape(shape)
        packet_facts[name] = {**packet_binding, 'native_packet_facts': inspected,
                              'decoded_sha256': hashlib.sha256(raw).hexdigest()}
    base_png, map_png = directory/'base-native.png', directory/'map-native.png'
    avif.native(['avifdec', '-j', '1', '-c', 'dav1d', '-d', '8', path, base_png])
    avif.native(['avifgainmaputil', 'extractgainmap', path, map_png, '-q', '100', '-s', '10'])
    if (not np.array_equal(_read_rgb8(base_png, (403, 302)), codes['base'])
            or not np.array_equal(_read_rgb8(map_png, (512, 384)), np.repeat(codes['map'][..., None], 3, axis=-1))):
        raise ValueError('Whole-file native and independent AV1 packet samples disagree')
    facts.update({'native_information': native, 'private_tags': private, 'metadata_tags': tags,
                  'packet_facts': packet_facts, 'native_sample_agreement': True})
    _recheck(list(packet_facts.values()))
    return facts, codes


def reconstruct(facts, codes, boost):
    """Output reader uses actual AV1 samples and parsed tmap, never source gains."""
    if not np.isfinite(boost) or boost < 1:
        raise ValueError('Expected a finite display boost of at least one')
    metadata = facts['metadata']
    low, high, gamma, offset, alternate = [np.array([n/d for n, d in metadata[name]])
        for name in ('gain_map_min', 'gain_map_max', 'gamma', 'base_offset', 'alternate_offset')]
    a, b = [metadata[name][0]/metadata[name][1] for name in ('base_headroom', 'alternate_headroom')]
    weight = float(np.clip((math.log2(boost)-a)/(b-a), 0, 1))
    mapped = gainmap_xmp.sample_map(codes['map'], tuple(facts['base']['dimensions']))
    base = sdr_signal_to_nits(codes['base']/255, nominal_white_nits=203)
    if weight == 0:
        return base, weight
    gain = low+(high-low)*(mapped[..., None]/255)**(1/gamma)
    return np.maximum(((base/203+offset)*2**(gain*weight)-alternate)*203, 0), weight


def source_decision(source, directory):
    return gainmap_xmp.source_decision(source, directory)


def _bound(path):
    return {'path': str(path), 'sha256': avif.digest(path)}


def _recheck(bindings):
    for item in bindings:
        if avif.digest(item['path']) != item['sha256']:
            raise ValueError(f"Changed bound file: {item['path']}")


def _controls(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    original = directory/'original.jpg'
    original.write_bytes(source.read_bytes())
    controls = [{'case_id': 'xmp-identity-avif-original-exact-bytes',
                 'passed': avif.digest(original) == SOURCE_SHA256, 'original': _bound(original)}]
    unknown = directory/'unknown.jpg'
    unknown.write_bytes(source.read_bytes()+b'unknown source provenance')
    decision = source_decision(unknown, directory/'unknown')
    controls.append({'case_id': 'xmp-identity-avif-unknown-source-original-only',
        'passed': decision['status'] == 'original only' and avif.digest(decision['original']) == avif.digest(unknown),
        'decision': decision})
    return [{**row, 'status': 'passed' if row['passed'] else 'tested and failed'} for row in controls]


def run(directory, *, source=SOURCE, operation='identity', selectors=None):
    if operation != 'identity' or selectors is not None and selectors != SELECTORS:
        raise ValueError('Only the exact original-size HDR AVIF preserve-depth selectors are admitted')
    source, directory = Path(source), Path(directory)
    if avif.digest(source) != SOURCE_SHA256:
        raise ValueError('Unknown XMP source provenance; original only')
    bindings = [{'path': str(source), 'sha256': SOURCE_SHA256}]
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source_hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in DEPENDENCIES}
    binaries = ('avifenc', 'avifdec', 'avifgainmaputil', 'ffmpeg', 'ffprobe', 'hdr-proof-png-decode', 'exiftool')
    native_hashes = {shutil.which(name): avif.digest(shutil.which(name)) for name in binaries}
    decoded = gainmap_xmp.read_source(source, directory/'source')
    source_facts, source_map = decoded['evidence'], directory/'source/map.jpg'
    bindings.append({'path': str(source_map), 'sha256': source_facts['gain_map_sha256']})
    _recheck(bindings)
    with Image.open(source) as image:
        source_base = np.asarray(image.convert('RGB'))
    with Image.open(source_map) as image:
        map_samples = np.asarray(image)
    sdr_path = directory/'reference-sdr.png'
    Image.fromarray(source_base).save(sdr_path)
    reference_sdr = {**_bound(sdr_path), 'gamut': 'srgb', 'transfer': 'srgb',
                     'revision': 'gainmap-xmp-original-authored-base-v1', 'purpose': 'Independent original JPEG authored SDR; no raster geometry'}
    bindings.append(_bound(sdr_path))
    source_metadata = source_facts['metadata']
    capacity = source_metadata['alternate_headroom']
    renderings = [('boost2', 2, 'gainmap-xmp-intermediate-boost2-v1'),
        ('source-full', 2**capacity, 'gainmap-xmp-independent-source-full-v1'),
        ('boost16', 16, 'gainmap-xmp-independent-boost16-v1')]
    cases = []
    for label, boost, revision in renderings:
        cases.append({'case_id': f'gainmap-android-xmp:hdr:avif:preserve:preserve:identity:original-map:render-{label}',
            'proof_module': 'xmp_identity_avif', 'candidate': 'native-xmp-identity-gainmap-avif-'+label,
            'fixture_id': 'gainmap-android-xmp', 'cell_id': 'gainmap-jpeg:hdr:avif', 'geometry': 'identity',
            'selectors': dict(SELECTORS), 'source_sha256': SOURCE_SHA256, 'source_facts': source_facts,
            'source_reference_revision': revision, 'status': 'tested and failed', 'consumer_status': 'pending manual review',
            'qualification_scope': 'Optional no-resize conversion of the locked legacy EXIF-sRGB source under its declared point-bilinear8 renderer, at this exact display boost only.',
            'known_consumer_limitations': ['The original JPEG lacks the ICC required by the Android container specification; this named legacy source model is explicit.',
                'No resized, cropped, reoriented or other-headroom qualification follows.',
                'Mac, iPad, Windows and Galaxy browser/native viewer/wallpaper checks remain pending manual review.'],
            'rendering_scope': {'label': label, 'display_boost': boost, 'headroom_log2': math.log2(boost),
                'source_reference_revision': revision, 'headroom_is_product_selector': False, 'required_product_path': False,
                'source_capacity_headroom_log2': capacity, 'sdr_white_nits': 203},
            'threshold_scope': POLICY, 'reference_sdr': reference_sdr,
            'checks': {name: False for name in ('native_encoder', 'independent_source_decoder', 'independent_decoder',
                'source_samples', 'gain_metadata', 'structure', 'privacy', 'same_file', 'appearance')},
            'measurements': {}, 'artifacts': {}, 'blockers': []})
    report = {'scope': POLICY, 'evidence': cases, 'source_facts': source_facts,
        'fixtures': [], 'source_fixtures': [], 'controls': _controls(source, directory/'controls'),
        'consumer_status': 'pending manual review', 'source_hashes': source_hashes, 'native_binary_sha256': native_hashes}
    output = directory/'output.avif'
    try:
        _recheck(bindings)
        # Only the original JPEG reaches the native encoder. Reference pixels
        # and independent XMP arithmetic are measurement inputs, never pixels
        # or gain parameters supplied to the encoder.
        avif.native(['avifenc', '-c', 'aom', '-j', '1', '-s', '10', '-q', '100', '--qgain-map', '100',
            '-y', '444', '-d', '8', '--cicp', '1/13/0', '--ignore-exif', '--ignore-xmp', '--ignore-profile', source, output])
        output_bound = _bound(output)
        bindings.append(output_bound)
        for case in cases:
            case['checks']['native_encoder'] = True
            case['artifacts'] = {'output': str(output), 'sha256': output_bound['sha256'], 'source': str(source), 'source_sha256': SOURCE_SHA256}
        facts, codes = inspect_output(output, directory/'inspection')
        bindings.extend({'path': item['path'], 'sha256': item['sha256']} for item in facts['packet_facts'].values())
        _recheck(bindings)
        metadata_agreement = match_metadata(source_metadata, facts['metadata'])
        sample_agreement = {'base': bool(np.array_equal(codes['base'], source_base)),
                            'map': bool(np.array_equal(codes['map'], map_samples))}
        report['original_sample_agreement'] = sample_agreement
        report['gain_metadata_agreement'] = metadata_agreement
        if not all(sample_agreement.values()):
            raise ValueError('Native conversion changed original base/map samples')
        sdr = compare_appearance(sdr_signal_to_nits(source_base/255), sdr_signal_to_nits(codes['base']/255),
                                reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        for case in cases:
            boost = case['rendering_scope']['display_boost']
            reference = gainmap_xmp.decode_xmp_source(source.read_bytes(), source_map.read_bytes(), headroom=math.log2(boost))
            expected = reference['linear_rgb_nits']
            reference_path = directory/f"reference-{case['rendering_scope']['label']}.rgbf64"
            expected.astype('<f8').tofile(reference_path)
            bindings.append(_bound(reference_path))
            case['reference_hdr'] = {**_bound(reference_path), 'gamut': 'srgb', 'units': 'cd/m2',
                'dimensions': [403, 302], 'display_boost': boost, 'revision': case['source_reference_revision']}
            case['source_decoder_evidence'] = {**reference['evidence'], 'geometry': 'none'}
            independent, weight = reconstruct(facts, codes, boost)
            native_path = directory/f"native-{case['rendering_scope']['label']}.png"
            avif.native(['avifgainmaputil', 'tonemap', output, native_path, '--headroom', str(math.log2(boost)),
                '--cicp-output', '9/16/0', '--ignore-profile', '-d', '12', '-y', '444'])
            native_binding = _bound(native_path)
            bindings.append(native_binding)
            native_facts, native_rgba = hdr_png.inspect_source(native_path), avif.read_png(native_path)
            _recheck(bindings)
            if ((native_facts['width'], native_facts['height'], native_facts['depth'], native_facts['orientation']) != (403, 302, 16, 1)
                    or [native_facts['primaries'], native_facts['transfer'], native_facts['matrix'], int(native_facts['full_range'])] != [9, 16, 0, 1]
                    or native_rgba.shape != (302, 403, 4) or not np.all(native_rgba[..., 3] == 1)):
                raise ValueError('Actual native HDR rendering signaling, dimensions or opacity changed')
            native = avif.decode_transfer(native_rgba[..., :3], 'pq', 'rec2020')
            measure = lambda target, actual, gamut: compare_appearance(target, actual,
                reference_gamut='srgb', actual_gamut=gamut, fixture_class='gainmap-hdr')
            measurements = {'sdr': sdr, 'independent_hdr': measure(expected, independent, 'srgb'),
                'native_hdr': measure(expected, native, 'rec2020'), 'reader_agreement': measure(independent, native, 'rec2020')}
            _recheck(bindings)
            source_weight = reference['evidence']['gain_map_weight']
            case['rendering_scope'].update({'source_gain_map_weight': source_weight, 'output_gain_map_weight': weight,
                'output_capacity_headroom_log2': facts['metadata']['alternate_headroom'][0]/facts['metadata']['alternate_headroom'][1]})
            case.update({'facts': facts, 'measurements': measurements,
                'native_rendering': {**native_binding, 'facts': native_facts, 'display_boost': boost,
                    'requested_native_depth': 12, 'actual_png_storage_depth': 16, 'purpose': 'Native HDR reader measurement; not a separate conversion qualification'}})
            case['checks'].update({'independent_source_decoder': True, 'independent_decoder': True,
                'source_samples': all(sample_agreement.values()), 'gain_metadata': all(metadata_agreement.values()) and weight == source_weight,
                'structure': True, 'privacy': not facts['private_tags'], 'same_file': avif.digest(output) == output_bound['sha256'],
                'appearance': all(value['passed'] for value in measurements.values())})
            case['blockers'] = [f'Failed {name} check' for name, passed in case['checks'].items() if not passed]
            if not case['blockers']:
                case['status'] = 'qualified'
        _recheck(bindings)
        for name, sha in source_hashes.items():
            if avif.digest(Path(__file__).with_name(name)) != sha:
                raise ValueError('Changed bound proof source: '+name)
        for path, sha in native_hashes.items():
            if avif.digest(path) != sha:
                raise ValueError('Changed bound native binary: '+path)
    except (ValueError, RuntimeError, OSError) as error:
        for case in cases:
            case['status'] = 'tested and failed'
            case['checks']['same_file'] = False
            case['blockers'].append(str(error))
    report['same_file_all_renderings'] = {'passed': all(case['status'] == 'qualified' for case in cases),
        'output_sha256': cases[0]['artifacts'].get('sha256'),
        'display_boosts': [case['rendering_scope']['display_boost'] for case in cases],
        'scope': 'This optional original-size file and three named renderings only; no required resized adaptation evidence'}
    report['bindings'] = bindings
    report['commands'] = avif.COMMANDS[start:]
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
