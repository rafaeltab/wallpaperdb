---
name: testing
description: Testing strategy for WallpaperDB: three test tiers (unit, integration, E2E), how to run them, coverage, and debugging. Use when writing tests, diagnosing test failures, or deciding which tier a new test belongs in.
---

# Testing

## Three Test Tiers

### Unit Tests

- **Where:** `packages/` (e.g. `core`, `events`, `url-ipv4-resolver`)
- **Characteristics:** Fast, no containers, pure logic
- **Run:** `make test-unit`
- **Use for:** Pure functions, schema validation, utility logic — anything that has no external dependencies

### Integration Tests

- **Where:** `apps/` (e.g. `ingestor`, `media`, `gateway`)
- **Characteristics:** Uses Testcontainers for real PostgreSQL, MinIO, and NATS; the application runs in-process in the same Node.js process as the tests
- **Run:** `make test-integration`
- **Use for:** Full workflows involving the database, object storage, or messaging — anything that requires real infrastructure
- **Speed:** ~2–5 seconds per suite (fast because the app is in-process)

### E2E Tests

- **Where:** `apps/*-e2e` (e.g. `ingestor-e2e`)
- **Characteristics:** Application runs inside a Docker container; tests the actual deployment artifact
- **Run:** `make test-e2e`
- **Use for:** Smoke-testing the built Docker image; verifying the service starts and responds correctly end-to-end
- **Speed:** ~10–30 seconds (slow due to Docker image build and container startup)

## Infrastructure Requirement

Integration and E2E tests require docker to be running. If a lot of e2e or integration tests are failing, verify whether docker is running or not.
The tests start their own docker containers.

## Key Tip: Use `127.0.0.1` Not `localhost`

In Testcontainers, always use `127.0.0.1` for connection strings instead of `localhost`. The DNS lookup for `localhost` adds ~5 seconds per connection attempt.

## Coverage

```
make test-coverage      # Run all tests with coverage enabled
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
