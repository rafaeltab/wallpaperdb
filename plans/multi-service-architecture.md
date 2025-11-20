# Multi-Service Architecture Plan

**Status:** Planning
**Decision Date:** 2025-01-20
**Implementation Start:** TBD

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
│Ingest │────▶│   Media      │  │Thumbnail │  │Quality │  │Tagging  │
│ or    │     │   Service    │  │Extractor │  │Enrich  │  │         │
│       │     │              │  │          │  │        │  │         │
└──┬────┘     └──────────────┘  └─────▲────┘  └────▲───┘  └─────────┘
   │                                   │            │
   │                                   │            │
   └───────────────┬───────────────────┴────────────┘
                   │
           ┌───────▼────────┐
           │  Event Bus     │
           │    (NATS)      │
           └────────────────┘
                   │
    ┌──────────────┼──────────────┬─────────────┐
    │              │              │             │
┌───▼────┐   ┌────▼─────┐   ┌───▼────┐   ┌───▼──────┐
│        │   │          │   │        │   │          │
│PostGres│   │  MinIO   │   │  NATS  │   │OpenSearch│
│        │   │          │   │        │   │          │
└────────┘   └──────────┘   └────────┘   └──────────┘
```

### Planned Services

1. **Ingestor** (✅ Exists)
   - Wallpaper upload and validation
   - State machine for upload workflow
   - Reconciliation system
   - Status: Production-ready

2. **Media Service** (📋 Planned)
   - Wallpaper retrieval and serving
   - Image resizing and format conversion
   - CDN integration
   - Status: High priority (Service #2 candidate)

3. **Thumbnail Extractor** (📋 Planned)
   - Video thumbnail generation
   - Multiple thumbnail variants
   - FFmpeg integration
   - Status: Medium priority (Good proving ground for patterns)

4. **Quality Enrichment** (📋 Planned)
   - Image quality analysis
   - Resolution/sharpness scoring
   - ML-based quality detection
   - Status: Medium priority

5. **Color Enrichment** (📋 Planned)
   - Dominant color extraction
   - Color palette generation
   - Color-based search indexing
   - Status: Medium priority

6. **Tagging Service** (📋 Planned)
   - Tag management (CRUD)
   - Tag suggestions
   - Tag relationships
   - Status: Low priority

7. **Gateway** (📋 Future)
   - GraphQL API
   - OpenSearch integration
   - Search and filtering
   - Status: After core services

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

### Phase 0: Foundation (2 weeks)

**Goal:** Establish shared packages and patterns

**Tasks:**
1. Extract `@wallpaperdb/core` package
   - BaseConnection and connection managers
   - RFC 7807 errors
   - OTEL telemetry module
   - Config patterns
   - Health utilities

2. Extract `@wallpaperdb/events` package
   - Event schemas (Zod)
   - BaseEventConsumer
   - BaseEventPublisher

3. Migrate ingestor incrementally
   - Use shared packages
   - Validate all tests pass

4. Create service template generator
   - `scripts/create-service.sh`
   - Template files

5. Documentation
   - Architecture docs
   - Migration guides
   - ADRs

**Deliverable:** Shared packages ready, ingestor using them, template exists

**See:** [Shared Packages Migration Plan](./shared-packages-migration.md)

---

### Phase 1: Observability (2 weeks)

**Goal:** Production-grade telemetry and monitoring

**Tasks:**
1. Create telemetry module in `@wallpaperdb/core`
   - Static helpers (withSpan, recordMetric)
   - Pre-defined metrics
   - Attribute constants

2. Instrument ingestor
   - Upload workflow (spans + metrics)
   - Storage operations (S3 not auto-instrumented)
   - Events service (NATS + trace propagation)
   - File processor
   - State machine

3. Create Grafana dashboards
   - Upload Overview
   - Infrastructure Health
   - Service template (reusable)

4. Setup alerts
   - Failure rates
   - Latency thresholds
   - Infrastructure health

**Deliverable:** Full observability for ingestor, reusable patterns

**See:** [Observability Implementation Plan](./observability-implementation.md)

---

### Phase 2: Architecture Refinement (1 week)

**Goal:** Clean up ingestor architecture

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

**Deliverable:** Clean, maintainable ingestor architecture

**See:** [Architecture Refinement Plan](./architecture-refinement.md)

---

### Phase 3: Service #2 Proof of Concept (1 week)

**Goal:** Validate multi-service patterns work

**Service Choice:** TBD (Thumbnail Extractor OR Media Service)

**Tasks:**
1. Generate service skeleton
2. Implement business logic
3. Add observability
4. Integration tests
5. Deploy alongside ingestor

**Success Criteria:**
- Service built in <1 week
- Shared packages work seamlessly
- Distributed tracing works (ingestor → service #2)
- Template reduces boilerplate significantly
- Patterns are clear and documented

**Deliverable:** Working service #2, validated patterns

---

### Phase 4+: Remaining Services (1 week each)

Services 3, 4, 5, etc. should take ~1 week each:
- Business logic implementation
- Testing
- Observability
- Deployment

**Order (tentative):**
1. Media Service (high priority - wallpaper retrieval)
2. Thumbnail Extractor (video support)
3. Quality Enrichment
4. Color Enrichment
5. Tagging Service
6. Gateway (GraphQL)

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
- MinIO (shared buckets, namespaced keys)
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
| Phase 0: Foundation | 2 weeks | 📋 Planned |
| Phase 1: Observability | 2 weeks | 📋 Planned |
| Phase 2: Architecture | 1 week | 📋 Planned |
| Phase 3: Service #2 | 1 week | 📋 Planned |
| **Total to Service #2** | **6 weeks** | 📋 Planned |
| Phase 4+: Services 3-7 | ~1 week each | 📋 Future |

**Next Action:** Begin Phase 0 - Extract shared packages
**See:** [Shared Packages Migration Plan](./shared-packages-migration.md)
