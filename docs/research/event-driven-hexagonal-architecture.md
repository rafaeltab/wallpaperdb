# Event-driven architecture inside WallpaperDB's hexagonal design

Research date: 2026-09-04

## Executive recommendation

Event-driven architecture should be a communication option at WallpaperDB's application boundary, not the organizing principle inside every application. Keep one hexagon per independently deployable application, with deep capability modules inside. NATS consumers are driving adapters; NATS publishers are driven adapters. Both translate across ports, so broker subjects, acknowledgements, delivery counts, and foreign event DTOs remain outside the application core.

Replace the blanket rule “prefer events over synchronous calls” with a decision rule:

- Publish an integration event when an owning bounded context has committed a meaningful fact, other contexts may react independently, and eventual consistency is acceptable.
- Call synchronously when the caller requires an answer to decide whether or how to proceed. Request/reply over a broker is still synchronous coupling at the interaction level.
- Send an asynchronous command/job when one known owner must perform work later; do not disguise that request as a past-tense event.
- Keep invariants that require immediate consistency inside one bounded context and local transaction. Use a saga only when a genuinely distributed business process accepts intermediate states and compensation.

This is consistent with Cockburn's inside/outside model: adapters translate external signals into a port's purposeful, application-semantic conversation, and the application can be tested without its runtime devices ([Cockburn, original Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture)). It also reflects Fowler's warning that event notification is a poor fit when the producer secretly expects a consumer to perform an action—the “passive-aggressive command”—or when a hidden multi-step flow becomes visible only through production monitoring ([Fowler, “What do you mean by Event-Driven?”](https://martinfowler.com/articles/201701-event-driven.html)).

## Architecture-invariant guidance

These rules should survive a change of broker, language, or application runtime.

### 1. Distinguish domain events from integration events

A **domain event** is a fact significant to the model inside one bounded context. It may coordinate domain/application behavior within the hexagon and need not be serialized or asynchronous. An **integration event** is a public, asynchronous contract published outside the application after the originating change is durable. Microsoft makes the same distinction: internal domain events stay within the domain, while integration events synchronize state across microservices and should be published after the originating transaction commits ([Microsoft, domain events](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation), [Microsoft, integration events](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications)).

Implications:

- Do not export internal domain event classes or schemas for other applications to consume.
- An application may derive zero, one, or several integration events from a domain event or completed use case; the two are not required to be one-to-one.
- Integration events report committed facts. Names should use past-tense ubiquitous language such as `WallpaperOriginalStored`, not storage operations such as `ObjectInserted` and not commands such as `GenerateVariants`.
- A capability using language-only DDD need not manufacture domain events. Integration events can be emitted from application orchestration when a public fact is warranted.

### 2. Put translation on the adapter side of each port

For incoming messages:

```text
foreign integration contract
    -> NATS driving adapter: decode, validate, translate, classify delivery outcome
    -> local driving port: local command/value objects
    -> application capability
```

For outgoing messages:

```text
application capability
    -> local driven port: capability-language fact/intent
    -> NATS driven adapter: map to public contract, envelope, subject, headers
    -> broker
```

Thus the anti-corruption translation is in front of a driving port or behind a driven port, depending on direction. Foreign integration types must not become local domain types. NATS types and operations (`JsMsg`, subject, ack/nak/term, stream sequence) must not cross an application port. This follows Cockburn's rule that a port is defined by the purpose of the conversation and that adapters convert between that API and external signals ([Cockburn](https://alistair.cockburn.us/hexagonal-architecture)). Explicit translation also preserves bounded-context meanings; Fowler describes bounded contexts as linguistic boundaries with translation between their distinct models ([Fowler, Bounded Context](https://www.martinfowler.com/bliki/BoundedContext.html)).

The application should nevertheless return enough *application-meaningful* outcome information for the driving adapter to distinguish success, a retryable failure, and a permanent rejection. The adapter owns the mapping from those outcomes to ack, delayed retry, or quarantine.

### 3. Choose asynchronous events deliberately

