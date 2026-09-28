"""BT.2100 HLG display transforms executed by native FFmpeg float filters.

zimg's HLG transfer uses a per-channel gamma approximation. Our fixtures declare
1000-nit display light and a luminance-coupled system gamma of 1.2. FFmpeg geq
executes that transform here; the separate NumPy fixture/oracle validates it.
Alpha remains straight and unchanged during either transfer operation.
"""
LUMA = {
    'rec2020': (0.2627002120112671, 0.6779980715188708, 0.0593017164698620),
    'p3': (0.2289745640697488, 0.6917385218365064, 0.0792869140937450),
}


def geq(expressions):
    return 'geq=' + ':'.join(f"{channel}='{value}'" for channel, value in zip('rgb', expressions)) + ":a='alpha(X,Y)'"


def luminance(gamut):
    return '+'.join(f'{coefficient}*{channel}(X,Y)' for coefficient, channel in zip(LUMA[gamut], 'rgb'))


def hlg_to_linear(gamut, normalization_nits):
    inverse = [f'if(lte({c}(X,Y),0.5),{c}(X,Y)*{c}(X,Y)/3,(exp(({c}(X,Y)-0.55991073)/0.17883277)+0.28466892)/12)' for c in 'rgb']
    ootf = [f'{c}(X,Y)*pow(max({luminance(gamut)},0),0.2)*{1000/normalization_nits}' for c in 'rgb']
    return geq(inverse) + ',' + geq(ootf)


def linear_to_hlg(gamut, normalization_nits):
    scale = normalization_nits / 1000
    scene = [f'{c}(X,Y)*{scale}/pow(max(({luminance(gamut)})*{scale},1e-30),1/6)' for c in 'rgb']
    oetf = [f'if(lte({c}(X,Y),1/12),sqrt(max(3*{c}(X,Y),0)),0.17883277*log(max(12*{c}(X,Y)-0.28466892,1e-30))+0.55991073)' for c in 'rgb']
    return geq(scene) + ',' + geq(oetf)
