# Phase 4: Variant Selection + Resizing - TDD Implementation Plan

**Service:** Media Service
**Phase:** 4 of 4
**Status:** Ready for Implementation
**Approach:** Test-Driven Development (Integration Tests)

---

## Overview

This plan implements on-the-fly image resizing and intelligent variant selection for the Media Service. The implementation follows strict TDD principles with integration tests driving development, following established patterns from the ingestor service.

**Key Features:**
- Query parameter support (`w`, `h`, `fit`)
- Intelligent variant selection (choose smallest variant ≥ requested size)
- On-the-fly resizing using Sharp (streaming, no buffering)
- No upscaling (return original if requested > actual dimensions)
- Support for fit modes: contain (default), cover, fill
- Dimension validation (1-7680 width, 1-4320 height)

---

## Architecture Design

### New Components

#### 1. VariantRepository
**File:** `apps/media/src/repositories/variant.repository.ts`

**Responsibilities:**
- Query variants table with optimized selection
- `findByWallpaperId(wallpaperId: string)` - Get all variants for a wallpaper
- `findSmallestSuitable(wallpaperId, minWidth, minHeight)` - Get optimal variant

**Database Query Pattern:**
```sql
SELECT * FROM variants
WHERE wallpaper_id = $1
  AND width >= $2
  AND height >= $3
ORDER BY (width * height) ASC
LIMIT 1
```

**Database Index:** Add composite index on `(wallpaper_id, width, height)` for optimal query performance.

**Migration Required:**
```sql
CREATE INDEX idx_variants_selection ON variants (wallpaper_id, width, height);
```

#### 2. VariantSelectorService
**File:** `apps/media/src/services/variant-selector.service.ts`

**Responsibilities:**
- Encapsulate variant selection strategy
- Prevent upscaling
- Return selection decision with metadata

**Selection Algorithm:**
1. If no resize requested → return original
2. Calculate effective dimensions (handle width-only or height-only)
3. Check for upscaling → return original if needed
4. Query for smallest suitable variant
5. If variant found → use variant, else → use original

**Return Type:**
```typescript
interface SelectionResult {
  source: 'original' | 'variant';
  storageKey: string;
  storageBucket: string;
  width: number;
  height: number;
  mimeType: string;
  variantId?: string;
}
```

#### 3. ResizeService
**File:** `apps/media/src/services/resize.service.ts`

**Responsibilities:**
- Sharp-based streaming image transformation
- Support fit modes: contain, cover, fill
- Format-specific encoding (JPEG quality, PNG compression)
- Memory-efficient streaming (no full-image buffering)

**Sharp Configuration Pattern (from file-processor.service.ts):**
```typescript
sharp({
  limitInputPixels: 268402689, // 16384 x 16384 (decompression bomb protection)
  sequentialRead: true,         // Memory efficient
  failOnError: false            // Graceful degradation
})
```

**Fit Mode Mappings:**
- `contain` → `sharp.fit.inside` (fit within, preserve aspect, add letterboxing)
- `cover` → `sharp.fit.cover` (fill completely, crop excess, preserve aspect)
- `fill` → `sharp.fit.fill` (stretch to exact dimensions, distort if needed)

**Method Signature:**
```typescript
async resizeImage(
  inputStream: Readable,
  options: {
    width?: number;
    height?: number;
    fit: 'contain' | 'cover' | 'fill';
    mimeType: string;
  }
): Promise<Readable>
```

**Performance:** Streams directly without buffering for fastest delivery. No Content-Length header for resized images (uses HTTP/1.1 chunked transfer encoding).

#### 4. Error Classes
**File:** `apps/media/src/errors/problem-details.ts` (NEW)

**Classes:**
- `InvalidDimensionsError` - Query parameter validation errors (400)

**Pattern:** Follow RFC 7807 from ingestor's problem-details.ts

### Modified Components

#### 5. MediaService (Modified)
**File:** `apps/media/src/services/media.service.ts`

