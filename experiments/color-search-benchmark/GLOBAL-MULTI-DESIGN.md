# Five-family joint area scoring: proof and design

**Recommendation:** implement a sparse membership-mask histogram plus a 32-cell query-time subset calculation. This preserves joint area allocation for up to five fixed families without solving a general transport problem per wallpaper. Keep the existing one/two-family closed form as a fast path. Actual OpenSearch performance still needs measurement.

## Formula

Let requested family amounts be `aᵢ`, with total `A ≤ 1`. Let `U(S)` be the image area belonging to at least one family in subset S. A pixel may belong to several families, but its area can only be allocated once.

The maximum area assignable to its requested, matching families is:

```text
F = min over every subset S of [A − demand(S) + U(S)]
```

The empty subset contributes A. With five families there are only 31 nonempty subsets. The resulting errors are:

```text
minimum mode: E = A − F
target mode:  E = max(A, U(all)) − F
```

For target mode, 40% requested green and 80% actual green therefore has error 40%; 40% actual green has zero error. Five disjoint 20% requested regions can match perfectly. If one shared 20% patch belongs to all five regions and the other 80% belongs to none, the five-part request has error 80%.

### Why the formula holds

Construct a flow network with one capacity-limited source node for each membership atom, zero-cost edges to the families that atom belongs to, and family-to-sink capacities equal to the requested amounts. A cut separating a family subset S must cover either its neighboring source area `U(S)` or the requested demand outside S. Its capacity is `U(S) + A − demand(S)`. Minimizing across subsets gives the maximum matching allocation F.

For minimum mode, each unfilled requested unit costs one, so error is `A − F`. For target mode, excess area in any requested family cannot disappear into the unspecified remainder for free. If union area exceeds A, another `U(all) − A` units must be charged. Otherwise the outside area fills the remainder at zero cost. Together these give `max(A,U(all)) − F`.

This is the same hard-membership transport objective used by the previous prototype, including exclusive allocation and a penalized remainder in target mode. It does not include graded membership or center-quality preference.

## Independent checks

[global-multi-proof.json](global-multi-proof.json) records **7,636 comparisons** against the existing generic min-cost transport solver, with maximum error **5.97×10⁻¹⁶**:

| Requested families | Target/minimum comparisons |
|---|---:|
| 1 | 32 |
| 2 | 400 |
| 3 | 4,800 |
| 4 | 1,200 |
| 5 | 1,204 |

One through three families exhaust all denominator-three source distributions and request compositions. Four and five families use 600 deterministic random cases each, including sparse and overlapping memberships, followed by explicit rainbow cases. Direct subset unions and a zeta-transform implementation also agree. The proof run made no OpenSearch calls and took approximately 0.24 seconds. Its exploratory harness is `/tmp/wallpaperdb-global-multi-proof.mjs`; the implementation phase should retain a repository-native probe.

## Why singleton and pair measurements are insufficient

Three-family distributions can have identical single-family coverages and pair unions but different joint feasibility:

- Distribution E has equal mass in masks `000`, `011`, `101`, `110`.
- Distribution O has equal mass in masks `001`, `010`, `100`, `111`.

Every single coverage is 50% and every pair union is 75% in both. Their three-family unions differ: 75% versus 100%. For a request of one third each, E has error 25% and O has error zero. A full membership histogram distinguishes them.

## Sparse membership representation

During extraction, each pixel receives an 18-bit mask identifying all fixed families it belongs to. Accumulate its alpha-weighted area under that mask, including mask zero. These atoms retain every possible overlap among the fixed families.

For query k ≤ 5, project each global atom onto the selected k bits to build `h[0..2ᵏ−1]`. Compute subset sums `Z(T)=sum h[M] for M⊆T` with a zeta transform. Then:

```text
U(S) = 1 − Z(complement(S))
```

Cost is `O(M·k + k·2ᵏ)` per scored document, where M is its number of stored atoms. At five families the local array contains 32 numbers. The actual distribution of M in the corpus remains to be measured; the theoretical number of possible global masks is 262,144, but source sample size bounds the populated count.

### Mapping recommendation

Use one numeric `long` value per atom, packing the mask and its positive integer alpha count together. Keep total alpha count separately. Numeric doc values support scripting; no per-atom nested documents are needed. [OpenSearch 2.11 numeric field documentation](https://docs.opensearch.org/2.11/field-types/supported-field-types/numeric/)

Do not store parallel numeric arrays of masks and weights and zip them during scripting: Lucene sorts each numeric doc-values list by numeric value, independently. Packing keeps the association intact. [Lucene 9.7 sorted numeric doc values](https://lucene.apache.org/core/9_7_0/core/org/apache/lucene/index/SortedNumericDocValues.html)

The initial 24-bit-count proposal exactly fits up to 256² alpha-byte samples. The implementation decision expands this to **32 count bits**: `packed = mask × 2³² + alphaCount`. With 18 family bits, values stay below 2⁵⁰ and remain exactly representable in JavaScript integers. It supports up to one million RGBA samples. JavaScript must multiply rather than use a 32-bit left shift; Painless can decode its long using a 32-bit shift and mask. Source samples retain exact integer alpha counts. Synthetic mixtures can use a documented fixed total, such as one billion, with largest-remainder quantization.

Keep the bank order and schema version fixed. Derive the indexed singleton and pair-union bounds from the same atoms, ensuring that filter fields and script inputs describe the same distribution.

## Safe indexed bounds

If exact joint error is at most T, every subset must satisfy `U(S) ≥ demand(S) − T`. Existing indexed singleton and pair unions therefore provide necessary lower bounds for all modes.

In target mode, `U(all) ≤ A + T`. Any indexed singleton or pair union is no larger than `U(all)`, so a safe upper bound is **total requested area A plus T**.

Do **not** use a pair's own requested amount as its upper bound for a larger query. Counterexample: all pixels belong to all three families, with requests 20% / 20% / 60%. Joint error is zero, yet the first pair's union is 100%, not 40%. This counterexample and all proposed bounds are checked in the proof harness.

Use these filters to reduce script work, then globally score every remaining parent. Preserve the bounded wrapper's inclusive float32 score-bin certificate, PIT snapshot, stable id ordering, and geometric widening. The bounds remain necessary rather than sufficient; sparse requests or deep pages can require broad scoring.

## Cost and scope

The representation supports any selection of up to five **indexed** families and their requested percentages. It does not support arbitrary new color-region definitions without extraction/reindexing. The score remains hard membership with exact exclusive allocation; it is not a perceptual-quality score.

Storage is one packed long per populated membership atom plus one total, alongside existing filter fields. Script cost grows with M and query size. Measure real atom counts before projecting memory or CPU. Compare direct global scoring and adaptive indexed bounds under controlled load; the token seed already has measurable overhead in the parent benchmark, so it is optional.
