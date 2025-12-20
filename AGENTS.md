# AGENTS.md

This file provides guidance to AI agents (Claude, Gemini, etc.) when working with code in this repository.

---

## Known Tool Behaviors

### Bash Command Execution Order

**Issue:** OpenCode sometimes doesn't perform bash tasks in the order they appear, especially when one of them needs to ask for permission.

**Impact:** When making multiple bash tool calls in parallel (e.g., `git add` followed by `git status`), if one requires user permission, the second command may execute before the first one completes. This can lead to seeing stale state.

**Workaround:** Chain dependent commands with `&&` in a single bash call, or wait for permission-requiring commands to complete before issuing subsequent commands.

**What happened:** When moving files with `git mv` and then checking status, the status command ran before the move permission was granted, showing incorrect state. However, the moves were actually performed correctly.

## Development Principles

**CRITICAL RULES - ALWAYS FOLLOW:**

### 1. Test-First Development (TDD)
- **Write tests before implementation**
- Every change must have corresponding tests
- Tests validate the change works
- See [Development Guidelines](apps/docs/content/docs/development-guidelines.mdx) for detailed TDD workflow

### 2. Incremental Changes
- **Make small, focused changes**
- Never big-bang refactoring
- Test after each increment
- Example: Extract ONE connection at a time, not all connections
- See [Development Guidelines](apps/docs/content/docs/development-guidelines.mdx) for migration patterns

### 3. Document As You Go
- Update Fumadocs (`apps/docs/content/docs/`) when architecture changes
- Update `plans/` when decisions are made
- Keep CLAUDE.md current with workflows
- Create ADRs for architectural decisions in `apps/docs/content/docs/architecture/decisions/`

### 4. Migration Strategy
- Create new structure alongside old
- Migrate piece by piece
- Verify tests pass after each piece
- Remove old structure only when fully migrated

**Full guidelines:** [Development Guidelines](apps/docs/content/docs/development-guidelines.mdx) (run `make docs-dev` to view the rendered site)

---

## Multi-Service Architecture

**Current Status:** Single service (ingestor) completed. Planning multi-service architecture.

**Strategic Direction:**
- Continue with **Fastify + TSyringe** (NOT migrating to NestJS)
- Extract shared packages (`@wallpaperdb/core`, `@wallpaperdb/events`, `@wallpaperdb/test-utils`, `@wallpaperdb/testcontainers`, `@wallpaperdb/url-ipv4-resolver`)
- Build service templates for rapid development
- Target: ~1 week per new service

**Why Fastify over NestJS:**
- 4-6 weeks migration cost vs 2 weeks for shared packages
- Excellent test infrastructure (TesterBuilder)
- Maximum flexibility per service
- See [ADR-001: Fastify over NestJS](apps/docs/content/docs/architecture/decisions/001-fastify-over-nestjs.mdx)

**Master Plan:** [plans/multi-service-architecture.md](plans/multi-service-architecture.md)

**Services:**
1. ✅ **Ingestor** - Upload and validation (complete)
2. 🚧 **Media Service** - Retrieval and resizing (IN PROGRESS)
3. 📋 **Thumbnail Extractor** - Video thumbnail generation (planned)
4. 📋 **Quality Enrichment** - Image quality analysis (planned)
5. 📋 **Color Enrichment** - Color extraction (planned)
6. 📋 **Tagging Service** - Tag management (planned)
7. 📋 **Gateway** - GraphQL API (future)

---

## Command Execution Policy

**CRITICAL: Always use Make commands for all operations.**

- **Primary interface:** All commands should go through the `Makefile`
- **Add new commands:** If a command is needed frequently, add it to the Makefile instead of running direct pnpm/turbo commands
- **Never use absolute paths:** Always use relative paths or Make targets
- **Check Makefile first:** Run `make help` to see available commands before suggesting alternatives

**Why:** This ensures consistency, discoverability, and a single source of truth for all operations.

## Project Overview

WallpaperDB is a wallpaper management system built as a Turborepo monorepo. The **Ingestor Service** is the main application - a Fastify-based HTTP service that receives wallpaper uploads, validates them, stores them in MinIO (S3), records metadata in PostgreSQL, and publishes events to NATS for downstream processing.

