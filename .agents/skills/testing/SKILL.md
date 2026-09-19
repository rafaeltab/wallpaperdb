---
name: testing
description: WallpaperDB test commands, infrastructure, coverage reports, and debugging. Use when running tests or working with repository test tooling; use the coding guidelines index to find the testing guidance relevant to the subject under test.
---

# Testing

Use [shared testing principles](../../../docs/coding-standards/project-organization.md#shared-testing-principles) and select subject-specific testing requirements through the [coding guidelines index](../../../CODING_STANDARDS.md).

## Existing command groups

These names select workspace scripts in the current Make/Turbo setup. They do not prescribe a test's public boundary or where a capability must live.

| Command | Workspace script |
| --- | --- |
| `make test-unit` | `test:unit` |
| `make test-integration` | `test:integration` |
| `make test-e2e` | `test:e2e` |

## Infrastructure Requirement

Integration and E2E tests require docker to be running. If a lot of e2e or integration tests are failing, verify whether docker is running or not.
The tests start their own docker containers.

## Key Tip: Use `127.0.0.1` Not `localhost`

In Testcontainers, always use `127.0.0.1` for connection strings instead of `localhost`. The DNS lookup for `localhost` adds ~5 seconds per connection attempt.

## Coverage

```
make test-unit test-integration      # Run all tests with coverage enabled
make coverage-summary   # Print an AI-friendly summary to the terminal
```

Reports land in `coverage/`:
- `coverage/index.html` — interactive HTML report (open in browser)
- `coverage/coverage-summary.json` — machine-readable summary
- `coverage/lcov.info` — LCOV format for Codecov integration

## Test a specific file

`pnpm --filter @wallpaperdb/<service> test <filename>`

## Test using a pattern

`pnpm --filter @wallpaperdb/<service> test --grep "<pattern>"`

## TesterBuilder Pattern

Test infrastructure is set up using the **TesterBuilder** pattern from `@wallpaperdb/test-utils`. It provides composable, type-safe builders for spinning up containers and wiring them into the application under test.

Full documentation: `apps/docs/content/docs/packages/test-utils.mdx`  
Testing strategy guide: `apps/docs/content/docs/guides/testing-strategies.mdx`

## S3 Storage

`S3TesterBuilder` starts SeaweedFS through `.withS3()`. Use `tester.s3` for object helpers and `tester.s3.getS3Client()` for the AWS SDK S3 client. Run `make storage-test` to verify the storage contract against a real container.
