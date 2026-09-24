# Proportion prototype: corpus evaluation

Generated 2026-09-15T23:04:50.552Z. Run with `make color-proportions-evaluate`.

## Findings

The following four findings refer to the **original fixed 12-query group**. Actual interactive UI presets are evaluated separately below; their later addition does not change the original group or its reported averages.

- 32 representatives retained 97.5% average top-ten overlap with 128; 64 retained 100.0%. Palette compression was a small source of ranking change in this corpus.
- Transport32 reduced mean composition regret against the independent narrow and middle pixel proxies compared with legacy presence scoring (ΔE20: 0.0688 → 0.0272; ΔE30: 0.0589 → 0.0374).
- At the broad ΔE40 threshold, legacy performed better (0.0823 vs 0.0931). Which shades count as the selected color materially affects results; this is not a universal semantic winner.
- Several saturated mixtures have no close match in these 100 images. The top result must be presented as the closest available, with its estimated proportions visible. Controlled synthetic examples are needed to demonstrate exact compositions that the natural corpus does not contain.

## What was evaluated

The same 100 varied wallpapers, 12 original fixed queries plus 8 actual UI presets as a second group, exact target proportions (40% green should prefer approximately 40%, not 80%), tolerance 0.06 OKLab. Queries include partial, complete, neighboring-color, neutral, and five-color mixtures. Absolute requested amounts are preserved; an explicit remainder fills the difference to 100%.

The evaluator reads the self-contained `proportions-data.json` prepared by the proportion prototype. It does not depend on descriptors from the earlier OpenSearch experiment. Fresh preparation downloads checksum-pinned originals when needed, and the evaluation uses those originals for richer palettes and pixel references.

This evaluation separates two questions:

1. **Compression accuracy:** how closely do 32 or 64 representative colors reproduce the same transport objective with 128 colors? All three use the same approximately 10,000 source-pixel sample, so this does not assess sample-size bias.
2. **A different proxy for intended composition:** source images are separately sampled at up to 256×256. Every visible pixel goes to its nearest requested color in CIELAB D65 only if within ΔE76 20, 30, or 40; otherwise it goes to “other.” Compare those exclusive area proportions with the requested proportions, including the remainder, using half the sum of absolute errors. No pixel is counted twice. These hard thresholds are intentionally independent of the scorer’s smooth OKLab affinity, but they remain imperfect mathematical proxies, not human judgments.

## Original fixed 12 queries: ranking comparison

Regret is the mean reference cost of the selected ten minus that of the best ten available. Zero is ideal; lower is better. Reference costs are bounded 0–1. A regret of 0.01 means one percentage point of average excess cost **under that particular proxy**, not 1% human error. Raw cost scales should not be compared across reference types.

| Method | Regret vs 128 transport | Top-10 overlap vs 128 | Pixel regret ΔE20 | Pixel regret ΔE30 | Pixel regret ΔE40 |
|---|---:|---:|---:|---:|---:|
| legacy32 | 0.0357 | 67.5% | 0.0688 | 0.0589 | 0.0823 |
| coverage32 | 0.0056 | 85.8% | 0.0328 | 0.0531 | 0.1136 |
| transport32 | 0.0000 | 97.5% | 0.0272 | 0.0374 | 0.0931 |
| transport64 | 0.0000 | 100.0% | 0.0280 | 0.0373 | 0.0946 |
| transport128 | 0.0000 | 100.0% | 0.0280 | 0.0373 | 0.0946 |

The 128-transport row comparing against itself is an identity check. It cannot establish that transport is the best semantic algorithm. Legacy uses amount as importance; coverage and transport are new proportion objectives. They therefore answer different questions; the comparison exposes consequences rather than proving a universal winner.

### Palette convergence

- transport32: mean absolute score-cost deviation from 128 is 0.0003; mean top-10 overlap 97.5%.
- transport64: mean absolute score-cost deviation from 128 is 0.0001; mean top-10 overlap 100.0%.

| Query | 32-palette regret vs 128 | Top-10 overlap | Best available pixel cost ΔE30 | First 32-palette result |
|---|---:|---:|---:|---|
| 40% green; 60% other | 0.0000 | 100% | 0.3936 | wallpaper-050 |
| 80% green; 20% other | 0.0000 | 100% | 0.7936 | wallpaper-050 |
| 50% green / 50% red | 0.0000 | 100% | 0.7961 | wallpaper-037 |
| 80% red / 20% black | 0.0000 | 100% | 0.6856 | wallpaper-037 |
| 20% each red, orange, yellow, green, blue | 0.0000 | 100% | 0.6505 | wallpaper-037 |
| 20% red / 20% orange; 60% other | 0.0001 | 90% | 0.1424 | wallpaper-037 |
| 60% sky blue; 40% other | 0.0000 | 100% | 0.0916 | wallpaper-028 |
| 50% blue / 50% orange | 0.0000 | 100% | 0.5715 | wallpaper-037 |
| 70% black / 30% white | 0.0000 | 100% | 0.0149 | wallpaper-005 |
| 30% rose / 30% gray; 40% other | 0.0002 | 90% | 0.0706 | wallpaper-020 |
| 40% forest / 40% cream; 20% other | 0.0000 | 100% | 0.0590 | wallpaper-055 |
| 25% teal / 25% pink; 50% other | 0.0001 | 90% | 0.2463 | wallpaper-024 |

