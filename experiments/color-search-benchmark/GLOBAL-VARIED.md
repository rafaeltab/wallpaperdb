# Changing-query OpenSearch workload

Status: **completed**. Generated 2026-09-16T15:48:05.016Z; completed 2026-09-16T15:48:18.672Z.

## Scope

This changes the color families, requested amounts, and metadata partitions between searches. It does **not** measure a cold node: the existing index, operating-system page cache, compiled scripts, and some fields were already exercised by earlier experiments. No caches were flushed. Ordinary OpenSearch query caches may reuse metadata or range filters.

- One million synthetic descriptors made from mixtures of the 100 original-image/20 fixture descriptors; this is not one million independent wallpapers.
- 60 deterministic unique queries: 15 each with 1, 2, 3, or 5 distinct families, covering all 18 experimental families. Positive integer-percentage amounts total 40–100%.
- 30 queries search the full index; 30 use distinct partitions, each selecting 10,000 documents (1%).
- Deterministically shuffled query order, alternating which method runs first. Each method runs each query once in the sequential pass; the second method can benefit from the first method accessing the same fields.
- Both methods request the typed scoring variant and use the same hard membership model and target-amount objective. One/two-family queries retain the existing numeric fast path. No service reranking or fixed candidate limit.
- Preflight checks read index statistics and aggregate partition counts; that aggregation can warm metadata. They do not execute any of the color queries.
- Every ordered top 20 ID and float32 score is compared. Adaptive query latency includes PIT creation, widening searches, and PIT cleanup; exhaustive latency includes its single search request. Index mutation counters are checked before and after the pass.
- The concurrency 4 pass repeats the same 60 queries once with adaptive search only, after the sequential pass has warmed some fields and filters. Each concurrent result is also checked against its exhaustive reference.

Index: `color-global-multi-1000000-v1`; recorded count: 1000000. Data cache key: `789da7256e972ef46e5699713a46c2bf95dc8d22f356e2566ca93fa0aaab3352`. The JSON artifact records source/data hashes, index fingerprint, method order, all results, timings, request counts, thresholds, and failures.

## Results

Sequential comparisons passed: **60/60**. Concurrent results verified: **60/60**. Failures: **0**.

| Pass | Method | Regions | Filter | n | Median ms | p95 ms | Max ms | Median requests |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| sequential | exhaustive | all | mixed | 60 | 24.2 | 303.4 | 379.7 | 1 |
| sequential | exhaustive | 1 | all | 8 | 19.9 | 41.5 | 41.5 | 1 |
| sequential | exhaustive | 1 | one_percent | 7 | 7.3 | 243.8 | 243.8 | 1 |
| sequential | exhaustive | 2 | all | 7 | 69.3 | 107.7 | 107.7 | 1 |
| sequential | exhaustive | 2 | one_percent | 8 | 24.2 | 33.3 | 33.3 | 1 |
| sequential | exhaustive | 3 | all | 8 | 218.1 | 295.7 | 295.7 | 1 |
| sequential | exhaustive | 3 | one_percent | 7 | 12.0 | 32.3 | 32.3 | 1 |
| sequential | exhaustive | 5 | all | 7 | 303.4 | 379.7 | 379.7 | 1 |
| sequential | exhaustive | 5 | one_percent | 8 | 7.6 | 19.3 | 19.3 | 1 |
| sequential | adaptive | all | mixed | 60 | 63.8 | 301.9 | 435.4 | 5 |
| sequential | adaptive | 1 | all | 8 | 9.4 | 37.3 | 37.3 | 3 |
| sequential | adaptive | 1 | one_percent | 7 | 15.0 | 30.6 | 30.6 | 4 |
| sequential | adaptive | 2 | all | 7 | 41.7 | 85.6 | 85.6 | 3 |
| sequential | adaptive | 2 | one_percent | 8 | 30.1 | 97.5 | 97.5 | 5 |
| sequential | adaptive | 3 | all | 8 | 63.4 | 145.9 | 145.9 | 3 |
| sequential | adaptive | 3 | one_percent | 7 | 164.1 | 385.5 | 385.5 | 7 |
| sequential | adaptive | 5 | all | 7 | 203.4 | 382.0 | 382.0 | 5 |
| sequential | adaptive | 5 | one_percent | 8 | 163.6 | 435.4 | 435.4 | 6 |
| concurrency4 | adaptive | all | mixed | 60 | 68.3 | 386.0 | 487.9 | 5 |
| concurrency4 | adaptive | 1 | all | 8 | 18.8 | 48.5 | 48.5 | 3 |
| concurrency4 | adaptive | 1 | one_percent | 7 | 11.1 | 19.8 | 19.8 | 4 |
| concurrency4 | adaptive | 2 | all | 7 | 54.7 | 73.9 | 73.9 | 3 |
| concurrency4 | adaptive | 2 | one_percent | 8 | 62.3 | 79.9 | 79.9 | 5 |
| concurrency4 | adaptive | 3 | all | 8 | 63.5 | 193.2 | 193.2 | 3 |
| concurrency4 | adaptive | 3 | one_percent | 7 | 145.5 | 189.1 | 189.1 | 7 |
| concurrency4 | adaptive | 5 | all | 7 | 384.7 | 487.9 | 487.9 | 5 |
| concurrency4 | adaptive | 5 | one_percent | 8 | 342.0 | 389.6 | 389.6 | 6 |

Per-group samples are only 7 or 8 changing queries; their p95 is the largest observation, not a stable production tail estimate. The distribution represents this generated query mix. The family bank remains experimental and has not been validated by human relevance judgments.

Concurrency 4 elapsed: 2.11 s; 28.4 completed queries/s for this one finite pass.

## Interpretation

Exactness held for every query, but adaptive widening was not consistently faster. Across the broad three-color queries, its median was 63.4 ms versus 218.1 ms for direct scoring; broad five-color medians were 203.4 ms versus 303.4 ms. For queries already restricted to 1% of the index, direct scoring had lower medians: 12.0 ms versus 164.1 ms for three colors, and 7.6 ms versus 163.6 ms for five.

This supports testing a strategy that chooses direct scoring for selective metadata filters and adaptive bounds for broad searches. These measurements do not establish a universal switching threshold. They also show why the earlier repeated-query timings should not be presented as the latency of arbitrary changing queries.

## Reproduce

```sh
make color-global-varied
```

Requires the existing isolated OpenSearch 2.11 instance and populated `color-global-multi-1000000-v1` index. Run after other benchmarking/indexing work is idle. The command reads that index and creates temporary PITs; it does not rebuild data or flush caches. It skips concurrency if any sequential reference or equality check fails. Results: [global-varied.json](global-varied.json).
