# OpenAPI Integration Plan

> **Status**: 🔴 Ready to Start (NEXT STEP)
> **Priority**: High (prerequisite for Media Service)
> **Last Updated**: 2025-11-23

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Phase 1: Core OpenAPI Module](#phase-1-core-openapi-module)
4. [Phase 2: Ingestor Integration](#phase-2-ingestor-integration)
5. [Phase 3: Swagger UI](#phase-3-swagger-ui)
6. [Implementation Guidance](#implementation-guidance)

---

## Overview

### Purpose

Add OpenAPI support to WallpaperDB services in a **reusable way** via `@wallpaperdb/core`. This enables:
- API documentation (Swagger UI)
- Request/response validation
- Type generation from schemas
- Contract-first development for new services

### Key Design Decisions

1. **Reusable in @wallpaperdb/core** - Shared OpenAPI utilities, not per-service duplication
2. **Code-first with Fastify** - Use `@fastify/swagger` to generate OpenAPI from Zod schemas
3. **TDD approach** - Write tests first, then implement
4. **Zod → JSON Schema** - Leverage existing Zod schemas, convert to JSON Schema for OpenAPI

### Why Code-First (not Spec-First)

- We already have Zod schemas for validation
- Single source of truth (code defines both validation AND docs)
- No manual sync between spec and implementation
- Fastify's type provider gives us type-safe routes

---

## Architecture

### Package Structure

```
packages/core/src/
├── openapi/
│   ├── index.ts                 # Public exports
│   ├── plugin.ts                # Fastify plugin that registers swagger
│   ├── schemas/                 # Shared OpenAPI schemas
│   │   ├── health.schema.ts     # Health/ready response schemas
│   │   ├── problem-details.schema.ts  # RFC 7807 error schema
│   │   └── common.schema.ts     # Pagination, etc.
│   └── utils/
│       └── zod-to-json-schema.ts  # Helper to convert Zod → JSON Schema
```

### How Services Use It

```typescript
// apps/ingestor/src/app.ts
import { registerOpenAPI } from '@wallpaperdb/core/openapi';

const app = fastify();

await registerOpenAPI(app, {
  title: 'WallpaperDB Ingestor API',
  version: '1.0.0',
  description: 'Wallpaper upload and ingestion service',
});

// Routes define their own schemas, swagger picks them up automatically
```

---

## Phase 1: Core OpenAPI Module

### Goal

Create reusable OpenAPI support in `@wallpaperdb/core`.

### Test Specifications

```gherkin
Feature: OpenAPI Plugin Registration

  Scenario: Register OpenAPI plugin with Fastify
    Given a Fastify application
    When I register the OpenAPI plugin with title "Test API" and version "1.0.0"
    Then the plugin should register successfully
    And GET /documentation/json should return a valid OpenAPI 3.0 spec
    And the spec should have title "Test API"
    And the spec should have version "1.0.0"

  Scenario: OpenAPI spec includes registered routes
    Given a Fastify application with OpenAPI plugin
    And a route GET /test with a JSON schema response
    When I request GET /documentation/json
    Then the spec should include path "/test"
    And the path should have the response schema

  Scenario: Swagger UI is served
    Given a Fastify application with OpenAPI plugin
    When I request GET /documentation
    Then the response should be HTML
    And it should contain Swagger UI
```

```gherkin
Feature: Shared OpenAPI Schemas

  Scenario: Health response schema is valid JSON Schema
    Given the HealthResponseSchema from @wallpaperdb/core/openapi
    When I convert it to JSON Schema
    Then it should be a valid JSON Schema
    And it should define "status" as enum ["healthy", "degraded", "unhealthy"]
    And it should define "checks" as an object

  Scenario: Problem Details schema matches RFC 7807
    Given the ProblemDetailsSchema from @wallpaperdb/core/openapi
    When I convert it to JSON Schema
    Then it should define "type" as string (URI)
    And it should define "title" as string
    And it should define "status" as integer
    And it should define "detail" as string
    And it should define "instance" as string
```

```gherkin
Feature: Zod to JSON Schema Conversion

  Scenario: Convert simple Zod schema to JSON Schema
    Given a Zod schema: z.object({ name: z.string(), age: z.number() })
    When I convert it using zodToJsonSchema
    Then the result should be a valid JSON Schema
    And it should have type "object"
    And it should have properties "name" (string) and "age" (number)

  Scenario: Convert Zod enum to JSON Schema
    Given a Zod schema: z.enum(["a", "b", "c"])
    When I convert it using zodToJsonSchema
    Then the result should have enum ["a", "b", "c"]
```

### Implementation Tasks

1. Add dependencies to `@wallpaperdb/core`:
   - `@fastify/swagger`
   - `@fastify/swagger-ui`
   - `zod-to-json-schema`

2. Create `packages/core/src/openapi/plugin.ts`:
   - `registerOpenAPI(app, options)` function
   - Configure swagger with sensible defaults
   - Register swagger-ui at `/documentation`

3. Create shared schemas in `packages/core/src/openapi/schemas/`:
   - `HealthResponseSchema` (Zod + JSON Schema)
   - `ProblemDetailsSchema` (RFC 7807)
   - Export as both Zod and JSON Schema

4. Create `zodToJsonSchema` utility wrapper

5. Export from `packages/core/src/openapi/index.ts`

6. Add tests for all components

### Acceptance Criteria

- [ ] `registerOpenAPI` function exists and works
- [ ] Swagger UI served at `/documentation`
- [ ] OpenAPI JSON spec at `/documentation/json`
- [ ] Shared schemas available (Health, ProblemDetails)
- [ ] Zod → JSON Schema conversion works
- [ ] All tests pass

---

## Phase 2: Ingestor Integration

### Goal

Add OpenAPI documentation to the existing Ingestor service.

### Test Specifications

```gherkin
Feature: Ingestor OpenAPI Documentation

  Scenario: OpenAPI spec is available
    Given the ingestor service is running
    When I request GET /documentation/json
    Then the response status should be 200
    And the response should be valid OpenAPI 3.0
    And the info.title should be "WallpaperDB Ingestor API"

  Scenario: Upload endpoint is documented
    Given the ingestor OpenAPI spec
    Then it should include POST /upload
    And the request body should be multipart/form-data
    And it should document the file field
    And it should document the x-user-id header
    And it should document 201 response (success)
    And it should document 400 response (validation error)
    And it should document 409 response (duplicate)
    And it should document 429 response (rate limit)

  Scenario: Health endpoint is documented
    Given the ingestor OpenAPI spec
    Then it should include GET /health
    And the response should reference HealthResponse schema

  Scenario: Ready endpoint is documented
    Given the ingestor OpenAPI spec
    Then it should include GET /ready
    And it should document 200 response (ready)
    And it should document 503 response (not ready)

  Scenario: Error responses use Problem Details
    Given the ingestor OpenAPI spec
    Then all error responses (4xx, 5xx) should use application/problem+json
    And they should reference ProblemDetails schema
```

```gherkin
Feature: Swagger UI Access

  Scenario: Swagger UI is accessible
    Given the ingestor service is running
    When I request GET /documentation
    Then the response should be HTML containing Swagger UI
    And I should be able to see all endpoints
    And I should be able to try out the API (interactive)
```

### Implementation Tasks

1. Register OpenAPI plugin in `apps/ingestor/src/app.ts`

2. Add JSON schemas to existing routes:
   - `POST /upload` - request body, headers, responses
   - `GET /health` - response schema
   - `GET /ready` - response codes

3. Update route handlers to use Fastify's schema validation

4. Ensure all error responses are documented

5. Test Swagger UI manually

6. Add integration tests for OpenAPI spec

### Ingestor Route Schemas

#### POST /upload

```typescript
const uploadSchema = {
  summary: 'Upload a wallpaper',
  description: 'Upload an image or video file to be processed as a wallpaper',
  tags: ['Upload'],
  consumes: ['multipart/form-data'],
  headers: z.object({
    'x-user-id': z.string().describe('User ID performing the upload'),
  }),
  response: {
    201: UploadSuccessResponseSchema,
    400: ProblemDetailsSchema,  // Validation error
    409: ProblemDetailsSchema,  // Duplicate
    413: ProblemDetailsSchema,  // File too large
    429: ProblemDetailsSchema,  // Rate limited
  },
};
```

#### GET /health

```typescript
const healthSchema = {
  summary: 'Health check',
  description: 'Returns health status of the service and its dependencies',
  tags: ['Health'],
  response: {
    200: HealthResponseSchema,
  },
};
```

#### GET /ready

```typescript
const readySchema = {
  summary: 'Readiness check',
  description: 'Returns 200 if service is ready to handle requests',
  tags: ['Health'],
  response: {
    200: z.null().describe('Service is ready'),
    503: z.null().describe('Service is not ready'),
  },
};
```

### Acceptance Criteria

- [ ] OpenAPI plugin registered in ingestor
- [ ] All routes have JSON schemas
- [ ] Swagger UI accessible at `/documentation`
- [ ] OpenAPI spec includes all endpoints with full documentation
- [ ] Error responses documented with Problem Details
- [ ] All tests pass

---

## Phase 3: Swagger UI (Optional Enhancements)

### Goal

Improve Swagger UI experience with customization.

### Test Specifications

```gherkin
Feature: Swagger UI Customization

  Scenario: Custom branding
    Given the Swagger UI is loaded
    Then the title should show "WallpaperDB"
    And it should use custom colors (optional)

  Scenario: Try it out works for upload
    Given the Swagger UI is loaded
    When I use "Try it out" on POST /upload
    And I select a file and enter a user ID
    And I click Execute
    Then I should see the response from the server
```

### Implementation Tasks

1. Configure Swagger UI theme/branding (optional)
2. Ensure "Try it out" works for all endpoints
3. Add example values to schemas

### Acceptance Criteria

- [ ] Swagger UI has proper branding
- [ ] "Try it out" works for all endpoints
- [ ] Examples are shown in the UI

---

## Implementation Guidance

### Dependencies to Add

**@wallpaperdb/core/package.json:**
```json
{
  "dependencies": {
    "@fastify/swagger": "^9.0.0",
    "@fastify/swagger-ui": "^5.0.0",
    "zod-to-json-schema": "^3.23.0"
  }
}
```

### Plugin Implementation Pattern

```typescript
// packages/core/src/openapi/plugin.ts
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export interface OpenAPIOptions {
  title: string;
  version: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
}

export async function registerOpenAPI(
  app: FastifyInstance,
  options: OpenAPIOptions
): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: options.title,
        version: options.version,
        description: options.description,
      },
      servers: options.servers,
      components: {
        schemas: {
          // Register shared schemas here
          ProblemDetails: ProblemDetailsJsonSchema,
          HealthResponse: HealthResponseJsonSchema,
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}
```

### Route Schema Pattern

```typescript
// apps/ingestor/src/routes/health.routes.ts
import { HealthResponseSchema } from '@wallpaperdb/core/openapi';
import { zodToJsonSchema } from '@wallpaperdb/core/openapi';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', {
    schema: {
      summary: 'Health check',
      tags: ['Health'],
      response: {
        200: zodToJsonSchema(HealthResponseSchema),
      },
    },
  }, async (request, reply) => {
    // ... handler
  });
}
```

### Makefile Targets to Add

```makefile
# OpenAPI
openapi-lint:
	@echo "Linting OpenAPI specs..."
	# Add spectral if using spec files

# Verify OpenAPI spec is generated correctly
openapi-verify:
	@turbo run openapi:verify
```

---

## Success Criteria (Overall)

- [ ] `@wallpaperdb/core/openapi` module exists with reusable utilities
- [ ] Ingestor service has full OpenAPI documentation
- [ ] Swagger UI accessible and functional
- [ ] All endpoints documented with schemas
- [ ] Error responses use RFC 7807 Problem Details
- [ ] Pattern is easily reusable for Media Service
- [ ] All tests pass (TDD approach followed)

---

## Notes

### Future Services

Once this is done, adding OpenAPI to new services (like Media) is simple:

```typescript
import { registerOpenAPI } from '@wallpaperdb/core/openapi';

await registerOpenAPI(app, {
  title: 'WallpaperDB Media API',
  version: '1.0.0',
});
```

### Spec Export (Optional)

If you need static OpenAPI YAML files (for external tools):

```bash
# After service starts, export the spec
curl http://localhost:3000/documentation/json > openapi.json
```
