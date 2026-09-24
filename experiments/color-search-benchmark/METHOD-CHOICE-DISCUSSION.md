# Choosing color-search methods: discussion paper

**Direction corrected 2026-09-20:** the user rejected narrowing the candidate set at this stage. Build the [common evaluation feedback loop](evaluation/loop/README.md) first, then use it to compare methods, combinations and parameter changes broadly. The shortlist and shortlist-first next steps below are historical assistant proposals, not accepted decisions. The technical comparisons remain research inputs to the loop.

Recorded **2026-09-19**, after the user agreed to compare options following batch 001. **This is a proposal for joint selection. No new search methods, indexes, benchmarks or algorithm-evaluation harness were built in this step.**

## Recommendation to discuss

The strongest initial shortlist is **interpretable color/vibe features** and **a fine color distribution with flexible query scoring**, with the existing cosine/L2 approaches as controls. **Transport** is an optional composition-quality reference. Spatial features and learned ranking remain possible additions when simpler measurements demonstrably miss something important.

These are not mutually exclusive architectures. A likely combination worth investigating is rich color evidence extracted once, common appearance measurements precomputed from it, and query-specific scoring where needed. This does **not** yet establish an efficient, globally complete execution plan for every arbitrary range query.

Accuracy and speed are both requirements. Extra flexibility and cheaper storage cannot compensate for results that feel wrong or take too long. The paper deliberately does not name a winning formula, impose a fixed catalog of colors, or claim production latency.

Supporting reviews: [perception and representation](METHOD-OPTIONS-PERCEPTION-REVIEW.md), [OpenSearch feasibility and primary sources](METHOD-OPTIONS-OPENSEARCH-REVIEW.md). Product evidence: [goals](COLOR-QUERY-GOALS.md), [batch results and caveats](evaluation/batch-001-results.md), [evaluation proposal](EVALUATION-PHASE.md).

## 1. What the judgments tell us to preserve

There are **37 logical judgment records**, including 24 recent comparisons. They come from one person, reuse images, and include an explicit quick-pass caveat. They are useful development evidence, not a calibrated population benchmark. We should inspect disagreements rather than automatically declare every different ordering a failure.

| Example | Consequence for candidate design |
| --- | --- |
| 40% green should beat comparable 80% green | Amount is a whole-image target, including excess; it is not a minimum. |
| The right amount of less convincing green can lose to a smaller area of strong green | Keep amount and color quality separate, then investigate their tradeoff. Strict amount-first sorting is not established. |
| Bright red illumination feels redder than dulled red roses | Recognizing a color and measuring its strength are different. A red-area scalar alone loses information. |
| 90% gray / 10% red beats 80% gray / 18% red / 2% blue for a fully specified gray/red palette | Ordinary amount error does not express this preference; outside-color dislike needs consideration. This is not a universal blue veto. |
| The same pair is acceptable under 80% gray / 10% red, with 10% unspecified | The query's unspecified remainder matters, without making excess requested color free. |
| White with red can miss the desired grayscale-with-red appearance | Neutral coverage may need tonal or contextual information. White remains technically neutral. |
| A precise picked shade and the broad name “red” have different intent | They can share measurements while using different matching functions. |
| Dark scenery with bright spots differs from a uniformly dim image | Preserve a lightness distribution, not just an average. Spatial features are a further hypothesis. |

The second row refers to the controlled 40%-green case: the user preferred 20% convincing green over the example described as the right amount but too yellow. That supports a tradeoff in that case, not a universal weight. Natural-image validation remains important.

### Four measurements, not one interchangeable percentage

- **Area:** how much belongs to the requested color family/range.
- **Match quality:** how close or convincing the included colors are.
- **Other colors:** what lies outside the requested palette and how much the query tolerates it.
- **Overall appearance:** tonal distribution, vividness, hue concentration, and possibly prominence or arrangement.

For the proposed center=1 / edge=0.5 range, we can retain accepted area and quality separately. An image with 80% edge-color area must not silently become “40% area” because its quality was multiplied by 0.5. The ultimate way these measurements affect ranking remains to be selected.

Global properties may overlap: a dark-red pixel can contribute to redness and darkness. Explicit composition portions may instead require allocation without double counting. Those are distinct query meanings, not something an index or distance formula decides for us.

