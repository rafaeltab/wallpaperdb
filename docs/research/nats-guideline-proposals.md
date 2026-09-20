# NATS guideline research and source audit

Date: 2026-09-20. Status: supporting research, **not an authoritative coding-guideline document**. The resulting requirements live in [NATS and JetStream](../coding-standards/nats.md). The initial proposals below are retained as research history; their wording does not independently add requirements.

## Review standard and disposition

The user directed us to assess whether NATS's own documentation and best practices support each rule, rather than ask for personal approval of every NATS rule. Preserve upstream conditions and tradeoffs, and link the relevant documentation beside each guideline. Do not present a supported option as the only topology NATS permits.

The source-backed guide adopts conditional consumer guidance, subject partitioning for ordered processing by key, confirmed publication, NATS acknowledgement and retry semantics, retention choices, and graceful shutdown. It references the existing repository rules for outbox identity, replay-safe effects, finite retries, quarantine, resource ownership, and testing. These repository requirements retain their existing authority; they are not attributed to NATS.

The audit narrowed or excluded these initial proposals:

- Durable pull consumers are preferred for reliable scalable work, not mandated for every use of NATS. Ordered consumers remain suitable for disposable reads.
- One consumer per partition is a straightforward arrangement; partitioned groups may assign multiple partitions to a member. No Orbit dependency or mandatory consuming application's sourced stream is prescribed.
- `MaxAckPending = 1` limits distinct pending messages; it does not fence external writes against an earlier attempt after redelivery. Existing replay and ordering safeguards still apply.
- `MaxDeliver` and `term()` do not implement quarantine. No universal server retry count, deadline, partition count, replica count, or retention duration is introduced.
- Infrastructure versus service ownership of broker provisioning remains a repository design choice, not a rule supported by NATS documentation alone.
- Changing a partition mapping has consequences for existing consumers and stored messages; the guide explains them without prescribing one universal migration procedure.

The existing [distributed-interaction rules](../coding-standards/distributed-interactions.md), [adapter rules](../coding-standards/adapters.md), and [composition rules](../coding-standards/composition-and-operations.md) already own application boundaries, idempotency, delivery outcomes, and lifecycle guarantees. A NATS-specific document would explain the broker choices needed to implement those guarantees, linking back instead of repeating them.

## Factual upstream guidance

### Consumer identity and delivery

