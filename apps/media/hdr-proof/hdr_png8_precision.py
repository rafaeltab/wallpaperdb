"""Explicit higher-depth HDR containment candidates from locked PNG8 sources.

Declared before measurements: both PNG16 and AVIF12 must satisfy the existing
avif-12 ceiling. Sixteen-bit PNG must meet that same strict gate; it receives no
extra error allowance. The reference comes from independently decoded source
intent after premultiplied geometry. Source eight-bit quantization is measured
separately and never added to the output error budget. Alpha limits are two
output codes, 2/65535 for PNG16 and 2/4095 for AVIF12. Exact native source
expansion is required before conversion. Existing PNG8 cases stay unchanged.
"""
import json
from pathlib import Path
import struct

import numpy as np

import avif
import hdr_png
import hdr_png8
import hdr_png8_proof
from appearance import RGB_TO_XYZ, compare_appearance
from matrix import request_decision


SOURCE_LOCK = hdr_png8_proof.SOURCE_LOCK
PRECISION_POLICY = {
    'declared_before_native_measurements': True,
    'output_profile': 'avif-12',
    'rationale': ('Twelve-bit AVIF and finer sixteen-bit PNG outputs both retain the existing '
                  'strict avif-12 ceiling against decoded-source geometry. Source quantization '
                  'does not excuse additional conversion error.'),
    'alpha_limits': {'12': 2 / 4095, '16': 2 / 65535},
    'geometry': 'Contain58x38 producing57x38; independent premultiplied Pillow bilinear reference',
    'scope': 'Only these explicit higher-depth HDR containment tuples; physical consumers remain pending',
}


def inspect_hdr_png16(path):
    chunks = hdr_png._png_chunks(Path(path).read_bytes())
    headers = [payload for kind, payload in chunks if kind == b'IHDR']
    if (len(headers) != 1 or len(headers[0]) != 13
            or any(kind in (b'acTL', b'fcTL', b'fdAT', b'tRNS') for kind, _ in chunks)):
        raise ValueError('Expected a unique static HDR PNG header without indexed transparency')
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', headers[0])
    if depth != 16 or color_type not in (2, 6) or (compression, filtering, interlace) != (0, 0, 0):
        raise ValueError('Expected non-interlaced sixteen-bit RGB/RGBA PNG output')
    facts = hdr_png.inspect_source(path)
    if ((facts['width'], facts['height'], facts['depth'], facts['orientation']) != (width, height, depth, 1)
            or facts['exiftool'].get('ColorType') != color_type):
        raise ValueError('Independent ExifTool disagrees with the HDR PNG output header/orientation')
    raw = avif.native(['hdr-proof-png-decode', path])
    if len(raw) != 12 + width * height * 8 or struct.unpack('<III', raw[:12]) != (width, height, 16):
        raise ValueError('Independent native libpng disagrees with the HDR PNG output depth/dimensions')
    pixels = np.frombuffer(raw[12:], dtype='<u2').reshape(height, width, 4).astype(float)/65535
    facts.update({'color_type': color_type, 'alpha_channel': color_type == 6,
                  'libpng_source_depth': depth, 'decoder': 'independent native libpng; unchanged coded RGB and alpha'})
    return facts, pixels


