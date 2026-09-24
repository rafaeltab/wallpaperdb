# OpenSearch feasibility review for the method discussion

Reviewed **2026-09-19** against primary documentation and source. This is a paper comparison: no implementation, index change, or benchmark was performed. The user has not selected the next prototypes.

## Version and correctness scope

The baseline available in [infrastructure compose](../../infra/docker-compose.yml) and the experiment compose files is **2.11.0**. The [testcontainers test](../../packages/testcontainers/test/opensearch-container.test.ts) names **2.19.2**; the [shared test utility](../../packages/test-utils/src/builders/OpenSearchTesterBuilder.ts) defaults to the floating tag `:2`. Therefore “the repo uses 2.11” is an incomplete description. Pin the actual version before later experiments; newer features are not assumed here.

Keep three accuracy questions separate:

1. Does the ranking model express the user's preference?
2. Do the stored features preserve the relevant image properties?
3. Does retrieval return the global winners under that stored model?

Exact retrieval only answers the third. A globally exact search over rounded amounts can disagree with finer amounts; a perfectly retrieved histogram can still express the wrong meaning of “red.” The quick, single-person judgments remain provisional evidence for the first question.

## Execution options

| Execution option | What can be guaranteed? | Main limitation |
| --- | --- | --- |
| Numeric coverage fields with native decay functions | Global ranking for the declared scalar score, within score precision | Potentially scores a broad eligible population |
| Coverage buckets with boosted constant-score clauses | Global ranking for the computed finite-precision additive score and tie order | Quantization, query expansion, and unmeasured pruning effectiveness |
| Indexed necessary bounds followed by fine scoring | Global ranking when the model-specific bound is proved and pagination is certified | Custom orchestration; a safe fallback may be a full scan |
| Exact custom scoring of histograms/palettes | Global ranking for the implemented stored model | Broad searches repeat potentially expensive work per document |
| ANN over a vector representation | Approximate nearest neighbors under the configured distance | Can omit global winners; a capped rerank cannot recover them |

These are execution choices. They do not by themselves choose the perceptual representation or the amount/strength/unwanted-color tradeoffs.

### Native numeric scoring

