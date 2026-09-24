# Color filtering: L2 helps a little; changing the color representation helps much more

This records the initial experiment for containing a selected color. For the later exact-proportion requirements, global OpenSearch ordering, and million-document experiments, start with [GLOBAL-FINDINGS.md](GLOBAL-FINDINGS.md). That follow-up identifies limitations of compact palettes and revises the retrieval recommendation.

**Recommendation:** pursue a versioned perceptual palette and coverage scoring. Do not ship a cosine→L2 mapping change as the solution. For an OpenSearch retrieval stage, the finer RGB histogram with inner product is a promising companion to palette reranking.

Experiment completed 2026-09-15 on **100 genuine wallpapers, 28 queries, and 14 candidates**, using OpenSearch **2.11.0** and NATS **2.10.29**. Production source is unchanged. [Open the interactive comparison](http://localhost:8220/report.html?q=orange&left=cosine-default&right=palette32-06&metric=lab30), or run `make color-benchmark-serve`. [Reproduction instructions](README.md), [complete rankings](results.json), [compact metrics](summary.json).

## What was tested

The earlier [color-filter issue #8](https://github.com/rafaeltab/wallpaperdb/issues/8) explicitly suggested `cosinesimil` and `l2`. Both were tested as native Lucene HNSW searches using the real gateway repository and identical stored histograms:

1. Current production cosine, unchanged extractor and query builder.
2. L2 with the unchanged query: the literal metric swap.
3. L2 after normalizing the query to sum to one, matching the stored histogram's scale.

Neither L2 version fixed the controlled color mismatches, so the experiment also evaluated L1/intersection, L-infinity, Hellinger, narrower query tolerances, inner product, a 512-bin RGB descriptor, and weighted 32-color OKLab palettes.

The corpus mixes photos, illustrations, abstract art, paintings, architecture, landscapes, and monochrome images. It was selected for color variety from 294 candidates, with pinned source URLs and SHA256 hashes. It includes five portrait images and a few related scenes/color variants. It is not a random sample of production wallpapers. See [CORPUS.md](CORPUS.md).

## Main quantitative result

The table uses **held-out query colors** on the same 100 wallpapers. Ranking quality is nDCG@10 against an independent CIELAB pixel-coverage proxy: **1 means ideal ordering under that proxy, not 100% human satisfaction**. Precision counts results with at least 10% matching area of every requested color.

| Method | Ranking quality, nDCG@10 | Precision@10 |
| --- | ---: | ---: |
| Current HSV cosine, sigma .30 | **0.290** | 46.4% |
| L2, unchanged query | 0.410 | 48.6% |
| L2, unit-sum query | 0.209 | 38.6% |
| Existing HSV cosine, narrower sigma .08 | 0.549 | 52.1% |
| Existing HSV inner product, sigma .08 | 0.604 | 54.3% |
| RGB 512 bins + inner product, sigma .08 | 0.705 | 56.4% |
| **32-color perceptual palette, sigma .06** | **0.871** | **60.0%** |

There are 14 held-out queries. Thirteen have nonzero ideal relevance and contribute to nDCG; all fourteen contribute to precision. Given the actual available matches, the maximum attainable mean precision is **66.4%**, not 100%. Restricting nDCG to the eleven queries with at least one substantial match gives **0.318 current / 0.448 raw L2 / 0.754 RGB / 0.876 palette**.

The palette and RGB tolerances were chosen using the development queries. The holdout contains easier, more muted shades than the development set; this is query separation, not validation on unseen images. All settings, including losing candidates, remain in the report.

### Does the conclusion depend on the evaluator?

| Independent coverage proxy | Current | Raw L2 | RGB .08 | Palette .06 |
| --- | ---: | ---: | ---: | ---: |
| CIELAB distance ≤20 | .144 | .235 | .610 | .796 |
| CIELAB distance ≤30 | .290 | .410 | .705 | .871 |
| CIELAB distance ≤40 | .440 | .563 | .754 | .886 |
| HSV hue/saturation/value neighborhood | .181 | .261 | .472 | .634 |

These are held-out nDCG values; eligible query counts differ by proxy. The improvement survives all four definitions, but the lower HSV score shows that “same color” still depends on the intended tolerance. These are automated measurements, not a replacement for looking at the images.

For **single-color queries only**, held-out CIELAB30 nDCG is **.288 current / .464 raw L2 / .809 RGB / .867 palette**. This separates descriptor improvements from the palette prototype's different multicolor aggregation rule.

## What the visual comparison showed

An independent model reviewed eight randomized, anonymous top-five contact sheets before seeing the method key. It preferred the palette results in all seven sheets with useful matches. Saturated magenta had **no convincing result from any method**; the palette only supplied the best fallback order. This is a qualitative model review, not a human study. The untouched judgments and decoded results are in [VISUAL-BLIND.md](VISUAL-BLIND.md) and [VISUAL-RESULTS.md](VISUAL-RESULTS.md).

Concrete examples:

- **Orange:** current cosine returned two grayscale photographs first. The palette put the orange sunset (`wallpaper-037`) first and orange clouds (`031`) third.
- **Teal:** the palette returned five visibly useful blue-green scenes; current cosine and raw L2 each had only one convincing match in their first five.
- **Sky blue:** the palette promoted the clear blue sky through arches (`028`) to first. Most remaining results were weaker shades, so this is better ordering rather than five strong matches.
- **Dusty rose:** the palette found the best rose pattern (`048`) but ranked it fifth. Its beige first result remains a visible weakness.
- **Black plus red:** the palette retrieved more useful combinations but still ranked an orange/red sunset with only a narrow dark strip above stronger two-color examples.

The reviewer counted 18 convincing results across the palette's 40 displayed slots, versus 4 for current cosine and 5 for L2. Those conservative counts illustrate remaining weaknesses; they are subjective judgments on selected sheets, not estimated corpus-wide precision.

## Why the current behavior is poor

### 1. The query is broad and cosine rewards diffuse color distributions

The extractor makes a unit-sum histogram in 64 hard HSV bins. The query puts Gaussian weights around bin centers using OKLab distance, with default sigma **.30**. A center .30 away still receives about 61% of peak weight. Many unrelated bins therefore contribute.

Cosine divides by the image histogram's length. A colorful image spread across many bins can score well against this broad query even when it contains little of the requested color. Narrower kernels and raw inner product improve matters, but retain the same lost color detail.

### 2. The query and extractor disagree at coarse bin boundaries

The extractor assigns pixels to HSV intervals; the query evaluates the representative color at each interval's center. The representative can be closer to the wrong color than to the actual pixel.

The minimal diagnostic uses production code. Selecting pure yellow prefers a solid white image; selecting cyan prefers light gray; selecting green prefers yellow. Current cosine and both L2 variants pass only **5/8** solid-color self-match checks. The palette passes **8/8**. RGB512 passes seven strict first-result checks; white/light-gray quantization produces a tie in the remaining case.

Changing the distance formula cannot recover detail already discarded by the descriptor. See `make color-benchmark-diagnose` and [diagnostics.json](diagnostics.json).

### 3. Query scale makes a literal L2 swap ambiguous

The production query sums to roughly 19–32 in the primary-color diagnostic; stored histograms sum to one. Cosine ignores that scale, L2 does not. Raw L2's large query scale emphasizes its dot-product term, which partly explains why it improves coverage while properly unit-sum L2 gets worse. This is not evidence that L2 is a better general distribution metric for this task.

## What the better prototype does

The palette represents each image using up to **32 weighted OKLab colors**, derived from the same approximately 10,000-pixel extraction sample. A query accumulates each palette color's area multiplied by its Gaussian affinity to the requested color. At sigma .06, a large area close to the selected color scores strongly and a small accent contributes proportionally little.

For multiple colors, the prototype computes one affinity per requested color and takes their weighted geometric mean. The vector query methods instead sum their color kernels. Multicolor gains therefore combine a better descriptor with a different preference for containing all colors. Equal-weight examples here do not validate requested palette percentages.

The RGB512 prototype uses a fixed 8×8×8 histogram and OKLab-based query affinities. **Faiss HNSW inner product runs this directly in OpenSearch 2.11.** Existing Lucene 2.11 does not support inner-product ANN; exact `knn_score` can nevertheless score the existing vector field with it. [Supported engines and equations](RESEARCH.md).

## Can we retrieve candidates and then rerank?

Yes, but the candidate generator matters. Reranking cannot restore omitted images.

| Held-out query experiment | Mean retention of palette top ten | Worst retention | Final nDCG@10 |
| --- | ---: | ---: | ---: |
| Current cosine top 20 → palette | 37.9% | 10% | .525 |
| Current cosine top 50 → palette | 80.0% | 60% | .801 |
| RGB512 top 20 → palette | 92.1% | 50% | .829 |
| RGB512 top 50 → palette | 99.3% | 90% | .871 |

These shortlist simulations use the recorded exact rankings. Native Faiss top-ten recall against its own RGB ranking was also 100% for the small corpus, but that is a different question. **Top 50 out of 100 is not a validated production candidate budget.** Test larger collections, metadata filters, several-color candidate unions, and pagination before choosing it. Full analysis is in [analysis.json](analysis.json).

## A strict filter still needs a no-match rule

This experiment primarily evaluates ranking. A Gaussian affinity is not an exact percentage of matching pixels. Do not display it as “30% of the image matches” or threshold raw scores across different methods.

Some saturated shades have no substantial match in this corpus even though the collection contains their broader hue families. Pure yellow, lime, green, and magenta lack ≥10% CIELAB30 matches. Good behavior must be allowed to return **no matches**, or clearly expose wider tolerance, rather than always displaying unrelated nearest neighbors.

For a production filter, return separate per-color coverage estimates and require an agreed minimum for **every** requested color. Calibrate the color-distance tolerance and area threshold against user judgments; preserve smooth affinity for sorting qualifying images. The black/red and rose examples should be retained as explicit acceptance cases.

## Suggested production path

1. Add a **versioned palette representation** to color extraction and the colors-extracted event; retain the existing histogram while migrating. Prototype the chosen coverage threshold alongside the smooth ranking.
2. Project the new data through the gateway. Evaluate RGB512/Faiss retrieval plus palette reranking against a larger corpus; measure candidate loss and real latency separately from benchmark assertions.
3. Backfill from stored originals into a new mapped index, dual-write during the transition, and switch the gateway query target only after checks pass. Changing the mapping constant does not migrate an existing index: the current index manager skips indexes that already exist.
4. Validate no-match behavior, shades close to neutral, several colors, metadata filters, and stable pagination with human judgments and product-level tests.

This experiment supports that direction. It does not establish production-scale performance or a finished strict-filter threshold.

## Verification and retained evidence

- **`make color-benchmark` passed end to end** after independent audit fixes.
- 100 source hashes verified; 100 upload events and 100 extracted-color events acknowledged with zero redelivery; every projected histogram matched extraction. [Pipeline evidence](pipeline-evidence.json).
- Eighteen searches through the real gateway repository matched native score formulas within approximately `1.1e-7`; forward pagination returned 20 distinct documents across two pages.
- All benchmark exact scores matched mathematical calculations within `6.1e-7`. Native recall checks passed for all 140 query/method checks at this corpus size.
- The independent audit found and corrected a prototype centroid alias, an aggregate denominator error, and a multicolor threshold error. Corrected metrics and shortlist calculations were independently recomputed. [AUDIT.md](AUDIT.md).
- The report was checked in a browser at desktop and mobile sizes, including images, query links, comparison controls, and blind mode. Full results include source hashes and runtime versions.
- No complete application CI run was needed for this isolated experiment; no production service source changed. The real imported color pipeline and every candidate were exercised directly.

Scratch OpenSearch/NATS can be stopped with `make color-benchmark-down`; viewing the saved report needs only the static report server. Originals are cached locally and excluded from git; source provenance and numerical evidence are retained.
