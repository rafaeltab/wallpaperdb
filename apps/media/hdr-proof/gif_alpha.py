"""Native separable alpha geometry for an explicit binary-coercion candidate.

Extract the coded alpha plane before any HDR/SDR transfer work. Native zimg
resamples it horizontally and vertically, with normalized edge weights and
16-bit rounding after each axis. This keeps an exact halfway sample from
falling below 0.5 during a later two-dimensional float normalization.

The independent checks retain the exact final binary-alpha requirement. The
intermediate 16-bit result also uses the existing PNG ceiling of 2/65535: each
axis contributes at most half a code from rounding, with a code reserved for
native float filtering. No appearance or binary-coercion threshold changes.
"""
from pathlib import Path

from PIL import Image

from avif import native


def _resample_axis(source, output, axis, size):
    pad = 'iw*3:ih:iw:0' if axis == 'x' else 'iw:ih*3:0:ih'
    scale = f'w={size*3}:h=ih' if axis == 'x' else f'w=iw:h={size*3}'
    window = f'{size}:ih:{size}:0' if axis == 'x' else f'iw:{size}:0:{size}'
    coverage = 'between(X,W/3,2*W/3-1)' if axis == 'x' else 'between(Y,H/3,2*H/3-1)'
    resample = (f'zscale={scale}:filter=bilinear:rangein=full:range=full,'
                f'format=gbrpf32le,crop={window}')
    filters = (
        f'format=gbrp16le,pad={pad}:color=black,'
        'zscale=rangein=full:range=full,format=gbrpf32le,split[pixels][coverage];'
        '[pixels]' + resample + '[numerator];[coverage]geq='
        + ':'.join(f"{channel}='{coverage}'" for channel in 'rgb') + ',' + resample + '[weight];'
        "[numerator][weight]blend=all_expr='if(gt(B,0),A/B,0)',"
        'zscale=rangein=full:range=full:dither=none,format=gbrp16le,format=rgb48le'
    )
    native(['ffmpeg', '-v', 'error', '-y', '-filter_complex_threads', '1', '-i', source,
            '-filter_complex', filters, '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])


def apply_alpha_geometry(source, converted, output, geometry):
    """Replace alpha using native source geometry while copying RGB16 exactly.

    The orientation input must already have its source orientation baked, as
    it is for the existing color conversion. The source's RGB codes are unused.
    """
    with Image.open(source) as image:
        source_width, source_height = image.size
    dimensions = {'identity': (source_width, source_height), 'static': (source_width, source_height),
        'contain': (57, 38), 'cover': (40, 40), 'fill': (40, 48),
        'upscale': (120, 80), 'orientation': (58, 87)}
    if geometry not in dimensions:
        raise ValueError('Unknown native alpha geometry')
    width, height = dimensions[geometry]
    with Image.open(converted) as image:
        if image.size != (width, height):
            raise ValueError('Converted color dimensions do not match the requested alpha geometry')
    output = Path(output)
    coded = output.with_name(output.stem + '-alpha-source.png')
    # Plane extraction and merging copy native integer samples. Keeping three
    # identical RGB planes selects zimg's full-precision RGB path; gray format
    # negotiation can otherwise insert an eight-bit conversion.
    extraction = ('format=gbrap16le,extractplanes=a,split=3[a][b][c];'
                  '[a][b][c]mergeplanes=0x001020:gbrp16le,format=rgb48le')
    native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-filter_complex', extraction,
            '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', coded])
    if geometry not in ('identity', 'static'):
        scaled_width = source_width * height // source_height if geometry == 'cover' else width
        horizontal = output.with_name(output.stem + '-alpha-x.png')
        vertical = output.with_name(output.stem + '-alpha-y.png')
        _resample_axis(coded, horizontal, 'x', scaled_width)
        _resample_axis(horizontal, vertical, 'y', height)
        coded = vertical
    crop = f'crop={width}:{height}:(iw-ow)/2:0,' if geometry == 'cover' else ''
    # Merge the four coded planes directly. alphamerge negotiates an eight-bit
    # gray input, which would lose the exact halfway decision and RGB precision.
    merge = ('[0:v]format=gbrap16le,extractplanes=r+g+b[r][g][b];'
             '[1:v]format=gbrp16le,' + crop + 'extractplanes=r[a];'
             '[g][b][r][a]mergeplanes=0x00102030:gbrap16le,format=rgba64le')
    native(['ffmpeg', '-v', 'error', '-y', '-filter_complex_threads', '1',
            '-i', converted, '-i', coded, '-filter_complex', merge,
            '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', output])
