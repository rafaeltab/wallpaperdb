# Color extractor Effect migration

## Scope and base

Migrate only Color Extractor, based on `origin/main` commit `5140dd52dbc60fc0cc9bd9d022c9ff6717130c84`, after Ingestor PR #222 merged. The user-authorized handoff is `/tmp/wallpaperdb-service-effect-migration-handoff.md`. This plan and its preservation matrix are the full-PR review spec. Follow the authoritative coding index, not examples from previous migrations.

## Preservation contract

| Guarantee | Owning boundary | Baseline evidence | Replacement evidence | Intentional change |
| --- | --- | --- | --- | --- |
| Image uploads extract, videos skip without storage/publication | Extraction capability | Processor and handler unit tests | Capability and event translation tests | Explicit Extracted/Skipped outcomes |
| Download exact immutable original bucket/key | Image adapter | S3 reader integration | Real S3 image adapter tests | Abort request/body on cancellation; no asset deletion |
| Approximate 10,000-pixel resize, aspect ratio and min dimension 1 | Image adapter | Sharp tests including tall image | Real Sharp cases through adapter | None |
| 64-bin HSV, 48 chromatic and 16 achromatic, alpha weighting, normalization and transparent zero histogram | Pure extraction policy | HSV strategy table | Same table through public extraction entry point | None |
| Publish exact histogram, wallpaper ID and hsv only after extraction completes | Extraction and event adapter | Processor + pipeline tests | Capability, real broker and composition tests | Stable output occurrence on redelivery |
| Consume wallpaper.uploaded on WALLPAPER durable color-extractor-wallpaper-uploaded-consumer | Event adapter | Shared consumer and runtime wiring | Real broker tests | Accept legacy and canonical CloudEvents explicitly |
| Acknowledge only after publication PubAck or intentional skip | Event adapter | Shared consumer source | Real broker delivery tests | None |
| 120-second ack wait, stop extraction at existing delivery-count cutoff 3 | Event adapter | Shared consumer redeliveryCount >=3; verify NATS semantics | Real broker retry tests | Replace immediate retries with 1s/2s delay; quarantine invalid/exhausted input durably before terminal ack; unlimited broker delivery allows quarantine retries without repeating extraction |
| Output wallpaper.colors.extracted is consumed by Gateway | Event adapter | Shared schema and Gateway translator | Broker schema checks and real browser ranking | CloudEvents envelope; stable ID derived from input occurrence, occurrence time inherited from input; payload unchanged |
| GET /health and /ready, OpenAPI and development CORS | HTTP adapter | Health integration tests | HTTP and composition tests | Include worker state in dependency health |
| Acquire S3/NATS then start consumer; stop consuming before dependencies close | Composition | createApp source; no failure-cleanup coverage | Startup/close and broker lifecycle tests | Scoped resources, bounded drain, cleanup on startup failure |
| Traces across processing and external calls, existing metric names | Runtime/adapters | Existing telemetry calls | Mechanism tests + code audit | Effect spans connected to process SDK |

Storage-coordinate contracts remain deferred as in the Ingestor ADR. No database, shared event-schema redesign, or other service migration belongs here. Extraction is a stateless reaction to an immutable original; repeat computation is safe. Stable result identity and Gateway idempotent projection provide replay safety beyond the broker deduplication window. There is no cross-resource atomicity claim.

## Increments

- [ ] Record baseline test/check/coverage/CRAP timing and limits.
- [ ] Add Effect extraction capability, typed ports and explicit outcomes with focused tests.
- [ ] Implement image adapter with real Sharp/S3 contract evidence; preserve pure histogram table.
- [ ] Implement event translation, stable publication and bounded consumer with real NATS evidence.
- [ ] Route production composition and HTTP through scoped Layers; remove obsolete DI paths after accounting for callers.
- [ ] Verify full source coverage, CRAP, service checks and full `make ci`.
- [ ] Review full PR against origin/main with independent Standards/Spec reviewers; fix applicable findings in tested commits and repeat.
- [ ] Run fresh actual extraction through Gateway and browser Color ranking; record and publish playable video.
- [ ] Push focused PR and inspect CI on its current head.

## Browser evidence

Use fresh distinct-color wallpapers, real S3, upload events, the migrated worker, and Gateway projection. Show Color ranking in the existing browse UI through agent-browser. Use safe fixture identity; prepare credentials before recording. Record exact event IDs, build commit and output checks. A health check or fabricated HTML cannot satisfy this gate. Video must be attached to the PR and verified playable. Browser preparation and attachment access are being investigated independently.

## Verification results

# Color extractor baseline

Base commit `5140dd52dbc60fc0cc9bd9d022c9ff6717130c84`, measured 2026-09-24 UTC. No repository edits.

| Command | Exit | Wall seconds | Result |
| --- | --- | --- | --- |
| `make test-unit PACKAGE=color-extractor FORCE=1` | 0 | 2.397 | 22 tests passed across 4 files; Vitest 0.868 s |
| `make test-integration PACKAGE=color-extractor FORCE=1` | 0 | 9.621 | 4 tests passed across 3 files; Vitest 8.16 s |
| `make check PACKAGE=color-extractor FORCE=1` | 0 | 2.975 | Build, lint, TypeScript passed |
| `make crap PACKAGE=color-extractor` | 0 | 2.443 | 33 function entries; maximum CRAP 52.188 for createApp, above threshold 30 |

All test/build/check tasks used FORCE=1 with no cached tasks. CRAP restored the same fresh unit/integration coverage with 2 cached of 3 Turbo tasks. The combined test:all script was not rerun because the two tiers cover the same seven files. CRAP report exit 0 means a report was produced, not that threshold 30 passes. Baseline has one function above 30.

## Coverage scope

V8 coverage, Vitest 3.2.4; all `src/**/*.ts`, excluding only tests and declarations. There are 18 source files. Pure type-only modules do not produce executable coverage. Coverage reports include all 18 source files. Separate unit and integration totals are not an aggregate percentage.

- unit: lines 133/607 (21.91%); statements 133/607 (21.91%); functions 10/22 (45.45%); branches 34/49 (69.38%)
- integration: lines 463/607 (76.27%); statements 463/607 (76.27%); functions 31/36 (86.11%); branches 40/64 (62.5%)

CRAP uses merged coverage from the tiers. Its callback/generator inventory limitation is tracked by issue #217; these scores do not replace behavior review.

## Infrastructure and observations

Docker 29.1.3; Testcontainers manages isolated SeaweedFS `chrislusf/seaweedfs:4.47` and NATS `nats:2.10-alpine` containers. Sharp exercises real images. In-process service composition is used by health and pipeline integration tests. Turbo 2.7.2, Node v22.22.3.

No failing baseline tests, lint, type check or build. Pipeline integration has one successful extraction test; retries, malformed payloads, video no-op, and shutdown are not demonstrated through real composition by that suite. Some callbacks are omitted by the CRAP function inventory.

 Coverage continues to include all `src/**/*.ts`, including composition and entrypoints. Shared CRAP callback/generator limitation remains tracked by #217; report it alongside manual review rather than treating CRAP as proof.
