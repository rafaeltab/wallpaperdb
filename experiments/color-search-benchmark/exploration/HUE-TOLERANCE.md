# Hue tolerance: pagoda versus orange sky

2026-09-21. Diagnosis, implementation and evaluation complete. The separately indexed `cutoff-shade-hue-all-levels` prototype is available alongside the existing method at http://zerotwo:8227/.

**Result:** the new method fixes the reported pagoda/sky preference in all 24 tested settings, versus 4/24 for the existing method. Historical real-image agreement improves in 9 settings and declines in 15, so this is an option to explore, not a general accuracy winner. The canonical default improves historical real-image agreement from 70.86% to 72.47%.

## User preference and clarification

For a red query, the user prefers the red pagoda/moon scene over the orange/yellow sky. The clarification is **hue has to be more similar to count**: stricter hue matching, while retaining useful tolerance for darker reds. This supplies one strict preference pair. It does not supply color-area percentages or justify additional inferred preferences.

Both attachments are existing corpus assets, identified by image comparison and confirmed visually:

- Preferred: `madness-wallhaven-ogg7ql`, source `corpus/wallpapermadness/wallhaven-ogg7ql.png`. Attachment/source normalized 64×64 RGB pixels match exactly (RMSE 0).
- Other: `wallpaper-031`, source `corpus/wallpaper-031.jpg`. Source RMSE 1.26/255; the next unrelated candidates exceed 59/255.

## Reproduced ordering

Baseline method `cutoff-shade-all-levels`, picked `#FF0000`, vibe mode, smooth-power quality, minimum average quality 0. Every search ranks all 523 real wallpapers in OpenSearch. The following ranks are identical across 16, 64, 256 and 1,024 bins because #FF0000 is an exact shared anchor. This does not establish bank parity for other precise colors.

| Quality influence | Cutoff weighting | Pagoda rank | Orange sky rank | Desired pair passes |
|---:|---:|---:|---:|---|
| 1 | 0 | 91 | 52 | No |
| 1 | 3 | 101 | 61 | No |
| 1 | 6 | 95 | 81 | No |
| 3 | 0 | 108 | 60 | No |
| 3 | 3 | 100 | 80 | No |
| 3 | 6 | 83 | 92 | Yes |

The user reported display ranks 93 and 61. Exact original controls were not captured, so those exact ranks are not claimed as reproduced. The undesired ordering is reproduced in twenty of twenty-four tested configurations. Increasing quality influence reverses the pair only at the strongest tested cutoff weighting.

## Indexed component evidence

| Quality cutoff | Pagoda area | Pagoda mean quality | Orange sky area | Orange sky mean quality |
|---:|---:|---:|---:|---:|
| 0% | 44.93% | 20.45% | 39.23% | 30.25% |
| 25% | 13.84% | 35.65% | 23.35% | 41.62% |
| 50% | 0.99% | 57.83% | 5.68% | 56.53% |
| 75% | 0.02% | 75.79% | 0% | 0% |
| 90% | 0% | 0% | 0% | 0% |

These are baseline metric measurements, not human red-area labels. The nested areas overlap. The orange sky receives more medium-quality area, while the pagoda retains a tiny 75% component that the sky lacks. At influence 1/weighting 3, final scores are 0.021471864 versus 0.033415463, opposite to the user's preference. Subsequent pixel-level probes selected a stricter hue gate while retaining the existing shade-aware lightness handling.

## Failing regression assertion

```sh
make color-shade-pair-replay COLOR_SHADE_ARGS='--preferred-id madness-wallhaven-ogg7ql --other-id wallpaper-031 --assert-preference --output-directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/shade-pair/2026-09-21/baseline'
```

The script exits **1** and Make exits **2** because **20/24** configurations fail `pagoda.score > sky.score`. This is the expected failing preference assertion, not a service error. All 24 full-corpus searches and 48 document inspections complete, return the required real corpus and agree on search/ledger scores. Tied scores also fail this strict preference assertion.

The helper accepts alternate methods, banks, blend values, quality influences, quality curves and a picked color for later paired replay. Its default matrix is all four banks × influence 1/3 × weighting 0/3/6. This reproduction is diagnostic, not a latency benchmark or a general accuracy result.

## Saved evidence

