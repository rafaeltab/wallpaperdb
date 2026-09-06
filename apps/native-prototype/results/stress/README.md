# Saved 4K renderer comparison

Open [index.html](index.html) locally in a browser. The standalone page includes
filters, per-run statistics, source provenance and plots retaining the maximum
observed interval in each 100 ms bin. It needs no server or network connection.
[summary.json](summary.json) contains the same records without plot arrays.

Start with [the final report](../../FINAL-REPORT.md) for interpretation and
[STRESS.md](../../STRESS.md) for methods and reproducible capture commands.
[verification.json](verification.json) records the native checks and twelve new
HDR results. [Library screenshot](library.png) and
[comparison screenshot](comparison.png) show the verified interfaces.

There are 180 captures in 18 studies, of which 179 are valid. CPU evidence is
independently gated: 174 valid captures have supported CPU statistics, one has
insufficient historical evidence and four deliberately disable CPU sampling.
An invalid image-loader lifecycle capture remains inspectable and is excluded
from aggregates. Source FPS, media render calls and compositor presentations
are separate measurements.

Raw JSON, CSV, traces and diagnostic files remain local under
`apps/native-prototype/verification/`, excluded from Git. The standalone plots
remain usable without those files; links to full raw evidence require them.
Generated 4K media also remains local and can be regenerated through Make.

To rebuild this exact publication from the retained raw files, run from the
repository root:

```sh
python3 - <<'PY'
import json, shlex, subprocess
from pathlib import Path
args = json.loads(Path('apps/native-prototype/results/stress/export-arguments.json').read_text())
subprocess.run(['make', 'native-stress-results', 'ARGS=' + shlex.join(args)], check=True)
PY
```

The supplemental verification record and screenshots are separate artifacts;
the comparison generator writes `index.html` and `summary.json`.
