# Ingestor

Ingestor accepts authenticated wallpaper uploads, validates their contents, and makes originals durably available for downstream processing. It owns recovery when storage or messaging fails partway through an upload.

## Core capabilities

- Validate image content, size, and dimensions independently of the client's filename and declared format.
- Associate uploads with their authenticated owner and reuse that owner's existing content when an upload is repeated.
- Preserve upload progress across failures and durably announce stored originals for enrichment and discovery.
- Recover interrupted uploads across service replicas and retain exhausted announcements for investigation.
- Remove orphaned assets while preserving originals belonging to active uploads.
- Enforce per-owner upload quotas.

## Technology choices

File-type identifies formats from the uploaded bytes. Sharp reads image metadata with decompression limits before Ingestor accepts an image.

See the [domain context](GLOSSARY.md) for acceptance rules and the [durable publication decision](docs/adr/0001-effect-ingestion-and-durable-publication.md) for recovery guarantees.

## Testing

The [unit selection](vitest.config.ts) runs Ingestion with controlled storage, inspection, and event adapters, admission with an in-memory quota, availability, recovery workers, configuration, and HTTP contracts with controlled ports. The integration selection retains production adapters, native inspection, application composition, and telemetry. SDK instrumentation still runs in a separate isolated process.

The [workspace scripts](package.json) expose both selections with coverage and retain `test` for the complete suite. Run them through the [Make workspace selectors](../../Makefile). The [root coverage script](../../package.json) combines `coverage/unit` and `coverage/integration` for CI.
