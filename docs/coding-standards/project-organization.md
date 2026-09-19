# Project organization

Scope: module organization and shared testing principles apply project-wide. The backend architecture section applies only to backend applications and their supporting modules.

## Module organization

- A capability exposes a small interface through one deliberate public entry point, hides its implementation, and uses only the internal layering its complexity warrants. External code and tests import only from that entry point; public entry points must not re-export the implementation, and abstractions that merely delegate are prohibited.
- Mechanically enforce architectural dependencies: package export maps protect package interfaces, while dependency-graph checks protect capability entry points, inward dependency direction, and acyclicity.
- Use shared packages for cohesive modules whose stable semantics are genuinely common to actual consumers, with a deliberate interface and clear ownership. Keep context-specific meanings local and accept small duplication when sharing would couple them; shared packages must not depend on deployable applications.
- Filename conventions must not impose mandatory architectural role suffixes.

## Backend architecture

- Each independently deployable backend application is one hexagon. Its capabilities are vertical, deep modules inside that hexagon; neither the monorepo, individual capabilities, nor shared packages are automatically separate hexagons.
- Domain and application code depend inward; driving and driven adapters translate external concerns at the application boundary.
- Strategic DDD is mandatory for backend capabilities. Every capability belongs to exactly one bounded context and uses its ubiquitous language in code, tests, ports, events, and documentation. A context may contain several capabilities, while an application should normally serve one context.
- Domain and persistence models remain private to their bounded context. Cross-context public contracts are translated into the receiving context's model; a shared domain kernel requires an explicit documented exception.
- Each application exclusively owns its private mutable persistence. Shared immutable assets may be consumed directly from object storage when every object has one owning producer, consumer permissions are limited to their needs, and lifecycle responsibility is explicit. Only the owner may delete an object, and changed content receives a new logical identity.

When designing backend behavior, follow [application and domain guidelines](application-and-domain.md). When exchanging facts between applications, follow [distributed contracts](distributed-interactions.md#contracts). For resources shared within an application, follow [composition and lifecycle ownership](composition-and-operations.md#configuration-and-lifecycle).

## Shared testing principles

- Tests cover each specified behavior, expected failure, domain invariant, and port guarantee at the narrowest public boundary that owns it. Repeat a scenario at a wider boundary only when that boundary introduces a distinct risk. The [telemetry testing policy](composition-and-operations.md#testing) qualifies this rule for backend instrumentation.
- Every maintained function must meet the configured CRAP threshold. CRAP is an implementation-risk backstop, not proof of behavioral completeness.
- Prefer controlled stateful adapters over mocks that assert incidental method order. Assert observable port effects; use an interaction assertion only when the interaction itself is part of the port contract.
- Tests are deterministic, independently runnable, and parallel-safe: control nondeterministic inputs, isolate test data and state, and await observable asynchronous conditions with bounded deadlines rather than fixed sleeps. Treat flakiness as a defect; retries must not conceal it.

For backend test boundaries, read the relevant subject: [capabilities and domain](application-and-domain.md#testing), [adapters](adapters.md#testing), or [composition and operations](composition-and-operations.md#testing). These backend test categories do not prescribe a frontend test architecture.
