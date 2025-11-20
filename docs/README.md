# WallpaperDB Documentation

Welcome to the WallpaperDB documentation! This guide will help you navigate the documentation structure and find what you need.

---

## Quick Start

**New to the project?** Start here:
1. Read [CLAUDE.md](../CLAUDE.md) - Overview and development principles
2. Read [Development Guidelines](development-guidelines.md) - Critical rules (TDD, incremental changes)
3. Review [Multi-Service Architecture Plan](../plans/multi-service-architecture.md) - Strategic direction

**Implementing something?** Go to:
- [Plans Directory](../plans/) - Step-by-step implementation plans
- [Guides Directory](guides/) - How-to guides for common tasks
- [Architecture Directory](architecture/) - Patterns and decisions

---

## Documentation Structure

```
docs/
├── README.md                          # This file
├── development-guidelines.md          # CRITICAL RULES - Read first!
├── architecture/
│   ├── multi-service-patterns.md     # Patterns catalog (TODO)
│   ├── shared-packages.md            # Package strategy (TODO)
│   └── decisions/
│       └── 001-fastify-over-nestjs.md  # Why Fastify
├── testing/
│   ├── README.md                      # Testing overview (exists)
│   ├── coverage.md                    # Coverage guide (TODO)
│   └── ci-cd.md                       # CI/CD guide (TODO)
└── guides/
    ├── extracting-shared-packages.md  # How to extract (TODO)
    ├── creating-new-service.md        # Service creation (TODO)
    └── adding-observability.md        # OTEL guide (TODO)

plans/
├── multi-service-architecture.md      # Master plan ✅
├── shared-packages-migration.md       # Phase 0 details ✅
├── observability-implementation.md    # Phase 1 details ✅
├── test-infrastructure-setup.md       # Test & CI setup ✅
└── services.md                        # Service registry (exists)
```

---

## By Role

### I'm an AI Agent implementing features

1. **Read:** [CLAUDE.md](../CLAUDE.md) - Critical principles at top
2. **Read:** [Development Guidelines](development-guidelines.md) - TDD, incremental changes
3. **Choose:** Implementation plan from [plans/](../plans/)
4. **Follow:** Step-by-step instructions
5. **Refer:** Architecture patterns and decisions
6. **Update:** Documentation as you learn

### I'm a Developer joining the project

1. **Read:** [CLAUDE.md](../CLAUDE.md) - Project overview
2. **Read:** [Development Guidelines](development-guidelines.md) - Workflow and standards
3. **Review:** [Architecture Decisions](architecture/decisions/) - Why things are the way they are
4. **Explore:** [Testing Documentation](testing/) - How testing works
5. **Start:** Pick a task and follow the guidelines!

### I'm planning a new feature

1. **Read:** [Multi-Service Architecture](../plans/multi-service-architecture.md) - Strategic direction
2. **Check:** [Services Plan](../plans/services.md) - What services exist/planned
3. **Review:** [Architecture Patterns](architecture/) - Established patterns
4. **Create:** New plan document in [plans/](../plans/)
5. **Document:** Architecture decision in [decisions/](architecture/decisions/)

---

## Key Principles (Always Follow)

### 1. Test-First Development
- Write tests BEFORE implementation
- Every change must have tests
- See [Development Guidelines](development-guidelines.md)

### 2. Incremental Changes
- Small, focused changes
- NEVER big-bang refactoring
- Test after each increment
- See [Development Guidelines](development-guidelines.md)

### 3. Document As You Go
- Update docs when architecture changes
- Update plans when decisions are made
- Create ADRs for architectural choices
- See [Development Guidelines](development-guidelines.md)

---

## Current Status

### Completed
✅ Ingestor service (production-ready)
✅ TesterBuilder pattern (exceptional test infrastructure)
✅ State machine pattern for uploads
✅ Reconciliation system
✅ RFC 7807 error handling
✅ Basic OTEL integration

### In Progress
🚧 Multi-service architecture planning (documentation phase)
🚧 Shared packages extraction (planned)
🚧 Observability enhancements (planned)
🚧 Test infrastructure setup (planned)

