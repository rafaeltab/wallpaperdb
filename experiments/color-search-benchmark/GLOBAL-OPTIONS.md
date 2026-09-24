# Global color filtering and ordering: options for OpenSearch 2.11

Research date: **2026-09-16**. This is an option comparison and correctness guide for the next real-OpenSearch experiments. It does not report benchmark results. The repository uses OpenSearch **2.11.0**; newer vector features are not assumed. Follow implementation and measurements in [GLOBAL-WORKLOG.md](GLOBAL-WORKLOG.md).

This revises the emphasis of [RANGES-SCALING.md](RANGES-SCALING.md): a fixed candidate list followed by application reranking is **not the default recommendation**. The goal is to let OpenSearch return the best matches across the entire eligible collection, including images that a different first-stage metric would miss.

## Priorities and the decision still open

The user's priority order is:

1. Perceptual accuracy.
2. Perceived speed.
3. Query flexibility.
4. Reasonable application-service CPU/RAM.
5. Reasonable OpenSearch CPU/RAM.
6. Storage efficiency, which matters less than the preceding goals.

Consequently, richer ingest-time features, a larger indexed region catalog, and explicitly quantized controls are worth investigating if they improve quality and speed. Storage savings alone do not justify a poor representation. Equally, a fixed catalog has **not** been accepted as a product constraint: compare it with arbitrary ranges before choosing. More indexed values also increase ingestion, merging, cache, and query work, so “storage is inexpensive” does not make every representation inexpensive to operate.

## Three different meanings of accuracy

| Question | What establishes it? |
| --- | --- |
| Do the color definitions and ordering match what people want? | Visual judgments on diverse images and queries |
| Does the stored descriptor preserve those colors and amounts? | Pixel-reference measurements, including boundary outliers |
| Does search return the best documents for the declared stored model? | Exhaustive model reference and identical global ordering |

An indexed 1%-bucket query can be globally exact for its discrete model while misordering a 69.6% image against a 70.4% image. A global palette script can inspect every document while still missing gray pixels hidden by a centroid. Conversely, an ANN query can use an excellent descriptor yet miss a global winner. These are separate errors.

The existing [range evaluation](RANGES-EVALUATION.md) matters here: mean 32-color area error was about **0.77 percentage points**, but both 32- and 128-color palettes missed **37.64 percentage points** of a narrow grayscale region in one wallpaper. Precompute important region coverage from pixels or a sufficiently fine histogram, not automatically from that compact palette.

### Marginal coverage is not exclusive composition

For fixed regions, let `a_i` be the fraction of pixels belonging to region `i`, and `q_i` the requested fraction. A simple global objective is:

```text
E_marginal = Σ w_i × |a_i - q_i|
```

This compares each region's coverage independently. It allows the same pixel to contribute to several regions. The range prototype instead conserves area: each pixel can fill at most one requested portion, with explicit remainder semantics. For example, 50% dark-red pixels plus 50% unrelated pixels can satisfy the marginal statement “50% red and 50% dark,” but cannot supply two exclusive 50% portions. Neither interpretation should silently substitute for the other.

For the graded model, **amount error comes first** and center preference second. Within a permitted box, the proposed quality goes from 1 at its core to 0.5 at its boundary; this does not halve the pixel's area contribution. Any indexed alternative must state whether it preserves this ordering or introduces a different tradeoff.

## Option matrix

“Global” below means all documents matching the declared metadata/validity filters, with successful complete search execution. It does not mean exact original-image pixels.

