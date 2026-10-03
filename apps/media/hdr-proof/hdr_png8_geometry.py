"""Crop, stretch, upscale and EXIF8 cases for exact-normalized PNG8 sources.

Before measurements, retain containment's unchanged output gates: avif-8 for
HDR8, sdr-8 plus the independent 1000-nit tone/gamut controls for SDR, and alpha
error at most two output codes. Only native sample-preserving normalization is
eligible. Actual EXIF8 sources have separate hashes; their coded pixels must
equal the locked base, and native rotation must equal independent numpy.rot90.
These are additional proof cases, not changes to production source admission.
"""
import json
from pathlib import Path

import numpy as np

import avif
import gamma_sdr
import hdr_png
import hdr_png8
import hdr_png8_proof
from appearance import RGB_TO_XYZ, compare_appearance, sdr_signal_to_nits
from matrix import GEOMETRIES, request_decision
from sdr_reference import reference_srgb


ORIENTATION_LOCK = Path(__file__).with_name('fixtures')/'png8-orientation-sha256.json'
GEOMETRY_POLICY = {**hdr_png8_proof.OUTPUT_POLICY,
    'geometry': 'Independent premultiplied Pillow bilinear cover40x40, fill40x48, upscale120x80 or EXIF8 then58x87',
    'scope': 'Only these four additional geometry tuples; containment candidates remain unchanged',
    'orientation_reference': 'numpy.rot90 of independently libpng-decoded original coded pixels before transfer interpretation'}


def generate_orientation_fixture(source, base):
    """Preserve the locked native source's pixels and attach actual EXIF8."""
    source = Path(source)
    fixture_id = base['id'] + '-orientation-8'
    output = source.with_name(fixture_id + '.png')
    output.write_bytes(source.read_bytes())
    avif.native(['exiftool', '-overwrite_original', '-Orientation#=8', output])
    base_facts, base_pixels = hdr_png8.inspect_and_decode(source)
    facts, pixels = hdr_png8.inspect_and_decode(output, allow_exif8=True)
    checks = {'base_hash': avif.digest(source) == base['sha256'],
              'exact_coded_samples': bool(np.array_equal(pixels, base_pixels)),
              'orientation': facts['orientation'] == 8,
              'same_signaling': all(facts[key] == base_facts[key] for key in (
                  'width', 'height', 'depth', 'color_type', 'primaries', 'transfer', 'matrix', 'full_range'))}
    fixture = {'id': fixture_id, 'path': str(output), 'sha256': avif.digest(output),
        'base_sha256': avif.digest(source), 'spec': {**base['spec'], 'id': fixture_id, 'orientation': 8},
        'generator': 'hdr_png8_geometry.py:generate_orientation_fixture', 'facts': facts,
        'source_valid': base['source_valid'] and all(checks.values()), 'source_checks': checks,
        'source_appearance': base['source_appearance'],
        'threshold_scope': 'Same locked coded samples and signaling; source quantization remains separate',
        'consumer_status': 'pending manual review'}
    return output, fixture


