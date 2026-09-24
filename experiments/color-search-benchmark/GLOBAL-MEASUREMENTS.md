# OpenSearch global color ranking — measured evidence

Generated from evaluation starting 2026-09-16T15:06:18.902Z.

Local OpenSearch2.11, three shards per index, one node, four CPUs, 2GiB heap /4GiB container limit. Shared development host. Synthetic load data are mixtures of the100 real and20 analytic descriptors; timings are warm observations, not a100M capacity guarantee.

Global corpus checks: **117 passed**. Recorded timing failures: **0**. Separate formula, pagination, filter and snapshot probes are in the adjacent probe JSON files.

## Indexing and storage

These indexes deliberately retain redundant prototype encodings and `_source`. Storage is measured, not optimized. Ingestion includes descriptor generation, bulk requests and final refresh.

| Index | Parents | Fields | Build seconds | Store MiB |
|---|---:|---:|---:|---:|
| color-global-real-v1 | 120 | 455 | 0.1 | 1.7 |
| color-global-native-10000-v1 | 10,000 | 230 | 2.4 | 69.5 |
| color-global-dynamic-10000-v1 | 10,000 | 229 | 1.2 | 42.8 |
| color-global-native-100000-v1 | 100,000 | 230 | 21.5 | 684.6 |
| color-global-dynamic-100000-v1 | 100,000 | 229 | 10.9 | 394.7 |
| color-global-native-1000000-v1 | 1,000,000 | 230 | 194.9 | 9219.8 |

## Sequential latency

Each cell is median client wall time / observed p95 in milliseconds. Normal rows have15 measured repetitions after a warmup; slow dynamic rows have5. Client timing for certified bounds includes opening and closing the PIT plus seed and final queries. A5- or15-sample p95 is an observation of this small run, not a reliable tail-latency estimate.

### 10,000 parents — all eligible

| Query | numeric | tokens | fine | bounded | joint | joint-bounded | dynamic |
|---|---:|---:|---:|---:|---:|---:|---:|
| green40 | 2.3 / 3.2 | 3.4 / 4.3 | 2.1 / 2.7 | 7.6 / 29.0 | 2.0 / 2.5 | 7.0 / 9.5 | 16.9 / 22.9 |
| red50green50 | 1.6 / 2.3 | 3.7 / 6.1 | 1.9 / 2.1 | 7.9 / 9.7 | 1.7 / 2.4 | 7.7 / 11.3 | — |
| red70dark30 | 2.0 / 2.9 | 4.1 / 5.3 | 2.1 / 3.0 | 6.8 / 9.9 | 2.4 / 3.0 | 7.2 / 10.0 | 19.1 / 20.0 |
| dark90 | 1.5 / 1.9 | 2.7 / 3.0 | 1.1 / 1.8 | 4.6 / 7.9 | 1.9 / 2.6 | 5.3 / 7.9 | — |
| grayscale40 | 1.3 / 1.8 | 2.6 / 3.9 | 1.5 / 1.8 | 5.7 / 9.4 | 1.7 / 2.0 | 5.5 / 7.4 | 17.0 / 18.8 |
| rainbow20 | 1.7 / 2.1 | 6.4 / 15.0 | 2.0 / 2.5 | 11.1 / 13.1 | — | — | — |

### 10,000 parents — 1% metadata filter

| Query | numeric | tokens | fine | bounded | joint | joint-bounded | dynamic |
|---|---:|---:|---:|---:|---:|---:|---:|
| green40 | 1.3 / 2.0 | 2.5 / 3.1 | 1.4 / 2.1 | 6.4 / 8.9 | 1.3 / 1.8 | 5.9 / 8.3 | 2.9 / 3.3 |
| red50green50 | 1.6 / 2.0 | 3.9 / 4.5 | 1.8 / 2.6 | 7.8 / 20.9 | 3.1 / 5.6 | 9.6 / 28.1 | — |
| red70dark30 | 1.4 / 1.6 | 4.0 / 5.4 | 1.4 / 2.2 | 6.9 / 11.0 | 1.4 / 1.6 | 6.5 / 8.2 | 2.9 / 4.0 |
| dark90 | 0.9 / 1.4 | 2.6 / 3.2 | 1.4 / 3.7 | 6.5 / 9.8 | 1.2 / 4.2 | 5.1 / 7.9 | — |
| grayscale40 | 1.1 / 1.7 | 2.8 / 3.6 | 1.4 / 3.7 | 5.5 / 7.5 | 1.3 / 2.2 | 5.5 / 9.0 | 2.8 / 3.5 |
| rainbow20 | 1.2 / 2.6 | 5.6 / 7.6 | 1.1 / 1.8 | 8.6 / 12.2 | — | — | — |

