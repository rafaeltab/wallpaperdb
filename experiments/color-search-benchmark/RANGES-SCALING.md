# Color ranges and scaling to 1M / 100M wallpapers

Research date: **2026-09-16**. This note describes a proposed architecture, source-verified OpenSearch capabilities, and storage arithmetic. **Neither a 1M nor a 100M wallpaper search has been benchmarked.** The [range evaluation](RANGES-EVALUATION.md) now measures seven range presets over 100 real wallpapers. It demonstrates useful local scoring performance and substantial errors at some narrow boundaries; it does not establish production retrieval recall or latency.

## Recommendation

Use a compact palette to estimate whether an image has the requested proportions of allowed colors. Use OpenSearch to retrieve a bounded set of plausible candidates before that calculation. Tight range limits require a better boundary representation or final pixel verification: the measured palette outlier below shows that even 128 representatives can lose substantial valid area. A one-million-image deployment looks reasonable to investigate with this design. At one hundred million, candidate recall, distributed retrieval, and concurrent query cost need substantial validation; there is no evidence yet for an interactive latency or cost claim.

The key distinction is **finding the candidates versus judging them**. Checking whether one image is approximately 70% red-ish and 30% dark is a small computation. Finding the best such images among 100M without examining them all is the unresolved retrieval problem.

## What a range query means

A region describes allowed colors; an amount describes how much image area should belong to that region. For example:

```text
Region A: a red hue interval, a saturation interval, and a brightness interval
Amount A: 70%, optionally with an explicit amount tolerance
Region B: a low-lightness interval, with hue unconstrained
Amount B: 30%
```

RGB / HSV / HSL boxes and OKLab boxes or distance neighborhoods can share the same stored palette. Convert its representative colors to the requested space, then evaluate membership. A box in HSV is generally not a box in RGB; hue intervals must wrap through 360° correctly, and achromatic colors need explicit treatment because their hue is not meaningful.

The requested default now distinguishes **area membership from shade preference**. Every color inside the region counts fully toward the requested area. Among equally good compositions, prefer the core of the region at 100% quality and its edge at 50% quality. The proposed preference is `2^(-r²)`, where `r` is the largest normalized distance from the center along a constrained box axis. Unconstrained axes do not contribute. Thus an image with 70% edge-red still has 70% qualifying red area; its shade preference is weaker than core-red. Use lexicographic optimization—minimize composition error first, then maximize shade quality—so preference cannot buy a worse composition. Flat membership remains a useful reference mode. These are custom ranking semantics, not a native L2 vector distance.

**Overlap needs one declared meaning.** “70% red-ish and 30% dark” can describe overlapping marginal coverages, or an exclusive composition in which each pixel supplies at most one portion. The proportion prototype uses the latter conservation rule. Dark-red pixels may qualify for both regions, but their weight must not be counted twice. Matching the capacities jointly may need a small flow/allocation calculation. Independently summing matching weights for each region is insufficient.

For a partial query, also specify what the remainder permits. If “40% green, 60% other” should penalize 80% green, the remainder cannot absorb unlimited excess green for free. These semantics affect candidate retrieval as well as the final scorer.

## What is already measured

The [range evaluation](RANGES-EVALUATION.md), generated **2026-09-16T14:03:41.666Z**, covers seven editor presets and 100 real wallpapers. Its [raw results](ranges-evaluation.json) compare palette memberships against both a separate sample of up to 256×256 pixels and the approximately 10,000 pixels used to construct the palettes.

- **Average area error:** 32 representatives differed from the larger pixel sample by **0.772 percentage points** per region on average, and from their own exact input pixels by **0.633 percentage points**. With 128 representatives, the larger-sample difference was **0.574 percentage points**. The average difference between the two pixel samples was 0.265 percentage points; these absolute errors do not add algebraically.
- **Ranking stability:** graded32 retained **82.9% average top-ten overlap** with graded128. Agreement with another compressed representation is not proof of correctness.
- **A large boundary failure:** for the grayscale region with HSL saturation ≤2%, both 32- and 128-color palettes reported **0%** qualifying area in `wallpaper-088`. Their exact input pixels contained **35.00%**, and the larger pixel sample contained **37.64%**. This is predominantly clustering error, not a problem solved by increasing the sample or simply switching to 128 representatives. A centroid can fall outside a narrow region while many represented pixels are inside it.
- **Useful proportion examples:** the first graded result for 70% dark grayscale estimated 70.05% area versus 70.55% in the larger pixel reference. The first result for 70% dark with unrestricted hue/saturation estimated 69.64% versus 69.00%. These examples demonstrate the intended behavior without erasing the boundary outlier.
- **Local scoring cost:** query medians ranged from **0.99–2.03 ms** in flat hard mode and **1.38–7.94 ms** with graded center preference, to score and sort 100 already-prepared 32-color palettes. Each query was compiled once; there were two warmups and seven measured runs. Extraction, compilation, candidate retrieval, OpenSearch, network, and rendering are excluded.

