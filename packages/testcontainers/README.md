# Test containers

Shared NATS and OpenSearch containers give integration tests the same readiness and connection behavior across workspaces. They cover setup that the upstream containers do not provide directly.

## Core capabilities

- Starts NATS with JetStream support and waits for its health endpoint before tests connect.
- Starts a single-node OpenSearch instance with configurable security and rejects weak custom passwords before startup.
- Supplies connection details and container lifecycle controls for test infrastructure.

See the [public exports](src/index.ts) and [container tests](test) for configuration and usage.
