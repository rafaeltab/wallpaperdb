# Next Steps for WallpaperDB

> **Last Updated**: 2025-11-23
> **For**: AI assistants or developers picking up the project

---

## TL;DR - What to Do Next

**👉 Step 1: OpenAPI Integration** (prerequisite)

Detailed plan: **[plans/openapi-integration.md](./openapi-integration.md)**

Add reusable OpenAPI support to `@wallpaperdb/core`, then integrate with Ingestor.

**👉 Step 2: Build the Media Service**

Detailed plan: **[plans/media-service.md](./media-service.md)**

Use **TDD approach**: Write tests first, then implement.

---

## Project Status Summary

### What's Done

| Component | Status |
|-----------|--------|
| Local Infrastructure | ✅ Docker Compose with PostgreSQL, MinIO, NATS, Redis, OpenSearch, Grafana |
| Ingestor Service | ✅ Production-ready wallpaper upload with state machine |
| @wallpaperdb/core | ✅ Config schemas, telemetry helpers, health utilities |
| @wallpaperdb/events | ✅ Event schemas, BaseEventPublisher, BaseEventConsumer |
| Test Infrastructure | ✅ TesterBuilder pattern with Testcontainers |
| CI/CD | ✅ `make ci` runs full pipeline locally |
| Observability | ✅ OpenTelemetry instrumentation, Grafana dashboards, alerts |

### What's Partially Done

| Component | Status | Remaining |
|-----------|--------|-----------|
| Grafana Dashboards | 80% | Infrastructure Health dashboard missing |
| Test Fixtures | 80% | Some helpers not migrated to TesterBuilder (low priority) |

### Plans Ready for Implementation

| Plan | Priority | Description |
|------|----------|-------------|
| **[openapi-integration.md](./openapi-integration.md)** | 🔴 High | **START HERE** - Add OpenAPI to @wallpaperdb/core + Ingestor |
| [media-service.md](./media-service.md) | 🔴 High | Service #2 - wallpaper retrieval & resizing (after OpenAPI) |

---

## Media Service Overview

**See full plan: [plans/media-service.md](./media-service.md)**

### Architecture

```
NATS (wallpaper.uploaded) → Media Service → Own PostgreSQL DB
                                         ↓
                                   MinIO (shared, read-only)
                                         ↓
                                   HTTP Response (with optional resize)
```

### Key Constraints

1. **Own database** - NO access to ingestor's tables
2. **Event-driven** - Populates own DB from `wallpaper.uploaded` events
3. **Shared MinIO** - Read-only access to wallpaper files
4. **No caching** - Does NOT cache resized images (separate Variant Generator service will pre-generate common sizes)
5. **Public access** - No authentication required

### Phases (TDD - tests first!)

| Phase | Scope |
|-------|-------|
| 1 | Scaffold + Health endpoints |
| 2 | Event consumer → own DB |
| 3 | Basic retrieval (serve original file) |
| 4 | Variant selection + on-the-fly resizing |

Each phase has BDD-style test specifications. **Write tests first, then implement.**

---

## Commands Reference

```bash
# Start infrastructure
make infra-start

# Development
make dev                    # Start all services
make ingestor-dev           # Start ingestor only

# Testing
make test                   # All tests
make test-unit              # Fast unit tests
make test-integration       # Integration tests
make test-e2e               # E2E tests

# CI
make ci                     # Full CI pipeline locally

# Lint & Format
make lint
make format
```

---

## Key Files to Read

**Before starting Media Service:**
- **[plans/media-service.md](./media-service.md)** - The detailed plan with test specs
- `CLAUDE.md` - Development principles and commands
- `apps/ingestor/` - Reference implementation to follow
- `packages/core/src/` - Shared utilities to use
- `packages/events/src/` - Event patterns to follow
- `docs/testing/test-builder-pattern.md` - How to write tests

---

## Questions?

If unclear about:
- **Architecture decisions**: See `docs/architecture/decisions/`
- **Testing patterns**: See `docs/testing/`
- **Media Service specifics**: See `plans/media-service.md`
- **Existing code**: Run `make infra-start && make dev` and explore
