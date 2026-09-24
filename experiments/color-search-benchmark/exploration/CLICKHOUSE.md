# ClickHouse exact picked-color prototype

## Question and scope

Can a columnar service execute the accurate picked-color palette objective faster than an OpenSearch script scanning the same descriptors?

This is one additional method, `clickhouse-palette-precision`. It supports a single picked hex color in vibe mode, an OKLab radius, and an edge quality. Named color families, proportions, multiple targets, and HSV/HSL ranges are explicitly unsupported. It does not change or replace any previous method.

ClickHouse computes membership, the score, metadata filters, global ordering, and the result limit. The application compiles SQL and returns its ordered rows. There is no application-side image ranking or fixed candidate pool.

## Stored representation and objective

Each wallpaper has its original 32-color palette converted from RGB24 into three `Array(Float64)` OKLab coordinates plus an exact palette weight array. Duplicate palette entries retain their mass. These are full floating-point coordinates, unlike the separate OpenSearch fixed-point prototype. The palette itself still approximates the image.

For centroid distance `d` and radius `r`, a matching centroid contributes its entire area when `d/r <= 1 + 1e-9`. Its quality declines linearly from 1 at the anchor to `edgeWeight` at the edge. A zero radius uses the existing direct scorer's distance tolerance of `1e-8`.

Let `A` be matching area and `Q` matching area weighted by quality. With default minimum support `m = 0.05`, the score is:

`Q / max(A, m)`

The SQL keeps the reference expression `min(1, A/m) * Q/A` for positive area and returns zero for no match. Results use Float32 scores and order by score descending, then ID ascending. This is the same objective as `palette-precision-typed`, not a new relevance model.

## Service and reproducibility

