# Throwaway Redis fixture prototype

This draft answers [issue #435](https://github.com/rafaeltab/wallpaperdb/issues/435): does one group-owned Redis container simplify repeated lifecycle work while preserving case isolation? Adoption requires a separate decision. Default tests, Make/Turbo/CI behavior, and the production test-builder API stay unchanged.

Run from the repository root with Docker available. These commands share the repository's Docker validation lock.

```sh
# Complete opt-in prototype, including the matched comparison.
flock -w 900 /tmp/wallpaperdb-perf-validation.lock \
  make prototype-redis

# Find retained measurements if Vitest suppresses successful console output.
ls -t /tmp/wallpaperdb-redis-prototype-*/samples.json

# Run the assertion-failure and overlapping-ownership demonstration alone.
flock -w 900 /tmp/wallpaperdb-perf-validation.lock \
  make prototype-redis ARGS='-t "cleans a failed case"'

# Unchanged original Redis suite, including its independent contracts.
flock -w 900 /tmp/wallpaperdb-perf-validation.lock \
  make test-focused PACKAGE=test-utils ARGS='tests/redis.test.ts'
```

The opt-in command and its configuration are defined in the [Makefile](../../../Makefile) and [prototype config](vitest.config.ts). Additional Vitest filters pass through `ARGS`.

## Scope and ownership

The pilot covers SET/GET, hashes, lists, expiration, and pub/sub from the [original suite](../tests/redis.test.ts). Both measured approaches execute the same operation assertions with unique case keys/channels and bounded polling for expiration and message delivery. Only container ownership changes.

The measured baseline adapts those five cases to the same scoped cleanup and bounded observations as the pilot. The unchanged original suite runs separately as compatibility validation with its existing keys, waits, and retry policy.

```mermaid
flowchart LR
  subgraph baseline[Baseline: repeat for each of five cases]
    direction TB
    B1[Case starts and awaits its container]
    B2[Case owns command client and keys]
    B3[Pub/sub case also owns subscriber and channel]
    B4[Close case scope, unsubscribe, delete keys, close clients]
    B5[Verify no owned Redis resources, then stop container]
    B1 --> B2 --> B3 --> B4 --> B5
  end
  subgraph pilot[Pilot: one group owns the container]
    direction TB
    P1[Group starts and awaits one container]
    P2[Each case owns its clients and unique keys/channels]
    P3[Pub/sub case owns its subscription]
    P4[Each case closes its scope, unsubscribes, deletes keys, closes clients]
    P5[Group awaits cases, verifies Redis resources, stops container]
    P1 --> P2 --> P3 --> P4 --> P5
  end
```

[fixture.ts](fixture.ts) contains the sample owner. A case closes its scope before cleanup starts. Retained callbacks cannot acquire keys, channels, or subscriptions or reopen clients after that case ends, even while a peer remains active. Cleanup attempts every release despite earlier errors. One deadline covers each case's unsubscribe, key deletion, and client closure. A stalled graceful QUIT ends with forced disconnection.

Group shutdown fixes one aggregate deadline at entry. It allows the configured Redis window, then five seconds of Docker grace. Stopping reserves 2.5 seconds for removal and verification; removal reserves the final 500 ms for verification. Docker calls use actual HTTP AbortSignals through the runtime selected by Testcontainers. Each stage preserves earlier errors and attempts the next stage.

On normal completion, the group audits keys, subscriptions, and named Redis clients before stopping Redis, then verifies container removal. On failure it force-closes clients and attempts owned-container removal. An unavailable daemon can prevent removal; the returned errors identify the owned container and the failed Docker operation. Container removal does not prove that an earlier Redis audit passed. Shared cases must never call `withRedisAutoCleanup()`, which executes `FLUSHALL`.

Creation/readiness, custom image/configuration, network/alias, endpoints, destruction, and pre-setup/error contracts retain their independent fixtures in the original suite. OpenSearch, network restoration, Ryuk regressions, and Docker endpoint portability are outside this pilot.

## Validation and measurement

[comparison.test.ts](comparison.test.ts) demonstrates independent execution, reordered cases, overlapping ownership, and cleanup after an intentional assertion failure. The overlapping survivor must keep its data and subscription after the failed case releases its own resources. Cleanup checks run before container teardown so stopping Redis cannot hide a leak.

[shutdown.test.ts](shutdown.test.ts) covers finished case scopes, detached subscription acquisition, a stuck callback, and real Redis sockets stalled during QUIT, DEL, unsubscribe, or observer verification. [docker-shutdown.test.ts](docker-shutdown.test.ts) stalls actual HTTP stop/removal requests and an incomplete list response. It checks cancellation, continued cleanup, preserved Redis errors, and closed sockets. Healthy runs separately verify actual removal on the real Docker daemon.

The comparison uses one warmup group and five alternating baseline/pilot pairs. Each pair runs the five operations serially. Both approaches use the same cached image, one worker, concurrency one, disabled coverage, and zero retries. The unchanged original suite is separate validation and retains its existing configuration.

Each measurement run retains raw JSON in a private `/tmp/wallpaperdb-redis-prototype-*/samples.json` file, including failed samples. The test emits its path; Vitest may suppress successful console output. Startup/readiness, client setup, operation body, scoped cleanup, verification, container cleanup, and total elapsed time are separate measurements. Expected lifecycle counts per successful sample are five starts/stops for baseline and one start/stop for pilot.

Total elapsed time includes verification. `elapsedWithoutVerificationMs` subtracts the measured Redis and Docker audit time, since baseline audits five groups and pilot audits one. Client setup measures the command client; the pub/sub subscriber connects inside the operation body in both modes. Overlap and failure demonstrations are separate from the serial timing samples.

The [raw samples](evidence/samples.json) and [derived summary](evidence/summary.json) record a fresh run after the case-scope and Docker teardown fixes, measured at `2026-10-21T17:48:10.050Z` on a local Linux Docker host with Node 22.22.3. Both baseline and pilot used the same fixed code at `2ac99ddb7406a8c17a693a8fa0e1470640d5ae67`. Every sample passed. The cached image ID before and after measurement was `sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99`. The source hash `2b7d0157aa3d2b45d290c89bad0aa9676219ec183caa968934d2cc958f8dce30` matches the committed runnable files. These timings compare container ownership within that version of the code.

Medians per five-case sample, in milliseconds:

| Measurement | Baseline | Pilot |
| --- | --- | --- |
| Observed starts / stops / removed containers | 5 / 5 / 5 | 1 / 1 / 1 |
| Closed case clients | 6 | 6 |
| Startup/readiness | 504.39 | 97.48 |
| Command client setup | 5.55 | 3.78 |
| Operation body | 1035.93 | 1026.26 |
| Scoped case cleanup | 1.99 | 1.74 |
| Container cleanup | 1094.85 | 228.11 |
| Redis/Docker verification | 355.25 | 77.78 |
| Total elapsed | 2982.65 | 1427.01 |
| Elapsed excluding verification | 2643.17 | 1350.75 |
| Failed samples / retained samples | 0 / 5 | 0 / 5 |

The pilot's median total was 1555.64 ms lower, or 52.16%. Excluding verification, it was 1292.42 ms lower, or 48.90%. These are differences between medians; the raw record preserves every pair and its order. The operation body still costs about one second, mostly the specified expiration check.

| Pair | Order | Baseline total, ms | Pilot total, ms |
| --- | --- | --- | --- |
| 1 | Baseline, pilot | 3082.61 | 1427.01 |
| 2 | Pilot, baseline | 2944.33 | 1439.74 |
| 3 | Baseline, pilot | 3008.35 | 1422.28 |
| 4 | Pilot, baseline | 2904.91 | 1437.87 |
| 5 | Baseline, pilot | 2982.65 | 1422.68 |

Runtime validation ran 20 isolation and shutdown tests plus one separately selected measurement test. All 21 passed. The unchanged original Redis suite passed 12 tests with its two existing network-related skips. Final local `make ci` passed all 96 tasks in 250 seconds. See the [validation record](evidence/validation.json) for current results and historical regression provenance. This Docker fixture has no browser UI; its runtime evidence is command output and Redis/Docker assertions.

## Risks and recommendation

Shared Redis makes a global command, unscoped key deletion, leaked subscription, or container failure affect other cases. The prototype adds ownership bookkeeping and cleanup verification to constrain those risks. Its evidence covers these five operation cases, not all Redis tests or hosted CI.

An arbitrary JavaScript callback can continue after the fixture stops waiting for it. Case and group closure block later fixture resource acquisition and reopening of retained fixture clients. Existing clients close before owned-container removal is attempted. The fixture cannot cancel unrelated callback work or guarantee container removal while the Docker daemon is unavailable.

The experiment has 385 lines of fixture code, 48 lines of shared operations, 71 lines of isolation demonstrations, 179 lines of Redis shutdown demonstrations, 220 lines of Docker HTTP fault demonstrations, 104 lines of measurement code, and 15 lines of runner configuration. The fixture needs group and case ownership, exact resource tracking, cancellation guards, HTTP request cancellation, and cleanup budgets. That cost needs review alongside the saved container lifecycles.

Keep the draft opt-in for lifecycle and API review. The measurements support further evaluation of reuse for these five cases. Adoption requires a separate decision. Local savings do not establish a shorter PR wait time or show that the whole hosted container-test phase can be removed. The issue's hosted sample measured a 125.1-second container phase inside a 154-second job, already shorter than the 480-second main job; the whole phase is not removable lifecycle overhead.
