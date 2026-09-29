"""Native authored-base geometry and a separately measured RGB JPEG candidate.

The independent reference remains Pillow's existing 8-bit separable Lanczos.
FFmpeg/zimg performs the candidate geometry with matching axis precision and
truncated edge weights. Native libjpeg writes RGB JPEG without a YCbCr roundtrip;
FFmpeg's separate MJPEG decoder supplies the measured samples. The image keeps
its authored SDR grade. No HDR tone mapping or reference pixels feed the encoder.
"""
import hashlib
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageCms

from avif import native
from gainmap_iso import _base_color_facts, jpeg_facts, segments


_SOURCE_RGB = """
const sharp = require('sharp');
const fs = require('node:fs');
(async () => {
  const job = JSON.parse(fs.readFileSync(0, 'utf8'));
  const metadata = await sharp(job.input).metadata();
  if (metadata.hasAlpha) throw new Error('Authored JPEG base must be opaque');
  const pipeline = sharp(job.input).keepIccProfile();
  const image = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(job.output, image.data);
  process.stdout.write(JSON.stringify(image.info));
})().catch((error) => { console.error(error); process.exitCode = 1; });
"""


def _axis(source_arguments, output, width, height, *, before=''):
    # Direct swscale RGB8→float converts white255 to approximately253.98
    # code-equivalent in the pinned build. Explicit planar/zimg boundaries
    # preserve normalized codes. Pixel and coverage paths share native weights.
    scale = (f'zscale=w={3*width}:h={3*height}:filter=lanczos:rangein=full:range=full,'
             f'format=gbrpf32le,crop={width}:{height}:{width}:{height}')
    mask = 'between(X,W/3,2*W/3-1)*between(Y,H/3,2*H/3-1)'
    coverage = 'geq=' + ':'.join(f"{channel}='{mask}'" for channel in 'rgb')
    filters = ('[0:v]' + (before + ',' if before else '') +
               'pad=iw*3:ih*3:iw:ih:color=black,format=gbrp,'
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
    if operation not in ('identity', 'contain', 'cover', 'fill', 'upscale', 'crop', 'orientation') or gamut not in ('srgb', 'p3'):
        raise ValueError('Unsupported native authored-SDR geometry or gamut')
    source, output = Path(source), Path(output)
    if gamut == 'p3' and _base_color_facts(source.read_bytes())['gamut'] != 'p3':
        raise ValueError('P3 preservation requires verified P3 source color facts')
    raw = output.with_name(output.stem + '-source.rgb')
    information = json.loads(native(['node', '-e', _SOURCE_RGB], data=json.dumps({
        'input': str(source), 'output': str(raw), 'gamut': gamut}).encode()))
    width, height = information['width'], information['height']
    source_color_conversion = 'Preserve decoded source RGB and its verified primaries'
    if gamut == 'srgb':
        with Image.open(source) as image:
            profile = image.info.get('icc_profile')
        if profile:
            # Sharp independently decodes the authored JPEG samples. Invoke
            # system LittleCMS explicitly so this transform uses the declared
            # perceptual intent and in-memory sRGB destination. Reopening a
            # serialized destination quantizes its colorants before conversion
            # and changes near-black resampling results. No reference pixels
            # or reference geometry enter this native candidate pipeline.
            decoded = Image.frombytes('RGB', (width, height), raw.read_bytes())
            converted = ImageCms.profileToProfile(decoded, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                ImageCms.createProfile('sRGB'), renderingIntent=0, outputMode='RGB')
            raw.write_bytes(converted.tobytes())
            source_color_conversion = 'Native system LittleCMS perceptual transform to in-memory sRGB'
        else:
            source_color_conversion = 'Fixture-declared sRGB source without an embedded ICC profile'
    raw_width, raw_height = width, height
    before, orientation = '', 1
    if operation == 'orientation':
        with Image.open(source) as image:
            orientation = image.getexif().get(274, 1)
        effects = {1: '', 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip',
                   5: 'transpose=clock,hflip', 6: 'transpose=clock',
                   7: 'transpose=clock,vflip', 8: 'transpose=cclock'}
        if orientation not in effects:
            raise ValueError('Unsupported source EXIF orientation')
        before = effects[orientation]
        if orientation >= 5:
            width, height = height, width
    if operation == 'crop':
        if width < 284 or height < 256:
            raise ValueError('The declared proof crop must fit the source raster')
        before, width, height = 'crop=271:239:13:17', 271, 239
    target_width = width if operation == 'identity' else 769 if operation == 'upscale' else 173
    target_height = int(height * target_width / width + .5)
    if operation in ('fill', 'crop'):
        target_height = 211 if operation == 'fill' else 153
    if operation == 'cover':
        from native_zimg import cover
        geometry_evidence = cover(raw, output, width, height, size=173)
    else:
        intermediate = output.with_name(output.stem + '-horizontal.png')
        first = _axis(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{raw_width}x{raw_height}', '-i', raw],
                      intermediate, target_width, height, before=before)
        second = _axis(['-i', intermediate], output, target_width, target_height)
        geometry_evidence = {'dimensions': [target_width, target_height], 'native_filters': [first, second]}
    return {'geometry': operation, 'source_dimensions': [raw_width, raw_height], 'source_orientation': orientation,
            **geometry_evidence, 'gamut': gamut,
            'source_color_conversion': source_color_conversion,
            'geometry_precision': '8-bit coded sRGB after each normalized native Lanczos axis',
            'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}


def encode(source, output, operation, *, gamut='srgb', gamma=None):
    if gamma not in (None, 3.2):
        raise ValueError('Supported JPEG candidates use sRGB transfer or explicitly declared gamma3.2')
    output = Path(output)
    png = output.with_name(output.stem + '-authored.png')
    evidence = prepare(source, png, operation, gamut=gamut)
    if gamma is not None:
        from gamma_icc import make_profile
        encoded = output.with_name(output.stem + '-gamma32.png')
        value = '(val/maxval)'
        linear = f'if(lte({value},0.04045),{value}/12.92,pow(({value}+0.055)/1.055,2.4))'
        curve = f'maxval*pow({linear},1/{gamma})'
        filters = ('format=gbrp,zscale=rangein=full:range=full,format=gbrp16le,format=rgb48le,'
                   'lutrgb=' + ':'.join(f"{channel}='{curve}'" for channel in 'rgb') + ','
                   'format=gbrp16le,zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24')
        native(['ffmpeg', '-v', 'error', '-y', '-i', png, '-vf', filters, '-frames:v', '1',
                '-map_metadata', '-1', '-threads', '1', encoded])
        png = encoded
        profile = bytearray(make_profile(gamma=gamma, gamut=gamut))
    elif gamut == 'p3':
        with Image.open(source) as image:
            profile = bytearray(image.info['icc_profile'])
    else:
        profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    profile[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
    # The serialized timestamp changed; an inherited profile ID would no
    # longer describe these bytes. A zero ID is permitted by ICC v4.
    profile[84:100] = bytes(16)
    with Image.open(png) as image:
        image.convert('RGB').save(output, format='JPEG', quality=100, subsampling=0,
                                  keep_rgb=True, icc_profile=bytes(profile))
    coding = ('RGB JPEG quality100; sRGB transfer and primaries' if gamma is None and gamut == 'srgb'
              else f'RGB JPEG quality100; {"sRGB" if gamma is None else "gamma"+str(gamma)} transfer; {gamut} primaries')
    return {**evidence, 'coding': coding, 'gamma': gamma,
            'icc_sha256': hashlib.sha256(profile).hexdigest(),
            'native_encoder': f'Pillow/native libjpeg {Image.core.jpeglib_version}',
            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


def decode(path, *, gamut='srgb', gamma=None):
    """Independently decode real JPEG samples and verify its emitted color facts."""
    path = Path(path)
    data = path.read_bytes()
    facts = jpeg_facts(data)
    if facts['depth'] != 8 or facts['components'] != 3:
        raise ValueError('Expected an 8-bit three-component RGB JPEG')
    with Image.open(path) as image:
        profile = image.info.get('icc_profile', b'')
    if gamma is None:
        color = _base_color_facts(data)
    else:
        from gamma_icc import profile_facts, decode_signal_to_nits
        # Validate actual profile semantics against the explicitly requested
        # coding before treating any decoded sample as display luminance.
        decode_signal_to_nits(np.zeros((1, 3)), profile, expected_gamma=gamma, expected_gamut=gamut)
        color = {**profile_facts(profile), 'transfer': f'gamma{gamma}'}
    if color['gamut'] != gamut:
        raise ValueError('Emitted JPEG gamut does not match the requested primaries')
    raw = native(['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', path, '-frames:v', '1',
                  '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    pixels = np.frombuffer(raw, dtype=np.uint8).reshape(facts['height'], facts['width'], 3) / 255
    tags = json.loads(native(['exiftool', '-json', '-n', '-G1', '-s', path]))[0]
    transform = tags.get('Adobe:ColorTransform')
    predictive_rgb = (facts.get('sof') == 3 and any(
        marker == 0xC3 and len(value) == 15 and value[6::3] == b'RGB'
        and value[7::3] == b'\x11\x11\x11' for marker, value in segments(data)))
    if transform != 0 and not (transform is None and predictive_rgb):
        raise ValueError('RGB JPEG coding was not independently signaled')
    color_model = ('SOF3 RGB component identifiers with verified RGB ICC'
                   if transform is None else 'Adobe ColorTransform 0 with verified RGB ICC')
    from gainmap import private_metadata_tags
    return pixels, {**facts, 'color': color, 'decoder': 'FFmpeg native MJPEG decoder',
                    'icc_sha256': hashlib.sha256(profile).hexdigest(),
                    'jpeg_color_transform': transform, 'jpeg_color_model': color_model,
                    'gamut': gamut, 'transfer': 'srgb' if gamma is None else f'gamma{gamma}',
                    'privacy': not private_metadata_tags(tags),
                    'metadata': {key: value for key, value in tags.items()
                                 if key != 'SourceFile' and not key.startswith('System:')}}


def decode_linear(path, *, gamut='srgb', gamma=None):
    """Return independently decoded display-linear Rec.2020 at100-nit SDR white."""
    pixels, facts = decode(path, gamut=gamut, gamma=gamma)
    if gamma is not None:
        from gamma_icc import decode_signal_to_nits
        with Image.open(path) as image:
            profile = image.info['icc_profile']
        linear = decode_signal_to_nits(pixels, profile, expected_gamma=gamma, expected_gamut=gamut)
    else:
        from appearance import sdr_signal_to_nits, RGB_TO_XYZ
        linear = sdr_signal_to_nits(pixels) @ RGB_TO_XYZ[gamut].T @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T
    return linear, facts
