"""Independent reference for the explicit proof-only SDR colorimetric candidate.

The candidate is FFmpeg's native CPU Mobius filter plus zimg color conversion.
This oracle derives the rational shoulder from its boundary constraints rather
than using the candidate, its LUT, or FFmpeg's implementation coefficients:
F(knee)=knee, F'(knee)=1, F(peak)=1. It converts primaries through D65 XYZ.

Gamut policy for this candidate is relative colorimetric: preserve in-gamut
linear colors and clip out-of-gamut sRGB channels after the primary conversion.
This intentionally trades saturated out-of-gamut detail for exact in-gamut
colors; it is not perceptual gamut compression. Physical review must assess
that tradeoff. The existing independent color/luminance thresholds still apply.
The reference covers nonnegative display light through 10000 nits. The declared
peak is a curve anchor, not a source admission limit: valid 8-bit PQ rounding
can put samples slightly above a nominal 1000-nit fixture peak.
"""
import numpy as np
from appearance import RGB_TO_XYZ


def reference_srgb(rgb_nits, gamut, *, peak_nits):
    rgb = np.asarray(rgb_nits, dtype=np.float64)
    if rgb.shape[-1] != 3 or not np.all(np.isfinite(rgb)) or np.any(rgb < 0):
        raise ValueError('Expected finite nonnegative RGB luminance')
    if not np.isfinite(peak_nits) or peak_nits < 203 or np.max(rgb) > 10000:
        raise ValueError('Expected a finite HDR peak anchor and samples in the PQ display domain')
    # Fixed candidate recipe. These are not appearance acceptance thresholds.
    exposure = 1.1 * ((0.90 + 0.055) / 1.055) ** 2.4 / 203
    knee = 0.6
    rgb = rgb * exposure
    peak = peak_nits * exposure
    maximum = np.max(rgb, axis=-1, keepdims=True)
    distance = np.maximum(maximum - knee, 0)
    shoulder = knee + distance / (1 + distance * (peak - 1) / ((1 - knee) * (peak - knee)))
    mapped = np.where(maximum <= knee, maximum, shoulder)
    scale = np.divide(mapped, maximum, out=np.ones_like(mapped), where=maximum > 0)
    xyz = (rgb * scale * 0.99) @ RGB_TO_XYZ[gamut].T
    srgb_linear = np.clip(xyz @ np.linalg.inv(RGB_TO_XYZ['srgb']).T, 0, 1)
    return np.where(srgb_linear <= 0.0031308, 12.92 * srgb_linear,
                    1.055 * srgb_linear ** (1 / 2.4) - 0.055)
