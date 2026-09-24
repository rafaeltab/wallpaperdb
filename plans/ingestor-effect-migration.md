# Ingestor Effect migration

Migrate the Ingestion context to the repository's Effect 4 service/layer model while preserving uploads, content validation, per-Profile quota, health, and durable recovery.

## Incremental work

- [x] Record baseline and introduce tested admission port.
- [x] Parse startup configuration once; scope telemetry and resource ownership.
- [x] Introduce ingestion driving port and controlled-adapter behavior tests.
- [x] Persist replay-safe upload state and atomic outbox through a PostgreSQL port.
- [x] Translate image, object storage, and event contracts through driven adapters.
- [x] Replace HTTP/global authentication DI and own in-flight requests and workers.
- [x] Replace duplicated legacy tests with capability, adapter, and composition coverage.
- [x] Enforce architecture; inspect coverage and CRAP; optimize measured bottlenecks.
- [x] Run repository validation and agent-browser verification.

## Behavior priorities

Authenticated ownership; accepted/duplicate/in-progress uploads; truthful byte-based format/size/dimension rejection; fixed-window quota; durable intent before storage; metadata and stable event occurrence retained across failures; atomic stored-state/outbox transition; finite reconciliation and replica safety; safe Problem Details; readiness and bounded cleanup.

## Baseline

`make test-integration PACKAGE=ingestor FORCE=1`: 117 tests / 13 files pass; 22.33s Make wall time, 20.79s Vitest. V8/Vitest 3 statement/line coverage 83.13%, branches 83.64%, functions 74.04%. Rate-limit suites contain 11s and 5.5s fixed sleeps. Final coverage uses Vitest 5, so percentages are not a strictly identical instrumentation comparison.

CRAP must use the repository analyzer with scoped coverage. Its callback/generator attribution limitations are tracked in #217; report measured scores honestly and do not treat them as proof of complete behavior coverage.

## Final verification

`make test-integration PACKAGE=ingestor FORCE=1`: 83 tests / 16 files pass; 10.57s Make wall time, 9.07s Vitest (53% and 56% faster respectively than baseline). Controlled clocks replace quota/worker sleeps; adapter fixtures replace repeated whole-service setup; the deployed Docker suite covers three essential flows. These are local measurements, not performance guarantees.

| Metric | Baseline | Final |
| --- | ---: | ---: |
| Statements | 83.13% | 94.43% |
| Lines | 83.13% | 95.39% |
| Branches | 83.64% | 86.17% |
| Functions | 74.04% | 93.99% |
| Highest inventoried CRAP score | 35.369 | 8.000 |
| Inventoried functions above CRAP 30 | 1 / 118 | 0 / 104 |

Coverage includes all ingestor source files. Vitest's instrumentation version changed, and the CRAP callback/generator limitation in #217 applies to both measurements.

- `make check PACKAGE=ingestor` and `make run PACKAGE=ingestor SCRIPT=format:check` pass.
- `make check-crap PACKAGE=ingestor CRAP_THRESHOLD=30` passes; `make crap PACKAGE=ingestor` supplies the ranking.
- `make ci` passes all 72 build, lint, typecheck, unit, and integration tasks, then stops at the separate web browser suite because the complete application stack is unavailable at port 8220. This is not a complete CI pass.
- The rebuilt ingestor Docker suite passes 3/3 in 7.18s with telemetry enabled.
- Agent-browser verifies readiness, dependency health, accepted upload, duplicate identity, invalid content, unauthenticated upload, and the actual authenticated Swagger upload form.
- The public `make migrate PACKAGE=ingestor` command succeeds twice against fresh PostgreSQL. The populated legacy database regression verifies incomplete committed records stop migration before mutation, followed by repair and successful reruns.

## Deployment and compatibility

Before starting the new ingestor, rebuild and restart every consumer replica in Media, Variant Generator, Color Extractor, and User with the updated `@wallpaperdb/events` schema. These consumers accept both legacy and CloudEvents envelopes and can be deployed while the old ingestor runs. Old consumer binaries terminate CloudEvents deliveries on validation failure; upgrading afterward does not cause ordinary redelivery. Maintain both-format support while either format remains available for replay.

Drain and stop old ingestor replicas, run `make migrate PACKAGE=ingestor` as a separate workspace/deployment job, then start the new replicas. This uses the standard Drizzle Kit command: a versioned SQL migration validates and prepares legacy records, applies schema changes, and backfills recovery metadata and outbox entries in one transaction. Drizzle's journal ensures the upgrade runs once. Incomplete committed metadata requires repair; a failed migration rolls back, preserving originals and their states for a retry. Non-test startup requires both Clerk secret and publishable keys.

CloudEvents metadata surrounds the existing shared event payload. Physical bucket/key fields remain in that shared payload for existing consumers; the local ingestion capability uses logical asset references. A coordinated cross-service payload migration is explicitly outside this change.
