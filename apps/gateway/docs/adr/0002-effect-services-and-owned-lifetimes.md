# Effect services and owned lifetimes

The gateway adopts Effect 4 throughout its effectful execution and dependency graph. Effect and its OpenTelemetry and Node platform packages are pinned to `4.0.0-rc.115`; the gateway's OpenTelemetry SDK moves to version 2 to match the bridge. The previous migration used Effect for execution while manually constructing its dependency graph, leaving service keys unused and background work outside the owning scope.

Application-owned TypeScript interfaces now have namespaced `Context.Service` keys. Capability layers yield their dependencies and expose only their driving ports; driven adapter layers implement the consuming capabilities' ports. `gatewayLayer` selects and composes implementations once, sharing the same OpenSearch resource between queries, projections, and health checks. Configuration values enter through named layer parameters; passwords and cursor signing secrets use Effect `Redacted` values until passed to the relevant adapter. Pure domain calculations stay pure.

This deliberately replaces the gateway's constructor-only injection and mandatory `Symbol.for` token conventions. Typed Effect requirements make dependency access explicit; capability implementations do not obtain a runtime or resolve services from a global container. Implementations remain private. This decision does not edit the repository-wide coding standards, whose separate reorganization remains on the standards branch.

Normal decisions such as missing records, invalid cursors, quota denials, and ignored projections remain explicit result values. Technical catalogue and projection failures use tagged Effect errors. Adapters retain diagnostic causes for the telemetry mechanism; capabilities do not inspect vendor failures, and transport adapters do not disclose them. Broker retry classification remains at the delivery boundary, with the existing finite delayed NAK policy instead of hidden in-process retries.

## Resource ownership

Adapter layers acquire and release their connections with Effect scopes. NATS consumption uses streams and scoped fibers; shutdown stops intake, allows bounded completion, then interrupts unfinished work before closing the connection. Unfinished deliveries are not acknowledged. Partial startup closes already acquired subscriptions and connections; finalizers continue after another finalizer fails.

Each NATS subscription processes one delivery at a time within an instance, using an iterator with single-message pulls. Replicas share durable consumers with an explicit limit of 1000 unacknowledged deliveries per durable, restoring the previous NATS default rather than serializing the entire deployment. Startup updates existing durables to this limit. The limit is a shared safety budget, not a measured capacity guarantee; atomic projection updates and replay convergence provide correctness across replicas.

Fastify and Mercurius remain foreign-framework boundaries. One managed runtime and a scoped fiber set own request execution. Client disconnects interrupt request work; shutdown gives transport requests a bounded drain period before cancellation. OpenSearch interruption invokes the SDK's abortable request, and implicit transport retries are disabled. An aborted request can still have committed server-side, so projection replay safety remains necessary.

Redis reconnects and allows requests while quota storage is unavailable. There is no production instance-local fallback. Concurrency, command and socket deadlines bound retained work; offline queuing and automatic resend are disabled. An ambiguous quota mutation is not retried during the same request. Telemetry and a provisioned alert reveal lost enforcement even when traffic succeeds.

The executable owns process signals and exit policy through `NodeRuntime`. It imports the public runner from `@effect/platform-node-shared`, which supplies the same implementation re-exported by `@effect/platform-node` without the unrelated Redis client peer requirement. Telemetry initialization precedes dynamic adapter imports and has an explicit disabled, started, or unavailable state. Its scope also covers failed imports and listener startup. Embedding code owns a scope rather than inheriting process signal handlers or exit mutations. Configuration failures retain invalid field paths without retaining supplied values, and bootstrap failures identify their stage.

## Compatibility and validation

Public GraphQL and health protocols, projection semantics, and the legacy color replay constraints from ADR 0001 remain. Producer-owned event payload schemas remain owned by the shared events package; gateway envelope, cursor, storage, and configuration validation use Effect Schema. Tests provide controlled services through layers and test resource cleanup and cancellation through public boundaries.

The gateway uses `@effect/vitest` at the matching Effect release with Vitest, coverage, and UI packages pinned to `5.0.1`. This adapter requires Vitest 5. Other workspaces retain their existing runners; the shared configuration exposes plain defaults so the gateway composes configuration with its own runner. Capability tests use `it.effect` and its test clock; real network lifecycle tests use `it.live`. Shared test layers contain immutable services, while mutable quota state is recreated per test. Foreign-framework and subprocess tests can retain conventional async boundaries. Coverage includes every production source file and retains the original thresholds despite the newer engine's changed remapping.

Migration API mappings follow the upstream Effect v3-to-v4 skill and installed source. No v3 compatibility layer is retained.