### 100,000 parents — all eligible

| Query | numeric | tokens | fine | bounded | joint | joint-bounded | dynamic |
|---|---:|---:|---:|---:|---:|---:|---:|
| green40 | 3.5 / 36.4 | 5.6 / 22.9 | 2.3 / 33.2 | 7.3 / 8.8 | 3.4 / 4.9 | 8.3 / 17.8 | 132.5 / 141.1 |
| red50green50 | 4.0 / 4.2 | 9.5 / 11.3 | 4.0 / 4.8 | 12.1 / 13.8 | 4.4 / 7.9 | 11.5 / 14.8 | — |
| red70dark30 | 3.9 / 4.4 | 9.9 / 11.7 | 4.0 / 4.5 | 12.1 / 15.3 | 4.6 / 5.3 | 11.4 / 13.1 | 155.6 / 164.8 |
| dark90 | 2.9 / 3.4 | 5.6 / 6.5 | 2.9 / 3.4 | 7.9 / 12.3 | 3.7 / 4.9 | 11.3 / 28.8 | — |
| grayscale40 | 2.1 / 2.6 | 4.2 / 8.1 | 2.8 / 3.9 | 6.8 / 9.0 | 3.3 / 4.5 | 7.4 / 10.1 | 130.7 / 143.0 |
| rainbow20 | 5.0 / 6.2 | 21.1 / 33.2 | 5.1 / 7.2 | 25.6 / 31.0 | — | — | — |

### 100,000 parents — 1% metadata filter

| Query | numeric | tokens | fine | bounded | joint | joint-bounded | dynamic |
|---|---:|---:|---:|---:|---:|---:|---:|
| green40 | 0.9 / 2.3 | 3.6 / 5.1 | 1.4 / 2.7 | 6.2 / 10.4 | 1.3 / 3.0 | 7.1 / 10.3 | 4.0 / 5.8 |
| red50green50 | 1.1 / 2.7 | 5.1 / 6.4 | 1.3 / 1.8 | 9.0 / 14.7 | 0.9 / 1.2 | 7.4 / 9.7 | — |
| red70dark30 | 1.0 / 1.5 | 6.4 / 7.4 | 1.3 / 2.3 | 10.4 / 40.6 | 1.2 / 1.6 | 9.1 / 12.1 | 3.1 / 5.9 |
| dark90 | 0.9 / 1.5 | 3.9 / 4.8 | 1.4 / 3.5 | 6.2 / 21.6 | 1.3 / 1.9 | 5.7 / 9.0 | — |
| grayscale40 | 0.7 / 1.0 | 3.7 / 4.3 | 1.0 / 1.9 | 5.4 / 8.1 | 0.9 / 1.5 | 6.2 / 8.9 | 3.6 / 6.2 |
| rainbow20 | 0.9 / 1.1 | 10.9 / 17.6 | 1.5 / 2.1 | 14.7 / 16.4 | — | — | — |

### 1,000,000 parents — all eligible

| Query | numeric | tokens | fine | bounded | joint | joint-bounded |
|---|---:|---:|---:|---:|---:|---:|
| green40 | 12.7 / 16.0 | 27.7 / 170.6 | 13.2 / 14.1 | 31.1 / 37.2 | 18.5 / 19.7 | 32.0 / 36.1 |
| red50green50 | 17.6 / 18.2 | 57.5 / 115.2 | 17.8 / 18.6 | 63.8 / 134.1 | 30.5 / 35.1 | 60.6 / 65.6 |
| red70dark30 | 17.0 / 18.6 | 59.6 / 116.1 | 17.5 / 19.7 | 67.6 / 83.7 | 29.7 / 31.5 | 66.8 / 74.9 |
| dark90 | 12.9 / 14.2 | 32.4 / 81.6 | 12.9 / 14.2 | 36.5 / 41.6 | 18.5 / 19.8 | 37.2 / 62.2 |
| grayscale40 | 12.0 / 13.2 | 28.3 / 31.4 | 11.0 / 12.7 | 34.0 / 38.5 | 17.3 / 18.3 | 35.9 / 89.5 |
| rainbow20 | 30.5 / 37.6 | 154.1 / 170.8 | 30.7 / 34.6 | 164.0 / 233.8 | — | — |

