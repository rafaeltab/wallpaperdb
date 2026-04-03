# @wallpaperdb/events

Shared event schemas and NATS JetStream pub/sub abstractions for inter-service communication across WallpaperDB.

## Key Capabilities

- **Typed event schemas** — Zod-validated schemas for all domain events, providing compile-time safety and runtime validation for both publishers and consumers
- **Trace context propagation** — OpenTelemetry trace context is injected into outgoing NATS message headers and extracted on receipt, enabling end-to-end distributed tracing across service boundaries
- **Structured publisher base** — `BaseEventPublisher` auto-generates event envelopes (ULID-based IDs, timestamps) and records publish metrics (counters, latency histograms)
- **Structured consumer base** — `BaseEventConsumer` handles schema validation, acknowledgment, configurable retry behaviour, and graceful shutdown; validation failures terminate immediately rather than retrying
- **Extensible error hooks** — consumers can override `onValidationError` and `onMaxRetriesExceeded` to route poison messages to a dead-letter queue or trigger alerting

## Technology Choices

- **Zod** — schema validation for both publisher output and consumer input, ensuring event contracts are enforced at runtime
- **NATS JetStream** — durable and ephemeral consumer support; explicit acknowledgment policy with configurable ack-wait and max-delivery counts
- **ULID** — lexicographically sortable identifiers for event envelopes, enabling ordered event tracing without coordination
