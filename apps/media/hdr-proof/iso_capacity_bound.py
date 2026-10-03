"""Forward capacity-family bounds with separately measured zero-weight models.

This diagnostic extends the continuous P3 bound's capacity case argument. It
does not widen the ICC-aware converter's admission or qualify a conversion.
Pinned libavif bypasses gain application at zero weight. Pinned UltraHDR's
gain equation retains unequal offsets at zero. Both branches are explicit.
"""
import json
from pathlib import Path
import re
import shutil

import numpy as np
from PIL import Image

import avif
import gainmap
import icc_gainmap
import iso_continuous_base_bound as continuous
import iso_map_code_bound as map_bound
from appearance import THRESHOLDS_SHA256
from gainmap_iso import iso_metadata, segments
from gainmap_metadata import check_metadata
from gainmap_xmp import SOURCE, SOURCE_SHA256
from gamma_icc import make_profile
from iso_global_offset_bound import component_bounds

LIBAVIF = '/opt/proof/libavif/rgbreader/avifgainmaputil'
PACKER = '/opt/proof/ultrahdr/both/hdr-proof-uhdr'
PRECISE = '/opt/proof/ultrahdr/precise/hdr-proof-uhdr'
XMP_ID = b'http://ns.adobe.com/xap/1.0/\0'
NATIVE_PATHS = (LIBAVIF, PACKER, PRECISE, icc_gainmap.TOOL,
               '/opt/proof/ultrahdr/both/libuhdr.so.2.0.2',
               '/opt/proof/ultrahdr/precise/libuhdr.so.2.0.2')
DEPENDENCIES = ('iso_capacity_bound.py', 'test_iso_capacity_bound.py', 'native_icc_gainmap.cpp',
                'native_gainmap.cpp', 'native-gainmap-build.sh', 'gainmap-build.sh',
                'libultrahdr-precise-transfer.patch', 'libultrahdr-rgb-jpeg.patch',
                'libavif-rgb-reader.patch', 'gainmap_metadata.py', 'gainmap_xmp.py')


def capacity_constraints(*, base_A_green_lower, black_green_upper, A_direction, B_direction, D_lower, D_upper):
    """Keep the zero-bypass premise separate from the offset-at-zero model."""
    values = [base_A_green_lower, black_green_upper, A_direction, B_direction, D_lower, D_upper]
    if not np.all(np.isfinite(values)) or min(base_A_green_lower, black_green_upper) < 0:
        raise ValueError('Expected finite capacity-bound premises and nonnegative base/reference bounds')
    zero_gap, shared_gap = base_A_green_lower-black_green_upper, D_lower-D_upper
    common = A_direction > 0 and B_direction > 0 and shared_gap > 0
    return {'base_A_green_lower_nits_at203': base_A_green_lower, 'A2_black_green_upper_nits': black_green_upper,
        'zero_weight_bypass_separation_nits': zero_gap, 'shared_offset_separation_nits': shared_gap,
        'A_increasing_direction_margin_nits': A_direction, 'B_decreasing_direction_margin_nits': B_direction,
        'D_lower_bound_nits': D_lower, 'D_upper_bound_nits': D_upper,
        'authored_base_bypass_model_excluded': bool(common and zero_gap > 0),
        'offset_at_zero_model_excluded': bool(common)}


def capacity_branch(a, b):
    """Finite endpoint controls illustrate the separately stated real-domain proof."""
    if not np.isfinite(a) or not np.isfinite(b) or not 0 <= a < b:
        raise ValueError('Expected finite log2 capacity endpoints0<=a<b')
    weights = np.clip((np.array([1., 4., 6.])-a)/(b-a), 0, 1)
    if weights[0] == 0:
        branch = 'zero_weight_authored_base'
    elif weights[1] == weights[2]:
        branch = 'equal_16_64'
    elif 0 < weights[0] < weights[1] < weights[2] <= 1:
        branch = 'positive_ordered'
    else:
        raise ValueError('Floating arithmetic did not establish one of the analytic branches')
    return {'a': a, 'b': b, 'weights': weights.tolist(), 'branch': branch}


