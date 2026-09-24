# Current optimization handoff

Checkpoint **2026-09-23, after the 20:32:03 stress audit and v11 browser QA**.
**This prototype round is complete.** Query/resource audits, publication and browser
checks passed their evidence checks, with failed load levels retained. No new test
campaign is planned; future optimizations are separate follow-up work.

## Completed state

The full-million build/value audit, pooled fidelity/feedback, 19-method UI checks,
closed-loop/fixed/varied/wide campaigns and higher-rate stress are complete.
The final live check verified all 44 runtime pins unchanged. Scale OpenSearch 19217
and its observer are **stopped**. Real OpenSearch 19216 and UIs 8225/ 8227/ 8228 remain
available; root verified HTTP 200 including `http://zerotwo:8228/performance.html`.
The targeted v11 browser QA passed and the browser is closed.

| Completed stress evidence | Identifier |
| --- | --- |
| Service; start | `wallpaperdb-favorite-opt-wide-stress-v1.service`; 20:19:30.422 UTC |
| State | `full-million-pooled-wide-two-methods-stress-pipeline-v1/status.json` |
| Small phase log | `wide-two-methods-64-128.log` in that pipeline directory |
| Plan | `full-million-pooled-wide-two-methods-stress-v1-proposal/stress-plan.json` |
| Plan SHA-256 | `7266bfda14c4163d3d558426f41b107cffd9bb22522df1d923207433eb2c15f2` |
| Launch evidence | Same proposal's `launch-gate-v1.json`, `proposal-manifest.json`, `favorite-numeric-and-bounded-pooled.json` |
| Audit | `full-million-pooled-wide-two-methods-stress-v1/audit-independent-v1.json`; accepted 20:32:03.312 UTC |
| Result SHA-256 | `114149a7b8c59b952cd481e7418bc32b5e702d3154fe04f64889f7e903fe2899` |
| Final pin/live check | `full-million-final-live-check-v1.json`; all 44 pins verified |
| Waiters | Sessions 86886 and 65011 completed; neither is an active monitor |

The unchanged runtime graph is pinned by
`full-million-pooled-retry-v1-proposal/source-config-plan-pins-v2.json`, SHA
`d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f`.

| Stress method/rate | Trials | p95/max ms | Strict failures | Client rejections | Successful keys |
| --- | ---: | --- | ---: | ---: | --- |
| Numeric 64/s | 11,520 | 154.361/316.415 | 0 | 0 | 6,138/6,138 |
| Numeric 128/s | 23,040 | 1,500.247/1,773.903 | 9,465 | 1,451 | 6,132/6,138 |
| Ordinary bounds 64/s | 11,520 | 277.111/740.410 | 0 | 0 | 6,138/6,138 |
| Ordinary bounds 128/s | 23,040 | 1,401.420/1,680.592 | 6,368 | 254 | 6,116/6,138 |

Each profile ran 180s. Both 64 rates passed all strict checks/full key coverage;
both 128 failed. Do not add rejections to strict failures: they overlap. Numeric
was selected for lowest wide16 p95, ordinary bounds for fixed128 success; this is
not a universal ranking of methods. Maxima's wide16 p95/max beat ordinary bounds.

## Completed campaign and retained failures

Original service `wallpaperdb-favorite-opt-full1m-pooled-v1.service` started at
18:47:29 UTC and completed all eight serial phases with the wide audit at
20:18:51 UTC. Preserve `full-million-pooled-pipeline-v1/status.json`,
`/tmp/favorite-opt-full1m-pooled-v1.log`, and plan
`full-million-pooled-retry-v1-proposal/retry-plan.json`. Do not resume that finished run.
Outputs: `full-million-four-methods-pooled-v1/benchmark.json` and
`full-million-pooled-arrival-{fixed,varied,wide}-v1/arrival.json`.

- Closed-loop: all 144 profiles passed (four methods × four shapes × all/10%/1%
  metadata eligibility × C1/4/16); 1,007,172 timed + 48 warmups; zero strict failures;
  maximum timed 491.544 ms. Audit completed 19:20:49 UTC.
- Fixed: all four passed through 64/s; at 128/s ordinary bounds passed (p95 79.812 ms,
  max 176.921 ms), while numeric/sorted/maxima had 3,723/939/2,371 strict failures.
  Maxima max 11,141.870 ms includes scheduler delay. Audit completed 19:29:31 UTC.
- Varied: all four passed through 128/s; audit completed 19:38:07 UTC. Its 75-query
  cycle has 65 single / 9 pair / 1 five-target, versus fixed 2/1/1 in four. Different
  mixes prevent interpreting the improvement as an isolated cache effect.
- Wide16: each method completed 9,600 trials over 600s. Numeric p95/max 166.693/496.421 ms;
  ordinary bounds 210.876/463.575 ms; maxima 204.753/364.696 ms. All three passed and
  successfully queried 8,184 distinct queries/all 6,138 keys; actual target counts
  were 6,889 single / 1,515 pair / 1,196 five-target requests each.
