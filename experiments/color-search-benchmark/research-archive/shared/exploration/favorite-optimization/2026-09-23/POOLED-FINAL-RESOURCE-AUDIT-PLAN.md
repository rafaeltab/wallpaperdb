# Final pooled resource attribution and overload diagnosis

Prepared file-only while wide capacity runs. Do not execute scans, tests or resource analysis until root confirms both the wide campaign and any conditional broad-bank stress have stopped. No runtime changes or new service traffic are required.

## Evidence and output boundaries

Use immutable completed artifacts from:

- `full-million-four-methods-pooled-v1/benchmark.json` and its accepted independent audit.
- `full-million-pooled-arrival-fixed-v1/arrival.json` and audit.
- `full-million-pooled-arrival-varied-v1/arrival.json` and audit.
- `full-million-pooled-arrival-wide-v1/arrival.json` and audit.
- Conditional `full-million-pooled-bounded-wide-stress-v1/arrival.json` and audit, only if actually run.
- Each campaign's `plan.json`, archived sources, raw requests and resources; preserve incomplete/error states.
- The fixed `resources-v3` observer files and its source metadata.
- The same completed build status used by `resources-indexing-completed-v1`; indexing stays a separate interval/cost.

Create fresh `resources-pooled-campaigns-completed-v1` and `arrival-overload-file-review-v1` output directories. Preserve prior reports. Hash the exact input bytes, capture a complete immutable observer JSONL prefix, and bind analysis code hashes to output. Do not relabel an incomplete profile as a pass or combine this environment with earlier projection/pilot cohorts.

## 1. Run the existing file-only resource summary

Reuse `resource-summary-v1-proposal/resource_summary.py` with `--observer`, the archived completed `--build-status`, repeated `--campaign` arguments and the new `--directory`. It already:

- Ends interrupted campaigns at `interruption.at` rather than inventory time.
- Includes only observer samples inside each actual phase/profile interval, with explicit boundary gaps/sample coverage.
- Separates cgroup CPU, anonymous memory, file cache, swap, pressure, per-device IO, and entrypoint RSS from JVM heap.
- Invalidates JVM cumulative deltas after node identity changes, counter resets, incomplete collection or missing resource brackets.
- Uses resource bracket duration, not the nominal30/180/600second request duration, for JVM/client mean CPU cores.
- Preserves failed/malformed resource reads and records resident JVM memory as unavailable.

Current observer invocation was independently verified as12hours from13:27UTC; its script default is not the running duration. This is background observation of a shared host, not a production service CPU benchmark.

## 2. Independent recomputation

Use standard-library calculations without importing the summary helper or scorer. Read the immutable observer prefix and archived campaign resource inputs; compare all per-profile interval boundaries and:

- First/last included sample, count, unobserved edges, maximum gap and counter-window coverage.
- Node identity, collection-error inventory and monotone CPU/GC/search-rejection counters.
- JVM process CPU milliseconds, mean cores, heap/nonheap gauges, queue/rejection/merge observations and GC time/count deltas.
- Load-generator CPU microseconds and RSS/heap gauges, separated from the gateway/service concept.
- Cgroup CPU usage/quota/throttle/pressure, memory charge/anon/file/swap/refault/OOM events, host pressure and memory, and each IO device independently.

Never sum layered device counters. Sampled memory maxima need not occur simultaneously. Resource `at` is recorded before awaiting the node-stats response; the actual counters and clientCPU are observed later. Under overload, missing response-end timestamps limit exact boundary attribution. Final arrival stats follow raw-log writing, so their CPU interval includes post-request artifact work. Independent recomputation can verify the stated calculation without making these intervals exact process-isolation measurements.

The helper's compact campaign-resource archive omits latency rows; its audit must also bind the original campaign bytes, rather than treating the compact archive as independently authoritative. Compare equivalent JSON structures and raw-byte hashes separately.

## 3. Diagnose maxima fixed128 and sorted wide16

Do not infer cause from end-to-end maxima alone. Start with raw per-request rows and recompute the exact unions of errors, client rejections and elapsed times at or above1000ms, preserving warmups separately.

For each method/rate/query shape, report request counts, successes, errors, rejections, strict failures, p50/p95/p99/max for:

- `elapsedMs`: scheduled arrival to decoded result/failure.
- `schedulerDelayMs`: intended arrival to dispatch.
- `requestMs`: dispatch through complete orchestration and result/failure.
- Successful `serviceTookMs`: summed OpenSearch search-stage wall times where available.

Verify `elapsedMs - schedulerDelayMs - requestMs` is consistent with the scheduler's two successive monotonic clock reads; do not add component percentiles. Classify strict failures as scheduler-delay alone, request duration alone, both, or only their combined elapsed time. Client rejections have no dispatched request duration and must stay distinct.

Group by exact query ID, mode/target count, chronological ordinal and actual query offset. Fixed uses2single/1two/1five shapes per4requests; varied uses65single/9two/1five per75queries. Equal arrival rates therefore do not imply equal work. Wide uses the actual shuffled plan and observed shape mix; preserve actual utility coverage and cycle position.

For temporal correlation, use `startedAt`/`completedAt` and ordinal/rate to derive approximate scheduled and dispatch times. Check consistency of the inferred origin across rows and flag wall-clock/microtask uncertainty. Overlay request-failure clusters and latency components against the saved resource samples without claiming sub-sample precision.

### Stage evidence limits

Successful timed rows retain aggregate `serviceTookMs`, not full individual HTTP stage traces. Warmups and failed rows retain executor evidence. In those retained rows, inspect stage durations, last completed phase, nested transport causes, native-cleanup attempts/responses/reuse and remaining global-bound evidence. A stage whose request throws before its response may be absent from the stage list: last completed phase is not automatically the failed phase.

`requestMs - serviceTookMs` includes local query/bound compilation, microtask and event-loop scheduling, JSON handling, network waits and PIT administrative requests. It is not a network-only or local-CPU-only measurement. No event-loop delay histogram was recorded, so CPU/GC/pressure correlation can support a hypothesis but cannot prove that cause alone.

Use raw saved node `indices.search` fields (where present) for query/fetch current/total/time and PIT/open-context observations in a small separate drilldown; the existing summary reports only a subset. HTTP connection/FD snapshots were not continuously captured in this campaign. Do not borrow the earlier diagnostic snapshots as proof of this run's onset state.

## 4. Conclusions and follow-up

Separate observed facts from inference:

- Large scheduler delay with modest request duration shows queueing before dispatch; it does not itself identify the competing process or allocation.
- High JVM/cgroup CPU plus search queues/rejections supports service saturation; low average utilization does not exclude short spikes or client stalls.
- High client CPU/heap changes or GC-correlated gaps support coordination overhead, while host pressure/swap/refault data may suggest shared-host contention.
- Low search-stage `took` plus high orchestration wall time points outside measured search execution, but includes several possible components.

Recommend a targeted new diagnostic only if the archived evidence leaves a material uncertainty. Do not alter or restart the frozen capacity run, guess missing successful stage traces, or change the color objective based on one overloaded profile. Report the ordinary bounded method's measured passing workload separately from the methods/workloads that failed.

## Prepared stress scope update

Root subsequently requested a two-method follow-up comparing numeric docvalues and ordinary bounded pooled, without presuming a winner. Its fresh proposal is `full-million-pooled-wide-two-methods-stress-v1-proposal/stress-plan.json`; if launched, use `full-million-pooled-wide-two-methods-stress-v1/arrival.json` and its audit in the final resource inventory. The earlier bounded-only proposal stays preserved and contributes no measurements unless separately run. Maximum timed stress work is12minutes across two candidates, not six.
