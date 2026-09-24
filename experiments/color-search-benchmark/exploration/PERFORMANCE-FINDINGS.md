# Performance findings

Native indexed objectives are the strongest OpenSearch execution options measured so far. Exhaustive fine-color scoring remains expensive, even when its perceptual agreement is better. These results separate three questions: whether an objective matches the recorded preferences, whether retrieval returns the global best results for that objective, and how much query traffic the service can handle.

All planned campaigns are complete, including ClickHouse and the picked-color grid. Immutable raw results remain in the external store; failed profiles are retained.

## Million-document short profiles

### Follow-up: 1,024 overlapping coverage/quality regions — 2026-09-21

The two new variants use native scalar functions over selected coverage/quality pairs. At one million synthetic records, the 24-query mixed workload passes C1/C4 (p95 337–347 ms) but **fails C16**: dense records seven timeouts and six ≥1-second attempts; hybrid records nine timeouts and six ≥1-second attempts. Four attempts belong to both categories, leaving 24 distinct failures. Every failure is a five-color percentage query. Increasing the corpus from 100,000 to one million raises p95 by 8.28–8.94×.

Both variants separately pass 20 and 50 scheduled requests/second over 30-second profiles, with no failures across 4,200 requests. That workload has 21 query shapes, so its p95 of 162–171 ms at 50/second must not be compared directly with the heavier 24-query profile. A separate diversity probe covers 128 regions, 256 fields and 1,280 single-color requests: all pass, with C16 p95 198 ms and maximum 213 ms.

The final source-disabled index occupies **16.46 GB** for one million records; indexing took **24.95 minutes** cumulatively. [Full overlapping-region findings](OVERLAPPING-REGIONS.md) preserve exact results, resources, failures, geometry limitations and artifact paths. This representation is not a production-ready solution to the full accuracy/performance requirement.

### Earlier method campaigns

All rows use one OpenSearch 2.11.0 node, one primary shard, no replicas, eight CPU quota, 4 GiB Java heap and a 12 GiB container limit. The index has one million deterministic mixtures of the 545 source descriptors. These are performance inputs, not one million independently sampled photographs.

| Implementation | Concurrent clients | Timed p95 | Failures or one-second responses | Interpretation |
|---|---:|---:|---|---|
| HSV cosine ANN, k=500 |16|31 ms|None, including warmup|Fast approximate control; not the strongest perceptual objective. |
| Native area, linear |16|71 ms|None, including warmup|Fast named-area objective; misses quality and composition interactions. |
| Native quality, linear |16|325 ms|None, including warmup|Adds quality without script scoring; still a restricted objective. |
| Native quality, asymmetric |16|375 ms|None, including warmup|Improves the judged proportion cases but regresses combinations. |
| Named intent with exact bounds |15|465 ms|None, including warmup|More flexible named scoring; short-block success needs arrival-load evidence. |
| Precomputed precise palette |16|683 ms among successes|16 of 21 timed requests failed; initial warmup also failed|Fails the latency requirement at this load. |
| Bounded precomputed precise palette |16|909 ms among successes|8 of 21 timed requests failed; three warmups exceeded one second|Safe bounds were too weak to make this viable. |
| Broad precomputed hybrid |1|595 ms among successes|3 of 69 timed requests failed; warmup also failed|Fast branches do not make the whole hybrid viable. |

These rows come from different recorded workload revisions and are not a controlled same-query race. The original workload had 16 queries; later runs have 23, including five-color proportions and additional dark/neutral picked shades. Each method runs only supported queries, with exclusions recorded. The named bounded profile actually had 15 active clients despite the requested 16. Percentiles among successful requests must never conceal failures.

Typed fine histograms, perceptual kernels, palette transport, original direct-palette scoring and several broad hybrids also failed million-document profiles. Some failed most or all serial requests. Their small-corpus speed is not evidence of scalability. The dashboard retains every measured profile.

## Sustained indexed utilities

Native utility postings completed **89,213 timed requests across six 60-second profiles, with zero errors or responses at or above one second**. Warmups passed too. At 16 clients, the area and vibe variants reached approximately 386 and 415 requests/second, with p95 around 157–158 ms and maxima 268 and260 ms. See [the full measurements](RANK-FEATURE-SCALE.md).

