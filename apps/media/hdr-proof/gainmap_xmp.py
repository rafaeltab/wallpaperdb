"""Independent original Android-XMP source rendering for the proof corpus.

JPEG entropy decoding uses native libjpeg; XML and gain arithmetic are read
independently of the native gain-map application. The legacy photographic
source declares sRGB through EXIF, but lacks the ICC required by the Android
container specification. Its known color facts are sufficient for this named
renderer, not a claim of container or consumer conformance.

The pinned renderer samples the map with libyuv's x86 point-bilinear convention:
16.16 pixel centers, vertical eight-bit fraction/rounding, then horizontal
seven-bit fraction/rounding. This is a declared implementation choice, not the
only permitted bilinear-or-better kernel. No reference array feeds an encoder.
Primary semantics: https://developer.android.com/media/platform/hdr-image-format
Native comparison: libavif v1.4.1 src/gainmap.c and third_party/libyuv/source/
scale_common.c, scale.c, row_common.c. Gamma is the XMP encoding exponent;
decoding uses its inverse. This is not Android Gainmap API gamma terminology.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, features

from gainmap_iso import _base_color_facts, jpeg_facts, segments

XMP_ID = b'http://ns.adobe.com/xap/1.0/\0'
HDR_NS = '{http://ns.adobe.com/hdr-gain-map/1.0/}'
RDF_NS = '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}'
SOURCE = Path(__file__).parent/'fixtures/gainmap/gainmap-android-xmp.jpg'
SOURCE_SHA256 = 'd22fd05e210df1067ebd6a1f63d0e5d94c5fa9042fe2ebd7067a10a301402271'
MAP_SHA256 = '2a207016b14881ae799d3d28e24d824bd0daed7b1480cb2c5c8f7226b6d390c2'
SAMPLING_REVISION = 'xmp-libyuv-x86-point-bilinear8-v1'


def parse_metadata(map_bytes):
    """Read a bounded XMP packet; unsupported or ambiguous facts are rejected."""
    packets = [value[len(XMP_ID):] for marker, value in segments(map_bytes)
               if marker == 0xE1 and value.startswith(XMP_ID)]
    if len(packets) != 1 or b'<!' in packets[0]:
        raise ValueError('One unambiguous XMP packet without XML declarations is required')
    try:
        root = ET.fromstring(packets[0])
    except ET.ParseError as error:
        raise ValueError('Malformed gain-map XMP') from error
    properties = {}
    parents = {child: node for node in root.iter() for child in node}
    owners = set()
    allowed = {'Version', 'BaseRenditionIsHDR', 'GainMapMin', 'GainMapMax', 'Gamma',
               'OffsetSDR', 'OffsetHDR', 'HDRCapacityMin', 'HDRCapacityMax'}
    for node in root.iter():
        entries = [(key[len(HDR_NS):], value) for key, value in node.attrib.items() if key.startswith(HDR_NS)]
        if entries:
            if node.tag != RDF_NS+'Description' or parents.get(node) is None or parents[node].tag != RDF_NS+'RDF':
                raise ValueError('Gain-map facts must belong to one RDF description')
            owners.add(node)
        if node.tag.startswith(HDR_NS):
            owner = parents.get(node)
            if (owner is None or owner.tag != RDF_NS+'Description' or parents.get(owner) is None
                    or parents[owner].tag != RDF_NS+'RDF' or node.attrib):
                raise ValueError('Gain-map facts must belong to one RDF description')
            owners.add(owner)
            key = node.tag[len(HDR_NS):]
            if list(node):
                if (len(node) != 1 or node[0].tag != RDF_NS+'Seq' or node.attrib
                        or any(child.tag != RDF_NS+'li' or child.attrib or list(child) for child in node[0])):
                    raise ValueError('Only scalar values or simple ordered XMP arrays are supported')
                value = [child.text for child in node[0]]
            else:
                value = node.text
            entries.append((key, value))
        for key, value in entries:
            if key not in allowed or key in properties:
                raise ValueError('Unknown or duplicate gain-map XMP property')
            properties[key] = value
    if len(owners) != 1:
        raise ValueError('Expected exactly one gain-map RDF description')
    if properties.get('Version') != '1.0' or properties.get('BaseRenditionIsHDR', 'False') != 'False':
        raise ValueError('Only XMP version 1.0 with an SDR base is supported')

    def number(value):
        try:
            result = float(value)
        except (TypeError, ValueError) as error:
            raise ValueError('Missing or invalid XMP numeric fact') from error
        if not math.isfinite(result):
            raise ValueError('Nonfinite XMP numeric fact')
        return result

    def channels(key, default=None):
        value = properties.get(key, default)
        # The pinned native XMP bridge does not admit one-item rdf:Seq even
        # though the Android specification permits it. Do not widen its proof.
        if isinstance(value, list):
            if len(value) != 3:
                raise ValueError('Only three-channel ordered XMP arrays are proven')
            return [number(item) for item in value]
        return [number(value)]*3

    result = {'minimum': channels('GainMapMin', 0), 'maximum': channels('GainMapMax'),
              'gamma': channels('Gamma', 1), 'base_offset': channels('OffsetSDR', 1/64),
              'alternate_offset': channels('OffsetHDR', 1/64),
              'base_headroom': number(properties.get('HDRCapacityMin', 0)),
              'alternate_headroom': number(properties.get('HDRCapacityMax'))}
    if (result['base_headroom'] < 0 or result['alternate_headroom'] <= result['base_headroom']
            or any(low > high for low, high in zip(result['minimum'], result['maximum']))
            or min(result['gamma']) <= 0 or min(result['base_offset']+result['alternate_offset']) < 0):
        raise ValueError('Unsupported gain-map XMP numeric range')
    return result


def sample_map(samples, dimensions):
    """Declared native point-bilinear sampling; bounded grayscale downsampling."""
    samples = np.asarray(samples)
    width, height = dimensions
    if samples.dtype != np.uint8 or samples.ndim != 2 or min(width, height) <= 0:
        raise ValueError('Positive dimensions and grayscale8 map samples are required')
    source_height, source_width = samples.shape
    if (width, height) == (source_width, source_height):
        return samples.copy()
    if width >= source_width or height >= source_height or source_width > 4096 or source_height > 4096:
        raise ValueError('Only the proven two-axis point-bilinear downsample is supported')
    dx, dy = (source_width << 16)//width, (source_height << 16)//height
    x = dx//2-32768+np.arange(width, dtype=np.int64)*dx
    y = dy//2-32768+np.arange(height, dtype=np.int64)*dy
    ix, fx = x >> 16, (x & 65535) >> 9
    iy, fy = y >> 16, (y >> 8) & 255
    if min(ix) < 0 or min(iy) < 0 or max(ix)+1 >= source_width or max(iy)+1 >= source_height:
        raise ValueError('Unsupported point-bilinear boundary geometry')
    integer = samples.astype(np.int64)
    vertical = (integer[iy]*(256-fy[:, None])+integer[iy+1]*fy[:, None]+128) >> 8
    result = vertical[:, ix]+((fx[None, :]*(vertical[:, ix+1]-vertical[:, ix])+64) >> 7)
    return result.astype(np.uint8)


def decode_xmp_source(base_bytes, map_bytes, *, headroom=4.0):
    """Render original JPEG samples using independently read color/gain facts."""
    if not math.isfinite(headroom) or headroom < 0:
        raise ValueError('Finite nonnegative display headroom is required')
    base, gain = jpeg_facts(base_bytes), jpeg_facts(map_bytes)
    if (base['sof'] != 0 or base['depth'] != 8 or base['components'] != 3
            or gain['sof'] != 0 or gain['depth'] != 8 or gain['components'] != 1):
        raise ValueError('Only native baseline RGB8 base and grayscale8 map are proven')
    if any(marker == 0xE2 and value.startswith(b'ICC_PROFILE\0') for marker, value in segments(map_bytes)):
        raise ValueError('Gain-map display ICC is outside this bounded source scope')
    with Image.open(io.BytesIO(base_bytes)) as image:
        exif = image.getexif()
        orientation = exif.get(274, 1)
        declared = exif.get_ifd(34665).get(40961)
        if image.mode != 'RGB' or orientation != 1 or image.size != (base['width'], base['height']):
            raise ValueError('Only identity-oriented RGB stored rasters are supported')
        if image.info.get('icc_profile'):
            color = _base_color_facts(base_bytes)
            if color['gamut'] != 'srgb' or declared not in (None, 1):
                raise ValueError('Unsupported or conflicting ICC/EXIF source color')
        else:
            if declared != 1:
                raise ValueError('Missing or unknown actual EXIF sRGB color fact')
            color = {'gamut': 'srgb', 'transfer': 'srgb', 'exif_colorspace': 1,
                     'icc_sha256': None, 'basis': 'Explicit legacy EXIF ColorSpace=1',
                     'container_limitation': 'Absent ICC does not conform to the Android gain-map container ICC requirement'}
        signal = np.asarray(image, dtype=np.float64)/255
    with Image.open(io.BytesIO(map_bytes)) as image:
        if image.mode != 'L' or image.getexif().get(274, 1) != 1 or image.size != (gain['width'], gain['height']):
            raise ValueError('Only identity-oriented grayscale map samples are proven')
        mapped = sample_map(np.asarray(image), (base['width'], base['height']))
    metadata = parse_metadata(map_bytes)
    low, high, gamma, offset, alternate = [np.array(metadata[key]) for key in
        ('minimum', 'maximum', 'gamma', 'base_offset', 'alternate_offset')]
    weight = float(np.clip((headroom-metadata['base_headroom'])/
                          (metadata['alternate_headroom']-metadata['base_headroom']), 0, 1))
    linear = np.where(signal <= .04045, signal/12.92, ((signal+.055)/1.055)**2.4)
    try:
        with np.errstate(over='raise', invalid='raise', divide='raise'):
            gain = low+(high-low)*(mapped[..., None]/255)**(1/gamma)
            # Native libavif returns the authored base at/below minimum capacity,
            # including unequal-offset metadata. The analytic control pins this.
            result = linear if weight == 0 else (linear+offset)*2**(gain*weight)-alternate
            result = np.maximum(result, 0)*203
    except FloatingPointError as error:
        raise ValueError('Source gain reconstruction exceeds finite numeric range') from error
    if not np.all(np.isfinite(result)):
        raise ValueError('Nonfinite reconstructed source')
    return {'linear_rgb_nits': result, 'gamut': 'srgb', 'evidence': {
        'decoder': 'Native libjpeg original samples plus independent XML, point-bilinear and gain arithmetic',
        'base_sha256': hashlib.sha256(base_bytes).hexdigest(), 'gain_map_sha256': hashlib.sha256(map_bytes).hexdigest(),
        'base_color': color, 'metadata': metadata, 'headroom_log2': headroom, 'gain_map_weight': weight,
        'sampling_revision': SAMPLING_REVISION, 'sampled_map_sha256': hashlib.sha256(mapped.tobytes()).hexdigest(),
        'native_libjpeg_version': Image.core.jpeglib_version, 'native_libjpeg_turbo_version': features.version_feature('libjpeg_turbo'),
        'sdr_white_nits': 203, 'base': base, 'map': jpeg_facts(map_bytes), 'orientation': orientation,
        'oracle_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'scope': 'Legacy EXIF-sRGB photographic source or verified sRGB ICC analytic control; named renderer only, no physical qualification',
        'arithmetic_policy': 'Float64 own-primary gain math; authored-base bypass at zero weight, otherwise clamp negative reconstructed channels to zero as in the pinned native renderer'}}


def read_source(path, directory, *, headroom=4):
    """Lock the photographic source and independently extracted map before use."""
    import avif
    import gainmap
    path, directory = Path(path), Path(directory)
    if avif.digest(path) != SOURCE_SHA256:
        raise ValueError('XMP source provenance differs from the locked photographic fixture')
    facts = gainmap.inspect(path, directory)
    map_path = directory/'map.jpg'
    if avif.digest(map_path) != MAP_SHA256:
        raise ValueError('Extracted XMP map differs from the locked original auxiliary image')
    decoded = decode_xmp_source(path.read_bytes(), map_path.read_bytes(), headroom=headroom)
    evidence = decoded['evidence']
    if ([evidence['base'][key] for key in ('width', 'height', 'depth', 'components')] != [403, 302, 8, 3]
            or [evidence['map'][key] for key in ('width', 'height', 'depth', 'components')] != [512, 384, 8, 1]
            or facts['metadata'].get('ExifIFD:ColorSpace') != 1
            or facts['metadata'].get('IFD0:Orientation') != 1 or facts['iso_identifier']):
        raise ValueError('Independent source facts disagree with the known legacy XMP source')
    decoded['evidence'].update({'source_path': str(path), 'map_path': str(map_path), 'inspection': facts})
    return decoded


def source_decision(path, directory):
    """Proof-side decision only; unknown facts retain exact original delivery."""
    import avif
    path, directory = Path(path), Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    original = directory/'original.jpg'
    if original.resolve() == path.resolve():
        raise ValueError('Original-only copy must not overwrite its source')
    original.write_bytes(path.read_bytes())
    if avif.digest(original) != avif.digest(path):
        raise ValueError('Original-only copy changed bytes')
    try:
        decoded = read_source(path, directory/'inspection')
        return {'status': 'source facts known', 'derivatives': True, 'metadata_pending': False,
                'original': str(original), 'original_sha256': avif.digest(original), 'evidence': decoded['evidence']}
    except ValueError as error:
        return {'status': 'original only', 'derivatives': False, 'metadata_pending': True,
                'original': str(original), 'original_sha256': avif.digest(original), 'reason': str(error)}


def run(directory, *, source=SOURCE):
    """Qualify only this source renderer; preserve native-reader disagreement."""
    import avif
    import gainmap_avif
    import hdr_png
    from appearance import compare_appearance
    from gainmap_reference import reference
    directory, source = Path(directory), Path(source)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    decoded = read_source(source, directory/'source')
    original_map = directory/'source/map.jpg'
    source_facts = decoded['evidence']
    before = {str(path): avif.digest(path) for path in (source, original_map)}
    bridge = directory/'native-import.avif'
    avif.native(['avifgainmaputil', 'convert', source, bridge, '--cicp', '1/13/0', '--ignore-profile',
                 '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'])
    imported, imported_base = gainmap_avif.inspect_source(bridge, directory/'native-import-inspection')
    with Image.open(source) as image:
        base_codes = np.asarray(image.convert('RGB'))
    with Image.open(original_map) as image:
        map_codes = np.asarray(image)
    imported_map = avif.native(['ffmpeg', '-v', 'error', '-c:v', 'libdav1d', '-f', 'obu', '-i',
        directory/'native-import-inspection/map.obu', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'])
    imported_map = np.frombuffer(imported_map, np.uint8).reshape(map_codes.shape)
    metadata = source_facts['metadata']
    tmap = imported['metadata']
    fields = {'minimum': 'gain_map_min', 'maximum': 'gain_map_max', 'gamma': 'gamma',
              'base_offset': 'base_offset', 'alternate_offset': 'alternate_offset'}
    metadata_equal = all(metadata[name] == [n/d for n, d in tmap[other]] for name, other in fields.items())
    metadata_equal &= all(metadata[name] == tmap[name][0]/tmap[name][1]
                          for name in ('base_headroom', 'alternate_headroom'))
    agreement = {'base_changed_codes': int(np.count_nonzero(base_codes != imported_base)),
                 'map_changed_codes': int(np.count_nonzero(map_codes != imported_map)),
                 'metadata_equal': bool(metadata_equal), 'facts': imported, 'path': str(bridge), 'sha256': avif.digest(bridge)}
    checks = {'source_lock': before[str(source)] == SOURCE_SHA256, 'map_lock': before[str(original_map)] == MAP_SHA256,
              'original_samples_preserved': agreement['base_changed_codes'] == agreement['map_changed_codes'] == 0,
              'source_metadata_preserved': bool(metadata_equal), 'appearance': True, 'native_output_facts': True,
              'source_bytes_unchanged': False}
    renderings = []
    for boost in (2, 16):
        source_render = decode_xmp_source(source.read_bytes(), original_map.read_bytes(), headroom=math.log2(boost))
        expected = source_render['linear_rgb_nits']
        path = directory/f'independent-{boost}.rgbf64'
        expected.astype('<f8').tofile(path)
        png = directory/f'native-source-{boost}.png'
        avif.native(['avifgainmaputil', 'tonemap', bridge, png, '--headroom', str(math.log2(boost)),
                     '--cicp-output', '9/16/0', '--ignore-profile', '-d', '12', '-y', '444'])
        facts = hdr_png.inspect_source(png)
        rgba = avif.read_png(png)
        actual = avif.decode_transfer(rgba[..., :3], 'pq', 'rec2020')
        structural = ((facts['width'], facts['height'], facts['depth'], facts['orientation']) == (403, 302, 16, 1)
            and [facts['primaries'], facts['transfer'], facts['matrix'], int(facts['full_range'])] == [9, 16, 0, 1]
            and rgba.shape == (302, 403, 4) and bool(np.all(rgba[..., 3] == 1)))
        measure = compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='rec2020', fixture_class='gainmap-hdr')
        expected_geometry, _ = reference(expected, 'srgb', 'srgb', 'contain', 1)
        native_geometry, _ = reference(actual, 'rec2020', 'srgb', 'contain', 1)
        geometry_relation = compare_appearance(expected_geometry, native_geometry,
            reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')
        checks['appearance'] &= measure['passed'] and geometry_relation['passed']
        checks['native_output_facts'] &= structural
        diagnostic = {'status': 'tested and failed', 'scope': 'Different native source renderer; diagnostic only, no qualification gate'}
        try:
            raw = directory/f'ultrahdr-{boost}.gbrpf32'
            native = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'decode-linear', source, raw, str(boost)]))
            pixels = np.fromfile(raw, '<f4').reshape(3, native['height'], native['width'])[[2, 0, 1]].transpose(1, 2, 0)*203
            diagnostic['measurement'] = compare_appearance(expected, pixels, reference_gamut='srgb',
                actual_gamut={0: 'srgb', 1: 'p3', 2: 'rec2020'}[native['gamut']], fixture_class='gainmap-hdr')
            diagnostic.update({'facts': native, 'raw_sha256': avif.digest(raw)})
            if diagnostic['measurement']['passed']:
                diagnostic['status'] = 'qualified renderer diagnostic'
        except Exception as error:
            diagnostic['failure'] = str(error)
        renderings.append({'display_boost': boost, 'source_decoder': source_render['evidence'],
            'reference': {'path': str(path), 'sha256': avif.digest(path), 'gamut': 'srgb', 'units': 'cd/m2',
                          'revision': 'gainmap-xmp-intermediate-boost2-v1' if boost == 2 else 'gainmap-xmp-independent-boost16-v1'},
            'native': {'path': str(png), 'sha256': avif.digest(png), 'facts': facts, 'requested_depth': 12, 'storage_depth': 16},
            'measurement': measure, 'matched_containment_relation_to_legacy': geometry_relation,
            'ultrahdr_diagnostic': diagnostic})
    checks['source_bytes_unchanged'] = before == {str(path): avif.digest(path) for path in (source, original_map)}
    report = {'status': 'qualified source renderer' if all(checks.values()) else 'tested and failed', 'checks': checks,
        'source': {'path': str(source), 'sha256': avif.digest(source), 'map_sha256': avif.digest(original_map),
                   'color': source_facts['base_color'], 'evidence': source_facts},
        'import_agreement': agreement, 'renderings': renderings, 'sampling_revision': SAMPLING_REVISION,
        'threshold_policy': 'Unchanged predeclared gainmap-hdr gates for original source and matched-geometry reference relation; source proof is not derivative qualification',
        'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json')),
        'consumer_status': 'pending manual review', 'commands': avif.COMMANDS[start:],
        'native_binary_sha256': {str(path): avif.digest(path) for path in
            (shutil.which('avifgainmaputil'), shutil.which('ffmpeg'), shutil.which('hdr-proof-png-decode'),
             '/opt/proof/ultrahdr/precise/hdr-proof-uhdr')},
        'source_hashes': {name: avif.digest(Path(__file__).with_name(name)) for name in
            ('gainmap_xmp.py', 'gainmap_iso.py', 'gainmap_avif.py', 'gainmap_reference.py', 'appearance.py', 'avif.py', 'hdr_png.py')}}
    (directory/'evidence.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
