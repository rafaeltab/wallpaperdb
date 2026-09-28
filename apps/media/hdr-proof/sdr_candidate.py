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

WHITE_LINEAR = ((0.90 + 0.055) / 1.055) ** 2.4
NOMINAL_PEAK = 203 / (WHITE_LINEAR * 1.1)


def convert(source, output, transfer, gamut, *, peak_nits):
    if transfer != 'pq':
        raise ValueError('This SDR candidate currently supports PQ only')
    primaries = {'rec2020': 'bt2020', 'p3': 'smpte432'}[gamut]
    filters = (
        'format=gbrapf32le,'
        f'zscale=transferin=smpte2084:primariesin={primaries}:matrixin=gbr:rangein=full:'
        f'transfer=linear:primaries={primaries}:matrix=gbr:range=full:npl={NOMINAL_PEAK},'
        f'tonemap=mobius:param=0.6:desat=0:peak={peak_nits/NOMINAL_PEAK},'
        'colorchannelmixer=rr=0.99:gg=0.99:bb=0.99,'
        'zscale=transfer=iec61966-2-1:primaries=bt709:matrix=gbr:range=full,'
        'format=rgba64be'
    )
    native(['ffmpeg','-v','error','-y','-i',source,'-vf',filters,'-frames:v','1',
            '-map_metadata','-1','-threads','1',output])
