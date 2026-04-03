# Gateway

The read-optimized query layer for WallpaperDB. Exposes a GraphQL API for browsing and searching wallpapers by building and maintaining its own read model from domain events — it has no write path from clients.

## Key Capabilities

- **GraphQL search and retrieval** — provides `searchWallpapers` (with optional user and variant filtering, plus bidirectional cursor-based pagination) and `getWallpaper` queries
- **Event-driven read model** — consumes `wallpaper.uploaded` and `wallpaper.variant.available` events from NATS JetStream and projects them into an OpenSearch index, keeping the query layer in sync without polling or direct database access
- **Nested variant filtering** — wallpaper documents in OpenSearch use a nested type for variants, enabling precise filtering by variant dimensions, aspect ratio, and format independently of the parent document
- **Computed variant URLs** — the `url` field on each `Variant` is resolved at query time by constructing a request to the Media service, so variant URLs are never stale in the index
- **Layered GraphQL security** — enforces query depth limits, a weighted complexity budget, breadth and alias caps, batch request rejection, introspection control, and IP-based rate limiting with Redis
- **Tamper-resistant pagination cursors** — cursors are HMAC-SHA256 signed and carry an expiration timestamp; invalid or expired cursors are rejected before any search is executed

## Technology

- **Mercurius** — GraphQL server plugin for Fastify; chosen over Apollo for its tighter Fastify integration, built-in depth limiting, and lighter weight
- **OpenSearch** — the sole persistent store for this service; wallpaper documents are indexed with a `nested` mapping for variant objects to support independent nested queries
- **Redis** — backs the rate limiter with an atomic Lua script to prevent race conditions across replicas; falls back to an in-memory store when Redis is unavailable
- **TSyringe** — decorator-based dependency injection wiring all services, repositories, and connections as singletons
