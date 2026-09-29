"""Metadata agreement is a separate gate from a decodable HDR image."""

import copy
import unittest

from gainmap_metadata import check_metadata


class GainMapMetadataTests(unittest.TestCase):
    def facts(self):
        channels = [{'minimum': -10.123456, 'maximum': 2.345678, 'gamma': 1,
                     'base_offset': 1/4096, 'alternate_offset': 1/4096} for _ in range(3)]
        channels[1]['maximum'] = 3.123456
        channels[2]['minimum'] = -11.123456
        iso = {'channels': channels, 'base_headroom': 0, 'alternate_headroom': 2.123456,
               'use_base_colour_space': True, 'backward': False}
        xmp = {'XMP-hdrgm:Version': 1.0, 'XMP-hdrgm:BaseRenditionIsHDR': False,
               'XMP-hdrgm:HDRCapacityMin': 0, 'XMP-hdrgm:HDRCapacityMax': 2.12346}
        native = {'use_base_cg': True, 'width': 32, 'height': 24, 'map_width': 32, 'map_height': 24,
                  'hdr_capacity_min': 1, 'hdr_capacity_max': 2**iso['alternate_headroom']}
        for field, xmp_name, native_name in (
            ('minimum', 'GainMapMin', 'minimum_boost'), ('maximum', 'GainMapMax', 'maximum_boost'),
            ('gamma', 'Gamma', 'gamma'), ('base_offset', 'OffsetSDR', 'sdr_offset'),
            ('alternate_offset', 'OffsetHDR', 'hdr_offset')):
            xmp['XMP-hdrgm:'+xmp_name] = [float(f'{channel[field]:.6g}') for channel in channels]
            native[native_name] = [2**channel[field] if field in ('minimum', 'maximum')
                                   else channel[field] for channel in channels]
        return {'iso_metadata': iso, 'android_xmp_properties': xmp,
                'base': {'width': 32, 'height': 24}, 'map': {'width': 32, 'height': 24}}, native

    def test_six_significant_digit_xmp_values_agree_with_iso_and_native_probe(self):
        facts, native = self.facts()
        self.assertTrue(all(check_metadata(facts, native)['checks'].values()))

    def test_changed_or_missing_fields_cannot_pass(self):
        facts, native = self.facts()
        for field in ('GainMapMin', 'GainMapMax', 'Gamma', 'OffsetSDR', 'OffsetHDR',
                      'HDRCapacityMin', 'HDRCapacityMax', 'BaseRenditionIsHDR'):
            with self.subTest(field=field):
                changed = copy.deepcopy(facts)
                del changed['android_xmp_properties']['XMP-hdrgm:'+field]
                self.assertFalse(all(check_metadata(changed, native)['checks'].values()))
        changed = copy.deepcopy(facts)
        changed['android_xmp_properties']['XMP-hdrgm:GainMapMax'][1] += .01
        self.assertFalse(check_metadata(changed, native)['checks']['xmp_channel_values'])
        changed_native = copy.deepcopy(native)
        changed_native['sdr_offset'][2] *= 2
        self.assertFalse(check_metadata(facts, changed_native)['checks']['native_channel_values'])
        changed_native = copy.deepcopy(native)
        changed_native['map_width'] -= 1
        self.assertFalse(check_metadata(facts, changed_native)['checks']['native_dimensions'])

    def test_nonfinite_wrong_channel_count_and_backward_metadata_fail(self):
        facts, native = self.facts()
        for values in ([1, float('nan'), 1], [1, 1], [1, float('inf'), 1]):
            with self.subTest(values=values):
                changed = copy.deepcopy(facts)
                changed['android_xmp_properties']['XMP-hdrgm:Gamma'] = values
                self.assertFalse(check_metadata(changed, native)['checks']['xmp_channel_values'])
        for field, value in (('backward', True), ('use_base_colour_space', False), ('base_headroom', 1)):
            with self.subTest(field=field):
                changed = copy.deepcopy(facts)
                changed['iso_metadata'][field] = value
                self.assertFalse(check_metadata(changed, native)['checks']['forward_sdr_base'])


if __name__ == '__main__':
    unittest.main()
