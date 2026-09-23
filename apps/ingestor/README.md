# Ingestor

Accepts authenticated wallpaper uploads and makes validated originals durably available for downstream processing. It owns upload acceptance and recovery across partial storage or messaging failures.

## Capabilities

- Validates file format from content, enforces size and dimension limits, and sanitizes filenames.
- Associates uploads with their authenticated owner and reuses existing content for that owner.
- Preserves recoverable upload progress and reliably announces stored originals.
- Coordinates recovery across service replicas and retains exhausted announcements for investigation.
- Removes orphaned assets while preserving originals belonging to active uploads.
- Enforces per-owner upload quotas and reports service readiness.

## Notable technology choices

Sharp extracts image metadata with decompression limits. File-type detects formats from bytes independently of client filenames and MIME claims.
