"""Independent proof-only ISO 21496 metadata reader and reconstruction oracle.

JPEG entropy decoding uses Pillow's native libjpeg. The public source decoder
validates actual ICC color facts and the supported ISO layout before returning
pixels. Analytic vectors and independent native libavif/XMP controls validate
its narrow scope; this is not general ISO or display interoperability. Reference:
https://github.com/google/libultrahdr/blob/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/gainmapmetadata.cpp
The reconstruction equation is also implemented independently in libavif:
https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/gainmap.c
"""

import io
import hashlib
from pathlib import Path
import struct

import numpy as np
from PIL import Image, features

ISO_ID = b"urn:iso:std:iso:ts:21496:-1\0"


def _base_color_facts(base_bytes):
    """Validate supported ICC matrix/TRC semantics, never profile names."""
    chunks = [value[12:] for marker, value in segments(base_bytes)
              if marker == 0xE2 and value.startswith(b'ICC_PROFILE\0')]
    if not chunks or any(len(chunk) < 2 for chunk in chunks):
        raise ValueError('Base JPEG has no complete ICC profile')
    count = chunks[0][1]
    if (count != len(chunks) or any(chunk[1] != count for chunk in chunks)
            or sorted(chunk[0] for chunk in chunks) != list(range(1, count + 1))):
        raise ValueError('Incomplete or duplicate base ICC chunks')
    profile = b''.join(chunk[2:] for chunk in sorted(chunks, key=lambda chunk: chunk[0]))
    return srgb_profile_facts(profile)


def srgb_profile_facts(profile):
    """Read the supported sRGB-transfer ICC matrix subset in any container."""
    if (len(profile) < 132 or profile[36:40] != b'acsp' or profile[8] != 4
            or profile[12:24] != b'mntrRGB XYZ '
            or struct.unpack_from('>I', profile)[0] != len(profile)):
        raise ValueError('Expected an ICC v4 RGB/XYZ display matrix profile')
    illuminant = np.array(struct.unpack_from('>3i', profile, 68)) / 65536
    if (profile[44:48] != bytes(4)
            or not np.allclose(illuminant, [.9642, 1, .8249], atol=2/65536, rtol=0)):
        raise ValueError('Unsupported ICC header flags or PCS illuminant')
    tags = {}
    count = struct.unpack_from('>I', profile, 128)[0]
    if 132 + count * 12 > len(profile):
        raise ValueError('Truncated ICC tag table')
    supported = {b'desc', b'cprt', b'rXYZ', b'gXYZ', b'bXYZ', b'rTRC', b'gTRC', b'bTRC',
                 b'wtpt', b'chad', b'chrm'}
    for index in range(count):
        name, offset, length = struct.unpack_from('>4sII', profile, 132 + index * 12)
        if name in tags or name not in supported or offset < 132 + count * 12 or offset + length > len(profile):
            raise ValueError('Unsupported, duplicate, or invalid ICC tag')
        tags[name] = profile[offset:offset + length]

    def xyz(name):
        value = tags.get(name, b'')
        if len(value) != 20 or value[:4] != b'XYZ ':
            raise ValueError('ICC XYZ color facts missing')
        return np.array(struct.unpack_from('>3i', value, 8), dtype=float) / 65536

    expected_curve = [2.4, 1/1.055, .055/1.055, 1/12.92, .04045, 0, 0]
    curves = []
    for channel in (b'r', b'g', b'b'):
        value = tags.get(channel + b'TRC', b'')
        if len(value) < 12 or value[:4] != b'para':
            raise ValueError('ICC transfer facts missing')
        kind = struct.unpack_from('>H', value, 8)[0]
        parameters = 5 if kind == 3 else 7 if kind == 4 else 0
        if not parameters or len(value) != 12 + 4 * parameters:
            raise ValueError('Only sRGB parametric ICC transfers are supported')
        curve = [number/65536 for number in struct.unpack_from(f'>{parameters}i', value, 12)]
        curve += [0] * (7 - len(curve))
        # One ICC16.16 unit is metadata serialization precision, not an
        # appearance tolerance. All three actual curves must match sRGB.
        if not np.allclose(curve, expected_curve, atol=1/65536 + 1e-12, rtol=0):
            raise ValueError('Unsupported base ICC transfer')
        curves.append(curve)
    white = xyz(b'wtpt')
    if not np.allclose(white, [.9642, 1, .8249], atol=2/65536, rtol=0):
        raise ValueError('Unsupported ICC media white')
    matrix = np.stack([xyz(channel + b'XYZ') for channel in (b'r', b'g', b'b')], axis=1)
    from appearance import RGB_TO_XYZ
    if b'chad' in tags:
        value = tags[b'chad']
        if len(value) != 44 or value[:4] != b'sf32':
            raise ValueError('Invalid ICC chromatic adaptation')
        adaptation = np.array(struct.unpack_from('>9i', value, 8)).reshape(3, 3) / 65536
        try:
            d65 = np.linalg.solve(adaptation, matrix)
        except np.linalg.LinAlgError as error:
            raise ValueError('Singular ICC chromatic adaptation') from error
        matches = [gamut for gamut in ('srgb', 'p3')
                   if np.allclose(d65, RGB_TO_XYZ[gamut], atol=3/65536, rtol=0)]
        basis = 'ICC colorants and explicit chromatic adaptation match D65 primaries'
    else:
        # These exact D50 colorant definitions are the pinned libultrahdr ICC
        # dialect. No arbitrary absent-chad profile is assigned D65 primaries.
        # https://github.com/google/libultrahdr/blob/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/include/ultrahdr/icc.h
        canonical = {
            'srgb': np.array([[0x6fa2, 0x6299, 0x24a0], [0x38f5, 0xb785, 0x0f84],
                              [0x0390, 0x18da, 0xb6cf]]) / 65536,
            'p3': np.array([[.515102, .291965, .157153], [.241182, .692236, .0665819],
                            [-.00104941, .0418818, .784378]]),
        }
        matches = [gamut for gamut, expected in canonical.items()
                   if np.allclose(matrix, expected, atol=1/65536, rtol=0)]
        basis = 'ICC D50 colorants match the pinned canonical libultrahdr matrix dialect'
    if len(matches) != 1:
        raise ValueError('Unsupported or ambiguous ICC gamut')
    return {'gamut': matches[0], 'transfer': 'srgb', 'icc_sha256': hashlib.sha256(profile).hexdigest(),
            'icc_version_major': profile[8], 'rgb_to_xyz_d50': matrix.tolist(),
            'channel_transfer_parameters': curves, 'media_white_xyz': white.tolist(),
            'header_flags': 0, 'pcs_illuminant_xyz': illuminant.tolist(),
            'gamut_basis': basis}


