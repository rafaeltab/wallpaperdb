# WallpaperDB - Project Plan

> **Last Updated**: 2025-11-23

Build a website for finding wallpapers with fast & rich filtering & searching capabilities.

---

## Progress Overview

| Step | Description | Status |
|------|-------------|--------|
| 1 | Setup local infrastructure | ✅ Complete |
| 2 | Determine a language to use | ✅ TypeScript + Fastify |
| 3 | Implement simple wallpaper upload & retrieval | ✅ Ingestor complete |
| 4 | Implement simple UI for uploading | 📋 Not started |
| 5 | Implement wallpaper ownership with authentication | 📋 Not started |
| 6 | Implement basic query service | 📋 Not started |
| 7 | Implement browse UI | 📋 Not started |
| 8 | Add service for image quality in query service | 📋 Not started |
| 9 | Add service for image color in query service | 📋 Not started |

---

## Current Focus

**👉 Next Step: OpenAPI Integration**

Detailed plan: **[openapi-integration.md](./openapi-integration.md)**

Add reusable OpenAPI support to `@wallpaperdb/core`, then integrate with Ingestor.

**After that:** Build Media Service - **[media-service.md](./media-service.md)**

Use **TDD approach**: Write tests first, then implement.

---

## Detailed Plan

### Completed ✅

1. **Local Infrastructure** - Docker Compose with PostgreSQL, MinIO, NATS, Redis, OpenSearch, Grafana
2. **Language & Stack** - TypeScript, Fastify, TSyringe, Drizzle ORM, Vitest
3. **Ingestor Service** - Full upload workflow with state machine, reconciliation, telemetry

### In Progress 🔶

- **Observability** - ~80% complete, need Infrastructure Health dashboard

### Ready to Start 📋

1. **OpenAPI Integration** - [openapi-integration.md](./openapi-integration.md) - **START HERE** - Add to @wallpaperdb/core + Ingestor
2. **Media Service** - [media-service.md](./media-service.md) - Wallpaper retrieval & resizing (after OpenAPI)

### Future 📋

1. **Variant Generator** - Pre-generate common sizes (2K, 1080p, 720p)
2. **UI for uploading** - Simple frontend
3. **Authentication** - User ownership of wallpapers
4. **Query Service** - OpenSearch integration for browsing
5. **Enrichment Services** - Quality, Color extraction
