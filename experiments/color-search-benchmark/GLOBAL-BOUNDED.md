# Certified bounds for global fine color-area search

**Result:** the prototype recovers the exact global ranking for its indexed fine-area objective while using coarse token results only to choose a safe search bound. Final results are selected by OpenSearch from the full eligible index. They are not restricted to the token seed.

Run `make color-global-bounded-probe`. The dedicated index is `color-global-bounded-probe` on port 19216. [Probe evidence](global-bounded-probe.json) records the checks; [implementation](global-bounded.mjs) exports `boundedSearch`, `openPit`, and `closePit`.

## What is being ranked

For each requested fixed family, the source-pixel coverage and requested amount are rounded to integers from 0 to 10,000. Error is the sum of absolute differences:

```text
E(document) = Σ abs(fine_family − requested_family)
score = number_of_requested_families × 10,000 − E(document)
```

Lower error wins; identical scores are ordered by stable document id. This remains the independent-family model described in [GLOBAL-NATIVE.md](GLOBAL-NATIVE.md): overlapping families can count the same pixel. Exactness here means the global optimum of this indexed objective, not exact full-resolution pixel interpretation or the earlier joint transport model.

## How the bound works

1. Open one point-in-time view (PIT), or reuse the caller's existing PIT.
2. Fetch K results from the inexpensive whole-percentage token query, with the selected families' fine integer values returned as doc values.
3. Compute their fine errors. Let `T` be the largest of those errors. If fewer than K are available, use the maximum possible threshold instead.
4. Search the same PIT globally using the fine numeric score, the original metadata filters, and an indexed range constraint for every selected family: `requested − T ≤ fine ≤ requested + T`.
5. Apply the inclusive score floor `number_of_families × 10,000 − T`. This removes documents whose combined error exceeds T, even if they pass every individual range.

**Why this is safe:** all error terms are nonnegative. Any document with total error at most T must have every individual error at most T. Therefore every better or tied document passes all range constraints. The K seed documents demonstrate that at least K eligible documents have error at most T. Their identities have no role in final selection.

The range constraints form a containing box around the summed-error region; they are necessary, not sufficient. The score floor selects the actual summed-error region. An omitted floor could allow irrelevant box corners to fill an undersized page before the threshold was widened.

## Pagination and underestimated thresholds

The caller may provide `threshold` as a starting hint. Even a deliberately incorrect threshold of zero is safe: if the bounded query returns fewer than one full page, the wrapper widens T to at least one and then doubles it until it has a complete page or reaches the maximum possible error.

Once a complete page is available within T, every result outside T has a strictly worse score, so it cannot precede that page. This remains true after a `search_after` cursor. At maximum T, the query includes the entire metadata-eligible snapshot; a short page then certifies exhaustion. Threshold widening can therefore reveal progressively worse results without skipping better ones or returning duplicates.

