"""Native HDR source decode and float geometry for gain-map candidates.

The geometry reference operates in established decoder primaries and drops
filter support outside the image. Native zero padding plus a resampled coverage image
implements that boundary condition. Negative Lanczos excursions are clipped
only after resampling. Files keep float alpha until a later transfer encoding;
dropping it through swscale first would quantize linear light to 16 bits.
"""

import json
import math
from pathlib import Path
import struct

import numpy as np
from PIL import Image

from gainmap import command


def decode_source(source, directory, gamut):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    primaries = {"srgb": 1, "p3": 12}[gamut]
    avif, pq = directory / "source.avif", directory / "source-pq-rec2020.png"
    arguments = ["--cicp", f"{primaries}/13/0", "--ignore-profile", "-d", "8", "-y", "444",
                 "-q", "100", "--qgain-map", "100", "-s", "10"]
    try:
        command(["avifgainmaputil", "convert", source, avif, *arguments], directory / "decode-convert.log")
    except RuntimeError:
        return _decode_iso_source(source, directory, gamut)
    command(["avifgainmaputil", "tonemap", avif, pq, "--headroom", "4", "--cicp-output", "9/16/0",
             "--ignore-profile", "-d", "12", "-y", "444"], directory / "decode-pq.log")
    return pq


def _decode_iso_source(source, directory, gamut):
    """Native ISO application with independently established map sampling.

    The native decoder normally chooses a gain-map ICC as its destination
    gamut. Gain samples instead use the ISO metadata in the base color space.
    A profile-free, full-size map avoids that conversion and the decoder's
    different interpolation rule. Every pixel operation stays in native code.
    """
    from gainmap_iso import _base_color_facts, iso_metadata, jpeg_facts
    from gainmap_sdr import prepare, _SOURCE_RGB
    from lossless_jpeg import encode

    if _base_color_facts(Path(source).read_bytes())['gamut'] != gamut:
        raise ValueError('ISO source ICC disagrees with the requested source gamut')
    helper = '/opt/proof/ultrahdr/precise/hdr-proof-uhdr'
    base, gain = directory/'source-base.jpg', directory/'source-map.jpg'
    command([helper, 'extract', source, base, gain], directory/'iso-extract.log')
    metadata = iso_metadata(gain.read_bytes())
    if metadata['backward'] or not metadata['use_base_colour_space']:
        raise ValueError('Unsupported native ISO source metadata layout')
    base_facts, map_facts = jpeg_facts(base.read_bytes()), jpeg_facts(gain.read_bytes())
    if (base_facts['depth'] != 8 or base_facts['components'] != 3
            or map_facts['depth'] != 8 or map_facts['components'] not in (1, 3)):
        raise ValueError('Native ISO source requires an RGB8 base and gray8/RGB8 map')
    width, height = base_facts['width'], base_facts['height']
    if (width not in (map_facts['width'], 2*map_facts['width'])
            or height not in (map_facts['height'], 2*map_facts['height'])):
        raise ValueError('Native ISO map interpolation currently proves identity or twofold axes only')
    with Image.open(gain) as image:
        if image.getexif().get(274, 1) != 1:
            raise ValueError('Native ISO gain map requires the stored identity raster')
    with Image.open(base) as image:
        if image.getexif().get(274, 1) != 1:
            raise ValueError('Native ISO decoder requires the stored identity raster')
        profile = image.info['icc_profile']
    authored, lossless_base = directory/'base-native.png', directory/'base-lossless.jpg'
    prepare(source, authored, 'identity', gamut=gamut)
    encode(authored, lossless_base, icc_profile=profile)
    # Quantize half-up to 8 bits after each bilinear axis, matching the
    # committed independent source reference. The epsilon is 0.0001 of
    # one JPEG code to offset native float arithmetic at exact half ties.
    # The admitted identity/twofold axes have exact quarter-code weights,
    # so this correction cannot cross a distinct non-tie rounding boundary.
    # No reference samples enter this path.
    map_raw = directory/'map-native.rgb'
    map_decode = json.loads(command(['node', '-e', _SOURCE_RGB], directory/'iso-map-decode.log',
        data=json.dumps({'input': str(gain), 'output': str(map_raw)})))
    if ([map_decode['width'], map_decode['height']] != [map_facts['width'], map_facts['height']]
            or map_decode['channels'] != 3):
        raise ValueError('Native ISO gain-map decoded dimensions/components disagree')
    map_x, map_full = directory/'map-horizontal.png', directory/'map-full.png'
    map_filters = []
    for input_path, output_path, size in ((map_raw, map_x, (width, map_facts['height'])),
                                           (map_x, map_full, (width, height))):
        round_codes = ':'.join(f"{channel}='floor({channel}(X,Y)*255+0.5001)/255'" for channel in 'rgb')
        filters = ('format=gbrp,zscale=rangein=full:range=full,format=gbrpf32le,'
                   f'zscale=w={size[0]}:h={size[1]}:filter=bilinear:rangein=full:range=full,'
                   f'format=gbrpf32le,geq={round_codes},'
                   'zscale=rangein=full:range=full:dither=none,format=gbrp,format=rgb24')
        arguments = (['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s',
                      f"{map_facts['width']}x{map_facts['height']}"] if input_path == map_raw else [])
        command(['ffmpeg', '-v', 'error', '-y', *arguments, '-i', input_path, '-vf', filters,
                 '-map_metadata', '-1', '-frames:v', '1', '-threads', '1', output_path],
                output_path.with_suffix('.log'))
        map_filters.append(filters)
    lossless_map, repacked = directory/'map-lossless.jpg', directory/'source-native.jpg'
    encode(map_full, lossless_map)
    command([helper, 'pack', source, lossless_base, lossless_map, repacked], directory/'iso-pack.log')
    linear = directory/'source-linear.gbrpf32'
    facts = json.loads(command([helper, 'decode-linear', repacked, linear, '16'], directory/'iso-decode.log'))
    native_gamut = {0: 'srgb', 1: 'p3', 2: 'rec2020'}.get(facts['gamut'])
    if (native_gamut != gamut or [facts['width'], facts['height']] != [width, height]
            or facts['requested_display_boost'] != 16):
        raise ValueError('Native ISO decoder output disagrees with established color/dimension facts')
    primaries = {'srgb': 1, 'p3': 12}[gamut]
    pq = directory/f'source-pq-{gamut}.png'
    filters = ('format=gbrpf32le,zscale=transferin=linear:transfer=16:'
               f'primariesin={primaries}:primaries={primaries}:matrixin=0:matrix=0:'
               'rangein=full:range=full:npl=203,format=gbrp16le,format=rgb48be')
    command(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le',
             '-s', f'{width}x{height}', '-i', linear, '-vf', filters, '-frames:v', '1',
             '-color_primaries', primaries, '-color_trc', 16, '-colorspace', 'rgb', '-color_range', 'pc',
             '-map_metadata', '-1', '-threads', '1', pq], directory/'iso-pq.log')
    (directory/'iso-native-evidence.json').write_text(json.dumps({
        'native_decoder': helper, 'decoded_color_facts': facts, 'gamut': native_gamut,
        'headroom_log2': 4, 'sdr_white_nits': 203, 'map_resampling_filters': map_filters,
        'map_geometry': 'Native separable bilinear at 8-bit axis precision',
        'map_profile': 'No display ICC; ISO gain samples are applied in verified base color space',
        'pq_filter': filters, 'pq_output': str(pq)}, indent=2)+'\n')
    return pq


