"""Separate native libavif JPEG reader diagnostic, never a consumer certificate."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from avif import decode_transfer, read_png
from gainmap import command, inspect
from gainmap_iso import _base_color_facts
from hdr_png import _png_chunks

READER = '/opt/proof/libavif/rgbreader/avifgainmaputil'


def decode(source, directory, *, gamut):
    source, directory = Path(source), Path(directory)
    color = _base_color_facts(source.read_bytes())
    if gamut not in ('srgb', 'p3') or color['gamut'] != gamut:
        raise ValueError('Native reader requires established matching sRGB/P3 ICC facts')
    directory.mkdir(parents=True, exist_ok=True)
    source_facts = inspect(source, directory/'source')
    if (not source_facts.get('gain_map_present') or source_facts['base']['depth'] != 8
            or source_facts['base']['components'] != 3 or source_facts['map']['components'] not in (1, 3)
            or source_facts['map']['depth'] != 8 or source_facts['frame_count'] != 1
            or not source_facts['opaque'] or source_facts['metadata'].get('IFD0:Orientation', 1) != 1):
        raise ValueError('Native reader diagnostic requires static opaque RGB8 gain-map JPEG with identity orientation')
    with Image.open(directory/'source/map.jpg') as image:
        if image.getexif().get(274, 1) != 1:
            raise ValueError('Native reader diagnostic requires identity gain-map orientation')
    primaries = {'srgb': 1, 'p3': 12}[gamut]
    converted, png = directory/'decoded.avif', directory/'decoded-pq.png'
    command([READER, 'convert', source, converted, '--cicp', f'{primaries}/13/0', '--ignore-profile',
             '-d', '8', '-y', '444', '-q', '100', '--qgain-map', '100', '-s', '10'], directory/'convert.log')
    avif_facts = command(['avifdec', '--info', '-c', 'dav1d', converted], directory/'avif-info.log')
    command([READER, 'tonemap', converted, png, '--headroom', '4', '--cicp-output', f'{primaries}/16/0',
             '--ignore-profile', '-d', '12', '-y', '444'], directory/'tonemap.log')
    tags = json.loads(command(['exiftool', '-json', '-n', png], directory/'png-info.log'))[0]
    chunks = _png_chunks(png.read_bytes())
    packets = [payload for kind, payload in chunks if kind == b'cICP']
    cicp = [tags.get(key) for key in ('ColorPrimaries', 'TransferCharacteristics',
                                   'MatrixCoefficients', 'VideoFullRangeFlag')]
    signal = read_png(png)
    if (cicp != [primaries, 16, 0, 1] or packets != [bytes(cicp)] or tags.get('BitDepth') != 16
            or tags.get('Orientation', 1) != 1 or any(kind in (b'iCCP', b'sRGB') for kind, _ in chunks)
            or signal.shape != (source_facts['base']['height'], source_facts['base']['width'], 4)
            or not np.all(signal[..., 3] == 1)):
        raise ValueError('Native reader emitted unproven PQ color/geometry/alpha facts')
    return decode_transfer(signal[..., :3], 'pq', gamut), {
        'reader': READER, 'reader_binary_sha256': hashlib.sha256(Path(READER).read_bytes()).hexdigest(),
        'gamut': gamut, 'cicp': cicp, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'source_color_facts': color, 'source_facts': source_facts, 'avif_dav1d_info': avif_facts,
        'png': str(png), 'png_sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
        'headroom_log2': 4, 'consumer_status': 'pending manual review',
        'scope': 'Separate libavif RGB-map reader, AVIF lossless8 transport, and PQ12-in-PNG16 reconstruction. '
                 'Physical browser and OS wallpaper behavior is untested.'}
