---
name: testing
description: Repository test planning, defect verification, test seam selection, execution, and infrastructure troubleshooting. Use when planning tests, verifying fixes, or running tests.
---

# Testing

Use [shared testing principles](../../../../docs/coding-standards/project-organization.md#shared-testing-principles) and select subject-specific requirements through [CODING_STANDARDS.md](../../../../CODING_STANDARDS.md). Command names such as `test-unit` and `test-integration` select workspace scripts; they do not define a test's architectural boundary.

## Choose test seams

- Use [browser E2E tests](../../../../docs/coding-standards/project-organization.md#browser-e2e-testing) for a small set of successful, complete user journeys.
- Use [driving-adapter contract tests](../../../../docs/coding-standards/adapters.md#testing) for inbound protocol translation and external responses.
- Use [capability tests](../../../../docs/coding-standards/application-and-domain.md#testing) for application decisions through a driving port with controlled adapters, never production adapters.
- Use [driven-adapter contract tests](../../../../docs/coding-standards/adapters.md#testing) for production adapters against real infrastructure and their port guarantees.

Keep capability decisions in capability tests. Test protocol translation and infrastructure behavior in adapter tests. Add [composition tests](../../../../docs/coding-standards/composition-and-operations.md#testing) when wiring or composition introduces a distinct risk.

Use `make help` to discover commands. To run a focused test, use `make test-focused PACKAGE=<workspace> ARGS='<file or filter>'`; it builds dependencies and runs tests serially. `make coverage-summary` reads existing coverage, so run the relevant coverage-producing tests first.

## Verify defect fixes

Apply this guidance to implementation defects, review feedback, and automated repairs, including CI fixes.

1. Establish the reported failure before changing the implementation with a reproduction or focused behavioral check when practical. For non-executable claims, compare with the authoritative requirement or other concrete evidence. Record any reproduction limit and the evidence used instead.
2. Identify the supported behavior and accepted scope boundaries from requirements, existing contracts, and affected callers. Inspect those callers before adapting them. Distinguish a regression introduced by the change from an inherited limitation or a proposed new requirement.
3. Select verification at the narrowest public boundary that owns the behavior using [test seam guidance](#choose-test-seams) and the applicable [testing standards](../../../../CODING_STANDARDS.md). Reuse existing suites and exercise actual integration entry points when integration is the risk. Scale additional checks to the change; existing coverage can suffice, and low-impact edits do not each require a mirrored test or paired examples.
4. When a fix narrows accepted inputs, changes classification, or adds a restriction, cover both the reported defect case and a closely related valid case. Check that the valid case works before and after the fix and that the defect case changes as intended. If the proposed fix rejects a supported caller, repair the false positive or incorrect restriction rather than rewriting the valid caller to accommodate it.
5. Report the evidence, checks and their results, preserved behavior, and remaining limits. State what the checks establish without claiming broader correctness.

## Container failures

- Integration tests and container E2E suites start their own containers. Docker must be running. Local `make ci` excludes E2E; GitHub Actions enforces complete E2E coverage. Explicit local `make test-e2e` provisions only selected dependencies and owns browser stack startup and cleanup. Follow [contributor guidance](../../../../CONTRIBUTING.md#check-a-change) for prerequisites, deadlines, diagnostics, and the shared Docker host lock used by Docker-heavy validation across worktrees.
- Check where the caller runs. Host test code needs a published host address and mapped port; a service on the test Docker network needs the network alias and internal port. Use the endpoints supplied by the tester rather than inventing connection strings.
- Await tester setup before accessing resources. Await cleanup between tests and destroy resources after the suite. When teardown hangs, inspect live clients, consumers, and application lifetimes before increasing timeouts.
- Keep container tests serial when diagnosing resource exhaustion. Increasing concurrency or retry counts can hide the cause.

Use the [test-utils source](../../../../packages/test-utils/src/) and existing test setups for the current builder API. Do not copy a separate API reference into documentation.
