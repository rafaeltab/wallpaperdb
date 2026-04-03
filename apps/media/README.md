# Media Service

Serves wallpapers to clients with on-demand resizing, consuming upload events from the ingestor to build and maintain its local catalog.

## Capabilities

- Streams wallpaper files directly from object storage to clients with minimal memory overhead
- Resizes images on demand using three fit modes: contain (preserve aspect ratio), cover (crop to fill), and fill (stretch to exact dimensions)
- Selects the smallest pre-generated variant that satisfies the requested dimensions before applying any final resize transform, reducing processing cost and bandwidth
- Falls back transparently to the original file when a referenced variant is unavailable in storage
- Emits immutable, long-lived cache headers suitable for CDN delivery
- Builds and maintains its local wallpaper and variant catalog by consuming domain events over NATS JetStream
- Returns RFC 7807 problem details for error responses

## Technology

- **Sharp** — streaming image processing pipeline with decompression bomb protection
