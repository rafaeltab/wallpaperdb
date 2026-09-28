"""Independent test-time appearance measurements, never an image converter.

Inputs are independently decoded, straight RGB arrays at matched geometry.
HDR values are display-referred cd/m2. HLG callers must declare a display peak
and apply the OOTF, rather than treating scene light as display luminance.
SDR uses the fixture's declared 100 cd/m2 nominal display and sRGB transfer.
The BT.2124 metric cannot certify a browser or physical display.
"""

import hashlib
import json
from pathlib import Path

import numpy as np


THRESHOLDS_PATH = Path(__file__).with_name("thresholds.json")
_THRESHOLD_BYTES = THRESHOLDS_PATH.read_bytes()
THRESHOLDS = json.loads(_THRESHOLD_BYTES)
THRESHOLDS_SHA256 = hashlib.sha256(_THRESHOLD_BYTES).hexdigest()

# D65 RGB -> XYZ, derived from the named colourspaces' chromaticities.
# BT.2124 Annex 2 gives the inverse Rec.2020 matrix. Other D65 matrices use
# the W3C CSS Color 4 sample conversion matrices, with no white adaptation.
# https://www.w3.org/TR/css-color-4/#color-conversion-code
RGB_TO_XYZ = {
    "rec2020": np.array([
        [0.6369580483012914, 0.1446169035862083, 0.1688809751641721],
        [0.2627002120112671, 0.6779980715188708, 0.0593017164698620],
        [0.0, 0.0280726930490874, 1.0609850577107910],
    ]),
    "p3": np.array([
        [0.4865709486482162, 0.2656676931690931, 0.1982172852343625],
        [0.2289745640697488, 0.6917385218365064, 0.0792869140937450],
        [0.0, 0.0451133818589026, 1.0439443689009760],
    ]),
    "srgb": np.array([
        [0.4123907992659595, 0.3575843393838780, 0.1804807884018343],
        [0.2126390058715104, 0.7151686787677560, 0.0721923153607337],
        [0.0193308187155918, 0.1191947797946260, 0.9505321522496607],
    ]),
}

_ALIASES = {
    "bt2020": "rec2020", "rec.2020": "rec2020", "rec2020": "rec2020",
    "display-p3": "p3", "p3-d65": "p3", "p3": "p3",
    "bt709": "srgb", "rec709": "srgb", "srgb": "srgb",
}
_RGB_TO_LMS = np.array([[1688, 2146, 262], [683, 2951, 462],
                       [99, 309, 3688]], dtype=float) / 4096
_LMS_P_TO_ITP = np.array([[2048, 2048, 0], [3305, -6806.5, 3501.5],
                         [17933, -17390, -543]], dtype=float) / 4096


def _gamut(gamut):
    try:
        return _ALIASES[gamut.lower()]
    except (KeyError, AttributeError) as error:
        raise ValueError(f"Unknown gamut: {gamut}") from error


def _rgb(values):
    values = np.asarray(values, dtype=np.float64)
    if values.ndim < 1 or values.shape[-1] != 3 or values.size == 0:
        raise ValueError("Expected nonempty RGB arrays with last dimension 3")
    if not np.all(np.isfinite(values)):
        raise ValueError("RGB values must be finite")
    if np.any(values < -1e-8):
        raise ValueError("RGB in the declared input gamut must be nonnegative")
    return values


def _pair(reference, actual):
    reference, actual = _rgb(reference), _rgb(actual)
    if reference.shape != actual.shape:
        raise ValueError("Reference and decoded output must have matched geometry")
    return reference, actual


def _visibility(shape, alpha, opaque_only=False):
    if alpha is None:
        return np.ones(shape, dtype=bool)
    alpha = np.asarray(alpha, dtype=float)
    if alpha.shape != shape or not np.all(np.isfinite(alpha)):
        raise ValueError("Alpha must be finite and match RGB geometry")
    if np.any((alpha < 0) | (alpha > 1)):
        raise ValueError("Alpha must be within [0, 1]")
    visible = alpha >= 0.99 if opaque_only else alpha > 0
    if not np.any(visible):
        raise ValueError("The comparison has no visible pixels")
    return visible


