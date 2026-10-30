# Test utilities

Composable builders give integration and deployment tests isolated infrastructure with shared setup, cleanup between tests, and teardown.

- Starts PostgreSQL, SeaweedFS object storage, NATS, Redis, and OpenSearch, with Docker networking support.
- Checks builder prerequisites at compile time.
- Generates image fixtures, video stubs, hashes, and identifiers.
- Supplies event-envelope conformance cases for conflicting, missing, and repeated metadata and preserved transport identity.

[Event contract fixtures](src/event-contracts/index.ts) contain no application imports or assertions; consumers exercise their own public adapter or broker interface. Object storage image overrides must be SeaweedFS-compatible. See the [builders](src/index.ts), [tests](tests), and [testing principles](../../docs/coding-standards/project-organization.md#shared-testing-principles).
