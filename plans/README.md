# Candidates left from old plans

Active work belongs in [GitHub Issues](https://github.com/rafaeltab/wallpaperdb/issues). These are unresolved intentions recovered during the documentation cleanup, not approved designs or claims that a feature is missing today. Before starting one, check current code and issues, then create or update a ticket with a concrete outcome. Remove its entry here once the ticket captures it or the idea is declined.

Completed plans and implementation transcripts remain in [Git history][history]. ADRs retain accepted decisions; [coding standards](../CODING_STANDARDS.md) retain requirements. Optional feature wishlists in old plans are historical ideas, not a second roadmap.

## Production readiness

[Issue #11](https://github.com/rafaeltab/wallpaperdb/issues/11) leaves the deployment platform undecided. Carry these requirements into that work without assuming Kubernetes or a particular secret manager:

- Back up PostgreSQL, object storage, and JetStream to independent storage. Preserve object content, MIME types, and metadata; retain recoverable versions after deletion or corruption. Rehearse a coordinated restore, alert on backup failures, and measure recovery time and acceptable data loss before committing to targets. Decide whether Redis and OpenSearch need backups or tested rebuilds. [Original backup proposal][backups].
- Provision production credentials outside source control, define rotation, enable OpenSearch security, and set broker authentication, TLS, and least-privilege subjects. Local development defaults are not production credentials. [Secrets proposal][secrets] and [broker research][events].
- Add infrastructure and Variant Generator visibility, database-pool and consumer-lag alerts, GraphQL failure alerts, and owned service objectives. Configure notification destinations and prove delivery. Reassess old sample thresholds against measured traffic. [Monitoring proposal][monitoring].

## Security work to scope

- Add dependency scanning and update automation, with a policy for high/critical findings and exceptions. The old proposal called for failing CI on those findings and documenting the security policy. [Dependency proposal][dependencies].
- Define HTTP security headers and service-specific CSP, enable HSTS only on production HTTPS, and test the responses. Decide whether services or ingress own each header. [Header proposal][headers].
- Reassess the old validation audit against current adapters and capabilities. Cover malformed IDs, storage references, filenames, event payloads, dimensions, formats, and pagination without rejecting valid inputs. Preserve safe errors and validation diagnostics. Existing validation means the old audit is not a current vulnerability report. Concrete Gateway gaps already have [#219](https://github.com/rafaeltab/wallpaperdb/issues/219) for color bounds and [#218](https://github.com/rafaeltab/wallpaperdb/issues/218) for admission guarantees. [Validation proposal][validation].

## Event contracts and projection recovery

The Effect migrations preserve legacy bucket/key fields in public wallpaper events. Replacing these with logical asset references requires coordinated producer, consumer, and retained-history migration; keep replay compatibility explicit. Decide whether enrichment is an independent reaction or a required user-visible workflow before introducing orchestration. Accepted delivery and ordering rules already live in [distributed interactions](../docs/coding-standards/distributed-interactions.md) and [NATS guidance](../docs/coding-standards/nats.md). [Original domain questions][events].

[Issue #162](https://github.com/rafaeltab/wallpaperdb/issues/162) owns event retention, privacy/deletion, backups, and projection rebuild strategy. The old [OpenSearch migration proposal][search] adds uninterrupted reads/writes during index changes, catch-up validation before cutover, and recoverable rollback. Its seven-day rollback window was a proposal. Select the deployment platform and rebuild source before choosing an operator, dual writes, or replay; do not treat the deleted Kubernetes implementation sketch as an accepted architecture.

## Verification gaps to reassess

The [Ingestor migration audit][ingestor] recorded missing positive JPEG/WebP and dimension-boundary cases, legacy intent-expiry selection, application worker activation, and stored-event retry timing. It also distinguished Docker smoke tests from proof of deployed Clerk/Redis/OTLP integration, downstream completion, recovery across processes, and crash boundaries. Check current coverage before turning these into tickets.

The [Color Extractor audit][color] recorded untested lost-publication-acknowledgement ambiguity and elapsed heartbeat behavior. Oversized quarantine records can remain pending for operator repair; decide whether that recovery needs further tooling or tests. These are recorded limitations, not newly reproduced failures.

Repository-wide Vitest migration and CRAP callback/generator attribution already have [#201](https://github.com/rafaeltab/wallpaperdb/issues/201) and [#217](https://github.com/rafaeltab/wallpaperdb/issues/217).

[history]: https://github.com/rafaeltab/wallpaperdb/tree/46dea0b02936809cf0d03e57c8275622471d10de/plans
[backups]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/backup-disaster-recovery.md
[secrets]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/secrets-management-production.md
[monitoring]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/monitoring-alerting-improvements.md
[dependencies]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/dependency-vulnerability-scanning.md
[headers]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/security-headers.md
[validation]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/input-validation-injection-prevention.md
[events]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/docs/research/event-driven-hexagonal-architecture.md
[search]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/backlog/opensearch-migration-system.md
[ingestor]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/ingestor-effect-migration.md
[color]: https://github.com/rafaeltab/wallpaperdb/blob/46dea0b02936809cf0d03e57c8275622471d10de/plans/color-extractor-effect-migration.md
