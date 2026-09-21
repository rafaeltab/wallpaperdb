# Backend adapters

Scope: backend driving adapters, driven adapters, external input/output translation, and adapter tests.

## Boundary translation

- Translate incoming external contracts before they cross a driving port and translate outgoing local concepts after they cross a driven port.
- Treat external input as untrusted until an adapter parses and translates it into application-owned types. Adapters enforce structural contracts. Type or non-null assertions must not bypass validation.
- Translate validation failures into declared outcomes or typed errors before crossing ports; underlying library errors may be retained only as opaque diagnostic causes. Translate vendor failures into application-owned typed errors according to the [outcome and failure policy](application-and-domain.md#outcomes-and-failures).
- Integrate Promise- or callback-based libraries into Effect. Adapters implement the [application-owned port contract](application-and-domain.md#ports-and-transactions).

When input interpretation affects admission or execution, follow [ownership of defaults and resource bounds](application-and-domain.md#domain-policy). When handling technical failures, follow the [diagnostic telemetry requirements](composition-and-operations.md#observability). For client acquisition, cancellation, and cleanup, follow [configuration and lifecycle](composition-and-operations.md#configuration-and-lifecycle).

## Driving adapters

- Obtain inbound ports rather than concrete handlers and execute effects at the transport boundary.
- Authenticate callers and translate technical identity into an application-owned principal. [Application and domain policy own authorization](application-and-domain.md#domain-policy).
- Exhaustively translate declared outcomes and typed failures into transport behavior. Do not expose diagnostic causes in public responses.
- Apply security and admission controls to the operation identified by the driving adapter. Alternative external representations that resolve to the same operation must receive the same controls.

For broker consumers, also follow [distributed contracts and delivery reliability](distributed-interactions.md). For NATS publishers and consumers, follow [NATS and JetStream](nats.md).

## Public HTTP APIs

- REST error bodies and HTTP transport error bodies outside GraphQL responses use RFC 9457 Problem Details with a correct status code and an explicit, stable problem-type URI; `about:blank` is prohibited. WallpaperDB-specific types use `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/<type>.md`, whether or not the documentation file exists yet.
- Translate application outcomes into safe client-relevant details. Unexpected defects use an explicit generic-server problem type and never expose stack traces, vendor failures, secrets, or implementation details.
- GraphQL request and execution errors retain GraphQL's standard response format, including syntax and validation failures returned with an HTTP error status. Preserve the required `errors` and applicable `data` entries, put application-specific error metadata in `extensions`, and apply the same safe-detail and information-disclosure rules.
- HTTP and GraphQL schemas are adapter contracts distinct from application and domain types. While WallpaperDB has no production or external consumers, breaking changes may update a contract and all of its usages, tests, and generated schemas together; do not introduce versioning until consumers require independent migration.

## Persistence adapters

- Reinforce domain invariants susceptible to concurrent or external writes with native persistence constraints. Translate constraint failures into application outcomes and use optimistic concurrency where mutable state could otherwise be silently overwritten. Complex domain policy does not belong in database triggers or procedures.

Transaction mechanics follow the [application's declared atomicity](application-and-domain.md#ports-and-transactions). Persistence and immutable-asset ownership follow [backend architecture](project-organization.md#backend-architecture). Committing a state change with an event also requires [delivery reliability](distributed-interactions.md#delivery-reliability).

## Testing

- Driving-adapter contract tests prove that external requests or messages become the correct driving-port calls and that every declared driving-port outcome or typed failure becomes the correct external response. Test protocol translation at this boundary.
- Driven-adapter contract tests run a port's behavioral contract against the production adapter and real infrastructure. Test infrastructure semantics at this boundary.

Apply the [shared testing principles](project-organization.md#shared-testing-principles). When testing composition rather than an adapter's contract, use [composition tests](composition-and-operations.md#testing). Instrumentation follows the separate [telemetry testing policy](composition-and-operations.md#testing).