### 1,000,000 parents — 1% metadata filter

| Query | numeric | tokens | fine | bounded | joint | joint-bounded |
|---|---:|---:|---:|---:|---:|---:|
| green40 | 1.5 / 2.4 | 15.9 / 59.2 | 2.0 / 3.6 | 19.4 / 24.9 | 2.4 / 3.0 | 20.1 / 22.8 |
| red50green50 | 1.8 / 2.2 | 30.4 / 51.0 | 1.7 / 4.8 | 37.2 / 75.3 | 2.8 / 4.4 | 37.3 / 41.2 |
| red70dark30 | 2.2 / 3.3 | 34.1 / 77.8 | 2.4 / 3.2 | 40.9 / 55.3 | 1.8 / 4.7 | 41.3 / 44.3 |
| dark90 | 2.2 / 3.2 | 18.8 / 21.9 | 2.5 / 4.1 | 23.4 / 29.4 | 3.0 / 3.5 | 23.7 / 30.9 |
| grayscale40 | 1.2 / 1.8 | 16.8 / 20.2 | 1.3 / 1.7 | 22.0 / 30.6 | 2.2 / 3.6 | 22.1 / 26.4 |
| rainbow20 | 1.5 / 2.2 | 69.4 / 152.6 | 2.4 / 3.8 | 77.6 / 112.2 | — | — |

## Four simultaneous requests

Forty requests per row, four in flight. Service CPU is the benchmark coordinator (including HTTP/JSON), not a production gateway measurement. OpenSearch process statistics are cached; these short batches cannot reliably attribute node CPU to a method, so those deltas are deliberately omitted.

| Query | Method | Median ms | p95 ms | Requests/sec | Service CPU ms/request |
|---|---|---:|---:|---:|---:|
| green40 | tokens | 100.1 | 195.8 | 35.0 | 2.1 |
| green40 | fine | 17.6 | 79.7 | 108.2 | 1.3 |
| green40 | bounded | 102.4 | 204.0 | 33.1 | 3.5 |
| green40 | joint-bounded | 106.1 | 199.4 | 33.4 | 5.1 |
| red70dark30 | tokens | 245.8 | 379.6 | 14.9 | 2.2 |
| red70dark30 | fine | 25.7 | 89.0 | 80.2 | 1.4 |
| red70dark30 | bounded | 281.9 | 394.1 | 14.3 | 4.0 |
| red70dark30 | joint-bounded | 282.4 | 390.7 | 14.0 | 5.7 |
| rainbow20 | tokens | 689.5 | 819.8 | 5.6 | 2.5 |
| rainbow20 | fine | 102.1 | 167.0 | 37.3 | 2.0 |
| rainbow20 | bounded | 709.8 | 889.7 | 5.3 | 5.3 |

## Adaptive global bounds without token seeds

Start at1 percentage point of total error, search all documents inside necessary indexed bounds, and double the threshold if a complete page is not yet proved. Every returned page remains globally correct; no fixed candidate count is used. Same million-parent index and objectives. Fifteen warm measurements per sequential row.

