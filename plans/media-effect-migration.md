# Media Effect migration

Base: `53f3dc4134ac284fc49ac35324b8d484f1c26206`.

## Contract and scope

Media owns a local delivery catalog in the Media bounded context. Ingestor and Variant Generator own wallpaper objects; User owns Profile picture objects. Media reads those immutable assets. The synchronous Profile availability check remains the explicit exception in `docs/adr/0004-authorize-profile-picture-delivery-at-origin.md`.

| Behavior | Preservation evidence |
| --- | --- |
| Original wallpaper bytes, MIME, length, immutable one-year cache | Existing resize and event-consumption suites; HTTP contract tests |
| Width/height bounds, contain default, cover crop, fill stretch, no enlargement except fill | Existing 39 resize tests; delivery capability and real Sharp contracts |
| Select smallest variant satisfying both effective dimensions; omitted dimension uses original dimension; fallback to original when variant missing | Delivery capability tests and resize integration suite |
| Missing catalog/object returns 404; invalid dimensions returns 400 | HTTP contract tests and existing integration tests |
| Profile metadata can arrive after a newer snapshot; lower versions cannot restore retired pictures | Existing Profile suite and PostgreSQL projection contracts |
| Profile GET and HEAD check authenticated authority on every origin request; 404 denies, other failures return uncached 503; fully read successful bytes before immutable cache | Existing Profile suite and authority adapter contracts |
| Wallpaper/variant available events retain subjects and payloads | Broker translation and full-composition contracts |
| Replay and duplicate delivery do not duplicate catalog effects or event occurrences | Transactional ledger/outbox and broker contract tests |
| Variant before parent survives until parent arrives | Projection regression test |
| Health/readiness report dependency state and shutdown | Availability and HTTP contracts |
| Startup rollback, consumer shutdown, HTTP disconnect cancellation, telemetry flush | Scoped composition, adapter, and production telemetry tests |

Intentional corrections: transient wallpaper storage failures become uncached 503 instead of being hidden as absence. All problem types use the repository's RFC 9457 URI convention. Configured dimension limits apply at the capability. Duplicate variants and discarded early variants are corrected. State changes and their publication intent commit atomically; broker deduplication is supplementary.

## Work sequence

1. Record baseline and add the supported Effect/telemetry dependencies.
2. Introduce delivery ports and adapters alongside the old implementation, one tested behavior per increment.
3. Introduce transactional catalog projection and outbox, including duplicate and reordering regression tests.
4. Add scoped broker consumers, quarantine and outbox publication.
5. Replace HTTP and composition; remove TSyringe and obsolete wrappers after callers migrate.
6. Verify telemetry, cancellation, built artifacts, coverage and CRAP; exercise the real application and record evidence.
7. Review the entire base-to-head diff on Standards and Spec axes and run an independent deep review. Fix findings in commits and repeat until each review is clear.
8. Run repository CI, publish the branch and PR with evidence, inspect hosted checks.

## Baseline

`make test-focused PACKAGE=media ARGS='--coverage'`: 55 tests passed across four files in 36.28 seconds. Existing coverage includes all production source. The first CRAP invocation overlapped a newly introduced TDD test before Effect was installed and did not produce a score; this is not a baseline failure of the original 55 tests.

## Review findings and validation

The full migration was independently reviewed from the pinned base through `252043c`. Findings and fixes are recorded below.

Baseline CRAP was recomputed from the original source snapshot and the repeated original 55-test coverage using the same analyzer and attribution policy as `scripts/crap.mts`. Highest score: 52.188 (`createApp`, 25% effective coverage). Original-source ranking retained during implementation at `/tmp/media-baseline-ranking.tsv`.

Composition cutover passes all original 55 tests plus 13 new HTTP contracts. Build, lint, type checks and architectural dependency checks pass. The first cutover run caught an authorized Profile picture with missing storage being translated to 404; the capability now preserves its retryable 503 and has a narrow regression test. A disconnect regression test failed before request AbortSignals reached the Effect runtime and passes after wiring them.