**Technology Stack:**
- Monorepo: Turborepo with pnpm workspaces
- HTTP Server: Fastify with TypeScript
- Database: PostgreSQL with Drizzle ORM
- Object Storage: MinIO (S3-compatible) via AWS SDK v3
- Messaging: NATS with JetStream
- Testing: Vitest with Testcontainers (real infrastructure in tests)
- Observability: OpenTelemetry with Grafana LGTM stack
- API Documentation: OpenAPI 3.0 with Swagger UI + Fumadocs
- Linting/Formatting: Biome

## Common Commands

**Always check `make help` for the complete list of available commands.**

### Quick Start

```bash
make infra-start    # Start infrastructure (PostgreSQL, MinIO, NATS, Redis, Grafana)
make dev            # Start all services in development mode
```

### Infrastructure Management

The local infrastructure stack (PostgreSQL, MinIO, NATS, Redis, OpenSearch, Grafana) must be running before developing or testing:

```bash
make infra-start      # Start all infrastructure (first-time setup takes ~2 min)
make infra-stop       # Stop all infrastructure
make infra-reset      # Delete all data and restart (WARNING: destructive)
make infra-logs       # Tail logs from all services
```

### All Services (Use These for Multi-Service Development)

```bash
make dev          # Start all services in development mode
make build        # Build all services
make test         # Run all tests
make test-watch   # Run all tests in watch mode
make format       # Format all code
make lint         # Lint all code
```

### Testing (by intensity)

Tests are organized by resource intensity for efficient local development:

```bash
make test-unit         # Unit tests (fast, no containers) - core, events, url-ipv4-resolver
make test-integration  # Integration tests (Testcontainers) - ingestor
make test-e2e          # E2E tests (heavy containers, sequential) - testcontainers, test-utils, ingestor-e2e
make test-ui           # Run tests with Vitest UI
make coverage-summary  # Display AI-friendly coverage summary
```

**Turbo Caching:** All test commands use Turbo, so unchanged packages are skipped automatically.

**Coverage Reports:** Generated by `make ci` and merged from all packages.
- HTML: `open coverage/index.html`
- JSON: `coverage/coverage-summary.json`
- LCOV: `coverage/lcov.info`

### Replicating CI Locally

Run the full CI pipeline locally before pushing:

```bash
make ci
```

This runs: `turbo run build lint check-types test:unit test:integration` → `turbo run test:e2e --concurrency=1` → merges coverage

Individual CI steps:
```bash
make build            # Build all packages
make lint             # Lint all code
make check-types      # Type check all packages
make test-unit        # Fast unit tests (no containers)
make test-integration # Integration tests with Testcontainers
make test-e2e         # E2E tests (sequential to avoid Docker overload)
```

### Single Service Commands (Ingestor)

Use these when working on a single service:

```bash
# Development
make ingestor-dev          # Start with hot-reload (tsx watch)
make ingestor-build        # TypeScript compilation (outputs to dist/)
make ingestor-start        # Run production build

# Testing
make ingestor-test         # Run all tests (requires infra running)
make ingestor-test-watch   # Run tests in watch mode

# E2E Testing (Docker-based)
make ingestor-e2e-test         # Run E2E tests against Docker container
make ingestor-e2e-test-watch   # Run E2E tests in watch mode
make ingestor-e2e-verify       # Verify no app code imports in E2E tests

# Code Quality
make ingestor-format       # Format code with Biome
make ingestor-lint         # Lint code with Biome
make ingestor-check        # Run Biome check (format + lint + fixes)

# Docker (for E2E testing)
make ingestor-docker-build # Build Docker image
make ingestor-docker-run   # Run Docker container
make ingestor-docker-stop  # Stop Docker container
make ingestor-docker-logs  # View Docker container logs
```

### Database Commands

**Note:** Database commands are not yet in Makefile. If used frequently, add them to Makefile.

```bash
pnpm --filter @wallpaperdb/ingestor db:generate   # Generate migrations from schema
pnpm --filter @wallpaperdb/ingestor db:push       # Push schema directly (dev only)
pnpm --filter @wallpaperdb/ingestor db:migrate    # Run migrations
pnpm --filter @wallpaperdb/ingestor db:studio     # Open Drizzle Studio
```

### Redis Commands

```bash
make redis-cli       # Connect to Redis CLI
make redis-flush     # Flush all Redis data (WARNING: deletes all data)
make redis-info      # Show Redis server info
```