| Query | Method | Metadata filter | Median ms | p95 ms | Search requests |
|---|---|---|---:|---:|---:|
| green40 | adaptive-fine | all | 5.4 | 14.4 | 1 |
| green40 | adaptive-joint | all | 4.1 | 7.4 | 1 |
| green40 | adaptive-fine | one_percent | 4.0 | 5.9 | 1 |
| green40 | adaptive-joint | one_percent | 4.1 | 5.5 | 1 |
| red50green50 | adaptive-fine | all | 8.5 | 14.7 | 4 |
| red50green50 | adaptive-joint | all | 9.7 | 25.1 | 4 |
| red50green50 | adaptive-fine | one_percent | 13.6 | 18.6 | 6 |
| red50green50 | adaptive-joint | one_percent | 12.5 | 21.8 | 6 |
| red70dark30 | adaptive-fine | all | 3.4 | 5.1 | 1 |
| red70dark30 | adaptive-joint | all | 3.2 | 4.9 | 1 |
| red70dark30 | adaptive-fine | one_percent | 12.7 | 14.7 | 5 |
| red70dark30 | adaptive-joint | one_percent | 13.4 | 55.0 | 5 |
| dark90 | adaptive-fine | all | 3.4 | 4.7 | 1 |
| dark90 | adaptive-joint | all | 3.6 | 6.2 | 1 |
| dark90 | adaptive-fine | one_percent | 5.2 | 6.5 | 2 |
| dark90 | adaptive-joint | one_percent | 4.7 | 7.7 | 2 |
| grayscale40 | adaptive-fine | all | 3.4 | 4.8 | 1 |
| grayscale40 | adaptive-joint | all | 3.3 | 4.8 | 1 |
| grayscale40 | adaptive-fine | one_percent | 3.1 | 4.2 | 1 |
| grayscale40 | adaptive-joint | one_percent | 2.8 | 4.1 | 1 |
| rainbow20 | adaptive-fine | all | 12.7 | 20.6 | 4 |
| rainbow20 | adaptive-fine | one_percent | 18.6 | 22.5 | 6 |

Four simultaneous requests, forty requests per row:

| Query | Method | Median ms | p95 ms |
|---|---|---:|---:|
| green40 | adaptive-fine | 4.5 | 6.2 |
| green40 | adaptive-joint | 4.7 | 6.1 |
| red70dark30 | adaptive-fine | 4.8 | 6.5 |
| red70dark30 | adaptive-joint | 4.3 | 5.8 |
| rainbow20 | adaptive-fine | 14.0 | 55.3 |

## Original-pixel joint representation

This later representation uses roughly65k unblended original pixels, packed membership/count pairs, and171 indexed singleton/pair-union measurements. It supports1–5 regions. It has different sampling from the earlier256-resize methods, so do not treat cross-representation differences as a pure algorithm comparison. Sizes below use post-merge measurements when available.

| Index | Parents | Mean membership atoms | Fields | Store MiB |
|---|---:|---:|---:|---:|
| color-global-multi-real-v1 | 120 | 40.8 | 177 | 0.8 |
| color-global-multi-100000-v1 | 100,000 | 80.8 | 177 | 662.2 |
| color-global-multi-1000000-v1 | 1,000,000 | 80.9 | 177 | 9069.3 |

## Optimized joint scorer:1,000,000 parents

The original generic Painless implementation exceeded15s for three broad multi-region queries. Extended reference requests completed in about20s and verified the adaptive global winners. Caching typed locals and unrolling membership tests preserved the same score while removing repeated dynamic lookups. The following measurements use that optimized script on the SAME original-pixel index. One/two-region requests retain their small closed-form fast path.

Each cell is median / observed p95 client milliseconds;15 repeats per row. “Partial” requests specify less than100% total and still penalize excess requested-family area.

### Optimized joint — all eligible

| Query | Regions | Exhaustive | Adaptive globally exact |
|---|---:|---:|---:|
| green40 | 1 | 18.2 / 24.1 | 4.4 / 7.2 |
| red70dark30 | 2 | 30.0 / 33.8 | 3.8 / 7.6 |
| grayscale40 | 1 | 17.9 / 19.9 | 4.2 / 6.5 |
| warm30_30_40 | 3 | 199.9 / 221.3 | 10.2 / 67.3 |
| dark40blue30navy30 | 3 | 199.7 / 208.6 | 9.8 / 13.3 |
| rainbow20 | 5 | 260.7 / 286.0 | 13.5 / 20.7 |
| partial3 | 3 | 205.8 / 258.0 | 6.3 / 11.6 |
| partial5 | 5 | 256.9 / 314.6 | 11.2 / 23.9 |

### Optimized joint — 1% metadata filter

| Query | Regions | Exhaustive | Adaptive globally exact |
|---|---:|---:|---:|
| green40 | 1 | 1.7 / 3.1 | 3.4 / 7.1 |
| red70dark30 | 2 | 2.0 / 2.5 | 12.8 / 19.0 |
| grayscale40 | 1 | 2.1 / 2.9 | 3.5 / 6.4 |
| warm30_30_40 | 3 | 5.6 / 8.0 | 14.5 / 21.3 |
| dark40blue30navy30 | 3 | 3.9 / 5.9 | 13.8 / 18.5 |
| rainbow20 | 5 | 5.1 / 7.0 | 29.6 / 36.2 |
| partial3 | 3 | 5.1 / 5.7 | 10.9 / 15.4 |
| partial5 | 5 | 5.3 / 9.8 | 20.6 / 27.5 |

