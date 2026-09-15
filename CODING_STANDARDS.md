# WallpaperDB Coding Standards

## Authority

- This file is the temporary authoritative collection of coding standards accepted during the current design conversation. It defines the required end state across the entire codebase, including existing code; guidance elsewhere is not an additional coding standard unless accepted here.
- It does not govern development workflows, agent behavior, contribution processes, or migration planning; Sandcastle, skills, and their respective workflow instructions remain separate and authoritative within their scopes.
- Formatting, import ordering, type strictness, and other mechanically checkable syntax belong in tool configuration rather than this file. Filename conventions must not impose mandatory architectural role suffixes; semantic design constraints remain here even when automated.

## Architecture

- Each independently deployable application is one hexagon. Its capabilities are vertical, deep modules inside that hexagon; neither the monorepo, individual capabilities, nor shared packages are automatically separate hexagons.
- A capability exposes a small interface through one deliberate public entry point, hides its implementation, and uses only the internal layering its complexity warrants. External code and tests import only from that entry point; public entry points must not re-export the implementation, and abstractions that merely delegate are prohibited.
- Mechanically enforce architectural dependencies: package export maps protect package interfaces, while dependency-graph checks protect capability entry points, inward dependency direction, and acyclicity.
- Use shared packages for cohesive modules whose stable semantics are genuinely common to actual consumers, with a deliberate interface and clear ownership. Keep context-specific meanings local and accept small duplication when sharing would couple them; shared packages must not depend on deployable applications.
- Domain and application code depend inward; driving and driven adapters translate external concerns at the application boundary.
- Composition roots coordinate the lifecycle of long-lived resources; adapters implement their own startup and shutdown mechanics, while application and domain code do not own infrastructure lifecycles.

## Ports and transactions

- Create application-owned ports only at genuine external-effect or technology boundaries. A port describes purposeful operations in the consuming capability's language and must not expose infrastructure or another bounded context's types.
- Translate incoming external contracts before they cross a driving port and translate outgoing local concepts after they cross a driven port.
- A port states every observable guarantee on which the application relies. Production and controlled test adapters must satisfy the same contract.
- The application declares atomicity; adapters own transaction mechanics. Work that must commit together crosses one capability-scoped transactional port, expressed as a deep semantic operation or a scoped unit of work when decisions must occur inside the transaction.
- Raw transactions must not enter application code, transaction-scoped collaborators must not escape their scope, and separate ports must never be assumed to share a transaction. Independently transactional resources remain separate and external effects do not run as part of a database transaction.

## Application programming model

- Every injected port has an application-owned TypeScript interface and colocated namespaced `Symbol.for(...)` token; adapters explicitly implement their port interfaces. String tokens and property injection are prohibited.
- Use constructor injection only. Domain code does not depend on TSyringe; application implementations may use injection decorators but must never access the container.
- Composition roots select implementations and lifetimes. Driving adapters resolve inbound ports rather than concrete handlers; concrete classes may be injected directly only as private collaborators that are not ports.
- Represent expected domain and application failures with explicit discriminated result types. Do not introduce a result abstraction for operations that cannot meaningfully fail.
- Reserve exceptions for unexpected defects and violated programmer assumptions. Adapters translate technical failures into application outcomes; application code does not inspect vendor errors or error-message text, and driving adapters exhaustively translate outcomes into transport behavior.
- Treat external input as untrusted until an adapter parses and translates it into application-owned types. Validation failures must not leak raw library errors across ports, and type or non-null assertions must not bypass validation.
- Adapters enforce structural contracts; domain construction and transitions enforce business invariants. Internal code may rely on values that have crossed those boundaries instead of repeatedly revalidating them.
- Driving adapters authenticate and translate technical identity into an application-owned principal; application and domain policy authorize every protected operation. Authentication mechanisms must not leak inward, and caller-supplied ownership claims must not override the authenticated principal.
- Composition parses external configuration once and passes capability-named typed values inward; application and domain code do not read global configuration or environment variables. Secrets reach only the adapters that require them, and invalid startup configuration fails before the application accepts work.

## Domain modeling and ownership

- Strategic DDD is mandatory. Every capability belongs to exactly one bounded context and uses its ubiquitous language in code, tests, ports, events, and documentation. A context may contain several capabilities, while an application should normally serve one context.
- Each capability consistently chooses language-only DDD or tactical DDD. Introduce entities, value objects, aggregates, repositories, domain services, and other tactical patterns only where they protect a real modeling need; `CONTEXT.md` records language, not implementation patterns.
- Domain and persistence models remain private to their bounded context. Cross-context public contracts are translated into the receiving context's model; a shared domain kernel requires an explicit documented exception.
- Each application exclusively owns its private mutable persistence. Shared immutable assets may be consumed directly from object storage when every object has one owning producer, consumer permissions are limited to their needs, and lifecycle responsibility is explicit; only the owner may delete an object, and changed content receives a new logical identity.
- Contexts own authoritative facts; consumers own their local interpretations. Facts routinely needed from another context arrive asynchronously and are maintained in the consumer's local model rather than synchronously fetched for hydration.
- Domain events are optional. Prefer explicit calls and transition results, do not use an internal event bus to hide control flow, and treat event sourcing as a separate architectural decision.
- Enforce business invariants in the domain model and reinforce those susceptible to concurrent or external writes with native persistence constraints. Persistence adapters translate constraint failures into application outcomes and use optimistic concurrency where mutable state could otherwise be silently overwritten; complex domain policy does not belong in database triggers or procedures.