The isolated container uses **ClickHouse 26.3.9.8**, a pinned [official LTS release](https://github.com/ClickHouse/ClickHouse/releases/tag/v26.3.9.8-lts), bound to `127.0.0.1:19218`, with an 8-CPU quota and 12 GiB memory limit. Its volume and all descriptors remain outside the worktree. Each ranking request permits up to eight server threads and 2 GiB query memory; query-result caching is disabled.

The SQL uses ClickHouse's [array functions and lambdas](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/guides/starter_guides/working_with_arrays.md). Requests use typed parameters over the [HTTP interface](https://clickhouse.com/docs/concepts/features/interfaces/http). `wait_end_of_query=1`, HTTP errors, exception headers, and malformed/incomplete JSON are checked, so service failures are not accepted as successful partial rankings. Actual SQL behavior was checked against the running pinned service.

```sh
make color-exploration-clickhouse-up
make color-exploration-clickhouse-index
make color-exploration-clickhouse-test
```

Index creation intentionally refuses to replace an existing table. The real table is `color_exploration_real_v1`; the separate scale table is `color_exploration_scale_v1`. Stop/start reuses the Docker volume. The real index receipt, JSONL descriptors, and parity evidence are under the external shared `color-evaluation/exploration` directory.

## Real-corpus correctness

The table contains **all 545 required assets**. Validation compares the exact required ID set and rejects missing IDs even when the row count matches. Initial creation and insertion took 446 ms. After merging, the table occupied 454,061 bytes on disk and 575,890 uncompressed bytes in one active part. These are small-corpus measurements, not scale estimates.

The service test compares all 545 scores and their complete ordered ID lists with OpenSearch's original-RGB typed precision scorer. It covers the same seven picked swatches as the performance workload, a zero-radius query, and an edge-weight-of-one query: **4,905 score comparisons, zero observed score difference, and nine identical complete rankings**. The acceptance tolerance is `2e-7`; equality here is an observation, not a proof that cross-engine floating-point arithmetic is identical for every possible input. Empty eligibility, exclusions, partition filtering, duplicate centroid mass, and exact corpus coverage are also checked.

Evidence: `exploration/clickhouse-parity.json`, including both implementation hashes and service metadata. These small-corpus checks ran while a separate OpenSearch load experiment was active; their durations are correctness-test observations, not isolated performance benchmarks.

Feedback round 12, `2026-09-20T02-45-21.426Z-c8b05700`, supports 3 of 37 logical cases and records macro pair-preference agreement **0.794444**, matching the existing precision scorer on those same cases. There are 34 explicit unsupported cases, zero errors, and zero eligibility violations. The loop's 30 timed samples had p50 8.71 ms, p95 25.28 ms, and maximum 26.07 ms. Those small-corpus timings ran alongside the separate load campaign and cannot establish an isolated cross-service speed comparison. Its accuracy diagnostic uses a separate result window of 1,000; the timed limit is 20. One observer's provisional feedback does not establish general perceptual accuracy.

The final clock-time deadline setting is archived in rerun `2026-09-20T02-52-07.682Z-6faa9adb`: the same 3 supported cases, **0.794444** agreement, and zero errors. Its 30 requests had p95 11.92 ms and maximum 12.58 ms. The earlier snapshot remains available; neither small-corpus timing should be read as a scale result.

## Scale experiment

`clickhouse-scale.mjs` uses the exact same deterministic source selection, palette mixing, synthetic IDs, and `partition = index % 100` generator as the OpenSearch campaign. It stores one million descriptors, not one million newly downloaded photographs. Source features, generator, source snapshots, row/unique-ID counts, parts, merges, storage, and resource observations are recorded. Resume validates the generator, feature hashes, document transform, and complete synthetic ID sequence.

```sh
make color-exploration-clickhouse-scale COLOR_EXP_ARGS='--counts 1000,10000,100000,1000000 --concurrency 1,4,16 --repeats 12 --duration-ms 10000 --filtered yes'
```

Run this only in the coordinator's exclusive load window. The workload includes the same seven unfiltered swatches as OpenSearch plus optional copies restricted to 10% and 1% of synthetic partitions. Each profile executes at least 12 complete workload repetitions and ten seconds of work. Per-query statistics keep filter selectivity visible. All requested concurrency levels execute even if an earlier one fails.

The service limit is 950 ms and client cancellation limit is five seconds. Every exception or client latency of at least one second fails the tested profile; failed or slow warmups also fail the strict result. Percentiles include error and timeout durations. Successful-only percentiles are separately labeled. Measurements include active merges and observed RSS snapshots; snapshots are not memory peaks. Query CPU counters include the full service window and any incidental service activity. Closed-loop concurrency is not an arrival-rate SLO guarantee.

Requests explicitly set `timeout_before_checking_execution_speed=0`, making the service timeout use elapsed clock time. ClickHouse checks it at processing checkpoints, so the client measurement still decides whether a request met the one-second requirement. This follows the [official timeout and concurrency guidance](https://clickhouse.com/resources/engineering/high-concurrency-sizing-user-analytics).

## Production boundary

The prototype accepts service-side ID, reference-ID, cohort, and partition filters. Unsupported filters are rejected. A subject query requires explicit eligibility, and the current evaluation adapter supplies the complete eligible evaluation set. A production system must expose complete semantic eligibility inside ClickHouse—for example by indexing the same tags/visibility metadata or using a service-side join. Fetching a capped OpenSearch hit subset and then ranking it in ClickHouse would recreate the global-ranking limitation the user wants to avoid.

This service adds synchronization, schema, operational, and pagination work. Its possible value is faster exact execution of the already-tested precision objective; the human-feedback coverage remains only the precision cases, and the original one-observer uncertainty still applies.

## Measured scale results: eight threads per request

Artifact: shared `exploration/clickhouse-scale/2026-09-20T02-54-39.077Z/scale.json`, with its complete source snapshot. All stages used the 21-query mix: seven colors, each unfiltered, at 10% eligibility, and at 1% eligibility. The profiles use 12 repetitions per query or ten seconds, whichever takes longer. These percentiles include failed requests.

| Stored documents | C1 p95 ms | C4 p95 ms | C16 p95 ms | Strict outcome |
|---:|---:|---:|---:|---|
|1,000|9.43|10.10|68.47|All pass|
|10,000|14.14|21.42|103.81|All pass|
|100,000|39.19|116.48|988.22|C16 fails: 33 errors / 403 requests|
|1,000,000|331.65|996.10|1,012.87|C1 passes; C4 and C16 fail|

At one million, every profile contains 252 requests, with 84 per eligibility group. C4 has 70 errors and 12 requests of at least one second; C16 has 148 errors and 51 requests of at least one second. Every unfiltered C16 request times out. The errors are explicit server `TIMEOUT_EXCEEDED` failures, not accepted partial results. The final idle checks passed before further work.

| Million-document eligibility | C1 p95 ms / errors | C4 p95 ms / errors | C16 p95 ms / errors |
|---|---:|---:|---:|
|All documents|335.95 / 0|1,006.40 / 68|1,019.49 / 84|
|10%|56.14 / 0|700.80 / 2|1,007.86 / 64|
|1%|23.29 / 0|71.25 / 0|600.51 / 0|

The million table stores 773,398,417 bytes on disk and 1,112,005,880 uncompressed bytes, in seven active parts. No merges were active when any stage began measurement. Adding the final 900,000 documents took 56.24 seconds; the synthetic generator and document conversion run in the indexing process, so this is end-to-end prototype insertion time, not database-only ingest throughput.

Observed server RSS snapshots at one million range from 1,213 to 1,512 MiB; application RSS snapshots range from 164 to 292 MiB. Total query CPU was 129.07 seconds over 30.91 seconds at C1, 196.93 over 25.86 seconds at C4, and 93.95 over 12.21 seconds at C16. Failed requests consume CPU too. Reported request throughput includes failures and must not be interpreted as successful service capacity.

This execution configuration does **not** meet the requested concurrent-query requirement, despite passing the single-client million-document limit. It also becomes substantially slower as the table grows, because the unfiltered query reads every stored palette.

## Bounded refinement: one thread per request

The same method now accepts an execution-only `maxThreads` option from 1 through 8. The default remains 8, including the browser. `--max-threads 1` selects the scale comparison; it changes no color controls or scoring arithmetic. Tests reject invalid parallelism and verify that one thread produces the same complete scores and order as eight threads for all nine 545-document queries.

The second artifact, `exploration/clickhouse-scale/2026-09-20T03-00-08.903Z/scale.json`, reuses the verified million-row table and repeats all 21 queries 12 times at C1 and C16. There were no active merges before measurement, and warmups passed with a maximum of 424.31 ms.

| Per-query threads | C1 p95 ms | C1 query CPU seconds / wall seconds | C16 p95 ms | C16 errors / requests |
|---:|---:|---:|---:|---:|
|8|331.65|129.07 / 30.91|1,012.87|148 / 252|
|1|403.23|39.50 / 39.52|1,016.04|141 / 252|

One thread reduces the CPU consumed by the serial workload by approximately 69%, while making it slower in elapsed time. It does **not** recover the concurrency requirement: every one of the 84 unfiltered C16 calls still times out, as do 57 of 84 calls restricted to 10% of the table. The 1%-eligible calls have no errors and p95 486.77 ms while competing with that failed workload. There are 51 C16 calls of at least one second overall. Observed server RSS snapshots are 1,127 MiB at C1 and 1,510 MiB at C16; application RSS snapshots are 151 and 128 MiB. These are sequential experiments on the same host and stored table, not a randomized repeated timing study.

The prototype remains useful as an exact cross-service reference and a demonstration that a columnar scan can reduce serial latency. Neither tested execution setting qualifies for the user's concurrent million-wallpaper requirement. No 100-million extrapolation or production capacity claim follows from these results.
