# Color comparison research

Research date: 2026-09-15. Scope: the repository's **OpenSearch 2.11** deployment, not the latest OpenSearch release. This is a prototype research note; recommendations below are hypotheses to test against the accompanying benchmark, not measured results.

## What the current code actually compares

- `apps/color-extractor/src/services/hsv-embedding-strategy.ts` constructs 48 chromatic bins (12 hue × 2 saturation × 2 value) plus 16 achromatic value bins. Each pixel contributes to one bin; alpha weights contributions. The resulting histogram `p` sums to one.
- `apps/gateway/src/services/color-sort.service.ts` converts requested colors and HSV bin centers to OKLab, then constructs `q[i] = sum_j amount[j] * exp(-distance(color[j], center[i])² / (2*sigma[j]²))`. **It does not normalize `q`.** Default linear spread 0.5 produces sigma 0.3; even spread zero has sigma 0.1.
- `apps/gateway/src/opensearch/mappings.ts` uses Lucene HNSW with `cosinesimil`.
- The `exact` spread strategy selects the nearest **OKLab center**, whereas extraction assigns the containing **HSV interval**. These can disagree even for the same RGB color.

This is comparison of a hard pixel histogram with a smooth preference vector. It is not already a comparison of two equivalent probability distributions.

## OpenSearch 2.11 support

| Comparison | Lucene HNSW | Faiss HNSW | NMSLIB HNSW | Exact `knn_score` |
| --- | --- | --- | --- | --- |
| `cosinesimil` | Yes | No | Yes | Yes |
| `l2` | Yes | Yes | Yes | Yes |
| `innerproduct` | No | Yes, without PQ | Yes | Yes |
| `l1` | No | No | Yes | Yes |
| `linf` | No | No | Yes | Yes |

