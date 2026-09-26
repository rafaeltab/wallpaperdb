# User service Effect migration

Base: `e8c07dd4faf254b303d92d86169ae819435632ff`. Branch: `t3code/user-service-effect-migration`.

The user requested migration to Effect and the current coding guidelines, TDD, small commits, the code-review skill, and a separate in-depth review. The handoff at `/tmp/wallpaperdb-service-effect-migration-handoff.md` supplies the delivery requirements.

## Baseline

`make test-focused PACKAGE=user ARGS='--coverage'` passed all 161 tests in 12 files. `make crap PACKAGE=user` reported maximum CRAP 90 for picture retention, 42 for event retention, and 31.557 for picture decoding, above the threshold of 30. Reports were captured before migration in `/tmp/user-baseline-tests.log` and `/tmp/user-baseline-crap.log`.

## Preservation contract

| Responsibility | Contract | Evidence to retain or add |
| --- | --- | --- |
| Identity and owner authorization | Authenticated Clerk ID is the Profile ID. Existing ensure avoids an identity lookup. First ensure normalizes display name, claims a unique nonreserved handle, atomically records its event and optional initial-picture job. | Existing profile cases; controlled capability tests; real PostgreSQL concurrent ensure. |
| Profile edits | Normalize display name; enforce Unicode lengths and Markdown policy, owned published wallpaper embeds, positive expected version, optimistic concurrency, and unchanged-value no-ops. | Existing profile matrix mapped to capability and database adapter cases. |
| Handles and aliases | Preserve normalization, reserved names, seven-day cooldown, one-day expiry grace, retained alias limit, claim generations, recent-history reactivation, and stale-expiry fencing. | Exact boundary, concurrent claim, and event-snapshot assertions. |
| Profile events | State and event commit together. Preserve complete profile snapshots, event IDs on retries, subjects, and CloudEvents contracts; mark published only after PubAck. Retain unpublished evidence. | Real PostgreSQL/NATS publication and retry tests. |
| Biography ownership projection | Accept uploaded wallpaper ownership durably before acknowledgement; duplicates do not change ownership. | Real broker and database replay tests. |
| Pictures | Validate bytes, decoded cost, animation, source URL and redirect rules; preserve immutable WebP asset IDs and keys, staged-before-PUT recovery, version checks, import lease fencing, privacy, active-picture availability and retirement retention. | Existing picture matrix; real storage tests; crash/lease cases. |
| Maintenance | Bounded batches; a failed item does not starve later work. Stop new work during shutdown and release resources even after failures. | Worker lifecycle and retention adapter tests. |
| HTTP | Preserve success payloads and status distinctions. Use the current Problem Details URI convention and safe error bodies consistently. | Driving adapter contract tests. |
| Operations | Health/readiness, deferred telemetry initialization, trace context, Effect metrics, scoped startup rollback, graceful shutdown and deadline cancellation. | Replace tautological health test; production-composition and built-artifact tests. |

## Intentional corrections

- Restrict development credentialed CORS to exact local origins; current regex accepts lookalike hosts.
- Translate all failures into safe Problem Details using the repository's stable URI convention.
- Separate S3 side effects from PostgreSQL transactions through durable upload/deletion states.
- Replace global TSyringe wiring and timer workers with owned Effect Layers and scoped tasks.
- Repair partial-startup cleanup and bound shutdown of the underlying resources.

## Work sequence

1. Establish baseline, contracts, and dependencies.
2. Migrate Profile policy and its atomic persistence/identity adapters with TDD.
3. Migrate picture admission, storage/import, and retention with durable recovery states.
4. Migrate event publication, ownership consumption, and maintenance scheduling.
5. Replace HTTP/composition/bootstrap, telemetry and health; remove obsolete wiring.
6. Run focused checks, complete coverage/CRAP and repository CI.
7. Run independent Standards and Spec reviews against the pinned base, plus the requested in-depth review; reproduce and fix valid findings, then repeat.
8. Record the real feature, publish the PR and evidence, verify remote checks, and stop task-owned resources.

## Review and validation log

The first complete migrated suite passes 214 tests across 23 files. `make check PACKAGE=user` passes the build, lint, type checker and architecture dependency check. Coverage still includes every production source file.

The original 78 Profile integration cases map to 71 retained command scenarios and the replacement maintenance/event adapter contracts. The picture command suite retains its original 25 cases and adds expiry/import boundary evidence. The former timer tests map to scoped-worker tests for nonoverlap, failure recovery, graceful completion, shared shutdown deadlines and interruption. The literal-true health test is replaced with dependency and shutdown assertions.

The migration also corrects two existing invariant failures. Truncating a generated Handle at a hyphen could leave it shorter than the configured minimum; generation now pads the normalized result. Mutation acceptance time is captured after acquiring the Profile row lock, so waiting commands cannot adopt pictures after their deadline using a stale pre-lock timestamp.

Initial picture imports now stop after twelve attempts and erase the captured private URL. The Profile remains usable with its fallback picture and accepts a manual upload. Existing exhausted jobs clear their URL without making another network request. This intentionally replaces indefinite retry. Event and picture retention retain their original one-second cadence, with bounded batches and no overlapping cycles.

Database cancellation was tested with a real blocked server query. Destroying the client socket did not stop PostgreSQL work, so the resource now uses a separate bounded cancellation connection to terminate its own leased backend. HTTP tests prove partial startup rollback, normal completion during shutdown, interruption at the deadline and cancellation after client disconnect.

