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

Updates will record completed increments, review findings and final evidence here.
