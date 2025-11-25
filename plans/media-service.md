# Media Service Plan

> **Status**: Ready to Start (after OpenAPI Integration)
> **Priority**: High (Service #2)
> **Prerequisites**: [OpenAPI Integration](./openapi-integration.md) - must be completed first
> **Last Updated**: 2025-11-23

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Specification](#api-specification)
5. [Phase 1: Scaffold + Health](#phase-1-scaffold--health)
6. [Phase 2: Event Consumer](#phase-2-event-consumer)
7. [Phase 3: Basic Retrieval](#phase-3-basic-retrieval)
8. [Phase 4: Variant Selection + Resizing](#phase-4-variant-selection--resizing)
9. [Implementation Guidance](#implementation-guidance)

---

## Overview

### Purpose

The Media Service retrieves and serves wallpapers in requested formats and sizes. It does NOT generate variants - that's handled by a separate Variant Generator service.

### Key Responsibilities

1. **Consume events** - Listen to `wallpaper.uploaded` from NATS, store metadata in own database
2. **Serve originals** - Return original wallpaper files from MinIO
3. **Serve resized** - Pick best variant, resize on-the-fly to requested dimensions
4. **Variant selection** - Choose the smallest variant that is ≥ requested size

### What This Service Does NOT Do

- Generate/cache resized variants (Variant Generator service)
- Store files in MinIO (Ingestor service)
- Authenticate users (public access)
- Modify wallpaper metadata

---

## Architecture

### Data Flow

```
┌─────────────┐     NATS Event      ┌───────────────┐
│  Ingestor   │ ─────────────────▶  │ Media Service │
│  Service    │  wallpaper.uploaded │               │
└─────────────┘                     └───────┬───────┘
      │                                     │
      │                                     │ Store metadata
      ▼                                     ▼
┌─────────────┐                     ┌───────────────┐
│   MinIO     │ ◀─── Read files ─── │  PostgreSQL   │
│  (shared)   │                     │  (own tables) │
└─────────────┘                     └───────────────┘
      │
      │ Stream file
      ▼
┌─────────────┐
│   Client    │
└─────────────┘
```

### Key Architectural Constraints

1. **Own Database** - Media Service has its own PostgreSQL tables. NO foreign keys or direct queries to Ingestor tables.

2. **Shared MinIO** - Read-only access to the shared MinIO bucket where wallpapers are stored.

3. **Event-Driven** - All wallpaper metadata comes from NATS events, not direct DB queries.

4. **Stateless Resizing** - No caching of resized images. Always resize on-the-fly from the best available variant.

---

## Database Schema

### Table: `wallpapers`

Stores wallpaper metadata received from events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `text` | PRIMARY KEY | Wallpaper ID (e.g., `wlpr_01ABC...`) |
| `storage_bucket` | `text` | NOT NULL | MinIO bucket name |
| `storage_key` | `text` | NOT NULL | Path to original file |
| `mime_type` | `text` | NOT NULL | MIME type (e.g., `image/jpeg`) |
| `width` | `integer` | NOT NULL | Original width in pixels |
| `height` | `integer` | NOT NULL | Original height in pixels |
| `file_size_bytes` | `bigint` | NOT NULL | File size |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW() | When record was created |

**Indexes:**
- Primary key on `id`

### Table: `variants`

Stores information about pre-generated size variants.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `text` | PRIMARY KEY | Variant ID (e.g., `var_01ABC...`) |
| `wallpaper_id` | `text` | NOT NULL, FK → wallpapers | Parent wallpaper |
| `storage_key` | `text` | NOT NULL | Path to variant file |
| `width` | `integer` | NOT NULL | Variant width |
| `height` | `integer` | NOT NULL | Variant height |
| `file_size_bytes` | `bigint` | NOT NULL | Variant file size |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW() | When variant was created |

**Indexes:**
- Primary key on `id`
- Index on `wallpaper_id`
- Index on `(wallpaper_id, width, height)` for variant selection queries

### Storage Key Patterns

```
Original:  wlpr_01ABC.../original.jpg
Variants:  wlpr_01ABC.../2160p.jpg
           wlpr_01ABC.../1440p.jpg
           wlpr_01ABC.../1080p.jpg
           wlpr_01ABC.../720p.jpg
```

---

## API Specification

### Endpoints Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness check |
| `GET` | `/wallpapers/:id` | Get wallpaper (original or resized) |

### `GET /health`

Returns service health status.

**Response 200:**
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy", "latencyMs": 2 },
    "minio": { "status": "healthy", "latencyMs": 5 },
    "nats": { "status": "healthy", "latencyMs": 1 }
  }
}
```

### `GET /ready`

Returns 200 if service is ready to handle requests, 503 otherwise.

**Response 200:** Empty body
**Response 503:** Empty body

### `GET /wallpapers/:id`

Retrieves a wallpaper, optionally resized.

**Path Parameters:**
- `id` (required) - Wallpaper ID (e.g., `wlpr_01ABC...`)

**Query Parameters:**
- `w` (optional) - Desired width in pixels
- `h` (optional) - Desired height in pixels
- `fit` (optional) - Resize fit mode: `contain` (default), `cover`, `fill`

**Resize Behavior:**
- If neither `w` nor `h` specified: Return original (or best variant for bandwidth)
- If only `w` specified: Resize to width, maintain aspect ratio
- If only `h` specified: Resize to height, maintain aspect ratio
- If both specified: Resize according to `fit` mode

**Response 200:**
- Content-Type: `image/jpeg`, `image/png`, `image/webp`, etc.
- Body: Binary image data (streamed)
- Headers:
  - `Content-Length`: File size in bytes
  - `Cache-Control`: `public, max-age=31536000, immutable`
  - `ETag`: Content hash for caching

**Response 404:**
```json
{
  "type": "https://wallpaperdb.dev/problems/not-found",
  "title": "Wallpaper Not Found",
  "status": 404,
  "detail": "No wallpaper found with ID 'wlpr_invalid'",
  "instance": "/wallpapers/wlpr_invalid"
}
```

**Response 400:**
```json
{
  "type": "https://wallpaperdb.dev/problems/invalid-dimensions",
  "title": "Invalid Dimensions",
  "status": 400,
  "detail": "Width must be between 1 and 7680 pixels",
  "instance": "/wallpapers/wlpr_01ABC?w=10000"
}
```

---

## Phase 1: Scaffold + Health

### Goal

Create the service skeleton with health and readiness endpoints.

### Test Specifications

#### Health Endpoint Tests

```gherkin
Feature: Health Check

  Scenario: Health check returns healthy when all dependencies are up
    Given the database is accessible
    And MinIO is accessible
    And NATS is accessible
    When I request GET /health
    Then the response status should be 200
    And the response body should have status "healthy"
    And the response body should have checks for "database", "minio", "nats"
    And all checks should have status "healthy"

  Scenario: Health check returns degraded when a dependency is slow
    Given the database is accessible but slow (>1000ms)
    When I request GET /health
    Then the response status should be 200
    And the response body should have status "degraded"
    And the database check should indicate high latency

  Scenario: Health check returns unhealthy when a dependency is down
    Given the database is not accessible
    When I request GET /health
    Then the response status should be 200
    And the response body should have status "unhealthy"
    And the database check should have status "unhealthy"
```

#### Readiness Endpoint Tests

```gherkin
Feature: Readiness Check

  Scenario: Ready when all dependencies are accessible
    Given the database is accessible
    And MinIO is accessible
    And NATS is accessible
    When I request GET /ready
    Then the response status should be 200

  Scenario: Not ready when database is not accessible
    Given the database is not accessible
    When I request GET /ready
    Then the response status should be 503
```

### Implementation Tasks

1. Create service directory structure:
   ```
   apps/media/
   ├── src/
   │   ├── index.ts
   │   ├── app.ts
   │   ├── config.ts
   │   ├── connections/
   │   ├── routes/
   │   └── services/
   ├── test/
   ├── package.json
   ├── tsconfig.json
   └── vitest.config.ts
   ```

2. Set up configuration using `@wallpaperdb/core/config`

3. Create connection managers for PostgreSQL, MinIO, NATS

4. Implement health check service using `@wallpaperdb/core/health`

5. Create health and ready routes

6. Add Makefile targets: `media-dev`, `media-test`, `media-build`

7. Create test builders for the Media Service

### Acceptance Criteria

- [x] Service starts and listens on configured port
- [x] `GET /health` returns health status with all dependency checks
- [x] `GET /ready` returns 200 when healthy, 503 when not
- [x] All health tests pass
- [x] OpenTelemetry instrumentation is active

---

## Phase 2: Event Consumer

### Goal

Consume `wallpaper.uploaded` events and store metadata in own database.

### Test Specifications

#### Event Consumer Tests

```gherkin
Feature: Wallpaper Uploaded Event Consumer

  Scenario: Successfully process wallpaper.uploaded event
    Given the media service is running
    And the database is empty
    When a wallpaper.uploaded event is published with:
      | id              | wlpr_01ABC123              |
      | storageBucket   | wallpapers                 |
      | storageKey      | wlpr_01ABC123/original.jpg |
      | mimeType        | image/jpeg                 |
      | width           | 3840                       |
      | height          | 2160                       |
      | fileSizeBytes   | 2500000                    |
    Then the wallpapers table should contain a record with id "wlpr_01ABC123"
    And the record should have storage_bucket "wallpapers"
    And the record should have width 3840
    And the record should have height 2160

  Scenario: Ignore duplicate events (idempotency)
    Given a wallpaper with id "wlpr_01ABC123" exists in the database
    When a wallpaper.uploaded event is published with id "wlpr_01ABC123"
    Then the wallpapers table should still contain exactly one record with id "wlpr_01ABC123"
    And no error should be thrown

  Scenario: Handle malformed events gracefully
    Given the media service is running
    When a malformed wallpaper.uploaded event is published (missing required fields)
    Then an error should be logged
    And the event should be acknowledged (not redelivered)
    And no record should be inserted

  Scenario: Maintain trace context from publisher
    Given the media service is running
    And OpenTelemetry tracing is enabled
    When a wallpaper.uploaded event with trace context is published
    Then the consumer should extract and continue the trace
    And spans should be linked to the original upload trace
```

#### Database Schema Tests

```gherkin
Feature: Database Schema

  Scenario: Wallpapers table exists with correct schema
    Given the database migrations have run
    Then the wallpapers table should exist
    And it should have columns: id, storage_bucket, storage_key, mime_type, width, height, file_size_bytes, created_at
    And the id column should be the primary key

  Scenario: Variants table exists with correct schema
    Given the database migrations have run
    Then the variants table should exist
    And it should have columns: id, wallpaper_id, storage_key, width, height, file_size_bytes, created_at
    And the id column should be the primary key
    And wallpaper_id should reference wallpapers(id)
```

### Implementation Tasks

1. Create Drizzle schema for `wallpapers` and `variants` tables

2. Create database migrations

3. Implement `WallpaperUploadedConsumer` extending `BaseEventConsumer`

4. Handle idempotency (upsert or ignore duplicates)

5. Add consumer startup to `app.ts`

6. Implement graceful shutdown (drain consumer)

### Acceptance Criteria

- [ ] Database schema created with migrations
- [ ] Consumer subscribes to `wallpaper.uploaded` stream
- [ ] Events are processed and stored in `wallpapers` table
- [ ] Duplicate events are handled idempotently
- [ ] Malformed events don't crash the service
- [ ] Trace context is propagated
- [ ] All consumer tests pass

---

## Phase 3: Basic Retrieval

### Goal

Serve original wallpaper files from MinIO.

### Test Specifications

#### Retrieval Tests

```gherkin
Feature: Wallpaper Retrieval

  Scenario: Retrieve existing wallpaper
    Given a wallpaper exists with id "wlpr_01ABC123"
    And the file exists in MinIO at "wlpr_01ABC123/original.jpg"
    When I request GET /wallpapers/wlpr_01ABC123
    Then the response status should be 200
    And the Content-Type header should be "image/jpeg"
    And the response body should be the binary image data
    And the Cache-Control header should indicate long-term caching

  Scenario: Wallpaper not found in database
    Given no wallpaper exists with id "wlpr_nonexistent"
    When I request GET /wallpapers/wlpr_nonexistent
    Then the response status should be 404
    And the response should be RFC 7807 problem details
    And the title should be "Wallpaper Not Found"

  Scenario: Wallpaper in database but file missing from MinIO
    Given a wallpaper exists with id "wlpr_01ABC123"
    But the file does NOT exist in MinIO
    When I request GET /wallpapers/wlpr_01ABC123
    Then the response status should be 404
    And the detail should indicate the file is missing

  Scenario: Response is streamed (not buffered)
    Given a large wallpaper exists (50MB)
    When I request GET /wallpapers/wlpr_large
    Then the response should be streamed
    And memory usage should not spike to 50MB

  Scenario: ETag header is set for caching
    Given a wallpaper exists with id "wlpr_01ABC123"
    When I request GET /wallpapers/wlpr_01ABC123
    Then the response should have an ETag header
    And subsequent requests with If-None-Match should return 304
```

#### Input Validation Tests

```gherkin
Feature: Input Validation

  Scenario: Invalid wallpaper ID format
    When I request GET /wallpapers/invalid-id
    Then the response status should be 400
    And the detail should indicate invalid ID format

  Scenario: SQL injection attempt in ID
    When I request GET /wallpapers/wlpr_'; DROP TABLE wallpapers; --
    Then the response status should be 400
    And no SQL should be executed
```

### Implementation Tasks

1. Create media routes plugin

2. Implement `MediaService` with `getWallpaper(id)` method

3. Query database for wallpaper metadata

4. Stream file from MinIO using `GetObjectCommand`

5. Set appropriate response headers (Content-Type, Cache-Control, ETag)

6. Implement input validation

7. Add RFC 7807 error responses

### Acceptance Criteria

- [ ] `GET /wallpapers/:id` returns original file
- [ ] Correct Content-Type based on stored mime_type
- [ ] 404 returned for non-existent wallpapers
- [ ] Response is streamed, not buffered
- [ ] Cache headers are set correctly
- [ ] Input validation prevents injection attacks
- [ ] All retrieval tests pass

---

## Phase 4: Variant Selection + Resizing

### Goal

Select the best available variant and resize to requested dimensions.

### Test Specifications

#### Variant Selection Tests

```gherkin
Feature: Variant Selection

  Scenario: Select exact match variant
    Given a wallpaper "wlpr_01ABC123" with original size 3840x2160
    And variants exist: 2560x1440, 1920x1080, 1280x720
    When I request GET /wallpapers/wlpr_01ABC123?w=1920&h=1080
    Then the service should select the 1920x1080 variant
    And return it without resizing

  Scenario: Select next larger variant when exact match unavailable
    Given a wallpaper "wlpr_01ABC123" with original size 3840x2160
    And variants exist: 2560x1440, 1920x1080, 1280x720
    When I request GET /wallpapers/wlpr_01ABC123?w=1600&h=900
    Then the service should select the 1920x1080 variant (smallest >= requested)
    And resize it to 1600x900

  Scenario: Fall back to original when no suitable variant
    Given a wallpaper "wlpr_01ABC123" with original size 3840x2160
    And variants exist: 1920x1080, 1280x720
    When I request GET /wallpapers/wlpr_01ABC123?w=2560&h=1440
    Then the service should select the original (3840x2160)
    And resize it to 2560x1440

  Scenario: Fall back to original when no variants exist
    Given a wallpaper "wlpr_01ABC123" with original size 3840x2160
    And no variants exist
    When I request GET /wallpapers/wlpr_01ABC123?w=1920&h=1080
    Then the service should select the original
    And resize it to 1920x1080

  Scenario: Return original when requested size larger than original
    Given a wallpaper "wlpr_01ABC123" with original size 1920x1080
    When I request GET /wallpapers/wlpr_01ABC123?w=3840&h=2160
    Then the service should return the original without upscaling
    And the response dimensions should be 1920x1080
```

#### Resize Tests

```gherkin
Feature: Image Resizing

  Scenario: Resize with width only (maintain aspect ratio)
    Given a wallpaper with original size 3840x2160 (16:9)
    When I request GET /wallpapers/wlpr_01ABC123?w=1920
    Then the response should be 1920x1080 (aspect ratio preserved)

  Scenario: Resize with height only (maintain aspect ratio)
    Given a wallpaper with original size 3840x2160 (16:9)
    When I request GET /wallpapers/wlpr_01ABC123?h=1080
    Then the response should be 1920x1080 (aspect ratio preserved)

  Scenario: Resize with fit=contain (default)
    Given a wallpaper with original size 3840x2160 (16:9)
    When I request GET /wallpapers/wlpr_01ABC123?w=1000&h=1000&fit=contain
    Then the response should fit within 1000x1000
    And aspect ratio should be preserved (e.g., 1000x562)

  Scenario: Resize with fit=cover
    Given a wallpaper with original size 3840x2160 (16:9)
    When I request GET /wallpapers/wlpr_01ABC123?w=1000&h=1000&fit=cover
    Then the response should be exactly 1000x1000
    And the image should be cropped to fill

  Scenario: Resize with fit=fill
    Given a wallpaper with original size 3840x2160 (16:9)
    When I request GET /wallpapers/wlpr_01ABC123?w=1000&h=1000&fit=fill
    Then the response should be exactly 1000x1000
    And the image should be stretched (aspect ratio not preserved)

  Scenario: Invalid resize dimensions
    When I request GET /wallpapers/wlpr_01ABC123?w=0
    Then the response status should be 400
    And the detail should indicate invalid dimensions

  Scenario: Resize dimensions exceed maximum
    When I request GET /wallpapers/wlpr_01ABC123?w=10000
    Then the response status should be 400
    And the detail should indicate dimensions exceed maximum (7680)
```

#### Performance Tests

```gherkin
Feature: Resize Performance

  Scenario: Resize completes within acceptable time
    Given a wallpaper with original size 3840x2160
    When I request a resize to 1920x1080
    Then the response should complete within 2 seconds

  Scenario: Memory usage stays bounded during resize
    Given a large wallpaper (8K resolution)
    When I request a resize to 1920x1080
    Then peak memory usage should not exceed 500MB
```

### Implementation Tasks

1. Implement `VariantSelector` service
   - Query variants for wallpaper
   - Sort by dimensions
   - Select smallest variant >= requested size
   - Fall back to original if none suitable

2. Implement `ResizeService` using Sharp
   - Support width-only, height-only, and both
   - Support fit modes: contain, cover, fill
   - Stream output (don't buffer full image)

3. Update `MediaService` to use variant selection and resizing

4. Add dimension validation (min: 1, max: 7680)

5. Set correct Content-Type for resized images

6. Add telemetry for resize operations (duration, source variant, output size)

### Acceptance Criteria

- [ ] Variant selection picks optimal source
- [ ] Falls back to original when no variants exist
- [ ] Resize with width only preserves aspect ratio
- [ ] Resize with height only preserves aspect ratio
- [ ] fit=contain works correctly
- [ ] fit=cover works correctly
- [ ] fit=fill works correctly
- [ ] Invalid dimensions return 400
- [ ] No upscaling (returns original if requested > original)
- [ ] Response is streamed
- [ ] All resize tests pass

---

## Implementation Guidance

### Shared Packages to Use

```typescript
// Configuration
import {
  ServerConfigSchema,
  DatabaseConfigSchema,
  S3ConfigSchema,
  NatsConfigSchema,
  OtelConfigSchema
} from '@wallpaperdb/core/config';

// Telemetry
import { withSpan, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Attributes } from '@wallpaperdb/core/telemetry/attributes';

// Health
import { HealthAggregator } from '@wallpaperdb/core/health';

// Events
import { BaseEventConsumer } from '@wallpaperdb/events';
import { WallpaperUploadedEventSchema, WALLPAPER_UPLOADED_SUBJECT } from '@wallpaperdb/events';

// Testing
import { createTesterBuilder, DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder } from '@wallpaperdb/test-utils';
```

### Test Builder Setup

Create custom builders in `apps/media/test/builders/`:

1. `MediaMigrationsTesterBuilder` - Runs Drizzle migrations
2. `InProcessMediaTesterBuilder` - Starts app in-process for integration tests

### Telemetry Spans to Add

- `media.get_wallpaper` - Overall request handling
- `media.select_variant` - Variant selection logic
- `media.fetch_from_minio` - MinIO GetObject
- `media.resize` - Sharp resize operation
- `media.stream_response` - Response streaming

### Configuration Example

```typescript
const ConfigSchema = z.object({
  // Server
  port: z.number().default(3001),
  host: z.string().default('0.0.0.0'),

  // Database
  databaseUrl: z.string(),

  // MinIO
  minioEndpoint: z.string(),
  minioAccessKey: z.string(),
  minioSecretKey: z.string(),
  minioBucket: z.string().default('wallpapers'),

  // NATS
  natsUrl: z.string(),

  // Resize limits
  maxResizeWidth: z.number().default(7680),
  maxResizeHeight: z.number().default(4320),

  // OTEL
  otelEnabled: z.boolean().default(true),
  otelEndpoint: z.string().optional(),
});
```

### Makefile Targets to Add

```makefile
# Media service
media-dev:
	@turbo run dev --filter=@wallpaperdb/media

media-build:
	@turbo run build --filter=@wallpaperdb/media

media-test:
	@turbo run test --filter=@wallpaperdb/media

media-test-watch:
	@turbo run test:watch --filter=@wallpaperdb/media
```

---

## Dependencies

### Runtime

```json
{
  "@aws-sdk/client-s3": "^3.x",
  "@fastify/cors": "^10.x",
  "drizzle-orm": "^0.38.x",
  "fastify": "^5.x",
  "fastify-plugin": "^5.x",
  "nats": "^2.x",
  "pg": "^8.x",
  "sharp": "^0.33.x",
  "tsyringe": "^4.x",
  "zod": "^3.x",
  "@wallpaperdb/core": "workspace:*",
  "@wallpaperdb/events": "workspace:*"
}
```

### Dev

```json
{
  "@wallpaperdb/test-utils": "workspace:*",
  "@wallpaperdb/testcontainers": "workspace:*",
  "vitest": "^2.x",
  "testcontainers": "^11.x",
  "drizzle-kit": "^0.30.x"
}
```

---

## Success Criteria (Overall)

- [ ] All four phases completed
- [ ] All test specifications have passing tests
- [ ] Service integrates with existing infrastructure
- [ ] OpenTelemetry traces visible in Grafana
- [ ] Documentation updated (CLAUDE.md, services.md)
- [ ] Makefile targets added
- [ ] CI/CD updated to include media service
