# @wallpaperdb/tags

The Tagging service is an operational skeleton. It exposes `/health`, `/ready`, and OpenAPI at `/documentation`, with scoped PostgreSQL and NATS connections. It has no tag routes, persistence schema, publishers, or consumers.

Fastify runs requests through application-owned Effect ports. Composition owns dependency Layers; the executable owns telemetry and the HTTP listener. Each application instance has its own resources.

Health reports database, NATS, and telemetry checks. Healthy and degraded results return 200 for compatibility. Unhealthy and shutdown results return 503 Problem Details. Readiness reflects startup and shutdown state, independently of live dependency health. PostgreSQL connects lazily; NATS must connect before the listener starts.

Shutdown gives network requests five seconds to finish, then interrupts their effects and closes remaining sockets before releasing dependencies. Database probes have a five-second deadline and destroy checked-out clients on cancellation. NATS has no messages to drain because this skeleton does not publish or subscribe.

Use `make check PACKAGE=tags`, `make test-unit PACKAGE=tags`, and `make test-integration PACKAGE=tags`. Integration tests require Docker and exercise real PostgreSQL, NATS, the built executable, and telemetry. `make test-e2e PACKAGE=tags` builds the production image and verifies exported traces, logs, and metrics. `make run PACKAGE=tags SCRIPT=gen:swagger` generates the contract without external dependencies.

See [the migration record](../../plans/tag-service-effect-migration.md) for preservation decisions and validation evidence.
