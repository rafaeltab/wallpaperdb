# Gateway Effect migration

## Quality tooling follow-up

The gateway-specific CRAP analyzer and its gate were removed on 2026-09-23. Its overlapping coverage attribution could hide uncovered functions, so the historical CRAP claims below are withdrawn. [Issue #217](https://github.com/rafaeltab/wallpaperdb/issues/217) tracks callback/generator coverage in the shared analyzer and preserves exact commit links to the removed implementation. Architecture checks and source-wide coverage thresholds remain enabled.

## Current validation commands

The repository now uses shared Make targets: `make build PACKAGE=gateway`, `make check-types PACKAGE=gateway`, `make lint PACKAGE=gateway`, and `make test-integration PACKAGE=gateway`. Use `FORCE=1` to bypass Turbo's cache, or `make test-focused PACKAGE=gateway ARGS='test/catalogue.test.ts'` for selected tests. Focused runs build dependencies and use one worker with options supported by both repository Vitest versions. Gateway coverage lives in `apps/gateway/coverage/integration`, which the shared analyzer expects. The dated measurements below describe their original revisions and test matrices.

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

## Effect 4 continuation

The 2026-09-16 continuation follows the installed Effect guide and the upstream v3-to-v4 migration skill. [ADR 0002](../apps/gateway/docs/adr/0002-effect-services-and-owned-lifetimes.md) supersedes the earlier dependency construction decision for the gateway.

- [x] Upgrade the gateway to Effect 4 and matching OpenTelemetry/platform packages.
- [x] Express application dependencies as `Context.Service` requirements and assemble memoized layers at the composition root.
- [x] Use typed technical errors, Effect configuration and Schema decoding at local boundaries.
- [x] Own HTTP requests, broker streams and vendor clients with scopes and bounded shutdown.
- [x] Preserve Redis fail-open behavior while recovering connections and bounding queued work; add loss-of-protection telemetry and alerting.
- [x] Separate reusable startup from executable signal and exit policy; release telemetry after partial startup failures.
- [x] Validate full gateway coverage, quality thresholds and repository CI.
- [x] Complete independent review, formatting and final evidence.

Immediately before this continuation, the unchanged gateway passed 239 tests in 11.84 seconds with statements/lines 99.39%, branches 97.18% and functions 99.31%. The configured pre-migration coverage baseline and source inclusion policy remain unchanged.

Continuation validation covers 271 tests across 22 files, including real adapter recovery and cancellation, whole-response HTTP draining, listener conflicts, `.env` startup, typed configuration failures, redacted credentials, and persisted timestamp compatibility. Coverage remains above the original baseline with every source file included. Independent reviews found and resolved dotenv timing, timestamp rollover/precision, and delivery-log identity issues.

- Coverage: statements/lines 98.48%, branches 96.03%, functions 96.87%; the original thresholds are unchanged.
- Architecture enforcement and all 16 tooling tests pass; all 325 maintained functions meet the CRAP threshold of 30.
- `GITHUB_ACTIONS=true make ci` passes all 67 main tasks, all nine E2E-stage tasks, and coverage merging. One completed run took 217 seconds including rebuilding service images and fresh browser authentication, login, and upload tests. The final refresh after HTTP cleanup passed in 104 seconds, reusing the passing browser result. An earlier attempt correctly stopped when the local stack was offline; starting the worktree's stack resolved that environment prerequisite.
- `make format` and whitespace checks pass. Unrelated formatter changes were removed, and existing untracked prototype/review artifacts remain outside this migration.
- The quota-loss alert is provisioned and its YAML is validated; notification delivery has not been exercised.

## Effect test adapter follow-up

The gateway now uses `@effect/vitest@4.0.0-rc.115` with Vitest, coverage, and UI pinned to `5.0.1`. That Effect release requires Vitest 5. Other workspaces remain on Vitest 3; the shared config package provides plain defaults for composition through each runner's own config helpers.

- [x] Migrate capability tests to `it.effect`, share the immutable cursor service through `layer`, and keep quota state fresh per test.
- [x] Migrate real listener/bootstrap tests to `it.live`, preserving clock behavior and scope-owned cleanup.
- [x] Validate all 25 converted capability scenarios with shuffled execution (seed 426).
- [x] Reproduce Vitest 4 migration blockers separately on 4.1.11 for issue #201: removed third-argument options, constructor mock semantics, and removed worker configuration.
- [x] Retain all coverage thresholds and source inclusion; add real adapter tests for failure paths exposed by the newer remapper.

All 276 tests across 22 files pass. Vitest 5 coverage is 97.95% statements, 91.53% branches, 98.46% functions, and 98.60% lines; every one of the 325 maintained functions meets the CRAP threshold of 30. These numbers use the newer AST remapper and are not directly comparable to Vitest 3's earlier reports. No production code changed in this follow-up.

`GITHUB_ACTIONS=true make ci` passed all 67 main tasks, all nine E2E-stage tasks, and coverage merging in 250 seconds. Browser authentication, login, and upload ran fresh. `make format`, an uncached gateway typecheck, and independent review passed; unrelated formatter output was removed.

Compatibility findings, reproduced Vitest 4 failures, and validation results are recorded in [issue #201](https://github.com/rafaeltab/wallpaperdb/issues/201#issuecomment-5706196989). The repository-wide Vitest upgrade remains tracked there.
