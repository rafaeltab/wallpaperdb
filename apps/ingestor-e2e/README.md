# Ingestor deployment tests

Tests the built Ingestor through public HTTP and event contracts without importing application code. This catches packaging and deployment wiring errors that in-process tests cannot detect.

## Core coverage

- Verifies that the deployed service initializes telemetry and exposes health, readiness, and API documentation.
- Checks that uploads require authentication and invalid content receives a safe error response.
- Follows an accepted upload through durable object storage and publication of its upload event.
- Confirms that uploading the same content again returns the existing wallpaper identity without publishing another event.

Testcontainers starts isolated PostgreSQL, object storage, NATS, and application containers. The suite requires Docker and a built Ingestor image. It generates its own valid wallpaper fixture and calls the deployed service over HTTP.

Capability rules and adapter edge cases belong in the [Ingestor workspace](../ingestor/README.md). See [contributor setup](../../CONTRIBUTING.md) for repository test commands.
