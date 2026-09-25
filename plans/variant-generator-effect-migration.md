# Variant generator Effect migration

## Scope

Migrate only Variant Generator from base `89df1bbe667364dda7130006ee047044f883a857` using the current coding guidelines. The original temporary handoff was deleted; the user's replacement requirements are Effect, current guidelines, no feature regressions, measured CRAP, self-verification, independent code review and fixes, a PR, and a video of real variant generation. This plan records the preservation contract for review.

## Preservation contract

| Behavior | Replacement evidence |
| --- | --- |
| Ordered category tolerances and presets; both dimensions strictly smaller; videos, unmatched ratios and small images skip | Capability tests through driving port and pure policy table |
| Sequential preset processing, remaining presets continue after a failure | Capability controlled adapters |
| JPEG, PNG and WebP retain format, configured quality, inside fit, no enlargement | Real Sharp and S3 adapter tests |
| Same original bucket, original key read, deterministic variant keys, no deletion | S3 adapter contract |
| Nominal preset dimensions remain event metadata even where inside fit yields smaller image dimensions | Adapter tests and explicit documentation |
| One output event for each successful variant, existing payload consumed by Media | Real NATS publication and complete composition tests |
| Same input subject and durable, 120-second acknowledgement wait | Broker tests |
| Health/readiness, OpenAPI, development CORS and telemetry | HTTP, lifecycle and telemetry tests |
| Consumer stops before dependencies close; startup failure releases resources | Scoped composition and real broker lifecycle tests |

Intentional corrections required by current guidelines: failed generation/publication prevents batch acknowledgement while other presets continue; retries use stable event identity and target keys, finite delayed retries, and durable quarantine; output uses binary CloudEvents retaining the current Media-compatible body. Native processing, S3 bodies, active work and shutdown receive explicit bounds. These replace silent loss and unbounded work without changing successful generation policy. No atomicity across S3 and NATS is claimed.

The existing cross-service contract exposes original bucket/key coordinates. Resolving logical asset identifiers across producers and retained history is deferred, consistent with the earlier service migrations. Variant Generator owns generated objects; it never deletes originals. No database, Media migration, or shared event contract redesign belongs in scope.

## Work plan

- [x] Audit current service, guidelines, tests, baseline coverage and CRAP.
- [x] Implement Effect capability and tests.
- [x] Implement bounded image and event adapters with real infrastructure tests.
- [x] Migrate composition, HTTP, configuration, telemetry and executable lifecycle.
- [x] Replace DI-based tests and audit all deleted paths.
- [x] Run service checks, full CI, coverage and CRAP threshold 30.
- [x] Review entire migration against base on Standards and Spec axes, fix findings, repeat as needed.
- [x] Demonstrate real generation through running artifacts and record video.
- [x] Push and open PR with validation and accessible video evidence.

## Baseline

Measured 2026-09-24 before implementation. `make test-integration PACKAGE=variant-generator FORCE=1` passed 24 tests in two files, Vitest 4.95 seconds, Turbo 6.227 seconds. `make check PACKAGE=variant-generator` passed build, lint and types, Turbo 2.158 seconds. `make crap PACKAGE=variant-generator` reported 32 inventoried functions, maximum 52.188 for createApp, one above threshold 30. The report command returning success does not imply threshold compliance.

Whole-source V8 coverage: 579/763 lines and statements, 75.88%; 27/33 functions, 81.81%; 60/73 branches, 82.19%. Coverage includes all source TypeScript except declarations and tests. The shared CRAP callback/generator inventory limitation remains relevant; scores supplement behavior review.

Baseline tests cover formats/presets/skips via concrete service calls, but do not exercise actual consumer delivery, failed publication, cancellation, startup rollback or shutdown. They assert nominal metadata dimensions without decoding generated images.

## Deletion audit

The former TSyringe S3/NATS subclasses only forwarded shared configuration; scoped adapter Layers now own these clients. The generator and resolution matcher are replaced by a driving capability with pure preset policy. Publisher/consumer wrappers are replaced by event translation and broker adapters. The global health aggregator becomes the availability capability and HTTP adapter. The unused problem-details subclasses had no callers. The executable owns telemetry and listener lifetimes, and deferred imports preserve SDK-first instrumentation in built JavaScript.

The old concrete-service integration tests were replaced by 21 capability tests, real image contracts, and a production composition test. Their category/format/skip/preset evidence is retained; the composition test additionally verifies actual events, stored bytes, replay, health and readiness. Tests no longer mutate global process environment to construct service instances. All source entrypoints and the encoder remain in coverage scope.

