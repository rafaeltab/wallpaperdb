# Bounded confirmation after ordinary maintenance

Proposed 2026-09-22. No follow-up harness has been implemented or run by this reviewer.

## Why

The completed 256-bin full pilot's separately captured refresh reduced observed store size and segment count. The original million-document projection may likewise retain an earlier searchable layout. This new evidence justifies a bounded confirmation; it does not invalidate or relabel the original measurements.

## Maintenance evidence

After the active 1,024-bin pilot finishes, capture each relevant index's current UUID, document count, mapping identity, store/segment/translog statistics and detailed segment list. Run an ordinary flush, ordinary refresh, and the existing search/merge settling check. Capture the same statistics again. No force merge, index recreation, or document changes.

Retain original artifacts and the first refresh-only observations. Record subsequent normal-flush/refresh observations separately. Do not call later sizes the size at original timing.

## Million-projection query confirmation

If maintenance changes the searchable layout, replay the four existing **unfiltered** workload shapes for both favorite banks. Use the unchanged favorite tuning, query generator, top20 global ranking, 950ms server/1500ms client timeouts, disabled request-result cache, one case-specific serial warmup, then C1/C4/C16 with the original strict failure gating. Keep at least32 requests and10 seconds per block. This is at most24 profiles; failed cases omit only their higher levels.

Use a new read-only follow-up driver and separate output directory. The original driver's `--rerun` appends to the original campaign, so it is unsuitable for an immutable parent comparison. Verify the parent artifact checksum, source snapshot, retained index UUID/mapping/count and sampled descriptor values before timing. Save compiled query plans, complete raw trials, resource samples, settling and skips. Compare each warmup's top20 IDs/scores with the original same-case warmup, independent of latency.

Report before/after latency, error and >=1s union counts together with both segment layouts. The representative arrival test remains evidence for its own original layout; do not silently update that result. Additional arrival or full-million indexing is unnecessary for this focused confirmation.