| Option | Global ordering guarantee | Flexibility and quality | Likely operating tradeoff | Prototype priority |
| --- | --- | --- | --- | --- |
| **A. Numeric region coverage + linear `function_score`** | Exact marginal L1 for stored values, subject to score precision | Amounts vary freely; regions come from the indexed catalog | Small query; scoring can visit many eligible documents | Implement as the native reference |
| **B. Coverage-bucket tokens + boosted `constant_score` clauses** | Exact additive ordering for the declared bucket model | Same catalog; amount quantization is explicit | More query clauses/postings; finite score bounds can enable competitive skipping | Implement and compare against A using identical values/objective |
| **C. Coarse seed + certified numeric bounds + fine native scoring** | Exact fine-model top results when the bound certificate holds | Same catalog, finer amounts than B | Extra request; potentially much less scoring; worst case falls back to broad search | Main promising prototype |
| **D. Global histogram/palette Painless scoring or script sort** | Exact for the implemented stored descriptor and objective | Arbitrary supported ranges; joint allocation possible | Work grows with eligible documents and descriptor complexity | Implement as flexible global reference |
| **E. Nested palette/color cells with weighted child aggregation** | Can calculate global marginal coverage for indexed representatives; joint allocation needs more logic | Arbitrary indexed-coordinate ranges | Indexed child filtering, but joins and child documents cost CPU/RAM | Worth a bounded follow-up if arbitrary ranges matter |
| **F. Cumulative / multiresolution color cells** | Exact for aligned discrete cells; can supply conservative bounds for finer models | More flexible than named families; difficult boundaries remain | More ingest work/features; custom aggregation or query logic | Promising representation experiment |
| **G. Custom OpenSearch/Lucene query plugin** | Can be exact if its bounds and collector are correct | Potentially full desired model | Largest engineering/maintenance burden; speed depends on useful bounds | After native options establish a need |
| **H. ANN histogram/palette embedding** | Approximate; bounded reranking does not restore omitted winners | Fast similarity comparator; composition semantics may differ | Good latency potential, recall must be measured | Comparator, not the global-exact default |
| **I. `distance_feature` over an encoded date** | Exact for a different proximity formula, not generally L1/joint composition | Catalog only; artificial date encoding | Native distance pruning may help; mapping and objective are awkward | Optional controlled experiment, not a numeric-field capability |

## A. Indexed coverage and native numeric scoring