def sdr_signal_to_nits(signal, nominal_white_nits=100):
    """Decode normalized sRGB. This is a measurement conversion, not tonemapping."""
    signal = np.asarray(signal, dtype=np.float64)
    if not np.all(np.isfinite(signal)) or np.any((signal < 0) | (signal > 1)):
        raise ValueError("sRGB signal must be finite and within [0, 1]")
    return nominal_white_nits * np.where(
        signal <= 0.04045, signal / 12.92,
        ((signal + 0.055) / 1.055) ** 2.4,
    )


def linear_rgb_to_itp(rgb_nits, gamut="rec2020"):
    """BT.2124 Annex 1, with T = Ct/2 and absolute ST 2084 normalization."""
    rgb_nits = _rgb(rgb_nits)
    gamut = _gamut(gamut)
    if gamut != "rec2020":
        xyz = rgb_nits @ RGB_TO_XYZ[gamut].T
        rgb_nits = xyz @ np.linalg.inv(RGB_TO_XYZ["rec2020"]).T
    lms = rgb_nits @ _RGB_TO_LMS.T
    if np.min(lms) < -1e-7:
        raise ValueError("Metric input exceeds the nonnegative LMS fixture domain")
    y = np.maximum(lms, 0) / 10000
    y_m1 = y ** (2610 / 16384)
    lms_p = ((3424 / 4096 + (2413 / 128) * y_m1) /
             (1 + (2392 / 128) * y_m1)) ** (2523 / 32)
    return lms_p @ _LMS_P_TO_ITP.T


def delta_e_itp(reference_rgb_nits, actual_rgb_nits,
                reference_gamut="rec2020", actual_gamut="rec2020"):
    reference, actual = _pair(reference_rgb_nits, actual_rgb_nits)
    difference = (linear_rgb_to_itp(reference, reference_gamut) -
                  linear_rgb_to_itp(actual, actual_gamut))
    return 720 * np.linalg.norm(difference, axis=-1)


def _summary(values):
    return {
        "mean": float(np.mean(values)),
        "p95": float(np.percentile(values, 95)),
        "maximum": float(np.max(values)),
    }


