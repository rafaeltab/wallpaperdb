# Independent benchmark audit

Audited on 2026-09-15. Scope: `models.ts`, `benchmark.ts`, `relevance.ts`, and `pipeline.ts`, plus the imported production extraction/query code and saved evidence. The reviewer made no implementation changes. Findings were sent to the implementing agent, who applied the fixes below. Numeric observations explicitly marked **pre-fix** must not replace the final results.

## Material issues found and corrected

### 1. Palette initialization mutated a source color during clustering

**Location:** `models.ts`, initial `centers` assignment in `palette()`.

The initial center referenced the most frequent input point's `lab` array directly. Later in-place centroid updates therefore changed an input point. Subsequent iterations fitted a moving input distribution, biasing the palette toward other colors. Other initial centers were already copied.

Minimal reproduction: 99 opaque red pixels and one opaque blue pixel, calling `palette(pixels, 1)`. A one-center weighted palette must equal `0.99 * OKLab(red) + 0.01 * OKLab(blue)`.

| | L | a | b |
| --- | ---: | ---: | ---: |
| Expected | 0.6261959442 | 0.2222898606 | 0.1214725541 |
| Before fix | 0.6018205969 | 0.1866401680 | 0.0608777234 |
| After fix | 0.6261959442 | 0.2222898606 | 0.1214725541 |

The original OKLab error was **0.0744096206**, material relative to sigma 0.06. Cloning the first center fixes it. The reviewer reran the actual function after the change with an assertion requiring error below `1e-12`; the observed error was zero. Final palette results require a full benchmark rerun after this fix.

The fixed sixteen-iteration Lloyd procedure may stop before assignments fully stabilize. That is an approximation choice, not the aliasing bug: final centers are weighted means of the last assignments, weights sum to one, and the input points remain fixed. No additional clustering correctness failure was identified.

### 2. Undefined nDCG queries were removed from other aggregate metrics

**Location:** `benchmark.ts`, summary aggregation.

The original code filtered out rows where `ndcg10 === null` before computing every summary statistic. Thus a no-match query such as lime was absent from precision and coverage averages, even though its precision and coverage are well-defined zeros. Documentation only promised exclusion from mean nDCG.

The correction uses all query rows for precision/coverage and only defined rows for nDCG, recording both counts. Example from the pre-fix Lab30 holdout run: palette precision was reported as 0.6846 over thirteen queries instead of 0.6357 over all fourteen. The relative ranking did not change, but the absolute quality claim was inflated.

### 3. Geometric-mean coverage did not enforce substantial area for every color

**Locations:** `relevance.ts` aggregation and `benchmark.ts` binary relevance threshold.

The weighted geometric mean is a reasonable continuous ranking proxy for multiple colors, but a mean above 10% does not imply at least 10% of each color. For example, 50% black and 2% red give a 10% geometric mean. In the original Lab30 results, black-red had six aggregate-positive images but only one with at least 10% of both colors. Wallpaper 027 had roughly 73% black and 1.7% red yet passed the old threshold. Pink-teal had one aggregate-positive image and no image with 10% of each.

The correction defines binary relevance with `perColor.every(coverage >= .1)`, while retaining the geometric mean for continuous nDCG/coverage. Documentation and report labels must preserve this distinction. The added answerable-query nDCG uses availability under this stricter binary rule.

## Interpretation limits to preserve in conclusions

### The holdout is a query split on the same images

All queries search the same 100 wallpapers. This is a fixed query holdout, not validation on previously unseen wallpapers or production traffic. Alternating the named color list also creates different query difficulty: the holdout has many muted/dark colors with abundant matches, whereas the development set contains several vivid colors with almost no matches. Do not attribute higher holdout scores to stronger generalization.

Choose a candidate and its sigma using development results, then report the corresponding holdout result. Displaying all candidate holdout scores for transparency is acceptable, but further tuning after inspecting them makes subsequent comparisons exploratory. The original development results already favored palette sigma 0.06 and RGB sigma 0.08; the audit does not recommend selecting settings from the holdout table.

### Coarse corpus color diversity is not exact-shade relevance

The corpus has several substantial coarse yellow/green/pink areas, but this does not imply coverage near maximally saturated query swatches. In the saved Lab30 evaluation before the palette fix, which does not affect relevance calculations:

| Query | Maximum matching pixel fraction among all 100 | Images with at least 10% |
| --- | ---: | ---: |
| `#FFFF00` yellow | 0.0003255 | 0 |
| `#80FF00` lime | 0 | 0 |
| `#00B040` green | 0.0064019 | 0 |
| `#FF00FF` magenta | 0.0002713 | 0 |

A nonzero ideal DCG can therefore be determined by a tiny accent or a handful of sampled pixels. Report availability and answerable-query quality alongside the broader nDCG table. Do not claim successful strict yellow/lime filtering from this corpus. Source colors, sampling bias, and near-duplicate scenes are documented in [CORPUS.md](CORPUS.md).

### Palette and vector methods have different multicolor semantics

The RGB and HSV query mixtures use arithmetic sums of affinities; palette scoring uses a geometric mean over per-color affinities. Consequently, multicolor improvements combine a better descriptor with an explicit preference for all requested colors. They must not be attributed solely to clustering or palette resolution. Single-color results provide the cleaner descriptor comparison. The four two-color queries all use equal requested amounts; these measurements do not validate palette proportions or unequal-weight behavior.

### Native RGB recall does not establish palette reranker recall

The Faiss check measures RGB ANN top-ten recall against exact RGB rankings. It does not measure whether those candidates include palette's preferred results. In the pre-fix run, RGB sigma 0.08's twenty candidates contained only five of palette's top ten for black-red and seven for forest, despite perfect RGB ANN recall. Those figures must be recomputed if used after the palette fix.

