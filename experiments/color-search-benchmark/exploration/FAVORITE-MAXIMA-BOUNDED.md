# Favorite numeric ranking with global maxima bounds

Separate prototype: `favorite-maxima-bounded-utilities.mjs`, method `favorite-utility-maxima-bounded`.

The precomputed numeric score, indexed measurements and final OpenSearch ranking remain unchanged. This version adds necessary numeric range conditions to the existing global OR bound. It requires the same numeric float fields with points and doc values; no new index fields or service requests are needed.

## Current status

**Live as “Global maxima bounds” in the [17-method lab](http://zerotwo:8228/).** The original bounded method remains a separate option. Real-service fidelity passed all 626 comparisons; independently audited feedback retained all 234 judged pair outcomes across 32 supported cases. The subsequent three-primary campaign also preserved global results on one physical node.

Capacity remains unmeasured for this executor. It is one of four methods planned for the same full-million numeric index, whose build is running and whose stored-value audit will follow. Additional range checks may cost more than they save. See [accuracy evidence](FAVORITE-OPTIMIZATION-ACCURACY.md#stronger-bounds-from-global-maxima), [current campaign](FAVORITE-OPTIMIZATION-CURRENT.md) and [capacity plan](FAVORITE-OPTIMIZATION-CAPACITY.md).

## How the additional bound works

Each existing seed query sorts one utility field over every eligible document. Its first returned sort value is that field's global maximum within the PIT and metadata filters. The new executor retains those values.

For a two-target mean, if the kth seed score is `.85` and the global maxima are `1.0` and `.8`, any result that can tie or beat the seed score needs approximately `.9` of the first utility and `.7` of the second. Both conditions must hold. These are added as AND filters alongside the original OR filter. The final query still scores all documents passing the safe bounds, including documents absent from the seed union.

The implementation uses conservative float32 thresholds, not the unrounded real-arithmetic formula. For each field, it holds every other field at its observed maximum, rounds each product outward by an extra float32 unit, sums in double, then rounds the final float32 outward. It binary-searches float32 values for the first value whose upper score bound reaches the kth seed score. Every smaller representable value is unable to tie that score. Filters are inclusive to preserve ties.

## Conservative cases

- Zero seed scores and too few seeds keep the original full numeric query.
- Repeated utility fields keep the original OR bound without extra AND ranges. This includes different requested hex values that resolve to the same anchor and requested amount. Existing duplicate-target scoring behavior is preserved.
- Unexpected nonuniform clause factors or inconsistent global maxima keep the original OR bound.
- Invalid, missing or ascending seed sort values fail the request and close the PIT. They never become speculative maxima.
- Negative zero maxima normalize to positive zero so the float32 bit search remains monotone.

The original timeout budget, per-stage service cap, PIT rotation tracking, filter propagation, partial-result rejection and cleanup behavior are retained. All searches use keyword ID doc values with stored fields disabled.

## API and evidence

The module exports:

- `FAVORITE_MAXIMA_BOUNDED_METHODS` and versioned `FAVORITE_MAXIMA_BOUNDED_DEFINITION`.
- `supportsFavoriteMaximaBounded`.
- `buildFavoriteMaximaBoundedQuery` and `buildFavoriteMaximaBoundedPlan`.
- `executeFavoriteMaximaBoundedUtilitySearch`, with the same arguments as the original bounded executor.
- `favoriteMaximaNecessaryThresholds({ clauses, maxima, kthSeedScore })`, a pure bound calculator.

The builder returns the unchanged numeric body for compilation/provenance. Actual measurements must invoke the executor. Its evidence retains the existing stages and `globalBounds` fields and adds:

```js
globalBounds.maximaBounds = {
  maxima: { 'utilities.example': 0.8 },
  thresholds: [{ field: 'utilities.example', threshold: 0.6999998 }],
  addedRanges: 1,
  fallback: null,
};
```

Threshold values above illustrate the shape; actual thresholds come from the float32 calculation. A null fallback with zero added ranges means the maxima could not tighten any component beyond zero.

## Validation status

`make color-favorite-maxima-bounded-test`: 11 offline tests pass. They cover float32 boundaries from subnormals to one for 1–10 targets, 800 unequal-maxima/bound combinations with 16,000 sampled vectors, predecessor checks, negative zero, duplicate anchors, unchanged final scoring and filters, outside-seed winners, conservative fallback cases, service deadlines, partial responses, PIT rotation and cleanup failures.

The independent design/replay in [FAVORITE-SEED-MAXIMA.md](FAVORITE-SEED-MAXIMA.md) motivated this implementation. That replay found useful extra pruning mainly for two-target searches. It is not a measurement of this executor. Real-service fidelity has since passed in `maxima-fidelity-v1/`, with an independent audit of 626 requests, 83,386 returned scores, PIT lifecycle and conservative thresholds. Extra ranges removed additional documents in 105 requests. That establishes correctness and exercised pruning; scale performance remains a separate pending experiment.

The original bounded executor, scorer, registry and benchmark harness were not edited while creating this prototype.

## Feedback, scale configs and visual comparison

`favorite-maxima-adapter.mjs` wraps the existing bounded feedback adapter's preparation and support checks, then calls the maxima executor. It separately verifies keyword ID doc values and captures the new source/definition metadata. `configs/favorite-maxima-feedback.json` compares the saved favorite, numeric doc-value retrieval, original bounded execution and this refinement across the existing 545-asset feedback corpus.

The initial `configs/favorite-maxima-projection-1m.json` and `configs/favorite-maxima-full-1m.json` compare numeric doc-value retrieval, original bounded execution and maxima bounds on their respective numeric point indexes. The active full-million campaign uses the later four-method plan linked from [current work](FAVORITE-OPTIMIZATION-CURRENT.md), adding direct sort with doc-value IDs; the older three-method full-million config is not its launch plan. Each explicitly supplies the new builder and executor. The benchmark's automatic feedback-config helper still hardcodes the old registry adapter; use the standalone maxima feedback config instead.

The favorite lab activated **Global maxima bounds** as its sixteenth entry after service fidelity passed. The lab now has 17 options: the additional repeated-target correction is a separate scalar method. All preceding methods and indexes remain available. Completed desktop/mobile QA verified maxima results, preset controls, full-image/source links and failure recovery; the browser was closed afterward.

Arrival preflight recognizes only this exact registered method, requires its explicit builder/executor, numeric points and ID doc values, and records the bound definition. The independent file auditor verifies those bindings and successful warmup PIT-stage evidence. Original four-query primary approval and recursive source binding still apply.

Original pre-activation integration checks: `make color-favorite-maxima-adapter-test` (4 tests), `make color-favorite-lab-test` (15 tests), `make color-favorite-optimization-arrival-test` (18 tests) and `make color-favorite-optimization-arrival-audit-test` (11 tests). Those original integration changes made no real-service requests or restarts. The completed service fidelity, feedback and later UI activation described above are separate subsequent evidence; no maxima capacity result has been collected.