## Verification before review fixes

All 66 service tests across 16 files pass through `make run PACKAGE=variant-generator SCRIPT=test:all`, Vitest 27.95 seconds with one worker and no file parallelism. `make check PACKAGE=variant-generator` passes build, lint, TypeScript and architecture checks. Whole-source V8 coverage is 1300/1366 lines and statements, 95.16%; 49/57 functions, 85.96%; 257/284 branches, 90.49%. CRAP reports zero of 50 inventoried functions above 30; maximum is 27.672, compared with 52.188 before migration.

## Review round one

Both axes reviewed the entire migration against `89df1bbe667364dda7130006ee047044f883a857` through `ad2274e`.

- Standards found two P2 issues: quarantine lacked retention/capacity validation, and unsupported MIME failures lacked adapter diagnostics.
- Spec found one P2 issue: adding quarantine headers to a broker-limit-sized original exceeded the broker limit and prevented durable handoff.

The unsupported-format fix adds diagnostics and a public image contract test. The quarantine fix adds bounded retention and capacity plus a chunk/manifest representation for oversized inputs. A real broker boundary test reproduced the original failure before the fix. Follow-up review and final validation are recorded below when complete.

Replay safety covers this service's stored objects and stable output occurrence identities. The unchanged Media consumer does not maintain a processed-event ledger and can create duplicate projection rows on replay outside broker deduplication. This inherited downstream limitation is not an exactly-once guarantee and remains outside this service migration.


## Final service verification and review

`make check PACKAGE=variant-generator` passes build, lint, TypeScript and architecture checks after the review fixes. The combined suite passes 74 tests in 16 files in 30.81 seconds, with one worker and file parallelism disabled. Whole-source V8 coverage is 1452/1511 lines and statements, 96.09%; 55/63 functions, 87.30%; 291/319 branches, 91.22%. All 18 source files remain in scope, including the executable, deferred bootstrap and encoder process. Native behavior is also verified through real subprocess and built-artifact evidence, distinct from instrumented parent-process coverage.

Independent Standards and Spec reviews both re-examined the entire migration from the original base through `a9f358e`. Both report zero remaining actionable findings. All three first-round findings are fixed in focused commits. The final full CI and CRAP results follow below.

## Browser evidence

The committed recording is [variant-generator-effect.mp4](../docs/evidence/variant-generator-effect.mp4), with [verification details](../docs/evidence/variant-generator-effect.md). It lasts 37.6 seconds and shows an original-only wallpaper, six generated variants after starting the built worker, selection and download. Real S3 objects, all six JetStream events and decoded Media responses were checked. The fixture seeds S3 and NATS; it does not claim authenticated Ingestor upload coverage. No UI response was mocked. Demo-owned processes, browser and isolated infrastructure were cleaned up.

## Repository verification environment

The first full CI attempt stopped at an existing web toast test that could not find its asynchronous Dismiss button under concurrent load. All five tests in that file passed in isolation, and the full web suite passed all 461 tests with one worker in 44.32 seconds. The final CI invocation therefore limits Vitest threads/forks to one and uses a temporary Turbo wrapper to pass these environment variables through. A subsequent attempt caught unknown manifest values in new test code; explicit schema decoding fixed that type check.

The complete worktree application stack was started for existing browser E2E. PostgreSQL initially could not read a bind-mounted initialization directory; a readable temporary copy of the public init SQL and a local Compose override fixed the environment without changing tracked infrastructure. `GITHUB_ACTIONS=true` selects the existing Linux Docker socket path in shared tests. No test assertion was weakened and no service was replaced with a health stub.


## Final repository and quality results

The final full repository CI passed: 73 build/lint/type/unit/integration tasks and 10 E2E/dependency tasks. The CI runner reported 377 seconds excluding prerequisite checks; successful task caches accounted for 42 and 4 tasks respectively. Existing browser E2E passed all three tests in 7.6 seconds, and containerized Ingestor E2E passed all three tests. The command was `GITHUB_ACTIONS=true VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 make ci TURBO=/tmp/variant-turbo-serial`; the wrapper forwards the normal Make arguments to Turbo with `--env-mode=loose` so the worker limits reach Vitest. The wrapper changes no commands or assertions.