OpenSearch 2.11 supports numeric `linear`, `exp`, and `gauss` decay functions. For a coverage `a` and target `q` in `[0,1]`, `linear` with `origin=q`, `offset=0`, `scale=0.5`, and `decay=0.5` gives `1−|a−q|`. Summing weighted functions with `boost_mode: replace` therefore implements an additive absolute-error objective. This is an algebraic specialization, not evidence that this objective matches perception. Store explicit zeros and require valid features: missing fields receive a perfect decay value of 1. [Function-score documentation](https://docs.opensearch.org/2.11/query-dsl/compound/function-score/).

Native does not mean automatically fast at 100M documents. The 2.11.0 scorer advertises `Float.MAX_VALUE` as its upper score bound; it does not expose a useful model-specific competitive bound. Indexed eligibility filters can reduce work, but requesting only 20 results does not imply evaluating only 20 documents. [FunctionScoreQuery source](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java).

### Indexed bucket scores

Store a token such as `red:40` for the image's rounded red coverage. Give each possible bucket a query-defined constant score, then sum contributions across requested features. This can express **any finite additive table of per-feature bucket scores**, including an asymmetric amount penalty, if we later choose one. Shift each table to nonnegative scores while retaining exactly one bucket per feature per image. It is not restricted to L1. Constant scoring avoids making color preference depend on term rarity. [Constant-score query](https://docs.opensearch.org/2.11/query-dsl/compound/constant-score/), [Boolean query](https://docs.opensearch.org/2.11/query-dsl/compound/bool/).

Finite clause bounds provide a plausible route to competitive skipping: Lucene's constant scorer exposes its bound and its Boolean scorer can use WAND/block-max execution. Actual gains depend on query shape, distributions, ties, requested depth, and collection mode; no speedup is established here. [ConstantScoreScorer](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/ConstantScoreScorer.java), [Boolean2ScorerSupplier](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/Boolean2ScorerSupplier.java).

Naively, five features at 1% resolution produce 505 bucket clauses; 0.5% produces 1,005, before other clauses. Version 2.11 documents a default Boolean clause limit of 1,024. Raising the limit does not remove query CPU cost. Preserve eligibility for zero-score documents and explicit zero-coverage buckets. [Clause-limit documentation](https://docs.opensearch.org/2.11/query-dsl/full-text/query-string/).

An arbitrary interaction between features or an exclusive pixel allocation does **not** become additive merely because its inputs have been indexed. Such models need additional features, a different scoring mechanism, or their own safe bounds.

### Certified necessary bounds: a custom optimization

For the particular error `E(d)=Σ wᵢ|aᵢ(d)−qᵢ|`, with positive weights, any document with `E≤T` must satisfy every `|aᵢ−qᵢ|≤T/wᵢ`. If K distinct eligible seeds have actual fine errors at most T, at least K documents satisfy that threshold. Searching **all** eligible documents within those inclusive indexed bounds and scoring them by the fine objective therefore preserves the first K winners. The seeds supply a bound, not a candidate cap. This proof is our mathematical derivation; OpenSearch supplies ordinary [numeric range filters](https://docs.opensearch.org/2.11/query-dsl/term/range/), not a built-in “certified color search” feature.

Important conditions:

- Use the same snapshot, eligibility, feature version, and final tie ordering for seeds and final search. Round bounds outward.
- Later pages also need a certificate: their worst error must stay within T, or an exact `E≤T` condition must be enforced. Being inside the per-feature box alone is insufficient.
- Expand the bound when needed. If no useful bound exists, correctness requires broad search; performance can degrade to the global reference.
- A new nonlinear, perceptual, or transport objective needs a new proof. The L1 bounds cannot simply be reused.

PIT plus `search_after` provides a stable snapshot and cursor foundation; it does not prove the bounds or ANN recall. [Pagination documentation](https://docs.opensearch.org/2.11/search-plugins/searching-data/paginate/).

### Exact scripts and flexible composition

A script can classify stored histogram cells into query-specific regions and evaluate richer penalties or allocation logic for every eligible image, if the chosen algorithm fits the execution environment. This avoids candidate truncation, but does not fix descriptor error. OpenSearch's exact vector script is explicitly documented as brute force. [Exact k-NN scoring script](https://docs.opensearch.org/2.11/search-plugins/knn/knn-score-script/).

The general 2.11.0 script scorer also returns `Float.MAX_VALUE` as its bound and converts scores to nonnegative 32-bit floats. A custom nonlinear score therefore gets no generic competitive pruning merely by being inside OpenSearch. An implementation of transport/optimal allocation must account for per-document cost and score precision; a faster native plugin alone changes a constant factor, not the need to examine documents. [ScriptScoreQuery source](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/ScriptScoreQuery.java).

### L2, cosine, and ANN

Version 2.11 provides L2 and cosine, with engine-specific support. Lucene supports both; Faiss's 2.11 method table lists L2 and inner product, so direct Faiss cosine must not be assumed. The indexed method's distance is not an updatable setting. [Engine/method definitions](https://docs.opensearch.org/2.11/search-plugins/knn/knn-index/).

OpenSearch's L2 distance is squared Euclidean distance; cosine compares directions. Consequently, **unit-L2-normalized vectors have the same mathematical ordering under L2 and cosine**, since squared distance is `2−2cosθ`. Different approximate runs can still retrieve different neighbors. Switching the metric while retaining an unsuitable descriptor does not establish better color behavior. [Distance definitions](https://docs.opensearch.org/2.11/search-plugins/knn/approximate-knn/).

For “40% green, other colors unspecified,” zeros in the remaining coordinates of an ordinary full-vector L2 target mean desired zero, not “ignore this coordinate.” Conversely, a positive wildcard allowance must not let excess green disappear from the requested **total** green amount. These are query-model issues to solve explicitly, not ANN settings. This is a mathematical inference about the objective.

Efficient filters inside Lucene/Faiss k-NN are available in 2.11, but the search remains approximate in general; some filter situations switch to exact search. Filters outside the k-NN clause operate after retrieval and may return fewer eligible hits. Neither placement guarantees global winners under a different final perceptual score. [k-NN filtering documentation](https://docs.opensearch.org/2.11/search-plugins/knn/filter-search-knn/).

Built-in ANN indexes a supported fixed distance. It does not automatically prune an arbitrary query-dependent nonlinear score or transport problem. A proposed embedding needs proof of equivalence or measured approximation error; capped reranking remains approximate even when it runs entirely inside OpenSearch.

## Implications for the next joint decision

The most credible **native exact execution path to investigate** is precomputed scalar features with either bucket scoring or proved necessary-bound filtering. Its suitability depends on whether a useful perceptual model can be expressed with those features. Flexible histogram/transport scoring can be a quality reference; broad exact execution carries a larger scaling risk. ANN is a legitimate approximate comparator or seed source, with retrieval loss measured separately.

Neither this review nor a 100/1,000-image corpus establishes latency at 1M or 100M. Later approved experiments need representative distributions, realistic filters, concurrent load, shard topology, deep pages, warm/cold behavior, and ingestion/merge costs. Global completeness also requires successful execution across all intended shards without timeout or early termination. [Search API controls](https://docs.opensearch.org/2.11/api-reference/search/).

### Clarifications to the earlier options note

- [GLOBAL-OPTIONS.md](GLOBAL-OPTIONS.md)'s prototype priorities are historical proposals, not current authorization or a method selection.
- “Amount first, shade second” in that note is a model proposal, not a universal preference established by the quick judgments.
- Its conditional L1 bound argument remains useful; it is not a general proof for arbitrary richer models.
- Claims of WAND gains, fast global native scoring, or 100M performance remain hypotheses pending measurement.
