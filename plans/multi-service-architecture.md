# Multi-Service Architecture Plan

**Status:** Phase 0-6 Complete - Production Services Running
**Decision Date:** 2025-01-20
**Last Updated:** 2025-12-31

---

## Executive Summary

WallpaperDB is transitioning from a single-service (ingestor) to a multi-service microservices architecture. This document outlines the strategic direction, technology choices, and implementation roadmap.

**Key Decision:** Continue with Fastify + TSyringe, NOT migrating to NestJS.

**Rationale:** Current stack is well-designed for microservices. Strategic improvements (shared packages, templates) achieve 90% of NestJS benefits at 1/4 the time cost, while maintaining flexibility.

---

## Strategic Vision

### Services Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Gateway                              │
│                    (GraphQL / Future)                           │
└────────────┬────────────────────────────────────────────────────┘
             │
   ┌─────────┴──────────┬──────────────┬─────────────┬────────────┐
   │                    │              │             │            │
┌──▼────┐     ┌────────▼─────┐  ┌─────▼────┐  ┌────▼───┐  ┌────▼────┐
│       │     │              │  │          │  │        │  │         │
│Ingest │     │   Media      │  │Thumbnail │  │Quality │  │Tagging  │
│(Pub)  │     │   Service    │  │(Sub)     │  │(Sub)   │  │(Sub)    │
│       │     │              │  │          │  │        │  │         │
└───┬───┘     └──────┬───────┘  └─────┬────┘  └────┬───┘  └────┬────┘
    │                │                │            │           │
    │ ┌──────────────┴──────┐   ┌─────┴────────────┴─────────┐ │
    │ │                     │   │                            │ │
    └─▶     Event Bus       ◀───┘                            │ │
             (NATS)                                          │
    │ │                     │                                │ │
    │ └─────────────────────┘                                │ │
    │                                                        │
    └──────────┬───────────────┬────────────────┬─────────────┘
               │               │                │
    ┌──────────▼───────────────▼────────────────▼───────────┐
    │                                                       │
