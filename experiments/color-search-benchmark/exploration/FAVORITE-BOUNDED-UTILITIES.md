# Exact bounded numeric utilities

`favorite-utility-bounded` preserves the precomputed numeric utility objective. It changes query execution, not the favorite's mathematical formula or utility precision. Its final ranking is performed globally by OpenSearch.

## Execution

1. Open one point-in-time snapshot (PIT), rejecting partial creation.
2. For each distinct requested utility, ask OpenSearch for its highest `limit` values under the same metadata filters, using numeric field sorting without scores.
3. Union those IDs, then ask OpenSearch to score the union using the unchanged numeric utility query. Its kth returned score is a valid lower bound on the global kth score.
4. Derive a conservative float32 threshold `B`. Run the original scoring query over the whole snapshot with the extra condition: at least one requested utility must be `>=B`.
5. Close the PIT in `finally`. A failed cleanup is reported as a failed request. The PIT also has a short expiry if cancellation or network failure prevents cleanup.

The application never computes wallpaper scores or sorts retrieved candidates. Seed retrieval only supplies a lower bound; every document that could tie or beat it remains eligible for the final global query. Metadata constraints apply in every search stage. Duplicate targets remain duplicated in scoring while sharing seed and bound-filter work.

## Bound and float safety

Each stored utility is a float32 value in `[0,1]`. For `n` targets, the native objective multiplies each utility by the float32 factor `a=float32(1/n)`, rounds each term, adds the terms, and rounds the final score. There are at most ten targets.

If all utilities are at most `x`, monotonicity gives an upper bound on every term. The implementation rounds the product upward by an extra float32 step, multiplies that bound by `n`, then rounds the total upward again. This intentionally allows extra rounding error, including positive duplicate-clause grouping. It is more conservative than using the mathematical average alone.

Binary search over nonnegative float32 values finds the first `B` whose uniform upper bound reaches the kth seed score. The previous float32 value has an upper bound strictly below that score. Therefore, any document whose utilities are all `<B` cannot tie or beat the lower bound. Inclusive `>=B` comparisons retain boundary ties. OpenSearch's serialized seed score is converted back to float32 before this calculation so its decimal JSON representation cannot accidentally raise the lower bound.

If the bound is zero, or too few seed scores exist, the executor falls back to the full unchanged numeric query. Missing utility values score zero under the original query and do not invalidate a positive bound.

## Consistency and deadlines

Every stage searches the same PIT, so intervening updates cannot invalidate the lower bound. The executor uses the documented [OpenSearch2.11 PIT API](https://docs.opensearch.org/2.11/search-plugins/searching-data/point-in-time-api/). Snapshot creation, searches, and cleanup share one total client timeout. Up to100ms, capped at10% of that timeout, is reserved for cleanup. IDs are fetched through doc values with utility source retrieval disabled.

## Status

Seven focused tests pass. They cover float32 boundaries and subnormals, all target counts1–10, candidate completeness, metadata preservation, global winners outside the seed set, zero-score ties, duplicate targets, partial search failures, total deadlines, late/partial PIT creation cleanup, and explicit cleanup failures. Real-service fidelity and end-to-end performance still need the integration runs coordinated by root. Multiple round trips and PIT overhead may outweigh any pruning; there is no speed claim yet.

Files: `favorite-bounded-utilities.mjs`, `favorite-bounded-utilities.test.mjs`. Run tests with `make color-favorite-bounded-utilities-test`. The `buildFavoriteBoundedQuery` export returns the underlying full numeric query only for support/compilation metadata; actual measurements must call `executeFavoriteBoundedUtilitySearch`.
