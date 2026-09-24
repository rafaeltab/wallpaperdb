# Refinement decisions and rejected directions

These decisions select experiments to spend time on. They do not select a production architecture. Every registered implementation remains available for comparison; failed measurements remain in the saved artifacts.

## Why the second rounds changed more than vector distance

The first feedback run found no gain from raw L2 over HSV cosine on their shared 20 judged cases: both scored 54.0% pairwise agreement. Unit-sum L2 and Hellinger also failed to improve that development result. Palette/area methods improved agreement on the same cases, while supporting additional intents. Changing only the distance did not address the meaning of area, vividness, grayscale and unspecified remainder.

## Refinements actually built

| Observation | Experiment | What was learned |
|---|---|---|
| Fine-histogram scripts were extremely expensive even on a small corpus. | Typed Painless loops with unchanged formulas. | Small-corpus p95 fell from roughly 480–540 ms to 7–8 ms with score/order parity. Million-document full scans still fail. |
| Partial queries charged too little requested color twice through an outside-color penalty. | Separate partial and complete palette objectives; graded quality and stronger excess penalty. | Better agreement on the development cases and explicit user-intent checks. Free remainder still cannot absorb excess requested color. |
| Exact named-feature composition scanned every eligible document. | Native seed, exact service seed scores, necessary numeric bounds, then global exact scoring. | Retained measured exact order. Refined named intent passed 50 scheduled requests/second at one million documents, but failed 100/second. |
| Coarse RGB cell centers erased much of some images' grayscale area. | Direct original RGB24 palette centroids. | Removed most of the observed membership loss; the 32-color palette remains lossy. Direct full scans failed at a million documents. |
| More exact-color area should not always beat a smaller patch of the same precise shade. | Shade quality with matching-area support saturated at 5%. | Preserved precision preference behavior, but the support rule makes safe global pruning weak for broad neutral colors. |
| Dark scenes can contain visible highlights without absolutely bright pixels. | Relative lightness and highlight-tail features. | Corrected the observed dark-with-highlights order. Much of the latest agreement gain depends on this single development case. |
| Small ANN result windows missed globally better vector matches. | Native k=500 variants and exact-reference recall diagnostics. | Improved recall; all tested HSV top-20 sets recovered at one million, but some RGB misses remained. No global guarantee. |
| The precise-color loop repeatedly converted RGB to OKLab. | Typed specialization, then precomputed fixed-point OKLab with original arithmetic near range edges. | Exact typed parity; precomputed score changes bounded and small, with unchanged tested top-20 sets. The optimized scans still failed the concurrent million-document requirement. |
| Native area scoring was fast but ignored color quality. | Native quality and asymmetric area objectives without scripts. | On the same 28 cases, quality alone did not improve total agreement; asymmetry improved proportions but worsened combinations. Complete-palette purity remains wrong for this objective. |
| Indexed utility postings may support fast competitive skipping. | Precomputed area/vividness utilities using native rank features. | Passed 300 scheduled requests/second at one million documents; failed 500/second. The idle index occupied 13.11 GB and took about 18 minutes to build. Vocabulary and quantization restrict flexibility. |
| Optimized precise-palette scans still fail under OpenSearch concurrency. | One ClickHouse implementation of the same picked-color objective, using globally ordered SQL; then limit threads per request. | Preserved all checked scores/orders. Both thread settings passed serial queries but failed concurrent million-document queries. Reducing threads saved serial CPU without resolving the limit. |
| Native named utilities are fast, but a picked hex color is not in a fixed vocabulary. | Precompute precise-color utilities on an OKLab grid and interpolate at query time using native rank features. | Global ranking remains inside OpenSearch. The million-document grid passed sustained sixteen-client traffic and 50 scheduled requests/second, but failed 100/second. Three judged precision cases improved, but mid-gray top-20 overlap with the continuous objective was only 30%; custom ranges and proportions remain unsupported. |

## Refinements deliberately not built

**Learned ranking and image embeddings:** excluded by the user's resource constraint. No training data or model was produced.

**Locally reranking a fixed candidate set:** does not satisfy the user's global-ranking requirement. Approximate native vector methods are labeled as approximate controls; exact bounded methods run their final ranking over the whole provably eligible set in OpenSearch.

**A palette quality-mass gate:** assessed after existence bounds proved too weak at one million documents. Any precision winner must have matching quality mass at least `threshold × minimumSupport`. Conservative per-cell masses and upper quality estimates could express that necessary condition in native queries before the exact script.

The read-only assessment found limited pruning for difficult neutral queries: dark candidates fell from 419 to 388 out of 545, and gray from 492 to 419. Even ideal exact quality-mass bounds leave most of those documents. The native wrapper also disables competitive skipping and adds 92–733 clauses for default swatches; a broad range needs 4,092 clauses. The extra index/query complexity is not justified by that evidence in this round. See [the detailed assessment](PALETTE-MASS-BOUNDS.md) for proof, service feasibility and source references.

## Rules for interpreting the outcome

- A faster implementation can preserve a weak perceptual objective. Speed and perception are evaluated separately.
- A better aggregate agreement can hide category regressions or support fewer cases. Compare common cases and inspect individual queries.
- A fast named-color branch does not establish that a hybrid's custom ranges are viable.
- One million synthetic descriptors establishes a workload measurement, not realistic million-photo relevance or guaranteed production capacity.
- A request failure or latency at or above one second rejects that tested load, even if successful-request p95 looks good.

The consolidated findings and immutable run reports provide the current measured results. The durable work checkpoint is [PLAN.md](PLAN.md).