### Planned
📋 Service #2 (Media or Thumbnail Extractor)
📋 Additional enrichment services
📋 GraphQL gateway

---

## Implementation Phases

### Phase 0: Foundation (2 weeks)
Extract shared packages, create service templates
**Plan:** [shared-packages-migration.md](../plans/shared-packages-migration.md)

### Phase 1: Observability (2 weeks)
OTEL instrumentation, dashboards, alerts
**Plan:** [observability-implementation.md](../plans/observability-implementation.md)

### Phase 2: Architecture Refinement (1 week)
Repository pattern, clean DI, controllers
**Plan:** (TODO)

### Phase 3: Service #2 (1 week)
Validate multi-service patterns
**Plan:** [multi-service-architecture.md](../plans/multi-service-architecture.md)

### Phase 4+: Additional Services (1 week each)
Build remaining services using established patterns

---

## Architecture Decisions

All major architectural decisions are documented as ADRs (Architecture Decision Records) in [architecture/decisions/](architecture/decisions/).

**Current ADRs:**
- [ADR-001: Fastify over NestJS](architecture/decisions/001-fastify-over-nestjs.md) - Framework choice

**When to create an ADR:**
- Choosing between technologies (framework, database, etc.)
- Major architectural patterns (event sourcing, CQRS, etc.)
- Significant deviations from established patterns
- Decisions that affect multiple services

**ADR Format:**
- Context: What problem/decision
- Decision: What was chosen
- Rationale: Why
- Alternatives: What else was considered
- Consequences: Trade-offs and implications

---

## Testing

**Test Types:**
- **Package Tests** - Fast, no infrastructure (`make test-packages`)
- **Integration Tests** - With Testcontainers (`make test-apps`)
- **E2E Tests** - Docker-based (`make <service>-e2e-test`)

**Test Coverage:**
- Setup in progress - see [test-infrastructure-setup.md](../plans/test-infrastructure-setup.md)
- Will support: `make test-coverage`, `make coverage-summary`

**Testing Guides:**
- [Testing Overview](testing/README.md)
- [TesterBuilder Pattern](testing/test-builder-pattern.md)
- [Integration vs E2E](testing/integration-vs-e2e.md)

---

## Common Questions

### Why Fastify instead of NestJS?
See [ADR-001](architecture/decisions/001-fastify-over-nestjs.md). TL;DR: Migration cost (4-6 weeks) > benefit (~50 lines less boilerplate), current stack is excellent.

### How do I create a new service?
See [Multi-Service Architecture Plan](../plans/multi-service-architecture.md). After Phase 0 (shared packages), services take ~1 week to build.

### What goes in shared packages vs service code?
Infrastructure patterns, event schemas, test utilities → shared packages
Business logic, domain models, routes → service code
See [Shared Packages Migration Plan](../plans/shared-packages-migration.md)

### How do I add observability/telemetry?
After Phase 1: Import from `@wallpaperdb/core/telemetry`, use `withSpan()` helper
See [Observability Implementation Plan](../plans/observability-implementation.md)

### What's the testing strategy?
TDD always. Package tests (fast), integration tests (Testcontainers), E2E tests (Docker).
See [Development Guidelines](development-guidelines.md) and [Testing Docs](testing/)

---

## Contributing

1. **Read** [Development Guidelines](development-guidelines.md)
2. **Follow** TDD and incremental migration patterns
3. **Update** documentation as you go
4. **Create** ADRs for architectural decisions
5. **Ask** questions via PR/code review

---

## Resources

- **[CLAUDE.md](../CLAUDE.md)** - Main reference for AI agents and developers
- **[Development Guidelines](development-guidelines.md)** - Critical development rules
- **[Plans Directory](../plans/)** - Implementation roadmaps
- **[Architecture Decisions](architecture/decisions/)** - ADRs
- **[Testing Documentation](testing/)** - Testing patterns and guides

---

## Maintenance

This documentation should be updated when:
- Architecture changes (update patterns, ADRs)
- Strategic decisions are made (update plans, ADRs)
- New workflows are established (update guidelines)
- Implementation reveals new insights (update guides)

**Documentation is code.** Treat it with the same care as implementation.