The ANN engine support and immutable `space_type` mapping are documented in [OpenSearch 2.11 method definitions](https://docs.opensearch.org/2.11/search-plugins/knn/knn-index/). Changing the ANN metric needs a new field or index. The exact script selects a metric at query time and can prefilter documents; an exact-only scratch index does not need ANN indexing enabled. See [OpenSearch 2.11 exact scoring](https://docs.opensearch.org/2.11/search-plugins/knn/knn-score-script/).

`innerproduct` being unavailable for **Lucene ANN** does not prohibit exact inner-product scoring of a `knn_vector` field: the [2.11 script implementation](https://raw.githubusercontent.com/opensearch-project/k-NN/2.11/src/main/java/org/opensearch/knn/plugin/script/KNNScoringSpace.java) validates the vector field type and dimension, not its ANN engine.

For 100 wallpapers, exact scoring is the appropriate metric-quality control. Separately test Lucene ANN cosine/L2 and Faiss ANN inner product if those become deployment candidates. Do not attribute approximation errors to the comparison formula.

## Equations and interpretations

Let `p` be a wallpaper histogram, `q` the raw production query, and `r = q/sum(q)`. The following interpretations are our mathematical analysis.

| Candidate | Quantity to optimize | What it rewards |
| --- | --- | --- |
| Current cosine | Maximize `(p·q)/(||p||₂ ||q||₂)` | Alignment of the entire histogram with the preference vector |
| Raw inner product | Maximize `p·q` | Average preference weight across the wallpaper's pixels, approximated by bin centers |
| L1 on probabilities | Minimize `sum(abs(p-r))` | Matching probability mass in the same bins |
| Squared L2 on probabilities | Minimize `sum((p-r)²)` | Matching the distribution, with larger bin errors weighted more heavily |
| L-infinity on probabilities | Minimize `max(abs(p-r))` | Reducing the single worst bin discrepancy |
| Hellinger | Minimize `H² = 1 - sum(sqrt(p[i]*r[i]))` | Distribution agreement with relatively more sensitivity to small masses |
| Histogram intersection | Maximize `sum(min(p[i], r[i]))` | Same-bin overlapping mass |

OpenCV documents [histogram intersection and Bhattacharyya/Hellinger comparison](https://docs.opencv.org/4.13.0/d8/dc8/tutorial_histogram_comparison.html). For unit-sum histograms, the following identities are useful:

```text
intersection(p,r) = 1 - L1(p,r)/2
u[i] = sqrt(p[i]); v[i] = sqrt(r[i])
||u||₂ = ||v||₂ = 1
u·v = cosine(u,v) = 1 - H²(p,r)
||u-v||₂² = 2*H²(p,r)
```

Therefore intersection and L1 give identical rankings when inputs are probability distributions. Hellinger can use a square-root-transformed field and Lucene cosine or L2; it needs neither a new OpenSearch plugin nor an engine change. This transformation changes the representation and must not be presented as only a metric swap. It still cannot recover colors lost during coarse binning.

L2-normalizing both original vectors before L2 comparison produces exactly the cosine ranking, because squared distance becomes `2-2*cosine`. That is not an independent alternative.

### OpenSearch scores are not comparable across metrics or paths

For exact `knn_score` in 2.11:

```text
L1/L2/linf: score = 1/(1+d)       # L2 means squared Euclidean distance
cosine:    score = 1+cosine
inner:     score = 1+dot          # for these nonnegative vectors
```

The source confirms these formulas in [KNNScoringSpace.java](https://raw.githubusercontent.com/opensearch-project/k-NN/2.11/src/main/java/org/opensearch/knn/plugin/script/KNNScoringSpace.java). Lucene ANN cosine instead returns `(1+cosine)/2`, and Euclidean returns `1/(1+squaredDistance)`, as shown in [Lucene's vector similarity implementation](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/index/VectorSimilarityFunction.java). NMSLIB cosine uses a different monotonic translation, `1/(2-cosine)`, via [OpenSearch's SpaceType translation](https://raw.githubusercontent.com/opensearch-project/k-NN/2.11/src/main/java/org/opensearch/knn/index/SpaceType.java).

Compare rankings and independently defined relevance, not average `_score`. A numeric threshold must be recalibrated for each metric, representation, and scoring path.

## Why changing the metric alone may disappoint

1. **Query scale matters outside cosine.** Run a literal raw-query swap to show its behavior, but separately compare L1/L2/linf with `r`. For instance, wherever every `q[i] >= p[i]`, raw L1 is `sum(q)-1`, so different wallpapers tie. Arbitrarily scaling every requested amount changes raw L2 rankings while cosine is invariant.
2. **Cosine can reward many occupied bins.** For a fixed `p·q`, a diffuse histogram has smaller `||p||₂`, hence higher cosine. A broad query can rank multicolored images over images dominated by the requested hue. With a completely flat `q`, inner product ties all unit-sum histograms while cosine favors the most diffuse one.
3. **The default kernel is broad.** With sigma 0.3, a bin at OKLab distance 0.3 still receives weight `exp(-0.5) ≈ 0.607`. Smaller spread and a metric change are separate variables; benchmark them separately.
4. **Binning has hard discontinuities.** Close colors on opposite sides of a hue, saturation, value, or achromatic boundary go to different coordinates. Pure red and a darker orange-red can share one broad bin. Ordinary L1, L2, cosine, and Hellinger do not understand neighboring bin colors.
5. **Requested amounts do not automatically mean palette percentages.** Summing raw kernels lets colors whose kernels cover more centers contribute more total mass. To model palette proportions, normalize each color kernel first, then mix using amounts that sum to one. Conversely, inner product with mixed queries measures average affinity and does not require every requested color to be present.
6. **This feature currently sorts.** Top-k retrieval still returns weak matches when no strong match exists. A useful strict filter requires an independently validated relevance threshold or minimum color coverage.

## Further prototypes worth comparing

### A. Direct perceptual coverage

Keep a sampled pixel set or a weighted palette of OKLab colors. For a single requested color `c`, score:

```text
coverage(c) = sum_j pixelWeight[j] * exp(-||pixelColor[j]-c||²/(2*tau²))
```

This is our proposed smooth coverage score. It removes the hard HSV-bin center approximation and has a direct interpretation: more near-matching pixels raise the score. Also measure hard coverage within several distances to explain results visually. OKLab Euclidean distance is described by [CSS Color 4's ΔEOK definition](https://www.w3.org/TR/css-color-4/#deltaEOK) and [the original OKLab presentation](https://bottosson.github.io/posts/oklab/). A nearest-pixel-only score is unsuitable because a tiny accent can dominate it.

For several colors, separately evaluate “contains each color” with a minimum/per-color coverage requirement and “matches these proportions” with a palette-distribution metric. These are different product meanings.

### B. Perceptual transport for palette proportions

Earth Mover's Distance transports color mass between palettes with the color distance as cost. Nearby colors can match despite falling into different histogram bins. [Rubner, Tomasi, and Guibas](https://ai.stanford.edu/~rubner/papers/rubnerIjcv00.pdf) develop this approach for image retrieval.

For equal-total-mass palettes, use cost `C[i,j] = OKLabDistance(color[i], queryColor[j])`, flows `f[i,j] >= 0`, row sums equal image weights, column sums equal query proportions, and minimize `sum(f*C)`. This is a reranker or offline quality reference, not a native OpenSearch 2.11 vector space. Quantize to a modest weighted palette before considering production cost. Balanced transport intentionally penalizes unrelated background mass; partial matching needs a different objective.

### C. Finer or soft perceptual embeddings

As a cheaper retrieval representation, assign colors to a finer OKLab codebook or smoothly to nearby centers. Test square-root/cosine and raw inner product on that representation. A larger vector alone is not evidence of improvement; measure ranking against the same independently assessed queries.

## Evaluation safeguards

- Keep the exact current extraction and query construction as the named baseline.
- Fix the corpus and record each source URL, downloaded-file hash, sampling method, and any crop/resize. Inspect thumbnails for diversity across hue, brightness, saturation, gradients, monochrome scenes, and small accents.
- Include primary colors, boundary hues, pastels, dark shades, white/gray/black, and multi-color queries with unequal proportions. Record spread values.
- Preserve at least a held-out query set if tuning sigma or thresholds. Results on the same queries used to choose parameters are exploratory.
- Automated pixel-coverage metrics are useful proxies, not human ground truth. Do not declare coverage scoring the winner solely because it optimizes the same coverage formula used as the judge. Add blinded visual comparisons and controlled cases with known color proportions.
- Use all 100 candidates for the exact comparison. Measure ANN top-k recall against each metric's own exact top-k; reranking cannot recover a relevant wallpaper omitted by candidate generation.
- Record raw scores, ranks, timings, full parameters, and query vectors. Handle ties deterministically and distinguish mathematical ties from float32 rounding.
- A 100-wallpaper run can establish correctness and expose quality failures. It does not establish production latency, index size, pagination behavior, or stability at millions of wallpapers.

## Suggested comparison order

1. Current Lucene/cosine versus raw inner product and normalized L2, holding extraction and query spread fixed.
2. L1/intersection, linf, and Hellinger to cover the supported histogram comparisons.
3. Tune spread independently and compare per-color-normalized mixtures for palette queries.
4. If coarse-bin failures remain, compare direct OKLab coverage and perceptual palette transport.
5. Choose retrieval and any reranking design only after visual review, then verify its actual OpenSearch 2.11 execution path and migration cost.

## Independent relevance implementation

`relevance.ts` evaluates sampled pixels directly, without importing the production histogram, OKLab transform, or candidate algorithms. Its thresholds were fixed before inspecting candidate results:

- **Lab20 / Lab30 / Lab40:** alpha-weighted fraction of pixels within Euclidean CIELAB D65 distance 20, 30, or 40 of each requested color. Radius comparisons include the boundary. This uses the CIE 1931 2-degree D65 white point `(0.95047, 1, 1.08883)`, with no D50 chromatic adaptation.
- **HSV:** hue distance at most 25 degrees, saturation difference at most 0.3, and value difference at most 0.3. Hue wraps at 360 degrees. For a query with saturation below 0.1, ignore hue and require pixel saturation below 0.15 and value difference at most 0.2.
- **Several colors:** weighted geometric mean of the individual coverages, with normalized requested amounts as weights. If any requested color has zero coverage, the combined score is zero. Per-color coverages remain available. This measures presence, not agreement with palette proportions; overlapping color neighborhoods may count a pixel more than once.
- Transparent pixels contribute zero. Other pixels contribute `alpha/255`; RGB is not composited against an assumed background. Completely transparent or empty samples have zero coverage.

`preparePixels` converts the sample once into a packed typed array. `measureMany` reuses those conversions and caches coverage for repeated query colors. Single-query callers may pass raw RGBA bytes to `measureRelevance`.

### Conversion and controlled-case verification

Executed an independent assertion script on 2026-09-15. These D65 values were produced:

| sRGB bytes | L* | a* | b* |
| --- | ---: | ---: | ---: |
| 255, 0, 0 | 53.24079 | 80.09246 | 67.20320 |
| 0, 255, 0 | 87.73472 | -86.18272 | 83.17932 |
| 0, 0, 255 | 32.29701 | 79.18752 | -107.86016 |
| 255, 255, 255 | 100.00000 | -0.00002 | 0.00001 |
| 0, 0, 0 | 0.00000 | 0.00000 | 0.00000 |

Red, blue, white, and black agree within 0.03 per component with [scikit-image's published conversion test references](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/color/tests/test_colorconv.py); small differences reflect rounded XYZ reference inputs and transformation coefficients. White/black endpoints and primary hue angles were also checked.

Controlled assertions passed for 75% red / 25% blue area coverage, geometric aggregation, a missing requested green color, scaling all query amounts, partial alpha weighting, transparent/empty samples, hue wraparound, grayscale matching, raw/precomputed parity, repeated-query parity, and invalid input handling. The 75/25 palette's combined score is `0.75^0.75 * 0.25^0.25`, explicitly demonstrating that this is a coverage proxy rather than a composition score.

These measurements provide a separate evaluation lens. CIELAB ΔE76 and rectangular HSV tolerances are imperfect perceptual models, and the selected radii are broad relevance neighborhoods, not just-noticeable differences. Visual review remains necessary.
