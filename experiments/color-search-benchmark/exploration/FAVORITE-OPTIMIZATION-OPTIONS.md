# Refinements of the preserved favorite

Research checkpoint: September 23, 2026. These are design candidates, not measured performance results. The experiment coordinator owns benchmarks and service changes. The snapshot's measurements, anchors and scoring objective remain the reference.

## Recommended sequence

1. Measure the numeric, rank8, rank16 and rankfloat utility candidates already implemented.
2. Test a typed, specialized version of the slower generic fused script. This is a low-storage execution experiment; it still scans eligible documents.
3. If rank16 is promising, test **rank18**: the same two feature terms with four times finer fixed-point precision. Test a three-term encoding only if precision differences affect actual preferences or close rankings.
4. Test **direct numeric sorting for single-color queries**, retaining feature queries for combinations.
5. If feature queries remain expensive, compare physically color-clustered indexes with an otherwise identical index. Do not assume this helps every combination or metadata filter.
6. Restore additional controls only after the fast execution path is established: linear quality endpoint blending is more faithful than interpolation between proportion targets.

Every proposal keeps filtering and final ranking inside OpenSearch. No fixed candidate pool is reranked in application code. Mathematical fidelity, stored-value precision, and float32 execution equivalence are separate properties.

## What the native implementation supports

OpenSearch 2.11's `rank_feature` query supports a linear function and resolves named entries in `rank_features` objects to Lucene feature queries. Query boosts are float32 and become Lucene `BoostQuery` wrappers. This supports positive weighted utility sums without a custom plugin. [RankFeatureQueryBuilder](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/modules/mapper-extras/src/main/java/org/opensearch/index/query/RankFeatureQueryBuilder.java), [AbstractQueryBuilder](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/index/query/AbstractQueryBuilder.java)

Lucene 9.7 stores feature values as term frequencies, retaining nine significant binary digits. Linear feature scoring multiplies the decoded value by a float weight. Positive normal floats are required; zero-valued components must be omitted. [FeatureField](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/document/FeatureField.java)

Feature queries expose per-block maximum scores and accept a minimum competitive score. The underlying iterator can skip blocks whose upper bound cannot reach the current result threshold. These are exact bounds for the stored objective, not approximate nearest-neighbor retrieval. [FeatureQuery](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/document/FeatureQuery.java), [ImpactsDISI](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/ImpactsDISI.java)

With descending score as the primary sort and a finite total-hit threshold, `TopFieldCollector` uses `TOP_SCORES`; an `id` tie-breaker does not itself disable that mode. A required zero-score clause can retain zero-utility documents: `ReqOptSumScorer` can make optional scoring clauses required once the competitive threshold exceeds the required clause's maximum. Actual pruning still depends on data and query shape. [TopFieldCollector](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/TopFieldCollector.java), [ReqOptSumScorer](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/ReqOptSumScorer.java)

## A. Spend the nine feature bits more effectively

The current rank16 method rounds a target utility `u` to `round(65535*u)`, then stores two base-256 digits. All integers from 1 through **511** are representable with nine significant binary digits. Therefore, base-512 digits improve precision without adding a query term. This is a deduction from the encoding above.

| Encoding | Integer scale | Positive limbs per target, maximum | Utility rounding bound before query arithmetic |
| --- | ---: | ---: | ---: |
| Current rank8 | 255 | 1 | 0.00196079 |
| Current rank16 | 65,535 | 2 | 0.00000762951 |
| Proposed rank18 | 262,143 | 2 | 0.00000190736 |
| Proposed rank24 | 16,777,215 | 3 | 0.0000000298023 |
| Proposed rank27 | 134,217,727 | 3 | 0.00000000372529 |

For rank18, store `hi=floor(integer/512)` and `lo=integer%512`. Use boosts `512/(262143*n)` and `1/(262143*n)` for `n` requested colors. Rank24 can use three base-256 digits. Rank27 uses three base-512 digits. Javascript can represent these integers exactly; avoid signed bit operations when extending to larger widths.

These bounds apply to the target utility, not directly to every final score difference from the saved query. Query boosts, individual products, and the final sum round to float32. The original query also rounds cutoff contributions before summing; precombining them changes operation order. Twenty-seven bits do not promise twenty-seven bits of final-score accuracy.

Splitting features also creates independent block maxima. A block's largest high digit and largest low digit might occur on different documents; their sum is conservative but potentially loose. Rank18 does not automatically run at the same speed as rank16 merely because both have two terms. Measure it.

