# Gateway admission load evidence

## Initial defaults

Use 32 active GraphQL requests per replica and a 5,000 ms request deadline. The [configuration](../src/config.ts) owns the defaults. A request holds its slot through inspection, cost admission, backend execution, and cancellation cleanup. Saturation rejects immediately. These limits remain independent of Redis availability.

At concurrency 32, all measured requests completed without overload. Increasing concurrency to 64 increased expensive-query p95 latency from 67 to 235 ms while reducing healthy throughput from 595 to 511 requests per second. Recovery and outage runs showed the same latency increase. This supports 32 as a conservative initial limit for this local workload, rather than increasing concurrency to chase throughput. The largest observed p99 was 247 ms. A five-second deadline leaves approximately twenty times that latency for transient slowdowns, while cancelling requests before OpenSearch's ten-second transport timeout.

These are initial development defaults, not production capacity certification. Repeat the test on the selected production topology with a representative populated catalogue, response sizes, latency, replica count, and CPU/memory limits before deployment. The original experiment below did not choose ingress request-rate or body-size limits. The completed-admission measurements later in this document select conservative starting values and retain the production verification gate.

## Measurement

Measured on 2026-09-29 through the worktree's Caddy ingress and rebuilt gateway, using real OpenSearch and Redis. The shared Linux development host exposed 32 CPUs and 28.5 GiB memory, with other development stacks running. The client used Node 22.22.3. All requests used one client IP. The catalogue contained three wallpapers; the expensive operation requested a page of 100, so this measures query inspection and real search but not full-page response serialization.

The [load script](../scripts/load-admission.mjs) defines the cheap missing-wallpaper lookup and expensive wallpaper search. Each row sends 128 requests. Concurrency is the number of client workers; it is not a claim that every worker reaches backend execution simultaneously. The table includes rejected requests in throughput and latency. All responses were either successful GraphQL responses or `503 GATEWAY_OVERLOADED`; no quota denials or unexpected errors occurred.

| Phase | Query | Concurrency | Requests/s | p95 ms | p99 ms | Overload responses |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| healthy | cheap | 8 | 334 | 47 | 53 | 0 |
| healthy | cheap | 16 | 407 | 70 | 112 | 0 |
| healthy | cheap | 32 | 535 | 167 | 209 | 0 |
| healthy | cheap | 64 | 656 | 177 | 186 | 4 |
| healthy | expensive | 8 | 427 | 26 | 28 | 0 |
| healthy | expensive | 16 | 520 | 38 | 41 | 0 |
| healthy | expensive | 32 | 595 | 67 | 72 | 0 |
| healthy | expensive | 64 | 511 | 235 | 247 | 10 |
| redis-outage | cheap | 8 | 582 | 30 | 31 | 0 |
| redis-outage | cheap | 16 | 739 | 26 | 30 | 0 |
| redis-outage | cheap | 32 | 849 | 43 | 45 | 0 |
| redis-outage | cheap | 64 | 694 | 171 | 180 | 0 |
| redis-outage | expensive | 8 | 658 | 17 | 20 | 0 |
| redis-outage | expensive | 16 | 688 | 30 | 32 | 0 |
| redis-outage | expensive | 32 | 785 | 49 | 56 | 0 |
| redis-outage | expensive | 64 | 766 | 159 | 165 | 3 |
| recovery | cheap | 8 | 697 | 24 | 26 | 0 |
| recovery | cheap | 16 | 822 | 31 | 36 | 0 |
| recovery | cheap | 32 | 865 | 47 | 52 | 0 |
| recovery | cheap | 64 | 885 | 134 | 141 | 7 |
| recovery | expensive | 8 | 651 | 16 | 17 | 0 |
| recovery | expensive | 16 | 736 | 28 | 29 | 0 |
| recovery | expensive | 32 | 729 | 52 | 58 | 0 |
| recovery | expensive | 64 | 704 | 169 | 179 | 12 |