The pixel reference implements membership independently, but shares the declared regions, OKLab conversion, and allocation solver. It checks approximation for these mathematical regions, not human relevance. The older [point-color proportion evaluation](PROPORTIONS-EVALUATION.md) found 97.5% top-ten overlap for 32 versus 128 representatives; that result does **not** transfer to range queries. Its older transport timings likewise do not measure the new scorer.

At either 1M or 100M images, narrow boundaries need finer representations or source-pixel verification, and retrieval must preserve candidates whose coarse palettes undercount valid pixels. A final verification pass cannot recover an image already rejected during candidate retrieval. Do not extrapolate these local 100-image timings into a production latency estimate.

## The actual OpenSearch baseline

The repository pins **OpenSearch 2.11.0** in `infra/docker-compose.yml`. Gateway stores a 64-dimensional HSV histogram using Lucene HNSW / cosine in `apps/gateway/src/opensearch/mappings.ts`. Its current search uses `k = 10,000` and places metadata filters outside the `knn` clause in `wallpaper.repository.ts`.

### What 2.11 can accelerate

| Requirement | Available mechanism | Important boundary |
| --- | --- | --- |
| Metadata or fixed color-mass bounds | Indexed numeric fields with `range` clauses | Only works directly for values already stored per image |
| Approximate histogram candidates with filters | Lucene or Faiss `knn`, with `filter` inside the vector query | This filter placement differs from the current Gateway query |
| Exact distance over a small filtered subset | `script_score` / `knn_score` | Work grows with the subset examined |
| Rerank top results | Application scoring, or generic top-level query `rescore` | Only retrieved candidates can be reranked |
| Arbitrary palette-region mass and exclusive amounts | Custom query-time logic | No native vector distance directly expresses this general objective |