Optimized adaptive search with four simultaneous requests, forty requests per row:

| Query | Median ms | Observed p95 ms |
|---|---:|---:|
| red70dark30 | 4.9 | 7.1 |
| warm30_30_40 | 12.7 | 32.5 |
| dark40blue30navy30 | 12.1 | 59.9 |
| rainbow20 | 21.7 | 69.3 |
| partial5 | 16.5 | 76.5 |

## Changing queries: the less favorable workload

Sixty unique region/amount queries, half broad and half selecting distinct 1% metadata partitions. Both methods run once per query with alternating method order. This is an already used node; the paired methods can warm each other. Concurrency reuses the same sixty queries. See [GLOBAL-VARIED.md](GLOBAL-VARIED.md) for the full cache caveats and all groups. These results supersede any inference that arbitrary queries reliably take only a few milliseconds.

| Pass | Method | Regions | Filter | Samples | Median ms | Observed p95 ms |
|---|---|---|---|---:|---:|---:|
| sequential | exhaustive | all | mixed | 60 | 24.2 | 303.4 |
| sequential | exhaustive | 1 | all | 8 | 19.9 | 41.5 |
| sequential | exhaustive | 1 | one_percent | 7 | 7.3 | 243.8 |
| sequential | exhaustive | 2 | all | 7 | 69.3 | 107.7 |
| sequential | exhaustive | 2 | one_percent | 8 | 24.2 | 33.3 |
| sequential | exhaustive | 3 | all | 8 | 218.1 | 295.7 |
| sequential | exhaustive | 3 | one_percent | 7 | 12.0 | 32.3 |
| sequential | exhaustive | 5 | all | 7 | 303.4 | 379.7 |
| sequential | exhaustive | 5 | one_percent | 8 | 7.6 | 19.3 |
| sequential | adaptive | all | mixed | 60 | 63.8 | 301.9 |
| sequential | adaptive | 1 | all | 8 | 9.4 | 37.3 |
| sequential | adaptive | 1 | one_percent | 7 | 15.0 | 30.6 |
| sequential | adaptive | 2 | all | 7 | 41.7 | 85.6 |
| sequential | adaptive | 2 | one_percent | 8 | 30.1 | 97.5 |
| sequential | adaptive | 3 | all | 8 | 63.4 | 145.9 |
| sequential | adaptive | 3 | one_percent | 7 | 164.1 | 385.5 |
| sequential | adaptive | 5 | all | 7 | 203.4 | 382.0 |
| sequential | adaptive | 5 | one_percent | 8 | 163.6 | 435.4 |
| concurrency4 | adaptive | all | mixed | 60 | 68.3 | 386.0 |
| concurrency4 | adaptive | 1 | all | 8 | 18.8 | 48.5 |
| concurrency4 | adaptive | 1 | one_percent | 7 | 11.1 | 19.8 |
| concurrency4 | adaptive | 2 | all | 7 | 54.7 | 73.9 |
| concurrency4 | adaptive | 2 | one_percent | 8 | 62.3 | 79.9 |
| concurrency4 | adaptive | 3 | all | 8 | 63.5 | 193.2 |
| concurrency4 | adaptive | 3 | one_percent | 7 | 145.5 | 189.1 |
| concurrency4 | adaptive | 5 | all | 7 | 384.7 | 487.9 |
| concurrency4 | adaptive | 5 | one_percent | 8 | 342.0 | 389.6 |

Passed comparisons: 60/60 sequential and 60/60 concurrent, checking exhaustive ordered IDs and float32 scores. Recorded failures: 0. Direct scoring was substantially faster for several selective queries; adaptive bounds were often better for broad queries. The choice of strategy belongs in the query planner.

## Same-snapshot query planner

A metadata-only count on the same PIT chooses direct typed scoring only when it proves at most 10,000 eligible documents; other searches use adaptive bounds. That cutoff comes from the previous workload, not a universal cost model. These are repeat measurements of the same sixty-query set on an already warmed node. Count, PIT and cleanup overhead are included. The concurrent planner pass ran after the adaptive pass, with a possible cache advantage. Broad searches use identical adaptive logic, so their timing differences are not a planner improvement. See [GLOBAL-PLANNER.md](GLOBAL-PLANNER.md) for group details and limits.