┌───▼────┐   ┌────▼─────┐                   ┌───▼────┐   ┌───▼──────┐
│        │   │          │                   │        │   │          │
│PostGres│   │    S3    │                   │  NATS  │   │OpenSearch│
│        │   │          │                   │        │   │          │
└────────┘   └──────────┘                   └────────┘   └──────────┘
```

### Implemented Services

1. **Ingestor** (✅ Complete)
   - Wallpaper upload and validation
   - State machine for upload workflow
   - Reconciliation system
   - Status: Production-ready

2. **Media Service** (✅ Complete)
   - Wallpaper retrieval and serving
   - On-demand image resizing (Sharp)
   - Variant selection and serving
   - Status: Production-ready

3. **Variant Generator** (✅ Complete)
   - Pre-generates common resolution variants
   - Event-driven (consumes wallpaper.uploaded)
   - Aspect-ratio aware generation
   - Status: Production-ready

4. **Gateway** (✅ Complete)
   - GraphQL API (Mercurius)
   - OpenSearch integration for search
   - Event-driven metadata sync
   - Status: Production-ready

5. **Web Frontend** (✅ Complete)
   - React-based UI
   - Wallpaper browsing and upload
   - Muuri grid layout
   - Status: Production-ready

### Planned Services

6. **Thumbnail Extractor** (📋 Planned)
   - Video thumbnail generation
   - Multiple thumbnail variants
   - FFmpeg integration
   - Status: Medium priority

7. **Quality Enrichment** (📋 Planned)
   - Image quality analysis
   - Resolution/sharpness scoring
   - ML-based quality detection
   - Status: Medium priority

8. **Color Enrichment** (📋 Planned)
   - Dominant color extraction
   - Color palette generation
   - Color-based search indexing
   - Status: Medium priority

9. **Tagging Service** (📋 Planned)
   - Tag management (CRUD)
   - Tag suggestions
   - Tag relationships
   - Status: Low priority

---

## Technology Stack Decision

### Framework Choice: Fastify + TSyringe

**Decision:** Continue with current stack (Fastify, TSyringe, Drizzle)

**Alternatives Considered:**
- NestJS (opinionated framework)
- tRPC (type-safe APIs)
- Hono (minimal framework)

**Analysis:** See [ADR-001: Fastify over NestJS](../docs/architecture/decisions/001-fastify-over-nestjs.md)

**Key Factors:**

| Factor | Fastify + TSyringe | NestJS |
|--------|-------------------|---------|
| **Service #2 Time** | 1-1.5 weeks | 1 week (after 4-6 week migration) |
| **Flexibility** | High - full control | Medium - framework constraints |
| **Migration Cost** | None | 4-6 weeks for ingestor |
| **Boilerplate** | ~100 lines (with shared packages) | ~50 lines |
| **Learning Curve** | Low (current team knows it) | Medium (new patterns) |
| **Test Infrastructure** | Excellent (TesterBuilder) | Good (NestJS Test) |

**Conclusion:**
- Migration ROI is low (4-6 weeks for 50 lines less boilerplate)
- Current patterns are already excellent (especially testing)
- Flexibility matters for microservices (each service may need custom patterns)
- Can reconsider if team grows >5 people or after 5+ services

---

## Shared Package Strategy

### Package Architecture

```
packages/
├── core/                      # Infrastructure patterns (@wallpaperdb/core)
│   ├── connections/          # BaseConnection, connection managers
│   ├── errors/               # RFC 7807 error handling
│   ├── telemetry/            # OTEL helpers (no DI coupling)
│   ├── config/               # Zod config patterns
│   └── health/               # Health check utilities
│
├── events/                    # Event schemas (@wallpaperdb/events)
│   ├── schemas/              # Zod schemas for all events
│   ├── consumer/             # BaseEventConsumer
│   └── publisher/            # BaseEventPublisher
│
├── database/                  # Database utilities (@wallpaperdb/database)
│   ├── migrations/           # Shared migrations (if any)
│   └── common-schemas/       # Shared tables (users, etc.)
│
├── test-utils/               # Testing infrastructure (EXISTS)
│   ├── builders/             # TesterBuilder pattern
│   ├── fixtures/             # Test data generators
│   └── helpers/              # Test utilities
│
└── testcontainers/           # Custom containers (EXISTS)
    └── nats/                 # NATS JetStream setup