OpenSearch 2.11 supports numeric `gte` / `lte` filters, and numeric mapping options include `float`, `short`, and `scaled_float`. A `range` query tests a field; it does not sum weights of all palette colors within a three-dimensional region. [Range query](https://docs.opensearch.org/2.11/query-dsl/term/range/), [numeric mappings](https://docs.opensearch.org/2.11/field-types/supported-field-types/numeric/).

The version-specific filtering documentation distinguishes inline filtering from Boolean post-filtering. Lucene HNSW and Faiss HNSW/IVF support inline filters; a filter outside `knn` may leave fewer than `k` results. The implementation can switch between exact and approximate search depending on the filtered set. [OpenSearch 2.11 k-NN filtering](https://docs.opensearch.org/2.11/search-plugins/knn/filter-search-knn/).

**Documentation caveat:** the 2.11 approximate-search overview still contains an older blanket statement about post-filtering. The dedicated 2.11 filtering page above explicitly documents the newer inline path. Use that path's examples and verify the exact deployed engine/query combination.

### Script scoring and rescoring limits

- `script_score` computes a score for documents matched by its inner query. Setting response `size: 20` does **not** mean an expensive script only evaluates 20 documents. A script over `match_all` is a scan, not an index for the custom objective. `knn_score` is explicitly documented as brute-force search. [2.11 script scoring](https://docs.opensearch.org/2.11/query-dsl/specialized/script-score/), [2.11 exact k-NN scoring](https://docs.opensearch.org/2.11/search-plugins/knn/knn-score-script/).
- Generic top-level `rescore` already exists in 2.11. It takes a top-results window and combines first- and second-stage scores. This is distinct from the newer vector-specific `knn.rescore` option. Source inspection confirms the top-window behavior in [2.11 QueryRescorer](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/search/rescore/QueryRescorer.java) and its invocation during the shard query phase in [2.11 QueryPhase](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/search/query/QueryPhase.java).
- The rescore window applies **per shard**, before final merging. It cannot recover an image omitted by the first-stage ANN search. Candidate `k`, rescore window, shard count, and returned `size` are different budgets. The 2.11 k-NN limit is `k <= 10,000`; this is not a guarantee of 10,000 globally optimal composition candidates. [2.11 approximate search](https://docs.opensearch.org/2.11/search-plugins/knn/approximate-knn/).
- Gateway's current explicit `_score` plus wallpaper-ID sort cannot simply be retained with generic rescoring: 2.11 rejects a non-null sort alongside rescore, and enforces a maximum rescore window. Application reranking is the simplest way to retain a deterministic final ID tie-break and control pagination. [2.11 DefaultSearchContext validation](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/search/DefaultSearchContext.java).
- If a rescore implementation should replace the retrieval score, configure the score combination deliberately. The default adds scores; adding cosine to a composition score would change the intended objective. Run compatibility and score-equivalence tests on 2.11 before moving custom scoring into OpenSearch. This research did not run a live rescore probe; the scratch endpoint was stopped.

### Features that must not be assumed on 2.11

- Vector radial search using `max_distance` / vector `min_score` is a **2.14** feature. This is different from the older general script-score threshold. Even radial vector search does not express arbitrary color-region composition. [2.14 radial search](https://docs.opensearch.org/2.14/search-plugins/knn/radial-search-knn/).
- Query-level `method_parameters` arrived in **2.16**. [Current k-NN query documentation, version annotation](https://docs.opensearch.org/latest/query-dsl/specialized/k-nn/index/).
- `mode: on_disk` arrived in **2.17**; its compressed-vector retrieval and vector-specific rescoring are not the 2.11 baseline. [Disk-based vector search](https://docs.opensearch.org/latest/vector-search/optimizing-storage/disk-based-vector-search/). The [2.11 k-NN query parser](https://raw.githubusercontent.com/opensearch-project/k-NN/2.11/src/main/java/org/opensearch/knn/index/query/KNNQueryBuilder.java) does not define these new query options.

Lucene byte vectors and Faiss product quantization do exist in 2.11, but they require separate quality checks. Lucene 2.11 ANN supports cosine/L2; Faiss supports L2/inner product, with a restriction on HNSW inner product plus PQ. Upgrading may improve operational choices, but does not by itself solve the query semantics. [2.11 methods and encoders](https://docs.opensearch.org/2.11/search-plugins/knn/knn-index/).

## Proposed three-stage search

This is a design to benchmark, not an implemented service change.

```mermaid
flowchart LR
    Q[Regions + amounts] --> C[Compile regions and amount constraints]
    C --> R[OpenSearch candidate retrieval]
    R --> U[Union and deduplicate candidates]
    U --> P[Palette membership + conserved allocation]
    P --> V[Optional finer verification of top results]
    V --> O[Ranked images + estimated proportions]
```

### 1. Retrieve candidates cheaply

At ingestion, keep one moderate-size retrieval histogram and a small fixed set of indexed mass summaries, alongside the palette. Examples of fixed summaries are dark/light fractions, broad hue-family fractions, and saturation fractions. Version their definitions with the extraction output so the NATS projection cannot silently mix representations.

For standard named presets, exact precomputed mass features can be particularly useful: “red-family mass between 65% and 75%” is a numeric range filter if that exact family definition was indexed. For arbitrary user-drawn regions, fixed features provide only coarse evidence. They must not be treated as exact counts for a different region.

Choose between two paths:

1. If metadata and safe mass bounds leave a small set, fetch and score that whole set.
2. Otherwise retrieve several candidate lists with inline metadata filters, then union them. Prototype a composition-histogram query, per-region presence queries, and complementary dark/light or background queries. Start experiments with total candidate budgets such as 200 / 1,000 / 5,000; these are test settings, not promised sufficient sizes.

For supported preset regions, indexed upper and lower amount bounds can reduce the search space directly. For arbitrary regions, conservative bounds can also be built from color cells: sum mass in cells fully inside the region for a lower bound, and cells intersecting it for an upper bound. A target interval cannot match if the upper bound is below its minimum or the lower bound exceeds its maximum. This is a proposed geometric bound, not a built-in OpenSearch range query. Overlap/allocation semantics require joint bounds; do not apply an independent marginal upper-bound test when mass can legitimately be assigned to another overlapping region.

**Why one ANN query is insufficient:** a range can contain many very different valid palettes. A uniform target histogram implicitly asks for particular within-range proportions that the user never requested. A nearest-center query favors a narrow shade, and still cannot express an unconstrained hue or the rule that composition takes priority over shade preference. Presence/dot-product retrieval can prefer 100% red over a requested 70% red. Adding unrestricted remainder colors creates still more valid modes. No single fixed cosine/L2 query is known here to preserve the ranking of this general, query-dependent objective. Multiple probes improve coverage empirically; they do not provide an exact-recall guarantee.

### 2. Rerank the bounded union

Batch-fetch palette records for the candidate IDs. Evaluate each representative against each requested region, then calculate amount error with the same conservation and remainder rules used by the UI. For `C` candidates, 32 palette entries, and `R` regions, membership alone uses about `C × 32 × R` tests. With `C=1,000` and `R=5`, that is **160,000 membership tests** before any overlap-allocation work; scanning 100M images would require **16 billion**.

For the **flat hard-membership reference**, aggregate palette weights by a membership bitmask before solving the allocation. With `R` regions there are at most `2^R` patterns: at most two for one region and four for two regions, regardless of the original palette size. Identical cost rows can therefore collapse into a much smaller flow problem. For the **graded default**, two colors can share a membership mask but have different shade preferences; aggregate only identical complete cost rows or the secondary objective changes. Graded reranking cost more than flat membership on the measured presets above; benchmark both on the eventual candidate workload rather than reusing older Gaussian-transport timings.

Bitsets and pre-binned aggregates are additional acceleration options. A bitset can encode which palette entries or color cells intersect each region; weighted sums and membership-pattern aggregation still need the corresponding masses. Fixed cell IDs may support cached unions for recurring queries. Counts from cell centers are approximate at region boundaries, however: exact membership of a center is not exact mass for all pixels in its cell. Conservative intersecting/contained-cell bounds or finer verification are necessary when hard-filter recall matters.

Start in the Gateway/application scoring path, where the existing TypeScript logic can be validated directly. Cache packed palette records near the scorer, batch reads, and avoid a request per wallpaper. A later shard-local script/plugin could reduce palette transfer, but would move CPU into the search cluster and needs independent profiling. A scoring script does not make the custom operation indexable.

Return estimated assigned proportions and a distance/error, so “closest available” is distinguishable from a match within an amount tolerance. Cache a fixed candidate/result set for pagination, or explicitly define retrieval depth; reranking a changing candidate window is not globally stable pagination.

### 3. Verify boundaries where needed

For the best tens of results, optionally evaluate a finer palette or a cached pixel sample. This helps when a narrow region cuts through a coarse cluster. Store cluster bounds or radii if useful for identifying uncertain cases. Sampling and palette compression remain approximations; a claim of exact full-resolution percentages would require appropriately precise source analysis.

For common queries, stages 2 and 3 may collapse into one palette pass. For arbitrary tight boundaries, retain the separate verification step until its error is characterized.

## Storage and memory arithmetic

All sizes below are **estimates from representation sizes**, in decimal GB (`1 GB = 10^9 bytes`), for one copy unless stated otherwise. They exclude images, IDs, index structures unless explicitly included, `_source` serialization, stored/doc-value duplicates, compression effects, object overhead, caches, shards, merge headroom, and replicas.

### Raw numerical payload

| Representation | Bytes / image | 1M images | 100M images |
| --- | ---: | ---: | ---: |
| 32-color palette: 3 coordinates + weight, float32 | `32 × 4 × 4 = 512` | 0.512 GB | 51.2 GB |
| 64-bin float32 retrieval histogram | 256 | 0.256 GB | 25.6 GB |
| 128-bin float32 retrieval histogram | 512 | 0.512 GB | 51.2 GB |
| 256-bin float32 retrieval histogram | 1,024 | 1.024 GB | 102.4 GB |
| 512-bin float32 retrieval histogram | 2,048 | 2.048 GB | 204.8 GB |
| Palette + 256-bin histogram | 1,536 | 1.536 GB | 153.6 GB |
| Palette + 512-bin histogram | 2,560 | 2.560 GB | 256.0 GB |

A packed palette does **not** require four copies for four color spaces; conversion can happen for the bounded candidates. Precomputing extra coordinates trades storage for CPU. Retaining both a 32- and 128-color palette adds storage separately.

Palette transfer alone for candidate budgets 200 / 1,000 / 5,000 is approximately **102.4 KB / 512 KB / 2.56 MB** per query in packed binary, before IDs and transport overhead. JSON arrays are not a 512-byte encoding. With 1,000 candidates at 100 queries/second, the packed palette payload alone is 51.2 MB/second if uncached. This is arithmetic, not a throughput measurement.

### HNSW planning estimate

OpenSearch publishes the approximation `1.1 × (4 × dimension + 8 × M)` bytes/vector for HNSW, and notes that a replica doubles vector count. With `M=16`, this gives the following **index-memory planning estimate**, not a measured resident footprint for this repository's Lucene engine. [OpenSearch 2.11 memory estimation](https://docs.opensearch.org/2.11/search-plugins/knn/knn-index/).

| Retrieval dimension | Estimated HNSW bytes / image | 1M images | 100M images | 100M, one replica |
| --- | ---: | ---: | ---: | ---: |
| 64 | 422.4 | 0.422 GB | 42.24 GB | 84.48 GB |
| 128 | 704.0 | 0.704 GB | 70.40 GB | 140.80 GB |
| 256 | 1,267.2 | 1.267 GB | 126.72 GB | 253.44 GB |
| 512 | 2,393.6 | 2.394 GB | 239.36 GB | 478.72 GB |

The HNSW estimate already includes its vector values: do not add the raw histogram table again for the same copy. Add any separately retained raw vectors and palettes only where the implementation actually stores them. If palettes are also fully resident and duplicated, a 256-dimensional HNSW estimate plus palettes with one replica totals about **3.56 GB at 1M** or **355.84 GB at 100M**, before all other overhead. The analogous 512-dimensional figure is **5.81 GB / 581.12 GB**. These are cluster-wide component sums, not node RAM recommendations or full disk estimates.

A hundred million records is therefore not merely “51 GB of palettes.” The retrieval index, replicas, operational headroom, and query concurrency materially change the budget. Quantization can reduce some costs, but boundary errors and candidate recall must be measured after quantization.

**Avoid accidental document multiplication.** Ordinary arrays of objects lose associations between component fields; `nested` preserves associations by creating separate child documents. Representing every palette entry as a nested document would produce up to 32 children per wallpaper—3.2B children plus 100M parents at 100M wallpapers—before other nested fields. That is a different index architecture from storing a packed reranking descriptor. [2.11 nested mapping](https://docs.opensearch.org/2.11/field-types/supported-field-types/nested/).

## Evidence required before making a scale claim

1. **Freeze semantics and a diverse query set.** Include 70/30, low-percentage accents, upper-bound failures, partial queries, overlapping red/dark regions, achromatic queries, hue wraparound, wide regions, tight boundaries, and no-match cases. Separate development and held-out queries and images; duplicated copies of the same 100 wallpapers cannot validate retrieval quality at scale.
2. **Separate approximation errors.** Measure pixels → sampled pixels → 32/64/128 palette → candidate retrieval → final ranking. High ANN recall against cosine ground truth does not establish recall against the range-composition objective.
3. **Build exact reference rankings on a substantial subset.** On an offline reference corpus, run the final region scorer over every image. Measure candidate Recall@10/@100, final regret/nDCG, and violations of amount tolerances for each candidate budget. Report difficult-query tails and recall of rare valid compositions, not only averages.
4. **Validate hard-filter recall.** Approximate numeric summaries and geometric bounds must not silently exclude valid matches. Measure rejection errors near range and amount boundaries. An empty approximate candidate list cannot prove that no valid wallpaper exists in the full corpus.
5. **Benchmark at 1M before extrapolating.** Use realistic palette diversity, shard/replica counts, segment sizes, update rate, and metadata selectivity. Measure end-to-end p50/p95/p99, each search stage, concurrency/QPS, transferred bytes, cache hit rate, CPU, heap/native memory/page cache, disk usage, indexing/merge time, and cold-start behavior. Set an explicit latency and cost target first.
6. **Test 100M deployment behavior separately.** Increase data and shard fan-out progressively; include slow shards, node recovery, replicas, simultaneous ingestion, and candidate union cost. Choose routing only where filters genuinely restrict the search—color queries alone may require searching every shard. A larger cluster distributes work but does not repair a low-recall candidate strategy.
7. **Verify the actual 2.11 DSL and pagination.** Test inline filters, selected engine/metric, score equivalence, candidate/window limits, sorting and stable pages. If using a newer OpenSearch feature, benchmark an explicit upgrade as a separate configuration.

**Decision:** proceed with the range scorer and a candidate-recall experiment. A bounded palette reranker is a credible path for large collections. Efficient arbitrary range-composition search at 1M or 100M remains a hypothesis until both candidate quality and end-to-end cost are measured.