**Redis Usage:**
- Distributed rate limiting (atomic Lua script for upload rate limits)
- Metadata caching (future)
- Session storage (future)

### NATS Commands

```bash
make nats-setup-streams  # Setup all required NATS JetStream streams
make nats-stream-list    # List all NATS streams
make nats-stream-info    # Show info for WALLPAPER stream
```

**NATS Streams:**
- `WALLPAPER` stream with subjects: `wallpaper.*`
- Required for event-driven communication between services

### OpenAPI Commands

```bash
make openapi-generate  # Generate OpenAPI specs (swagger.json)
make docs-generate     # Generate API documentation from OpenAPI specs
make openapi-verify    # Verify OpenAPI spec generation
```

**Access Points:**
- Swagger UI: http://localhost:3001/documentation (when ingestor is running)
- Docs Site: [apps/docs/content/docs](apps/docs/content/docs) (run `make docs-dev` to view at http://localhost:3002)
- Generated Spec: `apps/ingestor/swagger.json`

### Running Specific Tests

**Note:** If these patterns are used frequently, consider adding them to the Makefile.

```bash
# Run specific test file
pnpm --filter @wallpaperdb/ingestor test upload-flow.test.ts

# Run tests matching pattern
pnpm --filter @wallpaperdb/ingestor test --grep "validation"
```

## Architecture

### Monorepo Structure

```
apps/
  ingestor/         # Main wallpaper ingestion service (Fastify)
  docs/             # Documentation site (Fumadocs, auto-generated API docs)
packages/
  core/             # Shared utilities (config, telemetry, OpenAPI, health)
  events/           # Event schemas and base consumers/publishers
  testcontainers/   # Shared test utilities (custom NATS container setup)
  test-utils/       # TesterBuilder pattern for testing
infra/              # Docker Compose infrastructure for local dev
```

### Ingestor Service Architecture

**State Machine Pattern:**
The ingestor implements a sophisticated upload state machine:

```
initiated → uploading → stored → processing → completed
                                            ↘ failed
```

Each state transition is persisted in PostgreSQL to ensure reliability:
- `initiated`: Intent recorded (write-ahead log)
- `uploading`: File being uploaded to MinIO
- `stored`: File in MinIO, metadata in DB, awaiting NATS publish
- `processing`: Event published to NATS, downstream services working
- `completed` or `failed`: Terminal states

**Key Design Decisions:**
1. **Non-blocking NATS**: Upload succeeds even if event publishing fails (stays in `stored` state)
2. **Reconciliation System**: Background jobs recover stuck states and ensure eventual consistency
3. **Content-based Deduplication**: SHA256 hash prevents duplicate uploads per user
4. **RFC 7807 Error Handling**: Structured error responses with `application/problem+json`

### Database Schema (Drizzle ORM)

The `wallpapers` table uses a state machine pattern with these key fields:

```typescript
wallpapers {
  id: text                    // Format: wlpr_<ulid>
  userId: text
  contentHash: text           // SHA256 for deduplication
  uploadState: enum           // State machine: initiated → uploading → stored → processing → completed/failed
  stateChangedAt: timestamp
  uploadAttempts: integer
  processingError: text

  // File metadata (null until 'stored')
  fileType: enum              // 'image' | 'video'
  mimeType: text
  fileSizeBytes: bigint
  width, height: integer
  aspectRatio: decimal(10,4)

  // Storage references
  storageKey: text            // S3 path: wlpr_<ulid>/original.<ext>
  storageBucket: text

  uploadedAt, updatedAt: timestamp
}
```

**Critical Index:** `idx_wallpapers_content_hash` is a **conditional unique index** - only enforced for stored/processing/completed states. This prevents duplicate uploads while allowing failed uploads to be retried.

### Service Interactions

**Upload Flow:**
1. Client uploads file → `/upload` endpoint
2. File validated (format, size, dimensions, content-based MIME detection)
3. SHA256 hash calculated, duplicate check against DB
4. State: `initiated` → Insert DB record
5. State: `uploading` → Upload to MinIO (`bucket/wlpr_<ulid>/original.<ext>`)
6. State: `stored` → Record all metadata
7. Publish NATS event to `wallpaper.uploaded` subject
8. State: `processing` (if NATS succeeds) or stays `stored` (reconciliation will retry)

**Reconciliation System:**
Four background jobs ensure eventual consistency:
- `reconcileStuckUploads`: Recover uploads stuck in `uploading` state (checks MinIO)
- `reconcileMissingEvents`: Republish NATS events for records stuck in `stored` state
- `reconcileOrphanedIntents`: Delete abandoned `initiated` records (>1 hour old)
- `reconcileOrphanedMinioObjects`: Delete MinIO objects without DB records

All reconciliation operations are **idempotent** and safe to run repeatedly.

### File Organization

```
apps/ingestor/src/
├── app.ts                    # Fastify application factory
├── index.ts                  # Entry point (server lifecycle)
├── config.ts                 # Zod-validated configuration
├── connections/              # Service-specific connection extensions
│   ├── database.ts          # Extends core DatabaseConnection with service schema
│   ├── minio.ts             # Extends core MinioConnection
│   ├── nats.ts              # Extends core NatsConnectionManager
│   └── otel.ts              # Extends core OtelConnection
├── db/schema.ts              # Drizzle schema definitions
├── routes/                   # HTTP handlers (registered as Fastify plugins)
│   ├── health.routes.ts     # /health and /ready
│   └── upload.routes.ts     # /upload
├── services/                 # Business logic
│   ├── file-processor.service.ts       # Validation, metadata extraction (Sharp)
│   ├── storage.service.ts              # MinIO operations
│   ├── events.service.ts               # NATS event publishing
│   ├── validation-limits.service.ts    # Per-user limits (subscription-ready)
│   └── reconciliation.service.ts       # Eventual consistency logic
└── errors/problem-details.ts           # RFC 7807 error classes
```

### Testing Strategy

**Tests by Intensity:**

- **Unit Tests** (`make test-unit`)
  - Fast, no containers needed
  - Pure logic tests in `packages/`
  - Packages: `core`, `events`, `url-ipv4-resolver`
  - Run frequently during development

- **Integration Tests** (`make test-integration`)
  - Uses Testcontainers for real infrastructure
  - Tests full workflows with PostgreSQL, MinIO, NATS
  - Apps: `ingestor`
  - Runs with `--concurrency=1` to avoid Docker overload

- **E2E Tests** (`make test-e2e`)
  - Heavy container usage, tests deployment artifacts
  - Packages: `testcontainers`, `test-utils`, `ingestor-e2e`
  - Runs with `--concurrency=1` (sequential)
  - Slowest but most comprehensive

**Test Coverage:**

✅ **Setup Complete** - Full coverage tracking enabled

```bash
make test-coverage          # Run with coverage
make coverage-summary       # AI-friendly summary
open coverage/index.html    # View HTML report
```

**Coverage Reporters:**
- `text`: Console output during test runs
- `json`: Machine-readable format (`coverage/coverage-summary.json`)
- `html`: Interactive browser report (`coverage/index.html`)
- `lcov`: For Codecov integration (`coverage/lcov.info`)
- `json-summary`: For the AI-friendly summary script

**CI/CD Integration:**
- GitHub Actions runs tests on push/PR
- Coverage tracked via Codecov
- Two workflows: `ci.yml` (build, lint, types, unit, integration) and `e2e.yml` (E2E tests)

**Current Test Approach:**

- **Testcontainers-Based Integration Tests:**
  - Tests run against **real infrastructure** (PostgreSQL, MinIO, NATS containers)
  - Shared setup in `test/setup.ts` starts containers once, runs migrations
  - Custom `@wallpaperdb/testcontainers` package provides reusable container utilities
  - Uses `127.0.0.1` instead of `localhost` to avoid DNS lookup delays (~5s per test)

- **Test Categories:**
  - Upload flow (happy path for JPEG, PNG, WebP)
  - Validation (format, size, dimensions, MIME detection)
  - Idempotency and deduplication
  - Reconciliation (stuck uploads, missing events, orphaned objects)
  - Multi-instance concurrency

**Important:** Service tests require infrastructure running. Start with `make infra-start` before running tests.

### Security Considerations

**File Processing:**
- Content-based MIME detection (not trusting client-provided Content-Type)
- Decompression bomb protection (Sharp limits: 16384 x 16384 pixels)
- Filename sanitization (strip special characters, length limits)
- Memory-efficient streaming (no full file in memory)
- Upload limits: 50MB images, 200MB videos (enforced via Fastify multipart)

**Storage Security:**
- Each wallpaper isolated in own directory: `bucket/wlpr_<ulid>/original.<ext>`
- Metadata verification using Sharp (actual dimensions, not client-provided)
- Content hash prevents duplicate processing

### Configuration

**Environment Variables:**
All config validated with Zod schemas. See `apps/ingestor/src/config.ts` for full list.

Key variables:
- `DATABASE_URL`: PostgreSQL connection string
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`: Object storage
- `NATS_URL`: NATS server
- `OTLP_ENDPOINT`: OpenTelemetry collector (optional, defaults to Grafana LGTM at `http://localhost:4318`)

**Infrastructure Defaults:**
The `infra/.env` file (auto-generated from `.env.example`) contains all local development credentials. Default values work out of the box.

## Documentation

**Primary Documentation:** [apps/docs/content/docs](apps/docs/content/docs) (run `make docs-dev` to view the rendered site at http://localhost:3002)

**Key Documentation Pages:**
- **Getting Started**: Quick 10-minute setup guide
- **Development Guidelines**: TDD, incremental changes, coding standards
- **Guides**: Creating services, error handling, rate limiting, testing strategies, Makefile commands, database migrations
- **Architecture**: Multi-service architecture, service registry, shared packages, ADRs
- **Packages**: Core, events, test-utils, testcontainers, url-ipv4-resolver
- **Services**: Ingestor (complete), Media (in progress), planned services
- **Infrastructure**: PostgreSQL, MinIO, NATS, Redis, OpenSearch, Grafana

**Testing Documentation:**
- **[Package: Test Utils](apps/docs/content/docs/packages/test-utils.mdx)** - TesterBuilder pattern documentation
- **[Guide: Testing Strategies](apps/docs/content/docs/guides/testing-strategies.mdx)** - Unit, integration, E2E test organization
- **[Guide: Creating New Service](apps/docs/content/docs/guides/creating-new-service.mdx)** - Includes testing setup

**Key Concepts:**
- **TesterBuilder Pattern**: Composable, type-safe test infrastructure setup
- **Integration Tests**: App runs in-process (same Node.js), fast (~2-5 seconds)
- **E2E Tests**: App runs in Docker container, slower (~10-30 seconds) but tests deployment artifact
- **Builders Available**: Docker, Postgres, MinIO, NATS, Redis (infrastructure) + custom application builders

## Infrastructure Services

After `make infra-start`, access:
- PostgreSQL: `postgresql://wallpaperdb:wallpaperdb@localhost:5432/wallpaperdb`
- MinIO Console: http://localhost:9001 (minioadmin/minioadmin)
- MinIO API: http://localhost:9000
- OpenSearch: http://localhost:9200
- OpenSearch Dashboards: http://localhost:5601
- NATS: `nats://localhost:4222`
- NATS Monitoring: http://localhost:8222
- Grafana: http://localhost:3000 (admin/admin)
- OTLP endpoints: gRPC `localhost:4317`, HTTP `localhost:4318`

## Observability

**Current Status:** Basic OTEL setup. Advanced instrumentation planned.

**OpenTelemetry Integration:**
- Auto-instrumentation for Fastify, PostgreSQL, HTTP clients
- Traces and metrics exported to Grafana LGTM stack via OTLP
- Service name: `wallpaperdb-ingestor` (configurable via `SERVICE_NAME` env var)
- Access dashboards in Grafana (port 3000)
- **Custom Dashboards**: Media Service Dashboard at `/infra/grafana/dashboards/media-service-dashboard.json`

**Shared Packages:**

- **`@wallpaperdb/core`** - Shared utilities for all services
  - Connection managers (DatabaseConnection, MinioConnection, NatsConnectionManager, RedisConnection, **OtelConnection**)
  - Config schemas (Database, S3, NATS, Redis, OTEL, Server)
  - Telemetry module (`withSpan()`, `recordCounter()`, `recordHistogram()`)
  - OpenAPI plugin (`registerOpenAPI()`) + shared schemas
  - Health aggregator and formatters
  - RFC 7807 error classes (ProblemDetailsError, ApplicationError)
  - No DI coupling - static imports, easy to use

- **`@wallpaperdb/events`** - Event-driven architecture utilities
  - Event schemas (Zod) for all domain events
  - BaseEventPublisher with trace context propagation
  - BaseEventConsumer for service event handlers

- **`@wallpaperdb/test-utils`** - Testing infrastructure
  - TesterBuilder pattern for composable test setups
  - Infrastructure builders (Docker, Postgres, MinIO, NATS, Redis)
  - Container reuse across test files

- **`@wallpaperdb/testcontainers`** - Custom container implementations
  - Custom NATS container with JetStream setup
  - Future: PostgreSQL, MinIO, Redis containers

- **`@wallpaperdb/url-ipv4-resolver`** - URL validation
  - URL parsing and validation
  - DNS resolution to IPv4
  - SSRF prevention

- **Pattern:**
  ```typescript
  import { withSpan } from '@wallpaperdb/core/telemetry';
  import { Attributes } from '@wallpaperdb/core/telemetry/attributes';

  async myOperation(userId: string) {
    return await withSpan(
      'my.operation',
      { [Attributes.USER_ID]: userId },
      async (span) => {
        // business logic
        span.setAttribute(Attributes.CUSTOM_ATTR, value);
        return result;
      }
    );
  }
  ```

- **Distributed Tracing:**
  - Trace context propagation to NATS headers
  - End-to-end tracing across services
  - Critical for multi-service debugging

## Common Development Workflows

### Starting Development

```bash
make infra-start    # Start infrastructure (first time takes ~2 min)
make dev            # Start all services
```

### Adding a New Route
1. Create route file in `apps/ingestor/src/routes/`
2. Register in `apps/ingestor/src/routes/index.ts`
3. Add tests in `apps/ingestor/test/`
4. Run `make ingestor-test` to verify

### Modifying Database Schema
1. Edit `apps/ingestor/src/db/schema.ts`
2. Generate migration: `pnpm --filter @wallpaperdb/ingestor db:generate`
3. Review generated SQL in `drizzle/` directory
4. Apply migration: `pnpm --filter @wallpaperdb/ingestor db:migrate`
5. Update tests as needed

**Consider adding frequently used db commands to Makefile** (e.g., `make db-migrate`, `make db-studio`)

### Adding a New Service
1. Create service file in `apps/ingestor/src/services/`
2. Inject dependencies via constructor (connections, other services)
3. Add corresponding tests using Testcontainers
4. Register in `app.ts` if needed for route handlers

### Creating a New Service

**Future:** Service template generator (planned)

**For now (manual):**
1. Create service directory under `apps/`
2. Copy structure from `apps/ingestor`
3. Use shared packages:
   - `@wallpaperdb/core` - Config, telemetry, OpenAPI, health
   - `@wallpaperdb/events` - Event schemas, publishers, consumers
4. Register OpenAPI: `import { registerOpenAPI } from '@wallpaperdb/core/openapi'`
5. Add Make targets to `Makefile`
6. Add to CI/CD workflows
7. Update `plans/services.md`

**Target time:** ~1 week per service (shared packages complete)

See: [plans/multi-service-architecture.md](plans/multi-service-architecture.md)

### Adding a New Workspace/Package
1. Create new workspace directory under `packages/`
2. Add to `pnpm-workspace.yaml` (usually automatic with pattern matching)
3. Create `package.json` with `@wallpaperdb/` scope
4. Add tests with Vitest
5. Add Make targets if needed
6. Document in [apps/docs/content/docs/architecture/shared-packages.mdx](apps/docs/content/docs/architecture/shared-packages.mdx)

### Debugging Tests
1. Ensure infrastructure is running: `make infra-start`
2. Check container logs if tests hang: `make infra-logs`
3. Use Drizzle Studio to inspect database: `pnpm --filter @wallpaperdb/ingestor db:studio`
4. Check MinIO console for uploaded files: http://localhost:9001
5. View NATS monitoring for published events: http://localhost:8222

### Adding New Make Commands

When you find yourself running the same pnpm/turbo commands repeatedly, add them to the Makefile:

1. Edit `Makefile` at repository root
2. Add command following existing patterns:
   ```makefile
   service-command:
       @turbo run command --filter=@wallpaperdb/service
   ```
3. Add to `.PHONY` declaration at top
4. Add to `make help` output
5. Test the command: `make service-command`
