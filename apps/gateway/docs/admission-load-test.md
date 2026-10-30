# Gateway admission load evidence

## Initial defaults

Use 32 active GraphQL requests per replica and a 5,000 ms request deadline. The [configuration](../src/config.ts) owns the defaults. A request holds its slot through inspection, cost admission, backend execution, and cancellation cleanup. Saturation rejects immediately. These limits remain independent of Redis availability.

At concurrency 32, every measured request completed without overload. At 64, healthy expensive-query p95 rose from 67 to 235 ms while throughput fell from 595 to 511 requests/s. Outage and recovery runs also had higher latency at 64. The maximum p99 was 247 ms; five seconds allows about twenty times that latency while bounding requests below OpenSearch's ten-second transport timeout.

These are development defaults. The completed-admission measurements below select ingress starting values; production requires the representative-load verification described at the end.

## Measurement

Measured on 2026-09-29 through the worktree's Caddy ingress and rebuilt gateway, using real OpenSearch and Redis. The shared Linux development host exposed 32 CPUs and 28.5 GiB memory, with other development stacks running. The client used Node 22.22.3. All requests used one client IP. The catalogue contained three wallpapers; the expensive operation requested a page of 100, so this measures query inspection and real search but not full-page response serialization.

The [load script](../scripts/load-admission.mjs) defines cheap missing-wallpaper lookups and expensive searches. Each row sent 128 requests; client-worker concurrency does not imply simultaneous backend execution. Throughput and latency include rejections. Responses were successful GraphQL or `503 GATEWAY_OVERLOADED`, without quota denials or unexpected errors.

Redis was stopped for the outage run and restarted for recovery. This experiment preceded bounded local quotas in #292 and established only the independent active-work limit. The completed-admission run below includes local exhaustion and recovery.

The [HTTP lifecycle tests](../test/http-lifecycle.unit.test.ts) separately verify interruption on deadline/disconnect, retained charges and occupied slots through cancellation cleanup, no later nested resolvers after cancellation, replica independence and bounded shutdown. Socket tests establish backend cancellation behavior that a browser recording cannot show.

## Completed admission and ingress measurements

Repeated on 2026-09-29 after shared telemetry and local fallback, using commit `9ce8c53f` and the same Caddy endpoint, Redis/OpenSearch and three-wallpaper fixture. The host had about 18 GiB available after nonessential application containers stopped; no builds or tests ran during collection. This small fixture does not establish populated-catalogue capacity.

Each row sent 128 requests from one IP, exercising shared-IP contention. Cheap envelopes were 80 bytes, expensive envelopes 90 bytes. Throughput and latency include rejections; use status counts to distinguish successful backend work.

| Phase | Operation | Client concurrency | Requests/s | p95 ms | p99 ms | 200 | 429 | 503 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Healthy | Cheap | 32 | 622 | 154 | 204 | 128 | 0 | 0 |
| Healthy | Cheap | 64 | 689 | 173 | 183 | 119 | 0 | 9 |
| Healthy | Expensive | 32 | 557 | 72 | 75 | 128 | 0 | 0 |
| Healthy | Expensive | 64 | 565 | 211 | 221 | 114 | 0 | 14 |
| Redis stopped | Cheap | 32 | 763 | 46 | 48 | 128 | 0 | 0 |
| Redis stopped | Cheap | 64 | 740 | 164 | 170 | 127 | 0 | 1 |
| Redis stopped | Expensive | 8 | 718 | 18 | 20 | 75 | 53 | 0 |
| Redis stopped | Expensive | 16 | 1303 | 16 | 23 | 0 | 128 | 0 |
| Redis stopped | Expensive | 32 | 1281 | 37 | 45 | 0 | 128 | 0 |
| Redis stopped | Expensive | 64 | 1068 | 111 | 117 | 1 | 127 | 0 |
| Recovered | Cheap | 32 | 960 | 36 | 40 | 128 | 0 | 0 |
| Recovered | Cheap | 64 | 838 | 142 | 150 | 122 | 0 | 6 |
| Recovered | Expensive | 32 | 713 | 54 | 61 | 128 | 0 | 0 |
| Recovered | Expensive | 64 | 678 | 176 | 187 | 121 | 0 | 7 |

Healthy and recovered concurrency 8 and 16 also admitted every request. All admitted/denied outage responses advertised a 100,000-point limit; healthy and recovered responses advertised 1,000,000. Overload responses had no cost-limit header. The local budget exhausted during expensive traffic and continuous refill later admitted one more request. Every quota/overload denial in this experiment advertised a one-second retry wait.

A run started immediately after the Redis container restarted still used the local bucket while the client reconnected. It was not counted as recovered. A later cheap probe advertised the shared limit, and the recovered measurements above then used that limit throughout. Container startup alone does not establish admission recovery. Redis and Gateway readiness were healthy after the experiment.

### Paced requests and selected ingress defaults

With Redis healthy and the bucket refilled, a separate run paced requests at 25, 50, 100, and 200 requests/s instead of maintaining a worker backlog. Every row sent 128 requests for each operation. All 1,024 requests succeeded, with no 429 or 503. Peak client concurrency was one at rates through 100/s and two at 200/s.

