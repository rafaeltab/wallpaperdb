# Wallpaper

Wallpaper reserves the service boundary for wallpaper creation, publication, and contributor ownership. This foundation runs independently of Ingestor and exposes operational endpoints; Wallpaper behavior will arrive in later tickets.

## Current capabilities

- Reports PostgreSQL, NATS, and telemetry health without requiring domain tables.
- Checks the required database and broker connections before reporting readiness.
- Exports traces, logs, and metrics to the shared telemetry pipeline.
- Lets active HTTP requests finish within a shutdown deadline, then cancels remaining work and releases connections and telemetry resources.

Fastify provides HTTP and Effect scopes the running resources. The service has no schema, business endpoints, consumers, object storage, or image processing. It does not replace or transfer Ingestor behavior.

See the [implementation spec](https://github.com/rafaeltab/wallpaperdb/issues/456) for the owning context and future workflows, and [contributor setup](../../CONTRIBUTING.md) for development and validation.
