# Pooled full-million warmup consistency audit

Prepared while the wide campaign was still timing. **Completed after timing: four isolated tests and the full audit passed.** This is a separate external helper; original audit files and frozen runtime files are unchanged.

The default grid requires48 warmups (four methods × four query shapes × three selectivities),36 comparisons against numeric docvalues, and720 score comparisons. It preserves errors, missing lists and strict latency failures. Native pooled raw scores must match exactly; only single-target numeric sort retains the previously documented Float32 serialization exception.

Additional bindings over the original helper:

- Exact pooled builder/executor identities and positive native cleanup witnesses.
- Approved44-pin launch manifest SHA-256 `d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f`, every archived source bound to a matching pin, and identical config bytes/candidate definitions.
- Completed1M full6,138-utility receipt and UUID `LHjoEvSiR8KNe5WZv_a7iA`; matching before/after generations.
- Independently accepted complete raw-capacity audit bound to the saved benchmark, plan and archived sources. Failed performance profiles can still have valid accepted evidence; their failures remain failures.

## Run only after timing finishes and root authorizes file scans

Optional isolated helper tests first (four small tests; no service or campaign reads):

```sh
node --test /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/warmup-parity-pooled-audit-v1.test.mjs
```

Then the real saved-file audit:

```sh
node /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/warmup-parity-pooled-audit-v1.mjs \
  --directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-four-methods-pooled-v1 \
  --receipt /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/points-full-1m-v1/index.json \
  --audit /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-four-methods-pooled-v1/audit-independent-pooled-v1.json \
  --pins /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-pooled-retry-v1-proposal/source-config-plan-pins-v2.json \
  --overlap /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-pooled-pipeline-v1/known-overlap.json \
  --output /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/full-million-four-methods-pooled-v1/audit-warmup-pooled-parity-v1.json
```

Exit0 means complete ranking parity; exit1 is an integrity/ranking failure; exit2 is incomplete/provisional evidence. Output uses exclusive creation and will not overwrite.

## Cheap overlap binding during the same pass

The benchmark's saved raw rows have `startedAt` and `completedAt`, including errors. During the warmup audit's existing single streaming/hash pass over requests, the helper also associates intervals touching **18:47:38.419–18:47:40.739 UTC** with profile/candidate IDs. It reports request counts, observed errors/slow requests, first/last timestamps, and matching profile resource envelopes. This requires no second raw-file scan. Missing timestamps remain explicit.

`known-overlap.json` already records the source interval, activity, zero service requests and unchanged runtime. Before reading raw rows, `benchmark.json` profile `before.at`/`after.at` can narrow the affected profile, but those are broad resource envelopes rather than exact query intervals. Final attribution should use raw request timestamps. The audit does not discard any overlapping sample, estimate its delay, or claim the overlap had no effect.

Warmup equality is supplementary same-index consistency evidence. It is not a proof for every timed query or an independent perception evaluation; the separate545-asset full traces and pooled fidelity remain required.

## Completed result

The external Make wrapper `post-timing-audits-v1.mk` ran `pooled-warmup-tests`, `cardinality-tests`, and `pooled-warmup-audit` after root confirmed timing ended. All four helper tests and all nine unintegrated cardinality tests passed. The completed audit verified48 warmups,36 comparisons and720 identical raw scores/IDs/order; maximum raw delta0. It bound31 archived sources to approved pins and found no errors or warnings.

The overlap touched78 timed requests in `favorite-utility-numeric-docvalues:picked-one-vibe`, C1. Their intervals extended from18:47:38.396 to18:47:40.762 UTC; none errored or reached one second. Those requests remain in the original profile. This is timestamp attribution, not evidence that the audit had zero performance effect.

Use `make -f /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/post-timing-audits-v1.mk pooled-warmup-tests cardinality-tests` to repeat isolated tests. The audit target uses an exclusive output path, so a repeat requires a new output name rather than overwriting the completed report.
