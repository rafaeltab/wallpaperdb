"""One retained XMP-source native JPEG, independently measured at boosts2/16.

Original JPEG samples and independently parsed XMP are reconstructed before
the unchanged target-sRGB float Lanczos geometry. The native moderate-offset
FLOAT-DCT recipe and its prior boost16 endpoint remain exact controls. New
reference revisions are separate from that earlier shared-libavif reference.
The fixed gainmap-hdr and gainmap-sdr limits are unchanged. Failed appearance
at either point stays visible and cannot qualify same-file HDR adaptation.
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
import gainmap_xmp
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_iso import decode_iso_source
from gainmap_metadata import check_metadata
from gainmap_reference import reference
from matrix import GAINMAP_GEOMETRIES, validate_selectors

SOURCE_ID = 'gainmap-android-xmp'
OUTPUT_SHA256 = '50fcfb8f31c9da4fca968f608e3cb0e41cd672247b3d3f8fa9fc83de7e702517'
REVISIONS = {2: 'gainmap-xmp-intermediate-boost2-v1', 16: 'gainmap-xmp-independent-boost16-v1'}
POLICY = {
    'profile': 'gainmap-hdr', 'sdr_profile': 'gainmap-sdr',
    'source_renderer': gainmap_xmp.SAMPLING_REVISION,
    'reference': 'Independent original JPEG/XML rendering at each boost before target-sRGB float Lanczos containment; no encoder reference feedback',
    'threshold_policy': 'Unchanged predeclared gainmap-hdr and gainmap-sdr gates; no allowance for the new independent reference',
    'scope': 'One exact static opaque RGB8 SOF0 containment output at boosts2/16 only; no continuous adaptation or physical qualification',
}


def _measure(expected, actual):
    return compare_appearance(expected, actual, reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-hdr')


def _render(directory, endpoint, endpoint_path, source_report, source_report_path, boost):
    directory.mkdir(parents=True, exist_ok=True)
    revision = REVISIONS[boost]
    case = {'case_id': endpoint['case_id']+f':independent-xmp-render-boost{boost}',
        'proof_module': 'xmp_containment_headroom', 'candidate': endpoint['candidate']+'-independent-xmp-headroom',
        'fixture_id': SOURCE_ID, 'source_sha256': gainmap_xmp.SOURCE_SHA256,
        'cell_id': 'gainmap-jpeg:hdr:jpg', 'geometry': 'contain', 'selectors': copy.deepcopy(endpoint['selectors']),
        'source_reference_revision': revision, 'status': 'tested and failed', 'consumer_status': 'pending manual review',
        'qualification_scope': f'One exact SOF0 RGB8 output at display boost {boost}, against independent legacy EXIF-sRGB '
            'XMP source rendering before containment; this point does not qualify other headrooms or physical consumers.',
        'known_consumer_limitations': [*endpoint['known_consumer_limitations'],
            'Original source lacks the ICC required by the Android container specification; explicit EXIF sRGB establishes only this legacy source scope.',
            'Existing output libavif diagnostic below was measured at boost16; original-source UltraHDR mismatch remains a separate failed diagnostic.'],
        'consumer_decoder_diagnostics': {key: {**value, 'display_boost': 16}
            for key, value in endpoint.get('consumer_decoder_diagnostics', {}).items()},
        'rendering_scope': {'display_boost': boost, 'headroom_log2': int(math.log2(boost)), 'sdr_white_nits': 203,
            'source_reference_revision': revision, 'converter_reference_display_boost': 16, 'headroom_is_product_selector': False},
        'threshold_scope': {**POLICY, 'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))},
        'checks': {name: False for name in ('native_encoder', 'converter_endpoint', 'independent_source_decoder',
            'source_facts', 'independent_decoder', 'structure', 'rendering_headroom', 'same_output', 'appearance', 'privacy')},
        'artifacts': copy.deepcopy(endpoint['artifacts']), 'measurements': {}, 'blockers': [],
        'converter_endpoint': {'case_id': endpoint['case_id'], 'status': endpoint['status'], 'display_boost': 16,
            'source_reference_revision': endpoint['source_reference_revision'], 'path': str(endpoint_path), 'sha256': avif.digest(endpoint_path)},
        'source_renderer': {'path': str(source_report_path), 'sha256': avif.digest(source_report_path), 'status': source_report['status']}}
    try:
        source = Path(source_report['source']['path'])
        source_map = Path(source_report['source']['evidence']['map_path'])
        output = Path(endpoint['artifacts']['output'])
        selectors = {'format': 'jpg', 'range': 'hdr', 'gamut': 'preserve', 'depth': 'preserve',
                     'motion': 'preserve', 'transparency': 'preserve', **GAINMAP_GEOMETRIES['contain']}
        endpoint_good = (endpoint['status'] == 'qualified' and not endpoint['blockers'] and all(endpoint['checks'].values())
            and endpoint['source_sha256'] == gainmap_xmp.SOURCE_SHA256
            and validate_selectors(endpoint['selectors']) == validate_selectors(selectors)
            and endpoint['artifacts']['sha256'] == avif.digest(output) == OUTPUT_SHA256
            and 'orientation_source' not in endpoint and not endpoint.get('probe_crop_rectangle'))
        case['checks']['native_encoder'] = endpoint['checks']['native_encoder']
        case['checks']['converter_endpoint'] = endpoint_good
        case['checks']['source_facts'] = (avif.digest(source) == gainmap_xmp.SOURCE_SHA256
            and avif.digest(source_map) == gainmap_xmp.MAP_SHA256
            and source_report['status'] == 'qualified source renderer' and all(source_report['checks'].values()))
        if not endpoint_good or not case['checks']['source_facts']:
            raise ValueError('Exact endpoint bytes and independently qualified locked XMP source are required')
        decoded = gainmap_xmp.decode_xmp_source(source.read_bytes(), source_map.read_bytes(), headroom=math.log2(boost))
        expected, geometry = reference(decoded['linear_rgb_nits'], 'srgb', 'srgb', 'contain', 1)
        ref = directory/'independent-source-reference.rgbf64'
        expected.astype('<f8').tofile(ref)
        case['reference_hdr'] = {'path': str(ref), 'sha256': avif.digest(ref), 'gamut': 'srgb', 'transfer': 'linear',
            'units': 'cd/m2', 'sample_format': 'interleaved little-endian RGB float64',
            'dimensions': [173, 130], 'display_boost': boost, 'revision': revision}
        case['reference_method'] = {**geometry, 'source_reference_revision': revision,
            'order': 'Independent source reconstruction at requested boost before target-gamut containment; identity orientation'}
        case['source_decoder_evidence'] = decoded['evidence']
        case['source_facts'] = source_report['source']
        case['reference_sdr'] = copy.deepcopy(endpoint['reference_sdr'])
        sdr_path = Path(case['reference_sdr']['path'])
        if avif.digest(sdr_path) != case['reference_sdr']['sha256']:
            raise ValueError('Original authored SDR reference changed')
        actual_sdr, sdr_facts = gainmap_sdr.decode(output, gamut='srgb')
        with Image.open(sdr_path) as image:
            sdr_reference = sdr_signal_to_nits(np.asarray(image.convert('RGB'))/255)
        sdr = compare_appearance(sdr_reference, sdr_signal_to_nits(actual_sdr),
            reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        facts = gainmap.inspect(output, directory/'inspection')
        extracted_map = directory/'inspection/map.jpg'
        map_hash = endpoint['hdr_decoder_evidence']['iso']['gain_map_sha256']
        if avif.digest(extracted_map) != map_hash:
            raise ValueError('Output map differs from the original endpoint inspection')
        protected = [source, source_map, output, extracted_map, ref, sdr_path, endpoint_path, source_report_path]
        before = {str(path): avif.digest(path) for path in protected}
        probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
        agreement = check_metadata(facts, probe)
        raw = directory/'native.gbrpf32'
        native = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'decode-linear', output, raw, str(boost)]))
        pixels = np.fromfile(raw, '<f4').reshape(3, native['height'], native['width'])[[2, 0, 1]].transpose(1, 2, 0)*203
        if avif.digest(extracted_map) != map_hash:
            raise ValueError('Inspected output gain map changed before independent decoding')
        independent = decode_iso_source(output.read_bytes(), extracted_map.read_bytes(), headroom=math.log2(boost))
        oracle = independent['linear_rgb_nits']
        capacity = independent['evidence']['iso_metadata']['alternate_headroom']
        output_weight = float(np.clip(math.log2(boost)/capacity, 0, 1))
        native_weight = float(np.clip(math.log2(boost/probe['hdr_capacity_min'])/
            math.log2(probe['hdr_capacity_max']/probe['hdr_capacity_min']), 0, 1))
        cross = _measure(oracle, pixels)
        native_measure, independent_measure = _measure(expected, pixels), _measure(expected, oracle)
        case.update({'facts': facts, 'gain_map_metadata_agreement': agreement, 'native_metadata_probe': probe,
            'hdr_decoder_evidence': {'native': native, 'independent': independent['evidence']},
            'sdr_decoder_evidence': sdr_facts,
            'measurements': {'authored_sdr_base': sdr, 'reconstructed_hdr': native_measure,
                'independent_hdr': independent_measure, 'independent_hdr_cross_decoder': cross}})
        case['rendering_scope'].update({'source_capacity_headroom_log2': decoded['evidence']['metadata']['alternate_headroom'],
            'output_capacity_headroom_log2': capacity, 'source_gain_map_weight': decoded['evidence']['gain_map_weight'],
            'output_gain_map_weight': output_weight, 'native_weight_derived_from_verified_inputs': native_weight,
            'native_weight_scope': 'Derived from actual probe capacities and recorded boost invocation; not a returned native field'})
        case['checks'].update({'independent_source_decoder': True, 'independent_decoder': cross['passed'],
            'structure': facts == endpoint['facts'] and all(agreement['checks'].values())
                and expected.shape == pixels.shape == oracle.shape == (130, 173, 3)
                and native['gamut'] == 0 and independent['gamut'] == sdr_facts['gamut'] == 'srgb',
            'rendering_headroom': bool(native['requested_display_boost'] == boost
                and independent['evidence']['headroom_log2'] == math.log2(boost)
                and np.isclose(output_weight, native_weight, atol=1e-7, rtol=0)),
            'same_output': before == {str(path): avif.digest(path) for path in protected},
            'appearance': sdr['passed'] and native_measure['passed'] and independent_measure['passed'],
            'privacy': not facts['private_tags'] and sdr_facts['privacy']})
        case['blockers'] = [f'Failed {name} check at display boost {boost}' for name, passed in case['checks'].items() if not passed]
        if all(case['checks'].values()):
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def run(directory, *, source_id=SOURCE_ID, operation='contain'):
    if source_id != SOURCE_ID or operation != 'contain':
        raise ValueError('Only the declared locked XMP containment recipe is admitted')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source_report = gainmap_xmp.run(directory/'source-renderer')
    source_report_path = directory/'source-renderer/evidence.json'
    endpoint_dir = directory/'converter-endpoint'
    endpoint = combined_gainmap_proof.run(endpoint_dir, names=(SOURCE_ID,), geometries=('contain',),
        policies=('moderateoffset',), coding='dct-float-rgb')[0]
    endpoint_path = endpoint_dir/'endpoint.json'
    endpoint_path.write_text(json.dumps(endpoint, indent=2)+'\n')
    cases = [_render(directory/f'boost{boost}', endpoint, endpoint_path, source_report, source_report_path, boost)
             for boost in REVISIONS]
    report = {'cases': cases, 'declaration': POLICY, 'source_renderer': source_report,
        'converter_endpoint': {'case': endpoint, 'path': str(endpoint_path), 'sha256': avif.digest(endpoint_path)},
        'consumer_status': 'pending manual review', 'commands': avif.COMMANDS[start:],
        'threshold_sha256': avif.digest(Path(__file__).with_name('thresholds.json')),
        'source_hashes': {name: avif.digest(Path(__file__).with_name(name)) for name in
            ('xmp_containment_headroom.py', 'gainmap_xmp.py', 'combined_gainmap_proof.py', 'gainmap_combine.py',
             'gainmap_iso.py', 'gainmap.py', 'gainmap_metadata.py', 'gainmap_reference.py', 'gainmap_sdr.py', 'appearance.py')}}
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