| Offered requests/s | Cheap p95 / p99 ms | Expensive p95 / p99 ms | Measured requests/s |
| ---: | ---: | ---: | ---: |
| 25 | 8 / 13 | 10 / 12 | 25 |
| 50 | 5 / 7 | 9 / 12 | 50 |
| 100 | 5 / 6 | 6 / 8 | 101 |
| 200 | 4 / 13 | 6 / 8 | 200 to 201 |

Use the following conservative initial deployment settings, subject to the production verification below:

| Control | Initial value | Evidence and tradeoff |
| --- | --- | --- |
| Active GraphQL work | 32 per replica | At 32, all healthy/recovered requests succeeded. At 64, latency rose and overload responses appeared. |
| Request deadline | 5,000 ms | The original maximum p99 was 247 ms and the completed run maximum was 221 ms. Five seconds allows about twenty times the original p99, while bounding requests below the ten-second OpenSearch timeout. Cancellation tests verify enforcement. |
| Aggregate raw ingress rate | 100 requests/s per healthy gateway replica, burst at most 32 per replica | Half the highest measured paced rate, well below measured burst throughput. The burst does not exceed a replica's active slots. This does not claim all queries sustain 100/s; quota and active-work rejection remain necessary. |
| Raw ingress rate per trusted IP | 25 requests/s, burst at most 8 across ingress replicas | The lowest paced rate succeeded for both operations. This adds a coarse raw-traffic bound without replacing cost admission. Shared-network fairness and production traffic require retuning. |
| GraphQL body size at ingress | 16,384 bytes | Largest shipped query-only JSON envelope was 674 bytes. This leaves more than 24 times that size for variables and formatting while cutting the observed gateway transport ceiling by a factor of 64. Measure real filter/cursor payloads before deployment. |

Coordinate or partition the aggregate budget by healthy Gateway replica count; each ingress instance cannot grant it independently. Share the per-IP limit across ingress replicas. Local Caddy enforces neither these rates nor the 16 KiB body limit. Rows lasted only 0.6 to 5.1 seconds, so they establish neither sustained rates nor populated-page costs or production tail latency.

### Body-size probes

The script measured all five shipped web query-only JSON envelopes at 237 to 674 bytes. It then appended legal JSON whitespace to the cheap request, isolating raw body size from query complexity. Through local Caddy, 1,024, 4,096, 16,384, 16,385, 65,536, and 1,048,576-byte bodies all returned 200. The 1,048,577-byte body returned 413 `BAD_REQUEST`, no quota headers, and a safe error body. Successful probe latency was 2.5 to 28.0 ms; the rejected probe took 3.0 ms. This finds the current one-MiB gateway transport ceiling and proves local ingress does not implement the selected 16-KiB production bound. It does not measure the memory cost of concurrent oversized bodies, chunked bodies, slow uploads, or GET URI limits.

### Reproduce and verify the deployment

The [package script](../package.json) and [load implementation](../scripts/load-admission.mjs) own invocation and workload definitions. Run through Make, replacing the URL with the isolated stack's endpoint:

```sh
make run PACKAGE=gateway SCRIPT=load:admission ARGS='http://localhost:8470/gateway/graphql 128 healthy burst'
make run PACKAGE=gateway SCRIPT=load:admission ARGS='http://localhost:8470/gateway/graphql 128 paced paced'
make run PACKAGE=gateway SCRIPT=load:admission ARGS='http://localhost:8470/gateway/graphql 128 body-probes bodies'
```

Allow at least one refill period without charged traffic before comparing healthy runs. Repeat burst mode with phase labels `redis-outage` and `recovered`: stop only the isolated stack's Redis container for the former, restore it afterward, and wait until a successful probe's cost-limit header shows the shared capacity before recording recovery. The script deliberately does not stop infrastructure or reset budgets. Preserve output and note host pressure, catalogue population, quotas, replica count, selected limits, and software revision alongside it. Do not run against production without an approved load window.

Before production, repeat cheap and expensive operations with a representative populated catalogue, real browser variables and cursor sizes, realistic shared-IP groups, more than one gateway replica, and resource limits matching deployment. Run sustained and burst phases, not only 128-request samples. Measure successful throughput separately from rejected throughput, backend latency, resident memory, CPU, connections, and deadline cancellations. Exercise Redis outage, quota-command saturation, active-work saturation, local-state capacity, recovery, and client disconnects. Set final rates and body bounds from those results. The [ingress verification contract](../../docs/content/docs/guides/gateway-admission.mdx) adds forged forwarding headers, direct-access restrictions, GET/POST, chunked/oversized bodies, and multiple ingress instances. No production topology has been selected or certified by this work.

## Contract verification

`make ci` runs the focused contracts that this small load fixture cannot prove:

- [Admission capability](../test/unit/admission.unit.test.ts): weighted charges, inspection penalty, local exhaustion/refill/recovery and bounded state.
- [GraphQL HTTP](../test/graphql-security.unit.test.ts): selected operations/variables, cache repetition, query limits, spoofed identity, GET/POST, status codes, headers and OpenAPI.
- [Real Redis](../test/redis.integration.test.ts): atomic reservations, denial without debit, outage/reconnect, saturation, deadlines and usage counts.
- [HTTP lifecycle](../test/http-lifecycle.unit.test.ts): replica bounds, cancellation, retained charges/slots and shutdown.
- [Configuration](../test/unit/config.unit.test.ts): production trust and enforcement requirements.
- [Web tests](../../web/test): one delayed 429 retry, manual 503 retry, cached content and paused pagination.
