# OpenSearch color-query prototypes

These are hand-authored experiments, not a selected production architecture. No learned ranking or image embeddings are used. JavaScript builds query vectors, range lookup tables, and query DSL; OpenSearch filters and orders every result.

## First round: sixteen methods

| ID | Service execution | What differs |
|---|---|---|
| `hsv-cosine-ann` | Lucene HNSW, cosine | Historical 64-bin HSV control |
| `hsv-l2-raw-ann` | Lucene HNSW, L2 | Historical raw Gaussian query magnitude |
| `hsv-l2-unit-ann` | Lucene HNSW, L2 | Unit-sum query and document distributions |
| `hsv-hellinger-ann` | Lucene HNSW, L2 | Square-root distributions; Hellinger geometry |
| `rgb-hellinger-ann` | Lucene HNSW, L2 | 512 RGB bins and an OKLab Gaussian query |
| `rgb-cosine-ann` | Lucene HNSW, cosine | Same RGB representation, different comparison |
| `hsv-cosine-exact` | OpenSearch k-NN scoring script | Exhaustive cosine reference for ANN retrieval |
| `rgb-kernel-exact` | Painless over sparse 4096-bin RGB histogram | Matching color mass with conditional quality |
| `palette-area-exact` | Painless over 32 palette centroids | Target area from compressed adaptive palette |
| `histogram-area-exact` | Painless over sparse RGB histogram | Target area from fixed fine bins |
| `histogram-composition-exact` | Painless over sparse RGB histogram | Area error, conditional quality, unwanted-color penalty |
| `native-area-linear` | Numeric `function_score` decay | Indexed named-family area, linear target error |
| `native-area-gauss` | Numeric `function_score` decay | Indexed named-family area, Gaussian target error |
| `native-area-postings` | Constant-score keyword clauses | Indexed 1% coverage buckets, additive linear utility |
| `feature-composition-exact` | Painless over named scalar doc values | Composition objective using precomputed family areas |
| `rgb-cdf-wasserstein` | Painless over three 16-bin cumulative distributions | RGB marginal Wasserstein distance |

ANN methods are approximate. Exhaustive methods rank every metadata-matching document in OpenSearch, but that does not establish acceptable million-document latency. Exact here describes retrieval for the implemented formula, not agreement with human perception.

### Feature and query contract

`corpus-colors.mjs` supplies shared, provisional named-color regions. Area and conditional quality are separate: a pixel on a range boundary occupies its full area and has quality 0.5. It does not count as half a pixel. Explicit custom ranges support OKLab radius and independent RGB, HSV, or HSL distances; multiple range spaces are intersected.

`query.mjs` accepts the feedback loop's label-free intents and the browser's structured `mode`, `targets`, `percent`, `space`, `tolerance`, and `edgeWeight`. It rejects unknown intent fields. Percentage targets retain their whole-image amounts and the unspecified remainder. Semantic eligibility becomes an OpenSearch ID or tag filter. No subject is inferred from image pixels.

Scalar fields use `cov_<name>` in 0–10,000 units and `quality_<name>` in 0–1. Keyword coverage tokens use 0–100 integer buckets. Sparse histogram entries pack a RGB4096 cell and count in a `long`; palette entries pack a 24-bit RGB centroid and count. Palette centroids use the same 4096-cell query lookup, so their additional quantization is disclosed. CDF entries pack their index and value to retain association through sorted numeric doc values.

### Provisional objectives

For simple vibe queries, the composition and histogram-kernel methods use `area^0.65 × mean quality`; the pure area methods use area without conditional quality. Native area controls maximize family area. These are deliberately distinct hypotheses.

For explicit proportions, pure area methods use mean absolute error against whole-image target amounts. Composition variants add conditional-quality loss and a penalty for area outside every requested region beyond the allowed remainder:

```
E = mean(abs(actualArea - targetArea))
    + 0.35 * sum(min(actualArea, targetArea) * (1 - meanQuality))
    + 6 * max(0, outsideRequestedRegions - unspecifiedRemainder)
score = 1 / (1 + E)
```

The factor 6 is a hypothesis for the user's preference against an extra color in a complete palette; it is not a learned coefficient. Histogram variants measure the region union directly. The scalar variant estimates union by capped summed marginal areas, which overestimates coverage when requested regions overlap. Neither performs exclusive pixel allocation. Full-palette and partial-palette cases must be reported separately.

Unspecified grayscale-with-red accents and dark-with-bright accents use explicit heuristic objectives. Native and postings methods route these compound intents to the same scalar Painless script, so their execution is no longer native decay/postings for those requests. Global monochromatic/rainbow scalars describe distribution strength and are not literal pixel percentages.

Vector and RGB-CDF methods remain distribution-matching controls. A partial percentage query receives an explicit warning: these methods do not implement a free remainder or whole-image target errors. Unsupported lighting, grayscale, accent, or arbitrary-channel range intents are surfaced, not silently translated into a single gray/black swatch.

