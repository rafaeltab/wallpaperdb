# Performance of strict hue favorite snapshot 001

2026-09-22–23. **Complete, independently audited, and cleaned up.** The campaign tests the user's preserved favorite without changing its scoring.

## Conclusion and original million-record results

The current query implementation misses the one-second requirement for unrestricted combinations at one million documents on this node. Both banks pass single-color vibe searches through concurrency 16. Choosing 256 instead of 1,024 bins does not remove the combination-query bottleneck. Preserve the favored matching behavior; optimize its execution before treating it as a production solution for all query shapes.

**Original campaign: one million documents, no metadata filter.** Passing cells show the range of p95 milliseconds across the two banks; failure cells include all errors and slow requests, not only successful-response percentiles.

| Query | 1 concurrent | 4 concurrent | 16 concurrent |
| --- | ---: | ---: | ---: |
| Single-color vibe | 249–250 ms | 250–253 ms | 784–798 ms |
| 40% green | 328–333 ms | 333–334 ms | **Fails** |
| 50% red / 50% green | 659–663 ms | 660–661 ms | **Fails** |
| Five colors at 20% each | **Fails: every timed request times out** | Skipped after failure | Skipped after failure |

At 100,000 documents, all 72 profiles pass. Unrestricted five-color p95 is 204–206 ms serially and 619–622 ms at concurrency 16. At one million documents, all 48 profiles with 10% or 1% eligibility filters pass through concurrency 16. Filtered success must not be presented as unrestricted-search capacity.

The primary campaign contains 140 measured profiles, 860,660 timed requests and 48 warmups. Six profiles fail. Timed requests contain 385 errors and 329 one-second-or-slower responses; the union is 400 failed requests, because these categories overlap. Two five-color warmups also fail. These aggregate counts are bookkeeping, not a useful overall failure percentage: cheap selective queries contribute far more requests than expensive unfiltered queries.

Independent audit (`projection/audit.json` and reproducible `audit.py`) reconciles every raw request, compact timing record, ordinal, context, percentile, failure union, warmup, skip, resource row and recorder byte count. No discrepancies were found. The two-color concurrency-16 failures are near-total: 159/160 requests return errors for 1,024 bins and 142/145 for 256 bins; every request in the latter profile fails the strict boundary. Successful-only percentiles would conceal this.

The unrestricted two-color concurrency-16 case consumes approximately 7.9 CPU cores of the 8-core allowance. Its benchmark client uses roughly 0.02 CPU cores during the block. These are whole-process deltas, subject to the resource limitations below; they are consistent with OpenSearch scoring being the bottleneck.

The million-record projection occupies **1,249,705,319 bytes (1.25 GB decimal)** in eight segments. Initial 100k indexing took 8.79 seconds; adding 900k took 53.41 seconds including refresh. This is only the 70-measurement-field projection, with stored source disabled. It is not a full-bank storage estimate. Kernel observations over the primary campaign peaked at 6.89 GiB container memory (including charged cache) and approximately 159 MiB container swap; no memory-limit/OOM events occurred, and host available memory stayed above 12.49 GiB. CPU quota throttling occurred under load.

## Scheduled arrivals

The arrival campaign completed at 14:17:57 UTC: eight profiles, 1,740 timed requests and two warmups, with zero errors or one-second responses. Both banks passed 1, 4, 8 and 16 requests/second for the unrestricted single-color vibe query over one million records. At 16 requests/second, scheduled-to-completion p95 is 253.1 / 253.4 ms (256 / 1,024 bins), with maximum 276.5 / 270.6 ms. Each rate has a full 30-second observation window. This establishes the tested rate, not the maximum sustainable capacity. Five-color arrivals were omitted because serial requests already failed.

Arrival independent audit passes all 7,144 checks, with zero discrepancies (`arrival/audit.json`, reproducible `audit.py`). Raw request timings, rate windows, resource samples, fingerprints and retained index checks reconcile. Maximum scheduler delay across the campaign is 2.65 ms.

## Confirmation after full-schema builds and maintenance

The separate confirmation finished at 00:34:00 UTC on September 23. It repeats the eight unrestricted cases on the same million-record projection after building both full banks and completing normal maintenance. The projection's exact searchable-segment entries, document count, mappings and settings were unchanged. The node's cache/heap history differs from the original campaign; the cause of run-to-run latency variation is not isolated.