def _recheck_files(value):
    if isinstance(value, dict):
        if 'path' in value and 'sha256' in value:
            map_bound._bind(value['path'], value['sha256'])
        for child in value.values():
            _recheck_files(child)
    elif isinstance(value, list):
        for child in value:
            _recheck_files(child)


def imported_metadata(text, minimum):
    """Check every exact fraction emitted by the pinned AVIF metadata reader."""
    expected = {'Base headroom': ('base_headroom', [minimum, 1]),
        'Alternate headroom': ('alternate_headroom', [3, 1]),
        'Gain Map Min': ('gain_map_min', [[0, 1]]*3),
        'Gain Map Max': ('gain_map_max', [[2, 1]]*3),
        'Base Offset': ('base_offset', [[1, 4]]*3),
        'Alternate Offset': ('alternate_offset', [[1, 8]]*3),
        'Gain Map Gamma': ('gamma', [[1, 1]]*3)}
    result = {}
    for line in text.splitlines():
        matched = re.fullmatch(r'\s*\* ([^:]+):\s*(.*?)\s*', line)
        if not matched:
            raise ValueError('Unexpected native imported metadata line')
        name, value = matched.groups()
        if name == 'Use Base Color Space':
            if value != 'True' or 'use_base_colour_space' in result:
                raise ValueError('Imported map requires the declared base color space')
            result['use_base_colour_space'] = True
            continue
        if name not in expected or expected[name][0] in result:
            raise ValueError('Unknown or duplicate imported metadata field')
        key, wanted = expected[name]
        number = r'(-?(?:\d+(?:\.\d*)?|\.\d+)) \(as fraction: (-?\d+)/(\d+)\)'
        pattern = number if name.endswith('headroom') else r'R '+number+r'\s+G '+number+r'\s+B '+number
        parsed = re.fullmatch(pattern, value)
        if parsed is None:
            raise ValueError('Malformed imported metadata fractions')
        values = parsed.groups()
        fractions = []
        for index in range(0, len(values), 3):
            decimal, numerator, denominator = values[index:index+3]
            fraction = [int(numerator), int(denominator)]
            if fraction[1] <= 0 or float(decimal) != fraction[0]/fraction[1]:
                raise ValueError('Conflicting imported metadata fractions')
            fractions.append(fraction)
        actual = fractions[0] if name.endswith('headroom') else fractions
        if actual != wanted:
            raise ValueError('Imported metadata changed the declared control')
        result[key] = actual
    if set(result) != {item[0] for item in expected.values()} | {'use_base_colour_space'}:
        raise ValueError('Missing imported metadata field')
    return result


