# Event contracts

Shared event schemas and messaging helpers let services exchange facts without importing each other's application code.

## Core capabilities

- Defines shared contracts for wallpaper uploads, variants, extracted colors, and Profile changes.
- Validates published and received events against the same schemas.
- Carries trace context across NATS JetStream messages and records publishing and consumption metrics.
- Handles acknowledgments, processing retries, invalid messages, and consumer shutdown, with hooks for application-specific failure handling.

Changes affect independently deployed producers and consumers. Follow the [distributed interaction rules](../../docs/coding-standards/distributed-interactions.md) for compatibility, occurrence identity, and delivery guarantees. The [schemas](src/schemas/index.ts) are the event reference.
