# Event contracts

Shared event schemas and envelope validation let services exchange facts without importing each other's application code.

## Core capabilities

- Defines shared contracts for wallpaper uploads, variants, extracted colors, and Profile changes.
- Validates published and received facts while preserving support for retained event formats.
- Identifies shared immutable assets through logical references instead of exposing storage addresses in new events.
- Reconciles structured and binary CloudEvent metadata, rejecting conflicting or repeated occurrence, correlation, and causation fields.

Applications supply their existing metadata decoder and own accepted source and time values, normalization, domain translation, and legacy source fallback. They also own broker connections, publication, retries, quarantine, acknowledgements, and shutdown; this package does not run consumers or publishers.

Changes affect independently deployed producers and consumers. Follow the [distributed interaction rules](../../docs/coding-standards/distributed-interactions.md) for compatibility, occurrence identity, and delivery guarantees. The [schemas](src/schemas/index.ts) and [envelope reconciliation module](src/envelope/index.ts) are the contract references; [package exports](package.json) define their public entry points.