**Changes:**
- Add new method: `getWallpaperResized(id, resizeOptions)`
- Keep existing `getWallpaper()` unchanged
- Orchestrate: variant selection → MinIO fetch → resize → stream

**Method Signature:**
```typescript
async getWallpaperResized(
  id: string,
  options?: {
    width?: number;
    height?: number;
    fit: 'contain' | 'cover' | 'fill';
  }
): Promise<{
  stream: Readable;
  mimeType: string;
  // Note: No fileSizeBytes for resized images (unknown until streamed)
} | null>
```

**Error Handling:** If variant file is missing from MinIO, automatically fallback to original (graceful degradation).

#### 6. Media Routes (Modified)
**File:** `apps/media/src/routes/media.routes.ts`

**Changes:**
- Add Zod schema for query parameters
- Parse and validate `w`, `h`, `fit` from query string
- Call `getWallpaperResized()` instead of `getWallpaper()`
- Handle `InvalidDimensionsError` with RFC 7807 response

**Zod Schema:**
```typescript
const ResizeQuerySchema = z.object({
  w: z.coerce.number().int().min(1).max(7680).optional(),
  h: z.coerce.number().int().min(1).max(4320).optional(),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain')
});
```

---

## TDD Implementation Roadmap

### Phase 1: Foundation - Query Parameter Validation

**Test File:** `apps/media/test/integration/resize.test.ts` (NEW)

**Test Cases (9 tests):**
1. ✅ Valid width parameter accepted
2. ✅ Valid height parameter accepted
3. ✅ Valid fit parameter accepted
4. ✅ Default fit to "contain" when not specified
5. ❌ Reject width = 0 (400 error)
6. ❌ Reject width > 7680 (400 error)
7. ❌ Reject height = 0 (400 error)
8. ❌ Reject height > 4320 (400 error)
9. ❌ Reject invalid fit mode (400 error)

**TDD Cycle:**
1. **RED:** Write all 9 test cases → run → FAIL (query params not parsed)
2. **GREEN:**
   - Create error classes file
   - Add Zod schema to routes
   - Add validation logic
   - Run tests → PASS
3. **REFACTOR:** Extract validation helper if needed

**Deliverable:** Query parameter validation working with RFC 7807 errors

---

### Phase 2: Basic Resizing (Width-Only)

**Test Cases (5 tests):**
1. ✅ Resize 3840x2160 to w=1920 → expect 1920x1080 (aspect preserved)
2. ✅ Resize portrait 1080x1920 to w=540 → expect 540x960
3. ✅ Large image streams without buffering (verify with memory monitoring)
4. ✅ Response has correct cache headers
5. ✅ Content-Length header omitted for resized images (chunked encoding)

