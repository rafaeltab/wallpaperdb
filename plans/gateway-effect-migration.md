# Gateway Effect migration

## Objective

Migrate the gateway to Effect and CODING_STANDARDS.md while preserving public functionality and matching or improving the measured coverage baseline.

## Work

- [x] Preserve the untouched gateway and measure baseline tests and coverage.
- [x] Define application-owned catalogue/projection/admission/availability interfaces.
- [x] Move query and projection behavior behind public capability entry points.
- [x] Translate GraphQL, broker, cursor, and storage contracts at adapters.
- [x] Replace global dependency state with constructor composition and Effect scopes.
- [x] Record context language and Effect decision.
- [x] Verify real adapters, composition, error contracts, architecture, coverage and CRAP.
- [x] Run repository CI and review final changes.

## Baseline

151 tests passed, one skipped. Statements/lines 89.72%, branches 87.50%, functions 96.74%. Source coverage continues to include all `src/**/*.ts`, excluding only test/declaration files. Machine-readable counts are in `apps/gateway/coverage-baseline.json`.

## Validation

Completed on 2026-09-15:

- Gateway: 239 tests passed, none skipped. Statements/lines 99.39%, branches 97.18%, functions 99.31%, with the same source inclusion policy as the baseline.
- Architecture enforcement and its 16 tooling contract tests passed. All 209 maintained gateway functions meet the configured CRAP threshold of 30.
- Real OpenSearch, NATS and Redis adapters, partial startup cleanup, compiled startup, OpenTelemetry export, GraphQL compatibility and replay behavior are covered.
- The initial migration passed a fresh browser run covering authentication, login and upload. The optimization reran compiled gateway startup and GraphQL smoke coverage; its CI run reused the passing browser result from Turbo's cache.
- `GITHUB_ACTIONS=true make ci` passed all 67 build/lint/type/unit/integration tasks, all nine E2E-stage tasks, and coverage merging. The flag selects the Linux Docker socket in existing test-utils tests; it does not change application behavior.
- `make format` passed; unrelated formatting changes were removed. Independent code and documentation reviews found no outstanding actionable issues.

## Rollout

The gateway continues accepting existing producer envelopes and also accepts CloudEvents 1.0. Existing indices receive additive metadata mappings. The [Effect decision](../apps/gateway/docs/adr/0001-effect-execution-with-explicit-ports.md) records compatibility choices and the legacy color-history replay requirement when strict historical ordering is required.

## Test performance follow-up

The initial migration increased median full coverage runtime from 37.37 seconds on main to 77.87 seconds. Test runtime is a migration requirement; keep the full behavioral matrix and coverage while making this faster than main.

- [x] Identify repeated OpenSearch startup and NATS readiness delays with the process/container profiler.
- [x] Share one suite-owned search server, with independently owned indices, applications and broker fixtures.
- [x] Verify same-ID fixture isolation and scoped cleanup, including closed indices.
- [x] Replace delayed NATS readiness detection and measure worker execution options.
- [x] Verify shuffled execution with seeds 215 and 42, and isolate SDK instrumentation from reused workers.
- [x] Record repeated before/after wall time, CPU, memory, coverage and methodology.
- [x] Run repository CI, format and review the follow-up for PR #215.

The [performance report](../apps/gateway/docs/test-performance.md) records a full coverage median of 12.50 seconds versus 37.37 seconds on main and 77.87 seconds before optimization. All six measured runs passed 239 tests. Docker CPU improved; host CPU remains above main and worker/module reuse increases host memory. Repository CI passed all 67 main tasks, all nine E2E-stage tasks and coverage merging in 192 seconds.