After CI, `make check-crap PACKAGE=variant-generator CRAP_THRESHOLD=30` passed with zero of 56 inventoried functions above 30. `make crap PACKAGE=variant-generator` confirmed maximum 27.672, still below baseline 52.188. The shared callback/generator attribution limitation is tracked by #217, so these scores supplement the behavior and architecture review.

All demo-owned and worktree application/infrastructure containers were stopped after verification. Persistent worktree volumes were retained. Temporary environment repairs did not change tracked infrastructure or unrelated application code. The final video documents the `ad2274e` successful generation path; later diagnostic/quarantine fixes are covered by the final 74-test suite, CI and second reviews.


## Delivery

PR: https://github.com/rafaeltab/wallpaperdb/pull/230. The PR links the committed MP4 and its decoded-image/event verification notes. The published video URL returns HTTP 200. Both review axes have zero remaining findings; all requested local checks are complete.

## PR comment follow-up

Both inline review comments on PR #230 were valid and were fixed in separate test-only commits. Production source is unchanged by this follow-up.

- [Unsupported-format test, comment 4099592663](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4099592663), fixed in `478dec6`. The fixture is now a valid GIF. The test checks both storage buckets for any object under the wallpaper prefix, regardless of extension. A temporary mutation that accepted and encoded GIF passed the old test but failed the corrected test. Restoring production code passed all nine image adapter tests.
- [Telemetry propagation test, comment 4099592667](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4099592667), fixed in `c82f317`. A test-owned span decorates the public Availability port while preserving the production Layer and HTTP adapter. Renaming the application span passes. Removing the production tracer fails span export; removing the HTTP trace-context bridge fails the trace and parent ID assertions. All temporary mutations were restored before committing.

Independent Standards and Spec reviews of `182fd0b...c82f317` each report zero findings. The Codecov comment accurately reports uncovered lines, but its checks pass and it identifies no additional runtime defect. Coverage scope remains unchanged.

The full-stack verification encountered an empty local quarantine stream left over from an earlier migration run. It had unlimited size and age. After confirming it contained zero messages, its configuration was explicitly updated to 1 GiB and 30 days. The worker then became healthy. This changed only local test infrastructure.

Follow-up verification passed `make check PACKAGE=variant-generator`, both focused integration files, and full `make ci` with the documented single-worker environment. CI completed 73 build/check/test tasks and 10 E2E/dependency tasks in 59 seconds; 69 and 8 tasks respectively used valid caches. `make test-e2e PACKAGE=web-e2e FORCE=1` then reran all three browser tests successfully against the healthy local stack. The service still passes all 74 tests. `make check-crap PACKAGE=variant-generator CRAP_THRESHOLD=30` reports zero of 56 functions above 30; `make crap PACKAGE=variant-generator` reports maximum 27.672. Whole-source coverage remains 96.09% lines, 87.30% functions and 91.22% branches.

## Second PR comment follow-up

All four comments in the second review were valid and were fixed separately.

- `f1559ac`, [4107330682](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4107330682): both event totals now declare `incremental: true`. The installed Effect OpenTelemetry producer derives counter type and monotonicity from this option, restoring the previous shared counter semantics.
- `e95e8d4`, [4107330676](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4107330676): recognized Fastify client errors retain their validated integer 4xx status and return safe Problem Details. Malformed JSON and oversized bodies reproduced the incorrect 500 responses before the fix. Both now pass alongside the existing generic-defect test.
- `fc1c517`, [4107330688](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4107330688): the telemetry contract emits a test-owned Effect counter through the production runtime and asserts its exported value and monotonicity. Removing the Effect metric producer fails this assertion while the shared SDK metric assertions still pass. The mutation was restored before committing.
- `760590f`, [4107330662](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4107330662): duplicate quarantine PubAcks are checked against stored bytes and occurrence identity. Missing records and manifests with stale chunk references are republished under fresh broker IDs, preserving CloudEvent occurrence identity. Recovery is bounded to three publications per record; unresolved failures keep the input retryable. A real NATS test reproduced an acknowledged manifest with missing data after purging a partial upload. All 17 consumer tests now pass, including purged partial uploads and deleted single records, chunks and manifests. Tests use the public consumer boundary and verify reconstructed original bytes.

Independent Standards and Spec reviews of `94fd399..760590f` found zero actionable issues. Service formatting, build, lint, architecture and type checks pass. No coverage exclusions were added.