External root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/shade-pair/2026-09-21/`.

- `pagoda-identification/identification.json` and `orange-sky-identification/identification.json`: attachment/source hashes, source filenames and nearest-image comparisons.
- `baseline.log`: assertion output and expected failure.
- `baseline/pair-replay.json`: explicit preference, every returned ID/score, exact settings, selected region and each component's OpenSearch score contribution.
- `baseline/sources.json`: immutable source snapshot for this replay.
- `baseline/bank-parity.json`: complete ordered hits agree across all four banks.
- `OBSERVATIONS.md`: standalone identification/reproduction checkpoint.

Existing extraction definitions, query formulas and indexes remain available unchanged. The original 37 feedback cases remain a stable reference; the new user preference is explicitly opted into and reported separately below.

## Candidate measurement

The candidate keeps the existing shade-aware distance, visibility handling and anchors, then multiplies its pixel quality by a hue factor. For a strongly chromatic target, circular hue separation in OKLab receives full weight through 10°, fades smoothly between 10° and 30°, and reaches zero at 30°. This is perceptual OKLab hue angle, not the HSL hue displayed on the modal axes.

```text
t = clamp((30° - hue separation) / 20°, 0, 1)
hue factor = t² × (3 - 2t)
new pixel quality = previous shade-aware quality × hue factor
```

The target's existing chromatic-strength transition blends this factor toward 1 for near-neutral anchors; exact neutral anchors keep their original behavior. Undefined source hue receives no hue credit for strongly chromatic targets. The 0% cutoff also requires a positive hue factor, so a distant hue with quality zero does not enter through the lowest layer. The exact guard and boundary rules are recorded in `hue-definition.mjs`.

Coverage and conditional quality are recomputed offline in separate indexes. OpenSearch uses the same five-component all-cutoff scoring formula, the same weighting and quality controls, and globally ranks the results. This changes measured color similarity; it does not add per-candidate hue calculations inside the application.

## Completed paired evaluation

`configs/hue-aware.json` compares `cutoff-shade-hue-all-levels` with the current `cutoff-shade-all-levels` at four banks, weighting 0/3/6 and smooth-power quality influence 1/3. Minimum average quality is 0, with concrete swatches for named colors. Those 24 paired settings produce 48 configurations; the new method's canonical no-parameter default adds one more.

The primary run explicitly opts into `perceived-red-pagoda-001`, giving 38 total cases: 32 supported and six explicitly unsupported. Analysis reports the historical 31 supported cases and 27 real-image cases separately from the new pair. This newly selected failure example helped motivate the candidate, so passing it is development progress, not held-out validation. The recorded case flags `#FF0000` as inferred from the ongoing red query; no new human area labels were added.

The separate `hue-evaluate.mjs` helper preserves the previous shade experiment's analyzer. It checks exact paired parameters, raw timing accounting, source provenance, supported-case parity, missing judgments and eligibility violations. Replay compares all four images—the pagoda, orange sky and both earlier red portraits—across all 48 parameterized configurations, preserving all 523 real result IDs and OpenSearch's component ledgers. It reports both the desired pair and score changes for the earlier portraits without inventing a ranking between those portraits.

A separate two-candidate run, `configs/hue-defaults-legacy.json`, evaluates both canonical defaults without the added case. This keeps consolidated default comparisons on the original 37-case dataset and checks that its complete historical statuses, ordered IDs and scores match the historical subset of the primary run. Its 186 timed requests are reported separately from the primary run's 4,704.

Reproduction commands:

```sh
make color-hue-evaluate COLOR_HUE_ARGS='--dry-run'
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/hue-aware.json --extra-cases evaluation/perceived-red-pagoda-001.json'
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/hue-defaults-legacy.json'
make color-hue-evaluate COLOR_HUE_ARGS='--replay'
make color-hue-evaluate COLOR_HUE_ARGS='--analyze /absolute/path/to/main/run --legacy /absolute/path/to/canonical/run'
make color-shade-pair-replay COLOR_SHADE_ARGS='--method cutoff-shade-hue-all-levels --preferred-id madness-wallhaven-ogg7ql --other-id wallpaper-031 --assert-preference'
```

The feedback workload remains top 20, one warmup, three timed repeats and concurrency 1, with an accuracy window of 1,000 on all 545 assets. This is a small-corpus comparison; no million-record capacity or high-concurrency claim will be inferred.

## Accuracy and remaining regressions

| Evaluation slice | New method improves | New method declines |
|---|---:|---:|
| Historical 31 supported cases, 233 assessed pairs | 8/24 settings | 16/24 |
| Historical 27 real-image cases, 183 assessed pairs | 9/24 | 15/24 |
| All 32 supported cases, including the selected new pair | 21/24 | 3/24 |

The added pair materially changes the apparent aggregate result; use the historical slices when assessing broader improvement. Historical real-image changes range from −2.47 to +1.60 percentage points. Each configuration regresses on two to six historical cases. Excluding uncertain real-image judgments gives eight improvements, fifteen declines and one tie.

At 1,024 bins, influence 1 and weighting 0 (equivalent to the canonical default):

| Agreement | Existing shade-aware | Stricter hue |
|---|---:|---:|
| Historical supported cases | 70.11% | 71.29% |
| Historical real-image cases | 70.86% | 72.47% |
| Historical real-image cases excluding uncertain judgments | 69.88% | 71.73% |
| All supported cases including the new pair | 67.92% | 72.19% |

Four historical cases improve and four regress at this setting. Improvements include orange, real green proportion and blue/orange composition judgments. Regressions are `perceived-red-001` (93.33% → 86.67%), `proportion-green-001` (93.33% → 80%), `perceived-pink-batch-001` (66.67% → 50%) and `perceived-blue-batch-001` (100% → 83.33%). The original red leaf/sky error remains, and the muted roses now also rank below that sky; the bright red street still correctly outranks the muted roses.

