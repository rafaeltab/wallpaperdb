"""Native tone-map controls; parameter trials cannot relax the declared gates."""
from pathlib import Path
import numpy as np
from appearance import evaluate_sdr_tone_map
from avif import convert_frame, decode_transfer, digest, native, read_png, inspect_avif


def run(root):
    root = Path(root)
    output = root/'tone-controls'
    output.mkdir(exist_ok=True)
    records = []
    for transfer in ('pq','hlg'):
        folder = root/'avif'/f'avif-{transfer}-rec2020-10-opaque'
        source = folder/'decoded-0.png'
        source_facts = inspect_avif(folder/f'avif-{transfer}-rec2020-10-opaque.avif')
        source_signal = read_png(source)
        source_nits = decode_transfer(source_signal[..., :3], transfer, 'rec2020')
        # Maintained tunable alternatives, fixed here before their first run.
        for name, mapper in (('bt2446a','bt.2446a'), ('mobius030','mobius:tonemapping_param=0.3'), ('reinhard050','reinhard:tonemapping_param=0.5')):
            row = {'source': str(source), 'source_facts': source_facts, 'algorithm': mapper, 'status':'tested and failed'}
            try:
                files = [output/f'{transfer}-{name}-{repeat}.png' for repeat in range(2)]
                for file in files:
                    convert_frame(source,file,transfer,'rec2020','identity',sdr=True,mapper=mapper)
                signals = [read_png(file) for file in files]
                row['measurement'] = evaluate_sdr_tone_map(source_nits, signals[0][..., :3], source_gamut='rec2020')
                row['repeat_identical_pixels'] = bool(np.array_equal(*signals))
                row['sha256'] = [digest(file) for file in files]
                row['artifacts'] = [str(file) for file in files]
            except Exception as error:
                row['error'] = str(error)
            records.append(row)
    folder = root/'avif'/'animated-pq-alpha'
    for adaptive in (False, True):
        whites, hashes = [], []
        for index in (0,1,0):
            file = output/f'animated-adaptive-{adaptive}-frame-{index}.png'
            convert_frame(folder/f'decoded-{index}.png',file,'pq','rec2020','identity',sdr=True,
                          mapper='bt.2446a'+(':peak_detect=1' if adaptive else ''))
            image = read_png(file)
            # Top rows have alpha=1 and the final ramp value before highlights is203.
            whites.append(float(np.mean(image[8:24,47,:3])))
            hashes.append(digest(file))
        records.append({'algorithm':'bt.2446a','adaptive_peak_detection':adaptive,
                        'ordinary_white_frame_0_frame_1_repeat':whites,
                        'maximum_frame_white_shift':max(whites)-min(whites),
                        'repeat_exact_bytes':hashes[0]==hashes[2],
                        'scope':'Each frame is processed independently, as in this candidate pipeline. This does not qualify persistent temporal filter history.',
                        'status':'tested and failed','blocker':'The shared tone/gamut policy remains unqualified.'})
    return records
