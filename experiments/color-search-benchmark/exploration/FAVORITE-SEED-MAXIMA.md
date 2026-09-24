# Stronger bounds from seed maxima

This document records the initial file-only design and replay. A later separate prototype now has real-service fidelity evidence below; it has no capacity result yet. The preserved favorite and original bounded executor remain separate.

## Necessary per-field bounds

For an equal-weight mean of `n` nonnegative utility values, let `T` be the score of the kth seed result. Let `M_i` be the maximum utility for field `i` across all eligible documents. A document scoring at least `T` must satisfy, for every field:

```text
u_i >= n*T - sum(M_j for j != i)
```

The current bound keeps documents where **any** utility is at least approximately `T`. The new necessary conditions can be added with **AND**, retaining that existing OR condition. For example, with two targets, `T = .85` and maxima `1.0` and `.8`, a winning document needs at least `.9` of the first utility and `.7` of the second. A document passing only one high utility is no longer sufficient.

The existing per-field seed sorts already return the global maximum as their first sort value. A new version could retain those values without adding a service request. Maxima must come from the same metadata filters and PIT as the final search; a sampled maximum or a different snapshot is unsafe. Missing values must have the same zero semantics as the scorer.

## Float32 safety

The real-arithmetic expression above must not be copied directly into range thresholds. Service multiplication and score accumulation round to float32, and equality must preserve ties.

For each proposed field `i`, define a monotone upper bound `H_i(x)` by assigning `x` to that field and the observed global maxima to the other fields. Apply the scorer's float32 factors, round each product outward by an additional float32 ULP, sum in double, then round the final float32 value outward. This follows the conservative allowance already used by the current bounded executor, including positive duplicate-clause grouping. Binary-search the positive float32 domain for the first `x` such that `H_i(x) >= float32(T)`. The inclusive filter `u_i >= x` is safe: every smaller representable value has a score upper bound strictly below `T`.

Omit a field condition if its threshold is zero. Keep the existing full-query fallback for zero lower bounds and too few seeds. An inconsistent maximum or impossible lower bound must trigger a conservative fallback or error, never a narrower filter. The same deadline, PIT cleanup and final OpenSearch scoring remain necessary. This proposal performs no application scoring or reranking.

The current duplicate-target defect reduces the observed score relative to its intended sum. The replay retains that service behavior; it does not fix the defect. Any later change to coefficient grouping must be covered by new proof tests and real service fidelity checks.

## Replay on saved real-corpus responses

The replay reconstructed 189 complete utility fields from already saved full-corpus seed sorts. It checked the maxima against the appropriate eligibility set, reproduced the current candidate counts from the recorded service count queries, and tested the proposed ranges against every saved winner **and every score tied with or above the seed lower bound**. All checks passed across 473 positive-bound executions.

| Targets | Executions | Executions with extra pruning | Current candidate visits | Proposed candidate visits | Largest extra reduction in one execution |
| --- | ---: | ---: | ---: | ---: | ---: |
| One | 314 | 0 | 2,918 | 2,918 | 0 |
| Two | 123 | 102 | 18,703 | 5,122 | 525 |
| Five | 36 | 3 | 5,163 | 5,159 | 2 |

Visits sum across multiple controls, filters and result limits; they are not distinct wallpaper counts. The two-target reduction is promising. Five-target maxima leave enough room in the other components that almost all new thresholds are ineffective. This result does not support expecting a similar gain for larger combinations.

No service requests or timing measurements were made. Additional numeric intersections may cost more than they save, and one million synthetic records can have a different joint utility distribution. The proposal is a candidate for a separate measured refinement if full-schema concurrency results justify it.

## Evidence

### Subsequent real-service validation

The new `favorite-utility-maxima-bounded` executor completed `maxima-fidelity-v1` at 15:56:34 UTC. All 626 requests and 83,386 returned scores exactly preserved numeric-service order and scores. Independent auditing reconstructed all relevant utility values, validated the float32 threshold predecessors, checked same-PIT global maxima/final filters and reproduced service candidate counts. All 4,543 winners/ties above the seed lower bounds survived.

There were 458 requests with extra ranges and 105 with extra pruning, matching the earlier replay's 102 two-target and three five-target improvements. The implemented version conservatively disables extra ranges for duplicate utility fields and preserves the original bound. Separate feedback auditing found every assessed human-preference pair unchanged. This validates behavior on the 545-asset corpus; it does not measure the cost of the extra intersections or establish production speed.

Implementation evidence: `maxima-fidelity-v1/`, `independent-maxima-audit-v1.py`, and the maxima feedback audit files. No timing claim is drawn from these correctness runs, which may overlap unrelated indexing.

External root:

```text
/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/
```

- `execution-fidelity/`: original service evidence and completed independent audit.
- `independent-seed-maxima-bound-replay-v2.py`: standalone file-only analysis.
- `seed-maxima-bound-replay-v2.json`: all thresholds, maxima, counts and verdicts.
- Original fidelity summary SHA-256: `713335ff39d17b1c4b709ddbbb5254a6da35e89f75a64696c8560cedff4dd1db`.
- Replay implementation SHA-256: `3eee3a9bf9560588e114b8300f9a8287e921e6488289542e0fbf44b936ffa602`.
