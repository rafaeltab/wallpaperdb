# File-only warmup ranking consistency

`warmup-parity-audit.mjs` compares retained warmup top20 results against the
numeric-docvalue method, without querying any service or importing scoring code.
It streams warmup rows from `requests.jsonl` and reads the saved benchmark
checkpoint, plan, source snapshot, completed index receipt and raw evidence audit.

The default expectation is the full-million campaign's48 warmups: four methods ×
four query shapes × three metadata-filter selectivities. This yields36 candidate
comparisons against the numeric reference, or720 returned score comparisons when
all warmups succeed. It checks:

- Completed receipt count/scope/UUID and unchanged before/after index fingerprints.
- Raw evidence audit acceptance bound to the exact parsed benchmark, plan and
  archived-source hashes. An unavailable audit keeps results provisional.
- The saved candidate builder/executor identities, query inputs, controls,
  reference score clauses, utility field mappings and metadata-filter bindings.
  Exact top-level query keys reject hidden eligibility changes such as `post_filter`.
- Complete expected20-hit lists, unique IDs, finite monotone scores, deterministic
  ID order on float32 ties, and synthetic ordinal eligibility under each filter.
- Actual bounded-executor stage summaries including PIT opening/closing and final
  global execution. These summaries do not contain every stage request body;
  the separate545-asset trace/fidelity proof remains necessary.
- Exact IDs/order and float32 scores; raw numeric scores must also match except
  that a single-target direct sort may serialize the same float32 differently.
  Every raw delta is reported, even in that allowed case.

Missing/error cases remain unavailable. A truncated result cannot pass. Completed
ranking agreement does not erase a request at or above1,000ms. `parityPassed` is
null when evidence is incomplete, false for an observed mismatch, and true only
when all required lists, index generations and audited evidence are complete.
Errors and audit/hash inconsistencies remain explicit. Outputs never overwrite.

This is consistency of saved warmup rankings at the stated index scope. It is not
an independent proof of every document score, every timed response, arbitrary
queries, intended duplicate arithmetic, perception accuracy or new capacity.

## Exercised historical evidence

- `warmup-parity-full100k-v2.json`: full6,138-field index,100,000 records;12 warmups,
  eight comparisons, every ID/order/raw score identical.
- `warmup-parity-projection1m-v2.json`: nine-field projection,1,000,000 records;
  the same12/eight counts and exact results.

Those runs contained numeric-docvalue, sorted-docvalue and bounded methods; maxima
was absent and is not included in their claims. The full-million four-method
campaign remains pending. Earlier draft and v1 outputs are preserved.

Eight offline tests cover transport precision, native-score mismatches, missing
and truncated hits, strict latency failures, duplicate IDs/ties/eligibility,
hidden filters and an incomplete copy of real saved benchmark evidence.

## Run after the full-million screen and its raw audit finish

```sh
node /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/warmup-parity-audit.mjs \
  --directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-four-methods-v2 \
  --receipt /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/points-full-1m-v1/index.json \
  --audit /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-four-methods-v2/audit-independent-auto-v2.json \
  --output /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-four-methods-v2/audit-warmup-parity-v1.json
```

Tests:

```sh
node --test /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/warmup-parity-audit.test.mjs
```

Exit0 means complete verified parity; exit1 means an integrity error or observed
ranking mismatch; exit2 means no complete parity verdict. Saved errors and missing
cases must still be reported, whichever exit code is returned.
