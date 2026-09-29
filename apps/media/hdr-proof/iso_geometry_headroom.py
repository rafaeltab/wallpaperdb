"""Four existing ISO JPEG recipes, each rendered at boosts2,16,64.

The fixed native recipes and their boost16 checks remain complete endpoint
controls. Independent ISO reconstruction happens at each requested display
boost before the existing target-gamut geometry, including one EXIF6 rotation.
Every rendering uses the same inspected output bytes. No reference array is
sent to an encoder, and no appearance threshold or product selector changes.
"""
import copy
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import combined_gainmap_proof
import gainmap
import gainmap_sdr
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_iso import decode_iso_source
from gainmap_metadata import check_metadata
from gainmap_reference import reference
from matrix import GAINMAP_GEOMETRIES, validate_selectors

GEOMETRIES = ('contain', 'cover', 'fill', 'orientation')
SOURCE_ID = 'gainmap-android-iso'
SOURCE_SHA256 = 'f33bd1aae8c72ded83b31e7e4e4649654ce7bb483a28bcaa4629a7999ff0f80e'
RECIPES = {
    'contain': ('jpegli-base-dct-float-map', '83ae811ce6a6c7e8bd0eba327d0ea5c1c4e7efeb11cd2f9b1ec5e17fa9c40a14'),
    'cover': ('mozjpeg-base-dct-float-map', '433bb087628c7d0e1b7b2a4a3035d86bc08a3a9919c8dfb5f4862e0fd42f0110'),
    'fill': ('dct-float-rgb', '5137e8b84c197b84f4bbfe82c38066d38dde2ac40774f8df670f8249667f8c8e'),
    'orientation': ('dct-float-rgb', 'f5b5ee0ab0b4ced63a4acd90ee37ab7ba44bfa939d5c46f6c1e568237f7f5c9b'),
}
RENDERINGS = {2: 'gainmap-iso-intermediate-boost2-v1', 16: 'gainmap-hdr-target-gamut-v1',
              64: 'gainmap-iso-full-headroom-boost64-v1'}
POLICY = {
    'profile': 'gainmap-hdr',
    'reference': 'Independently decode locked canonical ISO source at each display boost, then unchanged target-P3 float Lanczos geometry; EXIF6 rotates once before resize',
    'threshold_policy': 'Unchanged predeclared gainmap-hdr regional gates at every boost; authored SDR retains gainmap-sdr gates and reference white',
    'scope': 'Four exact native recipes and one output file per geometry; no continuous adaptation or physical consumer qualification',
}


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='p3', actual_gamut='p3',
                              fixture_class='gainmap-hdr')