High “best available” cost means this small corpus lacks a close match under that pixel proxy; ranking still returns the nearest available wallpapers. A top result is not a claim that the requested composition exists. Top-10 overlap breaks ties deterministically by wallpaper ID; machine-readable results also include a tie-safe reference-cutoff measure.

## Actual interactive UI presets: separate 8-query evaluation

These presets are loaded directly from `proportions-data.json`; their shades differ from some original fixed queries. They were added after the initial 12-query run, so they are reported separately. The scorer, tolerance, corpus, and references are identical; these results must not be silently pooled with the original average.

| Method | Regret vs 128 transport | Top-10 overlap vs 128 | Pixel regret ΔE20 | Pixel regret ΔE30 | Pixel regret ΔE40 |
|---|---:|---:|---:|---:|---:|
| legacy32 | 0.0201 | 63.8% | 0.0585 | 0.0584 | 0.0905 |
| coverage32 | 0.0119 | 80.0% | 0.0487 | 0.0607 | 0.0988 |
| transport32 | 0.0000 | 98.8% | 0.0359 | 0.0351 | 0.0793 |
| transport64 | 0.0000 | 98.8% | 0.0359 | 0.0351 | 0.0793 |
| transport128 | 0.0000 | 100.0% | 0.0359 | 0.0354 | 0.0788 |

The estimate column lists exclusive smooth OKLab affinity proportions for the first result, in query-color order. It is not an exact pixel percentage. Pixel cost is the separate ΔE30 hard-assignment composition error; “best available” is the smallest such error across all 100 images, irrespective of transport rank.

| UI preset | Exact requested shades | First 32-palette result | Estimated selected-color proportions | First-result pixel cost | Best available pixel cost |
|---|---|---|---|---:|---:|
| 40% green · 60% anything else | #008040 40% | wallpaper-050 | 10.6% | 0.1920 | 0.1920 |
| 50% green · 50% red | #008040 50%, #E03030 50% | wallpaper-037 | 0.0% / 16.7% | 0.6899 | 0.6899 |
| 80% red · 20% black | #E03030 80%, #101010 20% | wallpaper-082 | 6.0% / 26.5% | 0.7066 | 0.5793 |
| Five colors · 20% each | #E03030 20%, #F08020 20%, #F0D030 20%, #008040 20%, #2060D0 20% | wallpaper-037 | 14.9% / 23.6% / 1.5% / 0.0% / 0.0% | 0.5803 | 0.5803 |
| 20% red · 20% orange · 60% anything else | #E03030 20%, #F08020 20% | wallpaper-037 | 14.9% / 23.8% | 0.2499 | 0.2000 |
| 40% teal · 30% cream · 30% anything else | #008080 40%, #FFF0C0 30% | wallpaper-055 | 2.3% / 62.9% | 0.5234 | 0.1912 |
| 70% navy · 30% anything else | #102040 70% | wallpaper-016 | 51.3% | 0.2058 | 0.0060 |
| 100% red | #E03030 100% | wallpaper-037 | 16.7% | 0.6899 | 0.6899 |

## Local performance

Median of five 100-wallpaper score-and-sort passes after three warmups per method/query on this machine. Includes scorer validation, allocations, and sorting; excludes palette extraction, network, OpenSearch, and candidate retrieval. This is a prototype reranking measurement, not production throughput.

| Method | One-color partial query | Five-color complete query |
|---|---:|---:|
| legacy32 | 0.59 ms | 1.42 ms |
| coverage32 | 0.55 ms | 1.38 ms |
| transport32 | 11.63 ms | 16.94 ms |
| transport64 | 44.03 ms | 59.04 ms |
| transport128 | 216.93 ms | 262.31 ms |

## Evidence and limits

- [Machine-readable scores, full rankings, and timing](proportions-evaluation.json)
- Reusable richer palettes and independent pixel proportions: `output/proportions-palettes128.json` (local generated cache; keyed by source hashes, palette implementation, proxy implementation, and query definitions).
- The original pinned source files are reused when present. Cache creation verifies each source SHA256 and the prepared 32-color palettes against recomputation, allowing palette order differences; reruns reuse the keyed cache.
- 128 representatives remain an approximation. This is a convergence assessment, not proof of an exact optimum over full-resolution pixels.
- ΔE76 thresholds and OKLab tolerance can disagree about what counts as green, red, neutral, or a neighboring shade. Named-color-family matching would require a separate product decision and validation.
- Only 12 fixed queries, 8 UI presets, and 100 images; no human relevance labels, no large-index candidate-recall experiment, and no guarantee this corpus contains close matches for complex five-color requests.
