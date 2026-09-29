# Gateway active-work load test

## Initial defaults

Use 32 active GraphQL requests per replica and a 5,000 ms request deadline. The [configuration](../src/config.ts) owns the defaults. A request holds its slot through inspection, cost admission, backend execution, and cancellation cleanup. Saturation rejects immediately. These limits remain independent of Redis availability.

At concurrency 32, all measured requests completed without overload. Increasing concurrency to 64 increased expensive-query p95 latency from 67 to 235 ms while reducing healthy throughput from 595 to 511 requests per second. Recovery and outage runs showed the same latency increase. This supports 32 as a conservative initial limit for this local workload, rather than increasing concurrency to chase throughput. The largest observed p99 was 247 ms. A five-second deadline leaves approximately twenty times that latency for transient slowdowns, while cancelling requests before OpenSearch's ten-second transport timeout.

These are initial development defaults, not production capacity certification. Repeat the test on the selected production topology with a representative populated catalogue, response sizes, latency, replica count, and CPU/memory limits before deployment. This experiment does not choose ingress request-rate or body-size limits.

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
