"""Diagnostic bounds for one SDR representation, never conversion qualification.

The exhaustive search covers full-range sRGB RGB8 values at a nominal 100-nit
display. It makes no claim about other transfer functions, YUV matrices, spatial
viewing models, or the acceptable appearance of a different tone-map reference.
"""
import hashlib
import json
from pathlib import Path

import numpy as np

from appearance import (RGB_TO_XYZ, THRESHOLDS, THRESHOLDS_SHA256,
                        compare_appearance, delta_e_itp, linear_rgb_to_itp,
                        sdr_signal_to_nits)


def minimum_rgb8_error(reference_srgb):
    """Enumerate every RGB8 triple; component rounding is not a metric bound."""
    reference = np.asarray(reference_srgb, dtype=np.float64)
    if reference.ndim != 2 or reference.shape[1:] != (3,) or not len(reference):
        raise ValueError('Expected a nonempty list of normalized sRGB triples')
    target = linear_rgb_to_itp(sdr_signal_to_nits(reference), 'srgb')
    linear_codes = sdr_signal_to_nits(np.arange(256) / 255)
    green, blue = np.meshgrid(np.arange(256), np.arange(256), indexing='ij')
    green, blue = green.ravel(), blue.ravel()
    minimum = np.full(len(reference), np.inf)
    best = np.zeros((len(reference), 3), dtype=int)
    rgb = np.empty((65536, 3))
    rgb[:, 1], rgb[:, 2] = linear_codes[green], linear_codes[blue]
    for red in range(256):
        rgb[:, 0] = linear_codes[red]
        candidates = linear_rgb_to_itp(rgb, 'srgb')
        for index, sample in enumerate(target):
            errors = 720 * np.linalg.norm(candidates - sample, axis=-1)
            nearest = np.argmin(errors)
            if errors[nearest] < minimum[index]:
                minimum[index] = errors[nearest]
                best[index] = [red, green[nearest], blue[nearest]]
    return {'enumerated_codes': 256 ** 3,
            'best_rgb8_codes': best.tolist(),
            'minimum_delta_e_itp': minimum.tolist()}


def analyze(reference_srgb, source_luminance_nits, alpha, *, sample_limit=2):
    """Prove local counterexamples selected from visible HDR shadow samples.

    Selection uses the error of nearest signal rounding, then the exhaustive
    search supplies a global minimum. The selected-pixel count is a lower bound
    on impossible pixels, not a count over every distinct reference color.
    """
    reference = np.asarray(reference_srgb, dtype=np.float64)
    luminance, alpha = np.asarray(source_luminance_nits), np.asarray(alpha)
    if (reference.ndim != 3 or reference.shape[-1] != 3
            or luminance.shape != reference.shape[:2] or alpha.shape != luminance.shape
            or not np.all(np.isfinite(luminance)) or np.any(luminance < 0)
            or not np.all(np.isfinite(alpha)) or np.any((alpha < 0) | (alpha > 1))
            or not isinstance(sample_limit, int) or sample_limit < 1):
        raise ValueError('Expected matched RGB, luminance and alpha images and a positive sample limit')
    # Validate the whole signal, including hidden pixels, before selecting samples.
    sdr_signal_to_nits(reference)
    shadow = (luminance <= 10) & (alpha > 0)
    if not np.any(shadow):
        raise ValueError('The reference has no visible shadow samples')
    colors, counts = np.unique(reference[shadow], axis=0, return_counts=True)
    nearest = np.rint(colors * 255) / 255
    rounding_error = delta_e_itp(sdr_signal_to_nits(colors),
                                sdr_signal_to_nits(nearest), 'srgb', 'srgb')
    indices = np.argsort(-rounding_error, kind='stable')[:sample_limit]
    search = minimum_rgb8_error(colors[indices])
    maximum = THRESHOLDS['profiles']['sdr-8']['delta_e_max']
    records = []
    for number, index in enumerate(indices):
        bound = search['minimum_delta_e_itp'][number]
        records.append({
            'reference_srgb': colors[index].tolist(),
            'reference_rgb8_code_units': (colors[index] * 255).tolist(),
            'visible_matching_samples': int(counts[index]),
            'best_rgb8_code': search['best_rgb8_codes'][number],
            'minimum_delta_e_itp': bound,
            'exceeds_fixed_maximum_gate': bool(bound > maximum),
        })
    return {
        'schema_version': 1,
        'status': 'diagnostic_only',
        'representation': 'Full-range identity-matrix sRGB RGB8 at a nominal 100-nit display',
        'scope': 'A bound for the current reference and per-pixel metric; not a format-wide impossibility or support claim',
        'exclusions': ['Other transfer functions or YUV matrices',
                       'Higher coded precision', 'A different independently justified tone reference',
                       'Spatially integrated or physical-display appearance'],
        'arithmetic': 'IEEE 754 float64; no formal interval-arithmetic certificate',
        'reference_sha256': hashlib.sha256(np.ascontiguousarray(reference, dtype='<f8').tobytes()).hexdigest(),
        'reference_hash_encoding': 'Row-major little-endian float64 normalized sRGB, RGB channels only',
        'reference_shape': list(reference.shape),
        'thresholds_sha256': THRESHOLDS_SHA256,
        'fixed_maximum_delta_e_itp': maximum,
        'enumerated_codes_per_reference': search['enumerated_codes'],
        'shadow_samples': int(np.count_nonzero(shadow)),
        'unique_shadow_colors': len(colors),
        'selection': 'Largest nearest-signal-rounding error among unique visible HDR shadow references',
        'selected_samples_with_impossible_maximum_gate': sum(
            row['visible_matching_samples'] for row in records if row['exceeds_fixed_maximum_gate']),
        'references': records,
    }