## 2. Separate the three choices

1. **Representation:** what the extractor remembers about each image.
2. **Ranking objective:** how those measurements answer this particular request.
3. **Retrieval:** how OpenSearch finds the best scores across all eligible wallpapers.

A better distance cannot recover color detail discarded during extraction. A richer representation does not automatically produce a better objective. Moving an expensive score into OpenSearch does not automatically make global retrieval fast.

## 3. Candidate families

The strengths below are hypotheses to evaluate, not measured quality ratings.

| Family | What it does | Why it is worth considering | Main difficulty | Proposed role |
| --- | --- | --- | --- | --- |
| **A. Existing histogram + another vector distance** | Compare the same 64-bin histogram using cosine or L2, with normalization stated explicitly | Cheap control; isolates what the metric changes | Coarse color detail, named-color meaning and partial targets remain unresolved | Keep as controls |
| **B. Interpretable color/vibe features** | Store color-family amounts, quality summaries, neutral coverage, lightness bands and related appearance measurements | Understandable rules; amount targets; strongest straightforward fit with indexed scalar search | Definitions need calibration; fixed features cannot cover every arbitrary picked shade/range | First serious contender |
| **C. Fine color distribution** | Keep many small perceptual color cells; a query defines which count and how well they match | Precise hex colors, flexible ranges, common color families and richer composition evidence | More query work; efficient exact global retrieval for arbitrary regions needs a plan | Second serious contender |
| **D. Transport / Earth Mover's Distance** | Match image color amounts to desired color amounts, charging for substitutions | Explicit treatment of nearby-color substitution and exclusive composition portions | Remainder and excess need correction; custom per-image work is difficult to prune globally | Optional quality reference |
| **E. Spatial / prominence features** | Add rough location, coherent regions, or accent-versus-surrounding measurements | Could explain background/accent or focal-color preferences missed by distributions | Extra extraction and scoring; current cases do not prove it is necessary | Targeted addition if needed |
| **F. Learned representation or ranker** | Use learned image features, or learn how explicit measurements combine | Could capture appearance or tradeoffs that simple rules miss | Sparse judgments; generalization and global retrieval need separate validation | Later challenger/addition |

### A. Why L2 is a control rather than the whole answer

