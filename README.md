# WallpaperDB

A microservices-based wallpaper management system for uploading, processing, and serving wallpapers with intelligent enrichment.

## Quick Start

```bash
make infra-start    # Start infrastructure (PostgreSQL, MinIO, NATS, Redis, Grafana)
make dev            # Start all services in development mode
```

First-time setup takes ~2 minutes for infrastructure to initialize.

## Current Status

**Active Development** - Currently implementing the Ingestor service (wallpaper upload and validation). Additional microservices (media delivery, thumbnail extraction, enrichment services) are planned.

## Architecture

**Current:**
- **Ingestor Service** - Handles wallpaper uploads, validation, storage (MinIO), metadata persistence (PostgreSQL), and event publishing (NATS)

**Planned Services:** Media delivery, thumbnail extraction, quality enrichment, color enrichment, tagging, GraphQL gateway

See `plans/services.md` for the full architecture plan.

## Technology Stack

- **Monorepo:** Turborepo with pnpm workspaces
- **HTTP:** Fastify with TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **Storage:** MinIO (S3-compatible)
- **Messaging:** NATS with JetStream
- **Cache/Rate Limiting:** Redis
- **Testing:** Vitest with Testcontainers
- **Observability:** OpenTelemetry + Grafana LGTM stack

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Comprehensive project guide (architecture, commands, workflows)
- **[docs/testing/](docs/testing/)** - Testing infrastructure and patterns
- **[Makefile](Makefile)** - All available commands (`make help`)

## Key Commands

```bash
# Infrastructure
make infra-start       # Start infrastructure
make infra-stop        # Stop infrastructure
make infra-reset       # Reset all data (destructive)

# Development
make dev               # Start all services
make test              # Run all tests
make format            # Format all code
make lint              # Lint all code

# Single Service (Ingestor)
make ingestor-dev      # Start only ingestor service
make ingestor-test     # Run only ingestor tests

# View all commands
make help
```

## Repository Structure

```
apps/
  ingestor/          # Wallpaper ingestion service
  ingestor-e2e/      # E2E tests for ingestor
packages/
  testcontainers/    # Shared test utilities
  test-utils/        # Test builder pattern utilities
infra/               # Local infrastructure (Docker Compose)
plans/               # Architecture plans and design docs
```

## Development Workflow

1. Start infrastructure: `make infra-start`
2. Start services: `make dev`
3. Make changes
4. Run tests: `make test`
5. Format & lint: `make format && make lint`

See [CLAUDE.md](CLAUDE.md) for detailed workflows, architecture explanations, and troubleshooting.