The objective uses a fixed vocabulary of named color/vibe profiles and quantized precomputed utilities. Its speed does not establish support for arbitrary hex colors, arbitrary ranges, or joint palette purity. At the highest tested closed-loop concurrency, it used approximately eight CPU cores. Indexing took about 18 minutes and the idle index occupied 13,105,519,265 bytes (13.11 GB decimal), with 45 segments and zero active merges.

## Arrival-load results

Scheduled-arrival campaigns run separately from the concurrent-client profiles. They include client dispatch delay, service failures and rejected arrivals in their results. The current campaign uses 60-second profiles and the expanded 23-query workload, with each method's unsupported queries recorded. See [the protocol](ARRIVAL-LOAD.md).

The campaign recorded **118,200 scheduled requests across twelve 60-second profiles**. Passing rows below had zero errors, rejections or responses at/above one second, including warmups.

| Method | Highest passing tested rate | p95 at that rate | Maximum | Approximate CPU cores used | Next tested rate |
|---|---:|---:|---:|---:|---|
| Indexed utility vibe |300/sec|81.80 ms|140.60 ms|5.96|500/sec failed |
| Native linear area |50/sec|127.33 ms|145.41 ms|2.03|200/sec failed |
| Native asymmetric quality |50/sec|311.15 ms|343.51 ms|3.70|200/sec failed |
| Named intent with exact bounds |50/sec|429.88 ms|471.55 ms|3.68|100/sec failed |
| HSV cosine ANN, k=500 |300/sec|28.79 ms|50.93 ms|4.83|No higher rate tested |

These are passing measured rates, not estimates of exact maximum capacity. Method support differs: 14/23 utility cases, 15/23 linear-area cases, 14/23 asymmetric-quality cases, 15/23 bounded-intent cases, and 18/23 HSV cases. Each run rotates its whole supported workload. The finer precision and custom-range paths are not hidden inside these successful native rows.

The `native-area-linear` workload includes the dark-with-bright-spots query, which uses its scalar Painless accent fallback. That row therefore measures a mix of native decay and scripted accent scoring; its method name does not mean every request uses native decay.

At the failed rates, utility ranking had 18,210 failed arrivals, linear area 5,636, asymmetric quality 8,652, and bounded intent 1,515. Those totals include explicit rejections at the 128-request client cap. Rejections count as failures rather than disappearing from latency statistics. Successful-only latency does not rescue those profiles. The driver waits for the search queue to drain between profiles.

Raw evidence directories: `arrival-load/2026-09-20T02-38-31.904Z` (utilities), `2026-09-20T02-41-54.257Z` (native methods), `2026-09-20T02-46-44.724Z` (bounded intent), and `2026-09-20T02-50-45.866Z` (HSV). Each contains `load.json` and a frozen source snapshot. See [ARRIVAL-LOAD.md](ARRIVAL-LOAD.md) for the complete measured protocol and resource limitations.

## Precise-color execution in ClickHouse

One additional implementation evaluates the same single-picked-color palette objective in globally ordered SQL. It uses all 545 source assets for visual/feedback comparisons and a separate million-document performance table. This is an execution comparison, not an additional learned or perceptual model. All 4,905 real-corpus score comparisons and nine complete ordered result sets matched the OpenSearch typed reference. Its three judged precision cases also have identical 79.44% agreement. With eight threads allowed per request, the million-record campaign passed C1 (252 requests, p95 331.65 ms, max 340.52 ms), but failed C4 (70/252 errors) and C16 (148/252 errors). At C16, every one of the 84 unfiltered queries timed out. The 21-query workload comprises seven precise colors each at unrestricted, 10% and 1% metadata selectivity. The table occupied about 773 MB compressed and 1.112 GB uncompressed immediately after indexing; final idle storage is reported by the service-specific notes.

The one-thread refinement reduced serial query CPU by about 69% but increased C1 p95 to 403.23 ms. It still failed C16: 141/252 errors, with every unfiltered request timing out. Neither tested thread setting meets the concurrent-load requirement. See [CLICKHOUSE.md](CLICKHOUSE.md) for settings and raw evidence.

## Picked-color utility grid

