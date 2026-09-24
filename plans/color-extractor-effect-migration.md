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
| GET /health and /ready, OpenAPI and development CORS | HTTP adapter | Health integration tests | HTTP and composition tests | Include worker state in dependency health; RFC 9457 non-success bodies and anchored development origins |
| Acquire S3/NATS then start consumer; stop consuming before dependencies close | Composition | createApp source; no failure-cleanup coverage | Startup/close and broker lifecycle tests | Scoped resources, bounded drain, cleanup on startup failure; killable decoder process bounds native metadata work |
| Traces across processing and external calls, existing metric names | Runtime/adapters | Existing telemetry calls | Mechanism tests + code audit | Effect spans connected to process SDK |

Storage-coordinate contracts remain deferred as in the Ingestor ADR. No database, shared event-schema redesign, or other service migration belongs here. Extraction is a stateless reaction to an immutable original; repeat computation is safe. Stable result identity and Gateway idempotent projection provide replay safety beyond the broker deduplication window. There is no cross-resource atomicity claim.

## Increments

- [x] Record baseline test/check/coverage/CRAP timing and limits.
- [x] Add Effect extraction capability, typed ports and explicit outcomes with focused tests.
- [x] Implement image adapter with real Sharp/S3 contract evidence; preserve pure histogram table.
- [x] Implement event translation, stable publication and bounded consumer with real NATS evidence.
- [x] Route production composition and HTTP through scoped Layers; remove obsolete DI paths after accounting for callers.
- [x] Verify full source coverage, CRAP, service checks and full `make ci`.
- [x] Review full PR against origin/main with independent Standards/Spec reviewers; fix applicable findings in tested commits and repeat.
- [x] Run fresh actual extraction through Gateway and browser Color ranking; record inspected video.
- [ ] User attaches the playable video to PR #229.
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

## Deletion audit

The TSyringe connection subclasses only forwarded configuration to shared clients; the new adapter Layers own clients directly. The event service and publisher wrappers are replaced by one result-publishing adapter. The processor's read-then-publish sequencing and handler's video skip now belong to the extraction capability, tested through its driving port. The HSV class was converted to pure functions without changing its formula or test table. The old health aggregator path is replaced by the availability capability and HTTP translation tests. The unused problem-details helper had no callers. The old telemetry singleton is replaced by the process scope. Existing S3 and Sharp tests now call deliberate adapter entry points. No original deletion or storage mutation was introduced.

The previous three-second pipeline sleep and message-count assertion were replaced by a bounded read of the actual extracted result. This retains output identity, histogram length, normalization and red-bin assertions. Production startup now has real listener and bind-failure cleanup tests. Test builders pass explicit configuration instead of mutating process environment.

Intentional resource limits: S3 extraction 100 seconds, health probe 5 seconds, Image decoder process 10 seconds including metadata, native concurrency one per adapter. Deadline/interruption kills and reaps the decoder before releasing its permit. Quarantine payloads that cannot fit after binary CloudEvents headers remain pending for repair, without further extraction beyond the three-attempt cutoff.

## Full-PR review, round one

Base and merge-base: `5140dd52dbc60fc0cc9bd9d022c9ff6717130c84`. Reviewed full `git diff origin/main...HEAD` and eight commits through `b4468f7` with independent Standards and Spec agents.

### Standards

- P1: Uninterruptible Sharp metadata could block scope shutdown and subsequent cleanup. Applicable, fixed in `7061236` with killable process ownership and real SIGSTOP deadline/interruption tests. The native-process ADR records the cost and reason.
- P2: Bucket/key storage coordinates remain in application input. On examining concrete alternatives, the reviewer withdrew this as a migration blocker. The handoff explicitly defers the storage contract change. Preserving arbitrary retained coordinates through an opaque wrapper would only conceal the same dependency; a genuine logical-ID resolver needs producer-contract or durable-mapping work outside this migration. Keep this as explicit deferred boundary debt.

### Spec

- P2: Health/readiness OpenAPI response schemas were deleted. Applicable, fixed in `71cd29c` with a failing documentation contract test first, then restored 200 and RFC 9457 503 schemas. All four HTTP tests pass.

Round two reviewed the complete PR again after these fixes; see final verification below. The requested video will be attached by the user, as confirmed in the session; provide the final inspected clip locally and leave the PR attachment gate open until attached.

## Verification before the telemetry follow-up