def _pq_source_primaries(source):
    from hdr_png import _png_chunks
    chunks = _png_chunks(Path(source).read_bytes())
    cicp = [payload for kind, payload in chunks if kind == b'cICP']
    if (len(cicp) != 1 or len(cicp[0]) != 4 or cicp[0][0] not in (1, 9, 12)
            or cicp[0][1:] != bytes((16, 0, 1))
            or any(kind in (b'iCCP', b'sRGB') for kind, _ in chunks)):
        raise ValueError('HDR geometry requires recognized full-range RGB PQ signaling')
    return cicp[0][0]


def resample_pq(source_pq, output, operation, orientation=1, *, gamut='rec2020'):
    """Resample known PQ PNG through native float Lanczos in the declared gamut."""
    output = Path(output)
    source_primaries = _pq_source_primaries(source_pq)
    primaries = {'rec2020': 9, 'p3': 12, 'srgb': 1}[gamut]
    with Image.open(source_pq) as image:
        source_width, source_height = image.size
    if operation == 'cover':
        return _cover_pq(source_pq, output, source_width, source_height, gamut, source_primaries)
    width, height = source_width, source_height
    prefix = []
    if operation == "orientation":
        effects = {2: ["hflip"], 3: ["hflip", "vflip"], 4: ["vflip"],
                   5: ["transpose=clock", "hflip"], 6: ["transpose=clock"],
                   7: ["transpose=clock", "vflip"], 8: ["transpose=cclock"]}
        prefix += effects.get(orientation, [])
        if orientation >= 5:
            width, height = height, width
    if operation == "crop":
        prefix += ["crop=271:239:13:17"]
        width, height = 271, 239
    target_width = 769 if operation == "upscale" else 173
    target_height = math.floor(height * target_width / width + 0.5)
    final_crop = ""
    if operation == "fill":
        target_height = 211
    elif operation == "crop":
        target_height = 153
    elif operation == "cover":
        scale = 173 / min(width, height)
        target_width, target_height = math.floor(width * scale + 0.5), math.floor(height * scale + 0.5)
        final_crop = ",crop=173:173:(iw-ow)/2:(ih-oh)/2"
    elif operation not in ("contain", "upscale", "orientation"):
        raise ValueError(f"Unknown HDR geometry {operation}")
    resample = (f"zscale=agamma=0:w={target_width*3}:h={target_height*3}:filter=lanczos,"
                "format=gbrapf32le:alpha_modes=premultiplied,"
                f"crop={target_width}:{target_height}:{target_width}:{target_height}")
    coverage = "between(X,W/3,2*W/3-1)*between(Y,H/3,2*H/3-1)"
    filters = ("[0:v]" + ",".join(prefix + [
        "format=gbrap16le", "pad=iw*3:ih*3:iw:ih:color=black@0", "setparams=alpha_mode=premultiplied",
        "format=gbrapf32le:alpha_modes=premultiplied",
        f"zscale=agamma=0:transferin=16:primariesin={source_primaries}:matrixin=0:rangein=full:transfer=linear:primaries={primaries}:matrix=0:range=full:npl=10000",
        "format=gbrapf32le:alpha_modes=premultiplied", "split[pixels][coverage]"])
        + ";[pixels]" + resample + "[numerator];[coverage]geq="
        + ":".join(f"{channel}='{coverage}'" for channel in "rgba") + "," + resample + "[weight];"
        "[numerator][weight]blend=all_expr='if(gt(B,0),max(A/B,0),0)'"
        + final_crop + ",setparams=alpha_mode=premultiplied,format=gbrapf32le:alpha_modes=premultiplied[out]")
    command(["ffmpeg", "-v", "error", "-filter_complex_threads", "1", "-i", source_pq,
             "-filter_complex", filters, "-map", "[out]", "-frames:v", "1", "-pix_fmt", "gbrapf32le",
             "-f", "rawvideo", "-y", output], output.with_suffix(".log"))
    return {"path": str(output), "format": "gbrapf32le", "gamut": gamut, "transfer": "linear",
            "normalization_nits": 10000, "width": 173 if operation == "cover" else target_width,
            "height": 173 if operation == "cover" else target_height, "filter": filters,
            "source_size": [source_width, source_height]}


