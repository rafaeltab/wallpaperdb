"""Native gamma-2.2 JPEG/WebP candidates and independent ICC interpretation.

LittleCMS generates a matrix profile; FFmpeg encodes the same SDR grade with
gamma-2.2 samples; Sharp encodes real JPEG/WebP and ExifTool attaches that profile.
Pillow decodes the image samples. The measurement-side ICC reader below checks
the emitted parametric curves, colorants and chromatic adaptation directly.
ICC.1:2022 specifies these matrix-profile tags: https://www.color.org/icc-1_specification/
"""
import ctypes
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

from appearance import RGB_TO_XYZ
from avif import native
from gamma_sdr import convert


class _XyY(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double), ('Y', ctypes.c_double)]


class _Primaries(ctypes.Structure):
    _fields_ = [('red', _XyY), ('green', _XyY), ('blue', _XyY)]


def make_profile(*, gamma=2.2, gamut='srgb'):
    """Generate native ICC v4 bytes with a fixed creation date and empty ID."""
    if not np.isfinite(gamma) or not 0 < gamma < 32768 or gamut not in ('srgb', 'p3'):
        raise ValueError('Expected positive ICC16.16 gamma and sRGB or P3 primaries')
    library = ctypes.CDLL('liblcms2.so.2')
    library.cmsBuildGamma.argtypes = [ctypes.c_void_p, ctypes.c_double]
    library.cmsBuildGamma.restype = ctypes.c_void_p
    library.cmsCreateRGBProfile.argtypes = [ctypes.POINTER(_XyY), ctypes.POINTER(_Primaries),
                                           ctypes.POINTER(ctypes.c_void_p)]
    library.cmsCreateRGBProfile.restype = ctypes.c_void_p
    library.cmsSetProfileVersion.argtypes = [ctypes.c_void_p, ctypes.c_double]
    library.cmsSaveProfileToMem.argtypes = [ctypes.c_void_p, ctypes.c_void_p,
                                          ctypes.POINTER(ctypes.c_uint32)]
    library.cmsCloseProfile.argtypes = [ctypes.c_void_p]
    library.cmsFreeToneCurve.argtypes = [ctypes.c_void_p]
    curve = library.cmsBuildGamma(None, gamma)
    if not curve:
        raise RuntimeError('LittleCMS could not build the gamma curve')
    profile = None
    try:
        white = _XyY(.3127, .329, 1)
        primaries = (_Primaries(_XyY(.64, .33, 1), _XyY(.30, .60, 1), _XyY(.15, .06, 1))
                     if gamut == 'srgb' else
                     _Primaries(_XyY(.68, .32, 1), _XyY(.265, .69, 1), _XyY(.15, .06, 1)))
        curves = (ctypes.c_void_p * 3)(curve, curve, curve)
        profile = library.cmsCreateRGBProfile(ctypes.byref(white), ctypes.byref(primaries), curves)
        if not profile:
            raise RuntimeError('LittleCMS could not build the RGB profile')
        library.cmsSetProfileVersion(profile, 4.4)
        size = ctypes.c_uint32()
        if not library.cmsSaveProfileToMem(profile, None, ctypes.byref(size)):
            raise RuntimeError('LittleCMS could not size the RGB profile')
        data = ctypes.create_string_buffer(size.value)
        if not library.cmsSaveProfileToMem(profile, data, ctypes.byref(size)):
            raise RuntimeError('LittleCMS could not serialize the RGB profile')
        result = bytearray(data.raw)
        # ICC header dateTimeNumber and optional profile ID are not color data.
        # Fixed fields make this fixture generator independent of wall-clock time.
        result[24:36] = struct.pack('>6H', 2020, 1, 1, 0, 0, 0)
        result[84:100] = bytes(16)
        return bytes(result)
    finally:
        if profile:
            library.cmsCloseProfile(profile)
        library.cmsFreeToneCurve(curve)