## Verification before feedback-loop evaluation

`make color-exploration-method-test` verifies target/remainder preservation, range-edge area versus quality, service-side eligibility, explicit unsupported ranges, unknown-field rejection, and query generation for all methods.

`COLOR_EXPLORATION_METHOD_INTEGRATION=1 make color-exploration-method-test` additionally executed 36 real searches on `color-exploration-real-v1` (545 corpus assets): every method for red and 40% green, plus four grayscale-with-red accent paths. All returned finite descending scores from OpenSearch. This is a syntax/contract smoke check, not a perception or scale result.

`track_total_hits` is false for measured searches so exact total counting does not disable competitive skipping. Corpus/index cardinality is checked separately during setup. All returned results remain service ordered.

## Additional service prototypes

### Exact indexed bounds for the named composition objective

`methods-bounded.mjs` first obtains a seed using native indexed area scores, asks OpenSearch to score that seed with the exact composition objective, and reads its kth score. It then makes a **global** final OpenSearch query with necessary numeric bounds and the exact scoring script. The final candidate set is not capped to seed IDs.

For the proportion score `S = 1 / (1 + E)`, nonnegative quality/purity penalties mean `E >= mean(abs(area - target))`. Consequently, any possible winner must satisfy `abs(area_i - target_i) <= targetCount * (1/S - 1)` for every target. The implementation lowers the observed float score and rounds bounds outward, retaining ties. Vibe queries use the analogous bound from `score <= area^0.65`. Weak bounds intentionally fall back to examining a large set; exactness does not imply consistently good latency.

Real OpenSearch checks confirmed identical top-20 IDs and scores against the exhaustive reference for red, dark, 40% green, and 80% grayscale/20% red. A necessary-bound grid test and an unseeded-winner test cover the global eligibility guarantee.

The multi-query guarantee assumes a stable index across seed and final searches. A production implementation must use a consistent snapshot/PIT or an equivalent versioned search view, and verify that every query path supports that consistency mechanism.

### Palette optimal transport

`methods-transport.mjs` constructs and solves a minimum-cost residual flow network in Painless for each document. Palette masses supply requested portions plus an optional remainder, and each mass goes to exactly one destination. This differs from overlapping marginal matching.

Requested-family mass assigned to its matching portion pays conditional-quality loss; mass assigned to the wrong requested portion costs 1; mass outside all requested regions costs 6. The unspecified remainder admits outside colors freely but charges 1 for excess mass of a requested family. Thus 80% green cannot quietly disappear into the unspecified 60% of a 40%-green request. These are explicit heuristic costs, not human-trained values.

Only explicit proportions are supported. The palette is quantized, and the per-document assignment solver is expected to be expensive. It remains a useful contrast for correctness and perception even if performance disqualifies it.

## First-round observation guiding refinements

Frozen run `2026-09-20T00-50-38.374Z-32d2dbb7` found the fine-histogram pure-area control stronger on the currently labeled proportion cases than the composition objective. One mechanism is clear: charging `outsidePenalty * max(0, outside - remainder)` on a **partial** 40%-green query adds a large second penalty to too little green, but not too much green. That is a poor fit for the user's concern about crossing half the image. A new variant should test applying purity penalties only to complete palettes, while preserving target errors for partial requests. This is a proposed refinement, not a retroactive change to the frozen baseline.

After the first round, a query-contract correction rejects explicit range controls for swatch-vector methods, which use fixed Gaussian shapes. Ordinary picked hex requests remain supported. None of the first-round feedback cases supplied explicit range controls, so their scores are unchanged by this correction.

### Direct palette membership and shade priority

`methods-direct-palette.mjs` adds `palette-direct-balanced` and `palette-direct-precision`. Both decode the original 24-bit palette centroid and compute its OKLab, HSV, and HSL channels inside Painless. They do not snap centroids to an RGB4096 cell. This addresses a discovered representation failure: small chroma changes around the grayscale boundary can change a large area's membership after coarse RGB quantization.

The balanced variant keeps area and conditional quality separate, uses whole-image target errors, and applies the unwanted-color penalty only when the requested palette totals 100%. The precision variant shares those proportion semantics, but for a picked-hex vibe request it uses `mean match quality × min(1, matching area / 0.05)`. After adequate support, a larger patch of the exact same color does not automatically outrank a smaller patch. Named-color vibe queries retain the area/quality objective.

`COLOR_EXPLORATION_DIRECT_TEST=1 make color-exploration-test` verified the direct service membership and quality against an independent JavaScript reference for every pixel-level named family and four custom range spaces, over twelve real palettes (624 numerical comparisons, tolerance 0.000002). The exact-shade 10% and 40% fixtures both scored above nearby shades and within 0.03 of each other. These checks verify formula semantics, not overall human accuracy. Palette reduction to 32 colors still loses information.
