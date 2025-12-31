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

**Production Services (5):**
- ✅ **Ingestor** (Port 3001) - Upload and validation
- ✅ **Media** (Port 3002) - Retrieval and on-demand resizing
- ✅ **Variant Generator** (Port 3004) - Pre-generates common resolutions
- ✅ **Gateway** (Port 3000) - GraphQL API with OpenSearch
- ✅ **Web Frontend** (Port 3005) - React UI for browsing and upload

**Planned Services:**
- 📋 Thumbnail Extractor - Video thumbnail generation
- 📋 Quality Enrichment - Image quality analysis
- 📋 Color Enrichment - Color extraction and palette generation
- 📋 Tagging Service - Tag management

**Shared Packages:**
- `@wallpaperdb/core` - Infrastructure patterns (connections, config, errors, telemetry, health, OpenAPI)
- `@wallpaperdb/events` - Event schemas, publishers, consumers
- `@wallpaperdb/test-utils` - TesterBuilder framework
- `@wallpaperdb/testcontainers` - Custom container implementations
- `@wallpaperdb/url-ipv4-resolver` - URL validation and SSRF prevention
- `@wallpaperdb/react-muuri` - React wrapper for Muuri grid layout

## Architecture

**Event-driven microservices architecture:**
- 5 production services with event-driven communication via NATS
- Each service has its own database (PostgreSQL)
- Shared packages enable rapid development (~1 week per service)
- Comprehensive testing with TesterBuilder pattern (integration + E2E)
- Production observability with OpenTelemetry + Grafana

**Service Flow:**
```
Upload → Ingestor → NATS → Media, Variant Generator, Gateway
                          ↓
                    Web Frontend ← Gateway (GraphQL + OpenSearch)
```

See [Architecture Documentation](apps/docs/content/docs/architecture) (run `make docs-dev` to view the rendered site) for complete details.

## Technology Stack

- **Monorepo:** Turborepo with pnpm workspaces
- **HTTP:** Fastify with TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **Storage:** MinIO (S3-compatible)
- **Messaging:** NATS with JetStream
- **Cache/Rate Limiting:** Redis
- **Search:** OpenSearch
- **Testing:** Vitest with Testcontainers
- **Observability:** OpenTelemetry + Grafana LGTM stack
- **Frontend:** React + Vite + Muuri

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

# Single Service (example: Ingestor)
make ingestor-dev      # Start only ingestor service
make ingestor-test     # Run only ingestor tests
# Similar commands exist for: media, variant-generator, gateway, web

# View all commands
make help
```

## Repository Structure

```
apps/
  ingestor/          # Wallpaper upload and validation service (production)
  media/             # Wallpaper retrieval and resizing service (production)
  variant-generator/ # Pre-generates common resolution variants (production)
  gateway/           # GraphQL API with OpenSearch (production)
  web/               # React frontend (production)
  ingestor-e2e/      # E2E tests for ingestor
  docs/              # Fumadocs documentation site
packages/
  core/              # Infrastructure patterns (connections, config, errors, telemetry)
  events/            # Event schemas, publishers, consumers
  test-utils/        # TesterBuilder framework
  testcontainers/    # Custom container implementations
  url-ipv4-resolver/ # URL validation and SSRF prevention
  react-muuri/       # React wrapper for Muuri grid layout
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
