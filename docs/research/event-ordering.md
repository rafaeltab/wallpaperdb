# Event ordering in WallpaperDB services

Research date: 2026-09-04

## Decision

Explicit ordering policy is normal in an event-driven system; explicit sequence machinery in every service is not.

WallpaperDB should adopt this default:

1. Consumers do not assume global order, cross-subject order, or that side effects finish in broker storage order.
2. Event contracts declare an ordering scope only when reordering changes the business result. The usual scope is one entity or aggregate, never the entire application.
3. Independent or commutative effects need stable event identity and idempotency, but no sequence tracking.
4. Authoritative state-transfer events use a producer-owned, monotonically increasing entity version and a conditional upsert. Consumers apply newer state and ignore duplicate or stale state; they need not wait for intermediate versions when the newer payload subsumes them.
5. Delta or state-transition events whose meaning depends on prior deltas use a producer-owned entity sequence. Consumers apply only the expected next sequence and handle gaps durably through retry, staging, replay, or reconciliation.
6. Broker serialization or partitioning can enforce a declared ordering scope, but is not a substitute for replay-safe application state.

This is deliberately narrower than requiring a version on every event or gap detection in every consumer.

## What brokers guarantee—and what they do not

JetStream stores messages in a stream sequence, but reliable work consumers use acknowledgements and redelivery. An unacknowledged message can be redelivered after later stream messages have already been handed out. NATS documents that redelivery does not return to stream order when multiple messages are in flight; `MaxAckPending = 1` restores strict processing order by allowing only one in-flight message, at a throughput cost, and should be used only when order matters ([NATS, delivery and acknowledgment](https://docs.nats.io/learn/jetstream/delivery-and-acknowledgment)).

Sharing one durable pull consumer among workers distributes in-flight messages among those workers. If one worker dies, its message may later be delivered to another worker, and an effect completed before the crash can run twice. NATS therefore recommends keying effects by a stable business identifier ([NATS, scaling a consumer](https://docs.nats.io/learn/jetstream/worker-pool)). Even when delivery begins in stream order, concurrent handler latency means effects can finish in another order.

JetStream's feature named an **ordered consumer** is not the normal business-work primitive. It is a disposable, single-threaded, no-ack, non-shareable reader for a gap-free pass over a stream. NATS directs durable work that needs per-message completion to a named explicit-ack consumer instead ([NATS, ordered consumers](https://docs.nats.io/learn/jetstream/ordered-consumer)).

Kafka illustrates the mainstream scope of useful ordering: records with the same key are assigned to the same partition and read in that partition's order. It does not provide one total order across topic partitions. Kafka calls key-based placement “semantic partitioning,” allowing related data such as one user's events to retain locality while unrelated keys are processed in parallel ([Apache Kafka introduction](https://kafka.apache.org/documentation/), [Apache Kafka protocol design](https://kafka.apache.org/41/design/protocol/#themessageset)).

The conclusion is not that brokers provide no order. It is that their order is scoped and operational, while application correctness is semantic. Retries, multiple consumers, multiple subjects, and multiple producers can all break an inferred business order.

## Choose the handling strategy from the event semantics

| Event semantics | Example effect | Normal handling | Gap handling |
| --- | --- | --- | --- |
| Independent or commutative fact | Record that one immutable rendition exists | Deduplicate by event/operation identity; use a uniqueness key or convergent set operation | None |
| Authoritative state transfer | Replace a search projection with Profile version 12 | Conditional upsert when `incomingVersion > storedVersion`; ignore stale or equal versions | None when the payload is a complete authoritative snapshot |
| Delta or ordered transition | Increment a counter, append a lifecycle transition, apply event-sourced history | Serialize per entity and/or require `incomingSequence = storedSequence + 1` | Persist and retry/stage the gap, or rebuild/reconcile from the source |
| Causal prerequisite | Attach a variant only after its wallpaper projection exists | Make the combined projection convergent or durably defer the dependent fact | Retry/stage/reconcile; never acknowledge and discard merely because the prerequisite is late |

This distinction is supported directly by vendor guidance. Azure contrasts a withdrawal delta, which can decrement twice, with an event carrying the updated balance, which can be safely upserted ([Azure, resilient Event Hubs and Functions design](https://learn.microsoft.com/en-us/azure/architecture/serverless/event-hubs-functions/resilient-design)). For strict FIFO work, Azure recommends grouping by a business key and processing each group sequentially while different groups run in parallel; it explicitly says this coordination is unnecessary overhead when messages are independent ([Azure, Sequential Convoy pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/sequential-convoy)).

For event-sourced history, the requirement is stronger: Azure models one ordered stream per entity, calls the order affecting that entity crucial, and recommends incremental identifiers, optimistic concurrency, and tracking consumer sequence where needed ([Azure, Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)). WallpaperDB is not generally event-sourced, so those costs should not be imposed on unrelated integration handlers.

Do not use timestamps, ULID lexical order, or JetStream stream/consumer sequence as a domain ordering key. Timestamps can collide or reflect clocks rather than commit order. Broker sequence is assigned by transport topology and can change meaning when streams, relays, or replay paths change. A domain version or sequence is owned by the producer that serializes changes to the entity.

## WallpaperDB implications

The current code has a real causal-order risk, but it does not justify universal gap tracking:

- Media consumes `wallpaper.uploaded` and `wallpaper.variant.uploaded` through separate durable consumers. If the variant arrives before Media has stored its parent, `WallpaperVariantUploadedConsumerService` logs “skipping variant” and returns successfully. The base consumer then acknowledges the message, permanently losing that reaction.
- Gateway separately consumes `wallpaper.uploaded`, `wallpaper.variant.available`, and `wallpaper.colors.extracted`. A dependent update can race the creation of its OpenSearch document. Retries may reduce the likelihood but do not make the projection convergent, and the initial wallpaper upsert writes `variants: []`, so a late initial write can also overwrite already-applied derived state.
- Gateway's `addVariant` script unconditionally appends and has no duplicate guard. Redelivery of the same event therefore adds the same logical variant twice. Once modeled as an upsert/set member keyed by wallpaper plus the variant's natural identity, “variant available” is an independent, commutative fact with a causal parent prerequisite: it needs deduplication and durable orphan handling, not a contiguous wallpaper sequence.
- Color extraction is likewise a field projection with a causal parent prerequisite. Repeating the same assignment can converge without sequence handling; if WallpaperDB later supports multiple authoritative re-extractions, the color result needs a producer-owned version so an older result cannot overwrite a newer one.
- Processing is currently sequential inside each `BaseEventConsumer` instance, but that does not order different durable consumers. It also ceases to imply single-file processing when several processes share one durable consumer.

The appropriate correction is local to these projections:

1. Do not acknowledge a dependent fact merely because its prerequisite is not visible yet.
2. Make each projection update replay-safe and convergent: use a natural variant identity, set/upsert semantics, and conditional or scripted merges that cannot erase newer fields.
3. Durably stage or retry an orphaned variant/color fact, then reconcile it after the parent appears. Maintain a rebuild path from retained authoritative events or the owning service.
4. Introduce a wallpaper entity version only if the owning context will publish multiple authoritative replacements or order-sensitive transitions for one wallpaper. A one-time immutable “variant exists” fact does not need a contiguous wallpaper sequence when it can be modeled as a set member.

The planned Profile projection is a good use of version handling: each event contains the complete post-change public Profile snapshot and a monotonic Profile version, so Gateway can apply the newest version and discard stale deliveries without buffering missing intermediate versions. That is state-transfer convergence, not general event-order reconstruction.

## Recommended coding-standard text

> **Event ordering:** Consumers must not assume global event order, cross-subject order, or side-effect completion order. An event contract must declare an ordering scope only when reordering changes correctness; prefer an entity or aggregate key over global serialization. Independent and commutative handlers require replay-safe idempotency but no sequence tracking. Authoritative state-transfer handlers must conditionally apply a producer-owned entity version and ignore stale state; missing intermediate versions do not block when newer state is complete. Delta or transition handlers that depend on prior events must process monotonically per entity and durably handle gaps through retry, staging, replay, or reconciliation. Broker ordering may implement the declared scope, but correctness must survive redelivery and replay. Timestamps, sortable event IDs, and broker sequence numbers are not domain ordering guarantees.

An accompanying review question should be:

> If two related events are duplicated, reversed, or processed concurrently, does the handler converge to the same valid state? If not, where is the ordering scope, how is it enforced, and how are gaps recovered?