def decode_iso_source(base_bytes, map_bytes, *, headroom=4.0):
    """Independently decode a supported ISO JPEG pair with established facts.

    The caller supplies the two compressed JPEG parts, obtained independently
    from the container. The result is the stored raster at 203-nit SDR white;
    no production source admission or physical-display qualification is implied.
    """
    base, gain = jpeg_facts(base_bytes), jpeg_facts(map_bytes)
    if base['depth'] != 8 or base['components'] != 3 or min(base['width'], base['height']) <= 0:
        raise ValueError('Only 8-bit RGB JPEG bases are supported')
    if gain['depth'] != 8 or gain['components'] not in (1, 3) or min(gain['width'], gain['height']) <= 0:
        raise ValueError('Only 8-bit grayscale/RGB JPEG gain maps are supported')
    color = _base_color_facts(base_bytes)
    with Image.open(io.BytesIO(base_bytes)) as image:
        orientation = image.getexif().get(274, 1)
        if (image.mode != 'RGB' or orientation != 1
                or image.size != (base['width'], base['height'])):
            raise ValueError('Only RGB stored rasters with identity base orientation are supported')
    with Image.open(io.BytesIO(map_bytes)) as image:
        if (image.mode not in ('L', 'RGB') or image.getexif().get(274, 1) != 1
                or image.size != (gain['width'], gain['height'])):
            raise ValueError('Unsupported gain-map JPEG sample model')
    try:
        with np.errstate(over='raise', invalid='raise'):
            linear, metadata = reconstruct(base_bytes, map_bytes, headroom=headroom)
    except FloatingPointError as error:
        raise ValueError('ISO reconstruction exceeded finite numeric range') from error
    if not np.all(np.isfinite(linear)):
        raise ValueError('ISO reconstruction produced nonfinite pixels')
    return {'linear_rgb_nits': linear, 'gamut': color['gamut'], 'evidence': {
        'decoder': 'Pillow/native libjpeg plus independent ISO parsing and reconstruction',
        'base_sha256': hashlib.sha256(base_bytes).hexdigest(),
        'gain_map_sha256': hashlib.sha256(map_bytes).hexdigest(),
        'oracle_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'native_libjpeg_version': Image.core.jpeglib_version,
        'native_libjpeg_turbo_version': features.version_feature('libjpeg_turbo'),
        'base': base, 'gain_map': gain, 'base_color': color, 'iso_metadata': metadata,
        'headroom_log2': headroom, 'sdr_white_nits': 203, 'orientation': orientation,
        'validation': 'Analytic native-JPEG/libavif controls in test_gainmap_iso.py; predictive RGB JPEG/native gain application controls in test_lossless_jpeg.py',
        'limitations': ['Forward ISO version-0 layout in base color space only; one nonambiguous metadata packet.',
                        'Verified sRGB transfer with sRGB/P3 matrix ICC dialects; unknown color facts are rejected.',
                        '8-bit RGB base and grayscale/RGB map; gain-map samples use metadata gamma, without ICC conversion.',
                        'SOF3 predictive JPEG has native sample/application controls; the pinned libavif reader rejects it.',
                        'Pillow bilinear map resizing at JPEG sample precision; only the committed corpus and controls are proven.',
                        'Identity source orientation only; no physical HDR display or whole-format interoperability claim.'],
    }}


