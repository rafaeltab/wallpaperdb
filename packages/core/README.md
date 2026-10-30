# Shared infrastructure

WallpaperDB services share connection management and operational utilities through this package.

- Manages startup, health checks, and shutdown for databases, object storage, messaging, search, and telemetry.
- Validates infrastructure configuration and reports health, readiness, and liveness.
- Provides tracing, metrics, structured errors, and OpenAPI documentation.
- Registers and resolves immutable asset references without allowing identity reassignment.
- Plans bounded quarantine records and validates replay evidence, preserving event identity and metadata across retries and retained formats.
- Lets tests advance scheduled work without freezing real infrastructure clients' timers.

The [asset reference module](src/assets/index.ts) implements the [immutable asset ownership decision](../../docs/adr/0008-resolve-assets-through-stable-object-layouts.md). The [quarantine module](src/quarantine/index.ts) shares record planning, receipt verification, and safe replay decoding. Applications own connections, retention, retry policy, and acknowledgement. Follow the [upgrade and replay procedures](../../apps/docs/content/docs/guides/service-upgrades.mdx) when recovering retained work.

Share helpers only when consumers share their semantics. See the [module organization guidelines](../../docs/coding-standards/project-organization.md#module-organization) and [package exports](package.json).
