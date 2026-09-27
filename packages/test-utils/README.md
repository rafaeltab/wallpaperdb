# Test utilities

Composable test builders give integration and deployment tests isolated infrastructure with a shared lifecycle. Tests select the dependencies they need without repeating container setup and cleanup.

## Core capabilities

- Starts PostgreSQL, SeaweedFS object storage, NATS, Redis, and OpenSearch for tests, with Docker networking support.
- Provides setup, cleanup between tests, and teardown as composable lifecycle steps.
- Checks builder prerequisites at compile time so missing dependencies are caught before a test runs.
- Generates image fixtures, video stubs, hashes, and identifiers without keeping a collection of binary test assets.
- Provides shared event-envelope conformance cases so consumers verify acceptance and preserved transport identity against the same examples, including conflicting, missing, and repeated metadata.

The [event contract fixtures](src/event-contracts/index.ts) contain no application imports or assertions; each consumer exercises its own public adapter or broker interface. The object storage builder expects a SeaweedFS-compatible image when overriding its default. See the [builders](src/index.ts) and [existing tests](tests) for usage examples. [Testing principles](../../docs/coding-standards/project-organization.md#shared-testing-principles) define which guarantees need real infrastructure.
