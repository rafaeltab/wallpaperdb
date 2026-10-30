# Test containers

Shared NATS and OpenSearch containers provide setup beyond upstream defaults.

- NATS enables JetStream and waits for its health endpoint before tests connect.
- Single-node OpenSearch supports configurable security and rejects weak custom passwords before startup.

See the [exports](src/index.ts) and [tests](test) for connection details, configuration, and lifecycle controls.