def profile_facts(profile):
    """Read supported matrix-profile semantics, rather than trusting its name."""
    if (len(profile) < 132 or profile[36:40] != b'acsp'
            or profile[16:24] != b'RGB XYZ ' or profile[8] != 4
            or struct.unpack_from('>I', profile)[0] != len(profile)):
        raise ValueError('Expected a complete ICC v4 RGB/XYZ matrix profile')
    d50 = np.array([.9642, 1, .8249])
    header_white = np.array(struct.unpack_from('>3i', profile, 68)) / 65536
    if (profile[12:16] != b'mntr' or struct.unpack_from('>I', profile, 44)[0] != 0
            or not np.allclose(header_white, d50, atol=2 / 65536, rtol=0)):
        raise ValueError('Expected an unrestricted monitor profile with the D50 PCS illuminant')
    supported_types = {b'desc': b'mluc', b'cprt': b'mluc', b'wtpt': b'XYZ ',
        b'chad': b'sf32', b'rXYZ': b'XYZ ', b'gXYZ': b'XYZ ', b'bXYZ': b'XYZ ',
        b'rTRC': b'para', b'gTRC': b'para', b'bTRC': b'para', b'chrm': b'chrm'}
    tags = {}
    count = struct.unpack_from('>I', profile, 128)[0]
    if 132 + count * 12 > len(profile):
        raise ValueError('Truncated ICC tag table')
    for index in range(count):
        name, offset, length = struct.unpack_from('>4sII', profile, 132 + index * 12)
        if name in tags:
            raise ValueError('Duplicate ICC tag signature')
        if name[:3] in (b'A2B', b'B2A', b'D2B', b'B2D'):
            raise ValueError('ICC transform tables can override matrix/curve interpretation')
        if offset < 132 + count * 12 or offset + length > len(profile):
            raise ValueError('Invalid ICC tag bounds')
        if name not in supported_types or profile[offset:offset + 4] != supported_types[name]:
            raise ValueError('ICC tag semantics are outside the proved matrix-profile subset')
        tags[name] = profile[offset:offset + length]
    try:
        white = tags[b'wtpt']
        if len(white) != 20 or not np.allclose(np.array(struct.unpack_from('>3i', white, 8)) / 65536,
                                              d50, atol=2 / 65536, rtol=0):
            raise ValueError('Expected the ICC v4 D50 media white point')
        gammas, columns = [], []
        for channel in (b'r', b'g', b'b'):
            curve = tags[channel + b'TRC']
            if len(curve) != 16 or curve[:4] != b'para' or struct.unpack_from('>H', curve, 8)[0] != 0:
                raise ValueError('Only ICC type-0 parametric gamma curves are supported')
            gammas.append(struct.unpack_from('>i', curve, 12)[0] / 65536)
            colorant = tags[channel + b'XYZ']
            if len(colorant) != 20 or colorant[:4] != b'XYZ ':
                raise ValueError('Expected ICC XYZ colorants')
            columns.append(np.array(struct.unpack_from('>3i', colorant, 8)) / 65536)
        adaptation = tags[b'chad']
        if len(adaptation) != 44 or adaptation[:4] != b'sf32':
            raise ValueError('Expected ICC chromatic adaptation matrix')
        chad = np.array(struct.unpack_from('>9i', adaptation, 8)).reshape(3, 3) / 65536
        d50_matrix = np.stack(columns, axis=1)
        d65_matrix = np.linalg.solve(chad, d50_matrix)
    except (KeyError, struct.error, np.linalg.LinAlgError) as error:
        raise ValueError('Incomplete or invalid ICC matrix profile') from error
    expected = bool(np.allclose(gammas, [2.2] * 3, atol=1 / 65536, rtol=0)
                    and np.allclose(d65_matrix, RGB_TO_XYZ['srgb'], atol=3e-5, rtol=0))
    gamuts = [gamut for gamut in ('srgb', 'p3')
              if np.allclose(d65_matrix, RGB_TO_XYZ[gamut], atol=3e-5, rtol=0)]
    return {'sha256': hashlib.sha256(profile).hexdigest(),
            'gammas': gammas, 'rgb_to_xyz_d50': d50_matrix.tolist(),
            'chromatic_adaptation': chad.tolist(), 'rgb_to_xyz_d65': d65_matrix.tolist(),
            'gamma22_srgb_primaries': expected,
            'gamut': gamuts[0] if len(gamuts) == 1 else None,
            'creation_date': list(struct.unpack_from('>6H', profile, 24))}


