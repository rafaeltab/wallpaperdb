[![codecov](https://codecov.io/github/rafaeltab/wallpaperdb/graph/badge.svg?token=E7C2BEISZR)](https://codecov.io/github/rafaeltab/wallpaperdb)

# WallpaperDB

A microservices-based wallpaper management system for uploading, processing, and serving wallpapers with intelligent enrichment.

## Quick Start

```bash
make infra-start    # Start infrastructure (PostgreSQL, MinIO, NATS, Redis, Grafana)
make dev            # Start all services in development mode
```

First-time setup takes ~2 minutes for infrastructure to initialize.

## Current Status

**Services:**
- ✅ **Ingestor** - Production-ready upload and validation service
- 🚧 **Media** - In progress - wallpaper retrieval and resizing
- 📋 **Planned** - Thumbnail Extractor, Quality Enrichment, Color Enrichment, Tagging, Gateway

**Shared Packages:**
- `@wallpaperdb/core` - Infrastructure patterns (connections, config, errors, telemetry, health, OpenAPI)
- `@wallpaperdb/events` - Event schemas, publishers, consumers
- `@wallpaperdb/test-utils` - TesterBuilder framework
- `@wallpaperdb/testcontainers` - Custom container implementations
- `@wallpaperdb/url-ipv4-resolver` - URL validation and SSRF prevention

## Architecture

**Event-driven microservices architecture:**
- Each service has its own database
- NATS for inter-service communication
- Shared packages for rapid service development (~1 week per service)
- Comprehensive testing with TesterBuilder pattern

See [Architecture Documentation](apps/docs/content/docs/architecture) (run `make docs-dev` to view the rendered site) for complete details.

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

**Primary Documentation:** [apps/docs/content/docs](apps/docs/content/docs) - Run `make docs-dev` to start the documentation server at http://localhost:3002.

**Key Resources:**
- **[Documentation](apps/docs/content/docs)** - Complete documentation (guides, architecture, packages, services, infrastructure)
- **[CLAUDE.md](CLAUDE.md)** - Quick reference for AI agents (commands, workflows, key decisions)
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
  ingestor/          # Wallpaper upload and validation service (production-ready)
  media/             # Wallpaper retrieval and resizing service (in progress)
  ingestor-e2e/      # E2E tests for ingestor
  docs/              # Fumadocs documentation site
packages/
  core/              # Infrastructure patterns (connections, config, errors, telemetry)
  events/            # Event schemas, publishers, consumers
  test-utils/        # TesterBuilder framework
  testcontainers/    # Custom container implementations
  url-ipv4-resolver/ # URL validation and SSRF prevention
infra/               # Local infrastructure (Docker Compose)
plans/               # Architecture plans and design docs
```

## Development Workflow

1. Start infrastructure: `make infra-start`
2. Start services: `make dev`
3. Start documentation: `make docs-dev` (opens http://localhost:3002)
4. Make changes
5. Run tests: `make test`
6. Format & lint: `make format && make lint`

See [Getting Started](apps/docs/content/docs/getting-started.mdx) for detailed setup and [Development Guidelines](apps/docs/content/docs/development-guidelines.mdx) for TDD workflow. Run `make docs-dev` to view the rendered documentation site.

## Coverage



![codecov](https://codecov.io/github/rafaeltab/wallpaperdb/graphs/tree.svg?token=E7C2BEISZR)
