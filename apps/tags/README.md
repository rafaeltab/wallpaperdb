# @wallpaperdb/tags

Provides the initial service shell for future tagging work.

## Key Capabilities

- Starts a Fastify service with OpenAPI plus health and readiness endpoints
- Connects to PostgreSQL and NATS so domain behavior can be added later
- Intentionally does not expose tag-specific routes or define a persistence schema yet

## Technology Choices

- **Fastify + TSyringe** to match the existing service pattern and keep service scaffolding uniform
- **PostgreSQL + NATS** wiring retained as infrastructure shell only
- **OpenTelemetry** for consistent service observability