| Query | 1 concurrent, p95 | 4 concurrent | 16 concurrent |
| --- | ---: | --- | --- |
| Single-color vibe | 264–277 ms | Pass, 264–276 ms p95 | Pass, 796–812 ms p95 |
| 40% green | 337–353 ms | Pass, 347–383 ms p95 | **Fails in both banks** |
| 50% red / 50% green | 689–719 ms | 256 passes; **1,024 fails** | **256 fails**; 1,024 skipped after C4 failure |
| Five colors at 20% each | **32/32 timed timeouts per bank** | Skipped | Skipped |

All single-color vibe profiles pass; their maximum observed timed latency is 894.27 ms. The additional two-color 1,024-bin C4 failure contains 48 requests, eight errors and nine responses at or above one second, with a union of nine failures. Its maximum is 1,062.84 ms. This profile passed in the original campaign, so C4 must not be described as a reliable general capacity for two-color queries.

Independent audit (`maintained/audit.json`) passes 23,729 checks. There are 19 profiles, 1,979 timed requests, eight warmups, six failed profiles, 266 timed errors and 251 slow responses; the timed failure union is 290. Two warmups fail. Five higher-concurrency profiles are correctly omitted after earlier failure. Every one of the 1,719 successful responses, including warmups, matches the original top-20 IDs and scores exactly. The five-color cases have no successful original reference and also time out in the repeat; no score-parity claim is inferred for them.

The repeat reinforces the execution limit without changing the favored color behavior. Both banks remain available; there is no new production algorithm selection.

## Full-schema pilots and settled storage

The full 256-bin pilot completed both 10k and 100k stages: all 24 profiles, 36,329 timed requests and 24 warmups pass. Independent audit (`full256/audit.json`) reports 327,674 checks and zero discrepancies. At 100k, all 12 queries return exactly the same top-20 IDs and scores as the corresponding projection. The full 1,024-bin pilot is also complete across its original 10k run and separate 100k completion: 24 profiles, 33,213 timed requests and 24 warmups, with zero timing failures.

Full1024 completed indexing 100k at 00:04:30 UTC on September 23. Its two-minute pre-query settling guard stopped the campaign at 00:06:30 because one background merge remained active (search activity and queues were zero). No 100k query timing occurred in that invocation. A resume with a 600-second settling allowance stopped before timing because the original mapping guard rejects OpenSearch's omission of the default `_source.enabled=true` setting. The original `full1024/` artifacts preserve both interruptions and the completed 10k profiles.

A separate read-only completion runner finished the remaining 100k stage. Its offline check reproduced all 10,292 mapping fields and confirmed that omission of `_source.enabled=true` is the sole difference. It accepts only that equivalent default, retains real mapping and source-identity checks, and writes `full1024-completion/` with immutable parent provenance. No original driver, scoring source, indexed value or old timing artifact is changed. The attempted resume performed a refresh before its failed mapping check; the completion records its actual index layout.

The separate 100k completion finished at 00:23:21 UTC. Its independent audit passes 132,389 checks: 12 profiles, 10,996 timed requests, 12 warmups and zero errors or one-second responses. Every successful response has the exact top-20 ID/score hash of the same-count projection. The parent 10k evidence separately passes 200,374 checks. Both historical interruptions remain visible and all original files retain their hashes.

| Full schema at 100k | 256 bins | 1,024 bins |
| --- | ---: | ---: |
| Mapped fields | 2,612 | 10,292 |
| Single-color vibe p95, C1 | 29.8 ms | 29.7 ms |
| 40% green p95, C1 | 37.0 ms | 40.3 ms |
| Two colors p95, C1 | 69.1 ms | 74.1 ms |
| Five colors p95, C1 | 210.7 ms | 218.5 ms |
| Store after maintenance, decimal GB | 4.786 | 19.140 |
| Segments after maintenance | 21 | 30 |

These are two separate physical indexes with stored source enabled. Their query timings were captured before the final maintenance: 30 segments for full256 and 40 for full1024. The settled bytes must not be mistaken for the physical layout under which those timings were measured. No full-schema million-document benchmark was run.

**Storage state matters.** The full256 index showed 7,484,998,168 bytes / 30 segments at the end of measurement. A separate explicit refresh after the campaign reduced this to 4,786,014,183 bytes / 21 segments, with the same 100,000 documents. Both snapshots are retained as `post-campaign-before-refresh.json` and `post-campaign-after-refresh.json`. These are intermediate observations; the final maintenance receipt below establishes the reported storage state.

