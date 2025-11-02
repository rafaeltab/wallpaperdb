# Ingestor Service

The ingestor service is the entry point for wallpapers into the system. It handles file uploads, validation, storage, and event publishing for downstream processing.

## Status

**Step 1: Project Setup - COMPLETED ✓**

The ingestor service workspace has been created and configured with all necessary connections to the infrastructure services.

## Quick Start

All commands can be run through Make or Turborepo:

```bash
# From the repository root
make ingestor-dev      # Start development server
make ingestor-build    # Build for production
make ingestor-format   # Format code
make ingestor-lint     # Lint code

# Or directly in the ingestor directory
cd apps/ingestor
pnpm dev               # Start development server
pnpm build             # Build for production
pnpm format            # Format code
pnpm lint              # Lint code
```

## Features (Step 1)

- ✅ Turborepo workspace configuration
- ✅ TypeScript project setup with ES modules
- ✅ Fastify HTTP server
- ✅ Connection utilities for all required services:
  - PostgreSQL (with connection pooling)
  - MinIO (S3-compatible object storage)
  - NATS (message queue)
  - OpenTelemetry (observability)
- ✅ `/health` endpoint with connection verification
- ✅ `/ready` endpoint for readiness checks
- ✅ Graceful shutdown handlers
- ✅ Environment variable configuration

## Prerequisites

Ensure the local infrastructure is running:

```bash
cd /Users/rafaelbieze/source/rafael/wallpaperdb/infra
docker compose up -d
```

## Configuration

Copy `.env.example` to `.env` (already done):

```bash
cp .env.example .env
```

Default configuration connects to local infrastructure services:
- PostgreSQL: `localhost:5432`
- MinIO: `localhost:9000`
- NATS: `localhost:4222`
- OTEL Collector: `localhost:4318`

## Development

### Using Make (Recommended)

Start the development server using Make:

```bash
make ingestor-dev
```

Build the service:

```bash
make ingestor-build
```

Run tests:

```bash
make ingestor-test
```

Format and lint:

```bash
make ingestor-format
make ingestor-lint
```

### Using pnpm directly

Alternatively, you can use pnpm commands directly:

```bash
pnpm dev
```

The server will start on `http://localhost:3001` with hot-reload enabled.

### Code Formatting & Linting

This project uses [Biome](https://biomejs.dev/) for formatting and linting.

**Format code:**
```bash
pnpm format           # Format all files
pnpm format:check     # Check formatting without changing files
```

**Lint code:**
```bash
pnpm lint             # Check for linting issues
pnpm lint:fix         # Fix linting issues automatically
```

**Format + Lint:**
```bash
pnpm check            # Run both formatting and linting with auto-fix
```

**VS Code Integration:**
Install the recommended [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) for automatic formatting on save.

## Turborepo Integration

This service is part of a Turborepo monorepo and can be run through:

**Make commands (from repository root):**
- `make ingestor-dev` - Start development server
- `make ingestor-build` - Build the service
- `make ingestor-start` - Start production server
- `make ingestor-test` - Run tests
- `make ingestor-format` - Format code
- `make ingestor-lint` - Lint code

**Turborepo commands (from repository root):**
```bash
turbo run dev --filter=@wallpaperdb/ingestor
turbo run build --filter=@wallpaperdb/ingestor
```

**All services commands:**
```bash
make dev      # Start all services
make build    # Build all services
make format   # Format all code
make lint     # Lint all code
```

## API Endpoints

### Health Check

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "healthy",
  "checks": {
    "database": true,
    "minio": true,
    "nats": true,
    "otel": true
  },
  "timestamp": "2025-11-02T17:16:00.725Z"
}
```

### Readiness Check

```bash
curl http://localhost:3001/ready
```

Response:
```json
{
  "ready": true,
  "timestamp": "2025-11-02T17:16:08.095Z"
}
```

## Project Structure

```
apps/ingestor/
├── src/
│   ├── config.ts              # Configuration loading with validation
│   ├── index.ts               # Main server entry point
│   └── connections/
│       ├── database.ts        # PostgreSQL connection
│       ├── minio.ts           # MinIO S3 client
│       ├── nats.ts            # NATS client
│       └── otel.ts            # OpenTelemetry setup
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

## Dependencies

### Core
- `fastify` - High-performance HTTP server
- `drizzle-orm` - Type-safe PostgreSQL ORM
- `@aws-sdk/client-s3` - MinIO/S3 client
- `nats` - NATS messaging client
- `@opentelemetry/*` - Observability instrumentation

### Validation & Utilities
- `zod` - Runtime type validation
- `dotenv` - Environment variable loading
- `sharp` - Image processing (for future use)
- `file-type` - MIME type detection (for future use)
- `ulid` - ID generation (for future use)

### Development
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution with hot-reload
- `vitest` - Testing framework (for future use)
- `pino-pretty` - Pretty logging in development

## Next Steps

Step 2 will implement the core upload functionality:
- File upload endpoint (`POST /upload`)
- File validation (format, size, dimensions)
- MinIO storage
- PostgreSQL metadata recording
- NATS event publishing
- Error handling with RFC 7807 Problem Details

See `plans/ingestor.md` for the full implementation plan.
