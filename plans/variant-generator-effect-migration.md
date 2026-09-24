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
- [ ] Implement Effect capability and tests.
- [ ] Implement bounded image and event adapters with real infrastructure tests.
- [ ] Migrate composition, HTTP, configuration, telemetry and executable lifecycle.
- [ ] Replace DI-based tests and audit all deleted paths.
- [ ] Run service checks, full CI, coverage and CRAP threshold 30.
- [ ] Review entire migration against base on Standards and Spec axes, fix findings, repeat as needed.
- [ ] Demonstrate real generation through running artifacts and record video.
- [ ] Push and open PR with validation and accessible video evidence.

## Baseline

Measured 2026-09-24 before implementation. `make test-integration PACKAGE=variant-generator FORCE=1` passed 24 tests in two files, Vitest 4.95 seconds, Turbo 6.227 seconds. `make check PACKAGE=variant-generator` passed build, lint and types, Turbo 2.158 seconds. `make crap PACKAGE=variant-generator` reported 32 inventoried functions, maximum 52.188 for createApp, one above threshold 30. The report command returning success does not imply threshold compliance.

Whole-source V8 coverage: 579/763 lines and statements, 75.88%; 27/33 functions, 81.81%; 60/73 branches, 82.19%. Coverage includes all source TypeScript except declarations and tests. The shared CRAP callback/generator inventory limitation remains relevant; scores supplement behavior review.

Baseline tests cover formats/presets/skips via concrete service calls, but do not exercise actual consumer delivery, failed publication, cancellation, startup rollback or shutdown. They assert nominal metadata dimensions without decoding generated images.
