# Quality-mass pruning assessment: defer implementation

**Decision:** the proposed bound is valid and OpenSearch 2.11 can express it, but real-corpus selectivity does not justify another indexed prototype in this round. It removes few candidates for common dark/neutral colors while introducing hundreds of scoring clauses and disabling the competitive skipping expected from a plain rank-feature search.

This assessment uses the 545 existing descriptors and read-only queries on port 19216. It creates no palette-mass index or runtime method and sends no requests to the million-document node. Artifact: shared `exploration/palette-mass-assessment-2026-09-20T02-01-31.571Z.json`. The earlier 02-01-09 artifact is explicitly marked invalid because an initial diagnostic consumed a membership object as an array; the corrected run adds finite-value assertions and supersedes it.

## Necessary-bound proof

For the picked-color precision objective, let A be matching area, Q the sum of matching area times quality, and s the minimum support (0.05):

`score = Q / max(A, s)`.

An image tying or beating a known service score t must have `Q >= t * max(A,s) >= t*s`. For each indexed RGB cell, multiply its palette mass by an upper bound on the best quality anywhere in that cell. Sum across **every cell intersecting the original requested range**. This produces U >= Q, so `U >= t*s` is necessary. Combine it with the existing high-quality-centroid existence bound without a candidate cap.

Do not restrict this mass sum to cells whose maximum quality exceeds t. Lower-quality cells still contribute to Q; dropping them could discard real winners. Existing exhaustive RGB8 cell extents supply an upper quality by using the lower OKLab distance from the anchor to each padded bounding box in the linear quality falloff. Nonintersecting cells contribute zero.

## Representation and rounding

Aggregate exact palette counts by cell, then round each positive count upward to nine significant bits. For count c, use step `2^max(0,floor(log2(c))-8)` and store `ceil(c/step)*step`. Query boost is conservative maximum quality divided by the fixed palette total, 16384. This avoids Lucene's normal downward truncation; its feature encoding retains the leading nine significant bits and linear scoring multiplies the decoded value by query weight. [Lucene 9.7 FeatureField](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/document/FeatureField.java).

An implementation also needs upward-rounded query weights and a conservative native float product/sum margin. The offline assessment uses an analytic upper sum, lowers the seed score by 0.000002, then lowers the resulting mass threshold by 0.000002. This does not verify an actually encoded palette-mass field. Precomputed OKLab would additionally need its coordinate-rounding allowance incorporated into upper quality.

## OpenSearch feasibility and cost

OpenSearch 2.11 supports `rank_feature` with `linear: {}`. A `bool.should` sum of per-cell features can sit inside `function_score` with `min_score`, then inside the final exact palette `script_score`. No functions are required in that inner `function_score`; its query score passes through. [RankFeatureQueryBuilder](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/modules/mapper-extras/src/main/java/org/opensearch/index/query/RankFeatureQueryBuilder.java), [FunctionScoreQueryBuilder](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/query/functionscore/FunctionScoreQueryBuilder.java).

The implementation creates its inner scoring query with `ScoreMode.COMPLETE` and rejects low scores in a two-phase iterator. The gate can prevent expensive outer scripts from running, but this composition does **not** preserve competitive top-k skipping in the feature sum; it computes cheap mass scores for matching candidates. [FunctionScoreQuery](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java), [MinScoreScorer](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/common/lucene/search/function/MinScoreScorer.java), [ScriptScoreQuery](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/common/lucene/search/function/ScriptScoreQuery.java).

A read-only probe on the existing named rank-feature index verified execution order: 458 positive red-feature matches became 22 above a cutoff of 151. An outer script deliberately threw if a known rejected document was scored. The gated query completed; its ungated control threw the expected exception. This verifies available query composition, not palette-mass performance.

## Selectivity on 545 assets

These use actual ANN-seeded exact palette thresholds and minimum support 5%. No image meeting the threshold was lost.

| Picked color / range | Mass clauses | Existing bound survivors | With mass bound | Additional reduction | With hypothetical exact Q bound |
|---|---:|---:|---:|---:|---:|
| #FF2200 |300|96|58|39.6%|38|
| #4C8C72 |698|453|368|18.8%|293|
| #101010 |92|419|388|7.4%|339|
| #808080 |733|492|419|14.8%|375|
| #DD6600 |464|218|141|35.3%|101|
| #8030B0 |515|95|57|40.0%|20|
| #20B8D0 |561|228|182|20.2%|125|
| #4C8C72, radius 0.4 |4092|533|518|2.8%|515|

Even the hypothetical exact-Q bound leaves most dark and gray candidates, showing cell approximation is not the main weakness. Typical thresholds only require about 3–4% matching quality mass because minimum support is 5%. Many wallpapers easily pass.

An ideal globally exact top-20 seed threshold improves combined counts only to 349 muted green, 387 dark, 409 gray, 124 orange, and 172 cyan; red and purple are unchanged. Broad radius 0.4 still leaves 504 assets. Better seeding alone does not make this selective.

The broad query's 4092 clauses also require attention to the deployed Boolean clause limit. Default colors require 92–733 clauses. Metadata/existence filters may reduce the initial population, but survivors still incur additional feature scoring.

## Recommendation

Keep this valid follow-up outside the prototype registry for now. It might help saturated-color workloads where expensive script candidates often contain only tiny patches. Here it is unlikely to rescue million-document failures for dark, gray, or broad ranges, and no measured million-document benefit offsets its additional native scoring work. Selectivity percentages are not latency predictions.

Reproduce the bounded diagnostic:

```sh
make color-exploration-palette-mass-assessment
```