def _render(endpoint, endpoint_path, directory, source, source_map, operation, boost):
    directory.mkdir(parents=True, exist_ok=True)
    revision = RENDERINGS[boost]
    case = {'case_id': endpoint['case_id']+f':render-boost{boost}',
        'proof_module': 'iso_geometry_headroom',
        'candidate': endpoint['candidate']+'-same-file-headroom', 'fixture_id': SOURCE_ID,
        'source_sha256': SOURCE_SHA256, 'cell_id': endpoint['cell_id'], 'geometry': operation,
        'selectors': copy.deepcopy(endpoint['selectors']), 'source_reference_revision': revision,
        'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': f'One inspected native SOF0 RGB8 file at display boost {boost}, against '
            'the locked ISO source reconstructed at the same boost before geometry. All endpoint checks remain '
            'required; success at this point cannot qualify other boosts or physical consumers.',
        'known_consumer_limitations': [*endpoint['known_consumer_limitations'],
            'Existing libavif consumer decoder diagnostics below were measured at display boost16 only.'],
        'consumer_decoder_diagnostics': {key: {**value, 'display_boost': 16}
            for key, value in endpoint.get('consumer_decoder_diagnostics', {}).items()},
        'rendering_scope': {'display_boost': boost, 'headroom_log2': int(math.log2(boost)),
            'source_reference_revision': revision, 'sdr_white_nits': 203,
            'converter_reference_display_boost': 16, 'headroom_is_product_selector': False},
        'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'converter_endpoint': {'case_id': endpoint['case_id'], 'status': endpoint['status'],
            'display_boost': 16, 'path': str(endpoint_path), 'sha256': avif.digest(endpoint_path)},
        'checks': {name: False for name in ('native_encoder', 'converter_endpoint', 'source_lock', 'source_map',
            'source_transform', 'independent_source_decoder', 'independent_decoder', 'structure',
            'rendering_headroom', 'same_output', 'appearance', 'privacy')},
        'measurements': {}, 'blockers': [], 'artifacts': copy.deepcopy(endpoint['artifacts'])}
    if operation == 'orientation' and 'orientation_source' in endpoint:
        case['orientation_source'] = copy.deepcopy(endpoint['orientation_source'])
    try:
        expected_selectors = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
            'motion': 'preserve', 'transparency': 'preserve', **GAINMAP_GEOMETRIES[operation]}
        output = Path(endpoint['artifacts']['output'])
        original_output = avif.digest(output)
        endpoint_good = (endpoint['status'] == 'qualified' and not endpoint['blockers']
            and all(endpoint['checks'].values())
            and validate_selectors(endpoint['selectors']) == validate_selectors(expected_selectors)
            and endpoint['source_sha256'] == SOURCE_SHA256
            and original_output == endpoint['artifacts']['sha256'] == RECIPES[operation][1])
        case['checks']['native_encoder'] = endpoint['checks']['native_encoder']
        case['checks']['converter_endpoint'] = endpoint_good
        case['checks']['source_lock'] = avif.digest(source) == SOURCE_SHA256
        if not endpoint_good or not case['checks']['source_lock']:
            raise ValueError('Exact locked source and qualified original endpoint bytes/checks are required')
        source_map_hash = endpoint['source_decoder_evidence']['gain_map_sha256']
        case['checks']['source_map'] = avif.digest(source_map) == source_map_hash
        if not case['checks']['source_map']:
            raise ValueError('Extracted source gain map changed')
        orientation = 6 if operation == 'orientation' else 1
        if operation == 'orientation':
            recorded = endpoint['orientation_source']
            actual = gainmap.orientation_source(Path(recorded['path']), directory/'orientation-source.json')
            case['checks']['source_transform'] = actual == recorded and actual['orientation'] == 6
        else:
            case['checks']['source_transform'] = 'orientation_source' not in endpoint
        if not case['checks']['source_transform']:
            raise ValueError('Original EXIF6 source binding changed or was substituted')
        headroom = int(math.log2(boost))
        decoded = decode_iso_source(source.read_bytes(), source_map.read_bytes(), headroom=headroom)
        expected, geometry = reference(decoded['linear_rgb_nits'], decoded['gamut'], 'p3', operation, orientation)
        ref = directory/'independent-source-reference.rgbf64'
        expected.astype('<f8').tofile(ref)
        case['source_decoder_evidence'] = decoded['evidence']
        case['reference_method'] = {**geometry, 'source_rendering_headroom_log2': headroom,
            'source_reference_revision': revision, 'order': 'Decode original identity raster at the requested '
                'boost, then apply the established source orientation once and target-gamut geometry'}
        case['reference_hdr'] = {'path': str(ref), 'sha256': avif.digest(ref), 'gamut': 'p3', 'transfer': 'linear',
            'units': 'cd/m2', 'sample_format': 'interleaved little-endian RGB float64',
            'dimensions': [expected.shape[1], expected.shape[0]], 'display_boost': boost,
            'purpose': 'Independent source reconstruction at the same boost before matched geometry'}
        case['reference_sdr'] = copy.deepcopy(endpoint['reference_sdr'])
        reference_sdr = Path(case['reference_sdr']['path'])
        if avif.digest(reference_sdr) != case['reference_sdr']['sha256']:
            raise ValueError('Original authored SDR reference changed')
        actual_sdr, sdr_facts = gainmap_sdr.decode(output, gamut='p3')
        with Image.open(reference_sdr) as image:
            sdr_reference = sdr_signal_to_nits(np.asarray(image.convert('RGB'))/255)
        sdr = compare_appearance(sdr_reference, sdr_signal_to_nits(actual_sdr),
            reference_gamut='p3', actual_gamut='p3', fixture_class='gainmap-sdr')
        facts = gainmap.inspect(output, directory/'inspection')
        probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
        agreement = check_metadata(facts, probe)
        native_path = directory/'native.gbrpf32'
        native = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr',
            'decode-linear', output, native_path, str(boost)]))
        pixels = np.fromfile(native_path, '<f4').reshape(3, native['height'], native['width'])
        pixels = pixels[[2, 0, 1]].transpose(1, 2, 0)*203
        independent = decode_iso_source(output.read_bytes(), (directory/'inspection/map.jpg').read_bytes(), headroom=headroom)
        oracle = independent['linear_rgb_nits']
        source_capacity = decoded['evidence']['iso_metadata']['alternate_headroom']
        capacity = independent['evidence']['iso_metadata']['alternate_headroom']
        output_weight = float(np.clip(headroom/capacity, 0, 1))
        native_weight = float(np.clip(math.log2(boost/probe['hdr_capacity_min'])
            /math.log2(probe['hdr_capacity_max']/probe['hdr_capacity_min']), 0, 1))
        case['rendering_scope'].update({'source_capacity_headroom_log2': source_capacity,
            'output_capacity_headroom_log2': capacity, 'source_gain_map_weight': min(headroom/source_capacity, 1),
            'output_gain_map_weight': output_weight, 'native_weight_derived_from_verified_inputs': native_weight,
            'native_weight_scope': 'Derived from inspected native probe capacities and recorded boost invocation; not a returned native decoder field'})
        case['hdr_decoder_evidence'] = {'native': native, 'independent': independent['evidence']}
        case['source_facts'], case['facts'] = endpoint['source_facts'], facts
        case['gain_map_metadata_agreement'], case['native_metadata_probe'] = agreement, probe
        cross = _measure(oracle, pixels)
        native_measure, independent_measure = _measure(expected, pixels), _measure(expected, oracle)
        case['measurements'] = {'authored_sdr_base': sdr, 'reconstructed_hdr': native_measure,
            'independent_hdr': independent_measure, 'independent_hdr_cross_decoder': cross}
        case['checks'].update({'independent_source_decoder': True, 'independent_decoder': cross['passed'],
            'structure': (facts == endpoint['facts'] and all(agreement['checks'].values())
                and expected.shape == pixels.shape == oracle.shape
                and native['gamut'] == 1 and independent['gamut'] == sdr_facts['gamut'] == 'p3'),
            'rendering_headroom': bool(native['requested_display_boost'] == boost
                and independent['evidence']['headroom_log2'] == headroom
                and np.isclose(output_weight, native_weight, atol=1e-7, rtol=0)),
            'same_output': (avif.digest(output) == original_output and avif.digest(source) == SOURCE_SHA256
                and avif.digest(source_map) == source_map_hash
                and avif.digest(endpoint_path) == case['converter_endpoint']['sha256']),
            'appearance': sdr['passed'] and native_measure['passed'] and independent_measure['passed'],
            'privacy': not facts['private_tags'] and sdr_facts['privacy']})
        if boost == 64:
            case['checks']['full_headroom_weights'] = min(headroom/source_capacity, 1) == output_weight == 1
        case['blockers'] = [f'Failed {key} check at display boost {boost}'
                            for key, passed in case['checks'].items() if not passed]
        if all(case['checks'].values()):
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def run(directory, *, geometries=GEOMETRIES):
    if (type(geometries) is not tuple or not geometries or len(set(geometries)) != len(geometries)
            or any(operation not in GEOMETRIES for operation in geometries)):
        raise ValueError('Only unique declared ISO contain/cover/fill/EXIF6 geometries are admitted')
    source = gainmap.FIXTURES/(SOURCE_ID+'.jpg')
    if avif.digest(source) != SOURCE_SHA256:
        raise ValueError('Changed or unknown ISO source remains original only')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    report = {'scope': POLICY['scope'], 'cases': [], 'converter_endpoints': [], 'declaration': POLICY,
        'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}
    for operation in geometries:
        endpoint_directory = directory/operation/'converter-endpoint'
        endpoints = combined_gainmap_proof.run(endpoint_directory, names=(SOURCE_ID,), geometries=(operation,),
            policies=('moderateoffset',), coding=RECIPES[operation][0])
        endpoint = endpoints[0]
        endpoint_path = endpoint_directory/'endpoint.json'
        endpoint_path.write_text(json.dumps(endpoint, indent=2)+'\n')
        report['converter_endpoints'].append(endpoint)
        source_map = endpoint_directory/'sources'/SOURCE_ID/'map.jpg'
        for boost in RENDERINGS:
            report['cases'].append(_render(endpoint, endpoint_path, directory/operation/f'boost{boost}',
                                           source, source_map, operation, boost))
    report['commands'] = avif.COMMANDS[start:]
    report['native_logs'] = [{'path': str(path), 'sha256': avif.digest(path)} for path in sorted(directory.rglob('*.log'))]
    report['native_hashes'] = {name: avif.digest(Path(name)) for name in
        ('/opt/proof/ultrahdr/precise/hdr-proof-uhdr', '/usr/bin/ffmpeg', '/usr/bin/exiftool')}
    report['source_hashes'] = {name: avif.digest(Path(__file__).with_name(name)) for name in
        ('iso_geometry_headroom.py', 'combined_gainmap_proof.py', 'gainmap_combine.py', 'gainmap.py',
         'gainmap_iso.py', 'gainmap_reference.py', 'gainmap_metadata.py', 'gainmap_sdr.py', 'appearance.py')}
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
