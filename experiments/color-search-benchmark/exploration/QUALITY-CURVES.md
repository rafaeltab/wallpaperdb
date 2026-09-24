# Smooth quality influence

Prototype question: can the quality-influence slider emphasize close color
matches without making all weaker matches tie at zero?

## Controls and formulas

The [color inspector](http://zerotwo:8227/) offers **Smooth power** and
**Original linear penalty** under **Quality curve**, for every method and all
16/64/256/1,024 banks. The UI starts with power at influence 1. Existing API
clients default to linear unless they supply `qualityCurve: "power"`.

Let `q` be the wallpaper's conditional average quality for the selected bin,
`i` be quality influence, and `p` be the proportion quality penalty (default
0.35). Coverage and the explicit minimum-average-quality gate remain separate.

| Mode | Original linear | Smooth power |
| --- | --- | --- |
| Vibe | `max(0, 1 − i × (1 − q))` | `q^i` |
| Positive target percentage | `max(0, 1 − p × i × (1 − q))` | `(1 − p × (1 − q))^i` |

Influence 0 ignores quality, including when stored quality is zero. Influence 1
preserves existing scores in both modes. A target asking for 0% coverage ignores
quality at every influence, as before. Consensus applies the selected curve to
each component before blending its score.

At influence 3 in vibe mode, quality 60% contributes a factor of 0.216 under
power, versus zero under linear. Positive power does not create the linear
curve's implicit two-thirds threshold. Actual zero quality, zero area and an
explicit minimum-quality gate can still produce zero scores. Extremely small
scores are also subject to OpenSearch float32 precision.

The curve transforms a bin's measured average; it does not reweight individual
pixels or change which colors belong to a bin. The matching-color modal still
describes pixel membership. Search captions, inspected scores, component ledgers
and raw parameters retain the curve used by the executed search. Small nonzero
display values use scientific notation instead of rounding to an apparent zero.

## Execution

OpenSearch performs all filtering and global ranking. At influence 0 or 1,
power uses the existing native functions. Other influences use a constant-source,
parameterized Painless `Math.pow` quality factor inside `function_score`.
Coverage, threshold gates and component weights remain native functions.
The application does not retrieve candidates for reranking.

No image extraction, stored measurements, mappings or index receipts change.
Original runs retain their immutable query sources; the feedback adapter now
fingerprints the shared `quality-curve.mjs` helper too.

## Evaluation

Implementation is live. Integration passes **81 overlap tests and 34 cutoff
tests**, with zero skips. Browser checks pass all 48 method/bank/curve combinations,
including saved-query inspection after changing the controls, rapid live curve
changes, desktop/mobile layout and no browser errors.

`configs/quality-curves.json` compares 48 configurations at
influence 3: six methods × four counts × two curves. Cutoff methods use broad
0% pixel admission; old overlap methods retain their fixed 50% boundary. Each
curve pair has identical remaining parameters and the same complete 545-asset
corpus. These are the existing single-observer development judgments; no new
human relevance labels are inferred. The
[completed feedback report](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html)
has 31 supported and six unsupported cases for every configuration, with no
query errors. All **4,464 timed requests** passed; candidate p95 ranges from
**1.27 to 20.60 ms**, and the slowest timed request was 56.25 ms. These timings
apply to the 545-asset corpus, not one million records.

At influence 3, power improves overall and real-image-only judgment agreement
in all 24 paired comparisons. This is an aggregate improvement: individual
cases still regress. It does not show that influence 3 is better than 1, nor
that one bank or admission profile is best. Most gains come from vibe queries;
percentage-query changes are smaller and sometimes negative.

The zero-score symptom also improves directly: across 135 judged query-image
observations per configuration, exact zeros fall from 26–46 under linear to
0–7 under power. Exact score ties on the 233 assessed preference pairs fall
from 20–66 to 0–6. None of the tested power configurations produces an entirely
zero-scored result set. These counts describe this sweep's queries and settings;
they do not imply that valid zero scores are impossible.

For example, with 1,024 bins, real-image-only agreement changes as follows:

| Method | Linear at 3 | Power at 3 |
| --- | ---: | ---: |
| Original dense regions | 67.22% | 71.79% |
| Original named + picked colors | 68.33% | 74.44% |
| Hard cutoff, 0% admission | 52.72% | 65.06% |
| Feathered cutoff, 0% admission | 60.74% | 69.88% |
| Full core/soft halo, 0% admission | 56.73% | 68.02% |
| Multiple cutoffs, starting at 0% | 64.75% | 69.26% |

The comparisons reuse correlated judgments and images from one observer.
Archive images remain unjudged; pairwise agreement cannot penalize every
irrelevant unjudged result. Treat this as evidence that removing the severe
linear clamp helps these development cases, not population-level validation.

The separate [scale comparison](QUALITY-CURVE-SCALE.md) reuses only the retained
180-field million-record projection. It compares one-color vibe and unfiltered
five-color proportions in separate concurrency blocks. This is query cost
evidence, not full-schema capacity or sustained production throughput.

That scale run completed all **32 profiles**, covering 512 timed requests and
16 warmups, with zero failures or responses at or above one second. The maximum
timed request was **445.63 ms**. Power was slower than linear in these comparisons.
Only hard/feather membership, 256/1,024 bins, 0% pixel cutoff, influence 3 and
concurrency 1/4 were measured. Other profiles, higher concurrency, sustained
traffic and the complete field schema remain outside this scale claim.

A final live API replay of the reported symptom—red, hard cutoff 0%, 16 bins,
influence 3 and minimum quality 0%—returns **99 exact zero scores among the top
100 for linear, and zero for power**. The full requests and scores are saved in
`final-api-comparison.json` with the inspector artifacts.

External artifacts under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`:

- `runs/2026-09-21T19-57-25.162Z-4756a400/`: feedback, immutable sources and compact
  `quality-curve-analysis.json` / `quality-curve-findings.json`.
- `exploration/quality-curves/2026-09-21/`: integration logs, browser matrix,
  saved browser script and desktop/mobile screenshots.
- `exploration/quality-curve-scale/2026-09-21T20-04-25.158Z/`: separate projected
  scale campaign, raw requests and source snapshots.

```sh
make color-overlap-integration
make color-cutoff-integration
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/quality-curves.json'
make color-overlap-inspector
```
