# ADR-001: Fastify + TSyringe over NestJS

**Status:** Accepted
**Date:** 2025-01-20
**Decision Makers:** Project Lead
**Context:** Choosing framework for multi-service architecture

---

## Context

WallpaperDB is transitioning from a single service (ingestor) to a multi-service microservices architecture. We need to decide whether to:

1. Continue with **Fastify + TSyringe** (current stack)
2. Migrate to **NestJS** (opinionated framework)

This decision affects development velocity, maintainability, and team scaling for the next 1-2 years.

---

## Decision

**We will continue with Fastify + TSyringe and NOT migrate to NestJS.**

---

## Rationale

### Current Stack Analysis

**Ingestor Service (completed):**
- 32 TypeScript files, ~3,500 LOC
- Excellent architecture:
  - BaseConnection pattern (reusable)
  - TSyringe DI (clean, testable)
  - TesterBuilder pattern (exceptional test infrastructure)
  - State machine pattern
  - RFC 7807 error handling
  - Comprehensive test coverage

**What's Already Reusable:**
- BaseConnection pattern (90%+ reusable)
- All connection managers (100% copy-paste ready)
- Error handling (100% reusable)
- Test infrastructure (TesterBuilder - better than NestJS Test module)
- OTEL setup (100% reusable)
- Config validation patterns (90% reusable)

**What Needs Improvement:**
- Boilerplate per service (~200 lines)
- Route registration (manual)
- DI setup (manual)

### NestJS Migration Cost-Benefit

**Migration Cost:**
- 4-6 weeks to migrate ingestor
- Learning curve for team
- Risk of regression bugs
- Potential performance impact
- Framework lock-in

**Benefits:**
- ~100 lines less boilerplate per service (vs ~100 with shared packages)
- Auto-generated Swagger docs
- Larger community
- More prescriptive (easier for new developers)

**ROI Calculation:**
- **Fastify Path:** 2 weeks (shared packages) + 1 week (Service #2) = 3 weeks to Service #2
- **NestJS Path:** 4-6 weeks (migration) + 1 week (Service #2) = 5-7 weeks to Service #2
- **Savings:** 2-4 weeks by staying with Fastify

### Strategic Improvements to Current Stack

With 2 weeks of work on shared packages:

1. **`@wallpaperdb/core`** package
   - All connections, errors, telemetry
   - Reduces 90% of infrastructure boilerplate

2. **`@wallpaperdb/events`** package
   - Event schemas and utilities
   - Type-safe event handling

3. **Service template generator**
   - `pnpm create-service <name>`
   - Generates ~90% of boilerplate

**Result:** Service #2 takes ~1 week with ~100 lines boilerplate (comparable to NestJS)

### Key Advantages of Current Stack

1. **Flexibility**
   - Full control over patterns
   - Easy to optimize per-service
   - No framework constraints

2. **Performance**
   - Fastify is fastest Node.js framework
   - No framework overhead
   - Direct access to all features

3. **Test Infrastructure**
   - TesterBuilder pattern is exceptional
   - More composable than NestJS Test module
   - Type-safe compile-time dependency resolution
   - This is a competitive advantage

4. **Low Risk**
   - No migration needed
   - No regression risk
   - Team already knows the stack

5. **Investment Preserved**
   - All current work remains valuable
   - Patterns already proven
   - Test coverage remains intact

---

## Alternatives Considered

### NestJS
**Pros:** More opinionated, larger community, auto Swagger
**Cons:** 4-6 week migration, less flexible, framework lock-in
**Verdict:** Cost > Benefit at current scale

### tRPC
**Pros:** End-to-end type safety
**Cons:** Not designed for microservices, no built-in DI
**Verdict:** Better for monoliths with TypeScript clients

### Hono
**Pros:** Modern, fast
**Cons:** Minimal framework (same boilerplate issues as Fastify)
**Verdict:** No significant advantage

---

## Consequences

### Positive

✅ **Fast Time to Service #2:** 3 weeks vs 5-7 weeks
✅ **Preserved Investment:** All current work remains valuable
✅ **Flexibility:** Can optimize each service independently
✅ **Performance:** Fastest possible Node.js stack
✅ **Test Infrastructure:** Keep exceptional TesterBuilder pattern
✅ **Low Risk:** No migration, no regression
✅ **Future Options:** Can migrate to NestJS later if needed

### Negative

❌ **Manual Boilerplate:** ~100 lines per service (vs ~50 with NestJS)
❌ **No Auto Swagger:** Need to add manually (or use library)
❌ **Less Prescriptive:** Requires discipline for consistency
❌ **Smaller Community:** Fastify + TSyringe has smaller community than NestJS

### Mitigation

- **Boilerplate:** Shared packages + template generator reduce to ~100 lines (acceptable)
- **Swagger:** Can add `@fastify/swagger` if needed
- **Consistency:** Strong documentation and code review
- **Community:** Fastify and TSyringe are both mature and stable

---

## When to Reconsider

Revisit this decision if:

1. **Team grows beyond 5 developers**
   - Standardization becomes critical
   - Onboarding is painful with custom patterns

2. **Building 10+ services**
   - Boilerplate becomes painful even with templates
   - Framework discipline needed

3. **Complex patterns emerge**
   - Need CQRS, event sourcing, sagas
   - Framework support would help

4. **Hiring is difficult**
   - NestJS has larger talent pool
   - Easier to find experienced developers

---

## Migration Path (if needed later)

If we migrate to NestJS in the future:

✅ **Most work transfers:**
- Shared package logic wraps into NestJS modules
- Business logic is framework-agnostic
- Test infrastructure (TesterBuilder) still works
- Event schemas remain identical
- OTEL patterns transfer

❌ **What changes:**
- Route handlers → Controllers
- TSyringe DI → NestJS DI
- Manual registration → Module decorators

**Estimated effort:** 2-3 weeks per service (vs 4-6 weeks for ingestor due to learning curve)

---

## References

- [Multi-Service Architecture Plan](../../../plans/multi-service-architecture.md)
- [Shared Packages Migration Plan](../../../plans/shared-packages-migration.md)
- [Development Guidelines](../../development-guidelines.md)

---

## Approval

**Decision:** Accepted
**Date:** 2025-01-20
**Review Date:** After Service #2 completion (validate assumptions)
