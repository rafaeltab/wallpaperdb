"""Old Apple documented full-effect diagnostic, not conversion qualification.

Apple describes inverse Rec.709 map encoding followed by linear gain. The
pinned libavif importer instead retains the coded map and assigns logarithmic
gain metadata. Both interpretations are measured separately; existing source
references remain unchanged. This module does not infer intermediate display
adaptation or the semantics of the newer, manually transplanted XMP fixture.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

import avif
import gainmap
import hdr_png
from appearance import THRESHOLDS_SHA256, compare_appearance, sdr_signal_to_nits
from gainmap_avif import _Reader, _boxes, _fractions, _unique
from gainmap_iso import _base_color_facts, segments

SOURCE = gainmap.FIXTURES/'gainmap-apple-old.jpg'
SOURCE_SHA256 = '2e4310a0dd37a98678e057e25d936bbc4f936bb6fe17380c0ce99e58ecaa603b'
MAP_SHA256 = 'fbe1522aabb91ad7b56710b3bcb8b1ceb7e35c908eba6a0730217b041ddf6348'
REFERENCE_REVISION = 'apple-old-documented-full-rec709-linear-bilinear8-v1'
PRIMARY = {
    'document': 'https://developer.apple.com/documentation/appkit/applying-apple-hdr-effect-to-your-photos',
    'data': 'https://developer.apple.com/tutorials/data/documentation/appkit/applying-apple-hdr-effect-to-your-photos.json',
    'captured_data_sha256': '4dab6b7f57563541982df1e639ec2367093e2ff5a9a2fda1d1e6a7e0b050ed40',
    'capture_date_utc': '2026-09-29',
    'capture_scope': 'Interpretation provenance, not a network dependency of this offline proof. No full document is copied into the repository.',
    'applicability': 'The primary article names the actual Apple auxiliary type, version-key presence, single-channel 8-bit map and MakerNotes 33/48. It specifies full application, not numeric version dispatch or intermediate display weighting.',
    'fixture_provenance': 'https://github.com/AOMediaCodec/libavif/blob/8da5b8e5ad873f73b02875057015c27d7c327cbe/tests/data/README.md',
    'fixture_scope': 'Personal iPhone photo resized in Preview. The separate newer fixture reuses these pixels with manually transplanted XMP; its XMP headroom precedence is not established by this article.',
    'native_import': 'https://github.com/AOMediaCodec/libavif/blob/v1.4.1/apps/shared/avifjpeg.c',
    'native_application': 'https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/gainmap.c',
    'native_source_archive_sha256': 'd4aea31a4becb3273ba7968221be2e48148ba05eb8a68d14e671963e17785648',
}
DEPENDENCIES = ('apple_source_model.py', 'test_apple_source_model.py', 'gainmap.py', 'gainmap_iso.py',
                'gainmap_avif.py', 'avif.py', 'hdr_png.py', 'appearance.py', 'thresholds.json')


def _ifd(data, offset, endian):
    if offset < 0 or offset+2 > len(data):
        raise ValueError('Invalid TIFF directory offset')
    count = struct.unpack_from(endian+'H', data, offset)[0]
    if offset+2+count*12+4 > len(data):
        raise ValueError('Truncated TIFF directory')
    result = {}
    for index in range(count):
        tag, kind, length, value = struct.unpack_from(endian+'HHII', data, offset+2+12*index)
        if tag in result:
            raise ValueError('Duplicate TIFF field')
        result[tag] = (kind, length, value)
    return result


def parse_old_model(base_bytes, map_bytes):
    """Read actual Apple XMP and raw MakerNote rational fields independently."""
    packets = [value[29:] for marker, value in segments(map_bytes)
               if marker == 0xE1 and value.startswith(b'http://ns.adobe.com/xap/1.0/\0')]
    if len(packets) != 1:
        raise ValueError('One original Apple gain-map XMP packet is required')
    tree = ET.fromstring(packets[0])
    ns = '{http://ns.apple.com/HDRGainMap/1.0/}'
    versions = list(tree.iter(ns+'HDRGainMapVersion'))
    aux = list(tree.iter('{http://ns.apple.com/pixeldatainfo/1.0/}AuxiliaryImageType'))
    if (len(versions) != 1 or versions[0].text != '65536' or len(aux) != 1
            or aux[0].text != 'urn:com:apple:photo:2020:aux:hdrgainmap'
            or list(tree.iter(ns+'HDRGainMapHeadroom'))):
        raise ValueError('Only the original old Apple auxiliary model without XMP headroom is admitted')
    exif = [value[6:] for marker, value in segments(base_bytes)
            if marker == 0xE1 and value.startswith(b'Exif\0\0')]
    if len(exif) != 1 or len(exif[0]) < 8 or exif[0][:2] not in (b'II', b'MM'):
        raise ValueError('One complete EXIF TIFF block is required')
    data = exif[0]
    endian = '<' if data[:2] == b'II' else '>'
    if struct.unpack_from(endian+'H', data, 2)[0] != 42:
        raise ValueError('Unknown TIFF header')
    directory = _ifd(data, struct.unpack_from(endian+'I', data, 4)[0], endian)
    pointer = directory.get(0x8769)
    if not pointer or pointer[:2] != (4, 1):
        raise ValueError('Missing EXIF directory')
    notes = _ifd(data, pointer[2], endian).get(0x927C)
    if not notes or notes[0] != 7 or notes[2]+notes[1] > len(data):
        raise ValueError('Missing Apple MakerNotes')
    maker = data[notes[2]:notes[2]+notes[1]]
    if not maker.startswith(b'Apple iOS\0\0\x01MM'):
        raise ValueError('Unknown Apple MakerNote representation')
    fields = _ifd(maker, 14, '>')
    fractions = []
    for tag in (33, 48):
        value = fields.get(tag)
        if not value or value[:2] != (10, 1) or value[2]+8 > len(maker):
            raise ValueError('Required Apple MakerNote rational is missing')
        numerator, denominator = struct.unpack_from('>iI', maker, value[2])
        if denominator == 0:
            raise ValueError('Invalid Apple MakerNote denominator')
        fractions.append([numerator, denominator])
    maker33, maker48 = (n/d for n, d in fractions)
    if maker33 < 1:
        stops = -20*maker48+1.8 if maker48 <= .01 else -.101*maker48+1.601
    else:
        stops = -70*maker48+3 if maker48 <= .01 else -.303*maker48+2.303
    return {'version': 65536, 'auxiliary_type': aux[0].text, 'maker33_fraction': fractions[0],
        'maker48_fraction': fractions[1], 'maker33': maker33, 'maker48': maker48,
        'headroom_log2': max(stops, 0), 'headroom_linear': 2**max(stops, 0),
        'xmp_sha256': hashlib.sha256(packets[0]).hexdigest(), 'xmp_headroom': 'absent'}


def inverse_rec709(signal):
    signal = np.asarray(signal, dtype=float)
    if not np.all(np.isfinite(signal)) or np.any((signal < 0) | (signal > 1)):
        raise ValueError('Finite normalized Rec.709 map samples are required')
    return np.where(signal < .081, signal/4.5, ((signal+.099)/1.099)**(1/.45))


def documented_full(base_nits, sampled_map, headroom):
    base_nits, sampled_map = np.asarray(base_nits, dtype=float), np.asarray(sampled_map, dtype=float)
    if (base_nits.ndim != 3 or base_nits.shape[-1] != 3 or sampled_map.shape != base_nits.shape[:2]
            or not np.all(np.isfinite(base_nits)) or np.any(base_nits < 0)
            or not math.isfinite(headroom) or headroom < 1):
        raise ValueError('Matching finite base/map geometry and full headroom are required')
    return base_nits*(1+(headroom-1)*inverse_rec709(sampled_map)[..., None])


def read_source(source, directory):
    source, directory = Path(source), Path(directory)
    if avif.digest(source) != SOURCE_SHA256:
        raise ValueError('Unknown old Apple source provenance; original-only handling is required')
    facts = gainmap.inspect(source, directory)
    gain = directory/'map.jpg'
    if avif.digest(gain) != MAP_SHA256:
        raise ValueError('The extracted map differs from the locked original Apple auxiliary image')
    color = _base_color_facts(source.read_bytes())
    model = parse_old_model(source.read_bytes(), gain.read_bytes())
    if (color['gamut'] != 'p3' or facts['base'] != {'depth': 8, 'width': 384, 'height': 512, 'components': 3, 'sof': 0}
            or facts['map'] != {'depth': 8, 'width': 192, 'height': 256, 'components': 1, 'sof': 0}
            or facts['frame_count'] != 1 or not facts['opaque'] or facts['metadata'].get('IFD0:Orientation', 1) != 1
            or not math.isclose(facts['metadata']['Apple:HDRHeadroom'], model['maker33'], rel_tol=1e-9)
            or facts['metadata']['Apple:HDRGain'] != model['maker48']):
        raise ValueError('Actual source depth, geometry, color or MakerNote facts disagree')
    with Image.open(source) as image:
        if image.mode != 'RGB' or image.size != (384, 512):
            raise ValueError('Unexpected native source base samples')
        base = np.asarray(image).copy()
    with Image.open(gain) as image:
        if image.mode != 'L' or image.size != (192, 256) or image.getexif().get(274, 1) != 1:
            raise ValueError('Unexpected native source gain-map samples')
        samples = np.asarray(image).copy()
    return {'sha256': SOURCE_SHA256, 'map_sha256': MAP_SHA256, 'path': str(source), 'map_path': str(gain),
        'color': color, 'model': model, 'facts': facts}, base, samples


def _import_items(path):
    data = Path(path).read_bytes()
    top = _boxes(data)
    _, meta, meta_offset = _unique(top, b'meta')
    boxes = _boxes(meta[4:], meta_offset+4)
    locations = _Reader(_unique(boxes, b'iloc')[1])
    if meta[:4] != bytes(4) or locations.take(6) != bytes.fromhex('000000004400'):
        raise ValueError('Unsupported native import item locations')
    _, media, media_offset = _unique(top, b'mdat')
    items, extents = {}, []
    for _ in range(locations.number(2)):
        item, external, count = locations.number(2), locations.number(2), locations.number(2)
        start, length = locations.number(4), locations.number(4)
        if (item in items or external != 0 or count != 1 or length == 0
                or start < media_offset or start+length > media_offset+len(media)):
            raise ValueError('Invalid native import extent')
        items[item] = data[start:start+length]
        extents.append((start, start+length))
    locations.end()
    if any(a[1] > b[0] for a, b in zip(sorted(extents), sorted(extents)[1:])):
        raise ValueError('Overlapping native import extents')
    refs = _unique(boxes, b'iref')[1]
    links = [entry for kind, entry, _ in _boxes(refs[4:]) if kind == b'dimg']
    if refs[:4] != bytes(4) or len(links) != 1 or len(links[0]) != 8:
        raise ValueError('Expected one native tone-map reference')
    owner, count, base, gain = struct.unpack('>HHHH', links[0])
    if count != 2 or len({owner, base, gain}) != 3:
        raise ValueError('Unknown native tone-map item relationship')
    return _fractions(items[owner]), items[base], items[gain]


def _packet(path, dimensions, *, gray):
    probe = json.loads(avif.native(['ffprobe', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu',
        '-show_frames', '-show_streams', '-of', 'json', path]))
    frames, streams = probe.get('frames', []), probe.get('streams', [])
    if len(frames) != 1 or len(streams) != 1 or streams[0].get('codec_name') != 'av1':
        raise ValueError('Expected one actual AV1 packet frame')
    for row in (frames[0], streams[0]):
        expected = {'width': dimensions[0], 'height': dimensions[1], 'pix_fmt': 'gray' if gray else 'gbrp',
            'color_range': 'pc', 'color_space': 'smpte170m' if gray else 'gbr'}
        if any(row.get(key) != value for key, value in expected.items()):
            raise ValueError('Native AV1 depth, components, dimensions or range changed')
        if not gray and (row.get('color_primaries') != 'smpte432' or row.get('color_transfer') != 'iec61966-2-1'):
            raise ValueError('Native AV1 base lost P3/sRGB signaling')
    data = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-i', path, '-frames:v', '1',
                       '-f', 'rawvideo', '-pix_fmt', 'gray' if gray else 'rgb24', 'pipe:1'])
    shape = (dimensions[1], dimensions[0])+( () if gray else (3,) )
    return np.frombuffer(data, np.uint8).reshape(shape), probe


def run(directory, *, source=SOURCE):
    """Measure one locked source at full headroom without authoring a derivative."""
    source, directory = Path(source), Path(directory)
    if avif.digest(source) != SOURCE_SHA256:
        raise ValueError('Unknown old Apple source; retain the exact original only')
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source_hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in DEPENDENCIES}
    source_facts, base, original_map = read_source(source, directory/'source-inspection')
    model = source_facts['model']
    mapped = np.asarray(Image.fromarray(original_map).resize((384, 512), Image.Resampling.BILINEAR))/255
    base_nits = sdr_signal_to_nits(base/255, nominal_white_nits=203)
    documented = documented_full(base_nits, mapped, model['headroom_linear'])
    legacy = base_nits*2**(mapped[..., None]*model['headroom_log2'])
    references = {}
    for name, pixels in (('documented-full', documented), ('legacy-log-full', legacy)):
        path = directory/(name+'.npy')
        np.save(path, pixels)
        references[name] = {'path': str(path), 'sha256': avif.digest(path), 'gamut': 'p3',
            'transfer': 'linear', 'units': 'cd/m2', 'dimensions': [384, 512]}
    imported, pq = directory/'native-import.avif', directory/'native-legacy-full.png'
    avif.native(['avifgainmaputil', 'convert', source, imported, '--cicp', '12/13/0', '--ignore-profile',
                 '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'])
    bound = {str(source): SOURCE_SHA256, source_facts['map_path']: MAP_SHA256,
             **{ref['path']: ref['sha256'] for ref in references.values()}, str(imported): avif.digest(imported)}
    metadata, base_packet, map_packet = _import_items(imported)
    packets, imported_samples = {}, {}
    for name, data, dimensions, gray in (('base', base_packet, (384, 512), False), ('map', map_packet, (192, 256), True)):
        path = directory/(name+'.obu')
        path.write_bytes(data)
        bound[str(path)] = avif.digest(path)
        imported_samples[name], facts = _packet(path, dimensions, gray=gray)
        packets[name] = {'path': str(path), 'sha256': avif.digest(path), 'facts': facts}
    if (metadata['base_headroom'] != [0, 1] or metadata['alternate_headroom'] != [3, 1]
            or metadata['gain_map_min'] != [[0, 1]]*3 or metadata['gain_map_max'] != [[3, 1]]*3
            or metadata['gamma'] != [[1, 1]]*3 or metadata['base_offset'] != [[0, 1]]*3
            or metadata['alternate_offset'] != [[0, 1]]*3 or not metadata['use_base_color_space']):
        raise ValueError('Actual imported gain metadata differs from the named native convention')
    agreement = {'base_changed_codes': int(np.count_nonzero(base != imported_samples['base'])),
        'map_changed_codes': int(np.count_nonzero(original_map != imported_samples['map'])), 'tmap': metadata,
        'original_map_samples_sha256': hashlib.sha256(original_map.tobytes()).hexdigest(),
        'imported_map_samples_sha256': hashlib.sha256(imported_samples['map'].tobytes()).hexdigest(), 'packets': packets}
    if agreement['base_changed_codes'] or agreement['map_changed_codes']:
        raise ValueError('Native import changed original source samples')
    agreement['no_map_reinterpretation_before_gain_application'] = True
    avif.native(['avifgainmaputil', 'tonemap', imported, pq, '--headroom', '4', '--cicp-output', '9/16/0',
                 '--ignore-profile', '-d', '12', '-y', '444'])
    bound[str(pq)] = avif.digest(pq)
    bridge_color = hdr_png.inspect_source(pq)
    bridge_inspection = gainmap.inspect(pq, directory/'native-pq-inspection')
    if (any(bridge_color.get(key) != expected for key, expected in {
            'width': 384, 'height': 512, 'depth': 16, 'orientation': 1,
            'primaries': 9, 'transfer': 16, 'matrix': 0, 'full_range': True}.items())
            or bridge_inspection['frame_count'] != 1 or not bridge_inspection['opaque']
            or bridge_inspection['private_tags']):
        raise ValueError('Actual native PQ bridge facts do not establish this source comparison')
    signal = avif.read_png(pq)
    if signal.shape != (512, 384, 4) or not np.all(signal[..., 3] == 1):
        raise ValueError('Independent libpng disagrees with native bridge geometry or opacity')
    actual = avif.decode_transfer(signal[..., :3], 'pq', 'rec2020')
    measure = lambda expected: compare_appearance(expected, actual, reference_gamut='p3',
                                                 actual_gamut='rec2020', fixture_class='gainmap-hdr')
    control, diagnostic = measure(legacy), measure(documented)
    if (not control['passed'] or any(avif.digest(path) != sha for path, sha in bound.items())
            or any(avif.digest(Path(__file__).with_name(name)) != sha for name, sha in source_hashes.items())):
        raise ValueError('Legacy convention control or input integrity failed')
    inspection_commands = []
    for folder in (directory/'source-inspection', directory/'native-pq-inspection'):
        for log in sorted(folder.glob('*.log')):
            if log.name == 'map-extraction.log':
                inspection_commands.append({'command': ['exiftool', '-b', '-MPImage2', str(source)],
                    'stderr': log.read_text(), 'stdout_artifact': source_facts['map_path'],
                    'stdout_sha256': MAP_SHA256, 'exit_code': 0})
            else:
                inspection_commands.append(json.loads(log.read_text()))
    result = {'status': 'diagnostic_only', 'source': source_facts, 'primary_sources': PRIMARY,
        'reference_revision': REFERENCE_REVISION, 'thresholds_sha256': THRESHOLDS_SHA256,
        'scope': {'documented_effect': 'Full source headroom 8 only, observed through native boost 16 invocation',
            'sampling': 'Explicit Pillow BILINEAR8 map-to-base convention; the article requires resizing but does not prescribe a unique filter',
            'intermediate_adaptation_qualified': False, 'new_apple_model_qualified': False,
            'limitations': ['No source boost 2 interpretation is inferred from the full-effect article.',
                'No numeric-version dispatch or newer XMP headroom precedence is inferred.',
                'Legacy source references and conversion cases remain unchanged.',
                'A passing legacy control verifies that convention only; it cannot qualify the documented model.']},
        'checks': {'source_provenance': True, 'actual_color_and_makernotes': True, 'source_samples_preserved': True,
                   'independent_av1_import_decode': True, 'actual_native_bridge_facts': True,
                   'legacy_convention_control': control['passed'], 'bound_inputs_unchanged': True},
        'import_agreement': agreement,
        'legacy_control': {'status': 'qualified named legacy convention', 'reference': references['legacy-log-full'],
            'measurement': control, 'native_display_boost': 16, 'scope': 'Implementation comparison, not faithful Apple source qualification'},
        'documented_full_model': {'status': 'qualified source comparison' if diagnostic['passed'] else 'tested and failed',
            'reference': {**references['documented-full'], 'revision': REFERENCE_REVISION}, 'measurement': diagnostic},
        'native_artifacts': {'imported': {'path': str(imported), 'sha256': avif.digest(imported)},
                             'legacy_pq': {'path': str(pq), 'sha256': avif.digest(pq),
                                           'color': bridge_color, 'inspection': bridge_inspection}},
        'bound_inputs': bound, 'commands': avif.COMMANDS[start:], 'consumer_status': 'pending manual review',
        'inspection_commands': inspection_commands, 'source_hashes': source_hashes}
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
