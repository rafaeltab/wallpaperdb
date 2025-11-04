# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Linting/Formatting: Biome

## Common Commands

### Infrastructure Management
The local infrastructure stack (PostgreSQL, MinIO, NATS, OpenSearch, Grafana) must be running before developing or testing:

```bash
make infra-start      # Start all infrastructure (first-time setup takes ~2 min)
make infra-stop       # Stop all infrastructure
make infra-reset      # Delete all data and restart (WARNING: destructive)
make infra-logs       # Tail logs from all services
```

### Ingestor Development

```bash
# Development
make ingestor-dev     # Start with hot-reload (tsx watch)

# Building
make ingestor-build   # TypeScript compilation (outputs to dist/)
make ingestor-start   # Run production build

# Testing
make ingestor-test    # Run all tests (requires infra running)
make ingestor-test-watch  # Run tests in watch mode

# Code Quality
make ingestor-format  # Format code with Biome
make ingestor-lint    # Lint code with Biome
make ingestor-check   # Run Biome check (format + lint + fixes)

# Database
pnpm --filter @wallpaperdb/ingestor db:generate   # Generate migrations from schema
pnpm --filter @wallpaperdb/ingestor db:push       # Push schema directly (dev only)
pnpm --filter @wallpaperdb/ingestor db:migrate    # Run migrations
pnpm --filter @wallpaperdb/ingestor db:studio     # Open Drizzle Studio
```

### All Services Commands

```bash
make dev          # Start all services in development mode
make build        # Build all services
make test         # Run all tests
make test-watch   # Run all tests in watch mode
make format       # Format all code
make lint         # Lint all code
```

### Running Single Tests

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
packages/
  testcontainers/   # Shared test utilities (custom NATS container setup)
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
├── connections/              # Singleton connection managers
│   ├── database.ts          # PostgreSQL pool (20 max connections)
│   ├── minio.ts             # S3 client (path-style URLs for MinIO)
│   ├── nats.ts              # NATS client with JetStream
│   └── otel.ts              # OpenTelemetry SDK setup
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

**Testcontainers-Based Integration Tests:**
- Tests run against **real infrastructure** (PostgreSQL, MinIO, NATS containers)
- Shared setup in `test/setup.ts` starts containers once, runs migrations
- Custom `@wallpaperdb/testcontainers` package provides reusable container utilities
- Uses `127.0.0.1` instead of `localhost` to avoid DNS lookup delays (~5s per test)

**Test Categories:**
- Upload flow (happy path for JPEG, PNG, WebP)
- Validation (format, size, dimensions, MIME detection)
- Idempotency and deduplication
- Reconciliation (stuck uploads, missing events, orphaned objects)
- Multi-instance concurrency

**Important:** Tests require infrastructure running. Start with `make infra-start` before running tests.

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

**OpenTelemetry Integration:**
- Auto-instrumentation for Fastify, PostgreSQL, HTTP clients
- Traces and metrics exported to Grafana LGTM stack via OTLP
- Service name: `wallpaperdb-ingestor` (configurable via `SERVICE_NAME` env var)
- Access dashboards in Grafana (port 3000)

## Common Development Workflows

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

### Adding a New Service
1. Create service file in `apps/ingestor/src/services/`
2. Inject dependencies via constructor (connections, other services)
3. Add corresponding tests using Testcontainers
4. Register in `app.ts` if needed for route handlers

### Debugging Tests
1. Ensure infrastructure is running: `make infra-start`
2. Check container logs if tests hang: `make infra-logs`
3. Use Drizzle Studio to inspect database: `pnpm --filter @wallpaperdb/ingestor db:studio`
4. Check MinIO console for uploaded files: http://localhost:9001
5. View NATS monitoring for published events: http://localhost:8222