Redis was stopped for the outage run and restarted before the recovery run. This stack layer precedes the bounded local quota implementation in issue #292, so the outage results establish only the independent active-work limit. Repeat the outage run after that layer to evaluate local quota denials as well. Redis and the application were healthy after the experiment.

## Reproduction and cancellation checks

Run the gateway package's `load:admission` script through the shared Make `run` target. Its positional arguments are the GraphQL endpoint URL, the number of requests per row, and a phase label. The package script and [Makefile](../../../Makefile) are the command sources. For this run, those arguments were `http://localhost:8470/gateway/graphql 128 healthy`, then the same endpoint/count with `redis-outage` and `recovery`. Use an isolated development stack for the outage phase and restore its Redis container afterward. Allow the shared bucket to refill between larger runs so quota exhaustion does not obscure active-work measurements.

The [HTTP lifecycle tests](../test/http-lifecycle.test.ts) separately exercise blocked backend work, a shortened configurable deadline, delayed cancellation finalizers, client disconnect, replica independence, and shutdown grace. They verify that timed-out work is interrupted, charged cost is retained, capacity remains occupied until cleanup settles, later nested resolvers do not execute after cancellation, and capacity recovers. Socket-based tests are the demonstration for this backend-only behavior; a browser video cannot establish cancellation or outstanding backend work.

## Completed admission and ingress measurements

Repeated on 2026-09-29 after shared usage telemetry and local fallback were implemented, using gateway commit `9ce8c53f` and the same Caddy endpoint, real Redis/OpenSearch, and three-wallpaper fixture. The host had approximately 18 GiB available memory after unrelated worktree application containers were stopped. No build or test suite ran during collection. Only Gateway and its dependencies were needed for these operations. This is a small-fixture development experiment, not a populated-catalogue or production capacity test.

All rows used one client IP, so concurrent workers also exercise shared-IP contention. Each row sent 128 requests. The completed cheap query envelope was 80 bytes and the expensive envelope was 90 bytes. Rejected requests remain in reported throughput and latency; high denial throughput is not successful backend throughput. The load script now reports status/code counts, current cost limits, and client concurrency to make that distinction visible.

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
| 200 | 4 / 13 | 6 / 8 | 200–201 |

Use the following conservative initial deployment settings, subject to the production verification below:

| Control | Initial value | Evidence and tradeoff |
| --- | --- | --- |
| Active GraphQL work | 32 per replica | At 32, all healthy/recovered requests succeeded. At 64, latency rose and overload responses appeared. |
| Request deadline | 5,000 ms | The original maximum p99 was 247 ms and the completed run maximum was 221 ms. Five seconds allows about twenty times the original p99, while bounding requests below the ten-second OpenSearch timeout. Cancellation tests verify enforcement. |
| Aggregate raw ingress rate | 100 requests/s per healthy gateway replica, burst at most 32 per replica | Half the highest measured paced rate, well below measured burst throughput. The burst does not exceed a replica's active slots. This does not claim all queries sustain 100/s; quota and active-work rejection remain necessary. |
| Raw ingress rate per trusted IP | 25 requests/s, burst at most 8 across ingress replicas | The lowest paced rate succeeded for both operations. This adds a coarse raw-traffic bound without replacing cost admission. Shared-network fairness and production traffic require retuning. |
| GraphQL body size at ingress | 16,384 bytes | Largest shipped query-only JSON envelope was 674 bytes. This leaves more than 24 times that size for variables and formatting while cutting the observed gateway transport ceiling by a factor of 64. Measure real filter/cursor payloads before deployment. |

The aggregate rate is a deployment budget sized by healthy replica count. An ingress must coordinate or partition it, rather than grant the full budget independently to every ingress instance. A per-IP raw-request limit is shared across the ingress deployment. These raw-rate settings and the 16 KiB body limit are a product-neutral starting contract, not controls installed in local Caddy. Do not claim the ingress contract is enforced until the selected topology passes verification. The rate observations are short bursts, roughly 0.6–5.1 seconds per row, and do not establish sustained rates, populated-page serialization costs, or acceptable production tail latency.

### Body-size probes

