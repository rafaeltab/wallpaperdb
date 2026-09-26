# Tag service Effect migration

Base: `e8c07dd4faf254b303d92d86169ae819435632ff` on `t3code/migrate-tag-service-effect`.

## Scope

Migrate only the existing service skeleton to Effect and the current coding guidelines. No tag routes, schema, events, consumers, outbox, or domain policy. PostgreSQL remains a lazy pool; NATS connects at startup but creates no streams or consumers.

## Preservation contract

| Contract | Existing behavior | Evidence planned |
| --- | --- | --- |
| Health | database, nats, otel checks; healthy when all pass, degraded when mixed, unhealthy when none pass; ISO timestamp and duration | Availability and HTTP contracts, real dependency probes |
| Health status | Healthy and degraded return 200; unhealthy/shutdown return 503 | Exact HTTP responses |
| Shutdown health | Empty checks, no dependency work | Availability contract |
| Readiness | 200 only after startup and before shutdown, otherwise 503 with reason; independent of live dependency health | Availability and HTTP contracts |
| Telemetry health | Healthy when disabled or in test, otherwise reflects SDK initialization | Composition tests |
| Public routes | /health, /ready, /documentation; /tags remains absent | HTTP and generated OpenAPI contracts |
| Configuration | Port 3008, development mode, NATS stream WALLPAPER and service name tags defaults; database and NATS URLs required | Explicit config assertions |
| Deployment | Built Node entrypoint on 0.0.0.0, SIGINT/SIGTERM cleanup | Built-process smoke test |
| Persistence and messaging | No tables, writes, publications or consumers | Existing empty schema and no new domain implementation |

Intentional corrections: use stable Problem Details for HTTP errors, including 503 health/readiness; anchor development CORS to actual loopback origins; reject malformed ports and invalid protocols before startup; remove global DI state; release resources on partial startup/listen failure; bound and cancel health work; mark shutdown before draining and bound request drain; initialize telemetry before instrumented imports. Degraded health retains HTTP 200 for compatibility. Defects return a safe 500 rather than vendor details.

## Baseline

`make test-focused PACKAGE=tags ARGS='--coverage'`: 2 passing tests. Both use a casted HealthService stub and establish only GET /health=200 and GET /tags=404. Those checks will move to public HTTP tests without the cast.

`make crap PACKAGE=tags`: maximum 90.000 at createApp, complexity 9 with 0% coverage. Existing tests provide no real connection or lifecycle evidence.

## Increments

1. Add Effect dependencies and availability port, with tests of existing health/readiness policy.
2. Replace HTTP and config boundaries, preserving success contracts and documenting error corrections.
3. Add scoped PostgreSQL/NATS adapters and real infrastructure contracts.
4. Wire process lifetime and telemetry; remove obsolete DI and route/service wrappers.
5. Verify deployment, generated OpenAPI, architecture, coverage and CRAP; update service docs.
6. Run independent Standards, Spec, and deeper reviews against the fixed base. Fix valid findings in focused tested commits and repeat until clear.
7. Run full CI, publish PR with operational evidence and record any limits.

## Validation and review log

Record completed tests, red/green evidence, review findings and delivery here as work progresses.

### Implementation evidence

- Availability: failing public-port tests added before healthy, mixed/unhealthy, shutdown, and readiness implementations. Eight tests cover the policy without infrastructure.
- HTTP: red/green cycles for contracts, unavailable health/readiness, safe errors, CORS, and OpenAPI. The two old casted route tests are replaced by exact public HTTP assertions.
- Configuration: explicit-environment default test failed before removing global reads; invalid port and protocol tests failed before stricter parsing. Defaults and configured values remain explicit literals in tests.
- Dependencies: real PostgreSQL and NATS without JetStream. A stalled SELECT test originally took 5003 ms against a 1000 ms limit, then passed with client destruction on interruption. Scope disposal removes database sessions and NATS connections. No schema or stream is needed.
- Telemetry: the production composition test failed on incoming trace identity before the HTTP bridge. Removing only the production tracer or Effect metric producer fails the corresponding mechanism test. A stalled-collector test demonstrated that timeout-only shutdown leaked sockets; owned HTTP agents close them.
- HTTP lifecycle: a real network request hung before the shutdown timer and passed after the deadline interrupted its Effect and closed sockets. A separate real request completes inside the grace period before dependencies close. Injection-only tests are insufficient for this transport guarantee.

### First independent review

The code-review skill reviewed the full diff from the fixed base in separate Standards and Spec agents. A third independent agent used the user's deeper review prompt.

- Standards: one P2 finding. Telemetry initialization/shutdown warnings discarded actionable diagnostic context. A safe diagnostic mechanism is being added without exposing endpoint credentials.
- Spec: one P2 finding. Fastify's default closing response bypassed Problem Details. A real TCP test held one health request open, began shutdown, and pipelined a second request. It reproduced the plain JSON 503. Commit `4cd68677` lets the operational handlers translate shutdown state, with exactly one dependency probe.
- Deeper review: three findings, including the same closing-response defect. The production Dockerfile overwrote newer tags OpenTelemetry dependencies with older Core versions; a real image regression is being added. An inherited TLS downgrade allowed `tls://` URLs to use plaintext NATS; commit `95da02cb` requires encryption. The real broker test failed before the fix and passes afterward.

### Repository validation so far

`make check PACKAGE=tags` passes build, lint, TypeScript and architecture enforcement. The built executable tests found and drove fixes for the OpenAPI runtime dependency and successful signal shutdown exit status. `make check-crap PACKAGE=tags CRAP_THRESHOLD=30` reports zero functions above 30; the first post-migration report has maximum 12.000, down from 90.000. Child-process execution and the shared callback/generator attribution limitation mean line coverage and CRAP are supplementary evidence.

The first full `make ci` passed all 74 build/lint/type/unit/integration tasks. Browser E2E then reported that the local application stack was absent. The stack was started afterward. PostgreSQL required a readable temporary copy of public initialization SQL at `/tmp/tags-validation-infra/postgres-init`, mounted through a local Compose override. No tracked infrastructure files or persistent volumes were deleted. Final CI and review results follow after the remaining fixes.