Telemetry tests use the production graph, SDK/exporters and real PostgreSQL/NATS. They verify test-owned SDK/Effect spans, structured logs, a monotonic Effect counter and incoming trace context. Independently disconnecting the production tracer, HTTP context bridge and Effect metric producer fails the corresponding assertions. Every mutation was restored. The native picture cancellation test likewise detects omission of process termination. PostgreSQL failures are sanitized before span/log recording; tests use distinctive private URL markers in actual trigger failures to detect disclosure.

Production build verification exercises the emitted picture encoder. The Docker image build also caught and removed a legacy dependency overlay that would have replaced the service's new telemetry packages with the core package's older SDK.

The local PostgreSQL initialization bind mount was unreadable to Docker. A readable temporary copy of public SQL and NATS initialization scripts, selected through `/tmp/user-infra-override.yml`, repairs this environment without changing tracked infrastructure or deleting volumes. The task's Compose project is `wallpaperdb-t3code-user-service-effect-migration`; other worktree stacks remain untouched.

## Independent review, round one

All reviewers used the original pinned base and reviewed the full branch. The Standards and Spec axes ran separately under the code-review skill. A third reviewer received the user's exact deeper-review prompt.

### Standards

1. Full runtime configuration retained unrelated secrets in capability closures. Fixed by constructing explicit Profile/Picture policies, adapter configurations, HTTP configuration and telemetry configuration.
2. Capability picture models exposed bucket/key addresses. Fixed by using logical asset identities and resolving durable addresses in adapters. Event storage metadata remains compatible, and a real S3/PostgreSQL test checks recorded addresses survive configuration changes.
3. Most policy tests still used the full production graph. Moving business matrices to controlled capability adapters, retaining real persistence guarantees and representative composition coverage.
4. Picture-import failures could produce healthy worker results, and identity/storage failures lacked operational signals. Added last-operation health gauges and alerts which retain failures through idle periods and retry backoff. Import batch results now report technical failures.
5. A duplication heuristic identified three copies of maintenance cursor handling. Replaced them with one private batch processor. Existing poison-page, ambiguous-completion, shutdown and retention-cutoff tests pass before and after the refactor.

### Spec

1. Automatic instrumentation bypassed private-URL sanitization. Fresh-process production-export tests reproduced private fetch URL attributes and PostgreSQL span status messages containing trigger diagnostics. Disabled those two automatic instrumentations while retaining explicit Effect adapter spans and safe diagnostics. Both regression tests fail with the old wiring and pass after the fix.
2. Import claim or settlement failure aborted the batch and could starve later work. Adding per-item recovery and cursor fairness tests, including work beyond a full failed page.

### Deep review

1. Independently confirmed the automatic fetch URL leak above. PostgreSQL exception events were sanitized, but the additional production test established that span status messages were not.
2. A replica's local failed-delivery set stayed unhealthy after another replica successfully retried and acknowledged the delivery. A real PostgreSQL/NATS two-runtime regression reproduced the failure. Bounded sequence tracking now reconciles with the shared durable acknowledgement floor.
3. Collision Handle generation could still trim below the configured minimum after adding its suffix. A controlled real-collision regression now covers the equal minimum/maximum boundary; the first-attempt fix alone was insufficient.

The first round reported four Standards violations and one heuristic, two Spec findings, and three deep-review findings. The private URL finding overlaps across reviewers. All confirmed findings are being fixed before the next full review.

The same review work found that Clerk transport exceptions could carry private diagnostics. A marked exception test failed before boundary sanitization and now passes. Identity failures retain only safe response status/category and have an explicit adapter span.

## Validation environment

A fresh CRAP run after the first implementation reports zero of 196 functions over 30. This must be repeated after review fixes. The first repository CI attempt collided with a separately launched User coverage job; rerunning without overlapping coverage avoided the missing temporary coverage file. The next run passed all 73 build/check/unit/integration tasks, then the browser auth setup timed out. Its trace contains a Clerk development initialization `Failed to fetch` error before any sign-in POST. Browser validation will be repeated after Docker test activity ends; assertions and retry settings remain unchanged.

## Independent review, round two

Reviewed `fc5d22a50e6678cb119c08ee59dce0d17987b263` against the original base. Standards reported one remaining observability violation; Spec reported zero findings. The deep reviewer reported one false-recovery issue in the new dependency metric.

- Picture address resolution translated a database failure without recording its diagnostic cause. Real PostgreSQL regressions through both public object operations failed because no diagnostic was recorded. The resolver now has an adapter span and records exactly one sanitized SQLSTATE diagnostic.
- A rejected local source URL or an already-absent picture row incorrectly reset dependency health to healthy without external work. Both failure/no-op/recovery sequences failed before the fix. Only an actual successful download or storage request now records recovery.
- The follow-up audit found raw vendor diagnostics in event persistence errors. A real publication trigger reproduced a marked diagnostic in logs. Event storage and outbox reads now use the shared safe SQLSTATE translator, and event persistence has explicit adapter spans.

The capability-test split is complete. Profile policy runs through controlled stateful adapters; PostgreSQL tests retain exact history deadlines, typed history references, claim races, atomic snapshots and rollback evidence. Picture policy, HTTP parsing, real storage/lease recovery and production composition use separate suites. HTTP version parsing tests were mutation-checked: temporarily coercing string versions made all four replacement command matrices fail, then the exact source was restored.

Fresh coverage at the second-round head passed 253 tests in 29 files, with zero of 202 functions over CRAP 30. Final checks must include the subsequent observability fixes. Browser sign-in now succeeds without changing assertions or retry configuration, and the repository CI browser suite passes all three tests.
