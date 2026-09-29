"""Bounded original-XMP oracle controls with native JPEG and gain application."""
import io
import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms


def jpeg(level, *, base=False):
    output = io.BytesIO()
    options = {}
    if base:
        exif = Image.Exif()
        exif[274] = 1
        exif[34665] = {40961: 1}
        options['exif'] = exif
    Image.new('RGB' if base else 'L', (8, 8), level).save(output, 'JPEG', quality=100, **options)
    return output.getvalue()


def metadata_jpeg(image, attributes='', children=''):
    xml = ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
           '<rdf:Description xmlns:h="http://ns.adobe.com/hdr-gain-map/1.0/" h:Version="1.0" '
           + attributes + '>' + children + '</rdf:Description></rdf:RDF></x:xmpmeta>').encode()
    payload = b'http://ns.adobe.com/xap/1.0/\0'+xml
    return image[:2]+b'\xff\xe1'+(len(payload)+2).to_bytes(2, 'big')+payload+image[2:]


class XmpGainMapTests(unittest.TestCase):
    def test_native_jpeg_nonlinear_gamma_offsets_and_default_scalar_metadata(self):
        from gainmap_xmp import decode_xmp_source
        for gamma, expected in [(2, 483.5050219173262), (.5, 125.71125848813)]:
            with self.subTest(gamma=gamma):
                gain = metadata_jpeg(jpeg(64), f'h:GainMapMin="-1" h:GainMapMax="3" h:Gamma="{gamma}" '
                    'h:OffsetSDR="0.25" h:OffsetHDR="0.125" h:HDRCapacityMax="2"')
                actual = decode_xmp_source(jpeg('white', base=True), gain, headroom=2)
                np.testing.assert_allclose(actual['linear_rgb_nits'], expected, atol=1e-9)
                self.assertEqual(actual['evidence']['metadata']['gamma'], [gamma]*3)
                self.assertEqual(actual['gamut'], 'srgb')

    def test_original_source_is_independent_at_both_boosts_and_import_preserves_every_code(self):
        from gainmap_xmp import run
        with tempfile.TemporaryDirectory() as temporary:
            report = run(Path(temporary))
        self.assertEqual(report['status'], 'qualified source renderer')
        self.assertTrue(all(report['checks'].values()), report['checks'])
        self.assertEqual(report['import_agreement']['base_changed_codes'], 0)
        self.assertEqual(report['import_agreement']['map_changed_codes'], 0)
        self.assertEqual(report['source']['color']['exif_colorspace'], 1)
        self.assertIsNone(report['source']['color']['icc_sha256'])
        self.assertIn('Absent ICC', report['source']['color']['container_limitation'])
        expected = {2: 'e13c1d00e5b56f92ebb0ed04824b075945750822c6fb834ab9520dc727afb3cc',
                    16: '41612d185ac102fdb9bbe75dedf122e96db9c893ecc57ae92426047ff1672123'}
        self.assertEqual({row['display_boost']: row['reference']['sha256'] for row in report['renderings']}, expected)
        self.assertTrue(all(row['measurement']['passed'] for row in report['renderings']))
        self.assertTrue(all(row['ultrahdr_diagnostic']['status'] == 'tested and failed' for row in report['renderings']))
        self.assertEqual(report['consumer_status'], 'pending manual review')

    def test_unknown_color_metadata_and_duplicate_facts_keep_exact_original_only(self):
        import avif
        from gainmap_xmp import SOURCE, decode_xmp_source, parse_metadata, source_decision
        original = SOURCE.read_bytes()
        good = metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="2"')
        missing = io.BytesIO()
        Image.new('RGB', (8, 8), 'white').save(missing, 'JPEG', quality=100)
        with self.assertRaisesRegex(ValueError, 'EXIF sRGB'):
            decode_xmp_source(missing.getvalue(), good)
        invalid = [
            metadata_jpeg(jpeg(64), 'h:HDRCapacityMax="2"'),
            metadata_jpeg(jpeg(64), 'h:GainMapMax="3"'),
            metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="2" h:Gamma="0"'),
            metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="nan"'),
            metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="2" h:OffsetSDR="-1"'),
            metadata_jpeg(good, 'h:GainMapMax="3" h:HDRCapacityMax="2"'),
            metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="2"', '<h:GainMapMax>4</h:GainMapMax>'),
            metadata_jpeg(jpeg(64), 'h:HDRCapacityMax="2"', '<h:GainMapMax><rdf:Seq><rdf:li>3</rdf:li></rdf:Seq></h:GainMapMax>'),
        ]
        for bad in invalid:
            with self.subTest(sha=hashlib.sha256(bad).hexdigest()), self.assertRaises(ValueError):
                parse_metadata(bad)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root/'changed.jpg'
            source.write_bytes(original+b'changed provenance')
            before = len(avif.COMMANDS)
            decision = source_decision(source, root/'decision')
            self.assertEqual(len(avif.COMMANDS), before)
            self.assertEqual(decision['status'], 'original only')
            self.assertTrue(decision['metadata_pending'])
            self.assertFalse(decision['derivatives'])
            self.assertEqual(Path(decision['original']).read_bytes(), source.read_bytes())

    def test_xmp_properties_must_belong_to_one_gain_map_description(self):
        from gainmap_xmp import parse_metadata
        source = metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="2"')
        good = b'h:GainMapMax="3" h:HDRCapacityMax="2"'
        bad = b'h:GainMapMax="3"><rdf:Description h:HDRCapacityMax="2"/>'
        # These are actual XML nodes, not a simulated parser response.
        wrong = source.replace(good+b'>', bad)
        old_length = int.from_bytes(source[4:6], 'big')
        wrong = wrong[:4]+(old_length+len(wrong)-len(source)).to_bytes(2, 'big')+wrong[6:]
        with self.assertRaises(ValueError):
            parse_metadata(wrong)

    def test_real_changed_color_and_map_extraction_never_qualify(self):
        import avif
        import gainmap
        from gainmap_xmp import SOURCE, decode_xmp_source, read_source, source_decision
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gainmap.inspect(SOURCE, root/'source')
            gain = (root/'source/map.jpg').read_bytes()
            for color in ('-ColorSpace#=65535', '-ColorSpace='):
                path = root/('unknown.jpg' if '65535' in color else 'absent.jpg')
                path.write_bytes(SOURCE.read_bytes())
                avif.native(['exiftool', '-overwrite_original', color, path])
                with self.assertRaisesRegex(ValueError, 'EXIF sRGB'):
                    decode_xmp_source(path.read_bytes(), gain)
                decision = source_decision(path, root/path.stem)
                self.assertEqual(decision['status'], 'original only')
                self.assertTrue(decision['metadata_pending'])
                self.assertEqual(Path(decision['original']).read_bytes(), path.read_bytes())
            inspect = gainmap.inspect

            def changed_after_real_extraction(path, directory):
                facts = inspect(path, directory)
                map_path = directory/'map.jpg'
                map_path.write_bytes(map_path.read_bytes()+b'changed extracted original map')
                return facts

            with patch.object(gainmap, 'inspect', side_effect=changed_after_real_extraction):
                with self.assertRaisesRegex(ValueError, 'Extracted XMP map'):
                    read_source(SOURCE, root/'changed-map')

    def test_per_channel_gamma_defaults_and_invalid_headroom_are_explicit(self):
        from gainmap_xmp import decode_xmp_source, parse_metadata
        gamma = '<h:Gamma><rdf:Seq><rdf:li>2</rdf:li><rdf:li>0.5</rdf:li><rdf:li>2</rdf:li></rdf:Seq></h:Gamma>'
        gain = metadata_jpeg(jpeg(64), 'h:GainMapMin="-1" h:GainMapMax="3" h:HDRCapacityMax="2" '
                             'h:OffsetSDR="0.25" h:OffsetHDR="0.125"', gamma)
        decoded = decode_xmp_source(jpeg('white', base=True), gain, headroom=2)
        np.testing.assert_allclose(decoded['linear_rgb_nits'],
            np.broadcast_to([483.5050219173262, 125.71125848813, 483.5050219173262], (8, 8, 3)), atol=1e-9)
        default = parse_metadata(metadata_jpeg(jpeg(64), 'h:GainMapMax="3" h:HDRCapacityMax="2"'))
        self.assertEqual(default['gamma'], [1]*3)
        self.assertEqual(default['minimum'], [0]*3)
        self.assertEqual(default['base_offset'], [1/64]*3)
        self.assertEqual(default['alternate_offset'], [1/64]*3)
        for headroom in (-1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                decode_xmp_source(jpeg('white', base=True), gain, headroom=headroom)
        overflow = metadata_jpeg(jpeg(255), 'h:GainMapMax="1e308" h:HDRCapacityMax="2"')
        with self.assertRaises(ValueError):
            decode_xmp_source(jpeg('white', base=True), overflow)

    def test_native_xmp_application_checks_distinct_channels_gamma_offsets_and_zero_weight(self):
        import avif
        import gainmap
        from appearance import compare_appearance
        from gainmap_iso import segments, iso_metadata
        from gainmap_xmp import SOURCE, XMP_ID, decode_xmp_source
        # Compact independent XML replaces exactly the original packet's byte
        # extent. Existing MPF/container offsets and all JPEG samples stay put.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gainmap.inspect(SOURCE, root/'source')
            original = SOURCE.read_bytes()
            map_bytes = (root/'source/map.jpg').read_bytes()
            old = next(value for marker, value in segments(map_bytes) if marker == 0xE1 and value.startswith(XMP_ID))
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
            base, gain = root/'base.jpg', root/'map.jpg'
            Image.new('RGB', (8, 8), 'white').save(base, quality=100, icc_profile=profile)
            gain.write_bytes(jpeg(64))
            for gamma in (2, .5):
                attrs = ('h:GainMapMin="-1" h:Gamma="'+str(gamma)+'" h:OffsetSDR="0.25" '
                         'h:OffsetHDR="0.125" h:HDRCapacityMax="2"')
                children = '<h:GainMapMax><rdf:Seq><rdf:li>1</rdf:li><rdf:li>2</rdf:li><rdf:li>3</rdf:li></rdf:Seq></h:GainMapMax>'
                crafted = metadata_jpeg(jpeg(64), attrs, children)
                new = next(value for marker, value in segments(crafted) if marker == 0xE1 and value.startswith(XMP_ID))
                # This native parser expects the conventional literal prefix.
                # The independent reader resolves namespace URIs instead.
                new = new.replace(b'xmlns:h=', b'xmlns:hdrgm=').replace(b'h:', b'hdrgm:')
                self.assertLessEqual(len(new), len(old))
                carrier = root/f'carrier-{gamma}.jpg'
                carrier.write_bytes(original.replace(old, new+b' '*(len(old)-len(new))))
                dual = root/f'dual-{gamma}.jpg'
                avif.native(['/opt/proof/ultrahdr/both/hdr-proof-uhdr', 'pack', carrier, base, gain, dual])
                facts = gainmap.inspect(dual, root/f'inspect-{gamma}')
                extracted = (root/f'inspect-{gamma}/map.jpg').read_bytes()
                metadata = iso_metadata(extracted)
                self.assertEqual([c['gamma'] for c in metadata['channels']], [gamma]*3)
                self.assertEqual([c['minimum'] for c in metadata['channels']], [-1]*3)
                self.assertEqual([c['maximum'] for c in metadata['channels']], [1, 2, 3])
                self.assertEqual([c['base_offset'] for c in metadata['channels']], [.25]*3)
                self.assertEqual([c['alternate_offset'] for c in metadata['channels']], [.125]*3)
                bridge = root/f'bridge-{gamma}.avif'
                avif.native(['avifgainmaputil', 'convert', dual, bridge, '--cicp', '1/13/0', '--ignore-profile',
                    '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'])
                for headroom in (0, 1, 2, 4):
                    decoded = decode_xmp_source(dual.read_bytes(), extracted, headroom=headroom)
                    self.assertEqual(decoded['evidence']['metadata']['gamma'], [gamma]*3)
                    self.assertEqual(decoded['evidence']['metadata']['base_offset'], [.25]*3)
                    self.assertEqual(decoded['evidence']['metadata']['alternate_offset'], [.125]*3)
                    if headroom == 0:
                        np.testing.assert_allclose(decoded['linear_rgb_nits'], 203, atol=1e-10)
                    path = root/f'render-{gamma}-{headroom}.png'
                    avif.native(['avifgainmaputil', 'tonemap', bridge, path, '--headroom', str(headroom),
                        '--cicp-output', '9/16/0', '--ignore-profile', '-d', '12', '-y', '444'])
                    native = avif.decode_transfer(avif.read_png(path)[..., :3], 'pq', 'rec2020')
                    measure = compare_appearance(decoded['linear_rgb_nits'], native,
                        reference_gamut='srgb', actual_gamut='rec2020', fixture_class='gainmap-hdr')
                    self.assertTrue(measure['passed'], (gamma, headroom, measure))


if __name__ == '__main__':
    unittest.main()