Waiting for `merges.current=0` alone did not establish a final search/storage layout with automatic refresh disabled. OpenSearch distinguishes searchable and committed segments; its merge scheduler can flush later to release transient files. See the [segment API](https://docs.opensearch.org/latest/api-reference/index-apis/segment/) and [OpenSearch 2.11 engine source](https://github.com/opensearch-project/OpenSearch/blob/2.11/server/src/main/java/org/opensearch/index/engine/InternalEngine.java).

Normal flush → refresh → quiet-activity verification completed at 00:23:56 UTC for all three new indexes, without a force merge. Counts, UUIDs, mappings and settings remained unchanged. The projection stayed at 1,249,705,319 bytes / eight segments; full256 stayed at 4,786,014,183 bytes / 21 segments. Full1024 fell from 22,239,963,167 bytes / 40 segments to **19,139,629,133 bytes / 30 segments**. Raw receipts are in `maintenance/maintenance.json`.

Maintenance audit (`maintenance/audit.json`) passes 269 checks. Projection and full256 segment entries are byte-for-byte unchanged. For full1024, the stats count includes searchable or committed segments: it goes 40 → 30, while searchable entries go 39 → 30. Ten older searchable segments are removed and one merged segment becomes searchable; retained entries are unchanged. The separately audited confirmation above preserves all original artifacts and scoring.

## What the query cost suggests

Each requested picked color expands into five independently scored cutoff components. Five requested colors therefore produce 25 `function_score` clauses, reading up to 50 coverage/quality fields per eligible document. At the saved linear setting, these use native OpenSearch functions; no power-curve script or application reranking is involved. The synthetic documents contain all selected fields, so the required-field checks do not reduce the eligible set.

Both bank sizes select one anchor per requested color. Going from 256 to 1,024 stored anchors increases the index, but does not reduce the number of scoring components in a request. That explains why the measured query times are similar while indexing costs differ. This is a code-based interpretation consistent with the CPU measurements, not a profiler attribution of every millisecond.

Follow-up cause assessment: each color component wraps `match_all`. The outer metadata and field-existence filters determine eligibility; internal shortage/excess range conditions choose a scoring function rather than eliminate the wallpaper. With no selective metadata filter, the query leaves the whole benchmark corpus eligible. Stored numeric indexes and values are used, but there is no stored ordering for the arbitrary weighted combination requested by the user.

The exact [OpenSearch 2.11.0 function scorer](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java#L578) returns `Float.MAX_VALUE` from `getMaxScore`, providing no useful tight upper bound for skipping uncompetitive blocks. Combined with the broad query, this supports the hypothesis that substantial CPU goes into evaluating candidates that ultimately cannot reach the top 20. A full five-color evaluation across one million eligible records represents roughly 25 million cutoff-component evaluations; timed-out requests can stop earlier. This is a work estimate, not a measured scorer-call count or a count of disk reads.

The likely bottleneck is broad per-document scoring plus scorer/filter/numeric-value-access overhead. Shade/hue pixel comparisons were already performed during extraction. No query profile or CPU flame graph was captured, so arithmetic, scorer overhead, value access and collection costs have not been isolated. The next diagnostic would use the [Profile API](https://docs.opensearch.org/2.11/api-reference/profile/) and CPU sampling; profile-instrumented timings should remain separate from ordinary latency measurements. No new service run or scoring change was performed for this assessment.

Future execution experiments should preserve the favorite score and its global ordering: compare a fused service-side calculation, precomputed terms for common queries, or pruning with a proven score upper bound. Each requires a fresh correctness and performance comparison. Dropping cutoff layers or ranking a small candidate set would change the method being tested. No such optimization is implemented in this campaign.

## Reproduction and retained evidence

Artifact root (outside Git):

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-performance/2026-09-22/`

| Directory | Evidence |
| --- | --- |
| `projection/` | Original 100k → 1M workload, frozen sources, requests, resources and independent audit |
| `arrival/` | Original scheduled single-color arrivals and independent audit |
| `full256/` | Full-schema 10k/100k pilot, audit and separate post-campaign storage observations |
| `full1024/` | Full-schema indexing, 10k timing and both retained interruptions |
| `full1024-completion/` | Separate 100k query completion, linked to the original full1024 parent |
| `maintenance/` | Normal flush/refresh receipts, before/after index identities and layouts |
| `maintained/` | Separate million-record query confirmation after maintenance |
| `resources/`, `resources-full/` | One-second kernel observations; `resource-summary.py` reproduces window summaries |

The original scale/corpus regression suite runs with `COLOR_FAVORITE_VERIFY=1 make color-favorite-scale-test`; arrival, completion, maintenance and confirmation helpers have corresponding `make color-favorite-*-test` targets. Actual invocation parameters, source snapshots and parent hashes accompany each run. Helpers write new output directories and refuse incompatible retained indexes. No images, archive, bulk data or request logs are added to the repository.

## Exact method

- Snapshot: [strict-hue-favorite-001](snapshots/strict-hue-favorite-001.json).
- Method: `cutoff-shade-hue-all-levels` (**All cutoffs: shade-aware + strict hue**).
- Banks: **256 and 1,024**, kept as two jointly favored settings.
- Cutoff weighting **1**, quality curve **linear**, quality influence **0.5**.
- Inherited defaults: minimum quality 0, concrete named swatches, area power 0.5, proportion quality penalty 0.35, excess penalty 1.5.
- All five hard-cutoff layers participate: 0%, 25%, 50%, 75%, 90%.
- Queries retain global OpenSearch scoring and sorting. No application candidate ranking, early termination, or limited candidate reranking.

The saved version and visual prototype remain unchanged. The proposed linear/power hybrid is not part of this performance test. This campaign measures precomputed-descriptor indexing and OpenSearch querying. It does not benchmark image decoding/extraction, NATS delivery, the production gateway, or browser rendering.

## Data and scope

The older million-document cutoff benchmark contains different color measurements; matching field names do not make it a valid strict-hue benchmark. This campaign creates a new scratch index from the frozen strict-hue descriptors, verifies their source and index receipts, and synthesizes deterministic mixtures of **523 real images**. The 22 controlled fixtures remain in the original verified 545-asset corpus but are excluded from synthetic source selection.

Each synthetic document uses the same two images and mixing weight for every field. Coverage and quality mass are mixed together; conditional quality is then recovered from their ratio. Overlapping bins are not normalized into an exclusive palette. Basis-point area rounding and float32 quality retain their existing precision limits. One million descriptor mixtures are **not one million independent photographs** and may compress or cache more favorably.

The first phase indexed the union of fields actually used by the workload at **100,000 and 1,000,000 documents**. This measures the current query mechanics at those sizes. Both bank settings use that common projection, so differences describe anchor selection and query behavior, not separate full physical indexes.

A projected pass does not establish full-schema memory, storage, indexing, or diverse-query cache behavior. The full strict-hue schemas contain **2,612 fields at 256 bins** and **10,292 at 1,024 bins**, including named measurements and metadata. Both full schemas are tested at 10k and 100k documents with `_source` retained. Million-document full-schema builds are deferred because unrestricted combination queries already fail in the smaller projection. This limits full-schema capacity conclusions to the measured pilot sizes.

## Workload and pass/fail rule

Four query shapes, each unfiltered, restricted to a deterministic 10% partition, and restricted to a synthetic 1% tag:

1. One picked-color vibe: `#ff0000`, the red used in the user's recent examples.
2. One color at 40%: `#22cc44`, remainder unconstrained.
3. Two colors at 50% each: `#ff2200`, `#22cc44`.
4. Five colors at 20% each: `#ff2200`, `#ff8800`, `#ffff00`, `#22cc44`, `#2266ff`.

Every shape/selectivity has its own profile for each bank. Do not combine inexpensive filtered requests with expensive unfiltered requests into one headline pass. Profiles use **1, 4 and 16 concurrent requests**, a serial warmup, and at least **32 timed requests and 10 seconds** of closed-loop load. A failed case skips only its higher concurrency levels; other cases continue.

The user's strict boundary applies: **any error or latency at or above one second fails that profile**, including warmups. Server timeout is 950 ms and client timeout 1,500 ms; the server's timeout is cooperative, not an exact deadline. Partial/shard-failed responses are errors. Timing covers query compilation through complete decoded OpenSearch response. Closed-loop percentiles use successful timed responses; failure counts, maximum latency, and overlapping error/slow counts remain explicit.

Request-result caching stays disabled. Repeated queries still exercise warm filesystem/JVM/query caches; no cold-cache claim is made. Requests are drained and search queues and merges must settle between blocks. Raw rows, unique request ordinals, query plans and skipped stages are retained.

The protocol calls for scheduled arrivals on surviving million-record unrestricted one-color vibe and five-color proportion workloads: at least 30 seconds per rate (1, 4, 8, 16 requests/second, stopping after a failed rate). Only single-color survived to this phase. These are representative simple and complex cases, not every query shape. Report scheduled-to-completion latency, scheduler delay, offered/completed throughput and client rejections. Closed-loop concurrency alone cannot establish capacity for users arriving independently.

## Environment and resource measurements

The isolated OpenSearch node is at **127.0.0.1:19217**, separate from the 545-image interactive node at 19216. Existing scale indexes and wallpapers are retained. Initial scale-node health is green.

- OpenSearch image: **2.11.0**.
- Container: **8 CPU quota, 12 GiB memory limit**.
- JVM heap: **4 GiB**; the JVM may report more visible processors than the effective quota.
- Host at planning time: **28 GiB RAM, 18 GiB available**, approximately **348 GiB disk free**; existing swap usage approximately 5.9/8 GiB.
- Index layout, shard/segment counts, merges, CPU, heap, driver memory and search queues are captured with each phase.

CPU observations are whole-node counters and may be cached; zero short deltas do not prove zero work. Sampled heap/RSS values are observations, not instantaneous peaks. Driver CPU and memory do not measure the complete production gateway. No other benchmark ran concurrently. Final health checks and scale-node shutdown are recorded below; the interactive services use a separate node.

The kernel observer follows the container cgroup through its init PID. Its cgroup memory includes all container processes and charged file cache; its separate `processMemory` field describes the init wrapper, **not JVM RSS**, and is not used as JVM memory evidence. Container swap is recorded separately; approximately 0.14 GiB was observed after million-record indexing despite about 13 GiB host memory available and no cgroup OOM/limit events.

During full-schema building, adding 90,000 documents took **171.61 seconds for 256 bins** and **1,454.96 seconds for 1,024 bins**, including the final refresh but excluding the later wait for merges. The initial 10k batches took 20.64 and 164.55 seconds. These are descriptor-to-index timings with serial 100-document bulks, not image extraction or an optimized ingestion pipeline.

The full1024 indexing/10k-query window reached the **12 GiB cgroup limit**. At its sampled peak, anonymous memory was 4.89 GiB and charged file cache 6.88 GiB. There were 10,134 memory-limit encounters and **zero OOM events or kills**. Full256 peaked at 11.78 GiB without memory-limit encounters. These are whole-container observations including older retained indexes; they are not the isolated memory footprint of either bank. `resource-summary.py` records exact window boundaries and counters.

The maintained confirmation peaks at **9.29 GiB container memory**, with no memory-limit or OOM events; its sampled swap peak is 373.63 MiB. At C16, OpenSearch consumes about eight CPU cores while the benchmark client uses at most about 0.07 cores in the unrestricted profiles. This supports an OpenSearch execution bottleneck. Benchmark-client memory includes loaded source descriptors, archived campaign results and timing records; it does not measure the production gateway's per-query footprint.

## Validation and final state

- Original scale/corpus tests: 16 passed, including source measurement verification. Arrival tests: eight passed. Completion and confirmation tests: five passed each. Maintenance tests: eight passed.
- Primary, arrival, both full-schema pilots, completion, maintenance and confirmation have independent audits with zero discrepancies. Historical stops remain visible in `full1024/`; its indexed data and completed 10k measurements are preserved.
- Exact score parity holds for all available successful same-count references. No score, extraction definition, favorite manifest or live UI implementation was changed.
- Raw requests, resources, frozen sources, index receipts, interruption history and audit programs remain in the external artifact root. No wallpapers or archive files were added to Git; no commit or production selection was made.
- Final validation at 00:37–00:38 UTC verifies every current source against all seven archived source graphs, plus the original favorite manifest and source archive checksums. The two favorite real-corpus indexes still contain 545 assets each; the gallery excludes the 22 controlled fixtures.
- The visual services on ports 8225, 8226 and 8227 return HTTP 200 through `zerotwo`. Real-corpus OpenSearch remains green. The [favorite inspector](http://zerotwo:8227/) remains available after cleanup.
- The second kernel observer stopped normally at 00:37:39 UTC, preserving 4,510 samples and a completion receipt. The original observer ends at 14:48 UTC on September 22 without a completion marker; its recorded window fully covers the completed primary and arrival campaigns.
- Only isolated scale OpenSearch (19217) was stopped, at 00:37:55 UTC. Its Docker volume and every index are retained. Post-shutdown UI and real-node health checks pass. `final-validation.json` and `scale-stop.log` record the checks. No performance, audit or cleanup work remains pending.

See [FAVORITE-SNAPSHOT.md](FAVORITE-SNAPSHOT.md) for the user's endorsement, [HUE-TOLERANCE.md](HUE-TOLERANCE.md) for accuracy, and [CUTOFF-SCALE.md](CUTOFF-SCALE.md) for earlier tests of different measurements and profiles.