The production build now defers HTTP, S3, NATS and PostgreSQL imports until telemetry starts, and ships a separate resize worker. A build contract verifies the emitted artifacts. Production telemetry composition exports SDK and Effect spans, incoming trace context, structured logs and monotonic Effect metrics through the owned providers.

Legacy upgrade tests exposed exhausted JetStream consumers that remain stranded after increasing MaxDeliver. Startup now preserves and rejects those consumers with an actionable recovery error. A real NATS test proves operator recreation from the saved acknowledgement floor recovers the retained input. Clean legacy consumers upgrade in place.

Legacy catalog tests exposed missing publication intent and duplicate variant identity on replay. A generated target-ledger migration now lets the first replay reconcile stored facts without changing asset metadata or deleting rows. Repeated and concurrent target claims are no-ops. Unsupported original MIME types remain in the delivery catalog but cannot create an invalid image availability event.

Test validity corrections replace fixed sleeps with bounded acknowledgement/projection conditions. Variant fixtures now have different colors, and decoded pixels prove which source was selected. Forcing the catalog to return no variant fails the corrected selection test even though the output dimensions remain correct. The former trace-header test no longer claims to prove propagation; the production telemetry test does that.

Temporary mutations removing the production tracer, logger, Effect metric producer, and HTTP incoming-context bridge each fail the telemetry composition contract. All mutations were restored before normal validation.


### Standards review

The first pass found three P2 issues: missing resize diagnostics/lifetime tracing, an idle PostgreSQL error printed outside owned telemetry, and incomplete event identity/outcome annotations. Each was fixed in a focused commit. The second pass reported **zero remaining findings**, including no actionable smell-baseline findings.

### Spec review

The first pass found one P2 issue: an uninterruptible PostgreSQL transaction could exceed the consumer shutdown deadline. A real lock-contention test reproduced it. Connections now close on interruption or the total operation deadline; PostgreSQL checks closed sockets while blocked. Real PostgreSQL and composed NATS/PostgreSQL tests prove connection release, rollback/replay, and retained unacknowledged input. The second pass reported **zero remaining findings**.

### Independent deep review

The user-requested review covered security, tautological/incorrect tests, feature regressions, bugs, and general quality beyond the guidelines. Both passes reported **zero actionable findings**. Reviewers were independent and read-only; these results do not establish absence of defects.

### Final verification

`make check PACKAGE=media` passes build, lint, types, and architecture checks. All 151 Media tests pass across 18 files. `make check-crap PACKAGE=media CRAP_THRESHOLD=30` reports zero of 103 functions above 30; maximum CRAP is 28.012 for metadata translation (baseline maximum 52.188). Coverage includes all production source: 92.74% lines/statements, 92.65% branches, 80.39% functions. Callback/generator attribution limitations remain those tracked in #217.

The production Dockerfile builds successfully and starts the complete emitted artifact as its non-root service user, including deferred chunks and the native resize worker. `/ready` and all `/health` checks pass against the real local stack.

Local validation required a readable temporary copy of the public PostgreSQL init SQL because this worktree's bind-mount permissions are restrictive. The first full CI attempt lacked the local application stack; the next passed browser authentication/upload but exposed the test-utils suite's existing Docker Desktop socket assumption. The Linux run uses `GITHUB_ACTIONS=true` and a temporary Turbo wrapper with `--env-mode=loose` so that setting reaches child tests. No repository assertions or test retry settings were weakened.

Full local CI passed after that environment adjustment: 73 build/check/test tasks and 10 E2E/dependency tasks, in 333 seconds excluding prerequisite checks. Browser authentication, login, and upload passed against the running stack. The production-container recording and independently decoded responses are documented in [the evidence report](../docs/evidence/media-effect.md).
