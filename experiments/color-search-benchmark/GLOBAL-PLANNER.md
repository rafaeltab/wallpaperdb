# Metadata-aware exact color query planner

Status: **completed**. Generated 2026-09-16T15:56:55.865Z; completed 2026-09-16T15:57:08.187Z.

## Strategy and correctness

The planner uses the typed existing scorer and changes only which complete OpenSearch query executes. Without metadata filters it uses adaptive bounds. With filters, it creates or reuses a PIT (a stable index snapshot) and runs a metadata-only search with `size: 0` and `track_total_hits: 10001` on that same PIT. Only an **exact count of at most 10,000** chooses direct scoring of every eligible document. Larger or lower-bound counts choose adaptive search. An exact zero count returns an exhausted empty page.

The 10,000 threshold was selected from the previous [changing-query experiment](GLOBAL-VARIED.md), where direct scoring won on 1% metadata partitions. It is a workload-specific prototype choice, not a universally optimal threshold. The count itself adds a request and can cost more than its benefit on some queries.

Both paths rank entirely in OpenSearch using the unchanged joint hard-area objective. The count has no color bounds and no pagination cursor. Score requests reuse the count's latest PIT; subsequent pages retain the complete sort tuple and validate a query fingerprint. Each filtered page recounts metadata on the same PIT. Timeouts, partial results and early termination fail the count/direct path; the existing adaptive path retains its completeness checks. The caller owns the returned PIT and must close it. On failure, the planner closes a PIT it created.

## Evaluation scope

- The same frozen one-million-document synthetic mixture index, 60 deterministic varied queries, 18 family definitions, and typed script as the previous workload. These are descriptor mixtures of 100 wallpapers and 20 fixtures, not one million independent wallpapers.
- The node, scripts, data and query set were **already warmed** by prior experiments. No cache flush. This experiment deliberately retests the known workload to evaluate the planner decision; it is not an unseen-query or cold-start trial.
- Fresh direct, adaptive and planned queries are run in rotating method order. Every ordered top-20 ID and float32 score must agree. Index mutation counters and all relevant source hashes must remain unchanged.
- Sequential latency includes each method's complete request path. Adaptive/planner timings include PIT creation and cleanup; planner timings also include counting. Direct reference latency is one score request.
- After sequential validation, separate concurrency-four passes run the same 60-query mixed workload, first adaptive then planner. This warms caches further and gives the second pass a possible cache advantage. Every concurrent result is compared to the fresh exhaustive reference.
- Additional tests cover omitted filters, empty filter arrays, an empty result, exactly 10,000/10,001/more eligible documents, both target/minimum modes, same-PIT direct/adaptive pagination, exhaustion and mismatched query rejection.

Index: `color-global-multi-1000000-v1`. Data cache key: `789da7256e972ef46e5699713a46c2bf95dc8d22f356e2566ca93fa0aaab3352`. Index mutation counters unchanged: **true**. Source hashes unchanged: **true**.

## Results

Sequential comparisons passed: **60/60**. Concurrent checks: **120/120**. Edge/pagination checks: **15**. Failures: **0**.

On this warmed workload, the planner reduced mixed sequential median latency from **23.5 to 9.3 ms**, and p95 from **120.7 to 58.4 ms**, compared with always-adaptive search. With four concurrent requests, median latency fell from **57.6 to 16.1 ms** and p95 from **384.3 to 135.4 ms**. Both planned figures include counting where applicable, PIT creation and cleanup.

For metadata filters selecting exactly 10,000 documents, three/five-family sequential medians were **10.5/9.3 ms** with planning versus **47.0/100.1 ms** with adaptive search. Direct scoring alone took **6.9/6.6 ms**: planning adds measurable count and PIT overhead, while avoiding repeated adaptive searches. This supports the chosen decision on the tested workload; it does not establish 10,000 as the best threshold elsewhere.

The concurrency passes completed 60 queries in **2.00 seconds** for adaptive search and **0.66 seconds** for planning. These are finite-pass observations. The planner pass ran second and may have benefited from additional cache warming.

