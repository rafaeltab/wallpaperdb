# Media Service

Serves wallpapers with on-demand resizing and immutable Profile pictures from private object storage. Domain events maintain local delivery catalogs.

## Capabilities

- Streams wallpaper files directly from object storage to clients with minimal memory overhead
- Resizes images on demand using three fit modes: contain (preserve aspect ratio), cover (crop to fill), and fill (stretch to exact dimensions)
- Selects the smallest pre-generated variant that satisfies the requested dimensions before applying any final resize transform, reducing processing cost and bandwidth
- Falls back transparently to the original file when a referenced variant is unavailable in storage
- Emits immutable, long-lived cache headers suitable for CDN delivery
- Builds and maintains its local wallpaper and variant catalog by consuming domain events over NATS JetStream
- Serves sanitized WebP Profile pictures at `/profile-pictures/:pictureId` (externally under `/media`) using private storage metadata from Profile events
- Applies Profile snapshots by version, preserving the latest current picture through duplicate and out-of-order events
- Checks the User service on every Profile picture origin request, including HEAD, so retired pictures stop delivering even before their events arrive
- Keeps missing pictures and authority or storage failures uncached so clients can retry; successful picture responses use immutable caching
- Returns RFC 7807 problem details for error responses

## Profile picture authority

Set `USER_SERVICE_URL` to the User service origin and share `USER_MEDIA_SERVICE_TOKEN` with that service. Media sends the token to the internal availability endpoint before reading picture bytes. Missing configuration, unavailable authority, and rejected authentication fail closed. Storage locations and credentials never appear in public responses.

User owns picture processing, retirement, and private retention. Media retains catalog metadata but delivers only the current, authorized asset. Previously downloaded immutable copies remain cacheable; retirement prevents new origin delivery.

## Technology

- **Sharp** — streaming image processing pipeline with decompression bomb protection
