# Shared infrastructure

Shared infrastructure for WallpaperDB services, so each service can reuse connection management and operational conventions while keeping its business decisions local.

## Core capabilities

- Manages connection startup, health checks, and shutdown for databases, object storage, messaging, search, and telemetry.
- Validates infrastructure configuration and reports service health, readiness, and liveness.
- Provides consistent tracing, metrics, structured errors, and OpenAPI documentation across services.
- Registers and resolves immutable asset references without allowing an existing identity to be reassigned.
- Plans bounded quarantine records and validates replay evidence, preserving original event identity and metadata across retries and retained record formats.
- Lets tests advance scheduled work without freezing the timers used by real infrastructure clients.

The [asset reference module](src/assets/index.ts) implements the [immutable asset ownership decision](../../docs/adr/0008-resolve-assets-through-stable-object-layouts.md). The [quarantine module](src/quarantine/index.ts) shares record planning, receipt verification, and safe replay decoding; applications retain ownership of connections, retention, retry policy, and acknowledgement. Follow the [upgrade and replay procedures](../../apps/docs/content/docs/guides/service-upgrades.mdx) when recovering retained work.

A helper belongs here when consumers share its semantics, as described in the [module organization guidelines](../../docs/coding-standards/project-organization.md#module-organization). See the [package exports](package.json) for the available entry points.
