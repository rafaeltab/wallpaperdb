# Gateway test performance

Measured on 2026-09-15 against main `c58a91a` and the initial Effect migration `eeeccaa`. The optimized full coverage suite is **66.6% faster than main** and **83.9% faster than the initial migration**, while retaining all existing scenarios.

## Repeated measurements

Three measured runs per mode, following an excluded warmup. Times include fresh service startup, tests, any build invoked by a test, coverage reporting when enabled, and fixture disposal.

| Median | Main | Initial migration | Optimized |
| --- | ---: | ---: | ---: |
| Full suite with coverage | 37.37 s | 77.87 s | **12.50 s** |
| Full suite without coverage | 36.92 s | 75.69 s | **12.11 s** |
| Host CPU, with coverage | 4.48 CPU-s | 20.91 CPU-s | 12.70 CPU-s |
| Observed Docker CPU, with coverage | 40.44 CPU-s | 89.29 CPU-s | 26.27 CPU-s |
| Peak host aggregate RSS, with coverage | 322.61 MiB | 493.07 MiB | 692.93 MiB |
| Peak Docker working set, with coverage | 1591.50 MiB | 1509.27 MiB | 1568.00 MiB |
| Passing tests | 151 | 237 | **239** |
| Skipped tests | 1 | 0 | **0** |

Optimized coverage runs: 12.36, 12.50 and 13.88 seconds. Runs without coverage: 13.74, 11.74 and 12.11 seconds. All six runs passed every test.

| Coverage | Main benchmark | Initial migration | Optimized, every measured run |
| --- | ---: | ---: | ---: |
| Statements / lines | 89.72% | 99.39% | 99.39% |
| Branches | 87.46% | 96.32–96.33% | 97.18% |
| Functions | 96.74% | 99.31% | 99.31% |

The original migration's recorded branch coverage floor remains 87.50%; none of the configured thresholds or source exclusions were reduced. Coverage continues to include every `src/**/*.ts` file except test/declaration files.

## What changed

- One suite-owned OpenSearch server replaces four startups. Each fixture owns unique indices and deletes only its namespace, including closed indices. Broker state and application instances remain private. Search-only contracts no longer start NATS.
- NATS uses bounded HTTP and protocol readiness checks. The old setup added a fixed two-second wait; Docker also delayed its first health probe by about five seconds even though NATS was already ready.
- Two worker threads reuse loaded modules. The OpenTelemetry bootstrap test runs in an isolated process because SDK shutdown leaves instrumentation hooks installed.
- An isolated malformed-document fixture removes a test-order dependency found by shuffled execution. Seeds 215 and 42 pass. A new regression verifies same-ID data isolation and cleanup between fixtures on the shared search server.
- Optional `OPENSEARCH_PROFILE_INDEX` lets composition select an independent Profile index; its existing `profiles` default is preserved.

The resulting suite starts one OpenSearch, three private NATS servers and one Redis server. Every invocation starts fresh infrastructure; there is no persistent container reuse or test-result caching in these measurements.

## Resource tradeoff

Docker CPU fell by 35% versus main and 71% versus the initial migration. Host CPU fell by 39% versus the initial migration, but remains above main. Peak host memory increased as loaded modules and two workers coexist. Docker memory is roughly unchanged.

For lower worker memory, run:

```sh
make gateway-test-coverage GATEWAY_TEST_ARGS='--maxWorkers=1'
```

A preliminary one-worker experiment took 16.86 seconds with a 509 MiB host RSS peak. That was one run before the final instrumentation split and malformed-data fix; it establishes a tuning option, not a second repeated benchmark.

## Method and reproduction

The same host, collector, Make recipes, coverage reporters and OpenSearch/NATS image IDs were used for all three revisions. Host: Ryzen 9 9955HX, 32 logical CPUs, approximately 28.5 GiB RAM, Linux 7.0.0-27-generic, Node 22.22.3, Vitest 3.2.4, Testcontainers 11.11.0 and Docker 29.1.3.

The benchmark invoked these recipes through Make from `apps/gateway`, bypassing Turbo's test cache:

```make
test:
	./node_modules/.bin/vitest run
coverage:
	./node_modules/.bin/vitest run --coverage --coverage.reporter=text --coverage.reporter=json-summary
```

Installation and prerequisite builds were outside timing. The built-service smoke test's own `make gateway-build` remains inside timing. Main's automatic service cleanup occurs after command exit; optimized fixture cleanup occurs inside the command. Remaining Ryuk helper cleanup was awaited outside timing before starting the next run.

GNU time measures command wall time and host CPU. Host aggregate RSS is sampled every 0.2 seconds; Docker CPU and working set every 0.5 seconds. Preexisting containers and the collector are excluded. Docker CPU is a sampled lower bound: Redis was missed entirely in three optimized runs, one observed Redis lacked a CPU sample, and one stats request raced container removal and returned HTTP 404. Independent memory peaks must not be added as a simultaneous total.

Raw logs, samples, environment details, coverage counts and source fingerprints are archived in `gateway-optimized-2026-09-15`, alongside the earlier baseline archives. The measured checkout was based on `eeeccaa`, with tracked patch SHA-256 `b818f4afcfcdce9df6ed84feb7ac2676cfd152ac34da8488a7090f9402df0b7c` and separately recorded new-file hashes. This comparison measures complete suite cost on this host; it does not isolate Effect overhead or promise identical timings on CI hardware.

## Effect 4 continuation, September 16

The Effect 4 migration preserves the shared search fixture, worker reuse, and separate instrumentation process. It expands the suite from 239 to 271 tests, including cancellation, Redis recovery, transport draining, and startup failure coverage. Fresh `make gateway-test-coverage` runs completed in 15.16 and 14.94 seconds; the same suite took 28.59 seconds during concurrent repository CI work. All tests passed. These are validation observations with other local services running, not a new repeated CPU/memory benchmark. The earlier benchmark remains evidence for its recorded revision rather than a performance claim about Effect 4.

The subsequent `@effect/vitest` adoption moves only the gateway to Vitest 5.0.1 and expands failure coverage to 276 tests. A full coverage run completed in 17.97 seconds, and the run during parallel repository CI took 30.40 seconds. Both passed with the original thresholds. This is a validation observation, not a controlled comparison of Vitest versions; source remapping and the behavioral matrix changed. The shared search fixture, two-worker limit, module reuse, and isolated instrumentation process remain.
