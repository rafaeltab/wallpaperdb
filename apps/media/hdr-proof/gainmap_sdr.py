"""Native authored-base geometry and a separately measured RGB JPEG candidate.

The independent reference remains Pillow's existing 8-bit separable Lanczos.
FFmpeg/zimg performs the candidate geometry with matching axis precision and
truncated edge weights. Native libjpeg writes RGB JPEG without a YCbCr roundtrip;
FFmpeg's separate MJPEG decoder supplies the measured samples. The image keeps
its authored SDR grade. No HDR tone mapping or reference pixels feed the encoder.
"""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

from avif import native
from gainmap_iso import _base_color_facts, jpeg_facts


_SOURCE_RGB = """
const sharp = require('sharp');
const fs = require('node:fs');
(async () => {
  const job = JSON.parse(fs.readFileSync(0, 'utf8'));
  const metadata = await sharp(job.input).metadata();
  if (metadata.hasAlpha) throw new Error('Authored JPEG base must be opaque');
  const image = await sharp(job.input).pipelineColourspace('srgb')
    .withIccProfile('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(job.output, image.data);
  process.stdout.write(JSON.stringify(image.info));
})().catch((error) => { console.error(error); process.exitCode = 1; });
"""


def _axis(source_arguments, output, width, height):
    # Direct swscale RGB8→float converts white255 to approximately253.98
    # code-equivalent in the pinned build. Explicit planar/zimg boundaries
    # preserve normalized codes. Pixel and coverage paths share native weights.
    scale = (f'zscale=w={3*width}:h={3*height}:filter=lanczos:rangein=full:range=full,'
             f'format=gbrpf32le,crop={width}:{height}:{width}:{height}')
    mask = 'between(X,W/3,2*W/3-1)*between(Y,H/3,2*H/3-1)'
    coverage = 'geq=' + ':'.join(f"{channel}='{mask}'" for channel in 'rgb')
    filters = ('[0:v]pad=iw*3:ih*3:iw:ih:color=black,format=gbrp,'
               'zscale=rangein=full:range=full,format=gbrpf32le,split[pixels][coverage];'
               f'[pixels]{scale}[p];[coverage]{coverage},{scale}[c];'
               "[p][c]blend=all_expr='if(gt(B,0),A/B,0)',"
               'zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24[out]')
    native(['ffmpeg', '-v', 'error', '-y', *source_arguments, '-filter_complex', filters,
            '-filter_complex_threads', '1', '-map', '[out]', '-frames:v', '1',
            '-map_metadata', '-1', '-threads', '1', output])
    return filters


def prepare(source, output, operation, *, gamut='srgb'):
    """Create an 8-bit authored SDR PNG through the proven native geometry."""
    if operation not in ('identity', 'contain') or gamut != 'srgb':
        raise ValueError('This candidate currently covers identity/contain with explicit sRGB gamut')
    source, output = Path(source), Path(output)
    raw = output.with_name(output.stem + '-source.rgb')
    information = json.loads(native(['node', '-e', _SOURCE_RGB], data=json.dumps({
        'input': str(source), 'output': str(raw)}).encode()))
    width, height = information['width'], information['height']
    target_width = 173 if operation == 'contain' else width
    target_height = int(height * target_width / width + .5)
    intermediate = output.with_name(output.stem + '-horizontal.png')
    first = _axis(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-i', raw],
                  intermediate, target_width, height)
    second = _axis(['-i', intermediate], output, target_width, target_height)
    return {'geometry': operation, 'source_dimensions': [width, height],
            'dimensions': [target_width, target_height], 'gamut': gamut,
            'native_filters': [first, second],
            'geometry_precision': '8-bit coded sRGB after each normalized native Lanczos axis',
            'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}


def encode(source, output, operation, *, gamut='srgb'):
    output = Path(output)
    png = output.with_name(output.stem + '-authored.png')
    evidence = prepare(source, png, operation, gamut=gamut)
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    with Image.open(png) as image:
        image.convert('RGB').save(output, format='JPEG', quality=100, subsampling=0,
                                  keep_rgb=True, icc_profile=bytes(profile))
    return {**evidence, 'coding': 'RGB JPEG quality100; sRGB transfer and primaries',
            'native_encoder': f'Pillow/native libjpeg {Image.core.jpeglib_version}',
            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


def decode(path):
    """Independently decode real JPEG samples and verify its emitted color facts."""
    path = Path(path)
    data = path.read_bytes()
    facts = jpeg_facts(data)
    if facts['depth'] != 8 or facts['components'] != 3:
        raise ValueError('Expected an 8-bit three-component RGB JPEG')
    color = _base_color_facts(data)
    if color['gamut'] != 'srgb':
        raise ValueError('Expected explicit sRGB output primaries')
    raw = native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', path, '-frames:v', '1',
                  '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    pixels = np.frombuffer(raw, dtype=np.uint8).reshape(facts['height'], facts['width'], 3) / 255
    tags = json.loads(native(['exiftool', '-json', '-n', '-G1', '-s', path]))[0]
    if tags.get('Adobe:ColorTransform') != 0:
        raise ValueError('RGB JPEG coding was not independently signaled')
    from gainmap import private_metadata_tags
    return pixels, {**facts, 'color': color, 'decoder': 'FFmpeg native MJPEG decoder',
                    'jpeg_color_transform': tags['Adobe:ColorTransform'],
                    'privacy': not private_metadata_tags(tags),
                    'metadata': {key: value for key, value in tags.items()
                                 if key != 'SourceFile' and not key.startswith('System:')}}
