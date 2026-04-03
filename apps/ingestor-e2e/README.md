# ingestor-e2e

End-to-end test suite for the Ingestor service that verifies production behaviour by running the service exclusively as a Docker container — never in-process.

## Key Capabilities

- Verifies the full upload flow against real infrastructure: the Docker-containerised Ingestor, PostgreSQL, MinIO, and NATS must all respond correctly before a test passes
- Confirms side effects directly — S3 object creation, database record state, and NATS event publication are each asserted independently, so no mocked infrastructure can produce a false pass
- Tests idempotency and duplicate-upload detection end-to-end
- Tests the reconciliation system by injecting deliberately stuck or incomplete database states and waiting for the background jobs to correct them
- Tests distributed rate limiting by launching multiple Ingestor instances backed by a shared Redis store and verifying that per-user quotas are enforced across instance boundaries
- Structurally prevents any import of application source code via an ESLint rule scoped to this package — all interaction with the service is over HTTP

## Technology Choices

- **undici** — low-level HTTP client used for all requests to the containerised service; chosen to avoid any abstraction that could mask real network behaviour
- **testcontainers** — manages the Ingestor Docker image and all infrastructure containers within each test run
- **sharp** — generates valid test images of controlled dimensions and formats for upload scenarios
- **`@wallpaperdb/test-utils` TesterBuilder** — composes infrastructure builders (PostgreSQL, MinIO, NATS, Redis, Docker) and the `ContainerizedIngestorTesterBuilder` into a single declarative test setup
