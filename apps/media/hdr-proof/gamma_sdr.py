"""Optional gamma-2.2 SDR AVIF representation of the unchanged SDR grade.

ITU-T H.273 Table 3 assigns transfer characteristic 4 to assumed display gamma
2.2. Primaries remain BT.709/sRGB; matrix 0 retains full-range RGB samples.
https://www.itu.int/rec/T-REC-H.273-202407-I/en

This adapter uses native FFmpeg's 16-bit RGB LUT filter to encode the transfer
and native AOM for AV1.
The power equation below only interprets independently decoded signal for
measurement. Browser, viewer and OS wallpaper interpretation remains untested.
"""
from pathlib import Path

import numpy as np

from avif import native

TRANSFER = 4
PRIMARIES = 1


def convert(source, output):
    """Change declared SDR coding transfer without changing the display grade."""
    # The packed 16-bit LUT avoids implicit float conversion and association of
    # straight RGB with alpha. Each native LUT entry changes only the transfer.
    value = '(val/maxval)'
    linear = f'if(lte({value},0.04045),{value}/12.92,pow(({value}+0.055)/1.055,2.4))'
    curve = f'maxval*pow({linear},1/2.2)'
    filters = 'format=rgba64le,lutrgb=' + ':'.join(f"{channel}='{curve}'" for channel in 'rgb')
    native(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', filters,
            '-frames:v', '1', '-threads', '1', output])


def decode_signal_to_nits(signal):
    signal = np.asarray(signal, dtype=np.float64)
    if not np.all(np.isfinite(signal)) or np.any((signal < 0) | (signal > 1)):
        raise ValueError('Gamma-2.2 signal must be finite and within [0, 1]')
    return 100 * signal ** 2.2


def encode(srgb_paths, output, *, depth=8):
    """Encode one SDR frame or a 0.3/0.7-second proof sequence with two repeats."""
    if depth not in (8, 10, 12) or not 1 <= len(srgb_paths) <= 2:
        raise ValueError('Expected 1 or 2 SDR frames and an AVIF depth of 8, 10 or 12')
    output = Path(output)
    gamma_paths = []
    for index, source in enumerate(srgb_paths):
        gamma_png = output.with_name(f'{output.stem}-gamma22-{index}.png')
        convert(source, gamma_png)
        gamma_paths.append(gamma_png)
    command = ['avifenc', '-c', 'aom', '-j', '1', '-s', '8', '-q', '100',
               '--qalpha', '100', '-y', '444', '-d', str(depth), '--cicp', '1/4/0',
               '--ignore-exif', '--ignore-xmp', '--ignore-profile', '--timescale', '10',
               '--repetition-count', '2', '--creation-time', '1', '--modification-time', '1']
    for index, path in enumerate(gamma_paths):
        command += ['--duration', str((3, 7)[index]), path]
    native(command + [output])
