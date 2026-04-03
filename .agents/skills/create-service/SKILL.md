---
name: create-service
description: Step-by-step guide for creating a new microservice in apps/ or a new shared package in packages/. Use when scaffolding a new service, adding a new shared library, or understanding what a fully integrated service requires.
---

# Create Service

## Creating a New Microservice (`apps/`)

### 1. Scaffold the Service

Copy the structure of `apps/ingestor` as your starting point. It is the canonical reference service — fully integrated with all shared packages, CI, and observability.

### 2. Wire Up Shared Packages

Every service must consume:

- **`@wallpaperdb/core`** — connection managers (database, MinIO, NATS, Redis, OTEL), config schemas, telemetry helpers (`withSpan`, `recordCounter`, `recordHistogram`), health aggregator, OpenAPI plugin, RFC 7807 error classes
- **`@wallpaperdb/events`** — event schemas (Zod), `BaseEventPublisher`, `BaseEventConsumer`

Optional (add as needed):
- **`@wallpaperdb/test-utils`** — TesterBuilder pattern for integration and E2E test setup
- **`@wallpaperdb/testcontainers`** — custom NATS container with JetStream
- **`@wallpaperdb/url-ipv4-resolver`** — SSRF-safe URL validation

### 3. Register OpenAPI

```typescript
import { registerOpenAPI } from '@wallpaperdb/core/openapi';

// Call inside your Fastify app factory
await registerOpenAPI(app);
```

### 4. Add Make Targets

Add the following targets to the root `Makefile` (follow patterns from existing services):

- `<service>-dev` — start with hot-reload
- `<service>-build` — TypeScript compilation
- `<service>-start` — run production build
- `<service>-test` — run all tests
- `<service>-test-watch` — run tests in watch mode
- `<service>-format`, `<service>-lint`, `<service>-check` — code quality
- `<service>-docker-build`, `<service>-docker-run`, `<service>-docker-stop`, `<service>-docker-logs` — Docker lifecycle
- `<service>-e2e-test`, `<service>-e2e-test-watch`, `<service>-e2e-verify` — E2E testing (If there will be any e2e tests)

Add all new targets to `.PHONY` and to the `make help` output.

### 5. Add to CI/CD Workflows

Add the new service to both GitHub Actions workflows:

- `.github/workflows/ci.yml` — build, lint, type-check, unit + integration tests
- `.github/workflows/e2e.yml` — E2E tests (runs sequentially, `--concurrency=1`) (If there will be any e2e tests)

### 6. Write the README

Use the `write-readme` skill to write `apps/<service>/README.md`.

### 7. Add to the Bruno Collection

The `api/` directory at the repo root is a Bruno API collection used for manual testing and exploration.

**Collection structure:**
```
api/
  bruno.json              # Collection root
  environments/
    local.bru             # Environment variables (base URLs, shared values)
  <service>/              # One folder per service
    health/
      health-check.bru
      readiness-check.bru
    <feature>/
      <request>.bru
```

**Steps:**

1. Create `api/<service>/` folder
2. Add `api/<service>/health/health-check.bru` and `readiness-check.bru` — copy from `api/ingestor/health/` and update the `docs` block to reflect which dependencies this service checks
3. Add `.bru` files for every route the service exposes, organised into subfolders by feature area
4. Add a variable for the service's base URL to `api/environments/local.bru` (e.g. `<service>BaseUrl: http://localhost:<port>`) and reference it via `{{<service>BaseUrl}}` in the request URLs

**`.bru` file format:**

```
meta {
  name: Human Readable Name
  type: http
  seq: 1
}

get {
  url: {{<service>BaseUrl}}/path
  body: none
  auth: none
}

docs {
  Plain-text description of what this request does,
  what parameters it accepts, and what responses to expect.
}
```

### 8. Document in the Docs Site

Add a new page at `apps/docs/content/docs/services/<service>.mdx` describing the service's role in the system. Follow the pattern of existing service docs pages.

### Roadmap

See `plans/multi-service-architecture.md` for the strategic roadmap and rationale.

---

## Creating a New Shared Package (`packages/`)

### 1. Create the Directory and `package.json`

```
packages/<name>/
  package.json      # name: "@wallpaperdb/<name>", scoped to this monorepo
  src/
  tsconfig.json
```

Follow the `package.json` conventions from an existing package (e.g. `packages/core`).

### 2. Add Tests with Vitest

All shared packages have unit tests. No containers required — keep them fast. Place tests alongside source or in a `test/` subdirectory following the pattern of the package being created.

### 3. Add Make Targets (if needed)

If the package has commands that will be run frequently, add Make targets following the same pattern as service targets.

### 4. Write the README

Use the `write-readme` skill to write `packages/<name>/README.md`.

### 5. Document in the Docs Site

Add or update `apps/docs/content/docs/architecture/shared-packages.mdx` to describe the new package and its purpose.
