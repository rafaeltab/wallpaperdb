# Bounded-query transport diagnosis

The interrupted full-million screen retained successful earlier profiles and
thousands of `fetch failed` errors during maxima C16. Its old failure records
omitted nested causes and executor stages. The original screen remains failed
and incomplete.

This separate runner measures connection behavior while executing the unchanged
bounded/maxima scorer. It performs no index writes or retries. These instrumented
runs are diagnostics, not replacement capacity results.

## A/B difference

- **fetch:** every executor request uses the existing `service.api` and global
  fetch implementation.
- **pooled-delete:** only PIT cleanup uses native `http.request` with a keep-alive
  agent. Route, DELETE method, JSON body, response validation and abort budget
  remain the same. Search and PIT-create requests still use `service.api`.

Each query keeps the original 1,500ms total deadline and executor cleanup reserve.
The observation interval stops new admissions; already admitted work drains under
its original deadline. The default error budget stops admission after 32 failed
queries, retaining any additional failures from work already in flight.

The installed Node 22.22.3 / Undici 6.24.1 code resets a connection after a
DELETE request body by default. That explains a plausible source of connection
churn; it does not by itself prove why the earlier connection errors occurred.
See the versioned [Undici implementation](https://github.com/nodejs/undici/blob/v6.24.1/lib/dispatcher/client-h1.js)
and [HTTP agent documentation](https://nodejs.org/download/release/v22.22.3/docs/api/http.html#class-httpagent).

## Evidence

The runner saves a source snapshot, receipt hash, before/after index UUID and
count, fixed query and controls, all compact trial outcomes, nested error chains,
and executor failure evidence. It preserves complete request traces for the first
32 successful queries, every 1,000th query, and every failed query. Writes use
64KiB buffers. Aggregate stage/header/socket counters cover all executor traffic.

Passive [Undici diagnostics channels](https://github.com/nodejs/undici/blob/v6.24.1/docs/docs/api/DiagnosticsChannel.md)
capture request/response Connection headers and socket reuse/closure. The native
DELETE observer captures response headers and sockets; it does not inspect its
generated request headers on the wire. Missing channel observations remain
visible in the counters.

Every second, a separate keep-alive control connection records OpenSearch HTTP,
PIT, process, heap and search counters. Optional `ss` observations count host TCP
endpoint states for port 19217. They do not expose all Docker/NAT connection state.
HTTP deltas include control/background traffic. Missing before/after HTTP samples
make `httpEvidenceComplete` false and prevent a connection-counter conclusion.

Compare achieved query and connection-creation rates as well as error counts.
Instrumentation can lower throughput: a baseline that fails to reproduce the
original error is insufficient to prove the pooled transport fixes it. The first
successful 20-hit list and all subsequent hit hashes allow an A/B score check.

## Reproduction

Root orchestrates live service runs serially. Keep fresh output directories and
observe quiescence/TIME_WAIT between variants. The Makefile changed only to add
these diagnostic targets; old immutable campaign plans and failed artifacts stay
unchanged.

```sh
make color-favorite-transport-diagnostic-test
make color-favorite-transport-diagnostic COLOR_FAVORITE_ARGS='--directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/transport-maxima-fetch-v1 --method maxima --transport fetch --concurrency 16 --duration-seconds 60 --stop-errors 32 --maximum-requests 100000 --tcp true'
```

After the first run and a separate settling observation:

```sh
make color-favorite-transport-diagnostic COLOR_FAVORITE_ARGS='--directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/transport-maxima-pooled-v1 --method maxima --transport pooled-delete --concurrency 16 --duration-seconds 60 --stop-errors 32 --maximum-requests 100000 --tcp true'
```

Use `--method bounded` with fresh directories for the parent executor. Observation
durations can be 1–300 seconds, concurrency 1–32, and at most 100,000 queries. A
completed run with any query error or latency at/above one second exits 1 while
preserving its evidence. `completed` describes diagnostic completion;
`strictPassed` describes the query failure rule. Neither is a capacity approval.