- Sorted wide16 failed: p95 168.535 ms/max 5,797.602 ms; 104 errors/107 strict failures;
  9,496 successful requests, 8,080 distinct successful queries, 6,088 keys. No full
  successful key coverage. Cause remains unestablished; repeated single-query
  performance stays a separate observation.
- Wide audit `full-million-pooled-arrival-wide-v1/audit-independent-v1.json` accepted
  complete evidence, one failed profile, no pending rows/incomplete resources.
  Result hash `78b30857b2b4a1c295a2ef9a4ddaf4a7fd9463ec7e96e8be73b6dace5946074b`.

Any error or request **>=1,000 ms**, warmups included, fails that load. Accepted
evidence is not a performance pass. Both trial-retention fixes preserve finished
trials on a failed final resource read, without qualifying incomplete resources.
The initial campaign's known file-only overlap at 18:47:38.419–18:47:40.739 UTC
(**2.32 s**) is retained in `full-million-pooled-pipeline-v1/known-overlap.json`;
independent attribution found 78 numeric one-color-vibe C1 timed requests, zero
errors or slow requests. All remain in the results without adjustment. No service
calls/runtime changes occurred. Full-million warmup parity also passed: 48 warmups,
36 cross-method comparisons and 720 exactly matching raw scores.

## Paths, behavior and environment