The second independent Standards and Spec reviews examined the entire PR through `3e059e9`, against `origin/main` and merge-base `5140dd52dbc60fc0cc9bd9d022c9ff6717130c84`. Standards: zero applicable violations or actionable smells. Spec: zero actionable findings. A subsequent built-artifact audit found that bundled imports bypassed SDK-first initialization and that HTTP trace parents were not passed into Effect. Commit `32c5e0a` fixes both, with regressions that failed first. A third full-PR review and verification run cover these changes.

| Check | Result |
| --- | --- |
| `make check PACKAGE=color-extractor` | Build, lint, types and shared architecture checks passed |
| Unit tier | 44 tests in 10 files; uncached Vitest 4.91 s |
| Integration tier | 15 tests in 6 files; uncached Vitest 4.67 s |
| `make run PACKAGE=color-extractor SCRIPT=test:all` | 59 tests in 16 files; Vitest 5.53 s, wall 6.12 s |
| `make check-crap PACKAGE=color-extractor CRAP_THRESHOLD=30` | 0 of 49 inventoried functions above 30; maximum 27.672, versus baseline 52.188 |
| Whole-source coverage | Lines/statements 1129/1175 = 96.08%; functions 48/56 = 85.71%; branches 228/258 = 88.37% |
| Baseline aggregate coverage | Lines/statements 471/607 = 77.59%; functions 31/36 = 86.11%; branches 61/78 = 78.20% |
| Existing web browser E2E | All 3 tests passed, Playwright 7.7 s |
| Full repository CI | `GITHUB_ACTIONS=true make ci` passed: 72 build/check/unit/integration tasks and 10 E2E/dependency tasks; 166.69 s wall including Make prerequisite checks |

Coverage uses V8 and Vitest 3.2.4 and includes all 17 source files. `bootstrap.ts`, `index.ts` and the decoder subprocess remain zero-covered in the parent Vitest report. They were not excluded. Real source and built decoder behavior is exercised through image adapter tests and the browser demonstration; that is different evidence from instrumented coverage. The shared CRAP callback/generator inventory limitation remains #217. The maximum reported score is the incoming trace-context adapter at 27.672; scores do not prove behavior completeness.

The original integration tier took 8.16 s for four tests. The final tier takes 4.67 s for fifteen tests after removing the fixed processing sleep and using explicit configuration. Unit time rises from 0.868 s for 22 tests to 4.91 s for 44 tests, including the deliberately stalled telemetry collector. Isolating decoding adds roughly 56 ms per image in the focused Sharp table, a measured cost of enforceable cancellation. Timing runs use the same local Docker engine with isolated NATS/SeaweedFS fixtures; shared final CI uses successful caches where unchanged.

Initial full CI attempts exposed environment prerequisites: the full browser stack was absent, then shared test-utils tests selected a hard-coded missing Docker Desktop socket. The worktree stack was started, and `GITHUB_ACTIONS=true` selects those tests' existing `/var/run/docker.sock` branch without changing assertions. A temporary readable copy of the public PostgreSQL init SQL fixed host bind-mount permissions. No repository implementation was changed for these environment repairs.

## Final browser evidence and delivery

PR: https://github.com/rafaeltab/wallpaperdb/pull/229. The user will attach the inspected 36.63-second H.264 clip, `/tmp/color-extractor-effect-demo.mp4`. The PR stays draft until that playable attachment is present. This local path is a handoff artifact, not a substitute for a published video.

The clip shows a new orange upload, HTTP success, and orange/blue/red Color rankings through the existing UI. The final orange wallpaper is `wlpr_01M3A6X7Q55SE6C5CYMDNDXFH8`; extraction occurrence `43b00a22f0023770375008141d764a4d20ce5b4fc1cb279b73544a9e51a793be` and Gateway's stored histogram were checked. The actual child process ran the built `dist/decoder.mjs`.

The running service artifact had SHA256 `2caddea23f7e6b63e6877c37e69218bc8b4239439d00b2d6da200a0f0fd875e4`, decoder `ec6986792be1cca1dd89f9f0f9fb498c45cc0ecac1f2745e661f57a83c78b16b`. It contains the native fix at `7061236`; final reviewed source `3e059e9` adds documentation only. Formatting after the initial build changed the rebuilt main artifact's byte hash without functional changes; decoder bytes are unchanged. Detailed local evidence is `/tmp/color-extractor-browser-results.json`.

Demonstration limits: Ingestor used a disposable test-mode identity; the generated curl block was hidden to avoid showing its fixture bearer value. The unchanged Media neighbor needed a temporary dependency resolver for its undeclared ioredis import. The color worker ran its normal built artifact without that resolver. The native color input used its DOM setter and bubbling input event to invoke the real application handler; no result or network response was mocked. Demo-owned browser, processes and containers were cleaned up.