Use event notification when the producer does not depend on any particular reaction and multiple consumers may be added independently. Use event-carried state transfer when consumers must continue without calling the producer, accepting larger contracts and replicated state. A small “ID-only” notification lowers payload coupling but creates availability and latency coupling if every consumer must call back; a fuller event improves autonomy but expands schema, privacy, and consistency obligations. Fowler identifies these as different patterns with different trade-offs ([Fowler, Event Notification vs Event-Carried State Transfer](https://martinfowler.com/articles/201701-event-driven.html)).

Prefer a synchronous port/API when an answer is required now, the flow is simple, or strong cross-service consistency would otherwise be assumed. Official Azure guidance likewise says event-driven architecture is a poor fit for straightforward request/response or transactions that cannot tolerate temporary disagreement; asynchronous messaging adds delivery, recovery, debugging, and eventual-consistency costs ([Azure Architecture Center, Event-Driven Architecture](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven)).

### 4. Producer ownership, naming, payloads, and evolution

The bounded context that owns the fact owns the event's semantics, type name, schema, compatibility policy, and publication lifecycle. A central package may distribute schemas, but must not imply joint ownership or let consumers reshape producer contracts. Subjects are routing addresses; the event type is the semantic identity. Do not make consumers infer semantics from a subject alone.

Every integration event needs a stable envelope. CloudEvents is a suitable standard rather than inventing one: it requires `id`, `source`, `specversion`, and `type`, and defines optional `time`, `subject`, `datacontenttype`, and `dataschema`; `source` + `id` identifies a distinct occurrence and can identify duplicate retransmission ([CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)). WallpaperDB also needs explicit `correlationId` (the wider business conversation) and `causationId` (the command/event that directly caused this event). These are different from the event ID, entity ID, and trace ID.

Schema policy:

- Favor additive, optional changes that preserve existing meaning.
- Never silently rename, remove, change the type of, or reinterpret a published field.
- Give an incompatible contract a new event type/version and support both versions for a deliberate migration window.
- Retain decoders and replay tests for every schema version that can still exist in retained streams or archives.
- Treat an unknown/unsupported version as a permanent contract failure: quarantine and alert rather than retrying unchanged bytes.

The CloudEvents primer recommends changing `type` for backward-incompatible data changes and, where needed, producing old and new events concurrently while consumers migrate ([CloudEvents primer, versioning](https://github.com/cloudevents/spec/blob/main/cloudevents/primer.md#versioning-of-cloudevents)).

Payloads should contain stable public concepts, not ORM records, vendor response types, bucket names, object keys, queue metadata, or fields added for one consumer. Carry only the data needed to make consumers autonomous; use stable identifiers or claim-check/reference patterns for large content. Data minimization is also a security control because events are broadly visible and retained.

### 5. Assume at-least-once delivery and design idempotent effects

No broker acknowledgement makes a database change, object upload, or external API call exactly once. A consumer can commit its side effect and crash before its ack is recorded, so duplicate handling is an application requirement. The safe default is at-least-once delivery plus idempotent processing.

- Every event has a stable ID that survives retries and relay restarts.
- For a transactional database effect, insert `(consumer identity, event ID)` into an inbox/processed-message table in the same local transaction as the business change; a uniqueness constraint makes repeats no-ops.
- A naturally idempotent set/upsert is acceptable only when its complete observable result is identical on repetition. Append, increment, “send email,” and “charge” are not naturally idempotent.
- Where the target cannot share a transaction with an inbox (for example, an external search index), use a stable operation key and version/compare-and-set semantics, or stage work durably before applying it.

The Idempotent Consumer pattern recommends recording processed message IDs transactionally, either in a dedicated table or the affected entity ([Richardson, Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html)).

Ordering must be an explicit business requirement, not an assumed broker property. Prefer commutative/idempotent handlers. Where state transitions require order, include an aggregate/entity version or producer sequence and detect stale events and gaps. Preserve order per owned entity/aggregate, not globally; global ordering sharply limits parallelism. A consumer must also tolerate a causally later event arriving before another consumer has applied its prerequisite.

### 6. Make state change and publication one durable decision

When one use case changes a transactional database and publishes an integration event, a direct dual write is unsafe: publish-before-commit can expose rolled-back state, while publish-after-commit can lose the event if the process crashes. Store an outbox record in the same local transaction as the business state, then relay it to the broker. Relays may publish twice, so consumers still require idempotency. These are the guarantees and caveat of the Transactional Outbox pattern ([Richardson, Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox)).

Use polling or transaction-log tailing as implementation choices behind the publication adapter. Polling is portable but makes strict ordering harder; transaction-log tailing is database-specific and still needs duplicate control ([Richardson, Polling Publisher](https://microservices.io/patterns/data/polling-publisher.html), [Transaction Log Tailing](https://microservices.io/patterns/data/transaction-log-tailing.html)).

An outbox solves database-to-broker atomicity only. It does not atomically join object storage, another service, or the consumer's side effects. Those require idempotent operations, durable workflow state, reconciliation, and sometimes compensation.

### 7. Choreography and orchestration are different tools

Use choreography for independent reactions to an announced fact: the producer neither knows nor waits for consumers. Avoid chains where services emit “events” solely to trigger the next mandatory step; that hides a workflow and its failure state.

Use an explicit process manager/saga orchestrator when a cross-application business process has required steps, branching, deadlines, retries, compensation, or a status that users/operators must inspect. The context owning the process owns the orchestrator; participants keep ownership of their local rules and transactions. Sagas provide a sequence of local transactions and compensations, not ACID isolation, so intermediate states and concurrency anomalies must be designed explicitly ([Richardson, Saga](https://microservices.io/patterns/data/saga.html)). AWS likewise identifies orchestration as useful for complex, long-running, branching workflows and centralized retry/error state, while choreography keeps components relatively isolated ([AWS, Orchestration](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-integrating-microservices/orchestration.html), [Choreography](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-integrating-microservices/choreography.html)).

This is a judgment call, not “events everywhere” or “orchestrate every cross-service interaction.” A simple fan-out fact favors choreography; a required multi-step outcome favors orchestration. If a hard invariant frequently spans applications, first reconsider the bounded-context/application boundary.

### 8. Observability and security are part of the contract

Propagate W3C `traceparent`/`tracestate` through message headers and create distinct producer and consumer spans. Keep trace metadata free of PII: the W3C specification explicitly prohibits personally identifiable or sensitive information in trace context ([W3C Trace Context](https://www.w3.org/TR/trace-context/)). Record event type/source/id, correlation and causation IDs, consumer identity, delivery attempt, processing duration, outcome, and relevant entity ID. Operational dashboards and alerts should cover consumer lag/pending work, redeliveries, terminal/quarantined messages, outbox backlog and oldest age, publish failures, and processing latency.

Events should not contain secrets and should contain PII only when a documented consumer need, retention policy, and authorization justify it. Encrypt broker links and storage, authenticate every application, and grant least-privilege publish/subscribe access by context-owned subject prefixes. NATS authorization is subject-based and supports independent publish and subscribe allow-lists; an unrestricted account can otherwise reach all subjects, including JetStream control subjects ([NATS authorization](https://docs.nats.io/learn/security/authorization)). NATS TLS must be configured independently for each connection type that crosses the deployment topology ([NATS encryption and TLS](https://docs.nats.io/learn/security/encryption)).

### 9. Test at the boundaries and at failure windows

- **Domain/application tests:** invoke driving ports with in-memory driven adapters; verify local policy without NATS. This is a primary benefit of ports and adapters ([Cockburn](https://alistair.cockburn.us/hexagonal-architecture)).
- **Contract tests:** producer fixtures must validate against the published schema; each consumer must prove translation for every supported version. Add compatibility tests that reject breaking schema edits.
- **Adapter integration tests:** use a real ephemeral JetStream to prove subject routing, serialization, trace propagation, explicit ack, delayed retry, terminal/quarantine handling, durable resume, and configuration.
- **Idempotency/replay tests:** deliver the same event ID repeatedly, deliver related events out of order, and replay retained old versions. Assert state, emitted follow-up events, and external effects converge.
- **Crash-window tests:** stop after local commit but before relay, after broker publish but before outbox completion, and after consumer side effect but before ack. Recovery must neither lose work nor duplicate observable effects.
- **End-to-end tests:** wait on observable state with bounded polling/subscriptions rather than fixed sleeps. Exercise unavailable dependencies and worker restarts.

## NATS JetStream mechanics (technology-specific)

These choices implement the architecture; they are not domain or hexagonal rules.

- Use durable pull consumers with `AckPolicy.Explicit` for application work queues. Ack only after all local effects and durable follow-up work succeed. JetStream redelivers an unacknowledged message after `AckWait`, providing at-least-once delivery ([NATS delivery and acknowledgment](https://docs.nats.io/learn/jetstream/delivery-and-acknowledgment)).
- Configure finite `MaxDeliver`; its default is unlimited. Configure a backoff schedule whose first delay is longer than normal processing, and send progress for legitimately long jobs. A bare `nak()` redelivers immediately and does **not** use the consumer backoff; use delayed NAK or allow `AckWait`/backoff to govern retry ([NATS ack responses and redelivery](https://docs.nats.io/learn/jetstream/acknowledgment)). Add jitter in application-chosen delays where many consumers can fail together.
- Classify failures: ack success; delayed retry transient failures; term permanent validation/contract failures only after durably quarantining enough information for diagnosis/replay. JetStream has no built-in DLQ. `term` and `MaxDeliver` stop delivery for that consumer while the message can remain in a limits-retention stream; subscribe to termination and max-deliveries advisories and route them into an explicit quarantine workflow ([NATS acknowledgments, poison-message path](https://docs.nats.io/learn/jetstream/acknowledgment#term-the-poison-message-path)).
- Set `Nats-Msg-Id` to the stable event ID on every publish/retry so JetStream can suppress duplicate writes within its configured deduplication window. Still keep inbox/idempotent handling because this is bounded broker deduplication, not end-to-end exactly-once processing. Always inspect every `PubAck`; asynchronous publishing without checking acknowledgements is a lost-write risk ([NATS advanced publishing](https://docs.nats.io/learn/jetstream/advanced-publishing)).
- Do not use JetStream ordered consumers for durable business work. They are ephemeral, no-ack readers designed for a gap-free, in-order scan and rebuild themselves when they detect a gap ([NATS ordered consumers](https://docs.nats.io/learn/jetstream/ordered-consumer)). Use business versions/sequences and durable consumers when processing has side effects.
- Declare stream retention, age/size limits, replicas, storage, discard policy, consumer filters, delivery policy, ack wait, max deliveries, backoff, and maximum pending work as reviewed infrastructure configuration. Retention is an operational and privacy decision, not merely a default.

## Concrete WallpaperDB implications

The current repository already has a useful base—runtime schema validation, durable explicit-ack consumers, unique event IDs, PubAck-awaiting publishers, and W3C trace-context propagation—but the following gaps should shape the coding standards and later migration work:

1. **Make the package boundary hexagonal.** `BaseEventConsumer` and `BaseEventPublisher` currently expose NATS directly and are appropriate adapter infrastructure. Capability application code should not extend them or accept shared integration DTOs. A thin NATS driving adapter should translate a validated event into a local command and call a driving port; outgoing capability code should call an application-owned publication port whose NATS adapter uses `@wallpaperdb/events`.

2. **Separate contracts by bounded-context ownership.** `@wallpaperdb/events` can remain the distribution mechanism, but schemas should be namespaced and owned by the publishing context. Consumers import the public schema only in their adapters. The current global `wallpaper.*` taxonomy and names such as `wallpaper.uploaded` should be reviewed against the eventual context map: “uploaded” is ambiguous about whether bytes were accepted, stored, or processing began.

3. **Replace the current publication recovery with an outbox.** Ingestor persists `uploadState = stored`, publishes, then changes the state to `processing`; reconciliation republishes stored records. This closes one loss window but is not an atomic outbox. A successful publish followed by a failed state update/transaction produces another event, and `publishNew()` creates a new event ID on each attempt. Store the final integration event (including stable ID and version) as an outbox record in the same transaction as the relevant state transition, then relay it with that same ID and `Nats-Msg-Id`.

4. **Add inbox/idempotency guarantees before scaling consumers.** Gateway's wallpaper upsert and color assignment are naturally close to idempotent, but its variant script unconditionally appends. Media generates a new variant ID for every delivery and then emits a new follow-up event, so redelivery can duplicate database rows, search variants, and downstream events. Record event IDs transactionally and add natural uniqueness/version constraints appropriate to each capability.

5. **Handle cross-subject and cross-consumer reordering.** `WallpaperVariantUploadedConsumerService` currently acknowledges successfully when the parent wallpaper is absent (“skipping variant”), permanently losing that consumer's reaction. Gateway independently consumes wallpaper-created and variant-available facts, so the same race exists there. A later fact must be deferred/retried, staged, or applied through a convergent upsert until its prerequisite projection exists; it must not be silently acknowledged and discarded.

6. **Replace hot retries and silent poison handling.** `BaseEventConsumer` uses immediate `msg.nak()`, does not configure backoff, and calls `term()` after local callbacks whose defaults are no-ops; application callbacks still contain DLQ TODOs. Configure delayed/backoff retries, a finite attempt budget, a durable quarantine record/stream, JetStream advisory monitoring, and alerts. Long image-processing consumers should send in-progress acknowledgements or have an evidence-based ack deadline.

7. **Strengthen the envelope and evolution policy.** The envelope currently has `eventId`, `eventType`, and `timestamp`, but no producer/source, schema version, subject/entity, correlation ID, or causation ID. Adopt CloudEvents or a deliberately compatible internal envelope. Event retries must retain the original occurrence time and ID rather than create a new occurrence.

8. **Remove technology leakage from public events.** `WallpaperUploaded` and `WallpaperVariantUploaded` expose `storageBucket` and `storageKey`; `WallpaperVariantUploaded` explicitly justifies this as a consumer need. Under the agreed anti-corruption rule, replace these with a capability-level reference or redesign ownership so consumers request/read media through a port. Also audit `originalFilename` and user identifiers against real consumer needs and retention/privacy requirements.

9. **Harden NATS configuration.** The repository creates one `WALLPAPER` limits-retention stream for `wallpaper.>` with one-year retention and unlimited message/byte counts, while rendered documentation says 30 days and 1,000,000 messages. Resolve that mismatch, choose retention deliberately, configure replication/storage for the required durability, and assign each application least-privilege publish/subscribe permissions rather than shared unrestricted access.

10. **Upgrade the tests from happy-path timing to delivery semantics.** Several integration tests use fixed sleeps. Add deterministic eventual assertions plus tests for duplicate delivery, lost ack, delayed redelivery, out-of-order prerequisites, permanent invalid events, max delivery/quarantine, process restart, retained old schemas, and outbox relay recovery.

## Decisions still requiring domain judgment

Research cannot settle these without WallpaperDB's business semantics:

- Whether “wallpaper uploaded,” “original stored,” “wallpaper accepted,” and “variant available” are the correct facts in each bounded context.
- Whether variant generation and color extraction are independent reactions (good choreography) or required steps in one user-visible processing workflow (likely an explicit process manager).
- Whether consumers need event-carried metadata or should receive only stable references and use synchronous ports for current data.
- The entity/aggregate key whose changes require ordering, and whether stale events should be ignored, retried, or treated as gaps.
- Which event data is necessary enough to justify one-year retention and which fields constitute personal data.

These decisions should be made in the relevant bounded-context language and then reflected in `CONTEXT.md`, public integration schemas, and the coding standards.
