"""Preserve native source capacities while retaining a full-source coded map.

Only the two capacity fields change. The native packer reads those fields
from the actual pinned ISO source; it has no fitted headroom parameter.
One resulting file is independently measured at all three declared boosts.
"""
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap
import gainmap_sdr
import iso_full_headroom_candidate as full
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap_iso import jpeg_facts, segments
from gainmap_metadata import check_metadata

TOOL = '/opt/proof/gainmap-capacity/hdr-proof-gainmap-capacity'
SOURCE_SHA = 'f33bd1aae8c72ded83b31e7e4e4649654ce7bb483a28bcaa4629a7999ff0f80e'


def coded_payload(data):
    """Return SOF0 tables/header/entropy bytes, excluding APP/COM metadata.

    Capacity metadata must change, so the full JPEG container cannot remain
    byte-identical. This verifies exact compressed coding bytes separately
    from actual ICC bytes. Only a single baseline scan is admitted here.
    """
    if data[:2] != b'\xff\xd8':
        raise ValueError('Expected JPEG SOI')
    output, pos, baseline = bytearray(data[:2]), 2, False
    while pos + 4 <= len(data):
        start = pos
        if data[pos] != 255:
            raise ValueError('Invalid JPEG marker boundary')
        while pos < len(data) and data[pos] == 255:
            pos += 1
        marker = data[pos]
        pos += 1
        length = int.from_bytes(data[pos:pos+2], 'big')
        if length < 2 or pos+length > len(data):
            raise ValueError('Invalid JPEG marker length')
        end = pos+length
        if marker == 0xC0:
            baseline = True
        elif 0xC1 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            raise ValueError('Only SOF0 baseline coding is admitted')
        if not 0xE0 <= marker <= 0xEF and marker != 0xFE:
            output.extend(data[start:end])
        if marker == 0xDA:
            if not baseline:
                raise ValueError('Missing SOF0 before scan')
            pos = end
            while pos+1 < len(data):
                if data[pos] == 255:
                    following = data[pos+1]
                    if following == 0xD9:
                        output.extend(data[end:pos+2])
                        return bytes(output)
                    if following not in (0, 255) and not 0xD0 <= following <= 0xD7:
                        raise ValueError('Unexpected second scan or marker in baseline entropy')
                    pos += 2 if following != 255 else 1
                else:
                    pos += 1
            raise ValueError('Truncated JPEG entropy')
        pos = end
    raise ValueError('Truncated JPEG header')


def pack(source, candidate, base, map_path, output):
    source, candidate, base, map_path, output = map(Path, (source, candidate, base, map_path, output))
    if avif.digest(source) != SOURCE_SHA:
        raise ValueError('Unknown or changed ISO source; original-only handling is required')
    if output.resolve() in {path.resolve() for path in (source, candidate, base, map_path)}:
        raise ValueError('Native capacity proof cannot overwrite an input')
    for path, allow_icc in ((base, True), (map_path, False)):
        data = path.read_bytes()
        facts = jpeg_facts(data)
        headers = list(segments(data))
        if (facts['sof'] != 0 or facts['depth'] != 8 or facts['components'] != 3
                or not any(marker == 0xC0 and value[6::3] == b'RGB' for marker, value in headers)):
            raise ValueError('Supplied parts require native SOF0 RGB8 coding')
        for marker, value in headers:
            if marker == 0xFE or 0xE0 <= marker <= 0xEF:
                adobe_rgb = marker == 0xEE and value == b'Adobe\x00d\x00\x00\x00\x00\x00'
                base_icc = allow_icc and marker == 0xE2 and value.startswith(b'ICC_PROFILE\0')
                if not adobe_rgb and not base_icc:
                    raise ValueError('Unknown supplied-part metadata or conflicting JPEG color interpretation')
    inspection = output.with_name(output.stem+'-input-inspection')
    candidate_facts = gainmap.inspect(candidate, inspection)
    if not candidate_facts.get('gain_map_present'):
        raise ValueError('Native packing requires an actual candidate gain map')
    extracted_map = inspection/'map.jpg'
    if (coded_payload(base.read_bytes()) != coded_payload(candidate.read_bytes())
            or coded_payload(map_path.read_bytes()) != coded_payload(extracted_map.read_bytes())):
        raise ValueError('Supplied compressed coding bytes differ from the candidate base/map')
    with Image.open(base) as image:
        supplied_icc = image.info.get('icc_profile')
    with Image.open(candidate) as image:
        candidate_icc = image.info.get('icc_profile')
    if not candidate_icc or supplied_icc != candidate_icc:
        raise ValueError('Supplied base ICC differs from the candidate actual profile')
    with Image.open(extracted_map) as image:
        if image.info.get('icc_profile'):
            raise ValueError('Candidate gain map must not carry a display ICC profile')
    before = {name: avif.digest(path) for name, path in
              (('source', source), ('candidate', candidate), ('base', base), ('map', map_path))}
    native = json.loads(avif.native([TOOL, 'pack-source-capacity', source, candidate, base, map_path, output]))
    after = {name: avif.digest(path) for name, path in
             (('source', source), ('candidate', candidate), ('base', base), ('map', map_path))}
    if before != after:
        raise ValueError('Native packing changed an input file')
    return {'native': native, 'input_sha256': before, 'output_sha256': avif.digest(output),
            'input_correspondence': 'Exact SOF0 tables/header/entropy bytes and actual base ICC match '
                'independently extracted candidate parts before native packing',
            'helper_sha256': avif.digest(TOOL)}


