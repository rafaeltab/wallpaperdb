# Pixel cutoff experiments

Throwaway prototypes, added September 21, 2026. Question: does changing the sharp
pixel membership boundary improve perceived color search, while retaining native
OpenSearch ranking?

Follow-up: [All cutoff levels with adjustable weights](ALL-CUTOFFS.md) adds a
separate version using all five levels and an equal-to-exponential weighting slider.

## Try them

The [overlapping color inspector](http://zerotwo:8227/) keeps the original dense
and hybrid methods. Four additional methods work with **16, 64, 256 and 1,024
buckets**. Choose a method, a pixel cutoff and a bucket count, then search or use
live updates. Open a wallpaper to inspect its measurements and scoring terms;
click a bin to inspect its color range in the separate hue/lightness or
hue/saturation modal.

All 545 evaluation assets are measured: 523 real wallpapers and 22 controlled
fixtures. The visual gallery excludes the fixtures inside the OpenSearch query.
Images, extracted measurements and run artifacts live in the shared external
store, not Git.

Measurements use the baseline's same 128×128 image sampling and alpha handling.
The hard 50% measurements match the original exactly for all 545 assets and
every original anchor.

## Membership profiles

Every profile uses the same anchors and the same reference quality scale:

`q = max(0, 1 − OKLabDistance(pixel, anchor) / 0.24)`

The selectable cutoff levels are **0%, 25%, 50%, 75% and 90%**. Their outer
distances are respectively **0.24, 0.18, 0.12, 0.06 and 0.024** in OKLab. These
percentages describe this reference scale; they are not percentages of RGB or
hue. Even 0% has a finite outer boundary.

| Method | Pixel area weight inside the outer boundary |
| --- | --- |
| Hard cutoff | 1; falls immediately to 0 outside |
| Feathered cutoff | `(q − cutoff) / (1 − cutoff)`, clamped to 0…1 |
| Full core, soft halo | Twice the feathered weight, clamped to 0…1 |
| Multiple cutoffs | Scores the selected hard cutoff and the next two stricter levels independently, then blends their scores with weights 20%, 30%, 50% |

The core/halo profile gives full weight to the inner half of the support radius.
Consensus combines repeated strictest levels: at 75%, its components are 20%
at cutoff 75 and 80% at cutoff 90; at 90%, it becomes the single hard90 score.
It remains a stepped mixture, not continuous interpolation.

For each anchor × stored kernel × level, extraction stores:

- `cov_*`: `round(mean(pixelWeight) × 10000)`, integer basis points.
- `quality_*`: the weighted mean reference quality, as float32; zero for no
  weighted pixels.

This is **30 numeric fields per anchor**: three kernels × five levels × coverage
and quality. The 1,024-bank therefore has 30,720 region fields, plus shared named
features and metadata. Consensus reuses hard-cutoff fields.

Hard coverage is physical image area. Feather/core-halo coverage is **effective
area**: a pixel at half weight counts as half its area. Consequently a request
for 40% means 40% effective coverage for those profiles. Physical area inside the
outer support is shown separately. Consensus reports weighted summaries but
scores each component separately; feeding summary coverage/quality into one
formula would produce a different result.

## Scoring and controls

The existing coverage/quality objective is retained per component. In vibe mode
with default controls:

`componentScore = sqrt(coverage) × conditionalQuality`

For proportions:

`areaFactor = max(0, 1 − abs(coverage − requested) × excessMultiplier)`

`componentScore = areaFactor × max(0, 1 − 0.35 × (1 − conditionalQuality))`

The excess multiplier defaults to 1.5 above the requested amount and 1 below it.
Quality influence scales the quality penalty. Minimum average quality gates
each component independently; failing one contributes 0 without changing the
target denominator. Targets requesting 0% ignore quality. Final scores average
targets, blending components within each target if applicable.

**Pixel cutoff** changes which pixels enter the offline measurement.
**Minimum average quality** gates the wallpaper's resulting average. These
controls operate at different stages.

### Why the original linear curve can produce zero scores

The original linear curve scales a **linear quality penalty**:

`qualityFactor = max(0, 1 − strength × (1 − conditionalQuality))`

In vibe mode, `strength = qualityInfluence`. At influence 3, this becomes
`max(0, 3 × quality − 2)`, so average qualities at or below two-thirds contribute
exactly zero, even with minimum average quality set to 0%. This is an implicit
cutoff in the current formula. Broad pixel admission can include many weaker
matches and lower their conditional average. Consensus applies the same clamp
to each cutoff component independently.

Proportions mode uses `strength = qualityPenalty × qualityInfluence`; with the
default penalty 0.35 and influence 3, its implicit threshold is only 4.76%.
Zero-amount targets ignore quality. The UI also rounds displayed scores to five
decimal places, but the clamp creates real OpenSearch zeros.

Live diagnosis reproduced 99 exact zeros among the top 100 red results using
hard cutoff 0%, 16 bins and influence 3. A wallpaper with 58.92% coverage and
44.66% mean quality scored 0.34279865 at influence 1 and exactly 0 at influence 3;
its separate minimum-quality gate passed both times. Evidence is stored under
the shared store at `exploration/cutoff-inspector/quality-influence-2026-09-21.json`.
That diagnosis did not change the formula. The subsequently authorized
[smooth power comparison](QUALITY-CURVES.md) adds a separate selectable curve
and preserves the original linear option.

Picked colors resolve to their nearest anchor. In concrete-swatches mode,
concrete names such as red use anchors too. Named-families mode retains the old
broad named measurements. Abstract vibes such as dark and grayscale retain
their old definitions in both modes; the new pixel controls do not change them.

All sorting/filtering is native OpenSearch `function_score`, numeric fields,
range predicates and decay functions. The application compiles queries and
renders results. A one-document Painless ledger explains a selected wallpaper;
it is not a search reranker. Unsupported explicit ranges are rejected.

## Why effective coverage?

Reducing pixel quality to 0 at the edge while keeping binary coverage does not
make the existing objective continuous. For example,
`sqrt(coverage) × meanQuality = qualityMass / sqrt(coverage)` still changes when
binary coverage jumps. Feathering admission itself makes both effective area
and quality mass approach 0 at the boundary, apart from storage quantization.

This does not eliminate nearest-anchor jumps, minimum-average-quality gates or
all quantization effects. The original hard50 measurement is checked against
the old extraction exactly; its rankings should remain a control.

## Evaluation record

- Matrix: `configs/cutoff-profiles.json`: 160 new configurations (four profiles
  × five levels × four counts × two named modes) and eight original controls.
- Every candidate runs through the existing feedback loop and real OpenSearch.
- Judgments are quick development preferences from one observer. They are not
  representative population labels, and the archive wallpapers are unjudged.
- Small-corpus timing cannot establish latency at one million wallpapers.
- Large-scale query experiments must distinguish their projected query fields
  from the full 30,720-field storage model. No production scalability conclusion
  follows from a projection alone.

Implementation/run status and artifacts are recorded in `PLAN.md` and
`GLOBAL-WORKLOG.md` as they complete. No winner has been selected.

The [complete sweep report](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html)
contains all 168 configurations. Each supports the same 31 of 37 cases, with
six unsupported cases and no query errors. Across 26,040 timed requests there
were no failures or eligibility violations. Candidate p95 latency ranges from
1.015 to 6.245 ms; the slowest measured request was 55.137 ms. These timings
apply to 20-result searches on 545 documents; the separate accuracy retrievals
use a larger result window and are outside those timing samples.

The initial HTML export exceeded JavaScript's string-size limit after all
measurements were saved. Report rendering now caps inline diagnostic payloads
and links to the unchanged raw run artifact. Reports were rebuilt without
rerunning searches; all 46 evaluation-loop regression tests pass. The run's
`render-recovery.json` records the later renderer fingerprint.

[Evaluation analysis](CUTOFF-EVALUATION-REVIEW.md) separates cutoff-sensitive
cases and real-image cases from unchanged named features and controlled fixtures.
[The scale experiment](CUTOFF-SCALE.md) separately records query performance on
100,000 and one million synthetic mixtures, with the reduced-field limitation
kept explicit.

At one million records, all hard/feather/core-halo variants passed the mixed
workload, while every consensus variant failed at some tested load. A separate
unfiltered five-color test found further limits: all six non-consensus variants
passed at four concurrent requests, but only feather256 and core-halo1024 passed
at sixteen. Both tested consensus variants failed even without concurrency.
These short tests use only 180 queried numeric fields. They do not establish
full-schema capacity or sustained production throughput.

The four canonical defaults also completed in
[their own report](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html),
with 620 timed requests and no errors. The existing method comparison now exposes
51 methods; its findings page includes all 212 saved sensitivity configurations.

### Indexing observation

All four real-corpus indexes contain 545 documents, with every field checked
against immutable extraction artifacts. Final size after one segment per index:

| Buckets | Region numeric fields | Index bytes, including stored source |
| ---: | ---: | ---: |
| 16 | 480 | 4,738,814 |
| 64 | 1,920 | 19,166,022 |
| 256 | 7,680 | 77,541,326 |
| 1,024 | 30,720 | 308,353,490 |

The shared prototype node retained its 2 GiB heap and 4 GiB container limit.
Building the 1,024-bank tripped the parent circuit breaker during bulk indexing.
Flushing this new index freed heap; recovery checked 350 existing documents and
added the remaining 195 using one-document batches with a flush every 25.
Compacting its 12 segments to one reduced store size from 442,090,526 bytes to
308,353,490 bytes. Existing indexes were not modified. This is a real ingestion
cost of the large field count, even with this small corpus.

The frozen initial builder retains its larger batch size. If that build fails
with the same memory breaker, `make color-cutoff-resume` safely validates existing
documents and adds only missing measurements; it does not overwrite them.

## Commands

```sh
make color-cutoff-index
make color-cutoff-index COLOR_CUTOFF_ARGS='--verify'
make color-cutoff-test
make color-cutoff-integration
make color-cutoff-smoke
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/cutoff-profiles.json'
make color-overlap-inspector
```