Final validation passes all 80 tests across 16 files in the combined service suite. Whole-source coverage is 1506/1566 lines, 96.16%; 54/62 functions, 87.09%; 310/339 branches, 91.44%. All source files remain included. CRAP reports zero of 55 inventoried functions above 30, with maximum 27.672. The shared generator/callback inventory limitation still applies.

Full local CI passed in 68 seconds, with 73 build/check/test tasks and 10 E2E/dependency tasks; 66 and 8 tasks respectively used caches. The separate uncached browser run initially failed the login test because Clerk initialization encountered `ERR_NETWORK_CHANGED` while test containers were changing Docker networks. Authentication setup and upload passed. The retained trace shows the failed `/v1/dev_browser` fetch and Clerk setup error, matching the absent user menu. After all container test activity finished, the uncached browser suite passed all three tests. No assertions, timeouts or retry configuration changed to obtain that result.

## Third PR comment follow-up

Both comments in the third review are valid. The encoding-quality finding describes a previously documented limitation; it still permits published metadata to disagree with stored bytes and warrants a fix. The graceful-shutdown finding identifies missing positive-path coverage rather than a demonstrated production bug.

`69de468` addresses [4108139625](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4108139625). The gated test observes shutdown starting, releases generation before the deadline, and verifies durable publication and acknowledgement before broker closure. All 18 consumer tests pass. Temporary mutations that interrupt work prematurely or remove its successful acknowledgement both fail the new test. Production consumer code was restored unchanged.

`c0d0de8` addresses [4108139618](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4108139618). Conditional S3 creation preserves the first rendition at the existing deterministic key. A writer receiving a precondition failure reads and validates the stored result, returning its authoritative size and creation time. New objects carry a source fingerprint and creation timestamp; incompatible source references and incomplete or invalid metadata fail without overwriting. Legacy objects remain read-only and retain the input timestamp fallback under the documented immutable-source ownership assumption. Encoding changes affect new targets; intentional regeneration still requires versioned target identities.

Four real S3/NATS regression cases failed before the image fix. Nine final replay contracts pass, covering quality changes, concurrent writers, legacy adoption, source conflicts and malformed metadata. Existing image and cancellation/process tests also pass. Removing the conditional write breaks the concurrent-writer test. Removing creation-time validation breaks its isolated test. Review caught and corrected a fixture whose invalid source fingerprint initially masked timestamp validation. All temporary mutations were restored. Independent Standards and Spec reviews have no remaining findings, and service formatting, build, lint, architecture and type checks pass.

Final third-round validation passes all 90 tests in 17 files. Whole-source coverage is 1585/1645 lines, 96.35%; 59/67 functions, 88.05%; 332/362 branches, 91.71%. The new storage adapter remains in coverage scope. CRAP reports zero of 60 inventoried functions above 30, maximum 27.672. The shared callback/generator inventory limitation remains applicable.

Full local CI passed in 73 seconds: 73 build/check/test tasks and 10 E2E/dependency tasks, with 66 and 8 cached tasks respectively. After every container test finished, a separate uncached browser run passed all three tests against the rebuilt healthy stack. No assertions, timeouts or retry settings were relaxed. The browser run was serialized after Docker test activity to avoid the diagnosed network interference from the preceding review round.

## Fourth PR comment follow-up

Both new comments were valid test gaps; this follow-up changes no production source.

- `1a9033e`, [4109070857](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4109070857): both malformed and oversized HTTP request fixtures now contain the private-data marker asserted absent from their responses. All six HTTP tests pass, retaining exact safe response-shape and status checks.
- `89d0533`, [4109070779](https://github.com/rafaeltab/wallpaperdb/pull/230#discussion_r4109070779): preset selection now checks explicit ordered width/height pairs independently of production constants. Large standard, ultrawide and phone inputs select every family's largest preset; existing smaller-input and exclusion cases remain. Changing the 2560×1440 preset to 2560×1439 passed the previous 21 focused tests and failed two updated assertions. After restoring production code, all 24 focused tests and uncached type checking pass.

Independent Standards and Spec reviews of `83fc97c..89d0533` found zero actionable issues. All temporary production mutations were restored before verification and commits.

Final fourth-round verification passed full local CI in 52 seconds: 73 build/check/test tasks and 10 E2E/dependency tasks, with 69 and 8 cached tasks respectively. The service passed all 93 tests, comprising 49 unit and 44 integration tests. Fresh CRAP verification reports zero of 60 functions above 30. After container test activity finished, all three browser tests passed in a separate uncached run against the healthy local stack. Production source and coverage scope are unchanged.
