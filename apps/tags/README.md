# Tagging

This workspace reserves the service boundary for wallpaper classification. It is an operational skeleton; tagging behavior has not been defined or implemented.

## Current capabilities

- Reports PostgreSQL, NATS, and telemetry health so operators can inspect its dependencies.
- Reports readiness separately from dependency health, including startup and shutdown state.
- Exposes its operational API documentation and exports traces, logs, and metrics.
- Gives active requests time to finish during shutdown, then cancels remaining work and releases its connections.

Fastify provides the HTTP interface, and Effect scopes application resources to each running service instance. The PostgreSQL and NATS connections currently support operational checks; the service does not store tags or process classification events.

Resolve its [domain language and ownership](CONTEXT.md) before adding classification features. Follow [contributor setup](../../CONTRIBUTING.md) to run and check the workspace.