def compare_appearance(reference_rgb_nits, actual_rgb_nits, *, reference_gamut,
                       actual_gamut, fixture_class, alpha=None, region_reference_luminance_nits=None):
    """Measure every present luminance region against its fixed fixture gate.

    Alpha only selects visible straight-RGB samples. Callers must independently
    check actual alpha values and composition; this function does not certify
    alpha or encoded facts. It never resizes, rotates, clips, or aligns images.
    Optional region luminance groups SDR errors by the corresponding HDR source
    regions. Color and luminance differences still use the mapped SDR reference.
    """
    reference, actual = _pair(reference_rgb_nits, actual_rgb_nits)
    reference_gamut, actual_gamut = _gamut(reference_gamut), _gamut(actual_gamut)
    if fixture_class not in THRESHOLDS["profiles"]:
        raise ValueError(f"No predeclared threshold profile: {fixture_class}")
    limits = THRESHOLDS["profiles"][fixture_class]
    visible = _visibility(reference.shape[:-1], alpha)
    reference_y = reference @ RGB_TO_XYZ[reference_gamut][1]
    actual_y = actual @ RGB_TO_XYZ[actual_gamut][1]
    region_y = reference_y
    if region_reference_luminance_nits is not None:
        region_y = np.asarray(region_reference_luminance_nits, dtype=np.float64)
        if (region_y.shape != reference_y.shape or not np.all(np.isfinite(region_y))
                or np.any(region_y < 0)):
            raise ValueError('Explicit region luminance must have matched geometry and finite nonnegative values')
    differences = delta_e_itp(reference, actual, reference_gamut, actual_gamut)
    absolute_y_error = np.abs(actual_y - reference_y)
    floor = limits["luminance_absolute_floor_nits"]
    relative_y_error = np.maximum(absolute_y_error - floor, 0) / np.maximum(reference_y, floor)
    regions, failures = {}, []
    masks = {
        "shadow": region_y <= 10,
        "midtone": (region_y > 10) & (region_y <= 203.000001),
        "highlight": region_y > 203.000001,
    }
    for name, mask in masks.items():
        mask = mask & visible
        count = int(np.count_nonzero(mask))
        if count == 0:
            regions[name] = {"samples": 0, "status": "not_present_in_reference"}
            continue
        delta, absolute, relative = (_summary(values[mask]) for values in
                                     (differences, absolute_y_error, relative_y_error))
        regions[name] = {
            "samples": count,
            "delta_e_itp": delta,
            "luminance_absolute_error_nits": absolute,
            "luminance_relative_error_above_absolute_floor": relative,
            "reference_mean_nits": float(np.mean(reference_y[mask])),
            "actual_mean_nits": float(np.mean(actual_y[mask])),
        }
        checks = {
            "delta_e_mean": delta["mean"] <= limits["delta_e_mean_max"],
            "delta_e_p95": delta["p95"] <= limits["delta_e_p95_max"],
            "delta_e_max": delta["maximum"] <= limits["delta_e_max"],
            "luminance_relative_p95": relative["p95"] <= limits["luminance_relative_p95_max"],
        }
        failures.extend(f"{name}.{name_of_check}" for name_of_check, passed in checks.items()
                        if not passed)
    return {
        "passed": not failures,
        "metric": "BT.2124 Delta E ITP",
        "fixture_class": fixture_class,
        "thresholds_sha256": THRESHOLDS_SHA256,
        "region_basis": "explicit_source_luminance_nits" if region_reference_luminance_nits is not None else "appearance_reference_luminance_nits",
        "regions": regions,
        "failures": failures,
        "alpha_scope": "Visible straight RGB only; alpha and composition need separate checks",
    }


