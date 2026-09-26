# Tag service Effect migration

Base: `e8c07dd4faf254b303d92d86169ae819435632ff` on `t3code/migrate-tag-service-effect`.

## Scope

Migrate only the existing service skeleton to Effect and the current coding guidelines. No tag routes, schema, events, consumers, outbox, or domain policy. PostgreSQL remains a lazy pool; NATS connects at startup but creates no streams or consumers.

## Preservation contract

| Contract | Existing behavior | Evidence |
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

The following records the completed behavioral checks and independent review loops.

### Implementation evidence

- Availability: failing public-port tests added before healthy, mixed/unhealthy, shutdown, and readiness implementations. Eight tests cover the policy without infrastructure.
- HTTP: red/green cycles for contracts, unavailable health/readiness, safe errors, CORS, and OpenAPI. The two old casted route tests are replaced by exact public HTTP assertions.
- Configuration: explicit-environment default test failed before removing global reads; invalid port and protocol tests failed before stricter parsing. Defaults and configured values remain explicit literals in tests.
- Dependencies: real PostgreSQL and NATS without JetStream. A stalled SELECT test originally took 5003 ms against a 1000 ms limit, then passed with client destruction on interruption. Scope disposal removes database sessions and NATS connections. No schema or stream is needed.
- Telemetry: the production composition test failed on incoming trace identity before the HTTP bridge. Removing only the production tracer or Effect metric producer fails the corresponding mechanism test. A stalled-collector test demonstrated that timeout-only shutdown leaked sockets; owned HTTP agents close them.
- HTTP lifecycle: a real network request hung before the shutdown timer and passed after the deadline interrupted its Effect and closed sockets. A separate real request completes inside the grace period before dependencies close. Injection-only tests are insufficient for this transport guarantee.

### First independent review

The code-review skill reviewed the full diff from the fixed base in separate Standards and Spec agents. A third independent agent used the user's deeper review prompt.

- Standards: one P2 finding. Telemetry initialization/shutdown warnings discarded actionable diagnostic context. Commit `6ec07d3b` retains bounded diagnostic fields and redacts URLs, credentials, and query values. Disabling redaction makes the privacy regression test fail.
- Spec: one P2 finding. Fastify's default closing response bypassed Problem Details. A real TCP test held one health request open, began shutdown, and pipelined a second request. It reproduced the plain JSON 503. Commit `4cd68677` lets the operational handlers translate shutdown state, with exactly one dependency probe.
- Deeper review: three findings, including the same closing-response defect. The production Dockerfile overwrote newer tags OpenTelemetry dependencies with older Core versions. The real-image regression observed zero exported traces despite healthy telemetry, then passed after commit `09acb3c2` removed that overlay. An inherited TLS downgrade allowed `tls://` URLs to use plaintext NATS; commit `95da02cb` requires encryption. The real broker test failed before the fix and passes afterward.

### Subsequent independent reviews

The second Standards and Spec passes had zero findings. The deeper review found one additional P2 defect: Node HTTP parser errors bypassed Problem Details. Commit `13b00348` translates malformed requests, oversized headers, and timeouts to safe 400, 431, and 408 responses. Raw TCP tests reproduced the previous malformed-request and oversized-header bodies and pass after the fix. The timeout mapping was reviewed but has no dedicated socket regression test.

The final full-diff review against `e8c07dd4` through `13b00348` reports zero Standards findings, zero Spec findings, and zero deeper-review findings. Reviewers checked the final image-test cleanup correction in `c31c0849` as well. These are review results, not proof that no defects exist.

### Repository validation

`make check PACKAGE=tags` passes build, lint, TypeScript and architecture enforcement. The built executable tests found and drove fixes for the OpenAPI runtime dependency and successful signal shutdown exit status. The final `make check-crap PACKAGE=tags CRAP_THRESHOLD=30` reports zero of 35 functions above 30. `make crap PACKAGE=tags` reports a maximum of 12.000, down from 90.000. All production source remains in coverage scope. Child-process execution and the shared callback/generator attribution limitation tracked in issue #217 mean line coverage and CRAP are supplementary evidence.

The first full `make ci` passed all 74 build/lint/type/unit/integration tasks. Browser E2E then reported that the local application stack was absent. The stack was started afterward. PostgreSQL required a readable temporary copy of public initialization SQL at `/tmp/tags-validation-infra/postgres-init`, mounted through a local Compose override. No tracked infrastructure files or persistent volumes were deleted.

A later run found an unsafe cleanup pattern in the new image test. Commit `c31c0849` moves cleanup into the test runner's completion hook, retaining original failures and reporting cleanup failures separately. After that fix, all 74 main tasks and all three browser tests passed. Shared test-utils E2E then failed because its default socket is Docker Desktop's absent socket. `GITHUB_ACTIONS=true` selects the existing Linux socket path without changing tests or assertions.

Final `GITHUB_ACTIONS=true make ci` passed. It completed all 74 build/lint/type/unit/integration tasks and all 11 E2E/dependency tasks, with 69 and 6 task-cache hits respectively. The CI runner reported 215 seconds excluding prerequisite checks. Tags has 66 unit tests, 11 integration tests, and one production-image E2E test, all passing. The existing browser suite passed all three tests, and containerized Ingestor E2E passed all three. The shared test-utils suite retains its 12 existing skips. No assertions or retry settings were changed to obtain this result.
