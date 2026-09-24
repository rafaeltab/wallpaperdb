# Native indexed picked-color grid

This throwaway prototype asks whether a fixed picked-color objective can rank globally with native OpenSearch utilities, without evaluating palette distances per document at query time or reranking in the application. Native postings can skip noncompetitive work but do not guarantee avoiding every document for every query. It passes the tested subsecond boundary at one million synthetic documents, with narrower scope and substantial objective-approximation limits.

## Formula and limits

Each actual Palette32 color contributes to nearby points on a 17 × 17 × 17 OKLab grid: L from 0 to 1, a/b from −0.4 to 0.4. For each anchor, colors within radius 0.12 count toward area A. Their quality falls linearly from 1 at the center to 0.5 at the boundary; weighted quality mass is Q. The anchor utility is `Q / max(A, 0.05)`, exactly the existing direct-palette precision objective at that anchor. The index stores `round(255 × utility)` as a positive native `rank_features` value; zeros are absent.

A picked color interpolates its eight neighboring anchors with trilinear weights. OpenSearch adds native linear feature scores and a constant 0.000001 so zero-utility documents remain eligible. Filtering and ordering happen in OpenSearch over the whole eligible index. Retrieval is exact for this stored/interpolated formula. The formula approximates the continuous direct-palette objective, sometimes substantially near radius boundaries. Palette32 itself is already a lossy image representation.

Scope is one picked color with the fixed defaults above. Named-color intent, proportions, multiple colors, explicit custom ranges and custom scorer parameters are unsupported. This is an additional narrow method, not a replacement for the flexible prototypes.

## Real-image validation

Index `color-exploration-precision-grid-real-v2` contains exactly all 545 expected IDs: 523 real images and 22 controlled fixtures. It stores a mean 321 positive utilities per asset. Creation, bulk indexing, refresh and validation took 305 ms; observed store size was 1,704,915 bytes. These are small local measurements.

Seventeen picked colors × all 545 assets were compared against independent JavaScript correctness oracles and the exact OpenSearch palette scorer. Maximum native-grid score error was 1.18 × 10⁻⁷; maximum exact-palette service error was 5.83 × 10⁻⁸. The oracles are diagnostic only and never rank user requests.

Representation loss against the exact palette objective:

| Color | Top20 overlap | Mean absolute score error | Maximum absolute error |
| --- | ---: | ---: | ---: |
| #ff2200 | 90% | 0.0168 | 0.2944 |
| #4c8c72 | 90% | 0.0680 | 0.2904 |
| #101010 | 85% | 0.0284 | 0.4220 |
| #808080 | 30% | 0.0262 | 0.2654 |
| #dd6600 | 85% | 0.0439 | 0.3346 |
| #8030b0 | 95% | 0.0121 | 0.2684 |
| #20b8d0 | 75% | 0.0485 | 0.3904 |

Across these seven shared performance swatches, mean overlap and tie-aware exact-cutoff recall are both 78.57%. Mean score error over all documents is 0.03485; among active scores above 0.05 it is 0.06893. Mean exact-objective utility lost by the returned top20 is 0.00435. Across all 17 diagnostic swatches, overlap is 81.47%, tie-aware cutoff recall 85.88%, and top20 utility loss 0.00403. Low average utility loss does not remove the poor gray overlap or large individual score errors.

The final feedback snapshot `2026-09-20T03-13-00.884Z-c2f20177` supports 3 of 37 judged cases, covering 17 pairwise preferences. Development agreement is 87.78%, compared with 79.44% for exact palette precision on those same three cases. Per case: shade 80%/80%, warm red 100%/91.67%, muted green 83.33%/66.67%. This is one observer's quick judgments and a tiny development subset, not evidence that interpolation is generally more accurate. Thirty local requests had p95 2.30 ms. Unsupported cases are excluded rather than scored zero.

## Scale protocol

The scale runner uses the shared deterministic mixtures of all 545 source descriptors. Every document receives its actual rounded Palette32, including the merged RGB tail. Utilities are recomputed from that palette; source utility vectors are never simply blended. Per-RGB sparse anchor contributions are cached, with original colors pinned and other colors bounded to 8,192 cache entries. The corpus is synthetic performance data, not one million independent wallpapers or additional relevance judgments.

A 1,000-document offline generation/serialization sample produced 6,777 documents/second, mean 338 positive utilities, mean 4.10 KB of bulk JSON per document, and 1,000 distinct quantized utility vectors. Client RSS was 144 MB. This is not indexing throughput or a storage projection.

The isolated port19217 runner stages actual indexes at 1k, 10k, 100k and 1M documents. It profiles the seven supported queries out of the shared 23-query workload at concurrency1/4/16, at least 28 requests each. Warmups, every error and every request taking at least 1,000 ms fail strict viability. Successful-request percentiles are accompanied by all error counts and the maximum across all requests. Requested and actual concurrency are recorded. An optional duration adds sustained closed-loop measurement; it is separate from scheduled-arrival capacity tests. Higher concurrency stops after a failed profile.

