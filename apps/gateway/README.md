# Gateway Service

Read-optimized GraphQL gateway for querying wallpapers. Provides flexible filtering capabilities powered by OpenSearch.

## Status

✅ **Production-ready** - Core functionality complete

## Technology Stack

- **Framework**: Fastify with Mercurius (GraphQL)
- **Data Store**: OpenSearch
- **Dependency Injection**: TSyringe
- **Testing**: Vitest with Testcontainers

## Quick Start

```bash
# Start infrastructure (required)
make infra-start

# Start gateway in development mode
make gateway-dev

# The server will be available at:
# - Health: http://localhost:3000/health
# - Ready: http://localhost:3000/ready
# - GraphQL API: http://localhost:3000/graphql
# - GraphiQL IDE: http://localhost:3000/graphiql
```

## Available Commands

```bash
make gateway-dev          # Start in development mode with hot-reload
make gateway-build        # Build for production
make gateway-start        # Run production build
make gateway-test         # Run tests
make gateway-test-watch   # Run tests in watch mode
make gateway-format       # Format code with Biome
make gateway-lint         # Lint code with Biome
make gateway-check        # Run Biome check (format + lint)
```

## Features

Core functionality implemented:

1. ✅ **GraphQL API**: Full GraphQL schema with queries
2. ✅ **Health Checks**: `/health` and `/ready` endpoints with dependency checking
3. ✅ **OpenSearch Integration**: Full-text search and filtering
4. ✅ **GraphQL Schema**: Wallpaper, Variant, and connection types
5. ✅ **Search Query**: Filter wallpapers by variant properties (width, height, aspect ratio, format)
6. ✅ **NATS Consumers**: Consumes `wallpaper.uploaded` and `wallpaper.variant.available` events
7. ✅ **Index Management**: Creates and updates OpenSearch documents
8. ✅ **Cursor-based Pagination**: Efficient pagination for large datasets

See [Service: Gateway](/docs/services/gateway) documentation for complete details.

## Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development

# OpenSearch
OPENSEARCH_URL=http://localhost:9200
OPENSEARCH_INDEX=wallpapers

# NATS
NATS_URL=nats://localhost:4222
NATS_STREAM=WALLPAPER

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=gateway
```

## Architecture

The gateway is designed as a read-optimized service that:

1. **Consumes Events**: Listens to `wallpaper.variant.available` events from NATS
2. **Builds Read Model**: Updates OpenSearch index with wallpaper metadata
3. **Serves Queries**: Exposes GraphQL API for flexible querying

### Data Flow

```
Ingestor → NATS (wallpaper.uploaded) → Gateway → OpenSearch
Media → NATS (wallpaper.variant.available) → Gateway → OpenSearch
Client → GraphQL API → Gateway → OpenSearch → Response
```

## Future Enhancements

After the MVP, the gateway will be extended with:

- Color-based filtering and vector search
- Tag filtering and search
- Text search across metadata
- Advanced pagination with cursor-based navigation
- User authentication and personalization
- GraphQL mutations for user actions

## Development Guidelines

This service follows the WallpaperDB development principles:

1. **TDD**: Write tests before implementation
2. **Incremental Changes**: Small, focused commits
3. **Document As You Go**: Update docs with changes
4. See [Development Guidelines](/apps/docs/content/docs/development-guidelines.mdx) for details

## Testing

The gateway uses a multi-tier testing strategy:

- **Unit Tests**: Fast tests for pure logic (no containers)
- **Integration Tests**: Tests with OpenSearch and NATS via Testcontainers
- **E2E Tests**: Full system tests (future)

See [Testing Strategies](/apps/docs/content/docs/guides/testing-strategies.mdx) for details.