### Alternative: split the actual float into three chunks

Take the float32 utility `u`, truncate it to nine significant bits as `h`, truncate the residual `u-h` as `m`, and store the final residual as `l`. A normal float has 24 significant bits, so three nine-bit chunks can represent it without fixed-point quantization, provided every nonzero chunk remains a normal float. The subtraction is exact for these nested binary chunks. Reject unsupported subnormal residuals explicitly.

Query with three equal boosts `1/n`. This preserves the stored utility before query multiplication, but not necessarily the original multi-color rounding order. It needs stronger tests than fixed-point digits and is a second-choice refinement, not the first implementation.

## B. Direct numeric sorting for a single requested color

For one color at an indexed control/percentage preset, the complete score is already a stored utility. Sort by that numeric utility descending and then `id` ascending. This preserves the stored ordering, uses the normal metadata filter, and needs no per-document score function. Return the utility from the sort value as the displayed score; translating a service result field is not reranking.

Use a numeric field with both points (`index:true`) and doc values. Lucene's numeric sort optimization assumes both contain the same values. The current numeric prototype uses `index:false`, so this requires a separate mapping/index variant. [TopFieldCollector numeric sorting contract](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/TopFieldCollector.java#L374-L382)

This applies to a single target only. A multi-color weighted sum cannot generally be replaced with lexicographic sorting of its component utilities. Storage, indexing cost, and filtered/deep-page behavior still need measurement.

## C. Restore continuous linear quality influence with two endpoints

This is our algebraic derivation from `favorite-optimized-scoring.mjs`, with other controls fixed and quality influence `alpha` restricted to `[0,1]`.

For each cutoff layer, vibe scoring is:

`sqrt(area) * (1-alpha + alpha*quality)`.

For a positive proportion target it is:

`areaMatch * (1 - 0.35*alpha*(1-quality))`.

Both are affine in `alpha`. The normalized cutoff sum therefore satisfies:

`U(alpha) = (1-alpha)*U(0) + alpha*U(1)`.

Index two endpoint utilities per target and cutoff-weight preset; query with two nonnegative boosts. A three-position quality selector no longer needs three separately indexed values, and intermediate slider positions become mathematically exact. The favorite `alpha=.5` is the average of the endpoints.

Costs and boundaries:

- Two endpoint feature queries per color, multiplied by the selected encoding's limb count. This trades query work for flexibility/storage.
- Float32 endpoint storage and multiplication still alter rounding compared with the original native formula.
- A zero proportion bypasses quality and needs only one endpoint.
- Keep minimum quality and all other controls fixed. A different gate requires its own indexed definition.
- The identity is not generally valid for `alpha>1`, where clipping can activate, or for the smooth-power curve.
- Inference: upper bounds may be looser because different documents can maximize the endpoints. Do not assume interpolation is free.

## D. Cutoff-weight controls

The saved method normalizes five exponential weights, then sums five independently scored cutoff layers. Precomputing whole utilities for a few weight presets is faithful at those presets. Interpolating two preset utilities is **not** the same as evaluating an intermediate exponent, because normalized exponential weights are nonlinear in that exponent.

To keep arbitrary cutoff weighting, store five per-layer utilities and calculate the five small weights once per query. Boost the five feature queries by those weights. Combine this with two quality endpoints if needed. This retains the mathematical formula, but increases terms to five times the whole-utility approach, or ten times with endpoint blending, before limb expansion. It is a flexibility experiment rather than the first speed optimization.

## E. Proportion interpolation is a deliberate approximation

For fixed layer coverage `a`, positive target `t`, and fixed quality factor, the favorite's area match is:

`max(0, 1 - (t-a))` when `t>=a`, otherwise `max(0, 1 - 1.5*(a-t))`.

It is piecewise linear in `t`, with a peak at `t=a` and possibly a clipping kink at `t=a-2/3`. Linear interpolation between 5% target profiles is exact only when the interval does not cross a kink. At the peak it underestimates the correct score; at the zero-clipping kink it can overestimate it.

For positive targets separated by `h=.05`, our slope-jump calculation bounds peak error by `2.5*h/4=.03125`, and clipping error by `1.5*h/4=.01875`, before quality weighting and floating-point effects. The five nonnegative cutoff weights sum to one, so the larger absolute bound also covers their weighted sum and an average of target utilities. This is much larger than rank16 quantization.