def segments(data):
    """Read JPEG headers without searching entropy-coded bytes for markers."""
    if data[:2] != b"\xff\xd8":
        raise ValueError("JPEG SOI missing")
    position = 2
    while position + 4 <= len(data):
        if data[position] != 255:
            raise ValueError("Invalid JPEG header marker")
        marker = data[position + 1]
        if marker in (0xDA, 0xD9):
            return
        size = int.from_bytes(data[position + 2:position + 4], "big")
        if size < 2 or position + 2 + size > len(data):
            raise ValueError("Truncated JPEG segment")
        yield marker, data[position + 4:position + 2 + size]
        position += size + 2


def jpeg_facts(data):
    for marker, value in segments(data):
        if marker in (0xC0, 0xC1, 0xC2, 0xC3):
            depth, height, width, components = struct.unpack(">BHHB", value[:6])
            return {"depth": depth, "width": width, "height": height, "components": components,
                    "sof": marker - 0xC0}
    raise ValueError("JPEG SOF missing")


def iso_metadata(map_bytes):
    payloads = [value[len(ISO_ID):] for marker, value in segments(map_bytes)
                if marker == 0xE2 and value.startswith(ISO_ID)]
    if len(payloads) != 1:
        raise ValueError("Expected exactly one ISO gain-map metadata packet")
    payload = payloads[0]
    if len(payload) < 5:
        raise ValueError("ISO gain-map metadata missing")
    minimum_version, writer_version, flags = struct.unpack(">HHB", payload[:5])
    if minimum_version != 0 or flags & 0x33:
        raise ValueError("Unsupported ISO gain-map version or reserved flags")
    position = 5

    def integer(signed=False):
        nonlocal position
        if position + 4 > len(payload):
            raise ValueError("Truncated ISO gain-map fraction")
        value = int.from_bytes(payload[position:position + 4], "big", signed=signed)
        position += 4
        return value

    common = integer() if flags & 8 else None

    def fraction(signed=False):
        numerator = integer(signed)
        denominator = common if common is not None else integer()
        if denominator == 0:
            raise ValueError("Zero ISO gain-map denominator")
        return numerator / denominator

    base_headroom, alternate_headroom = fraction(), fraction()
    channels = []
    for _ in range(3 if flags & 128 else 1):
        channels.append({"minimum": fraction(True), "maximum": fraction(True),
                         "gamma": fraction(), "base_offset": fraction(True),
                         "alternate_offset": fraction(True)})
    if any(channel["gamma"] <= 0 or channel["maximum"] < channel["minimum"] for channel in channels):
        raise ValueError("Invalid ISO gain-map gamma or gain bounds")
    if position != len(payload):
        raise ValueError("Unrecognized trailing ISO gain-map metadata")
    return {"minimum_version": minimum_version, "writer_version": writer_version,
            "use_base_colour_space": bool(flags & 64), "backward": bool(flags & 4),
            "base_headroom": base_headroom, "alternate_headroom": alternate_headroom,
            "channels": channels}


def reconstruct(base_bytes, map_bytes, headroom=4.0):
    # Headroom is log2(display peak / SDR white), not a linear ratio or nits.
    if not np.isfinite(headroom) or headroom < 0:
        raise ValueError("ISO display headroom must be finite and nonnegative")
    metadata = iso_metadata(map_bytes)
    if metadata["backward"] or not metadata["use_base_colour_space"]:
        raise ValueError("Numerical ISO oracle only handles forward maps in base colour space")
    if metadata["alternate_headroom"] <= metadata["base_headroom"]:
        raise ValueError("Numerical ISO oracle requires increasing HDR headroom")
    base = Image.open(io.BytesIO(base_bytes)).convert("RGB")
    gain = Image.open(io.BytesIO(map_bytes)).convert("RGB").resize(base.size, Image.Resampling.BILINEAR)
    base_signal = np.asarray(base, dtype=np.float64) / 255.0
    gain_signal = np.asarray(gain, dtype=np.float64) / 255.0
    base_linear = np.where(base_signal <= 0.04045, base_signal / 12.92,
                           ((base_signal + 0.055) / 1.055) ** 2.4)
    weight = np.clip((headroom - metadata["base_headroom"]) /
                     (metadata["alternate_headroom"] - metadata["base_headroom"]), 0, 1)
    if weight == 0:
        # The base rendition is returned unchanged when the display cannot
        # apply any gain. Offsets only participate in gain-map application.
        return base_linear * 203.0, metadata
    channels = metadata["channels"] * (3 if len(metadata["channels"]) == 1 else 1)
    result = np.empty_like(base_linear)
    for channel, parameters in enumerate(channels):
        logarithm = parameters["minimum"] + gain_signal[..., channel] ** (1 / parameters["gamma"]) * (
            parameters["maximum"] - parameters["minimum"])
        result[..., channel] = (base_linear[..., channel] + parameters["base_offset"]) * 2 ** (
            logarithm * weight) - parameters["alternate_offset"]
    return np.maximum(result, 0) * 203.0, metadata
