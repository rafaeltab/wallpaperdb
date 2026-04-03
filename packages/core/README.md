# @wallpaperdb/core

Shared infrastructure foundation for all WallpaperDB microservices, providing the connection lifecycle management, configuration, telemetry, error handling, health checks, and OpenAPI registration that every service needs without each one re-implementing the same plumbing.

## Key Capabilities

- **Lifecycle-managed connections** — consistent `initialize / close / checkHealth` interface for PostgreSQL (via Drizzle ORM), MinIO (S3-compatible), NATS JetStream, Redis, OpenSearch, and OpenTelemetry; services extend the base connection classes to add TSyringe DI decorators and inject their own Drizzle schema
- **Composable config schemas** — Zod schemas for each infrastructure dependency that services spread together into a single validated config object, plus utilities for safely reading typed values from environment variables
- **OpenTelemetry helpers** — `withSpan` / `withSpanSync` for automatic parent-child span relationships, counter and histogram one-liners, and a canonical `Attributes` dictionary that enforces consistent span and metric attribute names across all services
- **Structured error classes** — RFC 7807-compliant `ProblemDetailsError` for domain errors with HTTP semantics, and a simpler `ApplicationError` hierarchy with concrete subtypes for common HTTP error scenarios
- **Health aggregation** — `HealthAggregator` collects named health checks from all connections and produces Kubernetes-style readiness, liveness, and health responses with per-check timeouts and lifecycle state tracking
- **OpenAPI registration** — registers Swagger spec generation and Swagger UI in a single call, pre-populates the shared schemas for health, readiness, pagination, and RFC 7807 errors, and handles multipart form body documentation for services that accept file uploads
- **Testable timer abstraction** — a `FakeTimerService` with a synthetic clock and `tickAsync` lets integration tests drive scheduled jobs (such as reconciliation) to completion without wall-clock delays or side-effects on the timers used by infrastructure drivers

## Technology Choices

- **Zod** is used for all config and OpenAPI schema definitions, keeping config validation and API documentation in sync from a single source
- **`zod-to-json-schema`** converts Zod schemas to OpenAPI 3.0-compatible JSON Schema for spec generation
- **`@kubiks/otel-drizzle`** instruments Drizzle ORM queries with OpenTelemetry spans, capturing query text as span attributes
- **Source-only package** — exports point directly to TypeScript source files with no build step; consuming services compile it as part of their own build via Turborepo workspace dependencies