The script measured all five shipped web query-only JSON envelopes at 237–674 bytes. It then appended legal JSON whitespace to the cheap request, isolating raw body size from query complexity. Through local Caddy, 1,024, 4,096, 16,384, 16,385, 65,536, and 1,048,576-byte bodies all returned 200. The 1,048,577-byte body returned 413 `BAD_REQUEST`, no quota headers, and a safe error body. Successful probe latency was 2.5–28.0 ms; the rejected probe took 3.0 ms. This finds the current one-MiB gateway transport ceiling and proves local ingress does not implement the selected 16-KiB production bound. It does not measure the memory cost of concurrent oversized bodies, chunked bodies, slow uploads, or GET URI limits.

### Reproduce and verify the deployment

The [package script](../package.json) and [load implementation](../scripts/load-admission.mjs) own invocation and workload definitions. Run through Make, replacing the URL with the isolated stack's endpoint:

```sh
make run PACKAGE=gateway SCRIPT=load:admission ARGS='http://localhost:8470/gateway/graphql 128 healthy burst'
make run PACKAGE=gateway SCRIPT=load:admission ARGS='http://localhost:8470/gateway/graphql 128 paced paced'
make run PACKAGE=gateway SCRIPT=load:admission ARGS='http://localhost:8470/gateway/graphql 128 body-probes bodies'
```

Allow at least one refill period without charged traffic before comparing healthy runs. Repeat burst mode with phase labels `redis-outage` and `recovered`: stop only the isolated stack's Redis container for the former, restore it afterward, and wait until a successful probe's cost-limit header shows the shared capacity before recording recovery. The script deliberately does not stop infrastructure or reset budgets. Preserve output and note host pressure, catalogue population, quotas, replica count, selected limits, and software revision alongside it. Do not run against production without an approved load window.

Before production, repeat cheap and expensive operations with a representative populated catalogue, real browser variables and cursor sizes, realistic shared-IP groups, more than one gateway replica, and resource limits matching deployment. Run sustained and burst phases, not only 128-request samples. Measure successful throughput separately from rejected throughput, backend latency, resident memory, CPU, connections, and deadline cancellations. Exercise Redis outage, quota-command saturation, active-work saturation, local-state capacity, recovery, and client disconnects. Set final rates and body bounds from those results. The [ingress verification contract](../../docs/content/docs/guides/gateway-admission.mdx) adds forged forwarding headers, direct-access restrictions, GET/POST, chunked/oversized bodies, and multiple ingress instances. No production topology has been selected or certified by this work.

## Completed behavior review

The focused tests cover policy and infrastructure guarantees that a small load fixture cannot prove. The final stack runs them as part of `make ci`.

| Guarantee | Evidence boundary |
| --- | --- |
| Weighted admission, fixed inspection penalty, local exhaustion/refill/recovery, bounded retained budgets | [Admission capability tests](../test/unit/admission.test.ts) through controlled quota adapters |
| Selected operation and variables, cache repetition, query limits, spoofed identity, GET/POST, response codes/headers, OpenAPI contract | [GraphQL HTTP contract](../test/graphql-security.test.ts) |
| Atomic shared reservations across replicas, denial without debit, real outage/reconnect, command saturation and deadlines, shared usage counts | [Redis adapter and composition tests](../test/redis.test.ts) against real Redis |
| Separate per-replica active bounds, deadline/disconnect cancellation, retained charge and slots until cleanup, shutdown | [HTTP lifecycle tests](../test/http-lifecycle.test.ts) |
| Production trust and enforcement configuration | [Configuration tests](../test/unit/config.test.ts) |
| One delayed 429 retry, manual 503 retry, cached content and paused pagination | [Web client and component tests](../../web/test) and the preceding web PR's recorded browser journey |
| Cheap/expensive shared-IP bursts, local quota exhaustion, active-work overload, healthy recovery, paced rates and body ceiling | Measurements above |

The parent issue #218 remains open until every child, including web behavior and final verification, has completed review and merged. This report does not close it or imply production deployment approval.