| Pass | Method | Samples | Median ms | Observed p95 ms |
|---|---|---:|---:|---:|
| sequential | exhaustive | 60 | 19.9 | 258.7 |
| sequential | adaptive | 60 | 23.5 | 120.7 |
| sequential | planner | 60 | 9.3 | 58.4 |
| concurrency4 | adaptive | 60 | 57.6 | 384.3 |
| concurrency4 | planner | 60 | 16.1 | 135.4 |

Passed comparisons: 60/60 sequential, 120/120 concurrent, plus 15 edge/pagination cases. Recorded failures: 0. Source hashes and index mutation counters remained unchanged.

## Sustained resource check

Optimized script, same million-document original-pixel index. Four requests in flight for at least 8s per row; 1.2s idle before/after refreshes cached node CPU counters. Node CPU includes GC/background work. Service memory is the benchmark coordinator, not a production gateway deployment. Memory columns are end-of-block snapshots, not peaks. JVM heap excludes native memory and filesystem cache; the OpenSearch container limit was 4 GiB with a 2 GiB heap.

| Query | Method | Requests | Queries/sec | p95 ms | OpenSearch CPU ms/query | Service CPU ms/query | Service RSS MiB | OpenSearch heap MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| red70dark30 | exhaustive | 307 | 38.0 | 170.0 | 106.0 | 1.6 | 90.3 | 381.0 |
| red70dark30 | adaptive | 7804 | 975.2 | 6.9 | 3.8 | 1.2 | 157.3 | 1287.2 |
| rainbow20 | exhaustive | 36 | 4.2 | 1099.4 | 949.2 | 1.2 | 157.3 | 1055.1 |
| rainbow20 | adaptive | 829 | 103.5 | 82.9 | 38.5 | 3.6 | 133.3 | 962.6 |

## Quality: historical resized pixels versus palette32

These are area-error proxies under the declared hard region definitions, not human preference labels. Lower is better. A poor best-available score can also mean that this 100-image corpus contains no close composition. Pixel measurements in this historical table use a 256px maximum side. The later [original-pixel sampling audit](GLOBAL-SAMPLING.md) found material interpolation error in those measurements; use that audit for the final representation decision.

| Query | Pixel-ranked top10 mean area error | Palette-ranked top10, measured on pixels | Worst per-image descriptor error |
|---|---:|---:|---:|
| green40 | 6.35 pp | 7.26 pp | 8.93 pp |
| red50green50 | 43.71 pp | 43.90 pp | 11.74 pp |
| red70dark30 | 27.87 pp | 27.87 pp | 14.19 pp |
| dark90 | 3.73 pp | 3.73 pp | 5.38 pp |
| grayscale40 | 18.47 pp | 23.30 pp | 37.64 pp |

## Quantized percentage ordering

This section uses the independent marginal-coverage objective, which differs from joint distinct-area matching when families overlap. Similar top-ten means do not imply identical ordering: top-one regret and unchanged rank positions expose that difference.

| Query | Pixel oracle top10 mean error | Fine0.01pp | Coarse1pp | Coarse top1 regret | Fine/coarse same top10 positions |
|---|---:|---:|---:|---:|---:|
| green40 | 6.35 pp | 6.35 pp | 6.35 pp | 0.00 pp | 5/10 |
| red50green50 | 46.10 pp | 46.10 pp | 46.10 pp | 0.00 pp | 4/10 |
| red70dark30 | 32.22 pp | 32.22 pp | 32.22 pp | 0.00 pp | 10/10 |
| dark90 | 3.73 pp | 3.73 pp | 3.73 pp | 0.11 pp | 8/10 |
| grayscale40 | 18.47 pp | 18.47 pp | 18.49 pp | 0.00 pp | 7/10 |
| rainbow20 | 54.94 pp | 54.94 pp | 54.94 pp | 0.00 pp | 10/10 |

## Raw evidence

- `global-indexing.json`: build timings, store sizes, node constraints.
- `global-evaluation.json`: all per-query timings, correctness checks, profiles and resource snapshots.
- `global-data.json`:100 source-pixel measurements and20 analytic fixtures.
- `global-*-probe.json`: executable correctness, snapshot and pagination probes.
