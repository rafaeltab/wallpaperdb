"""Independent proof-only ISO 21496 metadata reader and reconstruction oracle.

JPEG entropy decoding uses Pillow's native libjpeg. This narrow numerical oracle
does not qualify ISO interoperability. A second maintained ISO decoder is still
required, and unsupported metadata fails closed. Byte layout reference:
https://github.com/google/libultrahdr/blob/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/lib/src/gainmapmetadata.cpp
The reconstruction equation is also implemented independently in libavif:
https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/gainmap.c
"""

import io
import struct

import numpy as np
from PIL import Image

ISO_ID = b"urn:iso:std:iso:ts:21496:-1\0"


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
        if marker in (0xC0, 0xC1, 0xC2):
            depth, height, width, components = struct.unpack(">BHHB", value[:6])
            return {"depth": depth, "width": width, "height": height, "components": components}
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