| Pass | Method | Regions | Filter | n | Median ms | p95 ms | Max ms | Median requests |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| sequential | exhaustive | all | mixed | 60 | 19.9 | 258.7 | 263.9 | 1 |
| sequential | exhaustive | 1 | all | 8 | 19.9 | 32.4 | 32.4 | 1 |
| sequential | exhaustive | 1 | one_percent | 7 | 3.0 | 4.7 | 4.7 | 1 |
| sequential | exhaustive | 2 | all | 7 | 41.1 | 69.7 | 69.7 | 1 |
| sequential | exhaustive | 2 | one_percent | 8 | 3.5 | 31.4 | 31.4 | 1 |
| sequential | exhaustive | 3 | all | 8 | 203.5 | 247.1 | 247.1 | 1 |
| sequential | exhaustive | 3 | one_percent | 7 | 6.9 | 23.6 | 23.6 | 1 |
| sequential | exhaustive | 5 | all | 7 | 258.7 | 263.9 | 263.9 | 1 |
| sequential | exhaustive | 5 | one_percent | 8 | 6.5 | 9.9 | 9.9 | 1 |
| sequential | adaptive | all | mixed | 60 | 23.5 | 120.7 | 178.7 | 5 |
| sequential | adaptive | 1 | all | 8 | 5.2 | 15.6 | 15.6 | 3 |
| sequential | adaptive | 1 | one_percent | 7 | 8.5 | 14.0 | 14.0 | 4 |
| sequential | adaptive | 2 | all | 7 | 12.4 | 29.7 | 29.7 | 3 |
| sequential | adaptive | 2 | one_percent | 8 | 20.2 | 32.5 | 32.5 | 5 |
| sequential | adaptive | 3 | all | 8 | 25.5 | 47.4 | 47.4 | 3 |
| sequential | adaptive | 3 | one_percent | 7 | 47.0 | 95.1 | 95.1 | 7 |
| sequential | adaptive | 5 | all | 7 | 103.8 | 129.6 | 129.6 | 5 |
| sequential | adaptive | 5 | one_percent | 8 | 100.1 | 178.7 | 178.7 | 6 |
| sequential | planner | all | mixed | 60 | 9.3 | 58.4 | 153.7 | 4 |
| sequential | planner | 1 | all | 8 | 4.4 | 11.2 | 11.2 | 3 |
| sequential | planner | 1 | one_percent | 7 | 8.0 | 15.9 | 15.9 | 4 |
| sequential | planner | 2 | all | 7 | 7.4 | 41.1 | 41.1 | 3 |
| sequential | planner | 2 | one_percent | 8 | 7.8 | 20.6 | 20.6 | 4 |
| sequential | planner | 3 | all | 8 | 10.7 | 58.4 | 58.4 | 3 |
| sequential | planner | 3 | one_percent | 7 | 10.5 | 15.5 | 15.5 | 4 |
| sequential | planner | 5 | all | 7 | 36.1 | 153.7 | 153.7 | 5 |
| sequential | planner | 5 | one_percent | 8 | 9.3 | 13.6 | 13.6 | 4 |
| concurrency4 | adaptive | all | mixed | 60 | 57.6 | 384.3 | 466.3 | 5 |
| concurrency4 | adaptive | 1 | all | 8 | 9.1 | 18.7 | 18.7 | 3 |
| concurrency4 | adaptive | 1 | one_percent | 7 | 13.4 | 50.1 | 50.1 | 4 |
| concurrency4 | adaptive | 2 | all | 7 | 34.3 | 55.2 | 55.2 | 3 |
| concurrency4 | adaptive | 2 | one_percent | 8 | 45.6 | 118.1 | 118.1 | 5 |
| concurrency4 | adaptive | 3 | all | 8 | 60.5 | 135.7 | 135.7 | 3 |
| concurrency4 | adaptive | 3 | one_percent | 7 | 123.4 | 188.5 | 188.5 | 7 |
| concurrency4 | adaptive | 5 | all | 7 | 358.3 | 434.1 | 434.1 | 5 |
| concurrency4 | adaptive | 5 | one_percent | 8 | 321.5 | 466.3 | 466.3 | 6 |
| concurrency4 | planner | all | mixed | 60 | 16.1 | 135.4 | 238.0 | 4 |
| concurrency4 | planner | 1 | all | 8 | 5.8 | 42.3 | 42.3 | 3 |
| concurrency4 | planner | 1 | one_percent | 7 | 14.4 | 37.8 | 37.8 | 4 |
| concurrency4 | planner | 2 | all | 7 | 14.2 | 23.4 | 23.4 | 3 |
| concurrency4 | planner | 2 | one_percent | 8 | 16.9 | 104.9 | 104.9 | 4 |
| concurrency4 | planner | 3 | all | 8 | 15.4 | 83.5 | 83.5 | 3 |
| concurrency4 | planner | 3 | one_percent | 7 | 13.6 | 52.3 | 52.3 | 4 |
| concurrency4 | planner | 5 | all | 7 | 135.4 | 238.0 | 238.0 | 5 |
| concurrency4 | planner | 5 | one_percent | 8 | 31.4 | 57.0 | 57.0 | 4 |

Per-family-count/filter groups contain only seven or eight changing queries. Their p95 is the largest observation and is not a stable production tail estimate. The finite workload and already warmed state limit generalization; experimental family definitions still require human relevance evaluation.

## Reproduce

Run `make color-global-planner` while other indexing/benchmark work is idle. The existing dedicated OpenSearch 2.11 scratch index is required; the runner creates PITs but never rebuilds data, mutates documents, or changes the UI. [global-planner.json](global-planner.json) records source/data hashes, mutation counters, complete ordered results, all timing samples, count decisions, and failures.
