# Repeated target weights — separate prototype

The preserved numeric score loses repeated target weight when OpenSearch rewrites identical Boolean clauses. This prototype restores the intended average without indexing new fields. The original sixteen lab methods remain unchanged; the new scalar method is **Repeated target weights** on port 8228.

## Meaning

Group only the **complete utility field**: color anchor or named feature, requested percentage, quality preset, and cutoff preset. A field requested `c` times among `N` targets receives `field_value_factor.factor = c / N` inside its score function.

- Red 50% + red 50% gives the red 50% utility once at full weight.
- Red 20% + red 20% + blue 20% gives `2/3 × U(red 20%) + 1/3 × U(blue 20%)`.
- Red 20% + red 40% remains two different utility fields at one-half weight each.
- Nearby picked colors that resolve to the same complete field receive the same correction.

This restores term weights. It **does not add percentages together** or allocate disjoint image areas. Red 50% + red 50% does not become a request for100% red. Distinct utility keys retain the exact parent query and service order. Grouped float32 arithmetic can differ slightly from an ideal unrounded mean.

## Why the parent loses weight

[Lucene 9.7 BooleanQuery](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/BooleanQuery.java) merges identical SHOULD clauses by summing their outer boosts. [OpenSearch 2.11 FunctionScoreQuery](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java) passes that boost into the inner query; `boost_mode: replace` then replaces the inner score. Putting multiplicity in the [FieldValueFactorFunction](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FieldValueFactorFunction.java) preserves it during rewriting.

The module also contains sorted and bounded wrappers for later experiments. Only the scalar numeric variant is exposed in the UI/feedback adapter. Distinct bounded queries delegate unchanged; duplicate bounded queries fall back to a complete unbounded OpenSearch query. The old equal-weight pruning threshold is not reused after changing term weights. No application filtering or reranking occurs.

## Validation, September 23

Artifacts are outside Git under:
`~/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`

- `multiplicity-fidelity-v1`:162 executions = six query cases × nine presets × limits 1000/20/1. Five cases exercise duplicates; one verifies same-anchor different-percentage separation. Every returned ID, order, and float32 score matches an independent oracle calculated from the actual service doc values for all 545 assets. Single-equivalent and three filtered/empty-eligibility comparisons also pass.
- The same fidelity run checks 144 ordinary query/preset rankings against the preserved numeric parent, with exact hit equality. Index generations and archived source hashes stay unchanged.
- Offline tests confirm all 8,184 wide-workload query bodies are unchanged; none of those queries contains duplicate resolved fields.
- `multiplicity-feedback-v1`:accuracy-only use of the existing dataset and metrics. Each candidate supports 32 of 38 cases, with six unsupported and zero errors. All supported rankings and feedback metrics are identical. These existing human judgments contain no duplicate targets, so they establish no new human-preference improvement for duplicates.
- `ui-17-complete`:live desktop/mobile verification, duplicate score restoration, mixed weights, different-percentage separation, full-image/source links and fixture exclusion.

These are correctness results on 523 real wallpapers plus 22 controlled fixtures. No new capacity or latency claim is made. Full-bank scale indexing proceeds independently.

## Commands

```sh
make color-favorite-multiplicity-test
make color-favorite-multiplicity-fidelity-test
make color-favorite-multiplicity-fidelity COLOR_FAVORITE_ARGS='--directory NEW_EXTERNAL_DIRECTORY'
make color-favorite-multiplicity-feedback COLOR_FAVORITE_ARGS='--directory NEW_EXTERNAL_DIRECTORY'
```

Both service runners are restricted to the isolated real OpenSearch service on 19216. They create new evidence directories and leave existing indexes unchanged.