def _prepare_orientation(source, folder):
    facts, pixels = hdr_png8.inspect_and_decode(source, allow_exif8=True)
    if facts['orientation'] != 8:
        raise ValueError('The native rotation candidate requires actual EXIF8')
    # Remove orientation from an intermediate so FFmpeg's precision boundary
    # cannot auto-rotate. Both that metadata-only edit and the later explicit
    # rotation are checked against the independently decoded original pixels.
    coded = folder/'orientation-coded-source.png'
    coded.write_bytes(Path(source).read_bytes())
    avif.native(['exiftool', '-overwrite_original', '-Orientation#=1', coded])
    coded_facts, coded_pixels = hdr_png8.inspect_and_decode(coded)
    exact_coded = np.array_equal(coded_pixels, pixels)
    same_signaling = all(coded_facts[key] == facts[key] for key in (
        'width', 'height', 'depth', 'color_type', 'primaries', 'transfer', 'matrix', 'full_range'))
    if not exact_coded or not same_signaling:
        raise ValueError('Orientation metadata reset changed coded samples or color signaling')
    normalized = folder/'orientation-normalized-source.png'
    normalization = hdr_png8_proof.normalize_source(coded, normalized)
    normalization['orientation_input'] = {'path': str(source), 'sha256': avif.digest(source),
        'orientation': facts['orientation'], 'exact_coded_samples_after_metadata_reset': bool(exact_coded),
        'same_color_signaling_after_metadata_reset': same_signaling}
    if not normalization['passed']:
        raise ValueError('Orientation source normalization was not exact')
    baked = folder/'orientation-baked.png'
    filters = ('transpose=cclock,sidedata=mode=delete,'
               f'setparams=color_primaries={facts["primaries"]}:color_trc={facts["transfer"]}:'
               'colorspace=gbr:range=full')
    avif.native(['ffmpeg', '-v', 'error', '-y', '-noautorotate', '-i', normalized,
                 '-vf', filters, '-pix_fmt', 'rgba64be', '-map_metadata', '-1',
                 '-frames:v', '1', '-threads', '1', baked])
    baked_facts = hdr_png.inspect_source(baked)
    actual = avif.read_png(baked)
    exact_rotation = np.array_equal(actual, np.rot90(pixels))
    checks = {'exact_rotated_samples': bool(exact_rotation), 'orientation_baked': baked_facts['orientation'] == 1,
              'dimensions': (baked_facts['width'], baked_facts['height']) == (facts['height'], facts['width']),
              'depth': baked_facts['depth'] == 16,
              'same_color_signaling': all(baked_facts[key] == facts[key]
                  for key in ('primaries', 'transfer', 'matrix', 'full_range'))}
    rotation = {'passed': all(checks.values()), 'checks': checks, 'exact_rotated_samples': bool(exact_rotation),
        'source': str(source), 'source_sha256': avif.digest(source), 'source_orientation': facts['orientation'],
        'output': str(baked), 'sha256': avif.digest(baked), 'facts': baked_facts,
        'reference': 'numpy.rot90 of independently libpng-decoded original coded RGB and alpha'}
    if not rotation['passed']:
        raise ValueError('Native orientation bake disagrees with independent rotation')
    return baked, normalization, rotation