def native_counterexample(reference_srgb, output_directory):
    """Encode supplied RGB8 codes using AOM and independently decode with dav1d."""
    from avif import (COMMANDS, decode_avif, digest, encode_avif, inspect_avif,
                      native)
    reference = np.asarray(reference_srgb, dtype=np.float64)
    if reference.ndim != 3 or reference.shape[-1] != 3:
        raise ValueError('Expected a normalized sRGB image')
    sdr_signal_to_nits(reference)
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    png, encoded = output_directory/'nearest-code.png', output_directory/'nearest-code.avif'
    codes = np.rint(reference * 255).astype(np.uint8)
    rgba = np.concatenate((codes, np.full(reference.shape[:2] + (1,), 255, dtype=np.uint8)), axis=-1)
    height, width = reference.shape[:2]
    command_start = len(COMMANDS)
    native(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s', f'{width}x{height}', '-i', 'pipe:0', '-frames:v', '1', '-threads', '1', png],
           data=rgba.tobytes())
    encode_avif([png], encoded, 'srgb', 'srgb', 8)
    decoded = decode_avif(encoded, output_directory, 1)[0]
    return {
        'status': 'diagnostic_only',
        'decoded_exactly_matches_supplied_rgb8': bool(np.array_equal(decoded[..., :3], codes / 255)),
        'facts': inspect_avif(encoded),
        'supplied_png_sha256': digest(png),
        'output_avif_sha256': digest(encoded),
        'appearance': compare_appearance(sdr_signal_to_nits(reference),
            sdr_signal_to_nits(decoded[..., :3]), reference_gamut='srgb',
            actual_gamut='srgb', fixture_class='sdr-8'),
        'commands': COMMANDS[command_start:],
    }


def native_yuv_candidates(input_png, reference_srgb, output_directory):
    """Record six native YUV encodes, without generalizing to every YUV code."""
    from avif import COMMANDS, decode_avif, digest, inspect_avif, native
    output_directory = Path(output_directory)
    records = []
    for matrix in (1, 6, 9):
        for value_range in ('full', 'limited'):
            folder = output_directory/f'matrix-{matrix}-{value_range}'
            folder.mkdir(parents=True, exist_ok=True)
            output = folder/'output.avif'
            command_start = len(COMMANDS)
            native(['avifenc', '-c', 'aom', '-j', '1', '-s', '8', '-q', '100',
                    '--qalpha', '100', '-y', '444', '-d', '8', '--cicp', f'1/13/{matrix}',
                    '-r', value_range, '--ignore-exif', '--ignore-xmp', '--ignore-profile',
                    input_png, output])
            actual = decode_avif(output, folder, 1)[0]
            measurement = compare_appearance(sdr_signal_to_nits(reference_srgb),
                sdr_signal_to_nits(actual[..., :3]), reference_gamut='srgb',
                actual_gamut='srgb', fixture_class='sdr-8')
            records.append({
                'status': 'tested and failed' if not measurement['passed'] else 'untested',
                'scope': 'Appearance diagnostic only; no complete conversion qualification',
                'exhaustive_representation_bound': False,
                'requested_matrix': matrix, 'requested_range': value_range,
                'input_png_sha256': digest(input_png),
                'appearance': measurement, 'facts': inspect_avif(output),
                'commands': COMMANDS[command_start:],
            })
    return records


def run(work_directory, output_directory):
    """Reproduce the fixture-specific precision diagnostic after AVIF probes."""
    from avif import decode_transfer, digest, geometry_reference, read_png
    from sdr_reference import reference_srgb
    folder = Path(work_directory)/'avif'/'avif-pq-rec2020-10-opaque'
    source_path = folder/'decoded-0.png'
    source = read_png(source_path)
    source[..., :3] = decode_transfer(source[..., :3], 'pq', 'rec2020')
    matched = geometry_reference(source, 'contain')
    reference = reference_srgb(matched[..., :3], 'rec2020', peak_nits=1000)
    result = analyze(reference, matched[..., :3] @ RGB_TO_XYZ['rec2020'][1], matched[..., 3])
    result['fixture_id'] = 'avif-pq-rec2020-10-opaque'
    result['geometry'] = 'contain'
    result['source_avif_sha256'] = digest(folder/'avif-pq-rec2020-10-opaque.avif')
    result['source_decoded_png_sha256'] = digest(source_path)
    result['reference_recipe_sha256'] = digest(Path(__file__).with_name('sdr_reference.py'))
    result['geometry_and_transfer_reference_sha256'] = digest(Path(__file__).with_name('avif.py'))
    result['metric_source_sha256'] = digest(Path(__file__).with_name('appearance.py'))
    result['native_counterexample'] = native_counterexample(reference, output_directory)
    result['native_yuv_candidates'] = native_yuv_candidates(
        folder/'sdr-avif-preserve-contain'/'converted-0.png', reference,
        Path(output_directory)/'yuv')
    output = Path(output_directory)/'precision.json'
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-directory', type=Path, default=Path(__file__).with_name('work'))
    parser.add_argument('--output-directory', type=Path, required=True)
    options = parser.parse_args()
    run(options.work_directory, options.output_directory)
