# Favorite optimization: final resource and overload review

Recorded 2026-09-23 after all timing ended at 20:32 UTC. This report analyzes saved files only. It does not change the favorite score or any prototype.

## Result

On the full million-document, 6,138-field index, both numeric scoring and ordinary bounded scoring passed the broad query workload at **64 requests/second**. Numeric had the better latency margin; bounded used less OpenSearch CPU. Both failed at 128 requests/second. The saved evidence points to substantial disk/page-cache pressure at 128, with numeric also reaching the eight-core CPU quota. A lower average CPU figure alone does not establish spare query capacity.

These are one-node experiments on a shared host, with one primary, no replicas, a 4 GiB JVM heap and a 12 GiB container memory limit. Documents are synthetic mixtures derived from 523 real images. This is evidence about this environment and workload, not a production service-level guarantee or a 100-million-image result.

## Broad workload: resource cost and latency

Each profile schedules a deterministic broad query sequence for 180 seconds. Each passing profile touches all 6,138 utility keys successfully. The mix includes single-color and multiple-color requests; it is substantially broader than repeatedly querying four favorites. CPU is average occupied cores over the saved resource bracket, not a percentage of one core. RSS belongs to the experiment driver, which retains query plans, results and instrumentation; it is **not a measured production gateway requirement**.

| Method | Requests/s | p95 | Maximum | Strict failures / scheduled | JVM mean cores | Driver mean cores | Driver peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Numeric + doc-value IDs | 64 | 154 ms | 316 ms | 0 / 11,520 | 3.087 | 0.100 | 0.634 GiB |
| Ordinary bounded + pooled cleanup | 64 | 277 ms | 740 ms | 0 / 11,520 | 1.774 | 0.184 | 0.637 GiB |
| Numeric + doc-value IDs | 128 | 1,500 ms | 1,774 ms | 9,465 / 23,040 | 7.757 | 0.131 | 0.600 GiB |
| Ordinary bounded + pooled cleanup | 128 | 1,401 ms | 1,681 ms | 6,368 / 23,040 | 2.035 | 0.349 | 0.752 GiB |

A strict failure is the union of an error, client admission rejection, or elapsed time of at least one second. Rejected requests remain in the scheduled denominator. At 128/s, numeric rejected 1,451 requests and bounded rejected 254. Successful requests covered only 6,132 and 6,116 keys respectively; these failed profiles do not earn complete successful coverage.

At passing 64/s, sampled JVM heap peaks were 2.924 GiB numeric and 2.935 GiB bounded. Container memory-charge peaks were 10.349 and 10.398 GiB: approximately 4.41 GiB anonymous memory and up to 5.70/5.75 GiB file cache, plus other kernel charges. Swap charge was about 1.0 GiB. These gauges peak at potentially different times and must not be added as if they were a simultaneous snapshot. JVM resident memory was not measured separately; the observer's small entrypoint-process RSS is not JVM RSS.

## Why the broad 128/s profiles failed

| Method / rate | Container I/O pressure | Device reads | Major page faults | File-page refaults | Sampled search queue maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Numeric / 64 | 4.45% | 74.24 GB | 376,426 | 18.12 million | 0 |
| Bounded / 64 | 10.33% | 107.63 GB | 842,106 | 26.27 million | 0 |
| Numeric / 128 | 63.63% | 126.54 GB | 715,553 | 30.89 million | 83 |
| Bounded / 128 | 78.90% | 152.29 GB | 1,170,576 | 37.17 million | 85 |