def _measure(source, conversion_source, fixture, reference, geometry, normalization, rotation, tone, folder,
             dynamic_range, extension, depth):
    source_facts = fixture['facts']
    transfer, gamut = source_facts['transfer_name'], source_facts['gamut']
    sdr = dynamic_range == 'sdr'
    out_gamut, out_transfer = ('srgb', 'gamma22' if extension == 'avif' else 'srgb') if sdr else (gamut, transfer)
    selectors = {'format': extension, 'range': dynamic_range, 'gamut': 'srgb' if sdr else 'preserve',
        'depth': str(depth), 'motion': 'preserve', 'transparency': 'preserve', **GEOMETRIES[geometry]}
    case_id = f'{fixture["id"]}:{dynamic_range}:{extension}:{selectors["gamut"]}:preserve:{geometry}:normalized-source16'
    directory = folder/case_id.replace(':', '-')
    directory.mkdir(exist_ok=True)
    item = {'case_id': case_id, 'fixture_id': fixture['id'], 'cell_id': f'hdr-png:{dynamic_range}:{extension}',
        'selectors': selectors, 'geometry': geometry, 'status': 'tested and failed',
        'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
        'blockers': [], 'measurements': {}, 'artifacts': {}, 'source_facts': source_facts,
        'source_normalization': normalization, 'consumer_status': 'pending manual review',
        'threshold_scope': {**GEOMETRY_POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}}
    if rotation is not None:
        item['orientation_bake'] = rotation
    try:
        if not fixture['source_valid'] or not normalization['passed'] or (rotation is not None and not rotation['passed']):
            raise ValueError('Source validation, exact normalization or independent rotation failed')
        known = {'format': 'png', 'range': 'hdr', 'gamut': gamut, 'depth': source_facts['depth'],
                 'width': source_facts['height'] if geometry == 'orientation' else source_facts['width'],
                 'height': source_facts['width'] if geometry == 'orientation' else source_facts['height'],
                 'motion': 'static', 'alpha': 'fractional' if source_facts['alpha_channel'] else 'none',
                 'alpha_capable': True, 'orientation': source_facts['orientation']}
        item['request_decision'] = request_decision(known, selectors)
        if item['request_decision']['action'] != 'unqualified':
            raise ValueError('Requested tuple is outside this native conversion experiment')
        converted, target = directory/'converted.png', directory/f'output.{extension}'
        avif.convert_frame(conversion_source, converted, transfer, gamut, geometry,
                           sdr=sdr, peak_nits=1000 if sdr else None)
        if extension == 'avif':
            if sdr:
                gamma_sdr.encode([converted], target, depth=depth)
            else:
                avif.encode_avif([converted], target, out_transfer, out_gamut, depth)
            item['checks']['native_encoder'] = True
            facts = avif.inspect_avif(target)
            frames = avif.decode_avif(target, directory, 1)
            detail = avif.structure_checks(facts, frames, fixture['spec'], [reference], out_transfer, out_gamut, depth, 1)
            linear = (gamma_sdr.decode_signal_to_nits(frames[0][..., :3]) if sdr else
                      avif.decode_transfer(frames[0][..., :3], out_transfer, out_gamut))
        else:
            if sdr:
                avif.encode_other([converted], target, 'png', out_transfer, out_gamut, [reference], 1, fixture['spec'])
                item['checks']['native_encoder'] = True
                facts, frame = hdr_png8_proof._inspect_sdr_png16(target)
            else:
                hdr_png8_proof._encode_hdr_png8(converted, target, source_facts)
                item['checks']['native_encoder'] = True
                facts, frame = hdr_png8.inspect_and_decode(target)
            frames = [frame]
            detail = {'dimensions': frame.shape == reference.shape, 'depth': facts['depth'] == depth,
                'transfer': facts['transfer'] == avif.TRANSFERS[out_transfer],
                'gamut': facts['primaries'] == avif.PRIMARIES[out_gamut],
                'matrix_full_range': facts['matrix'] == 0 and facts['full_range'],
                'orientation_baked': facts['orientation'] == 1, 'frames': True,
                'alpha': np.max(np.abs(frame[..., 3] - reference[..., 3])) <= GEOMETRY_POLICY['alpha_limits'][str(depth)]}
            linear = avif.decode_transfer(frame[..., :3], out_transfer, out_gamut)
        detail = {key: bool(value) for key, value in detail.items()}
        facts['alpha_measurement'] = {'maximum_absolute_error': float(np.max(np.abs(frames[0][..., 3] - reference[..., 3]))),
            'absolute_error_limit': GEOMETRY_POLICY['alpha_limits'][str(depth)],
            'comparison': 'Independent premultiplied matched-geometry source alpha'}
        privacy = hdr_png.inspect_privacy(target, facts, extension)
        expected = sdr_signal_to_nits(reference_srgb(reference[..., :3], gamut, peak_nits=1000)) if sdr else reference[..., :3]
        measured = compare_appearance(expected, linear, reference_gamut=out_gamut, actual_gamut=out_gamut,
            fixture_class='sdr-8' if sdr else 'avif-8', alpha=reference[..., 3],
            region_reference_luminance_nits=reference[..., :3] @ RGB_TO_XYZ[gamut][1])
        if sdr:
            item['measurements']['tone_controls'] = [tone]
            measured['tone_control_passed'] = tone['passed']
            measured['passed'] &= tone['passed']
        item['measurements']['frames'] = [measured]
        item['checks'].update({'independent_decoder': True, 'structure': all(detail.values()),
                              'appearance': bool(measured['passed']), 'privacy': privacy['passed']})
        item['facts'], item['structural_checks'], item['privacy_measurement'] = facts, detail, privacy
        item['representation'] = {'primaries': out_gamut, 'transfer': out_transfer, 'depth': depth}
        item['artifacts'] = {'output': str(target), 'sha256': avif.digest(target),
                             'source': str(source), 'source_sha256': avif.digest(source)}
        item['blockers'] += [f'Failed {key} check' for key, passed in item['checks'].items() if not passed]
        if all(item['checks'].values()) and not item['blockers']:
            item['status'] = 'qualified'
    except Exception as error:
        item['blockers'].append(str(error))
    return item