## Cross-application interactions and contracts

- Name interactions honestly: integration events announce committed facts, asynchronous commands request future work from a known owner, and synchronous calls provide an immediately required answer.
- Synchronous cross-application hydration is prohibited. Any synchronous exception requires an ADR showing why a local event-fed representation is unsuitable and defining the coupling, timeout, failure, and unavailability behavior.
- Use choreography only for independent reactions whose producer neither requires nor knows the consumers. An owned distributed outcome with required steps, branching, deadlines, retries, compensation, or inspectable progress uses a durably persisted process manager; compensation is explicit business behavior.
- Integration events carry sufficient, stable, purpose-specific public state for consumer autonomy. They must not serialize internal models, expose storage mechanisms, or include sensitive data without an explicit consumer need and lifecycle. Shared immutable assets are identified by stable logical references; object-storage adapters map those references to provider, bucket, and key details.
- All integration events use CloudEvents 1.0. Keep event occurrence (`source` + `id`), workflow correlation, direct causation, domain identity, and trace identity distinct; retries and replay preserve occurrence identity, while broker addresses remain routing details.
- While WallpaperDB has no production or external consumers, a breaking integration-event change may update every producer, consumer, contract test, and retained outbox, stream, quarantine, or projection together. Once applications deploy independently or retained history must survive deployments, schemas evolve compatibly in place and breaking changes use a versioned event type supported for the complete replay horizon.
- Event logs and traces include event identity, correlation and causation, relevant domain identity, consumer identity, delivery attempt, outcome, and duration without recording secrets or personally identifiable information.

## Public HTTP APIs

- HTTP error bodies use RFC 9457 Problem Details with a correct status code and an explicit, stable problem-type URI; `about:blank` is prohibited. WallpaperDB-specific types use `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/<type>.md`, whether or not the documentation file exists yet. Driving adapters translate application outcomes into safe client-relevant details; unexpected defects use an explicit generic-server problem type and never expose stack traces, vendor failures, secrets, or implementation details.
- HTTP and GraphQL schemas are adapter contracts distinct from application and domain types. While WallpaperDB has no production or external consumers, breaking changes may update a contract and all of its usages, tests, and generated schemas together; do not introduce versioning until consumers require independent migration.

## Observability

- OpenTelemetry traces every interaction across driving ports, driven adapters, and durable workflow transitions, propagating trace context across synchronous and asynchronous boundaries. Spans and structured telemetry use capability language, with technical details added only by adapters.
- Domain code remains free of observability dependencies. Record failures once at the boundary that owns handling them; telemetry must not change application outcomes or expose secrets or unnecessary personal data.

## Delivery reliability

- When a committed state change produces an integration event, persist both atomically through an outbox; every publication retry reuses the original event identity. Retried driving commands require their own idempotency identity.
- Every consumer effect is replay-safe. Use an atomic processed-event ledger when it can share the effect's transaction; otherwise use stable target identity, versioning, outcome verification, or durable workflow state.
- Never claim atomicity across independent resources. Represent cross-resource work as durable, independently replay-safe steps whose accepted and completed states are distinguishable and whose ambiguous outcomes can be retried or reconciled.
- Broker acknowledgement means that work is completed or responsibility for it is durably accepted. It must never mean merely that processing started.
- Do not assume global, cross-subject, or effect-completion order. Add producer-owned per-entity versions, sequences, and durable gap handling only where reordering changes correctness; complete snapshots may supersede intermediate versions, while order-dependent deltas may not.
- Consumers classify delivery as completed or durably accepted, intentional no-op, transient retry, or permanent failure. Retries are finite and backed off; permanent and exhausted failures are durably quarantined, and replay preserves the original event identity.
- Broker deduplication is supplementary. Do not claim exactly-once behavior unless the complete observable effect is protected by one genuine transactional boundary.

## Testing

- Tests cover each specified behavior, expected failure, domain invariant, and port guarantee at the narrowest public boundary that owns it. Repeat a scenario at a wider boundary only when that boundary introduces a distinct risk.
- Every maintained function must meet the configured CRAP threshold. CRAP is an implementation-risk backstop, not proof of behavioral completeness.
- **Capability tests** call a driving port and assert its result and declared driven-port effects using controlled adapters. They test the whole capability as the unit, not its internal classes.
- **Driving-adapter contract tests** prove that external requests or messages become the correct driving-port calls and that every driving-port result becomes the correct external response.
- **Driven-adapter contract tests** run a port's behavioral contract against the production adapter and real infrastructure.
- **Integration tests** prove that the composition root and real adapters work together through a small representative path; they do not repeat the capability's full behavioral matrix.
- **End-to-end tests** prove only crucial flows through deployed artifacts and real application boundaries.
- Prefer controlled stateful adapters over mocks that assert incidental method order. Assert observable port effects; use an interaction assertion only when the interaction itself is part of the port contract.
- Test each failure where its meaning is owned: business outcomes at the capability, protocol translation at driving adapters, infrastructure semantics at driven adapters, wiring at integration, and deployment risk end to end.
- Focused tests of complex pure domain logic are appropriate when they improve diagnosis or cheaply cover a substantial decision table; they need not duplicate capability tests.
- Tests are deterministic, independently runnable, and parallel-safe: control nondeterministic inputs, isolate test data and state, and await observable asynchronous conditions with bounded deadlines rather than fixed sleeps. Treat flakiness as a defect; retries must not conceal it.
