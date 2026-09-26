---
name: testing
description: Repository test execution and infrastructure pitfalls. Use when running or troubleshooting tests.
---

# Testing

Use [shared testing principles](../../../docs/coding-standards/project-organization.md#shared-testing-principles) and select subject-specific requirements through [CODING_STANDARDS.md](../../../CODING_STANDARDS.md). Command names such as `test-unit` and `test-integration` select workspace scripts; they do not define a test's architectural boundary.

Use `make help` to discover commands. To run a focused test, use `make test-focused PACKAGE=<workspace> ARGS='<file or filter>'`; it builds dependencies and runs tests serially. `make coverage-summary` reads existing coverage, so run the relevant coverage-producing tests first.

## Container failures

- Integration tests and service E2E tests start their own containers. Docker must be running. The browser E2E workspace uses the Compose application stack; follow its setup instructions.
- Check where the caller runs. Host test code needs a published host address and mapped port; a service on the test Docker network needs the network alias and internal port. Use the endpoints supplied by the tester rather than inventing connection strings.
- Await tester setup before accessing resources. Await cleanup between tests and destroy resources after the suite. When teardown hangs, inspect live clients, consumers, and application lifetimes before increasing timeouts.
- Keep container tests serial when diagnosing resource exhaustion. Increasing concurrency or retry counts can hide the cause.

Use the [test-utils source](../../../packages/test-utils/src/) and existing test setups for the current builder API. Do not copy a separate API reference into documentation.
