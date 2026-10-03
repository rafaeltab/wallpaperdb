"""One real EXIF6 old Apple source, with its stored raster left unrotated.

Native ExifTool changes only the source metadata representation. Admission
separately binds that file to its generator hash, canonical compressed image
data, original map, actual ICC and raw Apple model. Native preparation reads
the oriented file itself. A later derivative must rotate exactly once after
the documented full effect; no partial Apple adaptation is inferred here.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import apple_native_source
import apple_source_model
import avif
import gainmap
from appearance import compare_appearance, THRESHOLDS_SHA256
from gainmap_iso import _base_color_facts, segments

LOCK_PATH = Path(__file__).with_name('fixtures')/'apple-orientation-sha256.json'
SOURCE_SHA256 = '691ce29e25ba756cf0d9d2a4e498fcb4f246eaa0fd7046b15fb10f38b58053c9'
REFERENCE_REVISION = apple_source_model.REFERENCE_REVISION
DEPENDENCIES = ('apple_orientation_source.py', 'test_apple_orientation_source.py',
                'fixtures/apple-orientation-sha256.json', *apple_native_source.DEPENDENCIES)


def _lock():
    lock = json.loads(LOCK_PATH.read_text())
    if (lock['parent_sha256'] != apple_source_model.SOURCE_SHA256 or lock['sha256'] != SOURCE_SHA256
            or lock['map_sha256'] != apple_source_model.MAP_SHA256 or lock['orientation'] != 6):
        raise ValueError('Unknown Apple orientation fixture lock')
    return lock


def generate(directory, *, parent=apple_source_model.SOURCE):
    """A deterministic native metadata edit; no pixel writer is involved."""
    _lock()
    parent, directory = Path(parent), Path(directory)
    if avif.digest(parent) != apple_source_model.SOURCE_SHA256:
        raise ValueError('Unknown Apple parent; retain the exact original only')
    directory.mkdir(parents=True, exist_ok=True)
    path = directory/'gainmap-apple-old-exif6.jpg'
    path.write_bytes(parent.read_bytes())
    avif.native(['exiftool', '-overwrite_original', '-Orientation#=6', path])
    if avif.digest(path) != SOURCE_SHA256 or avif.digest(parent) != apple_source_model.SOURCE_SHA256:
        raise ValueError('Native orientation generator or parent provenance changed')
    return path


def _coded_base(data, gain):
    """Compare original coded tables/scan bytes, excluding APP and COM metadata."""
    if not data.endswith(gain):
        raise ValueError('Original auxiliary JPEG is not the exact final byte extent')
    base = data[:-len(gain)]
    headers = list(segments(base))
    offset = 2+sum(len(value)+4 for _, value in headers)
    if base[offset:offset+2] != b'\xff\xda' or base[-2:] != b'\xff\xd9':
        raise ValueError('Missing original base scan or image boundary')
    return b''.join(bytes((255, marker))+len(value).to_bytes(4, 'big')+value
                    for marker, value in headers if not 0xE0 <= marker <= 0xEF and marker != 0xFE)+base[offset:]


def inspect_source(source, directory):
    _lock()
    source, directory = Path(source), Path(directory)
    if avif.digest(source) != SOURCE_SHA256:
        raise ValueError('Unknown Apple EXIF6 source; retain the exact original only')
    canonical, original_base, original_map = apple_source_model.read_source(
        apple_source_model.SOURCE, directory/'canonical')
    facts = gainmap.inspect(source, directory/'oriented')
    gain = directory/'oriented/map.jpg'
    color = _base_color_facts(source.read_bytes())
    model = apple_source_model.parse_old_model(source.read_bytes(), gain.read_bytes())
    orientation = gainmap.orientation_source(source, directory/'orientation.log')
    canonical_map = Path(canonical['map_path']).read_bytes()
    coded_original = _coded_base(apple_source_model.SOURCE.read_bytes(), canonical_map)
    coded_oriented = _coded_base(source.read_bytes(), gain.read_bytes())
    correspondence = {'coded_base_equal': coded_original == coded_oriented,
        'coded_base_sha256': hashlib.sha256(coded_original).hexdigest(),
        'map_bytes_equal': gain.read_bytes() == canonical_map,
        'actual_icc_equal': color == canonical['color'], 'actual_model_equal': model == canonical['model'],
        'stored_layer_facts_equal': all(facts[layer] == canonical['facts'][layer] for layer in ('base', 'map'))}
    if (orientation['orientation'] != 6 or facts['metadata'].get('IFD0:Orientation') != 6
            or facts['frame_count'] != 1 or not facts['opaque'] or not all(value for key, value in correspondence.items() if key.endswith('equal'))
            or avif.digest(gain) != apple_source_model.MAP_SHA256
            or facts['metadata']['Apple:HDRHeadroom'] != canonical['facts']['metadata']['Apple:HDRHeadroom']
            or facts['metadata']['Apple:HDRGain'] != canonical['facts']['metadata']['Apple:HDRGain']):
        raise ValueError('Actual oriented source facts or canonical correspondence changed')
    with Image.open(source) as image:
        if image.mode != 'RGB' or image.size != (384, 512) or image.getexif().get(274) != 6:
            raise ValueError('Independent source does not establish the EXIF6 stored raster')
        base = np.asarray(image).copy()
    with Image.open(gain) as image:
        if image.mode != 'L' or image.size != (192, 256) or image.getexif().get(274, 1) != 1:
            raise ValueError('Independent auxiliary raster changed')
        samples = np.asarray(image).copy()
    if not np.array_equal(base, original_base) or not np.array_equal(samples, original_map):
        raise ValueError('Independent original samples changed during orientation metadata edit')
    bound = {str(source): SOURCE_SHA256, str(gain): apple_source_model.MAP_SHA256,
             str(apple_source_model.SOURCE): apple_source_model.SOURCE_SHA256,
             canonical['map_path']: apple_source_model.MAP_SHA256}
    if any(avif.digest(path) != sha for path, sha in bound.items()):
        raise ValueError('Source or extracted-map integrity changed during inspection')
    return {'path': str(source), 'sha256': SOURCE_SHA256, 'map_path': str(gain),
        'map_sha256': apple_source_model.MAP_SHA256, 'facts': facts, 'color': color, 'model': model,
        'orientation_source': orientation, 'correspondence': correspondence, 'bound_files': bound}, base, samples


def prepare(source, directory, *, gamut='p3', model_revision=REFERENCE_REVISION):
    if gamut != 'p3' or model_revision != REFERENCE_REVISION:
        raise ValueError('Unknown Apple color or model; retain the exact original only')
    directory = Path(directory)
    first = len(avif.COMMANDS)
    facts, base, samples = inspect_source(source, directory/'inspection')
    base_raw, map_raw = directory/'base-original.rgb', directory/'map-original.rgb'
    base_decode = apple_native_source._decode_rgb(source, base_raw, (384, 512))
    map_decode = apple_native_source._decode_rgb(facts['map_path'], map_raw, (192, 256))
    original = {'base_changed_codes': int(np.count_nonzero(np.fromfile(base_raw, np.uint8).reshape(512, 384, 3) != base)),
        'map_changed_codes': int(np.count_nonzero(np.fromfile(map_raw, np.uint8).reshape(256, 192, 3) != samples[..., None])),
        'base_samples_sha256': avif.digest(base_raw), 'map_samples_sha256': avif.digest(map_raw),
        'base_decode': base_decode, 'map_decode': map_decode}
    if original['base_changed_codes'] or original['map_changed_codes']:
        raise ValueError('Native JPEG decoder changed the independent stored raster')
    horizontal, mapped, mapped_raw = directory/'map-horizontal.png', directory/'map-full.png', directory/'map-full.rgb'
    filters = [apple_native_source._map_axis(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '192x256', '-i', map_raw], horizontal, (384, 256)),
               apple_native_source._map_axis(['-i', horizontal], mapped, (384, 512))]
    apple_native_source._decode_rgb(mapped, mapped_raw, (384, 512))
    actual_map = np.fromfile(mapped_raw, np.uint8).reshape(512, 384, 3)
    expected_map = np.asarray(Image.fromarray(samples).resize((384, 512), Image.Resampling.BILINEAR))
    sampling = {'changed_codes': int(np.count_nonzero(actual_map != expected_map[..., None])),
        'filters': filters, 'native_samples_sha256': avif.digest(mapped_raw),
        'convention': 'Same separable bilinear8 quarter-weight source convention; stored raster is not rotated'}
    if sampling['changed_codes']:
        raise ValueError('Native source map sampling differs from the declared convention')
    output = directory/'source-linear.gbrpf32'
    expression = apple_native_source._apply_native(base_raw, mapped_raw, output, (384, 512), 8)
    bound = {**facts['bound_files'], **{str(path): avif.digest(path) for path in
        (base_raw, map_raw, horizontal, mapped, mapped_raw, output)}}
    logs = {str(path): {'sha256': avif.digest(path), 'content': path.read_text()}
            for path in sorted((directory/'inspection').rglob('*.log'))}
    bound.update({path: details['sha256'] for path, details in logs.items()})
    if any(avif.digest(path) != sha for path, sha in bound.items()):
        raise ValueError('Native oriented source or extracted-map integrity changed')
    result = {'path': str(output), 'sha256': avif.digest(output), 'format': 'gbrpf32le', 'gamut': 'p3',
        'width': 384, 'height': 512, 'normalization_nits': 203, 'transfer': 'linear', 'alpha': False,
        'source_sha256': SOURCE_SHA256, 'source_facts': facts, 'reference_revision': REFERENCE_REVISION,
        'precision': 'Native float32 documented Apple full effect from actual EXIF6 stored raster; no rotation yet',
        'full_headroom': 8, 'source_orientation': 6, 'orientation_applied': False,
        'source_correspondence': facts['correspondence'], 'original_samples': original, 'map_sampling': sampling,
        'gain_filter': expression, 'bound_files': bound, 'commands': avif.COMMANDS[first:], 'source_inspection_logs': logs}
    apple_native_source.read_linear(result)
    (directory/'source-evidence.json').write_text(json.dumps(result, indent=2)+'\n')
    return result


def run(directory, *, source=None):
    _lock()
    if source is not None and avif.digest(source) != SOURCE_SHA256:
        raise ValueError('Unknown Apple EXIF6 source; retain the exact original only')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    first = len(avif.COMMANDS)
    hashes = {name: avif.digest(Path(__file__).parent/name) for name in DEPENDENCIES}
    source = generate(directory/'fixture') if source is None else Path(source)
    # The original documented reference and analytic native controls stay exact.
    canonical = apple_native_source.run(directory/'canonical-control')
    native = prepare(source, directory/'native')
    reference = canonical['reference']
    measurement = compare_appearance(np.load(reference['path']), apple_native_source.read_linear(native),
        reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-hdr')
    same_native = native['sha256'] == canonical['native_source']['sha256']
    bound = {**canonical['bound_files'], **native['bound_files']}
    if (any(avif.digest(path) != sha for path, sha in bound.items())
            or any(avif.digest(Path(__file__).parent/name) != sha for name, sha in hashes.items())):
        raise ValueError('Source, reference or implementation integrity changed during measurement')
    checks = {'canonical_control': canonical['status'] == 'qualified source preparation' and all(canonical['checks'].values()),
        'source_provenance': True, 'source_color_and_model': True, 'actual_exif6': True,
        'original_samples': True, 'map_sampling': True, 'same_native_stored_raster': same_native,
        'source_appearance': measurement['passed'], 'integrity': True}
    result = {'status': 'qualified source preparation' if all(checks.values()) else 'tested and failed',
        'reference_revision': REFERENCE_REVISION, 'reference': reference, 'thresholds_sha256': THRESHOLDS_SHA256,
        'scope': {'source': 'Separately locked native EXIF6 old Apple metadata variant',
            'effect': 'Unchanged documented full effect in stored raster coordinates', 'orientation_applied': False,
            'geometry_qualified': False, 'conversion_qualified': False, 'intermediate_adaptation_qualified': False},
        'orientation_source': native['source_facts']['orientation_source'], 'native_source': native,
        'measurement': measurement, 'canonical_control': canonical, 'checks': checks,
        'bound_files': bound, 'source_hashes': hashes, 'commands': avif.COMMANDS[first:],
        'consumer_status': 'pending manual review'}
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
