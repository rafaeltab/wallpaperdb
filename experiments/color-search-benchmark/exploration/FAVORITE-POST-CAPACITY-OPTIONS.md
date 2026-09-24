# Exact refinements to consider after the pooled capacity campaign

Status: unintegrated proposal, 2026-09-23. The initial review used only source/document reads while capacity was running. After all timing ended, all nine isolated compiler tests passed through an external Make wrapper. No executor integration or live query uses this compiler; these proposals do not select a combination winner.

The objective remains the same precomputed numeric utility score. OpenSearch performs every final filter and global ranking. The service can compile bounds and coordinate requests, but does not score or reorder wallpapers.

## 1. Require several sufficiently strong components

The existing bound requires at least one target utility above the kth seed score. The maxima refinement also requires an individual minimum for each target, but those minima can be zero for a larger combination.

Add necessary **k-of-n** range conditions. For five equally weighted utilities bounded by one and a kth seed score of .70, real arithmetic gives:

| Necessary condition | Threshold |
| --- | ---: |
| At least one utility | .70 |
| At least two utilities | .625 |
| At least three utilities | .50 |
| At least four utilities | .25 |

For example, utilities `[1, 1, .4, .4, .4]` pass the current single OR and have no positive individual minimum from global maxima. Their mean is only .64. The condition requiring three utilities of at least .50 rejects this document before scoring.

The general unit-maximum expression is `t_k = (n*T - (k-1)) / (n-k+1)`, omitting nonpositive thresholds. A winner must have at least `k` utilities at or above `t_k`. Encode a few such conditions as ANDed OpenSearch `bool` range groups with `minimum_should_match: k`, then retain the unchanged numeric scoring query and ID tie breaker.

**Float safety:** the displayed numbers are explanatory real arithmetic, not executable cutoffs. For a proposed cutoff, cap all but at most `k-1` fields at the previous representable float below it, leave the other fields at their observed global maxima, and compute a conservative upper bound for the native score. Select cutoffs only when that upper bound is strictly below the seed score. For differing maxima, maximize over which fields are exempt; with up to ten targets, enumerating those small subsets is practical query compilation work. Keep the same PIT and metadata eligibility, preserve score ties, and retain conservative zero/duplicate fallbacks.

Why investigate: this can reject documents strong in only one or two components even when independent maxima give no useful minimum. It needs no new index fields or image extraction. The risk is additional range intersections and Boolean bookkeeping costing more than the skipped scoring. Begin with one extra condition, then a small ladder; do not assume every possible condition helps.

## 2. Improve the lower bound with a larger seed budget

Currently each per-field numeric sort requests only the final result limit. A top20 query therefore scores the union of at most20 seeds per field to obtain the lower bound. Extreme single-component documents may dominate these lists, giving a weak bound for balanced combinations.

Try a separate seed limit such as64 or128 while keeping the returned result limit20. The same per-field sorts return deeper prefixes; OpenSearch then applies the unchanged numeric scorer to their union and supplies its kth score. The larger union contains the original seeds, so its mathematical kth score cannot decrease. No additional request round trips are needed for a fixed larger seed budget, although payload, sorting and restricted scoring cost increase.

All candidates still come from the same PIT and eligibility filters. The seed union is only a way to obtain a valid lower bound: the final search remains global. No seed size alone establishes global completeness. Any nonnegative valid lower bound is safe when the final pruning proof holds. Final service scores and order remain unchanged.

Why investigate: stronger seed scores tighten the original OR, maxima conditions and the proposed k-of-n conditions together. It is a small isolated experiment with bounded service/client work. It can also lose because the extra seeds fail to improve the bound enough; deeply balanced winners need not appear near any component's individual top. Start with fixed budgets before adding adaptive rounds or complicated stopping rules.

## Dispatch single-target searches directly

A single requested target already has exactly one precomputed scalar utility. The existing unscored numeric-sort variant returns the global utility-descending, ID-ascending order in one OpenSearch request. A dispatcher can use that path for one actual scoring target and route combinations to the measured winner later.

This is worthwhile as a simple integration option: it avoids PIT/seed/final/cleanup round trips for the common single-target case and introduces no new scoring mechanism or stored fields. Preserve controls, metadata filters, zero-score eligibility, score transport rules and deterministic ties. Decide from the number of requested scoring targets, not the number of distinct utility fields: repeated/nearby targets must not accidentally bypass the preserved duplicate behavior or the separate multiplicity correction.

The existing sorted variant already dispatches combinations to the ordinary numeric scorer. A future dispatcher can change only that branch once the completed capacity evidence supports a choice. A request-shape policy can remain explicit and deterministic; do not use a client-side shortlist or rerank. Pagination consistency should retain the API's chosen snapshot policy.

## Decision order

