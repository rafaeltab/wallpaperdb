[![codecov](https://codecov.io/github/rafaeltab/wallpaperdb/graph/badge.svg?token=E7C2BEISZR)](https://codecov.io/github/rafaeltab/wallpaperdb)

# WallpaperDB

A wallpaper management system built as an event-driven microservices platform. Users upload wallpapers; the system validates, stores, and enriches them, making them searchable and retrievable at any resolution.

## System Capabilities

- **Upload and validation** — accepts wallpaper uploads, validates them against content-based rules, and durably persists them with guaranteed eventual consistency across partial failures
- **On-demand and pre-generated resizing** — serves wallpapers at any requested resolution and pre-generates common resolutions so high-traffic sizes are immediately available without compute at request time
- **Enriched search** — maintains a queryable index of wallpapers with metadata, variant availability, and filtering support; query results include computed variant URLs resolved at read time
- **Event-driven enrichment pipeline** — domain events flowing through a durable message bus decouple upload from processing; downstream services consume events independently and contribute results back without tight coupling
- **Production observability** — all services carry distributed tracing and metrics with end-to-end propagation across service boundaries

## Technology

- **Turborepo + pnpm workspaces** — monorepo tooling that caches builds, tests, and linting across all services and shared packages; Turborepo task graphs express dependencies between workspaces
- **Fastify + TSyringe** — HTTP server framework with constructor-based dependency injection used consistently across all backend services
- **PostgreSQL + Drizzle ORM** — each service owns its own schema; Drizzle manages type-safe queries and schema migrations
- **MinIO (S3-compatible object storage)** — wallpaper files are isolated per upload in object storage, decoupled from the database records that describe them
- **NATS JetStream** — durable pub/sub messaging for event-driven coordination between services; JetStream provides at-least-once delivery guarantees
- **Vitest + Testcontainers** — tests run against real infrastructure containers (PostgreSQL, MinIO, NATS) in unit, integration, and E2E tiers with distinct contracts at each tier
- **OpenTelemetry + Grafana LGTM** — traces and metrics exported via OTLP to a Grafana stack; all services share a common telemetry abstraction from `@wallpaperdb/core`
- **Biome** — single tool for linting and formatting across the entire monorepo

## Navigating the Repo

Each workspace (`apps/*` and `packages/*`) has a `README.md` explaining what it is and why it exists. The documentation site at `apps/docs/content/docs/` contains architecture decisions, guides, and API documentation.

Agent skills in `.agents/skills/` provide process guidance for common development tasks such as creating a service, modifying the database schema, writing tests, and authoring READMEs.

## Coverage

![codecov](https://codecov.io/github/rafaeltab/wallpaperdb/graphs/tree.svg?token=E7C2BEISZR)