Store one explicit coverage value per supported region, including zero. Indexed numeric `range` clauses handle hard amount limits such as red coverage 65–75%. Changing the requested percentage does not require reindexing; changing the region definition does. OpenSearch range queries operate on stored field values. [OpenSearch 2.11 range query](https://docs.opensearch.org/2.11/query-dsl/term/range/).

Native numeric decay functions offer a simple exact reference for marginal L1. For amounts in `[0,1]`, a linear function with `origin=q_i`, `offset=0`, `scale=0.5`, and `decay=0.5` gives `1-|a_i-q_i|`. Sum weighted functions and set `boost_mode: replace` to avoid incorporating unrelated query scores. For integer amounts `0…B`, use `scale=B/2` and weight `B` to obtain `B-|a_i-q_i|`. This is an algebraic specialization of the documented linear decay equation. [2.11 decay functions and combination modes](https://docs.opensearch.org/2.11/query-dsl/compound/function-score/).

This is globally complete, but “native” does not imply sublinear work. The 2.11 function scorer exposes `Float.MAX_VALUE` as its maximum score rather than a useful competitive bound. Metadata and numeric filters can still prune matches before scoring. [2.11 FunctionScoreQuery implementation](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java).

### Important correction: `distance_feature` does not accept numeric `long`

In 2.11, it accepts `date`, `date_nanos`, or `geo_point`. The numeric mapper does not override the default rejection. A numeric JSON `origin` is permitted because it can represent an epoch date, not because arbitrary numeric field mappings are supported. [2.11 field-type validation](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/mapper/MappedFieldType.java), [numeric mapper](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/mapper/NumberFieldMapper.java), [origin parsing](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/query/DistanceFeatureQueryBuilder.java).

An explicit experiment could encode integer coverage as epoch milliseconds in a `date` field, use a numeric origin and a millisecond pivot, and exploit Lucene's long-distance query. That mapping uses `LongPoint.newDistanceFeatureQuery`; its scorer implements competitive distance pruning. [2.11 date mapper](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/mapper/DateFieldMapper.java), [Lucene 9.7 long-distance implementation](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/document/LongDistanceFeatureQuery.java).

Its per-field score is `boost × pivot/(pivot+|a-q|)`. For one region this orders by absolute error; summing several such scores generally differs from minimizing summed absolute error. It also does not solve overlapping exclusive composition. The date encoding and changed objective must be visible in the experiment's description.

## B. Coverage buckets as indexed tokens

For `B=100`, store a token such as `red:70` for each catalog region, representing a rounded percentage. For query target `q`, generate a constant-score term filter for each possible bucket `b`, with nonnegative boost `B-|b-q|`. A Boolean sum across requested regions produces:

```text
S = R×B - Σ |b_i-q_i|
```

No term frequency or rarity factor belongs in this score. `constant_score` supplies a fixed boost for a matching filter; Boolean scoring combines the clauses. Preserve eligibility for zero-scoring documents as well—omitting zero-boost clauses without an all-eligible fallback can change the result universe. [2.11 constant score](https://docs.opensearch.org/2.11/query-dsl/compound/constant-score/), [2.11 Boolean query](https://docs.opensearch.org/2.11/query-dsl/compound/bool/).

This is attractive because the bound on each clause's score is known. Lucene's constant scorer exposes that bound, and its Boolean scorer can select WAND/block-max execution, which skips documents or blocks that cannot beat the current top results. These mechanisms preserve the ranking; their effectiveness depends on the real query and data, and must be profiled rather than assumed. [ConstantScoreScorer](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/ConstantScoreScorer.java), [Boolean2ScorerSupplier](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/Boolean2ScorerSupplier.java).

Costs to measure:

- Naive query size is `R×(B+1)` clauses: five regions at 1% resolution need 505 clauses; five at 0.5% need 1,005. Equal-boost buckets can sometimes share a `terms` filter. Do not simply raise the Boolean clause limit and assume CPU cost disappears; 2.11 documents a default of 1,024. [2.11 query-string clause-limit note](https://docs.opensearch.org/2.11/query-dsl/full-text/query-string/).
- One token per region means `F` postings memberships per image for `F` catalog entries. A 64-region catalog over 100M images implies 6.4B memberships before index encoding/replication. This is arithmetic, not a measured storage estimate.
- More precise coverage reduces amount rounding error but increases query expansion. More/better regions address a different error: whether “red-ish” means the desired shades.
- Compare A and B first on **the same quantized values and objective**. Otherwise a speed difference is confounded with a model change.

## C. Fine global ranking with a certified search bound

This is the strongest next native optimization to test. Use coarse tokens to obtain an initial score bound, then run the final fine-grained ranking **inside OpenSearch over every document that could beat it**. The seed does not cap the eligible result set.

For fine integer coverages `x_i`, integer targets `q_i`, and unweighted error:

```text
E(d) = Σ |x_i(d)-q_i|,   0 ≤ x_i,q_i ≤ B
S(d) = R×B-E(d)
```

Algorithm for the first `K` results:

1. Open one PIT and keep metadata/validity filters fixed.
2. Obtain any `K` distinct eligible seed documents, for example with B's coarse token query. Fetch their fine coverage fields and calculate their actual fine errors.
3. Let `T` be the maximum seed error. At least `K` eligible documents have `E≤T`.
4. Search the whole eligible index with the necessary numeric bounds `q_i-T ≤ x_i ≤ q_i+T`, clipped to the stored domain. Apply the same fine native scorer, optionally `min_score=R×B-T`, and the final score/ID ordering.

**Proof:** if `E(d)≤T`, every nonnegative component `|x_i-q_i|` is at most `T`, so the document passes every bound. There are already `K` documents at or below `T`. Therefore a document excluded by these bounds cannot outrank the returned top `K`. Inclusive bounds retain all primary-score ties so secondary ordering remains correct. With positive weights, use necessary bounds `|x_i-q_i|≤T/w_i`; zero-weight dimensions impose no constraint. This is a mathematical inference using indexed range filters, not a claimed built-in OpenSearch optimizer.

### Pagination needs a certificate too

The conjunction of component bounds is a box, not the exact total-error ball. With two components and `T=10`, an in-box document with errors `(10,10)` has total error 20, while an excluded document `(11,0)` has error 11. **A full later page inside the box alone does not prove global ordering.**

Two correct approaches are:

- Also require `E≤T` using the exact score threshold. A full page within this threshold is certified; or
- Check the returned page's worst total error is at most `T`. If not, enlarge `T` and rerun that page from the unchanged cursor.

When the current threshold cannot fill the next page, expand it, retaining the PIT, query, final sort, and `search_after` cursor. At the domain-wide maximum error, search becomes the full global reference and exhaustion can be established. A changing safe threshold changes work, not the ordering. Later pages may become progressively less selective.

Correctness conditions and edge cases:

- Seeds must have unique IDs, valid fine features, the same metadata eligibility, and the same PIT as the final search. Their coarse rank need not approximate fine rank well; a poor seed merely produces a loose bound.
- Fewer than `K` seeds do not establish that fewer than `K` eligible documents exist. Search broadly unless completeness of the seed result universe is independently known. An empty or failed seed request is not proof of no matches.
- Target and stored-amount rounding must be explicit. Use integer arithmetic for `T`; round filter bounds outward when converting representations. Retain equality for all ties.
- `S=R×B-E` is an exactly representable integer float while its range stays at or below `2^24`. Verify the actual native decay implementation yields these intended integer scores; do not assume an arbitrary weighted/normalized score does. For `B=10,000` and a few regions the integer range is comfortably smaller.
- This proof applies to the additive nonnegative objective above. It cannot be transferred unchanged to exclusive overlapping regions or arbitrary shade preferences. Each different objective needs valid lower bounds.

Measure total seed-plus-final latency and CPU, not just the faster second request. Numeric-range selectivity can be excellent or negligible depending on the best available matches. This path preserves completeness even when the collection has no close matches; it may then offer little speedup.

## D. Arbitrary global scripts

A Painless scorer or numeric script sort can read a stored histogram/palette, classify representatives into query regions, and calculate the declared objective for **every eligible document**. The current 1–2-region hard joint calculation is a useful bounded implementation target; larger region sets and graded allocation need separate cost measurements.

This removes ANN candidate loss. It does not remove descriptor error, and `size:20` does not limit scoring to 20 documents. The 2.11 script scorer returns `Float.MAX_VALUE` as its score bound, so there is no general competitive bound for the custom computation. Indexed filters can reduce the eligible set; query parameters should reuse compiled scripts. [2.11 ScriptScoreQuery](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/common/lucene/search/function/ScriptScoreQuery.java).

Prefer indexed/doc-value representations that can be read without parsing `_source` per scored document. Preserve the association between each color and its mass when packing data; independently sorted multivalued coordinates are not interchangeable with tuples. Profile descriptor decode, region membership, allocation, collection, and sorting separately. A faster native plugin doing the same full scan improves a constant factor, not its dependence on collection size.

## E. Nested palettes or occupied color cells

Index each representative as a nested child containing its coordinates and mass. A nested range query can identify matching children; their weighted scores can be summed to the parent. `score_mode: sum` exists in 2.11. Ordinary object arrays do not preserve the necessary coordinate/mass associations. [2.11 nested mapping](https://docs.opensearch.org/2.11/field-types/supported-field-types/nested/), [2.11 NestedQueryBuilder](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/query/NestedQueryBuilder.java).

This makes arbitrary coordinate membership indexable, but several extra steps remain:

- A child's count is not its area; score by its stored mass.
- Sum matching child masses to obtain a marginal coverage, then compare that sum with the requested amount. Ranking by the sum alone rewards “more red,” not “close to 70% red.” A parent score transformation can express the latter, but may lose useful pruning bounds. Include zero-coverage parents explicitly.
- Separate region sums do not enforce joint allocation of overlapping colors. Graded preference likewise must respect amount-first ordering.
- Thirty-two representatives create up to 32 children per wallpaper: 3.2B children plus 100M parents at 100M wallpapers. Given the user's priorities, this is not a reason to reject the idea solely for storage. Benchmark indexing/merge cost, join CPU, memory, and broad-query latency.

Finer occupied cells can preserve boundaries better than centroid palettes while increasing child count. This is a meaningful quality/speed experiment if catalog restrictions prove unacceptable; it is not automatically more efficient than a parent-level global script.

## F. Richer precomputation and multiresolution cells

These are representation proposals, not existing special OpenSearch query types:

1. **A region bank:** precompute coverage for named perceptual families, narrower/broader variants, dark/light variants, achromatic bands, and important combinations. A starting experiment might use 48–96 regions, expanding based on measured visual failures. The UI must show the actual region selected rather than pretend every arbitrary box is represented exactly.
2. **Preference features:** for each region, precompute hard area and a separate integral of the desired core-to-edge quality from pixels. This can support catalog shade preferences without classifying pixels at query time. With overlapping exclusive composition, a global preference integral does not reveal which pixels the joint allocation should assign; retain the information required by that model.
3. **Intersection features:** for commonly combined overlapping regions, store intersection mass as well as marginal mass. For two regions, the masses of A-only, B-only, both, and neither then become available. General combinations can require up to `2^R` membership patterns, so prioritize actual query families instead of indexing every combination.
4. **Cumulative grids:** a 3D prefix-sum histogram can obtain an axis-aligned box sum from eight corners, exactly for the discrete grid. Hue-wrap boxes split into intervals. A box in one color space does not remain a box in another; a ball is not an axis-aligned box. Summing corner fields at query time still requires an aggregate scorer unless that particular box's total was preindexed.
5. **Multiresolution cells:** coarse/fine occupied cells can supply contained-cell lower bounds and intersecting-cell upper bounds on mass. Safe bounds may prune impossible matches globally; uncertain cells need finer data. Treating each cell's center as all its pixels recreates the measured boundary problem.

These options use storage and ingest CPU to protect the user's higher-priority accuracy and latency. Version region definitions, color conversion, sampling, and quantization in the extraction events and index so changes cannot silently mix models.

## G and H. Plugin and ANN roles

A custom query plugin can read a compact representation and implement model-specific upper score bounds or lower error bounds for groups of documents. This could combine richer query semantics with exact competitive pruning. OpenSearch 2.11 exposes query and sort extension points. Correct bounds, adversarial equality cases, shard merging, and pagination need extensive validation; installing a custom scorer alone does not create useful bounds. [2.11 SearchPlugin interface](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/plugins/SearchPlugin.java).

ANN remains a useful comparison and possibly a cheap **seed for a certified bound**. A fixed ANN result cap followed by reranking remains approximate. The 2.11 k-NN query has a maximum `k` of 10,000; its graph/engine retrieval budget and final response `size` are distinct. PIT freezes data, not the ANN candidate universe or its recall. [2.11 approximate k-NN](https://docs.opensearch.org/2.11/search-plugins/knn/approximate-knn/).

## Ordering, precision, and global pages

### Preserve amount-first semantics explicitly

For continuous error, `score = -error + epsilon×preference` is not a generally exact lexicographic ordering: two errors may differ by less than the preference term. Scores must also be nonnegative, and the 2.11 script scorer casts its result to a 32-bit float. Avoid using an arbitrary enormous multiplier as a substitute for a proof. [Script score execution](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/common/lucene/search/function/ScriptScoreQuery.java).

Two numeric script sort keys—error ascending, preference descending—followed by a unique ID preserve the computed tuple without squeezing both values into one float. OpenSearch 2.11's numeric script sort uses a double comparator. This is a correctness reference; arbitrary script sort has its own CPU and pruning cost. [2.11 ScriptSortBuilder](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/search/sort/ScriptSortBuilder.java).

For explicitly discrete primary and secondary values, integer packing is possible if the multiplier exceeds the complete secondary range and the packed result remains exactly representable. Alternatively, keep a native integer primary `_score`, a secondary key, and an ID. A native marginal coverage model with no preference feature should not claim to implement the full graded joint objective.

### Competitive skipping is conditional

Benchmark with `track_total_hits:false` or a finite threshold when exact counts are not required. Exact hit counting selects exhaustive collection instead of the top-score mode that can skip noncompetitive matches. This does **not** make returned top results approximate; it changes whether the total count is exact. [Lucene 9.7 HitsThresholdChecker](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/HitsThresholdChecker.java).

Sorting by descending `_score` followed by an ID can retain minimum-competitive-score signaling; it is not necessarily disabled just because a tie-break field is present. A script as the primary sort has different collection behavior. Broad ties, weak bounds, large requested result sets, aggregations, and expensive scoring can still limit gains. [Lucene 9.7 TopFieldCollector](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/TopFieldCollector.java).

### Multi-shard completeness and pagination

If every shard returns its exact local top `K` under the same total ordering, merging those lists yields the global top `K`: a globally top-K document cannot have K better documents on its own shard. OpenSearch's coordinator merges shard top documents accordingly. Constant/query-defined scoring avoids BM25's shard-local frequency differences. Verify single- and multi-shard equivalence, especially ties. [2.11 SearchPhaseController](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/action/search/SearchPhaseController.java).

Use PIT plus `search_after`, an explicit unique sortable ID, unchanged query parameters, and the same score/secondary/ID ordering. Without PIT, concurrent updates can move results between pages. PIT retains the underlying segments and needs a bounded lifetime. It does not waive the certificate rules in C or expand an ANN cap. [2.11 pagination](https://docs.opensearch.org/2.11/search-plugins/searching-data/paginate/), [2.11 PIT](https://docs.opensearch.org/2.11/search-plugins/searching-data/point-in-time/).

Global completeness also requires all intended shards to succeed and no timeout/early termination. `terminate_after` deliberately limits processing and cannot be used as a transparent exactness-preserving optimization. [2.11 Search API](https://docs.opensearch.org/2.11/api-reference/search/).

## What to prototype and decide next

1. **A versus B on the identical catalog/quantization/objective.** Check all-document scores and ordered IDs, zero values, ties, metadata filters, multiple shards, and stable pages. Measure with exact counts on/off and score/ID sort; do not infer WAND gains from query shape alone.
2. **C with fine amounts.** Compare every returned prefix against unbounded fine A. Include misleading coarse seeds, absent good matches, empty metadata subsets, duplicates, ties at `T`, the `(10,10)` versus `(11,0)` pagination counterexample, and threshold expansion to exhaustion.
3. **D for the existing arbitrary 1–2-region hard joint objective.** Measure correctness against the same stored descriptor and separately against pixels. Compare its result quality with catalog options, rather than calling different objectives equivalent.
4. **A richer region bank and boundary-preserving features.** Spend additional storage first where visual failures show an accuracy benefit. Add core/edge preference and overlap information deliberately, then evaluate whether simpler controls preserve the user's intent.
5. **E/F if flexibility remains valuable after those results.** Benchmark nested occupied cells or multiresolution bounds on a bounded corpus before considering a custom plugin.

Use the 100 real images for visual examples and correctness. Synthetic expansion is useful for execution cost, but duplicated palettes or unrealistic independent features can make selectivity misleading. Report end-to-end p50/p95/p99 and CPU at concurrent load, extraction/indexing/merge cost, cold/warm behavior, filter selectivity, index size, and shard count. No result from this small prototype establishes 1M/100M production performance.

**Current direction:** compare globally complete native catalog search, certified fine global search, and a flexible global script before choosing a product restriction. Prefer the option that preserves useful color meaning and gives measured responsive results. Approximate candidate reranking is a comparator or seed mechanism unless its loss of global winners is explicitly accepted.