[Issue #8](https://github.com/rafaeltab/wallpaperdb/issues/8), as recorded in the [history audit](HISTORY.md), was the remembered cosine/L2 suggestion. The current [query builder](../../apps/gateway/src/services/color-sort.service.ts) adds broad color kernels to a 64-dimensional vector; the [mapping](../../apps/gateway/src/opensearch/mappings.ts) uses Lucene HNSW with cosine.

For a single color, increasing `amount` scales the whole vector, which leaves cosine unchanged. L2 responds to scale, but an ordinary vector target with green=0.4 and all other coordinates zero asks for zero in those coordinates; it does not mean “the other 60% can be anything.” Also, if both vectors are normalized to unit L2 length, squared L2 is `2 − 2×cosine`, giving the same mathematical ordering. These are algebraic consequences of the [distance definitions](https://docs.opensearch.org/2.11/search-plugins/knn/approximate-knn/), not new benchmark findings.

Changing the metric remains useful as a baseline, but query encoding and extraction resolution must be recorded separately. A native ANN result and exhaustive ranking under the same metric are also different things.

### B versus C: precompute more, or decide more at query time

**B** can store, for example, total red-family area, a red-strength distribution, neutral coverage across lightness bands, and hue concentration. The exact definitions are proposals. A small transparent score could combine amount error, quality and outside-color evidence. Common queries can then operate on already indexed values.

**C** retains finer underlying color evidence. A query can define a new shade or range and aggregate its matching cells, rather than depend entirely on a previously chosen family. Fine distributions still approximate real pixels and omit arrangement. A few adaptive palette centroids are another compression option, but their averages can hide colors on either side of a narrow boundary; the earlier [range evaluation](RANGES-EVALUATION.md) already found examples of this.

These options can share extraction and be compared fairly with common scoring assumptions. Precomputing B's features from C's richer representation is a plausible combination, but it does not turn an arbitrary new range into a preindexed field. Narrow precision and unrestricted range controls remain explicit capability checks, not features to quietly discard for speed.

### D. What transport adds—and does not solve

Transport asks how much color mass must move, and how far, to match a desired composition. Similar-color substitutions can cost less than unrelated ones. This is a distinct objective from comparing corresponding histogram bins. See the original [Earth Mover's Distance image-retrieval paper](https://ai.stanford.edu/~rubner/papers/rubnerIjcv00.pdf).

However, a free 60% remainder destination can absorb excess green and make an 80%-green image look perfect for “40% green.” Total requested-color coverage must still be constrained or penalized. Ordinary transport also does not guarantee that avoiding 2% blue outweighs a larger gray/red amount mismatch. The ground cost and any outside-palette term must express that intent; a geometric color distance alone is not a product specification.

Transport's useful question is whether joint color substitution improves perceived composition enough to justify the added work. A bounded exhaustive reference can answer part of that later, without pretending it is already a scalable production method.

### E and F. Add information only when it explains a real miss

Richer global lightness and color-strength distributions may already explain several cases. If arrangements with similar color distributions produce consistently different judgments, spatial features become a stronger candidate. Likewise, a small ranker over explicit measurements is different from replacing everything with a whole-image embedding. The latter may capture broad appearance, but exact proportions and shade accuracy need their own evidence. The [CLIP paper](https://proceedings.mlr.press/v139/radford21a/radford21a.pdf) is evidence for image/text representation learning, not validation of these color-query requirements.

Our current judgments are too few and correlated to demonstrate a complex model's generalization. They can identify useful measurements and expose bad assumptions without justifying a large learned model.

## 4. OpenSearch: what can rank globally?

The repository's infrastructure compose pins **2.11.0**. Tests also reference **2.19.2** and a floating `:2` image. This discussion uses 2.11 capabilities; a later experiment must pin its actual server version. Details and source checks are in the [OpenSearch review](METHOD-OPTIONS-OPENSEARCH-REVIEW.md).

| Execution path | Global correctness claim | Speed/scaling question |
| --- | --- | --- |
| **Numeric features + native decay** | Exact for the declared stored scalar objective and score precision | A broad query can still score a large eligible population. Native does not imply sublinear work. |
| **Indexed amount/feature buckets + constant scores** | Exact for the actually computed finite-precision additive score | Finite score bounds give a plausible skipping path; many clauses, common buckets and ties can reduce the benefit. |
| **Safe indexed bounds + fine scoring** | Exact only when the bound is proved for that objective and all possible winners remain eligible | Can reduce scored documents substantially; worst case still broad. Requires custom planning and careful pagination. |
| **Fine histogram / transport script over all eligible images** | Exact for the implemented stored model if the search completes | Useful reference; repeated per-document work is a serious broad-search risk. |
| **ANN vector search, with or without capped reranking** | Approximate | A candidate cap can omit the global winner. Reranking inside OpenSearch does not remove this limitation. |

OpenSearch supports [numeric decay functions](https://docs.opensearch.org/2.11/query-dsl/compound/function-score/) and [constant-score clauses](https://docs.opensearch.org/2.11/query-dsl/compound/constant-score/). Bucket score tables can represent different per-feature amount curves, including asymmetric ones; they are not limited to symmetric L1 error. Coupled objectives such as exclusive allocation need additional treatment. The 2.11 [function scorer](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java) and [script scorer](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/ScriptScoreQuery.java) do not expose useful model-specific competitive bounds. This is why “it runs in OpenSearch” is not a sufficient speed argument.

Every exactness claim refers to the implemented finite-precision score plus its stable tie order. Rounded scores can tie even when ideal mathematical scores differ; descriptor precision and score precision are separate limits.

### Safe pruning versus arbitrary candidate truncation

Consider a simple nonnegative amount error. If we already have 20 eligible results with total error at most T, any image whose one component alone exceeds T cannot beat them. Indexed filters can exclude those impossible winners, then OpenSearch can rank **all remaining eligible images**. The seed results set a bound; they do not define the only candidates allowed to win.

This is a conditional mathematical optimization, not an OpenSearch feature that automatically works for any score. Richer quality terms, interactions, range approximations or transport need their own valid bounds. The snapshot, outward rounding, score ties and each subsequent page also matter. If the bound is loose, exactness may require broad scoring. The review records the simple additive proof and its limits.

### What we can say about 1M and 100M

Precomputed features and indexed pruning offer credible avenues to investigate. No option here has established realistic 100M performance. Historical synthetic/repeated-query experiments are useful execution evidence for their particular older models, not latency or perceptual-quality guarantees for these proposals.

Before calling a finalist fast, measure the full request across shards, realistic filters, changing queries, concurrent users, cold/warm conditions and pagination. Include every planning request and timeout/fallback. A selective city tag may make exact scoring easy while an unrestricted color query remains expensive; both matter.

Storage is the user's lowest priority, so retaining richer color evidence is reasonable to explore. Extra indexed measurements also cost memory, ingest CPU and merge work, so storage tolerance is not permission to create an unlimited field catalog. The [search API](https://docs.opensearch.org/2.11/api-reference/search/) also exposes partial results/timeouts: a global-correctness claim requires successful execution over all intended shards, not simply receiving some hits.

## 5. A provisional evaluation rubric

Do not collapse everything into a weighted total where cheap storage can cancel poor accuracy. Use separate quality and latency requirements, then compare flexibility and resource costs among candidates that satisfy both. Numerical acceptance thresholds still need to be agreed for the eventual workload.

| Question | Proposed evidence |
| --- | --- |
| Does the objective feel right? | Report agreement and visible disagreements by perceived color, vibe, combinations, precision and semantic eligibility. Use the user's notes alongside orders. |
| How sensitive is that conclusion? | Show all batch preferences and a sensitivity view omitting explicitly uncertain pairs; preserve the whole-batch caveat in both. Avoid treating derived pairs as independent votes. |
| Did compression lose useful evidence? | Compare finer/reference measurements and the indexed descriptor on the same cases. |
| Did retrieval miss winners? | Compare each execution strategy with exhaustive ranking under its own declared objective on a tractable collection; distinguish a proof from empirical recall. |
| Does it feel fast? | Measure end-to-end latency distributions under an agreed workload, including broad queries and all planning/fallback work. |
| Can it support the requested controls? | Exercise named colors, arbitrary picked shades, explicit amounts, partial palettes, overlapping properties and range controls separately. |
| What does it cost? | Report service and OpenSearch CPU/RAM, index size and extraction/ingest work separately. |

The current material is development evidence. Reserve genuinely new image/query groups for later finalist evaluation, keeping reused scenes and related requests together. Additional reviewers can reveal variation; do not force one person's quick ordering into a universal law. A few confirmed behavioral examples can check known intent, while ambiguous real-image disagreements remain things to inspect.

## 6. Concrete shortlist for a joint decision

1. **Controls:** current cosine and explicit L2 variants. State query construction, normalization and exact-versus-ANN execution.
2. **Common-query contender:** interpretable named-color/vibe measurements with a transparent amount/quality/outside-color objective, paired with native indexed execution options.
3. **Flexible contender:** fine color distributions with precise/range matching and the same common-query semantics where possible. Start with an exhaustive quality reference; any production claim additionally requires a globally complete execution plan with measured latency.
4. **Optional transport reference:** corrected total-amount/remainder semantics and an explicit outside-palette policy, to test whether its composition handling adds enough value.

Spatial features and learned weights can be focused variants of these contenders later. We need not build six unrelated systems. Equally, an overly restrictive fast model should not win merely because a more expressive one has not yet been optimized.

**Next discussion:** agree on this shortlist and whether transport belongs in the first comparison. Then define the smallest comparable scoring variants and acceptance workload together before authorizing implementation. No implementation is selected by this paper.

## Integration considerations for any eventual choice

The current path is extractor → `wallpaper.colors.extracted` through NATS → gateway projection → OpenSearch. A richer descriptor needs an explicit extraction/schema version, event/projection compatibility, an isolated new index and a backfill plan; changing the metric is not an in-place mapping update. See the [existing implementation audit](HISTORY.md#event-and-schema-integration).

Prefer moving repeatable image analysis into extraction so the gateway prepares query parameters and retrieves a page. A small seed/bound calculation is compatible with that; fetching and reranking millions of wallpapers in the gateway is not an acceptable global-ranking design. These are planning implications, not migration work performed here.