This concern was addressed by adding restricted reranking simulations in `analysis.json`. The reviewer independently reproduced all 112 saved shortlist top-ten lists, recalls, and Lab30 nDCG values from the final rankings. For the holdout, RGB sigma 0.08 → palette sigma 0.06 gives:

| RGB shortlist | Mean palette top-ten recall | Worst recall | Lab30 nDCG@10 |
| --- | ---: | ---: | ---: |
| 20 | 0.9214 | 0.5 | 0.8288 |
| 50 | 0.9929 | 0.9 | 0.8714 |

These simulations use recorded **exact RGB rankings**. They measure descriptor-shortlist loss; they are not live end-to-end ANN reranker tests at 50 candidates. The all-100 palette result remains a quality reference. Neither the Lucene checks with `k=10000` over 100 documents nor the small Faiss experiment establishes recall at production scale.

### Timings are diagnostic observations

Recorded elapsed time includes query generation, network calls, result validation, local formula checks, and extra native queries for some methods. Application palette scoring has different work inside its timer. These are not comparable production latency measurements. Descriptor timing also includes the independent relevance calculations. Avoid claiming one method is faster from these totals.

### These are ranking prototypes with automated relevance proxies

CIELAB ΔE76 and HSV thresholds are independently implemented proxies, not human ground truth. They differ from the candidates' OKLab Gaussian score but share the intended area-coverage goal. Include visual evidence and sensitivity across thresholds; do not describe the numbers as user satisfaction or perceptual accuracy percentages.

Smooth palette affinity is not a hard matching-pixel percentage. Gaussian kernels assign positive affinity even to distant colors. A usable strict filter still needs a calibrated minimum-coverage/no-match policy. The current experiment principally measures ranking quality.

## Checks that passed review

- **Production path fidelity:** the baseline imports the real image reader port adapter, Sharp histogram provider, HSV embedding strategy, event publishers/consumers, processor, gateway projection and repository. File bytes are checked against the frozen manifest. HTTP, S3, authentication, initial upload projection, and GraphQL are deliberately bypassed and explicitly documented.
- **Live pipeline evidence:** 100 extracted and projected histograms, matching extraction/projection values, identical cosine/L2 documents, 200 real NATS messages, acknowledged consumers without pending/redelivered messages, and native repository score checks. This supports the claimed color pipeline exercise, not a complete product E2E test.
- **Raw-image channel assumptions:** the reviewer decoded the relevance sample from all 100 source files using the benchmark's Sharp chain and checked output metadata. All produced four channels. Original metadata included 98 sRGB, one `rgb16`, and one grayscale image; all listed EXIF orientations were 1. No corpus-specific RGBA-stride failure was found.
- **Normalization:** production histograms sum to one; normalized L2/L1/L-infinity use a unit-sum query; Hellinger takes square roots of both probability histograms. The L1/intersection ranking equivalence is valid under this normalization.
- **Score translation:** exact cosine uses `1 + cosine`; Lucene native cosine uses `(1 + cosine) / 2`; L2 uses squared Euclidean distance with `1 / (1 + d)`; nonnegative inner product uses `1 + dot`. These match the documented [OpenSearch 2.11 exact-score definitions](https://docs.opensearch.org/2.11/search-plugins/knn/knn-score-script/) and the repository's linked Lucene source. The saved pre-fix exact-score maximum error was about `6.02e-7`.
- **CIELAB/HSV evaluator arithmetic:** RGB linearization, D65 matrix/white point, Lab piecewise transform, hue wraparound, alpha weighting, and positive-weight geometric aggregation are consistent with the stated definitions. The evaluator reads an independently downsampled higher-resolution source sample and does not call the palette or histogram scorer.
- **Scope of the conclusion:** the consistent advantage across proxy thresholds can support a recommendation for further production work after corrected results and visual inspection. It cannot establish production-scale cost, generalization to unseen image populations, exact palette composition, or a final strict-filter threshold.

## Final verification state

The implementing agent applied all three material fixes and reran the benchmark. The reviewer inspected the corrected source, reran the centroid reproduction, independently recomputed every final per-query availability and precision value, and checked all holdout precision means use fourteen query rows. Both selected candidates were independently confirmed to maximize the stated development-only criterion within their families. All 112 restricted-reranking analyses were independently reproduced.

Audited final `results.json`:

- Generated at: `2026-09-15T22:31:55.817Z`.
- SHA256: `3906b8cd6a92f5397bae668208cc69f2f41154f4c0a6a97255ddec412a6af179`.

This final snapshot follows the complete Make workflow after source formatting and source-fingerprint capture. All eleven recorded `sourceHashes` were independently checked against the current files. Every shared summary field matches `results.json`; all twelve embedded report-data fields match the corresponding result fields, including corpus, queries, algorithms, rankings, relevance, and summaries. All 140 recorded native recall checks equal one. The headline score summaries remain unchanged from the previous audited run.

| Final Lab30 holdout result | nDCG@10 | Precision@10 |
| --- | ---: | ---: |
| Current cosine | 0.2899 | 0.4643 |
| Raw L2 | 0.4098 | 0.4857 |
| RGB 512, sigma 0.08 | 0.7048 | 0.5643 |
| Palette 32, sigma 0.06 | 0.8712 | 0.6000 |

nDCG uses thirteen queries with nonzero ideal relevance; precision uses all fourteen. Precision requires at least 10% area for **each** requested color. No unresolved material arithmetic or result-aggregation blocker was found in this audited snapshot. `FINDINGS.md` was checked against the retained evidence; no material unsupported claim was found. The interpretation limits above remain necessary. Browser layout/rendering and any later changes to results are outside this snapshot's independent verification.