```

### What Belongs Where?

**In Shared Packages:**
- Infrastructure patterns (connections, errors, telemetry)
- Cross-service utilities (event schemas, common types)
- Testing infrastructure (builders, fixtures)
- Configuration patterns

**In Service Packages:**
- Business logic (services, orchestrators)
- Domain models specific to service
- Service-specific routes/controllers
- Service-specific database schemas
- Service-specific tests

**Versioning Strategy:**
- Semantic versioning (semver)
- Breaking changes require major version bump
- All services pin to specific versions (no `^` or `~`)
- Shared package changes require PR to consuming services

---

## Service Template Approach

### Template Structure

Future goal: `pnpm create-service <service-name>`

Generated structure:
```
apps/<service-name>/
├── src/
│   ├── app.ts              # Fastify setup + DI registration
│   ├── config.ts           # Zod schema (service-specific config)
│   ├── index.ts            # Entry point with lifecycle
│   ├── routes/
│   │   ├── index.ts        # Route registration
│   │   └── health.routes.ts # Health/ready endpoints
│   ├── services/           # Service-specific business logic
│   ├── repositories/       # Service-specific data access
│   └── controllers/        # Service-specific controllers
├── test/                   # Integration tests
│   ├── setup.ts           # TesterBuilder setup
│   └── *.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile
└── README.md
```

### Service Development Workflow

1. **Generate Service Skeleton**
   ```bash
   pnpm create-service thumbnail-extractor
   ```

2. **Implement Business Logic**
   - Write tests first
   - Implement services
   - Add routes/controllers

3. **Add Observability**
   - Import telemetry from `@wallpaperdb/core`
   - Add spans and metrics

4. **Integration Tests**
   - Use TesterBuilder
   - Test with real infrastructure

5. **Add to Monorepo**
   - Update Makefile
   - Add to CI/CD
   - Update service registry

6. **Deploy**
   - Docker build
   - Add to docker-compose
   - Deploy to environment

**Target Time: 1 week per service** (after templates exist)

---

## Implementation Roadmap

### Phase 0: Foundation (2 weeks) ✅ COMPLETE

**Goal:** Establish shared packages and patterns

**Status:** ✅ Complete (as of 2025-11-23)

**Completed Tasks:**
1. ✅ Extract `@wallpaperdb/core` package
   - Config schemas (Database, S3, NATS, Redis, OTEL, Server)
   - Health aggregator and formatters
   - Telemetry module (withSpan, recordCounter, recordHistogram)
   - Attribute constants

2. ✅ Extract `@wallpaperdb/events` package
   - Event schemas (Zod)
   - BaseEventConsumer
   - BaseEventPublisher with trace context propagation

3. ✅ Migrate ingestor to shared packages
   - Uses @wallpaperdb/core for config and telemetry
   - Uses @wallpaperdb/events for event publishing
   - All tests passing

4. ⏳ Service template generator (deferred to Phase 3)
   - Will create when building Service #2

5. ✅ Documentation
   - Testing documentation complete
   - Architecture patterns documented

**Deliverable:** ✅ Shared packages ready, ingestor using them

---

### Phase 1: Observability (2 weeks) ✅ COMPLETE

**Goal:** Production-grade telemetry and monitoring

**Status:** Complete - All services instrumented

**Completed Tasks:**
1. ✅ Telemetry module in `@wallpaperdb/core`
   - `withSpan()`, `withSpanSync()` helpers
   - `recordCounter()`, `recordHistogram()` helpers
   - Comprehensive attribute constants

2. ✅ Instrument all services
   - ✅ Ingestor (upload orchestrator, storage, file processor, events, state machine, reconciliation)
   - ✅ Media (retrieval, resizing, variant selection)
   - ✅ Variant Generator (variant generation, event consumption)
   - ✅ Gateway (GraphQL resolvers, OpenSearch queries, event consumers)

3. ✅ Grafana dashboards
   - ✅ Upload Overview dashboard (Ingestor)
   - ✅ Media Overview dashboard
   - ✅ Gateway Overview dashboard
   - ✅ Gateway Security dashboard

4. ✅ Alerts configured
   - ✅ High Upload Failure Rate (>5%)
   - ✅ Slow Upload Response Time (p95 >10s)
   - ✅ Storage Operation Failures
   - ✅ Reconciliation Errors

**Deliverable:** ✅ Complete - Production observability operational

**See:** [Observability Implementation Plan (done)](./done/observability-implementation.md)

---

### Phase 2: Architecture Refinement (1 week) 📋 NOT STARTED

**Goal:** Clean up ingestor architecture

**Status:** Not started - can be done in parallel with Phase 3 or deferred

**Tasks:**
1. Repository pattern
   - WallpaperRepository
   - Extract DB operations from services

2. Logger injection
   - Replace all console.log/error
   - Add trace context to logs

3. DI standardization
   - Symbol tokens
   - Remove direct container.resolve()

4. Route controllers
   - UploadController
   - HealthController

**Note:** This is optional polish. Ingestor works well as-is. Consider doing this when revisiting ingestor or as patterns are needed for Service #2.

**Deliverable:** Clean, maintainable ingestor architecture

**See:** [Architecture Refinement Plan](./architecture-refinement.md) (if exists)

---

### Phase 3: Service #2 (Media Service) ✅ COMPLETE

**Goal:** Validate multi-service patterns work

**Status:** ✅ Complete - Media Service production-ready

**Outcome:** Media Service successfully implemented
- Event-driven metadata sync (wallpaper.uploaded consumer)
- On-demand image resizing with Sharp
- Variant selection (picks best pre-generated variant)
- Streaming responses for memory efficiency
- Full integration test coverage

**Success Criteria (All Met):**
- ✅ Service built in ~1 week
- ✅ Shared packages work seamlessly
- ✅ Distributed tracing works (ingestor → media)
- ✅ Patterns validated and documented
- ✅ TesterBuilder pattern successful

**Deliverable:** ✅ Media Service production-ready

**See:** [Media Service Plan (done)](./done/media-service.md)

---

### Phase 4: Variant Generator Service ✅ COMPLETE

**Status:** ✅ Complete - Production-ready

**Outcome:** Variant Generator successfully implemented
- Pre-generates common resolution variants (2K, 1080p, 720p)
- Aspect-ratio aware (only generates matching presets)
- Event-driven (consumes wallpaper.uploaded)
- Publishes wallpaper.variant.uploaded events

**See:** [Variant Generator Plan (done)](./done/variant-generator-service.md)

---

### Phase 5: Gateway Service ✅ COMPLETE

**Status:** ✅ Complete - Production-ready

**Outcome:** Gateway successfully implemented
- GraphQL API using Mercurius
- OpenSearch integration for wallpaper search
- Event-driven metadata sync (wallpaper.uploaded, wallpaper.variant.available)
- Variant-based filtering

**See:** [Gateway Service Plan (done)](./done/gateway-service.md)

---

### Phase 6: Web Frontend ✅ COMPLETE

**Status:** ✅ Complete - Production-ready

**Outcome:** Web frontend successfully implemented
- React-based UI
- Wallpaper upload functionality
- Muuri grid layout for browsing
- Integration with Gateway GraphQL API

---

### Phase 7+: Remaining Services (Planned)

**Order:**
1. ✅ Ingestor (complete)
2. ✅ Media Service (complete)
3. ✅ Variant Generator (complete)
4. ✅ Gateway (complete)
5. ✅ Web Frontend (complete)
6. 📋 Thumbnail Extractor (video support)
7. 📋 Quality Enrichment
8. 📋 Color Enrichment
9. 📋 Tagging Service

---

## Testing Strategy

### Test Infrastructure Setup

**Goal:** Measurable coverage, package vs service separation, CI/CD

**Tasks:**
1. Vitest workspace configuration
2. Coverage setup (v8 provider)
3. Package vs service test separation
4. AI-friendly coverage reports
5. GitHub Actions workflows
6. Codecov integration

**See:** [Test Infrastructure Setup Plan](./test-infrastructure-setup.md)

### Test Types

**Package Tests** (`make test-packages`):
- Fast (no infrastructure)
- Unit tests for shared code
- Run frequently during development

**Service Tests** (`make test-apps`):
- Integration tests with Testcontainers
- Test full workflows
- Run before commits

**E2E Tests** (`make <service>-e2e-test`):
- Docker-based
- Test deployment artifacts
- Run before releases

---

## Infrastructure Considerations

### Shared Infrastructure

All services share:
- PostgreSQL (separate schemas per service)
- S3 (shared buckets, namespaced keys)
- NATS (event bus)
- Redis (caching, rate limiting)
- OpenSearch (search index)
- Grafana LGTM (observability)

### Service Isolation

- Each service has own database schema
- Services communicate via NATS events (no direct DB access)
- Each service can be deployed independently
- Each service has own Docker image

### Local Development

```bash
make infra-start     # Start all infrastructure
make dev             # Start all services
```

Individual service development:
```bash
make <service>-dev   # Start specific service
make <service>-test  # Test specific service
```

---

## Success Criteria

### Phase 0 (Foundation)
✅ `@wallpaperdb/core` package exists and works
✅ `@wallpaperdb/events` package exists and works
✅ Ingestor migrated to shared packages
✅ All tests still passing
✅ Service template generator works

### Phase 1 (Observability)
✅ OTEL instrumentation in ingestor
✅ Distributed tracing works
✅ Grafana dashboards created
✅ Alerts configured
✅ Patterns documented

### Phase 2 (Architecture)
✅ Repository pattern implemented
✅ All console.log replaced with Logger
✅ DI standardized
✅ Controllers created

### Phase 3 (Service #2)
✅ Service #2 built in <1 week
✅ Shared packages reused successfully
✅ Distributed tracing across services
✅ Template validated

### Overall Success
✅ Services 3+ take ~1 week each
✅ Boilerplate <100 lines per service
✅ Test coverage >80% on critical paths
✅ CI/CD working for all services
✅ Documentation complete and accurate

---

## Risks & Mitigation

### Risk: Shared Package Breaking Changes

**Impact:** All services break when package updated

**Mitigation:**
- Semantic versioning
- Pin dependencies (no `^` or `~`)
- Test changes against all consumers before release
- Maintain changelog
- ADR for breaking changes

### Risk: Service Coupling via Events

**Impact:** Changes to event schemas break consumers

**Mitigation:**
- Schema versioning in event type (`wallpaper.uploaded.v1`)
- Support multiple schema versions
- Graceful degradation
- Document event contracts

### Risk: Infrastructure Dependency Hell

**Impact:** Services fail when infrastructure down

**Mitigation:**
- Health checks for all infrastructure
- Circuit breakers
- Graceful degradation
- Retry with exponential backoff
- Comprehensive monitoring

### Risk: Cognitive Load

**Impact:** Hard to understand system with many services

**Mitigation:**
- Excellent documentation
- Service registry/catalog
- Consistent patterns across services
- Good observability (distributed tracing)
- Regular architecture reviews

---

## When to Reconsider NestJS

Consider migrating to NestJS if:

1. **Team grows beyond 5 developers**
   - Need stronger standardization
   - Onboarding is painful

2. **Building 10+ services**
   - Boilerplate becomes painful
   - Framework discipline needed

3. **Complex domain patterns emerge**
   - Need CQRS
   - Need event sourcing
   - Need sagas

4. **Hiring is difficult**
   - NestJS has larger talent pool
   - Easier to find experienced developers

**Migration Path:** Most work is transferable (shared packages wrap into NestJS modules, business logic is framework-agnostic)

---

## Resources

- [Development Guidelines](../docs/development-guidelines.md)
- [Architecture Patterns](../docs/architecture/multi-service-patterns.md)
- [Shared Packages Guide](../docs/architecture/shared-packages.md)
- [ADR-001: Fastify over NestJS](../docs/architecture/decisions/001-fastify-over-nestjs.md)
- [Service Registry](./services.md)

---

## Timeline Summary

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 0: Foundation | 2 weeks | ✅ Complete |
| Phase 1: Observability | 2 weeks | ✅ Complete |
| Phase 2: Architecture | 1 week | 📋 Deferred (optional) |
| Phase 3: Media Service | 1 week | ✅ Complete |
| Phase 4: Variant Generator | 1 week | ✅ Complete |
| Phase 5: Gateway | 2 weeks | ✅ Complete |
| Phase 6: Web Frontend | 2 weeks | ✅ Complete |
| Phase 7+: Enrichment Services | ~1 week each | 📋 Planned |

---

## Next Steps

**Core Platform Complete ✅**

Five production services running:
- ✅ Ingestor - Upload and validation
- ✅ Media - Retrieval and resizing
- ✅ Variant Generator - Pre-generation of common sizes
- ✅ Gateway - GraphQL API with search
- ✅ Web Frontend - User interface

**Focus Areas for Next Phase:**

1. **Production Hardening** (High Priority)
   - Security headers ([plans/security-headers.md](./security-headers.md))
   - Input validation ([plans/input-validation-injection-prevention.md](./input-validation-injection-prevention.md))
   - Backup/disaster recovery ([plans/backup-disaster-recovery.md](./backup-disaster-recovery.md))
   - Secrets management ([plans/secrets-management-production.md](./secrets-management-production.md))

2. **Operational Improvements** (Medium Priority)
   - Structured logging ([plans/structured-logging.md](./structured-logging.md))
   - Dependency scanning ([plans/dependency-vulnerability-scanning.md](./dependency-vulnerability-scanning.md))
   - Enhanced monitoring ([plans/monitoring-alerting-improvements.md](./monitoring-alerting-improvements.md))

3. **Feature Expansion** (Future)
   - Thumbnail Extractor (video wallpapers)
   - Quality Enrichment (image quality scoring)
   - Color Enrichment (color search)
   - Tagging Service (manual tags)
