# Shared infrastructure

Shared infrastructure for WallpaperDB services, so each service can reuse connection management and operational conventions while keeping its business decisions local.

## Core capabilities

- Manages connection startup, health checks, and shutdown for databases, object storage, messaging, search, and telemetry.
- Validates infrastructure configuration and reports service health, readiness, and liveness.
- Provides consistent tracing, metrics, structured errors, and OpenAPI documentation across services.
- Lets tests advance scheduled work without freezing the timers used by real infrastructure clients.

A helper belongs here when consumers share its semantics, as described in the [module organization guidelines](../../docs/coding-standards/project-organization.md#module-organization). See the [package exports](package.json) for the available entry points.