def run(output_directory, *, specs=None, orientation_lock=ORIENTATION_LOCK):
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source_hashes = json.loads(hdr_png8_proof.SOURCE_LOCK.read_text())['sha256']
    orientation_hashes = json.loads(Path(orientation_lock).read_text())['sha256']
    sources, fixtures, prepared, evidence = [], [], [], []
    # Require both complete source sets before any candidate converter.
    for spec in (hdr_png8.fixture_specs() if specs is None else specs):
        source, base = hdr_png8.generate_fixture(spec, root/spec['id'])
        oriented, orientation = generate_orientation_fixture(source, base)
        for fixture, expected, lock in ((base, source_hashes, hdr_png8_proof.SOURCE_LOCK),
                                        (orientation, orientation_hashes, orientation_lock)):
            if not fixture['source_valid'] or fixture['sha256'] != expected.get(fixture['id']):
                raise ValueError(f'PNG8 geometry source hash/qualification mismatch for {fixture["id"]}; conversion withheld')
            fixture['source_lock'] = {'passed': True, 'sha256': fixture['sha256'], 'path': str(lock),
                                      'lock_sha256': avif.digest(lock)}
        sources.append(base)
        fixtures.append(orientation)
        prepared.append((source, base, oriented, orientation))
    for source, base, oriented, orientation in prepared:
        folder = source.parent
        facts, pixels = hdr_png8.inspect_and_decode(source)
        reference_source = pixels.copy()
        reference_source[..., :3] = avif.decode_transfer(pixels[..., :3], facts['transfer_name'], facts['gamut'])
        normalized = folder/'normalized-source.png'
        normalization = hdr_png8_proof.normalize_source(source, normalized)
        if not normalization['passed']:
            raise ValueError('Native source normalization is not exact; geometry conversions withheld')
        tone = avif.sdr_tone_control(normalized, folder/'sdr-control.png', reference_source,
            avif.make_scene(facts['alpha_channel']), facts['transfer_name'], facts['gamut'], peak_nits=1000)
        baked, oriented_normalization, rotation = _prepare_orientation(oriented, folder)
        for geometry in ('cover', 'fill', 'upscale', 'orientation'):
            reference = avif.geometry_reference(reference_source, geometry)
            is_orientation = geometry == 'orientation'
            for dynamic_range, extension, depth in (('hdr', 'png', 8), ('hdr', 'avif', 8), ('sdr', 'png', 16), ('sdr', 'avif', 8)):
                evidence.append(_measure(oriented if is_orientation else source,
                    baked if is_orientation else normalized, orientation if is_orientation else base,
                    reference, geometry, oriented_normalization if is_orientation else normalization,
                    rotation if is_orientation else None, tone, folder, dynamic_range, extension, depth))
        print(f'PNG8 {base["id"]}: 16 additional native geometry outputs measured', flush=True)
    return {'evidence': evidence, 'fixtures': fixtures, 'source_fixtures': sources,
            'controls': [], 'commands': avif.COMMANDS[start:], 'scope': GEOMETRY_POLICY}
