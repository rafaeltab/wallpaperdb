"""Optional static SDR GIF candidate with explicit binary-alpha coercion.

FFmpeg builds and encodes the native palette; ExifTool writes the ICC GIF
application extension. Pillow independently decodes the paletted raster and
ExifTool independently extracts the emitted ICC, whose actual color semantics
are checked by gamma_icc. Physical consumer handling of GIF ICC remains pending.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from avif import native
from gamma_icc import make_profile, profile_facts
from gamma_sdr import convert


def encode(paths, output, *, gamma=2.2, quantization='native'):
    """Encode one explicitly selected frame; binary alpha is an explicit loss."""
    if len(paths) != 1:
        raise ValueError('This GIF candidate supports one explicitly selected frame')
    if gamma not in (2.2, 3.2) or quantization not in ('native', 'nearest'):
        raise ValueError('GIF candidate expects gamma 2.2 or 3.2 and native or nearest quantization')
    output = Path(output)
    suffix = str(gamma).replace('.', '')
    gamma_png = output.with_name(f'{output.stem}-gamma{suffix}.png')
    if gamma == 2.2:
        convert(paths[0], gamma_png)
    else:
        value = '(val/maxval)'
        linear = f'if(lte({value},0.04045),{value}/12.92,pow(({value}+0.055)/1.055,2.4))'
        curve = f'maxval*pow({linear},1/{gamma})'
        filters = 'format=rgba64le,lutrgb=' + ':'.join(f"{channel}='{curve}'" for channel in 'rgb')
        native(['ffmpeg', '-v', 'error', '-y', '-i', paths[0], '-vf', filters,
                '-frames:v', '1', '-threads', '1', gamma_png])
    # Make the 50% decision on 16-bit alpha before the palette's 8-bit format.
    # Required comparisons still reject any earlier geometry/quantization step
    # that moved a source sample across the threshold.
    # The opt-in zscale path rounds normalized 16-bit codes to the nearest
    # 8-bit code. The previous native format conversion remains the default.
    depth_conversion = ('format=gbrap16le,zscale=rangein=full:range=full:dither=none,format=gbrap,'
                        if quantization == 'nearest' else '')
    filters = ("[0:v]format=rgba64le,lutrgb=a='if(gte(val,maxval/2),maxval,0)',"
               + depth_conversion + 'format=rgba,'
               'split[image][palette];[palette]palettegen=reserve_transparent=1[pal];'
               '[image][pal]paletteuse=alpha_threshold=128')
    native(['ffmpeg', '-v', 'error', '-y', '-i', gamma_png, '-filter_complex', filters,
            '-frames:v', '1', '-loop', '-1', '-map_metadata', '-1', '-threads', '1', output])
    icc = output.with_name(f'{output.stem}-gamma{suffix}.icc')
    icc.write_bytes(make_profile(gamma=gamma))
    native(['exiftool', '-overwrite_original', f'-ICC_Profile<={icc}', output])


def inspect_and_decode(path):
    exif = json.loads(native(['exiftool', '-j', '-n', path]))[0]
    profile = native(['exiftool', '-b', '-ICC_Profile', path])
    frames = []
    with Image.open(path) as image:
        if image.format != 'GIF':
            raise ValueError('Expected an encoded GIF candidate')
        facts = {'width': image.width, 'height': image.height,
                 'depth': exif.get('BitsPerPixel'), 'format': image.format,
                 'loop': image.info.get('loop'), 'durations_ms': [],
                 'icc': profile_facts(profile)}
        for index in range(image.n_frames):
            image.seek(index)
            frames.append(np.asarray(image.convert('RGBA')).astype(float) / 255)
            facts['durations_ms'].append(image.info.get('duration'))
    facts['exiftool'] = {key: value for key, value in exif.items() if key not in (
        'SourceFile', 'Directory', 'FileModifyDate', 'FileAccessDate', 'FileInodeChangeDate')}
    private = ('GPSLatitude', 'GPSLongitude', 'Make', 'Model', 'SerialNumber', 'OwnerName',
               'Artist', 'Creator', 'Description', 'Title', 'Comment', 'Author', 'XMPToolkit', 'Orientation')
    facts['privacy'] = (not any(key in exif for key in private)
                        and b'HDR-PROOF-PRIVATE' not in Path(path).read_bytes())
    return facts, frames, profile
