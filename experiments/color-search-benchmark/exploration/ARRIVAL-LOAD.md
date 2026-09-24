# Scheduled arrival-load protocol

This test sends a fixed schedule of requests to the dedicated OpenSearch node on port 19217. New requests continue arriving while earlier requests are slow. Coordinate an exclusive measurement window; do not index documents or run other benchmarks during the test.

```sh
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods native-area-linear --rates 50,200 --seconds 60'
```

The default target index is `color-exploration-scale-features-v1`; `--index` changes it. Rank-feature methods need `color-exploration-rank-feature-scale-v1`. Native vector methods need the vector index. Bound-based methods can use `--seed-index color-exploration-scale-vectors-v1`. The driver does not create or modify indexes.

## Workload and admission

- Queries rotate deterministically through supported cases from `workload.mjs`. That workload includes additional accent, five-color and precise-color cases beyond the original sixteen-query baseline. Unsupported cases and their reasons are recorded explicitly.
- `--query-ids` selects an explicit subset, preserved in configuration and profile evidence. A subset result is not evidence for every supported query.
- Every rate must schedule at least one complete pass through its supported workload. For useful sustained evidence, use at least sixty seconds and inspect per-query request counts.
- Requests are scheduled at `start + ordinal / rate`. The scheduler rechecks its clock after timer wakeups so it never dispatches early.
- `--max-inflight` defaults to 128. Excess arrivals are recorded as client-rejected failures with their assigned query ID. They are not delayed silently or removed from metrics.
- Each request receives twenty results. Query construction, service calls, response decoding and any service-side bound-search phases are inside the measured request. Document ranking is performed by OpenSearch.

## Latency and strict viability

Measured latency starts at the **scheduled arrival**, including dispatch delay. `requestMs` starts at dispatch. All requests, errors and rejections contribute to arrival latency percentiles; this differs from the original closed-loop baseline's success-only percentiles. Rejections can be fast, so p95 by itself cannot establish viability.

Strict PASS requires no warmup error, no measured error or rejection, and every warmup and measured latency below 1000 ms. Exactly 1000 ms fails. Requests that OpenSearch marks as timed out or partial fail even if the client receives them quickly. Warmups run once per supported query and are saved before rate measurement. They reuse the existing service state; they are not a controlled filesystem-cache cold-start experiment.

The driver stops increasing arrival rates after a timed failure. A cold warmup failure remains visible in the strict verdict even when warmed requests succeed. Failed or unsupported cases never become successful zero-latency observations.

## Settling between measurements

Before warmups and before/after every rate profile, the driver requires two consecutive idle observations one second apart: no active or queued search-pool work and no active query/fetch phases. This applies after failed load as well. The observations are saved both in the run's `settling` history and alongside the profile. If the node does not settle within thirty seconds, the run saves an interruption and stops before another profile can inherit the backlog.

Background merges are counted and recorded separately; an empty search queue does not claim a merge-idle node. Their CPU/disk interference remains part of the recorded conditions.

## Evidence and limits

Artifacts are external under `exploration/arrival-load/<timestamp>/`: `load.json` plus a complete source snapshot. Each completed rate profile is saved atomically, with all trials, workload, per-query counts, warmups, source hash, index count and resource observations. Initial metadata and warmups are checkpointed before the first rate profile. An interrupted profile has no completed result and cannot be treated as a pass.

The report displays arrival profiles separately from fixed-concurrency profiles. Fixed deterministic arrivals are not bursty user traffic, and one client and one node on a shared host do not establish production capacity. Statistics are sampled approximately once per second; cached CPU counters and sampled memory values are not instantaneous peaks. Synthetic descriptor mixtures test execution against one million documents, not human relevance across one million independent wallpapers.

## Completed million-document campaign

Fourteen 60-second profiles scheduled **127,200 arrivals**. Every method used all its supported cases from the shared twenty-three-case workload; unsupported cases were recorded separately. All warmups passed. Search queues drained between profiles and after failures, with zero background merges observed at every recorded settling check.