Workers can share a durable pull consumer to distribute its deliveries. An ordered consumer is a disposable reader: no per-message acknowledgments, no shared worker progress, and no durable restart position. It is useful for inspection and sequential reading; its name does not mean ordered completion of application side effects. [Worker pools](https://docs.nats.io/learn/jetstream/worker-pool), [ordered consumers](https://docs.nats.io/learn/jetstream/ordered-consumer).

### Publication confirmation and deduplication

A JetStream publish returns a `PubAck` identifying the storing stream and sequence. Plain Core NATS publishing provides no storage acknowledgment. Retrying with the same `Nats-Msg-Id` suppresses duplicates within the stream's duplicate window; a timeout can mean the acknowledgment was lost after storage. Async publishing still requires checking each result. [Publishing](https://docs.nats.io/learn/jetstream/publishing), [advanced publishing](https://docs.nats.io/learn/jetstream/advanced-publishing).

### Acknowledgment, retry, and exhaustion

`AckExplicit` tracks individual deliveries. `nak()` normally requests immediate redelivery; consumer `BackOff` affects acknowledgment timeouts, not bare negative acknowledgments. Delayed negative acknowledgments need an explicit delay. In-progress acknowledgment extends the deadline. Reaching `MaxDeliver` stops normal delivery and produces an advisory; it does not place the message in an automatic dead-letter queue. `term()` stops redelivery without meaning successful processing. [Acknowledgment and redelivery](https://docs.nats.io/learn/jetstream/acknowledgment).

### Retention and independent consumers

`LimitsPolicy` retains messages independently of acknowledgments, within configured limits. `InterestPolicy` removes messages after all currently interested consumers acknowledge; without matching interest, messages are removed immediately. `WorkQueuePolicy` removes acknowledged work and disallows overlapping consumer filters. Age, count, and byte limits still apply with every policy. [Retention policies](https://docs.nats.io/learn/jetstream/retention-policies).

### Connection shutdown

Drain stops subscriptions, allows buffered work to finish, flushes pending publication, and closes the connection. It does not acknowledge JetStream deliveries for the application. A connection flush confirms server receipt, not JetStream storage; publication acknowledgments remain necessary. [Drain and shutdown](https://docs.nats.io/learn/resilient-clients/drain-and-shutdown).

## Initial candidate policies (historical)

1. **Use durable pull consumers with explicit acknowledgments for production integration-event processing.** Replicas performing the same responsibility share a consumer; independent responsibilities have separate consumers. Reserve ordered consumers for disposable reads. Decide whether this should be the default with documented exceptions or a strict requirement. Link to the existing [delivery guarantees](../coding-standards/distributed-interactions.md#delivery-reliability).

2. **Require confirmed JetStream publication and stable deduplication identity.** Report publication success, or mark an outbox item published, only after a successful `PubAck`. Derive `Nats-Msg-Id` from the stable event occurrence identity, with uniqueness sufficient for the destination stream. Retries reuse it; async publishers inspect every result. This supplies NATS mechanics for the existing outbox and identity rules, without claiming broker deduplication replaces application idempotency.

3. **Map delivery outcomes explicitly to NATS acknowledgment behavior.** Configure finite delivery attempts, acknowledgment deadlines, and delayed retries deliberately. Decide how permanent/exhausted failures enter durable quarantine before the original delivery is discarded; cover server-side exhaustion as well as failures the handler receives. A bare `term()` or `MaxDeliver` setting cannot fulfill the existing quarantine rule. Numerical settings and a particular quarantine implementation remain open.

4. **Choose event retention from replay and consumer-independence needs.** Prefer limits-based event history when late consumers or rebuilding projections require replay. Use interest-based retention only when its consumer-registration and deletion semantics meet the contract; work-queue retention fits tasks with one processing responsibility. Decide the required replay horizon and overflow behavior per stream, instead of prescribing one duration repository-wide.

5. **Give broker configuration and durable state explicit owners.** Decide whether infrastructure provisioning or service startup owns each stream/consumer definition, and how deployed configuration is checked against required delivery semantics. Treat durable consumer deletion or recreation as a state change, not ordinary connection cleanup. During shutdown, stop pulling, finish or abandon bounded in-flight work according to the existing lifecycle rules, send required acknowledgments, and await publication confirmations before closing. Configuration authority is a proposed repository convention; upstream documentation describes mechanisms, not our ownership model.

## Partitioning investigation (historical)

The user accepted the following principle, now recorded in [delivery reliability](../coding-standards/distributed-interactions.md#delivery-reliability):

> Independent entities must be processable concurrently across replicas. Where correctness requires serialization, scope it to the smallest relevant consistency boundary.

The initial mechanism proposal used NATS's subject partitioning. NATS hashes selected subject tokens into stable partitions; the same key goes to the same partition. The key must be present in the subject. A stream or source transform can add the partition token without requiring the producer to calculate it. [Subject transforms](https://docs.nats.io/learn/jetstream/subject-mapping).

Initial proposed wording, subsequently qualified by the source audit above:

> Use shared durable pull consumers for ordinary parallel processing. Where processing requires per-entity serialization, use deterministic subject partitioning by the relevant entity or aggregate key. Give each independent processing responsibility one durable pull consumer per partition, with explicit acknowledgments and `MaxAckPending = 1`. Replicas share those consumers, and all event types requiring serialization together use the same partition consumer.

This combines NATS's [shared-worker model](https://docs.nats.io/learn/jetstream/worker-pool) with its [partitioned-consumption model](https://nats.io/blog/orbit-partitioned-consumer-groups/). It is our proposed standard, not a requirement to partition every NATS workload.

Design consequences to retain when writing the guideline:

- A partition can contain multiple entities. Those entities share a queue, so a slow entity can delay others. The partition count bounds parallel delivery for that processing responsibility.
- Scaling replicas need not change partition count. Changing the count or key can remap entities. Inference: old and new assignments need coordinated handover so outstanding work cannot bypass the intended serialization boundary. NATS documents the remapping consequence in [subject-mapping pitfalls](https://docs.nats.io/learn/core-nats/subject-mapping#pitfalls).
- Partitioned delivery does not fence external writes. Acknowledgment timeout can redeliver a message while its original worker continues; existing replay-safe effect requirements still apply. [Redelivery pitfalls](https://docs.nats.io/learn/jetstream/acknowledgment#pitfalls).
- A consuming application's sourced stream can add its own partition routing without rewriting subjects globally. That introduces another retained copy and its own lag and retention choices; this topology is a separate decision. Combining separate origin streams does not create a business ordering guarantee. [Sources and mirrors](https://github.com/nats-io/nats.docs/blob/master/nats-concepts/jetstream/source_and_mirror.md).

The gateway's current routing names event types without entity IDs and uses separate consumers for upload, variant, and color events. Applying this proposal would require coordinated subject and consumer changes, not only a different pending-ack limit. Its installed `nats` 2.29.3 client exposes the required pull-consumer and transform APIs; the server must support the selected transform features. The proposal does not require Orbit's Go consumer-group library.

The authoritative home is now `docs/coding-standards/nats.md`, linked from the root index, distributed interactions, and broker-adapter guidance. NATS consumer selection, partitioning, publishing, delivery handling, and retention remain together, with references to general rules. Historical candidate wording is not adopted merely by inclusion in this research note.