1. Finish and audit the current shared-index campaign, including strict failures and full-bank coverage.
2. Use its per-stage cost and request-shape results to distinguish weak pruning from request overhead.
3. If combinations justify refinement, compare the k-of-n filter and a few seed budgets as separate variants, including their combination.
4. Require exact service fidelity across limits, filters, ties, duplicate fallbacks and multiple shards before capacity testing.

These proposals preserve the current objective; they do not resolve the previously documented duplicate-target arithmetic defect or improve the subjective color formula itself.

## Prepared compiler and proof obligations

`favorite-cardinality-bounds.mjs` and its test file are new, unimported preparation files. **All nine isolated tests passed after capacity timing finished.** No runtime, Make target, source pin, query plan, active campaign or executor imports them. The helper returns filter conditions and certificates only; it cannot issue a request.

For a field-value cutoff `t > 0`, let `p(t)` be the previous nonnegative representable float32. Any document failing an at-least-k condition has at most `k-1` fields with value at least `t`. Choose a set `E` of exactly `k-1` exception fields containing those fields. Such a set exists whenever `1 <= k <= n`. Its remaining values satisfy:

```text
u_i <= M_i                    when i belongs to E
u_i <= min(M_i, p(t))         otherwise
```

Compute an outward-rounded score upper bound for each of the `choose(n,k-1)` possible exception sets, then take their maximum `U_k(t)`. Positive clause factors make this bound monotone in `t`. If `U_k(t) < float32(T)`, every rejected document scores strictly below the valid seed lower bound. Every global winner and every score tie therefore remains eligible. ANDing several independently necessary conditions remains safe.

The compiler enumerates these small exception sets (at most252 for one condition when n<=10) and binary-searches the positive float32 bit domain for the greatest cutoff with a strict certificate. A cutoff just above the largest observed maximum makes every field fall below the cutoff, so its envelope reaches the global upper bound and provides an unsafe search endpoint. If even the minimum positive cutoff is unsafe, omit that condition. Certificates record the bound below the selected cutoff and the first unsafe neighboring cutoff.

Each product gets one outward float32 ULP before double accumulation, and the final float32 sum gets another outward ULP. This is the conservative arithmetic model used in the existing maxima prototype, restricted to at most ten distinct fields with equal positive factors. Zero and negative zero are canonicalized. Unsupported modifiers, nonzero missing values, unequal factors and duplicate fields receive no extra conditions. Invalid maxima are rejected; inconsistent lower bounds trigger a conservative fallback. The helper cannot itself establish that maxima came from the correct PIT: that remains a mandatory executor integration check.

Prepared offline cases cover:

- The five-target worked example and its concentrated false positive.
- Native winners and score ties near the range boundaries.
- Every exception-set boundary vector for representative unequal maxima.
- Deterministic sampled vectors for two through ten fields, with an independent native-score oracle.
- Zero/subnormal values, negative zero, invalid maxima and inconsistent bounds.
- Duplicate fields, changed native semantics, selected condition subsets and input immutability.

Before any live prototype, independently review the now-passing test results; add the normal total-deadline and PIT lifecycle tests at the executor seam. Reuse the existing pooled cleanup without modifications. Real-service fidelity must compare the unchanged global numeric objective on both one- and three-primary indexes, including top1/top3/top20/full rankings, eligibility/exclusions, zero ties, duplicate fallbacks, and raw float32 scores. Any later capacity experiment needs a fresh method identifier, source snapshot and output directory. Current campaign results stay immutable.

### Review follow-up and compilation budget

A separate text-only review found no false-negative proof blocker. The prepared tests now explicitly exercise k=1 and k=n for n=1..10; predecessor/equal/successor values around generated thresholds; zero, subnormal, near-one and native product-rounding boundaries; and missing/malformed clauses or maxima. All nine prepared tests passed during the later offline validation.

Generating the whole n=10 ladder enumerates1,022 exception subsets per approximately30 float-domain search steps, with up to ten product bounds per subset. That is a compilation cost to measure, not assume negligible. An initial integration should add only one chosen extra condition (for example k=3 for a five-target query), retain the existing bounds, and separately record compilation and service time. Do not select that condition as a performance winner before evidence. The compiler supports an explicit requiredCounts subset; it does not decide the production policy.

### Completed offline validation

At20:33 UTC, after all capacity timing ended, the nine pure compiler tests passed using the external `post-timing-audits-v1.mk` target `cardinality-tests`. No fixes were needed. The companion pooled warmup helper passed its four tests, then verified48 warmups and36 comparisons (720 returned scores) on the completed full-million bank with exact raw score and order equality. These results validate the helper and the already-running transport variants; they do not measure or integrate the proposed cardinality filters.

External evidence: `post-timing-isolated-tests-v1.log`, `post-timing-completion-checks-v1.json`, and `full-million-four-methods-pooled-v1/audit-warmup-pooled-parity-v1.json`. The workspace Makefile and frozen runtime were not changed.
