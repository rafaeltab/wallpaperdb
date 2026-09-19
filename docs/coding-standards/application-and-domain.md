# Backend application and domain

Scope: backend capabilities, their application-owned ports, domain policy, and tests.

## Effect and dependencies

- Effect is the required programming model for effectful application and domain operations, dependency composition, and resource lifecycles. Pure values and calculations remain ordinary TypeScript.
- Every injected port has an application-owned TypeScript interface and a colocated, namespaced Effect `Context.Service` key; adapters explicitly implement their port interfaces. Separate `Symbol.for(...)` tokens, TSyringe containers, and property injection are not used.
- Use Effect Layers to construct services and supply their dependencies. Resolve implementation dependencies during layer construction rather than exposing them as requirements of the port's operations. Private implementations may still use ordinary constructors; pure domain values and calculations do not need to become services.
- Application and domain code declare typed dependencies rather than using global service locators or creating or running their own runtimes. [Composition selects implementations and lifetimes](composition-and-operations.md#configuration-and-lifecycle); [driving adapters execute effects at transport boundaries](adapters.md#driving-adapters).

## Outcomes and failures

- Represent normal domain and application decisions, including absence, validation rejection, quota denial, and intentional no-ops, as explicit values. Use discriminated unions where callers must distinguish outcomes; do not introduce a result wrapper when the returned value already expresses the outcome.
- Represent technical failures that prevent an operation from completing as application-owned tagged errors in Effect's typed error channel. Unexpected defects and violated programmer assumptions remain defects, not ordinary application outcomes.
- Underlying causes may be retained as opaque diagnostic context on application-owned errors. Application and domain code must not inspect vendor errors, library validation details, or error-message text to make decisions.

For translation of external failures and safe responses, follow [adapter boundary translation](adapters.md#boundary-translation). For recording diagnostic context, follow [observability](composition-and-operations.md#observability).

## Ports and transactions

- Create application-owned ports only at genuine external-effect or technology boundaries. A port describes purposeful operations in the consuming capability's language and must not expose infrastructure or another bounded context's types. Opaque diagnostic causes follow the [failure policy](#outcomes-and-failures).
- A port states every observable guarantee on which the application relies. Production and controlled test adapters must satisfy the same contract.
- The application declares atomicity; adapters own transaction mechanics. Work that must commit together crosses one capability-scoped transactional port, expressed as a deep semantic operation or a scoped unit of work when decisions must occur inside the transaction.
- Raw transactions must not enter application code, transaction-scoped collaborators must not escape their scope, and separate ports must never be assumed to share a transaction. Independently transactional resources remain separate and external effects do not run as part of a database transaction.

For concurrent writes and persistence enforcement, follow [persistence adapters](adapters.md#persistence-adapters). For work spanning independent resources, follow [delivery reliability](distributed-interactions.md#delivery-reliability).

## Domain policy

- Each capability consistently chooses language-only DDD or tactical DDD. Introduce entities, value objects, aggregates, repositories, domain services, and other tactical patterns only where they protect a real modeling need; `CONTEXT.md` records language, not implementation patterns.
- Domain events are optional. Prefer explicit calls and transition results, do not use an internal event bus to hide control flow, and treat event sourcing as a separate architectural decision.
- Domain construction and transitions enforce business invariants. Internal code may rely on values that have crossed the structural and domain boundaries instead of repeatedly revalidating them. Invariants susceptible to concurrent or external writes also need [persistence enforcement](adapters.md#persistence-adapters).
- Application and domain policy authorize every protected operation. Authentication mechanisms must not leak inward, and caller-supplied ownership claims must not override the authenticated principal. [Driving adapters translate authentication](adapters.md#driving-adapters).
- Defaults and normalization have one owner. Checks that depend on their results must use the owner's resolved values rather than independently reproduce its rules.
- Bound caller-controlled quantities that determine resource consumption. Enforce limits at the boundary that owns the constrained work; defaults and cost estimates do not replace those limits. For example, a capability owns its maximum page size, while a GraphQL adapter owns protocol-specific query limits.

For capability/context placement and language ownership, follow [backend architecture](project-organization.md#backend-architecture).

## Testing

- Capability tests call a driving port and assert its result and declared driven-port effects using controlled adapters. They test the whole capability as the unit, not its internal classes. Test business outcomes at this boundary.
- Focused tests of complex pure domain logic are appropriate when they improve diagnosis or cheaply cover a substantial decision table; they need not duplicate capability tests.

Apply the [shared testing principles](project-organization.md#shared-testing-principles) and the [port guarantees above](#ports-and-transactions) when constructing controlled adapters. If the behavior belongs to a transport or external system, use [adapter tests](adapters.md#testing).
