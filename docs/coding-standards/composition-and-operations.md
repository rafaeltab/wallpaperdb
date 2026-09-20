# Backend composition and operations

Scope: backend configuration, dependency composition, running resources and tasks, telemetry, and composition/deployment tests.

## Configuration and lifecycle

- Composition roots select implementations, compose [Effect Layers](application-and-domain.md#effect-and-dependencies), and own shared lifetimes. Executable entry points own process execution.
- Composition parses external configuration once and passes capability-named typed values inward. Application and domain code do not read global configuration or environment variables. Secrets reach only the adapters that require them, and invalid startup configuration fails before the application accepts work.
- Composition roots coordinate the lifecycle of long-lived resources; adapters implement their own startup and shutdown mechanics, while application and domain code do not own infrastructure lifecycles.
- Lifecycle ownership includes running tasks as well as connections. Clean up acquired resources when startup fails. During shutdown, stop accepting new work, give in-flight work a bounded opportunity to finish, and attempt remaining cleanup even if one cleanup step fails.
- Timeouts must bound underlying resource use, not only the caller's wait. Where cancellation is unavailable, bound outstanding work and account for possible late completion before retrying an operation with side effects.

For ambiguous effects spanning independent resources, follow [delivery reliability](distributed-interactions.md#delivery-reliability). For external library integration, follow [adapter guidelines](adapters.md#boundary-translation).

## Observability

- OpenTelemetry traces every interaction across driving ports, driven adapters, and durable workflow transitions, propagating trace context across synchronous and asynchronous boundaries. Spans and structured telemetry use capability language, with technical details added only by adapters.
- Domain code remains free of observability dependencies. Telemetry must not change application outcomes or expose secrets or unnecessary personal data.
- Driven adapters are responsible for ensuring that technical failures they translate into application outcomes or typed errors are recorded through the telemetry mechanism with actionable underlying diagnostic context. Library instrumentation may fulfill this responsibility. When library instrumentation records a failure, don't record the same details twice; only meaningful additional information may be recorded.
- Application code and adapters emit telemetry through that mechanism; the telemetry library controls enablement, sampling, and export. Disabled telemetry does not require an alternative recording path.
- Event logs and traces include event identity, correlation and causation, relevant domain identity, consumer identity, delivery attempt, outcome, and duration without recording secrets or personally identifiable information.
- Configure alerts for unavailability of services or dependencies whose failure prevents important operations or disables protective controls, including when requests continue to succeed.
- When changing metrics consumed by dashboards or alerts, preserve compatibility or update those consumers together. Changes to what a metric measures must also be reflected in affected queries, descriptions, and alert conditions.

For opaque diagnostic causes and application decisions, follow [outcomes and failures](application-and-domain.md#outcomes-and-failures). Public responses follow [adapter disclosure rules](adapters.md#public-http-apis).

## Testing

- Integration tests prove that the composition root and real adapters work together through a small representative path; they do not repeat the capability's full behavioral matrix. Test wiring at this boundary.
- End-to-end tests prove only crucial flows through deployed artifacts and real application boundaries. Test deployment risk at this boundary.
- Test that the telemetry mechanism works. Avoid tests asserting individual traces or logs. Metrics may be tested where useful, but metric tests are not required. This is an explicit qualification of the general requirement to test observable guarantees.

Apply the [shared testing principles](project-organization.md#shared-testing-principles). Capability decisions belong in [capability tests](application-and-domain.md#testing); protocol and infrastructure semantics belong in [adapter tests](adapters.md#testing).