I/O pressure here is the delta of Linux PSI `some.total`, divided by the observed sample interval: time when at least some tasks are stalled on I/O. It is not disk utilization or the fraction of individual requests waiting. [Linux PSI documentation](https://docs.kernel.org/accounting/psi.html) defines this distinction. Read bytes are decimal GB for **one device layer**; `252:0` and `259:0` report the same underlying traffic and must not be summed.

The large reads/refaults and high I/O pressure support disk/page-cache churn as an important bottleneck, especially for bounded128. Numeric128 additionally used 7.76 JVM cores and was CPU-quota-throttled in 79.34% of observed scheduling periods. Bounded128 used 2.04 cores, with only 0.77% of periods throttled. This does not prove a specific disk, field access or external process caused every slow request; per-request page faults and disk attribution were not captured.

The client scheduler stayed largely responsive: scheduler-delay p95 was 1.07 ms numeric and 1.28 ms bounded. Numeric had 7,987 dispatched requests whose request duration alone reached one second; bounded had 6,111. Thus the broad overload is predominantly after dispatch, unlike the stalls below. Bounded recorded 4,908 timeout-abort errors, eight total-deadline errors and three service time-exceeded errors. There were no observed container OOM/OOM-kill increments, old-generation GC events, or search-thread-pool rejection increments in these profiles. Client rejection, service timeout, and thread-pool rejection are different counters.

## Two isolated stalls need careful interpretation

### Maxima, fixed four-query workload, 128/s

This profile failed 2,371/3,840 requests. Maximum client scheduler delay was 4.208 seconds; request duration reached 8.021 seconds. Its JVM CPU averaged only 1.58 cores, while sampled search queue reached 80. Over the sampled 29.26-second window, container I/O pressure was 40.39%, host I/O pressure 68.31%, and container memory pressure 6.70%. There were 33,942 major page faults, 240,846 file refaults and 0.994 GB of reads.

The container file cache fell to a sampled minimum of **0.32 MiB**, despite the container being below its 12 GiB limit. Host available memory fell to 1.25 GiB and host swap was effectively full. These observations support shared-host memory reclamation and I/O stalls as contributors. They prevent attributing the failure solely to maxima's scoring algorithm. JVM young GC totaled 25 ms and old GC stayed zero, which does not explain the multi-second pause; client-runtime pauses were not directly instrumented.

After deadline failures prevented timely PIT cleanup, 117 requests received the explicit OpenSearch limit error for 300 open point-in-time contexts. This is a secondary failure visible in the saved evidence, distinct from the earlier socket-churn defect fixed by pooled DELETE. The experiment retained these failures; it does not qualify maxima at this load.

### Sorted, broad workload, 16/s

All 107 strict failures cluster around requests beginning near **19:49:59 UTC**, with failed completions through **19:50:08 UTC**. Maximum scheduler delay was 4.303 seconds; 53 failed requests had both scheduler and request duration of at least one second. Errors include 70 client aborts, 30 service time-exceeded errors and four service partial-result timeouts.

The observer shows file cache dropping from 421 MiB at 19:49:58.712 to about 1 MiB at 19:50:00.752. Its next sample did not arrive until 19:50:06.658, a 5.91-second gap in the nominal two-second observer. Host I/O-pressure ten-second average rose from 4.93% to 42.84%, and subsequently 58.51%; available host memory bottomed around 1.35 GiB before recovering. The independent observer gap, delayed client scheduling, cache collapse and host pressure all coincide. This supports a host-level disturbance, but does not identify which process caused it or justify discarding the failed profile. The complete profile remains failed.

## What is and is not measured

- Passing broad64 favors numeric for response-time margin and ordinary bounded for CPU cost. It does not establish one universally faster method. Fixed/varied tests have different shape mixes, so their favorable 128/s results cannot replace broad-bank evidence.
- Resource brackets include instrumentation and background node work. The driver samples `at` before awaiting node stats, so counter acquisition can lag the recorded bracket time during overload. Counter windows and uncovered edges are explicit in the saved summary.
- Successful timed requests save aggregate service duration, not every internal stage. Request duration minus service duration includes client execution, transport, parsing, PIT operations and event-loop delays; it is not a network-latency measurement. Error-stage arrays contain completed stages and cannot alone identify the stage where a transport call failed.
- Memory charge, anonymous memory, file cache and swap are separate gauges. Linux describes these in its [cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html). No cgroup memory-limit event during a profile does not rule out host-level memory pressure.
- Indexing is a separate phase in the resource summary. Its preparation, bulk generation, writes and merges must not be reported as query CPU or query I/O. Final query analysis uses only completed profile intervals.

## Reproducible saved evidence

All external paths below are under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/` and are uncommitted artifacts:

- `resources-full-million-pooled-completed-v1/resources-summary.json`: 12,748 archived observer rows, the separate build interval, one concurrency-screen campaign and four arrival campaigns. Adjacent `observer-prefix.jsonl.gz`, `campaign-resource-inputs.json` and copied helper/source files preserve inputs and provenance.
- `resources-full-million-pooled-independent-audit-v1.json`: independent standard-library replay passed **2,490 checks** across the six focused profiles, including raw artifact/source hashes, JVM/client CPU and cgroup resource calculations. Its script is `independent-pooled-resource-audit-v1.py`.
- `arrival-overload-file-review-v1/review.json`: streaming raw-row recount, latency decomposition, query-shape breakdowns, errors and representative stage evidence. Generated by `arrival-overload-file-review-v1.py`; every selected profile's raw request and strict-failure counts were checked against the checkpoint.
- `arrival-overload-file-review-v1/focused-observer-windows.json`: unchanged raw observer samples for the maxima and sorted stalls, bound to the archived observer-prefix SHA256.
- Original campaign folders: `full-million-four-methods-pooled-v1`, `full-million-pooled-arrival-{fixed,varied,wide}-v1`, and `full-million-pooled-wide-two-methods-stress-v1`. Original failed measurements are preserved.

No service queries, configuration changes, extra performance runs or new prototypes were used for this review.