def run(output_directory, *, specs=None, source_lock=SOURCE_LOCK):
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    expected_hashes = json.loads(Path(source_lock).read_text())['sha256']
    sources, evidence = [], []
    for spec in (hdr_png8.fixture_specs() if specs is None else specs):
        source, fixture = hdr_png8.generate_fixture(spec, root/spec['id'])
        if not fixture['source_valid'] or fixture['sha256'] != expected_hashes.get(spec['id']):
            raise ValueError(f'PNG8 precision source hash/qualification mismatch for {spec["id"]}; conversion withheld')
        fixture['source_lock'] = {'passed': True, 'sha256': fixture['sha256'], 'path': str(source_lock),
                                  'lock_sha256': avif.digest(source_lock)}
        sources.append(fixture)
    for fixture in sources:
        source = Path(fixture['path'])
        folder = source.parent
        source_facts, pixels = hdr_png8.inspect_and_decode(source)
        transfer, gamut = source_facts['transfer_name'], source_facts['gamut']
        reference_source = pixels.copy()
        reference_source[..., :3] = avif.decode_transfer(pixels[..., :3], transfer, gamut)
        reference = avif.geometry_reference(reference_source, 'contain')
        normalized = folder/'normalized-source.png'
        normalization = hdr_png8_proof.normalize_source(source, normalized)
        known = {'format': 'png', 'range': 'hdr', 'gamut': gamut, 'depth': source_facts['depth'],
                 'width': source_facts['width'], 'height': source_facts['height'], 'motion': 'static',
                 'alpha': 'fractional' if np.any((pixels[..., 3] > 0) & (pixels[..., 3] < 1)) else 'none',
                 'alpha_capable': True, 'orientation': source_facts['orientation']}
        for extension, depth in (('png', 16), ('avif', 12)):
            selectors = {'format': extension, 'range': 'hdr', 'gamut': 'preserve', 'depth': str(depth),
                'motion': 'preserve', 'transparency': 'preserve', 'w': 58, 'h': 38, 'fit': 'contain'}
            case_id = f'{fixture["id"]}:hdr:{extension}:preserve:preserve:contain:normalized-source16:depth{depth}'
            directory = folder/case_id.replace(':', '-')
            directory.mkdir(exist_ok=True)
            item = {'case_id': case_id, 'fixture_id': fixture['id'], 'cell_id': f'hdr-png:hdr:{extension}',
                'selectors': selectors, 'geometry': 'contain', 'status': 'tested and failed',
                'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                'blockers': [], 'measurements': {}, 'artifacts': {}, 'source_facts': source_facts,
                'source_normalization': normalization, 'consumer_status': 'pending manual review',
                'threshold_scope': {**PRECISION_POLICY,
                    'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}}
            try:
                if not normalization['passed']:
                    raise ValueError('Exact native source normalization failed; higher-depth conversion withheld')
                item['request_decision'] = request_decision(known, selectors)
                if item['request_decision']['action'] != 'unqualified':
                    raise ValueError('The explicit depth tuple is outside this native conversion experiment')
                converted, target = directory/'converted.png', directory/f'output.{extension}'
                avif.convert_frame(normalized, converted, transfer, gamut, 'contain')
                if extension == 'avif':
                    avif.encode_avif([converted], target, transfer, gamut, depth)
                    item['checks']['native_encoder'] = True
                    facts = avif.inspect_avif(target)
                    frames = avif.decode_avif(target, directory, 1)
                    detail = avif.structure_checks(facts, frames, fixture['spec'], [reference], transfer, gamut, depth, 1)
                    actual = frames[0]
                else:
                    avif.encode_other([converted], target, 'png', transfer, gamut, [reference], 1, fixture['spec'])
                    item['checks']['native_encoder'] = True
                    facts, actual = inspect_hdr_png16(target)
                    detail = {'dimensions': actual.shape == reference.shape, 'depth': facts['depth'] == depth,
                        'transfer': facts['transfer'] == avif.TRANSFERS[transfer],
                        'gamut': facts['primaries'] == avif.PRIMARIES[gamut],
                        'matrix_full_range': facts['matrix'] == 0 and facts['full_range'],
                        'orientation_baked': facts['orientation'] == 1, 'frames': True,
                        'alpha': np.max(np.abs(actual[..., 3] - reference[..., 3])) <= PRECISION_POLICY['alpha_limits'][str(depth)]}
                detail = {key: bool(value) for key, value in detail.items()}
                facts['alpha_measurement'] = {
                    'maximum_absolute_error': float(np.max(np.abs(actual[..., 3] - reference[..., 3]))),
                    'absolute_error_limit': PRECISION_POLICY['alpha_limits'][str(depth)],
                    'comparison': 'Independent premultiplied matched-geometry source alpha'}
                privacy = hdr_png.inspect_privacy(target, facts, extension)
                linear = avif.decode_transfer(actual[..., :3], transfer, gamut)
                measured = compare_appearance(reference[..., :3], linear, reference_gamut=gamut, actual_gamut=gamut,
                    fixture_class='avif-12', alpha=reference[..., 3],
                    region_reference_luminance_nits=reference[..., :3] @ RGB_TO_XYZ[gamut][1])
                item['measurements']['frames'] = [measured]
                item['checks'].update({'independent_decoder': True, 'structure': all(detail.values()),
                                      'appearance': bool(measured['passed']), 'privacy': privacy['passed']})
                item['facts'], item['structural_checks'], item['privacy_measurement'] = facts, detail, privacy
                item['representation'] = {'primaries': gamut, 'transfer': transfer, 'depth': depth}
                item['artifacts'] = {'output': str(target), 'sha256': avif.digest(target),
                                     'source': str(source), 'source_sha256': avif.digest(source)}
                item['blockers'] += [f'Failed {key} check' for key, passed in item['checks'].items() if not passed]
                if all(item['checks'].values()) and not item['blockers']:
                    item['status'] = 'qualified'
            except Exception as error:
                item['blockers'].append(str(error))
            evidence.append(item)
        print(f'PNG8 {fixture["id"]}: two higher-depth native containment outputs measured', flush=True)
    return {'evidence': evidence, 'fixtures': [], 'source_fixtures': sources, 'controls': [],
            'commands': avif.COMMANDS[start:], 'scope': PRECISION_POLICY}