def run(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    control_directory = directory/'full-source-control'
    control_report = full.run(control_directory)
    cases = copy.deepcopy(control_report['cases'])
    for case in cases:
        case['case_id'] += ':source-capacity'
        case['candidate'] += '-source-capacity'
        case['status'], case['blockers'] = 'tested and failed', []
        # Shared preparation remains evidence, but an unexecuted new pack or
        # rendering must never inherit the control file's output measurements.
        for key in ('native_candidate', 'facts', 'hdr_decoder_evidence', 'consumer_decoder_diagnostics',
                    'gain_map_metadata_agreement', 'native_metadata_probe', 'sdr_decoder_evidence', 'structural_checks'):
            case.pop(key, None)
        case['artifacts'] = {}
        for name in ('reconstructed_hdr', 'independent_hdr', 'independent_hdr_cross_decoder', 'authored_sdr_base'):
            case['measurements'].pop(name, None)
        case['checks'].update({'native_encoder': False, 'independent_decoder': False,
            'structure': False, 'appearance': False, 'privacy': False, 'source_capacity_preservation': False})
    original_full = next(case for case in control_report['cases'] if case['rendering_scope']['display_boost'] == 64)
    report = {'scope': 'One source-capacity-preserving native file; all actual2/16/64 renderings remain separately gated',
        'declaration': 'Copy only actual source hdr_capacity_min/max through the pinned native compressed-image API. '
            'No fitted capacity, gain, gamma, offset, reference, geometry or threshold changes.',
        'full_source_control': {'output_sha256': original_full.get('artifacts', {}).get('sha256'),
            'statuses': {str(case['rendering_scope']['display_boost']): case['status'] for case in control_report['cases']},
            'path': str(control_directory/'results.json'), 'sha256': avif.digest(control_directory/'results.json'),
            'full_headroom_measurement': original_full['measurements'].get('reconstructed_hdr')},
        'cases': cases, 'preservation_checks': {}, 'threshold_sha256': control_report['threshold_sha256']}
    try:
        if original_full['status'] != 'qualified':
            raise ValueError('The full-source control did not qualify at boost64')
        source = gainmap.FIXTURES/'gainmap-android-iso.jpg'
        candidate = Path(original_full['artifacts']['output'])
        base = Path(control_report['native_candidate']['base'])
        map_path = control_directory/'output-icc-parts/map.jpg'
        output = directory/'output.jpg'
        encoded = pack(source, candidate, base, map_path, output)
        report['native_candidate'] = encoded
        facts = gainmap.inspect(output, directory/'inspection')
        native_probe = json.loads(avif.native(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'probe', output]))
        metadata_agreement = check_metadata(facts, native_probe)
        old_facts = original_full['facts']
        source_metadata = original_full['source_facts']['iso_metadata']
        old_metadata, new_metadata = old_facts['iso_metadata'], facts['iso_metadata']
        other_metadata = lambda metadata: {key: value for key, value in metadata.items()
                                           if key not in ('base_headroom', 'alternate_headroom')}
        with Image.open(output) as image:
            new_icc = image.info.get('icc_profile')
        with Image.open(base) as image:
            base_icc = image.info.get('icc_profile')
        old_map = control_directory/'inspection/map.jpg'
        new_map = directory/'inspection/map.jpg'
        coding = {}
        for name, paths in (('base', (base, candidate, output)), ('map', (map_path, old_map, new_map))):
            coding[name] = [hashlib.sha256(coded_payload(path.read_bytes())).hexdigest() for path in paths]
        preservation = {'compressed_base_coding': len(set(coding['base'])) == 1,
            'compressed_map_coding': len(set(coding['map'])) == 1, 'actual_icc_bytes': new_icc == base_icc,
            'all_other_iso_metadata': other_metadata(old_metadata) == other_metadata(new_metadata),
            'source_capacities': all(new_metadata[key] == source_metadata[key]
                                     for key in ('base_headroom', 'alternate_headroom')),
            'iso_native_xmp_agreement': all(metadata_agreement['checks'].values())}
        report['preservation_checks'], report['coded_payload_sha256'] = preservation, coding
        report['actual_icc_sha256'] = hashlib.sha256(new_icc).hexdigest()
        actual_sdr, sdr_facts = gainmap_sdr.decode_linear(output, gamut='p3', gamma=3.2)
        with Image.open(original_full['reference_sdr']['path']) as image:
            expected_sdr = sdr_signal_to_nits(np.asarray(image.convert('RGB'))/255)
        sdr_measure = compare_appearance(expected_sdr, actual_sdr, reference_gamut='p3',
                                        actual_gamut='rec2020', fixture_class='gainmap-sdr')
        structure = (all(facts[layer]['sof'] == 0 and facts[layer]['depth'] == 8
            and [facts[layer]['width'], facts[layer]['height']] == [769, 1025] for layer in ('base', 'map'))
            and facts['frame_count'] == 1 and facts['opaque'] and facts['metadata'].get('IFD0:Orientation', 1) == 1
            and sdr_facts['gamut'] == 'p3' and all(metadata_agreement['checks'].values()))
        for case in cases:
            case.update({'facts': facts, 'native_metadata_probe': native_probe,
                'gain_map_metadata_agreement': metadata_agreement, 'sdr_decoder_evidence': sdr_facts,
                'artifacts': {'output': str(output), 'sha256': avif.digest(output)},
                'native_candidate': {**control_report['native_candidate'], 'output_sha256': avif.digest(output),
                                     'source_capacity_packing': encoded}})
            case['checks'].update({'native_encoder': True, 'source_capacity_preservation': all(preservation.values()),
                'structure': structure, 'privacy': not facts['private_tags'] and sdr_facts['privacy']})
            case['measurements']['authored_sdr_base'] = sdr_measure
            full._render(case, directory, source,
                control_directory/'converter-control/source-inspection/map.jpg', output, new_map,
                control_report['full_source_preparation']['native_intent'])
            case['blockers'] = [f'Failed {key} check at display boost {case["rendering_scope"]["display_boost"]}'
                                for key, passed in case['checks'].items() if not passed]
            if all(case['checks'].values()):
                case['status'] = 'qualified'
    except Exception as error:
        for case in cases:
            case['blockers'].append(str(error))
            case['status'] = 'tested and failed'
    report['commands'] = avif.COMMANDS[start:]
    report['gainmap_commands'] = list(control_report['gainmap_commands'])
    for path in sorted((directory/'output-input-inspection').glob('*.log')):
        if path.name == 'map-extraction.log':
            report['gainmap_commands'].append({'log': str(path), 'command': ['exiftool', '-b', '-MPImage2',
                str(control_directory/'output.jpg')], 'exit_code': 0, 'stderr': path.read_text(),
                'stdout_sha256': avif.digest(path.with_name('map.jpg'))})
        else:
            report['gainmap_commands'].append({'log': str(path), **json.loads(path.read_text())})
    report['source_hashes'] = {**control_report['source_hashes'], **{name: avif.digest(Path(__file__).with_name(name))
        for name in ('iso_source_capacity.py', 'native_gainmap_capacity.cpp', 'gainmap-capacity-build.sh')}}
    report['native_hashes'], report['native_source_hashes'] = control_report['native_hashes'], control_report['native_source_hashes']
    report['capacity_native_provenance'] = Path('/opt/proof/gainmap-capacity/provenance-sha256.txt').read_text()
    (directory/'results.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
