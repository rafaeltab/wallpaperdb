"""Native fractional-window resize, with independently specified edge behavior."""
from pathlib import Path

from avif import native


def _axis(source_arguments, output, source_size, target_size, region):
    width, height = source_size
    out_width, out_height = target_size
    output = Path(output)
    padded = output.with_suffix('.padded.gbrpf32')
    coverage = output.with_suffix('.coverage.gbrpf32')
    numerator = output.with_suffix('.numerator.gbrpf32')
    weight = output.with_suffix('.weight.gbrpf32')
    mask = 'between(X,W/3,2*W/3-1)*between(Y,H/3,2*H/3-1)'
    filters = ('[0:v]pad=iw*3:ih*3:iw:ih:color=black,format=gbrp,'
               'zscale=rangein=full:range=full,format=gbrpf32le,split[pixels][mask];'
               '[mask]geq=' + ':'.join(f"{channel}='{mask}'" for channel in 'rgb') + '[coverage]')
    native(['ffmpeg', '-v', 'error', '-y', *source_arguments, '-filter_complex_threads', '1',
            '-filter_complex', filters, '-map', '[pixels]', '-frames:v', '1', '-f', 'rawvideo',
            '-pix_fmt', 'gbrpf32le', padded, '-map', '[coverage]', '-frames:v', '1',
            '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', coverage])
    left, top, region_width, region_height = region
    arguments = [str(value) for value in (3*width, 3*height, out_width, out_height,
                                         width+left, height+top, region_width, region_height)]
    for source, target in ((padded, numerator), (coverage, weight)):
        native(['hdr-proof-zimg-window', source, target, *arguments])
    inputs = []
    for path in (numerator, weight):
        inputs += ['-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', f'{out_width}x{out_height}', '-i', path]
    normalize = ("[0:v][1:v]blend=all_expr='if(gt(B,0),A/B,0)',"
                 'zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24[out]')
    native(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex_threads', '1',
            '-filter_complex', normalize, '-map', '[out]', '-frames:v', '1',
            '-map_metadata', '-1', '-threads', '1', output])
    return {'source_size': list(source_size), 'target_size': list(target_size),
            'active_region': list(region), 'padding_and_coverage_filter': filters,
            'normalization_filter': normalize, 'native_filter': 'zimg Lanczos3; portable C implementation'}


def cover(source_rgb24, output, width, height, *, size=173):
    """Fit opaque coded RGB8 using native separable filters and fractional crop."""
    if any(not isinstance(value, int) or value < 1 or value > 4096 for value in (width, height, size)):
        raise ValueError('Proof dimensions must be positive integers no larger than 4096')
    source_rgb24, output = Path(source_rgb24), Path(output)
    if source_rgb24.stat().st_size != width*height*3:
        raise ValueError('RGB8 source size does not match the declared geometry')
    side = min(width, height)
    left, top = (width-side)/2, (height-side)/2
    horizontal = output.with_name(output.stem+'-window-horizontal.png')
    first = _axis(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-i', source_rgb24],
                  horizontal, (width, height), (size, height), (left, 0, side, height))
    second = _axis(['-i', horizontal], output, (size, height), (size, size), (0, top, size, side))
    return {'geometry': 'cover', 'dimensions': [size, size], 'native_window_axes': [first, second]}
