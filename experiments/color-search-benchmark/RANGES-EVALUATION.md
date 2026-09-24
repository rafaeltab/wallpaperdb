# Color range prototype: evaluation

Generated 2026-09-16T14:03:41.666Z. Reproduce with `make color-ranges-evaluate`.

## Scope

All seven editor presets run against the same 100 real wallpapers. The reference classifies a separate sample of up to 256×256 pixels from each original image into the actual requested regions, including overlapping memberships. It independently implements membership, then uses the same transport solver to calculate the best possible joint area error. A second reference classifies the exact approximately 10,000 pixels used to build palettes, separating clustering error from sampling error. This checks approximation for the defined regions, not whether people agree with those regions. Graded matching keeps hard region areas and uses center preference only after minimizing composition error.

## Summary

| Method | Mean absolute region-area difference vs pixels | Mean pixel composition regret@10 | Mean top10 overlap with graded128 |
|---|---:|---:|---:|
| hard32 | 0.8% | 0.0057 | 80.0% |
| graded32 | 0.8% | 0.0054 | 82.9% |
| soft32 | 0.8% | 0.0216 | 71.4% |
| graded128 | 0.6% | 0.0026 | 100.0% |

Regret is the selected top10 mean reference cost minus the best10 available mean reference cost. Lower is better; this is not a human accuracy percentage. Graded128 self-overlap is an identity, not proof of relevance. Hard32 and graded32 use identical raw region memberships; only tie-breaking differs.

### Clustering and sampling errors

| Method | Mean area difference vs exact palette-input pixels | Mean difference between the two pixel samples |
|---|---:|---:|
| hard32 | 0.6% | 0.3% |
| graded32 | 0.6% | 0.3% |
| soft32 | 0.6% | 0.3% |
| graded128 | 0.4% | 0.3% |

These two absolute errors do not add algebraically: they can reinforce or offset each other. Per-image values in the JSON identify boundary outliers.

## Each query

| Query | First graded32 result | Palette available areas | Pixel available areas | Palette area error | Pixel area error | Worst32 region-area error across corpus |
|---|---|---|---|---:|---:|---:|
| 70% near red · 30% near black | wallpaper-037 | 45.4% / 29.0% | 45.6% / 30.6% | 0.2556 | 0.2542 | 6.4% |
| 70% dark grayscale | wallpaper-053 | 70.0% | 70.6% | 0.0005 | 0.0055 | 15.8% |
| 70% dark · any hue or saturation | wallpaper-076 | 69.6% | 69.0% | 0.0036 | 0.0100 | 5.4% |
| 70% red/orange shades · 30% dark | wallpaper-037 | 86.5% / 11.1% | 86.3% / 10.8% | 0.1894 | 0.1915 | 12.3% |
| 60% within an RGB box | wallpaper-037 | 21.6% | 20.1% | 0.3840 | 0.3995 | 3.1% |
| 70% dark red · HSV and RGB | wallpaper-037 | 11.9% | 11.8% | 0.5814 | 0.5817 | 5.1% |
| 100% grayscale · any lightness | wallpaper-005 | 100.0% | 100.0% | 0.0000 | 0.0000 | 37.6% |

Available region areas can overlap. They are not the non-overlapping allocated amounts. Detailed rankings, allocation estimates, pixel references, and all hashes are in [ranges-evaluation.json](ranges-evaluation.json).

## Local scoring cost

Milliseconds to score and sort100 already prepared32-color palettes. Each query is compiled once. Median of seven runs after two warmups; timings exclude extraction, retrieval, network, and UI. These are local measurements, not1M/100M benchmarks.

| Query | Hard | Graded center preference | Soft outside boundary |
|---|---:|---:|---:|
| 70% near red · 30% near black | 2.03 | 7.94 | 12.98 |
| 70% dark grayscale | 1.23 | 1.38 | 13.79 |
| 70% dark · any hue or saturation | 1.42 | 3.08 | 9.75 |
| 70% red/orange shades · 30% dark | 1.44 | 4.32 | 7.05 |
| 60% within an RGB box | 1.44 | 1.61 | 12.79 |
| 70% dark red · HSV and RGB | 1.61 | 1.67 | 12.31 |
| 100% grayscale · any lightness | 0.99 | 1.58 | 5.87 |

Hard mode combines identical membership patterns before solving; graded mode must also preserve different center preferences. The extra work is bounded by the palette size rather than source-image pixel count. The architecture still requires candidate retrieval; these timings do not justify scanning an entire collection for each query.

## Limitations

- A32-color centroid can sit on a different side of a narrow range boundary from some pixels it represents. Graded center preference does not remove this hard membership error.

- The128-color descriptor is still compressed and uses the same~10k sample. Compare its direct pixel error as well as rank overlap.

- Area-first ranking deliberately refuses to trade a worse proportion match for a prettier center shade. Small area differences, including approximation errors, can dominate center preference.

- The soft-outside alternative reduces abrupt boundaries but trades literal membership for a smooth objective. Its soft cost is not directly comparable with a hard area error.

- Real rankings are exploratory, with only100 images and no human relevance judgments. Production candidate recall, p95latency, throughput, and storage overhead are unmeasured.

- The source-pixel reference shares the declared region definitions, the OKLab conversion, and the transport solver. Agreement is representation accuracy for this model, not independent perceptual validation.