Remaining limits are explicit: lost-PubAck ambiguity and the elapsed 30-second heartbeat lack dedicated tests; oversized quarantine publications stay pending for repair; storage-coordinate contract migration is deferred. No follow-on service migration was started.

## Final telemetry verification

Commit `32c5e0a` preserves SDK-first initialization in generated JavaScript through deferred application chunks and carries incoming HTTP trace parents into Effect. Both regressions failed before the fix. Deploy the entire `dist` directory. Independent Standards and Spec round-three reviews examined the full PR through that commit against the same base and found zero applicable findings. The later documentation update records these results and the deployment requirement.

- Combined service suite: 60 tests in 17 files, Vitest 5.33 seconds.
- Unit/integration tiers: 45/15 tests, Vitest 5.00/5.08 seconds in final CI.
- Whole-source coverage: lines/statements 1141/1187 = 96.12%; functions 49/57 = 85.96%; branches 232/262 = 88.54%. The same 17 source files remain included.
- CRAP threshold 30: zero of 50 inventoried functions exceed it; maximum remains 27.672 for `consumeMessage`.
- `GITHUB_ACTIONS=true make ci` passed again: 72 build/check/unit/integration tasks and 10 E2E/dependency tasks. Turbo reused 68 and 8 successful task caches respectively. The CI runner reported 42 seconds, excluding Make prerequisite work. Existing web E2E again passed all three tests.

The recorded video predates this telemetry-only follow-up. Its extraction and ranking evidence remains applicable; the generated-import and collector tests provide evidence for the later telemetry changes. The user will attach the recording, so the PR remains draft pending that manual step. Local full-CI output is `/tmp/color-ci-telemetry-final.log`; round-three reviews are `/tmp/color-standards-review-3.md` and `/tmp/color-spec-review-3.md`.

## PR comment follow-up

All five inline findings in review `5309167693` were valid and fixed in separate commits:

| Comment | Finding and evidence | Fix |
| --- | --- | --- |
| `4097609282` | The production graph handled HTTP requests but omitted the Effect tracer from the resulting runtime. A collector test through real `createApp`, S3 and NATS failed before the fix and passes with the incoming trace and parent IDs afterward. The previous synthetic test graph concealed this defect. | `c4cfe8b` retains `tracingLayer` with `provideMerge`; collector coverage now exercises production composition. |
| `4097609286` | A mutation that called extraction three times and quarantined as `Exhausted` passed the original malformed-input test. | `7fea657` asserts zero extraction calls and quarantine reason `Invalid`; the same mutation fails. |
| `4097609289` | Shuffling publication tests with seed 3 reproduced a failure caused by leaked stream configuration. | `3fa3042` restores the prior message-size limit in `finally`; both publication tests pass in the reproduced order. |
| `4097609300` | Forced opacity passed the original uniformly blue fixture. | `72b2dc0` uses equally sized red and blue regions with unequal alpha and asserts relative contributions; forced opacity fails. |
| `4097609307` | Parent-process buffering had no byte limit, an inherited resource risk. | `073bffe` caps actual streamed image bytes at 50 MiB, matching Ingestor's accepted image limit; oversized advertised lengths fail early and overflow closes the body. Tests exercise unfinished chunked overflow, header-only rejection and successful extraction at exactly the limit. |

Temporary mutations were removed before final verification. No production decoder or consumer behavior changed for the assertion fixes. Normal image extraction and ranking remain unchanged; stored images above 50 MiB now fail with a typed read error and follow the existing retry/quarantine policy. The existing video remains evidence of the normal upload/extraction/ranking path, while collector and byte-boundary tests cover these fixes.

Follow-up verification: all 63 service tests in 19 files pass. After a host OOM/restart during repository-wide verification, the service suite was rerun with one worker, file parallelism disabled, and a 4 GiB systemd memory cap. That run took 29.14 seconds. Whole-source coverage is 1152/1198 lines = 96.16%, 49/57 functions = 85.96%, and 239/270 branches = 88.51%. Build, lint, architecture and type checks pass. The CRAP check before the restart reported zero of 50 inventoried functions above 30. Independent full-PR Standards and Spec reviews through `72b2dc0` each returned zero actionable findings.

The local full-CI attempt is not reported as passing. Overlapping coverage commands first collided on output directories; a later host OOM killed a Vitest worker. The task's persistent stack was stopped, local verification was serialized and memory-limited, and final repository-wide validation is delegated to GitHub CI on the pushed head. The restart cleared `/tmp`, including transient logs and the local video copy; the earlier recording evidence above is historical. Video attachment remains the user's pending delivery step.