The successful named utility method motivates one further refinement: precompute the precision objective on a fixed OKLab grid and combine neighboring grid points with native rank-feature weights. This approximates the color objective but still ranks globally in OpenSearch, without application-side candidate scoring. The real index contains all 545 assets and averages 321 positive anchor utilities per image. Native service scores agree with the indexed-formula oracle within 1.18e-7 across 17 diagnostic colors. Against the continuous palette objective, mean top-20 ID overlap is 81.47% (85.88% at the exact score cutoff, allowing ties), with mean top-20 reference-utility loss 0.00403. The seven swatches shared with the performance workload have 78.57% mean top-20 overlap. Mid-gray is the weakest: 30% overlap, although the top result is unchanged and mean reference-utility loss is 0.01185. Maximum per-document score error over the 17 colors is 0.422; this approximation is not numerically equivalent to the continuous objective.

On the same three judged precision cases, agreement rises from 79.44% to 87.78%. This is one corrected preference and one formerly tied pair, across only 17 assessed pairs. It does not establish general superiority. The final small-corpus p95 was 2.30 ms.

The actual million-document grid passed all staged concurrency profiles and three 60-second sustained profiles. Across the sustained profiles, **5,766 requests and all warmups passed**. At sixteen clients, p95 was **502.32 ms**, maximum 621.76 ms, throughput 51.42 requests/second, and OpenSearch used approximately 7.96 CPU cores. Single-client p95 was 151.78 ms. The index took 207.99 seconds to build and occupied **3,147,507,350 bytes (3.15 GB decimal)** when idle, with 18 segments and no active merges.

Scheduled arrivals rotated all seven supported picked-color swatches without metadata restrictions:

| Arrival rate | Requests | p95 | Maximum | Failed requests | Outcome |
|---|---:|---:|---:|---:|---|
| 50/second |3,000|181.93 ms|236.88 ms|0|Strict pass, including warmups. |
| 100/second |6,000|2,001.88 ms|2,008.61 ms|5,939|Fail; 2,126 failures were client-cap rejections. |

The failed profile also contained 3,848 responses at or above one second; these counts overlap failures and must not be added together. The next planned 300/second profile was skipped after failure. Search queues were drained and idle state recorded before releasing the node. This is a viable measured rate for one fixed picked-color objective, with meaningful approximation loss. It does not establish fast arbitrary ranges or proportions. See [PRECISION-GRID.md](PRECISION-GRID.md) for complete traces, sampled memory and query support.

## Retrieval accuracy and scaling limits

The million-document ANN diagnostic measured retrieval against an exact service-side reference. Worst tested tie-aware recall@20 for HSV cosine rose from 30% at k=20 to 100% at k=500. Some RGB misses remained even at k=500. This is retrieval recall for the stored vector objective, not human relevance. See [RECALL.md](RECALL.md).

The exact bounded methods rank every document that can still beat the threshold in OpenSearch. They do not retrieve a fixed candidate set for application-side reranking. Weak bounds can nevertheless leave most documents to score. Multi-search bounds would also require a stable index view in production.

None of these measurements establishes 100-million-document capacity. Even native indexed paths became slower between 100k and1M; a query that is fast on one million should not be assumed constant-time as the corpus grows. The synthetic mixtures have repeated/quantized structure, and production tags, update load, replicas, shard layout and concurrent traffic need their own measurements.

## Evidence and reproduction

All paths below are relative to `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/`:

- Baseline 16 implementations: `scale/2026-09-20T00-51-14.799Z/scale.json`.
- First refinement 20 implementations: `scale/2026-09-20T01-45-32.439Z/scale.json`.
- Final five OpenSearch implementations: `scale/2026-09-20T02-25-41.635Z/scale.json`.
- Indexed utilities, including sustained traffic: `rank-feature-scale/2026-09-20T01-58-20.990Z/scale.json`.
- Picked-color grid, including sustained traffic: `precision-grid-scale/2026-09-20T03-18-52.319Z/scale.json`; arrival traffic: `arrival-load/2026-09-20T03-25-57.457Z/load.json`.
- ClickHouse eight-thread and one-thread campaigns: `clickhouse-scale/2026-09-20T02-54-39.077Z/scale.json` and `clickhouse-scale/2026-09-20T03-00-08.903Z/scale.json`.
- Arrival traffic: separate immutable directories under `arrival-load/`.

The first baseline scale run did not capture a startup source snapshot. Later campaigns preserve source snapshots and hashes; the missing early provenance is not reconstructed as certainty. CPU/heap/RSS observations include the recorded benchmark environment and are not exact production gateway resource requirements.

Run the commands documented in [README.md](README.md), with only one heavy indexing or performance campaign active on the shared host at a time. [ACCURACY-FINDINGS.md](ACCURACY-FINDINGS.md) provides the separate comparison on common human-judged cases.
