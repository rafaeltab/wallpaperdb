# Numeric execution fidelity campaign

Implementation checkpoint, September 23, 2026. Ten offline tests pass. Real-service execution remains coordinated by the experiment owner; implementing this runner issued no service queries.

The runner compares `favorite-utility-sorted`, its `track_scores` control, and `favorite-utility-bounded` against the unchanged numeric utility score query on the same point-indexed real corpus. Every service query performs global ranking inside OpenSearch. Local result comparison is an evaluation step only.

## Coverage

- The original16 fidelity queries across all9 quality/cutoff-weight presets.
- All545 wallpapers at limit1000, plus limits20,3 and1 for every core case. Small limits exercise nontrivial bounds rather than relying only on a full-corpus fallback.
- Favorite-preset cases with cohort filters, combined eligible/excluded IDs, exclusions, empty eligibility and naturally zero-scoring wallpapers.
- Identical red targets and two distinct red hex values resolving to the same anchor. Each is also compared with its equivalent single-target query to investigate possible duplicate-clause rewriting by Lucene.

When the retained corpus supplies all14 filtered cases, the campaign performs1,878 candidate execution checks. It separately records numeric-versus-original-native comparisons and the numeric arithmetic oracle.

## What is checked

Sorted results must preserve every ID and float32 score. Copying a numeric sort value can preserve more decimal digits in JSON than OpenSearch's score serializer; raw transport differences are recorded separately from float32 equivalence. The scored control and bounded final query must also match the original numeric response scores exactly.

For bounded execution, every actual PIT request and response is retained. The checker verifies that the final score clauses and base metadata filters are unchanged and that any extra constraint is a global OR of numeric ranges, rather than a seed-ID restriction. It records the positive threshold, seed lower bound, stage count and final service hit IDs. A separate count verifies that some positive bounds actually exclude documents. Before/after index-generation checks ensure that these counts describe unchanged data even though they occur after PIT closure.

Duplicate-target arithmetic is a diagnostic, not an automatically corrected behavior. If the service differs from the intended repeated-term oracle, the campaign saves that finding and continues collecting comparisons. The final report separates `executionPassed` from `intendedArithmeticPassed`; its overall `passed` value requires both. Other execution, ordering and eligibility assertions remain strict.

## Running and evidence

```sh
make color-favorite-execution-fidelity-test
make color-favorite-execution-fidelity COLOR_FAVORITE_ARGS='--directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-execution/fidelity-v1'
```

The default index is `color-exploration-favorite-points-real-v1`. `--index` selects another complete compatible real index; `--favorite-only` narrows controls to the preserved favorite. The index must contain all545 assets, the complete requested utility plan and real numeric points. The runner accepts only the retained real service on port19216.

Evidence goes into a new external directory: frozen source graph, index mappings/counts/UUIDs/generations, all reference rankings and oracles, raw service traces, duplicate diagnostics, successful execution records and progress. Raw service traces are saved before parity assertions. Failed executors attach their partial traces and cleanup evidence to `failure.json`. Existing evidence directories are rejected before service access.
