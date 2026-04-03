# @wallpaperdb/testcontainers

Custom Testcontainers implementations that provide ready-to-use, correctly configured Docker containers for integration and E2E tests across the WallpaperDB monorepo.

## Key Capabilities

- **NATS container** — starts a NATS server with JetStream enabled, waits for a confirmed health check before reporting readiness, and exposes a typed connection URL helper that avoids DNS resolution delays
- **OpenSearch container** — starts an OpenSearch node in single-node mode with configurable security, enforces password strength requirements before container startup, and exposes typed URL and credential accessors for both host and direct-IP access patterns

## Technology Choices

- **testcontainers** — manages Docker container lifecycle, health-check wait strategies, and port mapping within tests
- **zxcvbn** — enforces password strength scoring to satisfy OpenSearch's security plugin requirements at configuration time rather than at runtime