**TDD Cycle:**
1. **RED:** Write 4 test cases → run → FAIL (ResizeService doesn't exist)
2. **GREEN:**
   - Create ResizeService with width-only logic
   - Update MediaService to use ResizeService
   - Update routes to pass width param
   - Wire up DI in app.ts
   - Run tests → PASS
3. **REFACTOR:**
   - Add telemetry spans
   - Extract dimension calculation helper
   - Add error handling

**Test Pattern:**
```typescript
// Create test image
const image = await tester.fixtures.createTestImage({
  width: 3840,
  height: 2160,
  format: 'jpeg'
});

// Upload to MinIO
await tester.minio.uploadObject('wallpapers', 'wlpr_test/original.jpg', image);

// Insert into DB
const db = container.resolve(DatabaseConnection).getClient().db;
await db.insert(wallpapers).values({...});

// Test endpoint
const response = await app.inject({
  method: 'GET',
  url: '/wallpapers/wlpr_test?w=1920'
});

// Verify output dimensions with Sharp
const metadata = await sharp(response.rawPayload).metadata();
expect(metadata.width).toBe(1920);
expect(metadata.height).toBe(1080);
```

**Deliverable:** Width-only resizing working with streaming

---

### Phase 3: Height-Only Resizing

**Test Cases (2 tests):**
1. ✅ Resize 3840x2160 to h=1080 → expect 1920x1080
2. ✅ Resize portrait 1080x1920 to h=960 → expect 540x960

**TDD Cycle:**
1. **RED:** Write tests → run → FAIL
2. **GREEN:** Add height-only logic to ResizeService → PASS
3. **REFACTOR:** Unify width-only and height-only logic

**Deliverable:** Height-only resizing working

---

### Phase 4: Fit Modes

**Test Cases (6 tests):**
1. ✅ fit=contain with w=1000&h=1000 on 3840x2160 → 1000x562 (fits within, aspect preserved)
2. ✅ fit=contain with square image → exact fit
3. ✅ fit=cover with w=1000&h=1000 on 3840x2160 → 1000x1000 (fills, cropped)
4. ✅ fit=cover with portrait image
5. ✅ fit=fill with w=1000&h=1000 on 3840x2160 → 1000x1000 (stretched, distorted)
6. ✅ fit=fill with portrait image

**TDD Cycle:**
1. **RED:** Write contain tests → FAIL
2. **GREEN:** Implement contain mode → PASS
3. **RED:** Write cover tests → FAIL
4. **GREEN:** Implement cover mode → PASS
5. **RED:** Write fill tests → FAIL
6. **GREEN:** Implement fill mode → PASS
7. **REFACTOR:** Clean up fit mode handling

**Sharp Implementation:**
```typescript
if (fit === 'contain') {
  transformer.resize(width, height, {
    fit: sharp.fit.inside,
    withoutEnlargement: true
  });
} else if (fit === 'cover') {
  transformer.resize(width, height, {
    fit: sharp.fit.cover,
    position: sharp.strategy.entropy, // Smart cropping
    withoutEnlargement: true
  });
} else if (fit === 'fill') {
  transformer.resize(width, height, {
    fit: sharp.fit.fill,
    withoutEnlargement: true
  });
}
```

**Deliverable:** All fit modes working correctly

---

### Phase 5: Variant Selection

**Test Cases (6 tests):**
1. ✅ Exact match: variants [2560x1440, 1920x1080, 1280x720], request w=1920&h=1080 → use 1920x1080 variant
2. ✅ Next larger: variants [2560x1440, 1920x1080, 1280x720], request w=1600&h=900 → use 1920x1080 variant
3. ✅ Original fallback: variants [1920x1080, 1280x720], request w=2560&h=1440 → use original
4. ✅ No variants exist: request w=1920 → use original
5. ✅ Prefer smaller variant: variants [3840x2160, 1920x1080], request w=1920&h=1080 → use 1920x1080 (not 3840x2160)
6. ✅ Variant missing from MinIO: variant in DB but file missing → fallback to original automatically

**TDD Cycle:**
1. **RED:** Write exact match test → FAIL (VariantRepository doesn't exist)
2. **GREEN:**
   - Create VariantRepository
   - Create VariantSelectorService
   - Update MediaService to use VariantSelectorService
   - Implement exact match logic
   - Run test → PASS
3. **RED:** Write next larger test → FAIL
4. **GREEN:** Implement next-larger logic → PASS
5. **RED:** Write fallback test → FAIL
6. **GREEN:** Implement fallback logic → PASS
7. **REFACTOR:** Optimize selection algorithm

**Test Setup Pattern:**
```typescript
// Insert variants into DB
await db.insert(variants).values([
  {
    id: 'var_001',
    wallpaperId: 'wlpr_test',
    storageKey: 'wlpr_test/2560x1440.jpg',
    width: 2560,
    height: 1440,
    fileSizeBytes: 500000
  },
  {
    id: 'var_002',
    wallpaperId: 'wlpr_test',
    storageKey: 'wlpr_test/1920x1080.jpg',
    width: 1920,
    height: 1080,
    fileSizeBytes: 300000
  }
]);

// Create actual variant files in MinIO
const variant1920 = await tester.fixtures.createTestImage({ width: 1920, height: 1080, format: 'jpeg' });
await tester.minio.uploadObject('wallpapers', 'wlpr_test/1920x1080.jpg', variant1920);
```

**Test Setup for Missing Variant:**
```typescript
// Insert variant in DB but don't upload to MinIO
await db.insert(variants).values({
  id: 'var_missing',
  wallpaperId: 'wlpr_test',
  storageKey: 'wlpr_test/1920x1080.jpg', // File doesn't exist in MinIO
  width: 1920,
  height: 1080,
  fileSizeBytes: 300000
});

// Test should fall back to original gracefully
const response = await app.inject({
  method: 'GET',
  url: '/wallpapers/wlpr_test?w=1920&h=1080'
});

expect(response.statusCode).toBe(200); // Not 404
// Verify it used original by checking actual dimensions
```

**Deliverable:** Variant selection working with database queries and graceful fallback

---

### Phase 6: No Upscaling

**Test Cases (4 tests):**
1. ✅ Request w=3840 on 1920x1080 original → return 1920x1080 (no upscaling)
2. ✅ Request h=2160 on 1920x1080 original → return 1920x1080
3. ✅ Request w=3840&h=2160 on 1920x1080 → return 1920x1080
4. ✅ One dimension exceeds with fit=contain → return original

**TDD Cycle:**
1. **RED:** Write upscaling prevention tests → FAIL
2. **GREEN:** Add upscaling check in VariantSelectorService → PASS
3. **REFACTOR:** Add telemetry attribute for upscaling prevention

**Logic:**
```typescript
if (requestedWidth > originalWidth || requestedHeight > originalHeight) {
  span.setAttribute('upscaling_prevented', true);
  return { source: 'original', ... };
}
```

**Deliverable:** Upscaling prevention working

---

### Phase 7: Edge Cases & Performance

**Test Cases (7 tests):**
1. ✅ Square aspect ratio (2048x2048) resizes correctly
2. ✅ Extreme aspect ratio 21:9 (5120x1440) → w=2560 → 2560x1114
3. ✅ PNG format preserved through resize
4. ✅ WebP format preserved through resize
5. ✅ Resize duration <2s for 3840x2160 → 1920x1080
6. ✅ Memory usage bounded (no spikes for large images)
7. ✅ Different MIME types encoded correctly (JPEG quality 90, PNG compression 6)

**TDD Cycle:**
1. Write each test individually
2. Fix any issues found
3. Add format-specific encoding if needed

**Format-Specific Encoding:**
```typescript
if (mimeType === 'image/jpeg') {
  transformer.jpeg({ quality: 90, progressive: true });
} else if (mimeType === 'image/png') {
  transformer.png({ compressionLevel: 6 });
} else if (mimeType === 'image/webp') {
  transformer.webp({ quality: 90 });
}
```

**Deliverable:** All edge cases handled, performance validated

---

## Telemetry Instrumentation

### Spans to Add

**1. `variant_selector.select_source`** (VariantSelectorService)
- Attributes:
  - `wallpaper_id`
  - `requested_width`
  - `requested_height`
  - `selection` (original | variant)
  - `variant_id` (if variant selected)
  - `upscaling_prevented` (boolean)

**2. `resize.transform`** (ResizeService)
- Attributes:
  - `input_width`
  - `input_height`
  - `output_width`
  - `output_height`
  - `fit`
  - `mime_type`
  - `duration_ms`

**3. `media.get_wallpaper_resized`** (MediaService)
- Attributes:
  - `wallpaper_id`
  - `source_type` (original | variant)
  - `resize_needed` (boolean)
  - `result` (success | not_found)

### Metrics

**1. `resize.duration_ms` (histogram)**
- Labels: `fit`, `input_pixels`, `output_pixels`

**Pattern (from @wallpaperdb/core/telemetry):**
```typescript
import { withSpan, recordHistogram, Attributes } from '@wallpaperdb/core/telemetry';

return await withSpan('resize.transform', attributes, async (span) => {
  const startTime = Date.now();
  // ... resize logic ...
  const durationMs = Date.now() - startTime;
  recordHistogram('resize.duration_ms', durationMs, attributes);
  return result;
});
```

---

## Critical Files

### Files to Create

1. **`apps/media/test/integration/resize.test.ts`**
   - Primary test file (50+ tests)
   - Drives all TDD implementation
   - Uses TesterBuilder with real Sharp, Postgres, MinIO

2. **`apps/media/src/services/resize.service.ts`**
   - Core Sharp-based resizing
   - Streaming transformations (no buffering for fastest delivery)
   - Format-specific encoding

3. **`apps/media/src/services/variant-selector.service.ts`**
   - Variant selection algorithm
   - Upscaling prevention
   - Automatic fallback to original if variant missing from MinIO
   - Telemetry

4. **`apps/media/src/repositories/variant.repository.ts`**
   - Database queries for variants
   - Optimized selection query using composite index

5. **`apps/media/src/errors/problem-details.ts`**
   - `InvalidDimensionsError` class
   - RFC 7807 pattern

6. **`apps/media/drizzle/0001_add_variants_index.sql`** (NEW MIGRATION)
   - Add composite index on variants table
   - `CREATE INDEX idx_variants_selection ON variants (wallpaper_id, width, height);`

### Files to Modify

6. **`apps/media/src/services/media.service.ts`**
   - Add `getWallpaperResized()` method
   - Orchestrate variant selection + resize
   - Implement fallback logic (variant missing → try original)

7. **`apps/media/src/routes/media.routes.ts`**
   - Add Zod schema for query params
   - Parse and validate
   - Call `getWallpaperResized()`
   - **Omit Content-Length header for resized images** (fastest streaming)
   - Keep Content-Length for original files only

8. **`apps/media/src/app.ts`**
   - Register new services in DI container (ResizeService, VariantSelectorService)
   - Register new repository (VariantRepository)

---

## Red-Green-Refactor Example

### Example: Width-Only Resize

**RED - Write Failing Test:**
```typescript
describe('Width-Only Resize', () => {
  it('should resize to exact width, maintaining aspect ratio', async () => {
    // Given: 3840x2160 image
    const image = await tester.fixtures.createTestImage({
      width: 3840, height: 2160, format: 'jpeg'
    });
    await tester.minio.uploadObject('wallpapers', 'wlpr_test/original.jpg', image);
    await db.insert(wallpapers).values({
      id: 'wlpr_test', width: 3840, height: 2160, ...
    });

    // When: GET /wallpapers/wlpr_test?w=1920
    const response = await app.inject({
      method: 'GET',
      url: '/wallpapers/wlpr_test?w=1920'
    });

    // Then: output = 1920x1080
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
  });
});
```

Run: `make media-test` → **FAILS** (ResizeService doesn't exist)

**GREEN - Minimum Implementation:**

1. Create `resize.service.ts`:
```typescript
@injectable()
export class ResizeService {
  async resizeImage(inputStream: Readable, options: {...}): Promise<Readable> {
    const transformer = sharp({
      limitInputPixels: 268402689,
      sequentialRead: true,
      failOnError: false
    });

    if (options.width) {
      transformer.resize(options.width, null, { withoutEnlargement: true });
    }

    transformer.jpeg({ quality: 90 });

    const outputStream = new PassThrough();
    pipeline(inputStream, transformer, outputStream);
    return outputStream;
  }
}
```

2. Update `media.service.ts`:
```typescript
async getWallpaperResized(id: string, options?: {...}) {
  const wallpaper = await this.repository.findById(id);
  if (!wallpaper) return null;

  const command = new GetObjectCommand({...});
  const response = await this.minio.getClient().send(command);

  if (options?.width || options?.height) {
    const stream = await this.resizeService.resizeImage(
      response.Body as Readable,
      options
    );
    return { stream, mimeType: wallpaper.mimeType };
  }

  return { stream: response.Body as Readable, ... };
}
```

3. Update routes to parse `w` param and call `getWallpaperResized()`

4. Register ResizeService in DI container

Run: `make media-test` → **PASSES**

**REFACTOR - Improve Code:**
- Extract dimension calculation helper
- Add telemetry spans
- Add error handling for Sharp failures
- Add comments

Run: `make media-test` → **STILL PASSES**

---

## Test Execution Pattern

### Setup (beforeAll)
```typescript
const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(FixturesTesterBuilder)
  .with(MediaMigrationsTesterBuilder)
  .with(InProcessMediaTesterBuilder)
  .build();

let tester: InstanceType<typeof TesterClass>;
let app: FastifyInstance;
let db: ReturnType<typeof DatabaseConnection.prototype.getClient>['db'];
let container: DependencyContainer;

beforeAll(async () => {
  tester = new TesterClass();
  tester
    .withPostgres(builder => builder.withDatabase(`test_media_resize_${Date.now()}`))
    .withMinio()
    .withMinioBucket('wallpapers')
    .withNats(builder => builder.withJetstream())
    .withMigrations()
    .withInProcessApp();

  await tester.setup();
  app = tester.getApp();
  container = app.container;
  db = container.resolve(DatabaseConnection).getClient().db;
}, 60000);

afterAll(async () => {
  await tester.destroy();
});
```

### Test Structure
```typescript
describe('Phase 4: Resizing & Variant Selection', () => {
  describe('Query Parameter Validation', () => {
    // 9 tests
  });

  describe('Width-Only Resize', () => {
    // 5 tests
  });

  describe('Height-Only Resize', () => {
    // 2 tests
  });

  describe('Fit Modes', () => {
    // 6 tests
  });

  describe('Variant Selection', () => {
    // 6 tests
  });

  describe('No Upscaling', () => {
    // 4 tests
  });

  describe('Edge Cases & Performance', () => {
    // 7 tests
  });
});
```

---

## Success Criteria

**Functional:**
- ✅ All 50+ integration tests passing
- ✅ Real Sharp transformations verified (no mocks)
- ✅ Variant selection tested with real database queries
- ✅ All fit modes working correctly
- ✅ No upscaling occurs (verified in tests)
- ✅ Query parameter validation with RFC 7807 errors

**Performance:**
- ✅ Resize duration <2s for 3840x2160 → 1920x1080
- ✅ Memory usage bounded (no spikes for large images)
- ✅ Streaming verified (no full-image buffering)

**Observability:**
- ✅ Telemetry spans showing selection decisions
- ✅ Metrics tracking resize performance
- ✅ Attributes capturing input/output dimensions

**Code Quality:**
- ✅ Follows established patterns (DI, telemetry, error handling)
- ✅ Cache headers correct
- ✅ Format-specific encoding (JPEG, PNG, WebP)

---

## Commands to Run

```bash
# Start infrastructure (if not running)
make infra-start

# Run tests in watch mode during development
make media-test-watch

# Run full test suite
make media-test

# Lint and format
make media-lint
make media-format

# Build
make media-build

# Run in development mode
make media-dev
```

---

## Decision Summary

Based on user feedback and performance optimization:

1. **Service Architecture:** Separate ResizeService for better separation of concerns and testability
2. **HTTP Headers:** Omit Content-Length for resized images to enable direct streaming (fastest delivery)
3. **Error Handling:** Automatic fallback to original if variant file missing from MinIO (graceful degradation)
4. **Database Performance:** Add composite index `(wallpaper_id, width, height)` on variants table

## Notes

- **No E2E tests initially** - Focus on integration tests first. E2E can be added later.
- **TesterBuilder pattern** - Provides real infrastructure, making tests comprehensive
- **Binary response verification** - Use `response.rawPayload` and Sharp metadata extraction
- **Streaming validation** - Monitor memory usage in performance tests
- **Incremental implementation** - Each phase builds on previous, allowing continuous validation
- **Performance priority** - Direct streaming without buffering maximizes throughput

This plan provides complete guidance for implementing Phase 4 in a test-driven manner, following the project's established patterns and best practices.
