"""Compare independently parsed ISO, ExifTool XMP and native probe fields."""

import math


def _close(actual, expected, precision):
    return (isinstance(actual, (int, float)) and not isinstance(actual, bool)
            and math.isfinite(actual) and math.isfinite(expected)
            and math.isclose(actual, expected, rel_tol=precision, abs_tol=1e-12))


def _channels(value):
    if isinstance(value, (int, float)):
        return [value]*3
    return value if isinstance(value, list) and len(value) == 3 else [None]*3


def check_metadata(facts, native):
    """Return strict correspondence checks, allowing only serialization rounding.

    The pinned native XMP writer uses six significant decimal digits. The
    maximum relative decimal rounding is 5e-6. A 5.1e-6 tolerance also covers
    the native float-to-ISO-rational conversion. The native probe emits nine
    digits, with float exponentiation for its boost ratios; 1e-6 bounds that
    additional rounding. Neither tolerance changes any image appearance gate.
    """
    iso = facts['iso_metadata']
    xmp = facts['android_xmp_properties']
    channels = iso['channels'] * (3 if len(iso['channels']) == 1 else 1)
    if len(channels) != 3:
        raise ValueError('ISO gain-map metadata must describe one or three channels')
    xmp_channels, native_channels = True, True
    for field, xmp_name, native_name in (
        ('minimum', 'GainMapMin', 'minimum_boost'), ('maximum', 'GainMapMax', 'maximum_boost'),
        ('gamma', 'Gamma', 'gamma'), ('base_offset', 'OffsetSDR', 'sdr_offset'),
        ('alternate_offset', 'OffsetHDR', 'hdr_offset')):
        for channel, xmp_value, native_value in zip(
                channels, _channels(xmp.get('XMP-hdrgm:'+xmp_name)), _channels(native.get(native_name))):
            expected = channel[field]
            xmp_channels &= _close(xmp_value, expected, 5.1e-6)
            native_expected = 2**expected if field in ('minimum', 'maximum') else expected
            native_channels &= _close(native_value, native_expected, 1e-6)
    headroom = (
        _close(xmp.get('XMP-hdrgm:HDRCapacityMin'), iso['base_headroom'], 5.1e-6)
        and _close(xmp.get('XMP-hdrgm:HDRCapacityMax'), iso['alternate_headroom'], 5.1e-6)
        and _close(native.get('hdr_capacity_min'), 2**iso['base_headroom'], 1e-6)
        and _close(native.get('hdr_capacity_max'), 2**iso['alternate_headroom'], 1e-6))
    dimensions = all(native.get(name) == facts[layer][axis]
                     for name, layer, axis in (('width', 'base', 'width'), ('height', 'base', 'height'),
                                              ('map_width', 'map', 'width'), ('map_height', 'map', 'height')))
    return {'checks': {'xmp_channel_values': xmp_channels, 'native_channel_values': native_channels,
                       'headroom': headroom, 'native_dimensions': dimensions,
                       'forward_sdr_base': (iso['use_base_colour_space'] is True and iso['backward'] is False
                           and iso['base_headroom'] == 0 and iso['alternate_headroom'] > 0
                           and native.get('use_base_cg') is True
                           and xmp.get('XMP-hdrgm:BaseRenditionIsHDR') is False
                           and xmp.get('XMP-hdrgm:Version') == 1.0)},
            'precision': {'xmp_relative': 5.1e-6, 'native_float_relative': 1e-6, 'absolute': 1e-12,
                          'basis': 'Pinned native XMP six significant decimal digits, native probe nine digits '
                                   'and float boost exponentiation; only metadata serialization tolerance.'}}
