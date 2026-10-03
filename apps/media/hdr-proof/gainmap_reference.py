"""Versioned independent HDR geometry reference in the requested primaries.

Linear primary conversion and filtering commute before clipping. Clipping is
nonlinear: clipping a negative Lanczos excursion in another RGB basis can leave
negative components in the requested output gamut. This revision filters and
clips in that requested gamut, then permits separate metric-space conversion.
The legacy reference and its measured failures remain unchanged in gainmap.py.
"""
import hashlib
from pathlib import Path

import numpy as np

from appearance import RGB_TO_XYZ
from gainmap import array_geometry


REVISION = 'gainmap-hdr-target-gamut-v1'


def reference(rgb_nits, source_gamut, target_gamut, operation, orientation=1):
    """Return independently filtered target-gamut nits and revision evidence."""
    if source_gamut not in RGB_TO_XYZ or target_gamut not in RGB_TO_XYZ:
        raise ValueError('Established source and requested target primaries are required')
    if operation not in ('identity', 'contain', 'cover', 'fill', 'upscale', 'crop', 'orientation'):
        raise ValueError('Unknown proof geometry')
    if type(orientation) is not int or orientation not in range(1, 9):
        raise ValueError('Known EXIF orientation is required')
    pixels = np.asarray(rgb_nits, dtype=np.float64)
    if pixels.ndim != 3 or pixels.shape[-1] != 3 or min(pixels.shape[:2]) == 0 or not np.all(np.isfinite(pixels)):
        raise ValueError('Reference pixels must be finite HxWx3 display-linear nits')
    if source_gamut != target_gamut:
        pixels = pixels @ RGB_TO_XYZ[source_gamut].T @ np.linalg.inv(RGB_TO_XYZ[target_gamut]).T
    result = np.maximum(pixels, 0) if operation == 'identity' else array_geometry(pixels, operation, orientation)
    return result, {'revision': REVISION, 'source_gamut': source_gamut, 'target_gamut': target_gamut,
                    'geometry': operation, 'orientation': orientation, 'clipping_gamut': target_gamut,
                    'filter': 'Existing independent Pillow float32 separable Lanczos and source-window geometry',
                    'clipping': 'Clamp negative filtered RGB components to zero in requested output primaries; no highlight clamp',
                    'oracle_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    'legacy_evidence': 'Original gainmap.array_geometry measurements and case IDs remain unchanged'}
