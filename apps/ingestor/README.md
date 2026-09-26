# Ingestor

Ingestor accepts authenticated wallpaper uploads, validates their contents, and makes originals durably available for downstream processing. It owns recovery when storage or messaging fails partway through an upload.

See the [domain context](CONTEXT.md) for acceptance rules and the [durable publication decision](docs/adr/0001-effect-ingestion-and-durable-publication.md) for recovery guarantees.