Requests must reuse the same colors, filters, PIT, and fine-score cursor. The returned `next` object includes a query fingerprint; spreading it into the next call rejects changed query/filter input. A cursor without a PIT is rejected. OpenSearch documents PIT plus `search_after` as the mechanism for consistent pagination over a fixed snapshot. [OpenSearch 2.11 pagination documentation](https://docs.opensearch.org/2.11/search-plugins/searching-data/paginate/)

## API and ownership

```js
const first = await boundedSearch(index, colors, {
  size: 20,
  filter: [{ term: { cohort: 'real' } }],
});
const second = first.next
  ? await boundedSearch(index, colors, {
      size: 20,
      filter: [{ term: { cohort: 'real' } }],
      ...first.next,
    })
  : null;
await closePit(second?.pitId ?? first.pitId);
```

The result contains `hits` (the returned hit array), `pitId`, integer `threshold`, `exhausted`, `next`, `diagnostics`, and `timing`. By default `_source` is disabled. `_source`, `profile`, `track_total_hits`, and a per-search `timeout` can be supplied; the timeout defaults to 15 seconds. Metadata filters are native query clauses. This wrapper supports area score/id ordering; quality tie-breaking and `from` pagination are deliberately rejected.

The wrapper creates a PIT if absent and returns it for reuse. **The caller closes it.** Searches extend its default two-minute lifetime. On an error, the wrapper closes a PIT it created; an externally supplied PIT remains the caller's responsibility. Creation and searches disable partial results, and the wrapper refuses timed-out or failed-shard responses. [OpenSearch 2.11 PIT API](https://docs.opensearch.org/2.11/search-plugins/searching-data/point-in-time-api/)

`diagnostics.iterations[].boundedTotal`, when requested, counts the current bounded query. It must not be displayed as the number of all metadata-eligible wallpapers. The wrapper does not perform a separate original-eligibility count.

## Verified against real OpenSearch 2.11

The probe uses 429 generated feature documents across three shards and verifies:

- Seeded first pages agree exactly, including scores, with the complete eligible fine-score oracle.
- A true fine-score winner deliberately placed outside the coarse token seed is recovered globally.
- Both documents exactly on a one-unit error boundary survive numeric range and `min_score` filtering.
- A threshold of zero widens before returning a complete page.
- All 429 documents paginate exactly once, in oracle order, across 26 pages; the run performs 16 threshold widenings.
- Metadata filtering, fewer than K eligible documents, and an empty eligible set work correctly.
- A newly inserted perfect match stays absent from an existing PIT and appears first in a new PIT.
- Unsafe cursor reuse is rejected.

The maximum score is at most 100,000 for ten families, well below the 2²⁴ exact-integer boundary of float32 scores. Probe scores and boundary ties were exact; no fractional-score epsilon is used for this integer model.

## Cost and practical limits

A normal first page uses two searches plus PIT creation: token seed, then globally bounded fine scoring. Later pages often need one search when the existing threshold is sufficient; widening adds more. Diagnostics report each request and separate PIT, seed, and final-query wall time.

Tighter bounds may sharply reduce expensive fine scoring. Poor seeds, sparse matches, or deep pages may make the bounds cover most of the index; correctness is retained while performance approaches a full fine-score scan plus the extra requests. Network latency can outweigh CPU savings on small indexes. The correctness probe is not a production latency benchmark, and profile runs are not representative throughput measurements.

## Bounded joint search: preserve overlapping-region allocation

[global-joint-bounded.mjs](global-joint-bounded.mjs) also exports `boundedJointSearch`, using the exact one/two-region hard-membership scorer in [global-joint.mjs](global-joint.mjs). Its API and result shape match `boundedSearch`, but `threshold` is a joint error fraction from 0 to 1, and `mode` can be `target` or `minimum`. Both `filter` and `filters` are accepted. It uses the same PIT ownership, timeout, failed-search rejection, query fingerprint, and score/id cursor rules.

The token seed fetches unquantized family coverages and the selected pair's union fraction as doc values. Each seed's true joint error is computed from these fields. The global final query applies the joint scorer's safe indexed coverage/union bounds and then its exact script. Unlike independent marginal scoring, a pixel in both requested regions cannot fulfill both requested portions simultaneously. An indexed pair union contains enough information for the two-region allocation problem; arbitrary additional regions are not supported by this wrapper.

### Float32 ties need an additional certificate

Joint scores are fractions. OpenSearch rounds them to float32, so slightly different real errors can produce identical scores. When scores tie, id order must win even if an earlier id has slightly worse real error. Simply using the largest real seed error as a cutoff can incorrectly exclude that earlier id.

For a positive returned float32 score `S`, let `P` be the immediately preceding representable float32 score. Every document whose rounded score is at least S has real error at most `1 − (S + P) / 2`, allowing for the midpoint tie. `jointTieThreshold` computes that boundary and adds twice the joint scorer's numerical epsilon. Score zero requires a threshold of one.

The seed bound covers the entire lowest seed score's float bin. Before returning **any** complete page, the wrapper also checks the actual last result's float bin. If the current bound does not include that whole bin, it expands and reruns. This final check matters because the script's numerical tolerance and float conversion can admit a thin band from a lower score bin. A short page widens from zero to at least 0.000001, then doubles the threshold up to one. Thus every returned page is globally complete under OpenSearch's actual float32 score/id ordering.

### Joint correctness evidence

`make color-global-joint-bounded-probe` creates only `color-global-joint-bounded-probe`. [Its evidence](global-joint-bounded-probe.json) records 15 checks on 430 generated feature documents across three shards:

- The best joint match lies outside the coarse marginal token seed and is recovered globally.
- Both target and minimum modes agree with the complete eligible joint oracle, including metadata filters, sparse eligibility, and no eligible documents.
- An adversarial result with real error 0.200000015 must precede a result with error 0.2 because their float32 scores tie and its id is earlier. Starting at threshold 0.2 initially excludes it; the final-score certificate widens the threshold and returns the correct id.
- Pagination traverses all 430 documents exactly once in 26 pages in each mode, starting from threshold zero.
- The same PIT excludes a newly inserted exact best match; a new PIT returns it.

The joint wrapper preserves the indexed two-region hard-membership objective. It does not restore arbitrary custom regions, graded membership, center-quality preferences, or support for five requested colors. Its cost still includes the seed request and possible widening, and broad bounds can approach a global script scan.
