"""Native SDR candidate, measured against the unchanged tone policy.

FFmpeg CPU tonemap preserves linear values below a declared Mobius knee.
The explicit luminance scale anchors 203-nit ordinary white near 0.90 sRGB.
A 10% linear exposure increase and knee 0.6 retain shadow/midtone contrast
within the existing 20% gate while keeping ordinary white in its existing
0.90 +/- 0.025 signal interval. A 0.99 output scale reserves rounding headroom
at the declared peak. These are candidate parameters, not threshold changes.
The native curve is documented at https://ffmpeg.org/ffmpeg-filters.html#tonemap.
No frame-adaptive exposure is used. This remains a proof candidate; selecting
BT.709 primaries alone does not qualify its chromatic mapping.
"""
from avif import native
from native_transfer import hlg_to_linear

WHITE_LINEAR = ((0.90 + 0.055) / 1.055) ** 2.4
NOMINAL_PEAK = 203 / (WHITE_LINEAR * 1.1)


def convert(source, output, transfer, gamut, *, peak_nits):
    transfer_name = {'pq': 'smpte2084', 'hlg': 'arib-std-b67'}[transfer]
    primaries = {'rec2020': 'bt2020', 'p3': 'smpte432'}[gamut]
    linearize = (f'zscale=transferin={transfer_name}:primariesin={primaries}:matrixin=gbr:rangein=full:'
                 f'transfer=linear:primaries={primaries}:matrix=gbr:range=full:npl={NOMINAL_PEAK}')
    if transfer == 'hlg':
        linearize = hlg_to_linear(gamut, NOMINAL_PEAK) + f',setparams=color_trc=linear:color_primaries={primaries}:colorspace=gbr:range=full'
    # zscale otherwise associates RGB with alpha in the nonlinear transfer
    # domain. Its premultiplied negotiation bypasses that implicit operation;
    # the stored samples remain straight at both transfer-only boundaries.
    start = 'format=gbrap16le,setparams=alpha_mode=premultiplied,'
    if transfer == 'hlg':
        start += 'format=gbrapf32le:alpha_modes=premultiplied,setparams=alpha_mode=straight,'
    linear_output = ('format=gbrapf32le:alpha_modes=straight,' if transfer == 'hlg' else
                     'format=gbrapf32le:alpha_modes=premultiplied,setparams=alpha_mode=straight,')
    filters = (
        start + linearize + ',' + linear_output +
        f'tonemap=mobius:param=0.6:desat=0:peak={peak_nits/NOMINAL_PEAK},'
        'colorchannelmixer=rr=0.99:gg=0.99:bb=0.99,'
        'setparams=alpha_mode=premultiplied,'
        'zscale=transfer=iec61966-2-1:primaries=bt709:matrix=gbr:range=full,'
        'format=gbrap16le:alpha_modes=premultiplied,setparams=alpha_mode=straight,'
        'format=rgba64be:alpha_modes=straight'
    )
    native(['ffmpeg','-v','error','-y','-i',source,'-vf',filters,'-frames:v','1',
            '-map_metadata','-1','-threads','1',output])