def decode_signal_to_nits(signal, profile, *, expected_gamma=2.2, expected_gamut='srgb'):
    """Decode actual ICC semantics into linear Rec.2020 at nominal SDR 100 nits."""
    facts = profile_facts(profile)
    if (not np.isfinite(expected_gamma) or expected_gamma <= 0
            or expected_gamut not in ('srgb', 'p3')
            or not np.allclose(facts['gammas'], [expected_gamma] * 3, atol=1/65536, rtol=0)
            or facts['gamut'] != expected_gamut):
        raise ValueError(f'Expected gamma-{expected_gamma} encoding with {expected_gamut} primaries')
    signal = np.asarray(signal, dtype=np.float64)
    if (signal.ndim < 1 or signal.shape[-1] != 3 or not np.all(np.isfinite(signal))
            or np.any((signal < 0) | (signal > 1))):
        raise ValueError('Expected finite normalized RGB signal')
    xyz = (100 * signal ** np.asarray(facts['gammas'])) @ np.asarray(facts['rgb_to_xyz_d65']).T
    return xyz @ np.linalg.inv(RGB_TO_XYZ['rec2020']).T


def encode(paths, output, extension, *, quantization='native'):
    if extension not in ('jpg', 'webp') or not 1 <= len(paths) <= (2 if extension == 'webp' else 1):
        raise ValueError('Expected one JPEG frame or one/two WebP frames')
    if quantization not in ('native', 'nearest'):
        raise ValueError('Expected native or nearest 16-to-8-bit quantization')
    output = Path(output)
    encoded_frames = []
    for index, source in enumerate(paths):
        gamma16 = output.with_name(f'{output.stem}-gamma22-{index}.png')
        gamma8 = output.with_name(f'{output.stem}-gamma22-8-{index}.png')
        convert(source, gamma16)
        # Matching alpha-mode tags keep this code-value conversion from inserting
        # association changes. Independent libpng checks cover every RGBA code.
        quantizer = ('format=rgba' if quantization == 'native' else
                     'format=gbrap16le,setparams=alpha_mode=premultiplied,'
                     'zscale=rangein=full:range=full:dither=none,format=gbrap,'
                     'setparams=alpha_mode=straight,format=rgba')
        native(['ffmpeg', '-v', 'error', '-y', '-i', gamma16, '-vf', quantizer,
                '-frames:v', '1', '-map_metadata', '-1', '-threads', '1', gamma8])
        encoded_frames.append(str(gamma8))
    native(['node', Path(__file__).with_name('encode-gamma-sdr.cjs')],
           data=json.dumps({'inputs': encoded_frames, 'output': str(output), 'format': extension}).encode())
    icc = output.with_name(f'{output.stem}-gamma22.icc')
    icc.write_bytes(make_profile())
    native(['exiftool', '-overwrite_original', f'-ICC_Profile<={icc}', output])


def inspect_and_decode(path):
    """Use native Pillow codecs and ExifTool; parse the embedded ICC independently."""
    exif = json.loads(native(['exiftool', '-j', '-n', path]))[0]
    frames = []
    with Image.open(path) as image:
        if image.format not in ('JPEG', 'WEBP'):
            raise ValueError('Expected an encoded JPEG or WebP candidate')
        profile = image.info.get('icc_profile', b'')
        facts = {'width': image.width, 'height': image.height,
                 'depth': exif.get('BitsPerSample') if image.format == 'JPEG' else 8,
                 'format': image.format, 'loop': image.info.get('loop'), 'durations_ms': [],
                 'icc': profile_facts(profile)}
        for index in range(getattr(image, 'n_frames', 1)):
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
