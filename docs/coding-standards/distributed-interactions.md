# Backend distributed interactions

Scope: backend cross-application communication, public event contracts, and delivery guarantees.

## Contracts

- Name interactions honestly: integration events announce committed facts, asynchronous commands request future work from a known owner, and synchronous calls provide an immediately required answer.
- Contexts own authoritative facts; consumers own their local interpretations. Facts routinely needed from another context arrive asynchronously and are maintained in the consumer's local model rather than synchronously fetched for hydration.
- Synchronous cross-application hydration is prohibited. Any synchronous exception requires an ADR showing why a local event-fed representation is unsuitable and defining the coupling, timeout, failure, and unavailability behavior.
- Use choreography only for independent reactions whose producer neither requires nor knows the consumers. An owned distributed outcome with required steps, branching, deadlines, retries, compensation, or inspectable progress uses a durably persisted process manager; compensation is explicit business behavior.
- Integration events carry sufficient, stable, purpose-specific public state for consumer autonomy. They must not serialize internal models, expose storage mechanisms, or include sensitive data without an explicit consumer need and lifecycle. Shared immutable assets are identified by stable logical references; object-storage adapters map those references to provider, bucket, and key details.
- All integration events use CloudEvents 1.0. Keep event occurrence (`source` + `id`), workflow correlation, direct causation, domain identity, and trace identity distinct; retries and replay preserve occurrence identity, while broker addresses remain routing details.
- While WallpaperDB has no production or external consumers, a breaking integration-event change may update every producer, consumer, contract test, and retained outbox, stream, quarantine, or projection together. Once applications deploy independently or retained history must survive deployments, schemas evolve compatibly in place and breaking changes use a versioned event type supported for the complete replay horizon.

For translation into local models and ownership of persistence/assets, follow [backend architecture](project-organization.md#backend-architecture). For handling messages at the application boundary, follow [adapters](adapters.md#boundary-translation).

## Delivery reliability

- When a committed state change produces an integration event, persist both atomically through an outbox; every publication retry reuses the original event identity. Retried driving commands require their own idempotency identity.
- Every consumer effect is replay-safe. Use an atomic processed-event ledger when it can share the effect's transaction; otherwise use stable target identity, versioning, outcome verification, or durable workflow state.
- Never claim atomicity across independent resources. Represent cross-resource work as durable, independently replay-safe steps whose accepted and completed states are distinguishable and whose ambiguous outcomes can be retried or reconciled.
- Broker acknowledgement means that work is completed or responsibility for it is durably accepted. It must never mean merely that processing started.
- Do not assume global, cross-subject, or effect-completion order. Add producer-owned per-entity versions, sequences, and durable gap handling only where reordering changes correctness; complete snapshots may supersede intermediate versions, while order-dependent deltas may not.
- Consumers classify delivery as completed or durably accepted, intentional no-op, transient retry, or permanent failure. Retries are finite and backed off; permanent and exhausted failures are durably quarantined, and replay preserves the original event identity.
- Broker deduplication is supplementary. Do not claim exactly-once behavior unless the complete observable effect is protected by one genuine transactional boundary.

For event diagnostic fields, follow [observability](composition-and-operations.md#observability). For timeouts, in-flight work, and shutdown, follow [resource lifecycle](composition-and-operations.md#configuration-and-lifecycle).

## Testing

Use [capability tests](application-and-domain.md#testing) for application decisions and declared effects, [adapter contract tests](adapters.md#testing) for broker/storage guarantees and message translation, and [composition tests](composition-and-operations.md#testing) for wiring. The [shared testing principles](project-organization.md#shared-testing-principles) determine which scenarios belong at each boundary without repeating the full matrix at every level.