def evaluate_sdr_tone_map(source_rgb_nits, output_srgb, *, source_gamut,
                          probe_masks=None, reference_srgb=None, alpha=None):
    """Check the synthetic chart's explicit SDR policy, including gamut evidence.

    `reference_srgb`, when supplied, must come from a predeclared independent
    tone/gamut reference, never from the candidate being measured. An absent
    reference remains a visible qualification blocker. Authored SDR bases do
    not use this tone-map oracle; compare them with `compare_appearance`.
    """
    source, output = _pair(source_rgb_nits, output_srgb)
    if np.any(output > 1):
        raise ValueError("Decoded sRGB signal must be within [0, 1]")
    source_gamut = _gamut(source_gamut)
    limits = THRESHOLDS["tone_map"]
    visible = _visibility(source.shape[:-1], alpha, opaque_only=True)
    source_y = source @ RGB_TO_XYZ[source_gamut][1]
    output_nits = sdr_signal_to_nits(output)
    output_y = output_nits @ RGB_TO_XYZ["srgb"][1]
    mean_source = np.mean(source, axis=-1)
    neutral = np.ptp(source, axis=-1) <= np.maximum(0.01, mean_source * 0.005)
    masks = probe_masks or {}

    def mask(name, default):
        selected = np.asarray(masks.get(name, default), dtype=bool)
        if selected.shape != source_y.shape:
            raise ValueError(f"Probe {name} must match the source geometry")
        return selected & visible

    white = mask("ordinary_white", neutral & (np.abs(source_y - 203) <=
                                             limits["ordinary_white_probe_tolerance_nits"]))
    shadow = mask("shadow", neutral & (source_y > 0) & (source_y <= 10))
    midtone = mask("midtone", neutral & (source_y > 10) & (source_y <= 100))
    ramp = mask("neutral_ramp", neutral)
    failures, measurements = [], {}
    white_signal_median = limits["ordinary_white_signal"]
    if not np.any(white):
        failures.append("ordinary_white_probe_missing")
    else:
        white_signal = np.mean(output[white], axis=-1)
        white_signal_median = float(np.median(white_signal))
        measurements["ordinary_white_signal"] = _summary(white_signal)
        if np.max(np.abs(white_signal - limits["ordinary_white_signal"])) > limits["ordinary_white_signal_tolerance"]:
            failures.append("ordinary_white_signal")
        if np.max(np.ptp(output[white], axis=-1)) > 2 / 255:
            failures.append("ordinary_white_chromatic_cast")

    exposure = float(sdr_signal_to_nits(limits["ordinary_white_signal"])) / 203
    for name, selected in (("shadow", shadow), ("midtone", midtone)):
        if not np.any(selected):
            failures.append(f"{name}_probe_missing")
            continue
        expected_y = source_y[selected] * exposure
        relative = np.abs(output_y[selected] - expected_y) / np.maximum(
            expected_y, limits["relative_luminance_floor_nits"])
        measurements[f"{name}_relative_luminance_error"] = _summary(relative)
        if np.percentile(relative, 95) > limits[f"{name}_relative_p95_max"]:
            failures.append(f"{name}_retention")

    # Repeated neutral patches/rows must not weight an otherwise sparse ramp.
    levels, inverse = np.unique(np.round(source_y[ramp], 6), return_inverse=True)
    neutral_signal = np.mean(output[ramp], axis=-1)
    signals = np.array([np.median(neutral_signal[inverse == index])
                        for index in range(len(levels))])
    measurements["neutral_levels"] = int(len(levels))
    if len(levels) < limits["minimum_neutral_levels"]:
        failures.append("neutral_ramp_insufficient")
    if len(signals) > 1:
        measurements["minimum_neutral_signal_step"] = float(np.min(np.diff(signals)))
        if np.min(np.diff(signals)) < -limits["highlight_monotonic_tolerance"]:
            failures.append("neutral_ramp_reversal")
    highlights = signals[levels > 205]
    if len(highlights) < 4:
        failures.append("highlight_probe_missing")
    else:
        headroom = float(highlights[-1] - white_signal_median)
        measurements["highlight_headroom"] = headroom
        measurements["maximum_highlight_signal_step"] = float(np.max(np.diff(highlights)))
        if headroom < limits["highlight_headroom_min"]:
            failures.append("highlight_headroom")
        if np.max(np.diff(highlights)) > limits["highlight_signal_step_max"]:
            failures.append("highlight_discontinuity")
        if np.any(highlights[:-1] >= limits["early_clip_signal"]):
            failures.append("highlight_clipping")
        # A flat plateau below encoded white also destroys highlight detail.
        if np.count_nonzero(np.diff(highlights) > 0.25 / 255) < 0.5 * (len(highlights) - 1):
            failures.append("highlight_flattening")

    tone_curve_passed = not failures
    if reference_srgb is None:
        failures.append("gamut_mapping_reference_missing")
    else:
        reference_srgb, output = _pair(reference_srgb, output)
        chromatic = mask("wide_gamut", ~neutral)
        if not np.any(chromatic):
            failures.append("gamut_mapping_probe_missing")
        else:
            errors = delta_e_itp(sdr_signal_to_nits(reference_srgb[chromatic]),
                                  output_nits[chromatic], "srgb", "srgb")
            measurements["gamut_reference_delta_e_itp"] = _summary(errors)
            if (np.percentile(errors, 95) > limits["gamut_delta_e_p95_max"] or
                    np.max(errors) > limits["gamut_delta_e_max"]):
                failures.append("gamut_mapping_appearance")
    return {
        "passed": not failures,
        "tone_curve_passed": tone_curve_passed,
        "thresholds_sha256": THRESHOLDS_SHA256,
        "measurements": measurements,
        "failures": failures,
        "reference_display": {"sdr_nominal_white_nits": 100, "source_ordinary_white_nits": 203},
    }
