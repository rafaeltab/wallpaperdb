# Ingestor

Accepts wallpaper file uploads, validates them against content-based rules, persists them to object storage, and publishes domain events to trigger downstream processing.

## Capabilities

- **Upload durability** — implements a write-ahead state machine to guarantee that every upload is either fully committed or recoverable across partial failures; each stage of the upload pipeline is persisted to the database before the next stage begins
- **Content-based validation** — detects actual file formats from binary content rather than trusting client-supplied MIME types or filenames; rejects files that misrepresent their format, exceed dimension limits, or exceed size limits
- **Deduplication** — computes a SHA-256 content hash at upload time and rejects files whose content already exists for that user, preventing redundant storage and processing work
- **Eventual consistency** — background reconciliation workers recover stuck uploads, republish lost domain events, and remove orphaned records or storage objects; all workers use PostgreSQL row-level locking so multiple service instances can run safely without coordination
- **Per-user rate limiting** — enforces upload frequency limits per user using an atomic operation in Redis, with a graceful in-memory fallback when Redis is unavailable

## Notable Technology Choices

- **Sharp** — used for image metadata extraction and decompression-bomb protection; pixel limits are enforced at decode time rather than after full file load
- **file-type** — inspects raw bytes to determine the actual file format, independent of what the client claims
- **RFC 7807 Problem Details** — all error responses use structured `application/problem+json` bodies, enabling clients to handle specific error conditions programmatically