def native_zero_weight_controls(directory):
    """Actual unequal-offset files distinguish two pinned decoder behaviors.

    At normalized white1, offsets1/4 and1/8 give1.125 if applied at weight0,
    versus1 for a base bypass. At full weight, code64/255 and log gain[0,2]
    give333.9697495181064nits. A declared0.5nit allowance covers12-bit PQ
    output quantization in these tiny scalar controls only. Photographic
    appearance gates and references are untouched.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    source = map_bound._bind(SOURCE, SOURCE_SHA256)
    start = len(avif.COMMANDS)
    native_paths = (*NATIVE_PATHS, shutil.which('avifdec'), shutil.which('exiftool'), '/usr/lib/liblcms2.so.2')
    if any(path is None for path in native_paths):
        raise ValueError('Required native control reader is unavailable')
    native_hashes = {path: avif.digest(path) for path in native_paths}
    gainmap.inspect(SOURCE, directory/'source-inspection')
    original = SOURCE.read_bytes()
    old = next(value for marker, value in segments((directory/'source-inspection/map.jpg').read_bytes())
               if marker == 0xe1 and value.startswith(XMP_ID))
    profile = make_profile(gamma=3.2, gamut='p3')
    base, gain = directory/'white-base.jpg', directory/'map.jpg'
    Image.new('RGB', (8, 8), 'white').save(base, quality=100, subsampling=0, keep_rgb=True, icc_profile=profile)
    Image.new('RGB', (8, 8), (64, 64, 64)).save(gain, quality=100, subsampling=0, keep_rgb=True)
    inputs = {'source': source, 'base': map_bound._bind(base, avif.digest(base)),
              'map': map_bound._bind(gain, avif.digest(gain))}
    rows = []
    for minimum in (0, 1):
        attrs = (f'hdrgm:GainMapMin="0" hdrgm:GainMapMax="2" hdrgm:Gamma="1" hdrgm:OffsetSDR="0.25" '
                 f'hdrgm:OffsetHDR="0.125" hdrgm:HDRCapacityMin="{minimum}" hdrgm:HDRCapacityMax="3"')
        packet = XMP_ID+('<x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            '<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0" '
            +attrs+'></rdf:Description></rdf:RDF></x:xmpmeta>').encode()
        if len(packet) > len(old) or original.count(old) != 1:
            raise ValueError('Unexpected locked XMP carrier extent')
        carrier = directory/f'carrier-min{minimum}.jpg'
        carrier.write_bytes(original.replace(old, packet+b' '*(len(old)-len(packet))))
        output = directory/f'control-min{minimum}.jpg'
        avif.native([PACKER, 'pack', carrier, base, gain, output])
        facts = gainmap.inspect(output, directory/f'inspection-min{minimum}')
        map_path = directory/f'inspection-min{minimum}/map.jpg'
        metadata = iso_metadata(map_path.read_bytes())
        native_facts = json.loads(avif.native([PRECISE, 'probe', output]))
        metadata_checks = check_metadata(facts, native_facts)['checks']
        if (metadata['base_headroom'] != minimum or metadata['alternate_headroom'] != 3
                or metadata['backward'] or not metadata['use_base_colour_space']
                or not all(channel == {'minimum': 0, 'maximum': 2, 'gamma': 1,
                    'base_offset': .25, 'alternate_offset': .125} for channel in metadata['channels'])
                or not all(value for name, value in metadata_checks.items() if name != 'forward_sdr_base')
                or metadata_checks['forward_sdr_base'] != (minimum == 0)
                or native_facts.get('use_base_cg') is not True
                or facts['android_xmp_properties'].get('XMP-hdrgm:BaseRenditionIsHDR') is not False
                or facts['android_xmp_properties'].get('XMP-hdrgm:Version') != 1.0
                or any((facts[layer]['sof'], facts[layer]['depth'], facts[layer]['components'],
                        facts[layer]['width'], facts[layer]['height']) != (0, 8, 3, 8, 8)
                       for layer in ('base', 'map'))):
            raise ValueError('Native control metadata or coded layer facts changed')
        with Image.open(output) as image:
            if image.info['icc_profile'] != profile or not np.all(np.asarray(image) == 255):
                raise ValueError('Native control lost the actual white base or ICC')
        with Image.open(map_path) as image:
            if not np.all(np.asarray(image) == 64):
                raise ValueError('Native control changed the constant gain samples')
        row = {'base_headroom_log2': minimum, 'metadata': metadata,
            'output': map_bound._bind(output, avif.digest(output)), 'carrier': map_bound._bind(carrier, avif.digest(carrier)),
            'extracted_map': map_bound._bind(map_path, avif.digest(map_path)),
            'base_coding': facts['base'], 'map_coding': facts['map'], 'native_probe': native_facts,
            'jpeg_metadata_checks': metadata_checks, 'renderings': []}
        bridge = directory/f'control-min{minimum}.avif'
        # White is identical under the declared control's gamma3.2 and sRGB
        # transfers. This native scalar control does not establish general
        # libavif ICC support; its --ignore-profile bridge is explicitly CICP.
        avif.native([LIBAVIF, 'convert', output, bridge, '--cicp', '12/13/0', '--ignore-profile',
            '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'])
        row['imported_avif'] = map_bound._bind(bridge, avif.digest(bridge))
        row['native_imported_metadata'] = avif.native([LIBAVIF, 'printmetadata', bridge]).decode()
        row['imported_metadata'] = imported_metadata(row['native_imported_metadata'], minimum)
        imported_base = directory/f'imported-base-min{minimum}.png'
        imported_map = directory/f'imported-map-min{minimum}.png'
        avif.native(['avifdec', '-j', '1', '-c', 'dav1d', '-d', '8', bridge, imported_base])
        avif.native([LIBAVIF, 'extractgainmap', bridge, imported_map])
        for path, code in ((imported_base, 255), (imported_map, 64)):
            with Image.open(path) as image:
                if image.size != (8, 8) or image.mode != 'RGB' or not np.all(np.asarray(image) == code):
                    raise ValueError('Imported AVIF changed the actual white base or gain samples')
        row['imported_samples'] = {'base_code': 255, 'map_code': 64,
            'base_png': map_bound._bind(imported_base, avif.digest(imported_base)),
            'map_png': map_bound._bind(imported_map, avif.digest(imported_map))}
        positive = directory/f'libavif-min{minimum}-positive.png'
        avif.native([LIBAVIF, 'tonemap', bridge, positive, '--headroom', '3', '--cicp-output', '9/16/0',
            '--ignore-profile', '-d', '12', '-y', '444'])
        pixels = avif.decode_transfer(avif.read_png(positive)[..., :3], 'pq', 'rec2020')
        expected = ((1+.25)*2**(2*64/255)-.125)*203
        if np.max(abs(pixels-expected)) >= .5:
            raise ValueError('Native positive-weight bridge did not apply the actual gain metadata')
        row['positive_weight_control'] = {'headroom_log2': 3, 'weight': 1, 'expected_nits': expected,
            'native_minimum_nits': float(pixels.min()), 'native_maximum_nits': float(pixels.max()),
            'maximum_quantization_error_nits': float(np.max(abs(pixels-expected))),
            'pq_png': map_bound._bind(positive, avif.digest(positive)),
            'purpose': 'Rules out a missing-map SDR fallback as the explanation for zero-weight white'}
        for boost in ((1,) if minimum == 0 else (1, 2)):
            native_output = directory/f'ultrahdr-min{minimum}-boost{boost}.gbrpf32'
            uhdr = json.loads(avif.native([PRECISE, 'decode-linear', output, native_output, str(boost)]))
            stock = np.fromfile(native_output, '<f4').reshape(3, 8, 8).transpose(1, 2, 0)*203
            if np.max(abs(stock-228.375)) >= 1e-5:
                raise ValueError('Pinned UltraHDR zero-weight equation changed')
            record = {'display_boost': boost, 'weight': 0, 'ultrahdr_precise': {'facts': uhdr,
                'minimum_nits': float(stock.min()), 'maximum_nits': float(stock.max()),
                'semantics': 'The precise RGB/transfer variant retains upstream offset application at zero weight',
                'samples': map_bound._bind(native_output, avif.digest(native_output))}}
            pq = directory/f'libavif-min{minimum}-boost{boost}.png'
            avif.native([LIBAVIF, 'tonemap', bridge, pq, '--headroom', str(np.log2(boost)),
                '--cicp-output', '9/16/0', '--ignore-profile', '-d', '12', '-y', '444'])
            pixels = avif.decode_transfer(avif.read_png(pq)[..., :3], 'pq', 'rec2020')
            if np.max(abs(pixels-203)) >= .5:
                raise ValueError('Pinned libavif authored-base bypass changed')
            record['libavif'] = {'minimum_nits': float(pixels.min()), 'maximum_nits': float(pixels.max()),
                'zero_weight_white_max_quantization_error_nits': float(np.max(abs(pixels-203))),
                'semantics': 'Authored-base bypass; unequal offsets are omitted at zero weight',
                'pq_png': map_bound._bind(pq, avif.digest(pq))}
            if minimum == 0:
                independent, _ = icc_gainmap.independent_decode(output, map_path, boost=boost)
                raw = directory/f'icc-min{minimum}-boost{boost}.rgbf32'
                native, native_facts = icc_gainmap.native_decode(output, raw, boost=boost)
                if np.max(abs(independent-203)) >= 1e-10 or np.max(abs(native-203)) >= 1e-4:
                    raise ValueError('ICC-aware authored-base bypass changed')
                record['icc_native_and_independent'] = {'native_minimum_nits': float(native.min()),
                    'native_maximum_nits': float(native.max()), 'independent_minimum_nits': float(independent.min()),
                    'independent_maximum_nits': float(independent.max()), 'native_facts': native_facts,
                    'samples': map_bound._bind(raw, avif.digest(raw)),
                    'semantics': 'Authored-base bypass; strict helper admits only base headroom0'}
            else:
                try:
                    icc_gainmap.native_decode(output, directory/'icc-min1-rejected.rgbf32', boost=boost)
                except RuntimeError as error:
                    if 'Only SDR base gain application' not in str(error):
                        raise
                    record['icc_native_rejection'] = str(error)
                else:
                    raise ValueError('Strict ICC helper unexpectedly accepted positive base capacity')
                try:
                    icc_gainmap.independent_decode(output, map_path, boost=boost)
                except ValueError as error:
                    if 'Only forward SDR-base ISO metadata' not in str(error):
                        raise
                    record['icc_independent_rejection'] = str(error)
                else:
                    raise ValueError('Strict ICC reader unexpectedly accepted positive base capacity')
            row['renderings'].append(record)
        rows.append(row)
    result = {'status': 'diagnostic_only', 'records': rows, 'inputs': inputs, 'commands': avif.COMMANDS[start:],
        'native_binary_sha256': native_hashes,
        'inspection_logs': [map_bound._bind(path, avif.digest(path)) for path in sorted(directory.glob('*inspection*/*.log'))],
        'control_precision': 'Declared0.5nit scalar12-bit PQ quantization check; no photographic metric allowance',
        'icc_scope': 'Current ICC-aware native and independent readers admit base log headroom0 only. '
            'Positive base capacity remains rejected; libavif/UHDR controls do not widen that admission.'}
    _recheck_files(result)
    for path, sha in native_hashes.items():
        map_bound._bind(path, sha)
    (directory/'native-controls.json').write_text(json.dumps(result, indent=2)+'\n')
    return result


def run(directory, map_code_report=None):
    """Recompute validated continuous bounds before the capacity case argument."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    own_hashes = {name: avif.digest(Path(__file__).with_name(name)) for name in DEPENDENCIES}
    start = len(avif.COMMANDS)
    prior = continuous.run(directory/'continuous-bound', map_code_report=map_code_report)
    limits = prior['analytic_bound']
    constraints = capacity_constraints(base_A_green_lower=2.03*prior['extrema']['sdr_A_min']['outer_green_nits'],
        black_green_upper=component_bounds(prior['inputs'][0]['hdr_reference_nits'][0])['rgb_nits_high'][1],
        A_direction=limits['A_positive_gain_direction_margin_nits'], B_direction=limits['B_negative_gain_direction_margin_nits'],
        D_lower=limits['D_lower_bound_nits'], D_upper=limits['D_upper_bound_nits'])
    controls = native_zero_weight_controls(directory/'native-controls')
    grid = [0, .25, .5, 1, np.nextafter(1., np.inf), 2, 3, 4, np.nextafter(4., np.inf), 5, 6, 8, 16, 128]
    samples = [capacity_branch(a, b) for a in grid for b in grid if a < b]
    counts = {name: sum(row['branch'] == name for row in samples)
              for name in ('zero_weight_authored_base', 'equal_16_64', 'positive_ordered')}
    prior_path = directory/'continuous-bound/results.json'
    result = {'schema_version': 1, 'status': 'diagnostic_only',
        'scope': 'Fixed serialized P3 SDR and nominal-P3 HDR models from the fresh continuous bound. '
            'All nonnegative continuous bases, global nonnegative offsets, arbitrary per-pixel gain. '
            'Mathematical forward-capacity extension; no converter admission or conversion qualification.',
        'thresholds_sha256': THRESHOLDS_SHA256, 'bindings': prior['bindings'],
        'continuous_bound': map_bound._bind(prior_path, avif.digest(prior_path)),
        'metric_matrices': prior['metric_matrices'], 'constraints': constraints,
        'analytic_capacity_domain': {'domain': 'Finite log2 endpoints0<=a<b; w(h)=clamp((h-a)/(b-a),0,1); h=1,4,6.',
            'fixed_requirements': 'One file, absolute display boosts2/16/64, same source/reference geometry, original SDR/HDR gates.',
            'authored_base_zero_semantics': [
                'w(1)=0 returns the authored base. Its SDR-admitted green lower at203nits exceeds the A2 black upper.',
                'With w(1)>0, equal w(4)=w(6) makes A16/A64 identical, contrary to their strictly separated green intervals.',
                'Otherwise affine clamping forces0<w(1)<w(4)<w(6)<=1. The shared-D contradiction is independent of those exact values.'],
            'offset_at_zero_semantics': [
                'Equal w(4)=w(6) contradicts the strict A16/A64 direction.',
                'Otherwise w(6)>w(4)>=w(1)>=0. A requires positive gain; B requires negative gain.',
                'A gives D<A64-B_A because w(6)>0. Positive B2 gives B2<=B_B+D even at w(1)=0, '
                    'where equality holds before clipping. The same disjoint D bounds exclude this branch.'],
            'gain_equation': 'F(w)=max((B+203*Os)*2**(L*w)-203*Oh,0); B>=0,Os>=0,Oh>=0; D=203*(Os-Oh).',
            'arithmetic_scope': 'Real-domain capacity case argument using guarded float64 appearance enclosures. '
                'No directed-rounding or native floating-point theorem.'},
        'native_controls': controls,
        'numeric_capacity_controls': {'role': 'Finite-grid implementation checks only; not complete-domain proof',
                                      'counts': counts, 'records': samples},
        'primary_sources': {'libavif_weight_and_bypass': 'https://raw.githubusercontent.com/AOMediaCodec/libavif/v1.4.1/src/gainmap.c',
            'ultrahdr_weight': 'https://raw.githubusercontent.com/google/libultrahdr/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/jpegr.cpp',
            'ultrahdr_gain_equation': 'https://raw.githubusercontent.com/google/libultrahdr/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/gainmapmath.cpp',
            'ultrahdr_valid_forward_metadata': 'https://raw.githubusercontent.com/google/libultrahdr/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/ultrahdr_api.cpp'},
        'source_hashes': {**prior['source_hashes'], **own_hashes},
        'native_binary_sha256': {**prior['native_binary_sha256'], **controls['native_binary_sha256']},
        'commands': avif.COMMANDS[start:],
        'exclusions': ['Other primary/color-management models', 'Negative offsets or other gain equations',
            'Reverse HDR-base representations', 'Reference/geometry/gate changes', 'Native admission of every theoretical capacity',
            'Formal native rounding proof', 'Physical consumers', 'Any conversion qualification'],
        'validation_checks': {key: True for key in ('fresh_continuous_bound', 'separate_analytic_zero_models',
            'native_unequal_offset_zero_controls', 'native_positive_weight_bridge_control', 'strict_icc_admission_preserved')}}
    _recheck_files(result)
    for name, sha in result['source_hashes'].items():
        map_bound._bind(Path(__file__).with_name(name), sha)
    for path, sha in result['native_binary_sha256'].items():
        map_bound._bind(path, sha)
    result['validation_checks']['bound_inputs_sources_and_native_controls_unchanged_at_completion'] = True
    (directory/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
