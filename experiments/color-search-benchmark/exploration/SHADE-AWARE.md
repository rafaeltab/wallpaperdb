# Shade-aware all-cutoff experiment

2026-09-21. Measurement, indexing, paired feedback and diagnostic replay are complete. The new method is available as **All cutoffs: shade-aware** in [the inspector](http://zerotwo:8227/), alongside the original method.

## Question

Can a color measurement that tolerates shading better preserve a red impression in dark saturated red and softer red backgrounds, while retaining the same OpenSearch scoring mechanics and user controls?

The [dark-red diagnosis](DARK-RED-DIAGNOSIS.md) identified two existing corpus images: `madness-wallhaven-gww23l` and `madness-wallhaven-9oov2d`. Both should inform the experiment. The user has not assigned an exact order between them or compared them with every result. No new preference pairs are inferred from the report.

The original `cutoff-all-levels` method remains the control. The new `cutoff-shade-all-levels` method reads independently measured coverage and conditional quality from new indexes. Both use the same all-cutoff weights and ranking formula; OpenSearch globally filters and ranks candidates. The original indexes and previous immutable evaluation runs are retained.

## Measured similarity

The measurement uses the same OKLab anchors and the same five quality cutoffs. For strongly chromatic anchors, it reduces the lightness-difference weight to 0.25 and blends ordinary chromatic difference equally with a partially shade-normalized difference:

```text
ordinary chromatic difference = (pixel.a - anchor.a, pixel.b - anchor.b)
normalized difference = anchor.L × (pixel.a / pixel.L - anchor.a / anchor.L,
                                    pixel.b / pixel.L - anchor.b / anchor.L)
distance² = (0.25 × lightness difference)²
          + 0.5 × |ordinary chromatic difference|²
          + 0.5 × |normalized difference|²
quality = visibility × max(0, 1 - distance / 0.24)
```

Division uses a small positive floor. Smooth transitions based on the anchor's chroma/lightness ratio preserve the original Euclidean distance for neutral anchors and interpolate toward the chromatic formula. A smooth visibility guard reduces credit for almost-black source colors relative to the target; an anchor still matches itself fully. These fixed choices are experimental, not human-calibrated perception parameters. The exact definition and boundary rules are in `shade-definition.mjs`.

Each hard cutoff admits pixels whose adjusted quality reaches that level. The 0% layer additionally requires finite distance support and nonzero visibility; zero quality does not cause arbitrary distant colors to count. Coverage remains physical admitted image area, and conditional quality is the mean adjusted quality among those pixels. All five layers overlap. Their scores are combined using the existing weighting slider; their coverages must not be added as if disjoint.

This similarity is directional: the target anchor controls the normalization. Picked colors still choose their nearest original anchor. Dark/grayscale named utilities are unchanged, and exact neutral anchors preserve their original geometry.

## Preregistered comparison

`configs/shade-aware.json` pairs the two methods at every combination of:

- 16, 64, 256 and 1,024 bins.
- Cutoff weighting 0, 3 and 6.
- Quality influence 1 and 3, using smooth power.
- Minimum average quality 0 and concrete named-color swatches.

This produces 48 paired configurations plus the new method's canonical registered default with no explicit parameters. Every candidate uses the complete 545-asset corpus and the existing feedback cases, including controlled fixtures used in prior judgments. The visual gallery and diagnostic replay retain only the 523 real wallpapers.

The existing feedback loop measures accuracy over a 1,000-result window, then latency using top 20, one warmup, three timed repeats and concurrency 1. Paired analysis records overall, real-image, vibe and proportion agreement, uncertain-label sensitivity, every individual case improvement and regression, missing judgments, eligibility violations and timed requests at or above one second.

The read-only replay separately ranks picked `#FF0000` in vibe mode under the 48 paired configurations. It records all 523 returned IDs and scores, and OpenSearch's explanatory ledger for both user examples plus `wallpaper-004` and `wallpaper-031`. Those latter images were comparison candidates in the diagnosis, not new human preference labels. All four ranks are preserved alongside tie intervals rather than replacing the feedback score with an inferred target order.

## Results

The [feedback report](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) contains all 49 configurations. Each supports 31 of 37 cases, with six explicit unsupported cases, no errors, no missing supported judgments and no eligibility violations. There are 233 assessed preference pairs across those 31 cases; the real-image subset contains 27 cases and 183 pairs.

The change substantially raises both reported examples for a red query at equal weights and quality influence 1. Across existing judged cases the outcome is mixed: overall agreement improves in 19 of 24 paired settings, but **real-image agreement improves in eight, declines in thirteen, and is unchanged in three**. Excluding uncertain judgments changes that to six real-image improvements, seventeen declines and one tie. Controlled fixtures account for part of the more favorable overall result. Real-image changes range from −3.09 to +4.07 percentage points. Each setting regresses on two to seven individual cases. These are development observations, not evidence that the new measurement universally wins.

Change in real-image agreement relative to the original method, in percentage points. Positive favors the shade-aware metric; differences below `1e-12` are treated as numerical equality.

| Bins | Quality influence | Weighting 0 | Weighting 3 | Weighting 6 |
|---|---:|---:|---:|---:|
| 16 | 1 | +0.06 | −1.54 | −2.16 |
| 16 | 3 | −1.54 | −1.54 | +0.31 |
| 64 | 1 | +3.46 | +0.62 | −1.23 |
| 64 | 3 | +1.23 | −1.85 | −3.09 |
| 256 | 1 | +2.22 | 0.00 | −1.23 |
| 256 | 3 | −1.85 | 0.00 | 0.00 |
| 1,024 | 1 | +4.07 | −1.23 | −0.62 |
| 1,024 | 3 | +3.09 | −0.62 | −2.47 |

At 1,024 bins, weighting 0 and influence 1, overall agreement rises from 62.69% to 70.11%, and real-image agreement from 66.79% to 70.86%. Excluding uncertain judgments, that real-image gain remains +3.09 points. The canonical API default returns exactly the same IDs and scores as this power-curve setting, because linear and power quality agree at influence 1. No optimum is inferred from this small reused dataset.

### Both reported red examples

Ranks below are among all 523 real wallpapers for picked `#FF0000`, vibe mode, smooth power, quality influence 1 and minimum average quality 0. Each cell is **original → shade-aware**. Results are identical across all four banks because #FF0000 is an exact shared anchor; complete ordered-hit parity is recorded.

| Wallpaper | Weighting 0 | Weighting 3 | Weighting 6 |
|---|---:|---:|---:|
| First: dark red portrait (`madness-wallhaven-gww23l`) | 54 → 8 | 33 → 10 | 24 → 14 |
| Second: softer red background (`madness-wallhaven-9oov2d`) | 12 → 9 | 26 → 24 | 40 → 38 |
| Teal abstract comparison (`wallpaper-004`) | 50 → 81 | 53 → 80 | 61 → 93 |
| Orange/yellow sunset comparison (`wallpaper-031`) | 30 → 52 | 44 → 61 | 54 → 81 |

The comparison images' scores increase slightly even though their ranks fall; the red examples gain more. This is a relative ranking change, not evidence that orange or teal pixels are excluded. These diagnostic examples have no newly assigned human preference pairs. There is no dedicated judged yellow-versus-red rejection case in this sweep.

For the first image, admitted area at the 50% quality cutoff changes from 0.68% to 25.53%; for the second, from 11.72% to 38.59%. Their 90% areas stay tiny: 0.10% → 0.15% for the first and zero for the second. The first image's 0% area becomes 68.32%, and the second's 52.71%. These are measurements under the candidate formula, not human labels of how much red the wallpaper contains. They explain why strongly weighting the strictest levels can still demote softer reds.

### Regressions and precision

At the 1,024-bin, weighting-0, influence-1 setting, ten cases improve and four regress:

- `perceived-red-001`: 100% → 93.33% agreement. The leaf (`wallpaper-060`, original C) now falls below the sky (`wallpaper-077`, original B), contrary to the recorded preference. The earlier preference for bright red street illumination over dulled red roses remains correct.
- `composition-green-red-real-001`: 50% → 33.33%.
- `composition-green-red-real-002`: 16.67% → 0%.
- `perceived-orange-batch-001`: 100% → 83.33%.

Across the whole sweep, pink perception regresses in 17 paired settings; the second real green/red composition and one red-percentage case regress in 16 each. Every changed case and its baseline/candidate agreement is retained in `shade-findings.json`.

Both existing #FF2200 precision cases have unchanged agreement in all 24 pairs. The #4C8C72 muted-green case regresses by one preference pair at 16 bins/weighting 3 or 6/influence 1, and at 256 bins/weighting 6/influence 1. It improves at five other settings. Broader tolerance therefore still needs an explicit precision tradeoff, even though the two warm-red precision cases did not expose a regression.

The two gray-plus-red composition cases improve or remain unchanged throughout the sweep. Exact neutral anchor measurements are separately confirmed unchanged across the entire corpus: 87,200 coverage/quality values match the original measurements exactly. This preserves those neutral measurements; it does not guarantee every mixed-color ranking improves.

### Timing and validation

The 4,557 timed requests have zero failures and zero requests at or above one second. Candidate p95 ranges from **1.73 to 6.57 ms**; the maximum observed request is **46.09 ms**. These measurements include query compilation, HTTP, OpenSearch filtering/ranking and response decoding, with one warmup and three repeats at concurrency 1 on 545 assets. Index verification/setup and diagnostic replay are excluded. No million-record or concurrent production-capacity claim follows from these numbers.

All four new indexes verify all 545 IDs, every measured field and the metric definition. The new real OpenSearch suite passes 15 checks, and the existing cutoff integration suite passes 43, both with zero skips. The read-only replay completes 48 full-corpus searches and 192 single-document inspections with search/ledger score agreement. Analysis reconciles every raw timed request and validates all 37 query-module hashes for every configuration against the immutable source snapshot; the auxiliary ClickHouse YAML is separately verified against the workspace.

## Saved evidence

Browser validation passed 25 checks with 31 successful API requests and no console errors. This covered all four banks, combined and individual cutoff layers on both axes, saved geometry after editing controls, live sliders, the original methods and a 390×844 mobile layout. Nonmatching colors remain tiny and visible; the modal uses the revised membership geometry. Desktop screenshots were also visually reviewed. The browser session is closed. `browser-qa.json` and three screenshots are saved alongside the evaluation artifacts below.

The immutable feedback run is `runs/2026-09-21T22-29-58.206Z-ceda9d2e/` under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`. It contains `run.json`, the report and `shade-findings.json` with all paired settings and case-level changes.

Additional artifacts are in external `exploration/shade-aware/2026-09-21/`: feedback and analysis logs, `default-power-i1-parity.json`, and `replay/rank-matrix.json`, `replay/bank-parity.json`, complete replay sources and logs. Frozen extraction receipts, per-image descriptors and the neutral-parity audit are in `exploration/shades/cbf86defa3539910e8b9/`. The registered method is also included in [consolidated findings](http://zerotwo:8225/findings), which now contain 53 valid defaults and 356 sensitivity configurations with no artifact-read warnings.

## Reproduction

After all four new indexes have been validated:

```sh
make color-shade-prepare COLOR_SHADE_ARGS='--counts 16,64,256,1024'
make color-shade-neutral-audit
make color-shade-integration
make color-shade-evaluate COLOR_SHADE_ARGS='--dry-run'
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/shade-aware.json'
make color-shade-evaluate COLOR_SHADE_ARGS='--replay'
make color-shade-evaluate COLOR_SHADE_ARGS='--analyze /absolute/path/to/feedback/run'
```

The feedback runner saves immutable query sources, indexed measurement provenance and raw request evidence. The analysis checks candidate pairing, raw timing accounting and query-source hashes against the immutable source snapshot. Replay artifacts are saved under the external shared color-evaluation store, with complete source snapshots and independently inspected scores. No wallpaper or archive data is committed.

## Limits to interpretation

Existing labels are a single reviewer's development preferences, with repeated images and related cases. They are not independent observations or held-out accuracy evidence. The new archive images remain unjudged; changing their ranks is diagnostic evidence, not an accuracy percentage.

More shade tolerance may reduce precision for exact color-picker requests. That tradeoff must remain visible in the per-case results and the separate original method. The experiment does not select a production winner.

Small-corpus times cannot establish latency at a million wallpapers, high concurrent load or 100 million records. The new measurement is precomputed, and the query uses the same number of functions as the original all-cutoff method; that observation is about query structure, not a measured production capacity result. Earlier expensive multi-color scale failures still apply as a caution for the shared scoring structure.
