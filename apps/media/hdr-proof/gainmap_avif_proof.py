"""Explicit authored-SDR geometry proofs from a locked gain-map AVIF.

The unchanged gainmap-sdr profile is declared before this native experiment.
Its photographic authored-base rationale applies to the actual decoded AVIF
base. Source JPEG-to-AVIF differences are not part of the derivative error
budget: the reference uses the gain-map AVIF's independently decoded samples.
An authored SDR rendition retains its existing grade, so the synthetic HDR
ordinary-white tone-map oracle does not apply. HDR derivatives remain untested.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

import avif
import gainmap_avif
from appearance import compare_appearance, sdr_signal_to_nits
from gainmap import geometry, private_metadata_tags
from gainmap_sdr import _axis
from matrix import GAINMAP_GEOMETRIES


SELECTORS = {'format': 'avif', 'range': 'sdr', 'gamut': 'preserve', 'depth': 'preserve',
             'motion': 'preserve', 'transparency': 'preserve', 'w': 173, 'fit': 'contain'}
POLICY = {
    'declared_before_native_measurements': True,
    'profile': 'gainmap-sdr',
    'rationale': 'Existing photographic authored-SDR regional gates apply to the independently decoded actual AVIF base at 100 nit nominal white',
    'source_quantization': 'JPEG-to-AVIF import is separate; no source import error is added to the derivative budget',
    'reference_revision': 'gainmap-avif-authored-base-pillow-lanczos-v1',
    'geometry': 'Independent Pillow RGB8 Lanczos from actual dav1d base samples to 173x130',
    'hdr_scope': 'No HDR reconstruction or derivative qualification',
}
GEOMETRIES = ('contain', 'cover', 'fill', 'upscale')
GEOMETRY_POLICY = {**POLICY,
    'geometry': 'Independent Pillow RGB8 Lanczos: contain173x130, fractional centered cover173x173, fill173x211 and upscale769x576',
    'orientation_scope': 'Only the original identity-oriented locked source; transformed sources remain original-only'}


def validate_selectors(selectors, *, operation='contain'):
    if operation not in GEOMETRIES:
        raise ValueError('Unsupported authored-SDR geometry')
    expected = {key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')}
    expected.update(GAINMAP_GEOMETRIES[operation])
    if selectors != expected:
        label = 'containment' if operation == 'contain' else operation
        raise ValueError(f'Only the exact explicit SDR {label} selectors are admitted')


def _controls(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    original = directory/'original.avif'
    evidence = [{'id': 'gainmap-avif-original-exact-bytes', 'passed': gainmap_avif.copy_original(source, original)['exact_bytes'],
                 'source_sha256': avif.digest(source), 'output_sha256': avif.digest(original)}]
    data = source.read_bytes()
    before = b'nclx\x00\x01\x00\x0d\x00\x00\x80'
    for name, after in (('unknown-base-color', b'nclx\x00\x02\x00\x0d\x00\x00\x80'),
                        ('unknown-base-transfer', b'nclx\x00\x01\x00\x02\x00\x00\x80')):
        if data.count(before) != 1:
            raise ValueError('Native source control requires one unambiguous base color property')
        changed = directory/f'{name}.avif'
        changed.write_bytes(data.replace(before, after))
        observed = avif.inspect_avif(changed)
        decision = gainmap_avif.source_decision(changed, directory/name)
        copied = directory/f'{name}-original.avif'
        exact = gainmap_avif.copy_original(changed, copied)
        evidence.append({'id': f'gainmap-avif-{name}-original-only',
                         'passed': decision['action'] == 'original only' and exact['exact_bytes'],
                         'decision': decision, 'native_file_facts': observed, 'original': exact})
    for name, change in (('hdr', {'range': 'hdr'}), ('depth12', {'depth': '12'}),
                         ('other-geometry', {'w': 174}), ('other-gamut', {'gamut': 'p3'})):
        rejected = False
        try:
            validate_selectors({**SELECTORS, **change})
        except ValueError:
            rejected = True
        evidence.append({'id': f'gainmap-avif-unproved-{name}-withheld', 'passed': rejected})
    return [{**item, 'case_id': item['id'], 'status': 'passed' if item['passed'] else 'tested and failed'}
            for item in evidence]


def _case(source, facts, base_codes, root, operation):
    selectors = {key: value for key, value in SELECTORS.items() if key not in ('w', 'fit')}
    selectors.update(GAINMAP_GEOMETRIES[operation])
    validate_selectors(selectors, operation=operation)
    folder = root/operation
    folder.mkdir(exist_ok=True)
    case = {'case_id': f'{gainmap_avif.FIXTURE_ID}:sdr:avif:preserve:preserve:{operation}:authored-rgb8',
            'fixture_id': gainmap_avif.FIXTURE_ID, 'cell_id': 'avif-gainmap:sdr:avif',
            'selectors': selectors, 'geometry': operation, 'candidate': 'native-authored-base-avif',
            'source_facts': facts, 'source_sha256': avif.digest(source),
            'status': 'tested and failed', 'consumer_status': 'pending manual review',
            'checks': {key: False for key in ('native_encoder', 'independent_decoder', 'independent_source_decoder',
                                             'structure', 'appearance', 'privacy')},
            'blockers': [], 'measurements': {}, 'artifacts': {},
            'threshold_scope': {**(POLICY if operation == 'contain' else GEOMETRY_POLICY),
                                'thresholds_sha256': avif.digest(Path(__file__).with_name('thresholds.json'))}}
    try:
        reference = geometry(Image.fromarray(base_codes), operation)
        reference_path = folder/'reference-sdr.png'
        reference.save(reference_path)
        expected = np.asarray(reference).astype(float)/255
        case['reference_sdr'] = {'path': str(reference_path), 'sha256': avif.digest(reference_path),
                                 'gamut': 'srgb', 'transfer': 'srgb', 'revision': POLICY['reference_revision']}
        # A separate AOM decoder supplies native candidate pixels. The dav1d
        # arrays above are only reference and decoder-agreement evidence.
        base = folder/'base-aom.png'
        avif.native(['avifdec', '-j', '1', '-c', 'aom', '-d', '8', source, base])
        native_codes = np.rint(avif.read_png(base)[..., :3]*255).astype(np.uint8)
        agreement = bool(np.array_equal(native_codes, base_codes))
        if not agreement:
            raise ValueError('Native candidate decoder disagrees with actual authored source samples')
        case['checks']['independent_source_decoder'] = True
        horizontal, resized = folder/'horizontal.png', folder/'authored.png'
        source_width, source_height = facts['base']['dimensions']
        width = selectors['w']
        height = selectors.get('h', int(source_height * width / source_width + .5))
        if operation == 'cover':
            from native_zimg import cover
            raw = folder/'base-native.rgb'
            avif.native(['ffmpeg', '-v', 'error', '-y', '-i', base, '-frames:v', '1',
                         '-map_metadata', '-1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
            native_geometry = cover(raw, resized, source_width, source_height, size=width)
            filters = native_geometry['native_window_axes']
        else:
            first = _axis(['-i', base], horizontal, width, source_height)
            second = _axis(['-i', horizontal], resized, width, height)
            filters = [first, second]
        target = folder/'output.avif'
        avif.encode_avif([resized], target, 'srgb', 'srgb', 8)
        case['checks']['native_encoder'] = True
        output_facts = avif.inspect_avif(target)
        frames = avif.decode_avif(target, folder, 1)
        expected_rgba = np.concatenate((expected, np.ones((*expected.shape[:2], 1))), axis=-1)
        structure = avif.structure_checks(output_facts, frames, {}, [expected_rgba], 'srgb', 'srgb', 8, 1)
        structure['opaque_source_retained'] = bool(np.all(frames[0][..., 3] == 1) and output_facts['alpha'] == 'Absent')
        structure = {key: bool(value) for key, value in structure.items()}
        tags = json.loads(avif.native(['exiftool', '-j', '-n', '-G1', '-s', target]))[0]
        tags = {key: value for key, value in tags.items() if key != 'SourceFile' and not key.startswith('System:')}
        private = private_metadata_tags(tags)
        privacy = not private and 'XMP Metadata   : Absent' in output_facts['info'] and 'Exif Metadata  : Absent' in output_facts['info']
        measured = compare_appearance(sdr_signal_to_nits(expected), sdr_signal_to_nits(frames[0][..., :3]),
            reference_gamut='srgb', actual_gamut='srgb', fixture_class='gainmap-sdr')
        case['checks'].update({'independent_decoder': True, 'structure': all(structure.values()),
                               'appearance': measured['passed'], 'privacy': privacy})
        case.update({'facts': output_facts, 'structural_checks': structure,
                     'privacy_measurement': {'passed': privacy, 'private_tags': private, 'metadata': tags},
                     'native_candidate': {'source_decoder': 'AOM AV1 via libavif', 'source_samples_match_dav1d': agreement,
                                          'filters': filters, 'encoder': 'AOM lossless RGB8 AV1, sRGB transfer/primaries'},
                     'measurements': {'sdr': measured},
                     'artifacts': {'output': str(target), 'sha256': avif.digest(target),
                                   'source': str(source), 'source_sha256': avif.digest(source)}})
        case['blockers'] = [f'Failed {key} check' for key, passed in case['checks'].items() if not passed]
        if not case['blockers']:
            case['status'] = 'qualified'
    except Exception as error:
        case['blockers'].append(str(error))
    return case


def run(output_directory, *, source_lock=gainmap_avif.SOURCE_LOCK, geometries=('contain',)):
    geometries = tuple(geometries)
    if not geometries or len(set(geometries)) != len(geometries) or any(item not in GEOMETRIES for item in geometries):
        raise ValueError('Expected distinct contain, cover, fill or upscale geometries')
    root = Path(output_directory)
    root.mkdir(parents=True, exist_ok=True)
    start = len(avif.COMMANDS)
    source, fixture = gainmap_avif.generate_source(root/'source', source_lock=source_lock)
    facts, base_codes = gainmap_avif.inspect_source(source, root/'source-inspection')
    fixture.update({'facts': facts, 'source_valid': True, 'valid_scope': 'Established authored SDR base only; HDR reconstruction untested'})
    controls = _controls(source, root/'controls')
    evidence = [_case(source, facts, base_codes, root, operation) for operation in geometries]
    return {'evidence': evidence, 'fixtures': [], 'source_fixtures': [fixture], 'controls': controls,
            'commands': avif.COMMANDS[start:], 'scope': POLICY if geometries == ('contain',) else GEOMETRY_POLICY, 'hdr_status': 'untested',
            'hdr_blocker': 'Independent matched-source HDR reconstruction and gain-map geometry have not been established'}