External artifact root (all relative artifact paths below use this directory):
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`.

Saved favorite `strict-hue-favorite-001`: 256 bins, all shade-aware/strict-hue cutoffs, cutoff exponent
1, linear quality influence 0.5, minimum quality 0. Original extraction/snapshot/query sources remain
preserved. OpenSearch performs all filtering and final ordering; the client compiles queries and safe
bounds.

Correctness corpus: 545 assets = 523 wallpapers + 22 fixtures. Visual comparisons exclude fixtures.
Scale records are deterministic mixtures of the 523 real-image measurements, not one million independent
wallpapers. One physical scale node: 8 CPU quota, 4 GiB heap, 12 GiB memory limit, one primary, zero
replicas.

Keep real OpenSearch **19216**, lab **8228**, and older pages **8225/ 8227** alive. Scale
**19217 and its observer are stopped**; sixteen inactive scale indexes also remain closed. Receipts:
`pre-full-1m-scale-index-inventory.json` and `pre-full-1m-scale-index-close.json`.

## Completed index and correctness evidence

- Index `color-exploration-favorite-points-full-1m-v1`, UUID
  `LHjoEvSiR8KNe5WZv_a7iA`: exactly 1,000,000 records, all 6,138 favorite-preset
  float utilities, numeric points/doc values, source disabled.
- Final build: **56,048,738,808 primary-store bytes**, 66 segments, no active merges
  or translog operations at capture. Indexing 7,170.076 s; with finalization
  7,336.453 s. Four parallel bulks, 47,620 accepted batches, zero failed batches.
- `full-million-build-v1/status.json` completed build and audit at 17:58:20 UTC.
  Receipt `points-full-1m-v1/index.json`; value audit `points-full-1m-v1-audit/audit.json`.
- `full-million-ingestion-complete-audit-v2.json` reconciles all creates, batches,
  IDs, digests and 29 source bindings. `full-million-bindings-independent-v1.json`
  independently replays 82 responses and **18,414 float values** on ordinals
  0/499,999/999,999. This is three complete document samples, not all stored values.
- Pooled fidelity: **2,504 executions / 333,544 scores / 13,256 HTTP stages**,
  2,504 acknowledged native cleanups, 2,503 connection reuses; exact IDs/scores on
  one- and three-primary real indexes, unchanged generations and 34 sources.
  Evidence: `pooled-fidelity-v1/fidelity.json`, its `audit-independent-v2.json`.
- Correct feedback run `2026-09-23T18-36-10.447Z-84f622c2`: four methods each have
  32 supported/6 unsupported cases, no errors, 234 unchanged judged pair outcomes
  (69.4792% agreement), 384 combined timed requests with zero failures. Audits:
  `pooled-feedback-independent-audit-v1.json`, `pooled-feedback-execution-path-audit-v2.json`.
  These are one observer's development judgments, not population accuracy.
- Earlier fetch fidelity (432 comparisons + 24 A/B pairs), execution fidelity
  (1,878), maxima fidelity (626) and three-shard fidelity (1,920 executions /
  342,940 scores) passed execution parity. Detailed results remain in the reports.
- **Separate semantic correction:** repeated resolved utility fields lost weight
  in the original and numeric scorers. Option 17 restores multiplicity without
  adding requested percentages. Its 135 corrections + 27 controls and 144 ordinary
  comparisons passed; human feedback has no duplicate cases. This correction is
  **not** silently included in the four capacity methods.

## Preserved failed attempt and transport repair

The first full-bank screen `full-million-four-methods-v2/` is **failed/incomplete**: 11 finished
profiles had 85,293 timed requests and zero errors, while 12,285 unfinished timed rows include **7,491
errors**. Total: 97,578 timed requests, 7,491 strict failures, four error-free warmups. Its
`audit-independent-auto-v2.json` passes integrity but not completion/acceptance. No arrival stage ran.

The stopped service `wallpaperdb-favorite-opt-auto-capacity-v2.service` and state
`automatic-capacity-continuation-v2/status.json` are historical; their 54-pin plan is superseded by the
unchanged 44-pin runtime graph. Do not resume or overwrite that run.

The terminal resource read failed with `ECONNRESET`; old trial rows lost nested causes. Node 22.22.3 /
Undici 6.24.1 resets sockets after body-bearing DELETE, causing roughly one new connection per PIT
cleanup. Controlled A/B evidence: `transport-maxima-fetch-v1` had 28,269 queries / 46 errors / 28,227
connections; `transport-maxima-pooled-v1` had 52,001 queries over 60 s / zero errors or >=1 s / 32
connections, with identical ID/score hashes. Audit: `transport-ab-independent-audit-v1.json`. Port
pressure is supported; the exact host/Docker allocation failure is not proven. This diagnostic is not
capacity.

Incorrect generic feedback invocation `2026-09-23T18-35-44.336Z-e30f5f5b` is preserved with 148 setup
errors and zero service calls; exclude it from same-dataset accuracy comparisons. Exploration adapters
require `make color-exploration-evaluate`, with `COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216`
and the appropriate config.

## Live UI and publication contract

[Lab](http://zerotwo:8228/) has 19 active methods; options 18/19 change only pooled cleanup transport.
[Performance](http://zerotwo:8228/performance.html) reads the fixed external
`favorite-performance-public-summary.json`, not live service statistics.

Latest checkpoint: `results-checkpoint-20260923-v11.json`, SHA-256
`101c9d7733a489db9afc020d3c7c4ade5d373db7da1e358a6bae4b3afc49d12e`; published 20:34:25.598637 UTC;
14 performance / 8 fidelity / 8 feedback / 13 index receipts, zero warnings.
Receipt `publication-v11-receipt.json`; all failed loads and historical 7,491 errors remain.
`ui-v11-complete/` verifies exact checkpoint/hash, passed64/failed128 rows, historical failures
under filters, desktop/mobile layout and 19 lab methods. Browser closed. Previous v10 SHA
`fa6c46e0cbbb9d7e1815dd9bd5fb9496582dc212099a8213d36eb4e7a0ea7256` remains preserved.

Preserve generated summary bytes and add `publication: {sourceCheckpoint, publishedAt, sourceSha256}`.
**`sourceCheckpoint` must be a basename**, never an absolute path. Hash exact checkpoint bytes and
atomically replace only the public snapshot. Initial v10 metadata yielded 503; corrected at 18:41:44 UTC
without a reader change. Prior/invalid snapshots are retained. Regeneration must retain all six earlier
outside-root feedback inputs plus in-root and pooled feedback.

`ui-19-complete/` records ten pooled/parent top-20 comparisons, fixture exclusion, native cleanup/reuse,
mobile details, the original cutoff modal, and all 7,491 errors visible even when filters leave no
completed rows. Browser is **closed**.

## Resource analysis and remaining work

Completed indexing resources and independent replay: `resources-indexing-completed-v1/`,
`resources-indexing-completed-independent-audit-v1.json`. Mean container CPU 2.347 cores; sampled charge
peak 12 GiB; no OOM. Keep anonymous, file-cache, swap, JVM heap and client memory distinct; layered I/O
is not additive. These indexing observations do not establish query resource cost.

Final query-resource report: `resources-full-million-pooled-completed-v1/`;
independent replay passed 2,490 checks over six focused profiles in
`resources-full-million-pooled-independent-audit-v1.json`. The file-only helper is
`resource-summary-v1-proposal/resource_summary.py` (13 tests/review passed), using
archived `resources-v3` samples. Observer duration was 43,200s from 13:27 UTC; it is now stopped.

1. Resource/overload analysis is complete: [final resource report](FAVORITE-FINAL-RESOURCES.md).
   At passing broad 64/s, numeric/bounds used 3.087/1.774 OpenSearch cores and 0.100/0.184
   driver cores; driver peak RSS 0.634/0.637 GiB includes plans/evidence, not isolated
   gateway cost. Bounds used less CPU but more data reads and higher broad latency.
2. Report the workload-specific outcomes and limits; no further test campaigns or
   prototype builds are planned. Preserve the 2.32 s overlap and all failed loads.
3. Future proposal only: `favorite-cardinality-bounds.mjs/.test.mjs` passed 9 offline tests;
   four campaign-audit tests also passed. It remains unintegrated/unmeasured, without
   executor/network/Make integration. Seed-budget ideas are deferred too.
4. v11 publication, health checks and targeted browser QA are complete. Keep prototypes alive.
5. New wallpapers/ZIP/campaign artifacts are external; legacy ignored `corpus/` and `output/`
   images remain in the worktree. No image/ZIP files are eligible for Git; no commits made.

History: [prior handoff](FAVORITE-OPTIMIZATION-HANDOFF-HISTORY.md), [long
worklog](../GLOBAL-WORKLOG.md), [results](FAVORITE-OPTIMIZATION-RESULTS.md),
[capacity](FAVORITE-OPTIMIZATION-CAPACITY.md), [accuracy](FAVORITE-OPTIMIZATION-ACCURACY.md).
