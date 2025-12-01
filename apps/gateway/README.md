# Gateway Service

Read-optimized GraphQL gateway for querying wallpapers. Provides flexible filtering capabilities powered by OpenSearch.

## Status

🚧 **MVP in Development** - Basic scaffolding complete

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
# - Health: http://localhost:3004/health
# - Ready: http://localhost:3004/ready
# - GraphQL API: http://localhost:3004/graphql
# - GraphiQL IDE: http://localhost:3004/graphiql
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

## MVP Scope

The initial MVP focuses on:

1. ✅ **Basic Infrastructure**: Fastify server with Mercurius GraphQL plugin
2. ✅ **Health Checks**: `/health` and `/ready` endpoints
3. ✅ **OpenSearch Connection**: Client setup and connection management
4. 📋 **GraphQL Schema**: Wallpaper and Variant types (TODO)
5. 📋 **Search Query**: Filter wallpapers by variant properties (TODO)
6. 📋 **NATS Consumer**: Consume `wallpaper.variant.available` events (TODO)
7. 📋 **Index Management**: Create and update OpenSearch documents (TODO)

See [plans/gateway-service.md](/plans/gateway-service.md) for the full implementation plan.

## Environment Variables

```bash
# Server
PORT=3003
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

### Data Flow (Planned)

```
Media Service → NATS Event → Gateway Consumer → OpenSearch → GraphQL API → Client
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
