# Pooled cleanup refinement and million-image retry

## Transport evidence, 2026-09-23

The first full-schema million-image comparison was interrupted by a transport error. Its 11 completed profiles and 12,285 additional timed rows remain preserved in `full-million-four-methods-v2`; the additional rows include 7,491 errors. These are failures, not passing profiles.

Node 22.22.3's bundled Undici 6.24.1 closes its HTTP/1 connection after this DELETE-with-body request. The PIT (point-in-time snapshot) cleanup therefore created roughly one new connection per query even with keep-alive headers. The separate prototype changes only that cleanup transport to a shared native Node HTTP agent. Query bodies, score arithmetic, PIT lifecycle, filters, deadlines and retry count remain unchanged. No host or OpenSearch setting was changed.

| Fixed-query diagnostic, concurrency 16 | Original fetch cleanup | Pooled cleanup |
|---|---:|---:|
| Queries | 28,269 | 52,001 |
| Observed duration | 38.927 s | 60 s |
| Query errors | 46 | 0 |
| Service request errors | 52 | 0 |
| Queries at or above one second | 0 | 0 |
| New HTTP connections | 28,227 | 32 |
| Open PIT contexts afterward | 9 | 0 |

Both returned the same successful hit/score hash on the same query, preset, index UUID, runtime and frozen source. The original run stopped at its error budget; the pooled run completed. The saved ephemeral range has 28,232 ports, close to the original failure onset. Connection churn and its removal are directly measured; the exact failing network namespace/proxy allocation remains an inference. This diagnostic includes instrumentation, one fixed query and unequal run lengths, so it is not capacity qualification or a clean throughput comparison.

Evidence is under the fixed external experiment root:
`~/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`:

- `transport-maxima-fetch-v1/`, `transport-maxima-pooled-v1/`: immutable diagnostic runs.
- `transport-cooldown-after-fetch-v1.json`: zero PIT contexts and low TIME_WAIT before the pooled run.
- `transport-ab-independent-audit-v1.json`: independent raw trials, retained traces, counters and identity reconciliation; passed.
- `failure-screen-v2-file-review-v1/runtime-transport-evidence.json`: runtime source excerpts and hashes.

## Separate methods

- `favorite-utility-bounded-pooled-delete`
- `favorite-utility-maxima-bounded-pooled-delete`

Each requires a successful native DELETE transport witness. A test recorder must wrap the actual pooled transport; substituting the original API cannot silently validate the new method. The shared pool survives individual queries. Original methods and the favorite snapshot are preserved. This refinement does not fix repeated identical utility targets; the separate multiplicity prototype handles that objective.

The standalone feedback adapter uses the original numeric index preparation and additional ID doc-value checks. `configs/favorite-pooled-feedback.json` compares the saved favorite, numeric reference and both pooled variants using the 545-image development corpus (523 real images and 22 fixtures). The correct invocation is `make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/favorite-pooled-feedback.json'`. The earlier `color-eval-run` invocation resolved adapter paths incorrectly: its preserved 148 setup errors involved no service queries and are not relevance or capacity results.

## Failure recording

Future benchmark and arrival rows retain wall timestamps, nested transport causes and failed executor stages. Arrival rate trials are written before the final resource read, so that read cannot erase a completed rate. Closed-loop latency is captured before diagnostic serialization; arrival latency retains the scheduler’s end-to-end boundary. A final resource-read failure now persists the completed workload first, with null CPU deltas, `finalResourceCollectionComplete: false`, and `viableAtTestedLoad: false`; the campaign still stops as interrupted. The independent auditor accepts internally consistent interrupted evidence without calling it complete or qualified. Historical artifacts are unchanged. Arrival final resource samples follow raw-log writing, so those CPU intervals include artifact-writing overhead after the request window; they are campaign activity measurements, not pure per-query CPU costs.

## Retry plan

`full-million-pooled-retry-v1-proposal/retry-plan.json` uses the existing serial Make pipeline and new output directories. Root must approve completed pooled fidelity and feedback before launching it.

1. Four methods on the same full-schema million-image index: numeric doc values, sorted doc values, bounded pooled cleanup, maxima pooled cleanup. Screen all four query shapes, all three metadata filters, and gated concurrency 1/4/16.
2. Independent raw capacity audit.
3. Qualified candidates only: fixed then varied scheduled arrivals at 8/32/64/128 requests per second, 30 seconds per rate; audit each campaign.
4. Qualified candidates only: wide arrival workload at 16 requests per second for 600 seconds; audit actual successful utility coverage.

The wide run schedules 9,600 requests across the 8,184-query cycle. Full-bank coverage is established from actual successful compiled fields, not merely the planned cycle. No-qualified-candidate termination is a valid experimental outcome. One node, one primary shard, synthetic descriptor mixtures, warm caches and a shared host remain limitations; this is no evidence for 100 million images or production multi-tenant capacity.
