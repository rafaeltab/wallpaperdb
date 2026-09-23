# Ingestor deployment tests

Verifies that the built Ingestor artifact accepts wallpaper uploads and connects correctly to its deployed dependencies. Tests use public HTTP and event contracts without importing application code.

The suite covers telemetry SDK initialization, service readiness, documentation availability, authentication, safe upload rejection, durable asset storage, event publication, and duplicate upload identity. Capability decisions and infrastructure edge cases are tested at their owning interfaces in the Ingestor workspace.

Testcontainers supplies isolated PostgreSQL, SeaweedFS, NATS, and application containers. Sharp generates a small valid wallpaper fixture, and native HTTP clients exercise the deployed interface.