Resume requires matching descriptor, definition, actual encoder/math, synthetic generator, seed and mapping fingerprints, together with a deterministic bulk checkpoint and compatible live count. A partial bulk cannot resume with a smaller batch. Each invocation archives all local modules. After failed warmups or profiles, the runner records two consecutive idle search/queue observations; if the bounded drain check fails, it refuses to continue to the next stage. The real v1 index predates the computation-fingerprint guard and is retained as an unused experiment; v2 is the validated browser/feedback index.

## Million-document results

The actual source-disabled, one-shard, zero-replica index `color-exploration-precision-grid-scale-v1` contains 1,000,000 synthetic documents. Generation, bulk indexing and refresh across all four stages took 207.99 seconds. There were no bulk failures. Each million-stage document has about 340 positive utilities. The node was limited to 8 CPU cores, with a 4 GiB Java heap and 12 GiB container memory.

The initial 28 requests per profile all passed, including their warmups:

| Actual documents | C1 p95 | C4 p95 | C16 p95 | C16 maximum |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2.42 ms | 4.79 ms | 10.02 ms | 10.28 ms |
| 10,000 | 3.89 ms | 4.33 ms | 8.86 ms | 9.43 ms |
| 100,000 | 18.64 ms | 18.95 ms | 30.69 ms | 30.94 ms |
| 1,000,000 | 153.69 ms | 154.68 ms | 486.50 ms | 500.25 ms |

The same one-million-document index then received three 60-second closed-loop profiles, using all seven supported swatches:

| Concurrency | Requests | p95 | Maximum | Requests/second | OS CPU cores, mean |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 550 | 151.78 ms | 158.39 ms | 9.17 | 0.98 |
| 4 | 2,117 | 160.47 ms | 186.43 ms | 35.22 | 3.97 |
| 16 | 3,099 | 502.32 ms | 621.76 ms | 51.42 | 7.96 |

All 5,766 sustained requests and their warmups completed without errors or a one-second violation. Sampled client RSS was at most 151 MB during sustained querying; sampled Java heap was at most 3.01 GB. Client CPU averaged at most 0.071 core. These are sampled process observations, not isolated per-method memory allocations or hard peak guarantees. Merge settling reported zero active merges before the million-document measurements.

Latency clearly grows with corpus size. Passing this one-million-document experiment does not establish constant-time behavior, a production SLO, or viability at 100 million real wallpapers. Native named-color utilities have much higher tested capacity; this method buys a fixed picked-color objective at additional query CPU cost.

Scheduled arrivals then exercised all seven swatches for 60 seconds at each rate:

| Offered requests/second | Arrivals | p95 | Maximum | Errors, including rejections | Client rejections | Strict result |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 50 | 3,000 | 181.93 ms | 236.88 ms | 0 | 0 | Pass |
| 100 | 6,000 | 2,001.88 ms | 2,008.61 ms | 5,939 | 2,126 | Fail |

The 300 requests/second step was skipped after failure at 100. These are measured passing/failing rates, not an exact capacity estimate. At 50 requests/second the node averaged 6.11 CPU cores and the client 0.073 core; at 100 the node saturated its eight-core allocation. Arrival latency includes dispatch delay and failed/rejected requests. The 2,126 rejected arrivals are included in the 5,939 errors, not additional failures. All warmups passed, and recorded search-queue settling checks found zero active merges. The queue drained after the failed step.

Final idle capture at 03:28:26 UTC on 2026-09-20 confirmed 1,000,000 documents, **3,147,507,350 bytes** of index storage, 18 segments and zero active merges/searches. This index excludes `_source`, uses no replicas and contains only the precision-grid method's fields; production storage will differ.

Scale artifact: `precision-grid-scale/2026-09-20T03-18-52.319Z/scale.json`; final storage is adjacent in `idle-storage.json`. The source snapshots, exact identity, complete request traces and resource observations are adjacent. Arrival artifact: `arrival-load/2026-09-20T03-25-57.457Z/load.json`, with all 9,000 trial outcomes and its source snapshot. No passing profile was repeated to select a favorable result.

## Reproduce and inspect

```sh
make color-exploration-precision-grid-index COLOR_EXP_ARGS='--diagnose'
make color-exploration-precision-grid-scale COLOR_EXP_ARGS='--dry-run --samples 1000'
make color-exploration-precision-grid-scale
# After completing stages, use the recorded directory and full index:
make color-exploration-precision-grid-scale COLOR_EXP_ARGS='--counts 1000000 --rerun --duration-seconds 60'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods rank-features-precision-grid --index color-exploration-precision-grid-scale-v1 --rates 50,100,300 --seconds 60'
```

Artifacts are external under `~/.local/share/wallpaperdb/color-evaluation/exploration/`:

- `color-exploration-precision-grid-real-v2.json`: exact ID validation, fingerprints, encoding/index timing and store statistics.
- `color-exploration-precision-grid-real-v2-diagnostics.json`: all 17 colors, per-document score-error aggregates and both top20 lists.
- `precision-grid-scale/<timestamp>/scale.json`, request/resource JSONL and archived source files: actual scale evidence.

The browser lists this as **Native indexed picked-color grid**. Use the plain picked-color preset without range controls.