### Do not interpolate the stored 0% profile into positive targets

Exactly 0% bypasses quality. An arbitrarily small positive percentage does not. Example: zero coverage, zero quality, quality influence `.5` gives:

- Actual `U(0)=1`.
- Actual `U(.05)=.95*.825=.78375`.
- Interpolated `U(.01)=.95675`.
- Correct positive-target `U(.01)=.99*.825=.81675`.

The difference is `.14`; as the target approaches zero from above, it approaches `.175` at the favorite quality influence, or `.35` at influence 1. A safe interpolation prototype needs a separate **positive-side 0% limit** utility, with quality applied, and must continue using the original 0% utility for exactly zero. Alternatively, explicitly disallow targets between 0 and 5. Do not silently interpolate the two existing profiles.

## F. Physically group similar palettes to tighten block bounds

Hypothesis: sorting documents by a compact palette descriptor can put similar utilities in nearby document blocks, reducing local feature maxima for irrelevant regions. This can help block skipping without changing any score or eligibility. A deterministic dominant-hue/lightness/palette code is a starting experiment, not a learned embedding.

Create a separate index with a numeric or keyword doc-values sort key and an `id` tie-breaker. OpenSearch's index-sort settings are fixed at index creation and support numeric/string sort fields. [IndexSortConfig](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/index/IndexSortConfig.java)

This is not the ordinary early-termination optimization for a query sort matching the index sort: the query still sorts by an arbitrary score. The hypothesized benefit comes from tighter impact bounds; Lucene computes these maxima over indexed blocks. [MaxScoreCache](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/MaxScoreCache.java)

Risks to measure: one global order cannot optimize every hue/percentage combination; multicolor images may group poorly; synthetic source mixtures may exaggerate or hide locality; metadata partitions can interact with color order; indexing and merges become more expensive. Preserve scores and stable IDs when comparing layouts. Equal-score ties remain eligible because the result order includes `id`.

## G. Typed script as a controlled execution experiment

The generic fused script reads arrays, casts boxed parameters and branches on common mode flags for every document. Generate a limited set of Painless kernels specialized by component count, area mode and quality kind, with explicit numeric locals. Keep field names, target percentages, weights and other numeric controls in parameters, so new colors do not generate new source strings.

This still performs global document scoring and lacks the feature-posting bounds described above. It might reduce overhead relative to the generic script; it is not a substitute for indexing utilities. Preserve the native float32 component cast and final sum cast. Record the source-cache shape count and test all supported quality kinds, zero targets and gates. No speedup is claimed before measurement.

## Evaluation requirements for refinements

- Real OpenSearch correctness checks against all 545 indexed assets; the gallery excludes the 22 controlled fixtures.
- Score deltas, tied-result behavior and top-k overlap, plus the existing human-feedback evaluation.
- Query shapes from one through five targets, metadata selectivity, first and subsequent pages, zero-score cases, and cold/new-query versus warm-query behavior.
- Separate timing from profiling. Keep the one-second hard failure criterion and shared-host resource controls.
- Compare like-for-like schema scope. A tiny workload projection cannot establish full-schema memory or storage costs.
- Retain the endorsed snapshot and label every approximation in the visual prototype.

## Implementation checkpoint

The typed script is now implemented separately in `favorite-typed-scoring.mjs`. Six offline tests pass, including generated-arithmetic comparison across linear/power quality curves, zero targets, quality gates and both area powers. The opt-in real OpenSearch test is deliberately pending a coordinated service window; no performance conclusion yet.

Full-schema indexing exposed another constraint: Lucene's encoded term frequencies can overflow their per-document, per-field integer sum even when the number of feature keys seems reasonable. The full nine-control-preset rank16 document puts roughly 100,000 positive digit features in one field. Each feature's frequency is an encoded float bit pattern, not the small original digit value. Therefore, utility definition version 2 partitions each rank-feature encoding into separate fields per quality/cutoff-weight preset, such as `utility_rank16_q050_w1`. This changes layout only; scoring and numeric utility fields are unchanged. The full-plan regression reproduces the original overflow and verifies all 27 partition fields stay below the limit. A rank16 preset has at most 12,276 terms, with a conservative encoded sum of 424,223,208, below 2,147,483,647. Runner receipts now count values across partitions, and mappings record `_meta.utilityDefinitionVersion=2`.
