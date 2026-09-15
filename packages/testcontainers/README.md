# @wallpaperdb/testcontainers

Custom Testcontainers implementations that provide ready-to-use, correctly configured Docker containers for integration and E2E tests across the WallpaperDB monorepo.

## Key Capabilities

- **NATS container** — starts a NATS server with JetStream enabled, waits for a confirmed health check before reporting readiness, and exposes a typed connection URL helper that avoids DNS resolution delays
- **OpenSearch container** — starts an OpenSearch node in single-node mode with configurable security, enforces password strength requirements before container startup, and exposes typed URL and credential accessors for both host and direct-IP access patterns

## Technology Choices

- **testcontainers** — manages Docker container lifecycle, health-check wait strategies, and port mapping within tests
- **zxcvbn** — enforces password strength scoring to satisfy OpenSearch's security plugin requirements at configuration time rather than at runtime

## NATS Readiness Tests

With Docker running, use `make nats-container-test` from the repository root to run only
the NATS container suite. Pass Vitest options through `TEST_ARGS`, for example:

```sh
make nats-container-test TEST_ARGS='--testNamePattern="should reject a running server"'
```

The suite checks NATS and JetStream immediately after startup without connection retries,
and rejects a running server with an unavailable health endpoint. Startup and configuration
tests have 60-second limits; the shared container's behavior tests have 10-second limits.
Readiness is based on server responses, not a wall-clock startup benchmark.
