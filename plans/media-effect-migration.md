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

To be updated as work completes.