Across the matrix, frequent regressions include the controlled green-proportion case (22 settings), pink (19), and precise muted green (17). The improvement on the reported pair does not establish precise-swatch accuracy. Full per-case changes and disputed pairs are retained in `hue-findings.json`.

## Actual wallpaper replay

The replay performs 48 searches and 192 document inspections, retaining all 523 real hits and matching OpenSearch's score ledgers. The following influence-1 ranks are identical across the four banks for the shared exact-red anchor. Each cell is **existing → stricter hue**.

| Wallpaper | Weighting 0 | Weighting 3 | Weighting 6 |
|---|---:|---:|---:|
| Pagoda, `madness-wallhaven-ogg7ql` | 91 → 81 | 101 → 92 | 95 → 87 |
| Orange sky, `wallpaper-031` | 52 → 112 | 61 → 121 | 81 → 135 |
| Earlier dark-red portrait, `madness-wallhaven-gww23l` | 8 → 7 | 10 → 10 | 14 → 14 |
| Earlier soft-red portrait, `madness-wallhaven-9oov2d` | 9 → 8 | 24 → 20 | 38 → 38 |

At influence 1/weighting 0, pagoda score falls from 0.06758403 to 0.065260366 (−3.44%); sky score falls from 0.10506007 to 0.04346238 (−58.63%). The pagoda rises because competing orange scenes lose more credit. Neither earlier portrait suffers a rank regression anywhere in the 24-setting replay. Their scores are not unchanged: dark-red portrait changes range from +0.00010% to +0.18864%, and soft-red portrait changes range from −0.19264% to +1.24959%. Removing low-quality admitted pixels can raise conditional average quality enough to increase the final score, even though individual pixel quality never increases.

The strict preference assertion completes 24 searches and 48 inspections and passes **24/24**, including influence 1. It exits successfully using the new method with the same command structure as the failing baseline assertion above.

## Timing, validation and provenance

- Primary [49-configuration report](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html): **4,704 timed requests**, zero errors, zero requests reaching one second. Candidate p95 values span **2.01–7.11 ms**; worst single request **55.47 ms**.
- Separate [two-default historical report](http://zerotwo:8224/2026-09-21T23-14-33.424Z-046c06d3/report.html): **186 timed requests**, zero errors. Existing/new p95 values **4.83/4.89 ms**, maxima **5.92/6.16 ms**. Historical statuses, ordered IDs and scores exactly match the corresponding primary-run subsets.
- All configurations have zero missing supported judgments and zero eligibility violations. Six unsupported cases remain explicit. The primary workload uses 545 assets, while visual replays exclude the 22 controlled fixtures. These timings establish only small-corpus behavior at concurrency 1; million-wallpaper and concurrent-user performance remain untested.
- All four new indexes contain 545 verified assets. Across banks, **2,790,400 coverage values never increase** and **87,200 neutral values remain exactly unchanged**. Index identity: `334de5f444ac67fb606b`; index names are `color-exploration-shade-hue-{16,64,256,1024}-real-v1`.
- Real integration checks pass: hue **14**, cutoff regression **43**, shade **15**, with zero skips. Feedback tests pass **49/49**. Browser QA records **25 checks, 36 API requests and zero errors**, covering all banks/layers, saved versus live settings, hue credit, tiny nonmatches, existing methods and mobile.
- An initial primary run (`2026-09-21T23-04-54.211Z-070d8d5c`) failed the added case's query normalization. Its evidence is preserved and excluded from these results. The case schema was corrected and a real feedback-query boundary regression added before the successful rerun; metric/index data did not change.
- Both successful timing runs share source snapshot SHA-256 `8c4a14310ac168211860c4e2f4cb25c4b39426eb92b19efb4ae17a6f2c3d195a`. Analysis verifies 39 distinct query modules across all 49 configurations. A postprocessing-only assertion was corrected to recognize the runner's expansion of omitted parameters to `{}`; the final analyzer is archived separately. After measurement/replay completed, UI metadata wording was clarified to distinguish fully chromatic from near-neutral anchors; scoring was unchanged.

External evidence root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`.

- `runs/2026-09-21T23-11-56.676Z-ea2526a6/{run.json,hue-findings.json,legacy-default-parity.json}`: primary results, case regressions, timings, provenance and canonical parity.
- `runs/2026-09-21T23-14-33.424Z-046c06d3/`: separate canonical historical results.
- `exploration/hue-aware/2026-09-21/`: successful/failed feedback logs, separate legacy log, replay and assertion logs, analysis log and final `analysis-source.mjs`.
- `exploration/hue-aware/2026-09-21/replay/{rank-matrix.json,pair-summary.json,sources.json}`: four-image scores, full ordered hits, component ledgers and source snapshot.
- `exploration/hue-aware/2026-09-21/preference-assertion/pair-replay.json`: successful strict preference regression.
- `exploration/hues/334de5f444ac67fb606b/`: extraction/index verification receipts; `exploration/hues/current.json` records the current definition.
- `exploration/shade-pair/2026-09-21/hue-browser-qa.json`: browser checks and screenshots.

All wallpapers, attachments, generated index artifacts and benchmark runs remain outside the worktree.