def _cover_pq(source, output, width, height, gamut, source_primaries):
    """Keep the fractional source window instead of rounding an intermediate size."""
    padded = output.with_suffix('.padded.gbrapf32')
    primaries = {'rec2020': 9, 'p3': 12, 'srgb': 1}[gamut]
    filters = ('format=gbrap16le,pad=iw*3:ih*3:iw:ih:color=black@0,'
               'setparams=alpha_mode=premultiplied,format=gbrapf32le:alpha_modes=premultiplied,'
               f'zscale=agamma=0:transferin=16:primariesin={source_primaries}:matrixin=0:rangein=full:'
               f'transfer=linear:primaries={primaries}:matrix=0:range=full:npl=10000,'
               'format=gbrapf32le:alpha_modes=premultiplied')
    command(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vf', filters,
             '-frames:v', '1', '-pix_fmt', 'gbrapf32le', '-f', 'rawvideo', padded],
            output.with_suffix('.linearize.log'))
    data = padded.read_bytes()
    plane_size = 3*width * 3*height * 4
    if len(data) != 4*plane_size:
        raise ValueError('Native padded HDR float size disagrees with geometry')
    # Repack existing float planes without an alpha-removal pixel conversion.
    # swscale's alpha-drop path would quantize these linear samples to 16 bits.
    pixels, coverage = output.with_suffix('.pixels.raw'), output.with_suffix('.coverage.raw')
    pixels.write_bytes(data[:3*plane_size])
    coverage.write_bytes(data[3*plane_size:] * 3)
    numerator, denominator = output.with_suffix('.numerator.raw'), output.with_suffix('.denominator.raw')
    side = min(width, height)
    region = [width+(width-side)/2, height+(height-side)/2, side, side]
    for input_path, output_path in ((pixels, numerator), (coverage, denominator)):
        command(['hdr-proof-zimg-window', input_path, output_path, 3*width, 3*height,
                 173, 173, *region], output_path.with_suffix('.log'))
    inputs = []
    for path in (numerator, denominator):
        inputs += ['-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', '173x173', '-i', path]
    linear = output.with_suffix('.linear.gbrpf32')
    normalize = "[0:v][1:v]blend=all_expr='if(gt(B,0),max(A/B,0),0)'[out]"
    command(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex_threads', '1',
             '-filter_complex', normalize, '-map', '[out]', '-frames:v', '1',
             '-pix_fmt', 'gbrpf32le', '-f', 'rawvideo', linear], output.with_suffix('.normalize.log'))
    rgb = linear.read_bytes()
    if len(rgb) != 3*173*173*4:
        raise ValueError('Native normalized HDR float size disagrees with geometry')
    output.write_bytes(rgb + struct.pack('<f', 1.0) * (173*173))
    return {'path': str(output), 'format': 'gbrapf32le', 'gamut': gamut, 'transfer': 'linear',
            'normalization_nits': 10000, 'width': 173, 'height': 173,
            'filter': filters, 'normalization_filter': normalize, 'native_active_region': region,
            'source_size': [width, height]}


def read_linear(result):
    """Read native evidence for test-time measurements only."""
    values = np.fromfile(result["path"], dtype="<f4").reshape(4, result["height"], result["width"])
    return values[[2, 0, 1]].transpose(1, 2, 0).astype(np.float64) * result["normalization_nits"]
