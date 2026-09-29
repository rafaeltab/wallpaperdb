"""Native-only gain-map candidate from retained authored SDR and reconstructed HDR.

This module produces evidence and files. Qualification remains a separate
comparison against independently decoded source appearances and fixed gates.
SOF3 JPEG coding and local native patches require separate consumer review.
"""

import hashlib
import json
from pathlib import Path
import shutil
import struct

from PIL import Image, ImageCms

import gainmap
import gainmap_hdr
import gainmap_sdr
from lossless_jpeg import encode as encode_lossless


def encode(source, output, operation, *, gamut, map_policy='smalloffset', orientation=6):
    source, output = Path(source), Path(output)
    fixtures = json.loads((gainmap.FIXTURES/'manifest.json').read_text())['fixtures']
    matches = [fixture for fixture in fixtures if fixture['sha256'] == gainmap.digest(source)]
    if len(matches) != 1 or matches[0]['expected']['gamut'] != gamut:
        raise ValueError('Native combined candidate requires a pinned source with established gamut facts')
    if map_policy not in ('fullrange', 'smalloffset'):
        raise ValueError('Unknown native gain-map encoder policy')
    if operation not in gainmap.GEOMETRIES or orientation not in range(1, 9):
        raise ValueError('Unsupported native combined geometry or orientation')
    directory = output.with_name(output.stem+'-parts')
    directory.mkdir(parents=True, exist_ok=True)
    base_source, orientation_facts = source, None
    if operation == 'orientation':
        base_source = directory/'source-oriented.jpg'
        shutil.copyfile(source, base_source)
        gainmap.command(['exiftool', '-overwrite_original', f'-Orientation#={orientation}', base_source],
                        directory/'source-orientation-write.log')
        orientation_facts = gainmap.orientation_source(base_source, directory/'source-orientation-read.log')
        if orientation_facts['orientation'] != orientation:
            raise ValueError('Native source orientation was not established')
    authored = directory/'authored-sdr.png'
    base_geometry = gainmap_sdr.prepare(base_source, authored, operation, gamut=gamut)
    if gamut == 'p3':
        with Image.open(source) as image:
            profile = bytearray(image.info['icc_profile'])
    else:
        profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)
    base = directory/'base.jpg'
    base_encoding = encode_lossless(authored, base, icc_profile=bytes(profile))

    source_pq = gainmap_hdr.decode_source(source, directory/'hdr-source', gamut)
    # The independent ISO source oracle works in its verified P3 coordinates;
    # the native libavif/XMP oracle for the other sources works in Rec.2020.
    working_gamut = 'p3' if matches[0]['id'] == 'gainmap-android-iso' else 'rec2020'
    geometry = gainmap_hdr.resample_pq(source_pq, directory/'hdr-linear.gbrapf32', operation,
                                      orientation if operation == 'orientation' else 1, gamut=working_gamut)
    width, height = geometry['width'], geometry['height']
    if [width, height] != base_geometry['dimensions']:
        raise ValueError('Native authored SDR and reconstructed HDR geometry disagree')
    primaries = {'srgb': 1, 'p3': 12}[gamut]
    working_primaries = {'srgb': 1, 'p3': 12, 'rec2020': 9}[working_gamut]
    hdr = directory/'hdr-intent-pq.png'
    # Keep float alpha until PQ encoding. Dropping it while still linear makes
    # swscale quantize the native float samples onto a16-bit linear lattice.
    filters = (
        'setparams=alpha_mode=premultiplied,'
        f'zscale=agamma=0:transferin=linear:transfer=16:primariesin={working_primaries}:'
        f'primaries={working_primaries}:matrixin=0:matrix=0:rangein=full:range=full:npl=10000,'
        'format=gbrapf32le:alpha_modes=premultiplied,format=gbrpf32le,'
        f'zscale=agamma=0:transferin=16:transfer=16:primariesin={working_primaries}:'
        f'primaries={primaries}:matrixin=0:matrix=0:rangein=full:range=full:npl=10000,format=rgb48le')
    gainmap.command(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le',
                     '-s', f'{width}x{height}', '-i', geometry['path'], '-vf', filters, '-frames:v', '1',
                     '-map_metadata', '-1', '-y', hdr], directory/'hdr-intent-encoding.log')
    avif, gain_png, gain_jpeg = directory/'combined.avif', directory/'map.png', directory/'map.jpg'
    tool = f'/opt/proof/libavif/{map_policy}/avifgainmaputil'
    # Auto depth preserves the HDR input precision while the authored PNG base
    # and gain-map JPEG remain8-bit. Passing -d8 also quantizes PQ input to8.
    gainmap.command([tool, 'combine', authored, hdr, avif, '--cicp-base', f'{primaries}/13/0',
                     '--cicp-alternate', f'{primaries}/16/0', '--ignore-profile', '--downscaling', '1',
                     '--depth-gain-map', '8', '--qgain-map', '100', '--yuv-gain-map', '444',
                     '-y', '444', '-d', '0', '-q', '100', '-s', '10'], directory/'native-map-generation.log')
    gainmap.command(['avifgainmaputil', 'extractgainmap', avif, gain_png], directory/'map-extraction.log')
    map_encoding = encode_lossless(gain_png, gain_jpeg)
    gainmap.command(['/opt/proof/ultrahdr/precise/hdr-proof-uhdr', 'pack-avif', avif, base, gain_jpeg, output],
                    directory/'native-packing.log')
    geometry['dimensions'] = [width, height]
    result = {'candidate': f'native-libavif-{map_policy}-lossless-rgb-jpeg',
              'source_fixture': matches[0]['id'], 'source_sha256': gainmap.digest(source),
              'base_geometry': base_geometry, 'base_encoding': base_encoding,
              'hdr_geometry': geometry, 'hdr_intent_filters': filters, 'map_encoding': map_encoding,
              'map_policy': map_policy, 'native_map_encoder': tool,
              'map_encoder_sha256': hashlib.sha256(Path(tool).read_bytes()).hexdigest(),
              'authored_sdr_png': str(authored), 'hdr_intent_pq_png': str(hdr), 'gain_map_png': str(gain_png),
              'output': str(output), 'output_sha256': gainmap.digest(output), 'parts_directory': str(directory),
              'consumer_status': 'pending manual review',
              'coding_scope': 'JPEG SOF3 RGB8 base and RGB8 gain map; native libavif SOF3 reader remains unsupported'}
    if orientation_facts:
        result['orientation_source'] = orientation_facts
    (directory/'encoding-evidence.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