| Method | Supported cases | Requests/sec | p95 | Maximum | Failed / rejected arrivals | Strict result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Rank-feature vibe | 14/23 | 100 | 76.72 ms | 108.29 ms | 0 / 0 | Pass |
| Rank-feature vibe | 14/23 | 300 | 81.80 ms | 140.60 ms | 0 / 0 | Pass |
| Rank-feature vibe | 14/23 | 500 | 1,101.72 ms | 1,781.69 ms | 18,210 / 17,500 | Fail |
| Native area linear | 15/23 | 50 | 127.33 ms | 145.41 ms | 0 / 0 | Pass |
| Native area linear | 15/23 | 200 | 1,647.94 ms | 2,008.22 ms | 5,636 / 4,945 | Fail |
| Native asymmetric quality | 14/23 | 50 | 311.15 ms | 343.51 ms | 0 / 0 | Pass |
| Native asymmetric quality | 14/23 | 200 | 2,000.89 ms | 2,007.98 ms | 8,652 / 7,122 | Fail |
| Bounded feature intent | 15/23 | 20 | 420.69 ms | 443.63 ms | 0 / 0 | Pass |
| Bounded feature intent | 15/23 | 50 | 429.88 ms | 471.55 ms | 0 / 0 | Pass |
| Bounded feature intent | 15/23 | 100 | 1,969.14 ms | 3,628.53 ms | 1,515 / 871 | Fail |
| HSV cosine ANN, k=500 | 18/23 | 100 | 30.49 ms | 40.86 ms | 0 / 0 | Pass |
| HSV cosine ANN, k=500 | 18/23 | 300 | 28.79 ms | 50.93 ms | 0 / 0 | Pass |
| Picked-color native grid | 7/23 | 50 | 181.93 ms | 236.88 ms | 0 / 0 | Pass |
| Picked-color native grid | 7/23 | 100 | 2,001.88 ms | 2,008.61 ms | 5,939 / 2,126 | Fail |

Rejected arrivals are included in the failure count; the two columns must not be added. Rejections often have very short latencies, so a low median can coexist with severe overload. Multi-phase bounded queries measure their entire service interaction, which can exceed an individual phase's timeout.

These are measured passing/failing rates, not estimates of the exact capacity limit. The supported query sets differ and HSV retrieval is approximate, so this table does not establish an accuracy/speed winner. No passing profile was repeated to select a favorable run. OpenSearch used roughly six CPU cores at the passing rank-vibe 300 requests/sec step and saturated its eight-core allocation during failing stress profiles. The passing HSV 300 requests/sec step used approximately 4.83 cores on average. These are whole-node CPU observations.

The picked-color grid added 9,000 arrivals after its separate staged and sustained million-document measurements. It ranks globally for an interpolated objective and supports seven fixed-default picked-color queries; it does not support named-color/proportion queries. Its passing 50 requests/sec profile averaged 6.11 OpenSearch cores, and its failed 100 requests/sec profile saturated eight cores. The planned 300 requests/sec step was skipped after failure. See [PRECISION-GRID.md](PRECISION-GRID.md) for objective-approximation error and full scale evidence.

Completed artifacts under the external `exploration/arrival-load/` directory:

- `2026-09-20T02-38-31.904Z/load.json`: rank-feature vibe.
- `2026-09-20T02-41-54.257Z/load.json`: native area and asymmetric quality.
- `2026-09-20T02-46-44.724Z/load.json`: bounded feature intent.
- `2026-09-20T02-50-45.866Z/load.json`: HSV cosine ANN with k=500.
- `2026-09-20T03-25-57.457Z/load.json`: picked-color native grid.

Exact commands, run sequentially:

```sh
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods rank-features-vibe --index color-exploration-rank-feature-scale-v1 --rates 100,300,500 --seconds 60'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods native-area-linear,native-quality-asymmetric --index color-exploration-scale-features-v1 --rates 50,200 --seconds 60'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods feature-intent-bounded --index color-exploration-scale-features-v1 --rates 20,50,100 --seconds 60'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods hsv-cosine-k500-ann --index color-exploration-scale-vectors-v1 --rates 100,300 --seconds 60'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods rank-features-precision-grid --index color-exploration-precision-grid-scale-v1 --rates 50,100,300 --seconds 60'
```

The OpenSearch arrival driver rejects methods declaring another engine. ClickHouse uses its own scale harness; this prevents a 545-document ClickHouse request from inheriting an unrelated million-document OpenSearch count.
