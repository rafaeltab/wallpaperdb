# Ingestor Effect migration

Migrate the Ingestion context to the repository's Effect 4 service/layer model while preserving uploads, content validation, per-Profile quota, health, and durable recovery.

## Incremental work

- [x] Record baseline and introduce tested admission port.
- [ ] Parse startup configuration once; scope telemetry and resource ownership.
- [ ] Introduce ingestion driving port and controlled-adapter behavior tests.
- [ ] Persist replay-safe upload state and atomic outbox through a PostgreSQL port.
- [ ] Translate image, object storage, and event contracts through driven adapters.
- [ ] Replace HTTP/global authentication DI and own in-flight requests and workers.
- [ ] Replace duplicated legacy tests with capability, adapter, and composition coverage.
- [ ] Enforce architecture; inspect coverage and CRAP; optimize measured bottlenecks.
- [ ] Run full CI, agent-browser verification, and open a pull request.

## Behavior priorities

Authenticated ownership; accepted/duplicate/in-progress uploads; truthful byte-based format/size/dimension rejection; fixed-window quota; durable intent before storage; metadata and stable event occurrence retained across failures; atomic stored-state/outbox transition; finite reconciliation and replica safety; safe Problem Details; readiness and bounded cleanup.

## Baseline

`make test-integration PACKAGE=ingestor FORCE=1`: 117 tests / 13 files pass; 22.33s Make wall time, 20.79s Vitest. V8/Vitest 3 statement/line coverage 83.13%, branches 83.64%, functions 74.04%. Rate-limit suites contain 11s and 5.5s fixed sleeps. Final coverage uses Vitest 5, so percentages are not a strictly identical instrumentation comparison.

CRAP must use the repository analyzer with scoped coverage. Its callback/generator attribution limitations are tracked in #217; report measured scores honestly and do not treat them as proof of complete behavior coverage.
