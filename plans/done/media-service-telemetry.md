# Media Service Telemetry Implementation Plan

## Overview

Add comprehensive OpenTelemetry instrumentation (traces and metrics) to the media service following established patterns from the ingestor service. The media service is READ-heavy with optimization features (variant selection, on-demand resizing), requiring telemetry that tracks performance, optimization effectiveness, and error scenarios.

## Goals

1. **Tracing**: End-to-end visibility of wallpaper retrieval flow from HTTP request → variant selection → S3 fetch → optional resize
2. **Metrics**: Performance tracking (latencies, throughput), optimization effectiveness (variant hit rates), error rates
3. **Consistency**: Follow ingestor patterns for similar operations (S3, database, NATS events)
4. **Business Value**: Track variant selection effectiveness to validate optimization strategy

## Implementation Phases

### Phase 1: Add New Telemetry Attributes

**File**: `packages/core/src/telemetry/attributes.ts`

Add 9 new attribute constants for media service operations:

```typescript
export const Attributes = {
  // ... existing attributes ...

  // Resize context
  RESIZE_WIDTH: "resize.width",
  RESIZE_HEIGHT: "resize.height",
  RESIZE_FIT_MODE: "resize.fit_mode",
  RESIZE_SOURCE: "resize.source", // "original" | "variant"

  // Variant selection
  VARIANT_ID: "variant.id",
  VARIANT_SELECTION_RESULT: "variant.selection.result", // "hit" | "miss" | "no_resize" | "upscale_avoided"
  VARIANT_FALLBACK: "variant.fallback", // true if variant file missing, fell back to original

  // Image processing
  IMAGE_FORMAT: "image.format", // jpeg, png, webp
  IMAGE_QUALITY: "image.quality",
} as const;
```

**Rationale**: These attributes are specific to media service operations and don't exist in the ingestor (which focuses on uploads, not retrieval/resizing).

---

### Phase 2: Instrument Repository Layer

#### 2.1 WallpaperRepository

**File**: `apps/media/src/repositories/wallpaper.repository.ts`

**Method**: `findById(id: string)`

```typescript
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';

async findById(id: string): Promise<Wallpaper | undefined> {
  return await withSpan(
    'db.wallpaper.find_by_id',
    { [Attributes.WALLPAPER_ID]: id },
    async (span) => {
      const startTime = Date.now();

      const result = await this.db.query.wallpapers.findFirst({
        where: eq(wallpapers.id, id),
      });

      const durationMs = Date.now() - startTime;
      const found = result !== undefined;

      span.setAttribute('db.query.found', found);

      recordCounter('db.queries.total', 1, {
        table: 'wallpapers',
        operation: 'find_by_id',
        found: found.toString(),
      });

      recordHistogram('db.query_duration_ms', durationMs, {
        table: 'wallpapers',
        operation: 'find_by_id',
      });

      return result;
    }
  );
}
```

**Method**: `upsert(data)` (already exists for event consumer)

```typescript
async upsert(data: WallpaperInsert): Promise<void> {
  return await withSpan(
    'db.wallpaper.upsert',
    { [Attributes.WALLPAPER_ID]: data.id },
    async (span) => {
      const startTime = Date.now();

      await this.db
        .insert(wallpapers)
        .values(data)
        .onConflictDoUpdate({
          target: wallpapers.id,
          set: data,
        });

      const durationMs = Date.now() - startTime;

      recordCounter('db.queries.total', 1, {
        table: 'wallpapers',
        operation: 'upsert',
      });

      recordHistogram('db.query_duration_ms', durationMs, {
        table: 'wallpapers',
        operation: 'upsert',
      });
    }
  );
}
```

#### 2.2 VariantRepository

**File**: `apps/media/src/repositories/variant.repository.ts`

**Method**: `findSmallestSuitable(wallpaperId, width, height)`

```typescript
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';

async findSmallestSuitable(
  wallpaperId: string,
  minWidth: number,
  minHeight: number
): Promise<Variant | undefined> {
  return await withSpan(
    'db.variant.find_smallest_suitable',
    {
      [Attributes.WALLPAPER_ID]: wallpaperId,
      [Attributes.RESIZE_WIDTH]: minWidth,
      [Attributes.RESIZE_HEIGHT]: minHeight,
    },
    async (span) => {
      const startTime = Date.now();

      const result = await this.db.query.variants.findFirst({
        where: and(
          eq(variants.wallpaperId, wallpaperId),
          gte(variants.width, minWidth),
          gte(variants.height, minHeight)
        ),
        orderBy: [asc(variants.width), asc(variants.height)],
      });

      const durationMs = Date.now() - startTime;
      const found = result !== undefined;

      span.setAttribute('db.query.found', found);
      if (found && result) {
        span.setAttribute(Attributes.VARIANT_ID, result.id);
      }

      recordCounter('db.queries.total', 1, {
        table: 'variants',
        operation: 'find_smallest_suitable',
        found: found.toString(),
      });

      recordHistogram('db.query_duration_ms', durationMs, {
        table: 'variants',
        operation: 'find_smallest_suitable',
      });

      return result;
    }
  );
}
```

---

### Phase 3: Instrument Service Layer

#### 3.1 VariantSelectorService (MOST CRITICAL)

**File**: `apps/media/src/services/variant-selector.service.ts`

**Method**: `selectSource(wallpaper, options)`

This is the MOST CRITICAL instrumentation - tracks optimization effectiveness.

```typescript
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';

async selectSource(
  wallpaper: Wallpaper,
  options?: {
    width?: number;
    height?: number;
    fit: "contain" | "cover" | "fill";
  }
): Promise<SelectionResult> {
  return await withSpan(
    'media.variant_selection',
    {
      [Attributes.WALLPAPER_ID]: wallpaper.id,
      [Attributes.FILE_WIDTH]: wallpaper.width,
      [Attributes.FILE_HEIGHT]: wallpaper.height,
      [Attributes.RESIZE_WIDTH]: options?.width,
      [Attributes.RESIZE_HEIGHT]: options?.height,
      [Attributes.RESIZE_FIT_MODE]: options?.fit,
    },
    async (span) => {
      // No resize requested - use original
      if (!options?.width && !options?.height) {
        span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, 'no_resize');

        recordCounter('media.variant_selection.total', 1, {
          result: 'no_resize',
        });

        return {
          source: "original",
          storageKey: wallpaper.storageKey,
          storageBucket: wallpaper.storageBucket,
          width: wallpaper.width,
          height: wallpaper.height,
          mimeType: wallpaper.mimeType,
        };
      }

      // Calculate effective dimensions
      const requestedWidth = options.width || wallpaper.width;
      const requestedHeight = options.height || wallpaper.height;

      span.setAttribute('effective_width', requestedWidth);
      span.setAttribute('effective_height', requestedHeight);

      // Check for upscaling
      const wouldUpscale =
        options.fit !== "fill" &&
        (requestedWidth > wallpaper.width || requestedHeight > wallpaper.height);

      if (wouldUpscale) {
        span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, 'upscale_avoided');

        recordCounter('media.variant_selection.total', 1, {
          result: 'upscale_avoided',
        });

        return {
          source: "original",
          storageKey: wallpaper.storageKey,
          storageBucket: wallpaper.storageBucket,
          width: wallpaper.width,
          height: wallpaper.height,
          mimeType: wallpaper.mimeType,
        };
      }

      // Try to find a suitable variant
      const variant = await this.variantRepository.findSmallestSuitable(
        wallpaper.id,
        requestedWidth,
        requestedHeight,
      );

      if (variant) {
        // VARIANT HIT - Found suitable variant
        span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, 'hit');
        span.setAttribute(Attributes.VARIANT_ID, variant.id);
        span.setAttribute(Attributes.RESIZE_SOURCE, 'variant');

        // Calculate efficiency (how much smaller is variant vs original)
        const originalPixels = wallpaper.width * wallpaper.height;
        const variantPixels = variant.width * variant.height;
        const efficiencyPercent = ((1 - variantPixels / originalPixels) * 100).toFixed(2);

        span.setAttribute('variant.efficiency_percent', parseFloat(efficiencyPercent));

        recordCounter('media.variant_selection.total', 1, {
          result: 'hit',
        });

        recordHistogram('media.variant_selection.efficiency_percent', parseFloat(efficiencyPercent), {
          [Attributes.WALLPAPER_ID]: wallpaper.id,
        });

        return {
          source: "variant",
          storageKey: variant.storageKey,
          storageBucket: wallpaper.storageBucket,
          width: variant.width,
          height: variant.height,
          mimeType: wallpaper.mimeType,
          variantId: variant.id,
        };
      }

      // VARIANT MISS - No suitable variant
      span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, 'miss');
      span.setAttribute(Attributes.RESIZE_SOURCE, 'original');

      recordCounter('media.variant_selection.total', 1, {
        result: 'miss',
      });

      return {
        source: "original",
        storageKey: wallpaper.storageKey,
        storageBucket: wallpaper.storageBucket,
        width: wallpaper.width,
        height: wallpaper.height,
        mimeType: wallpaper.mimeType,
      };
    }
  );
}
```

**Metrics Created**:
- `media.variant_selection.total` (counter) - Labels: `result` (hit, miss, no_resize, upscale_avoided)
- `media.variant_selection.efficiency_percent` (histogram) - Measures how much smaller variant is vs original

**Business Value**: Tracks if variant generation strategy is working. High "hit" rate + good efficiency = successful optimization.

#### 3.2 ResizeService

**File**: `apps/media/src/services/resize.service.ts`

**Method**: `resizeImage(inputStream, options)`

**SPECIAL CONSIDERATION**: Sharp pipeline is async - actual processing happens AFTER method returns (streaming). We track SETUP time, not processing time (which is measured at HTTP layer as total response time).

```typescript
import { withSpanSync, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

async resizeImage(
  inputStream: Readable,
  options: ResizeOptions,
): Promise<Readable> {
  return withSpanSync(
    'media.resize.setup_pipeline',
    {
      [Attributes.RESIZE_WIDTH]: options.width,
      [Attributes.RESIZE_HEIGHT]: options.height,
      [Attributes.RESIZE_FIT_MODE]: options.fit,
      [Attributes.FILE_MIME_TYPE]: options.mimeType,
    },
    (span) => {
      const startTime = Date.now();

      // Create Sharp transformer with limits
      const transformer = sharp({
        limitInputPixels: 268402689, // 16384 x 16384 pixels
        sequentialRead: true,
        failOnError: false,
      });

      // Apply resize if width or height is specified
      if (options.width || options.height) {
        if (options.fit === "contain") {
          transformer.resize(options.width, options.height, {
            fit: sharp.fit.inside,
            withoutEnlargement: true,
          });
        } else if (options.fit === "cover") {
          transformer.resize(options.width, options.height, {
            fit: sharp.fit.cover,
            position: sharp.strategy.entropy,
            withoutEnlargement: true,
          });
        } else if (options.fit === "fill") {
          transformer.resize(options.width, options.height, {
            fit: sharp.fit.fill,
          });
        }
      }

      // Apply format-specific encoding
      if (options.mimeType === "image/jpeg") {
        transformer.jpeg({ quality: 90, progressive: true });
        span.setAttribute(Attributes.IMAGE_FORMAT, 'jpeg');
        span.setAttribute(Attributes.IMAGE_QUALITY, 90);
      } else if (options.mimeType === "image/png") {
        transformer.png({ compressionLevel: 6 });
        span.setAttribute(Attributes.IMAGE_FORMAT, 'png');
      } else if (options.mimeType === "image/webp") {
        transformer.webp({ quality: 90 });
        span.setAttribute(Attributes.IMAGE_FORMAT, 'webp');
        span.setAttribute(Attributes.IMAGE_QUALITY, 90);
      }

      // Create output stream
      const outputStream = new PassThrough();

      // Setup duration metric
      const setupDurationMs = Date.now() - startTime;
      recordHistogram('media.resize.setup_duration_ms', setupDurationMs, {
        [Attributes.RESIZE_FIT_MODE]: options.fit,
        [Attributes.IMAGE_FORMAT]: options.mimeType.split('/')[1],
      });

      // Pipe input → transformer → output (non-blocking)
      // Track pipeline errors but don't block return
      pipeline(inputStream, transformer, outputStream).catch((error) => {
        recordCounter('media.resize.pipeline.errors', 1, {
          error_type: error.constructor.name,
        });
        console.error('Sharp pipeline error:', error);
      });

      return outputStream;
    }
  );
}
```

**Metrics Created**:
- `media.resize.setup_duration_ms` (histogram) - Labels: `resize.fit_mode`, `image.format`
- `media.resize.pipeline.errors` (counter) - Labels: `error_type`

**Note**: Actual resize performance is measured at HTTP layer (total request duration).

#### 3.3 MediaService

**File**: `apps/media/src/services/media.service.ts`

**Method**: `getWallpaper(id)` (simple retrieval, no resize)

```typescript
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';

async getWallpaper(id: string): Promise<{
  stream: Readable;
  mimeType: string;
  fileSizeBytes: number;
} | null> {
  return await withSpan(
    'media.get_wallpaper',
    { [Attributes.WALLPAPER_ID]: id },
    async (span) => {
      // Query database for wallpaper metadata
      const wallpaper = await this.repository.findById(id);

      if (!wallpaper) {
        span.setAttribute('wallpaper.found', false);
        return null;
      }

      span.setAttribute('wallpaper.found', true);
      span.setAttribute(Attributes.STORAGE_BUCKET, wallpaper.storageBucket);
      span.setAttribute(Attributes.STORAGE_KEY, wallpaper.storageKey);
      span.setAttribute(Attributes.FILE_MIME_TYPE, wallpaper.mimeType);
      span.setAttribute(Attributes.FILE_SIZE_BYTES, wallpaper.fileSizeBytes);

      try {
        const s3StartTime = Date.now();

        // Get file from MinIO
        const command = new GetObjectCommand({
          Bucket: wallpaper.storageBucket,
          Key: wallpaper.storageKey,
        });

        const response = await this.minio.getClient().send(command);

        const s3DurationMs = Date.now() - s3StartTime;

        recordCounter('media.s3.operations.total', 1, {
          [Attributes.OPERATION_NAME]: 'get_object',
          [Attributes.OPERATION_SUCCESS]: 'true',
        });

        recordHistogram('media.s3.get_duration_ms', s3DurationMs, {
          [Attributes.OPERATION_NAME]: 'get_object',
        });

        if (!response.Body) {
          throw new Error("MinIO returned no body");
        }

        return {
          stream: response.Body as Readable,
          mimeType: wallpaper.mimeType,
          fileSizeBytes: wallpaper.fileSizeBytes,
        };
      } catch (error) {
        recordCounter('media.s3.operations.total', 1, {
          [Attributes.OPERATION_NAME]: 'get_object',
          [Attributes.OPERATION_SUCCESS]: 'false',
          [Attributes.ERROR_TYPE]: error instanceof Error ? error.constructor.name : 'UnknownError',
        });

        console.error(`Failed to retrieve file from MinIO for wallpaper ${id}:`, error);
        return null;
      }
    }
  );
}
```

**Method**: `getWallpaperResized(id, options)` (complex: variant selection + optional resize + fallback)

```typescript
async getWallpaperResized(
  id: string,
  options?: {
    width?: number;
    height?: number;
    fit: "contain" | "cover" | "fill";
  }
): Promise<{
  stream: Readable;
  mimeType: string;
  fileSizeBytes?: number;
} | null> {
  return await withSpan(
    'media.get_wallpaper_resized',
    {
      [Attributes.WALLPAPER_ID]: id,
      [Attributes.RESIZE_WIDTH]: options?.width,
      [Attributes.RESIZE_HEIGHT]: options?.height,
      [Attributes.RESIZE_FIT_MODE]: options?.fit,
    },
    async (span) => {
      // Query database for wallpaper metadata
      const wallpaper = await this.repository.findById(id);

      if (!wallpaper) {
        span.setAttribute('wallpaper.found', false);
        return null;
      }

      span.setAttribute('wallpaper.found', true);

      // Select best source (original or variant)
      const selection = await this.variantSelector.selectSource(wallpaper, options);

      span.setAttribute(Attributes.RESIZE_SOURCE, selection.source);
      if (selection.variantId) {
        span.setAttribute(Attributes.VARIANT_ID, selection.variantId);
      }

      try {
        const s3StartTime = Date.now();

        // Get file from MinIO using selected source
        const command = new GetObjectCommand({
          Bucket: selection.storageBucket,
          Key: selection.storageKey,
        });

        const response = await this.minio.getClient().send(command);

        const s3DurationMs = Date.now() - s3StartTime;

        recordCounter('media.s3.operations.total', 1, {
          [Attributes.OPERATION_NAME]: 'get_object',
          [Attributes.OPERATION_SUCCESS]: 'true',
          source: selection.source,
        });

        recordHistogram('media.s3.get_duration_ms', s3DurationMs, {
          [Attributes.OPERATION_NAME]: 'get_object',
          source: selection.source,
        });

        if (!response.Body) {
          throw new Error("MinIO returned no body");
        }

        const inputStream = response.Body as Readable;

        // If resize requested, apply transformation
        if (options?.width || options?.height) {
          span.setAttribute('resize_applied', true);

          const resizedStream = await this.resizeService.resizeImage(inputStream, {
            width: options.width,
            height: options.height,
            fit: options.fit || "contain",
            mimeType: selection.mimeType,
          });

          return {
            stream: resizedStream,
            mimeType: selection.mimeType,
          };
        }

        span.setAttribute('resize_applied', false);

        return {
          stream: inputStream,
          mimeType: selection.mimeType,
          fileSizeBytes: wallpaper.fileSizeBytes,
        };
      } catch (error) {
        // FALLBACK LOGIC: Variant file might be missing from MinIO
        if (selection.source === "variant") {
          span.setAttribute(Attributes.VARIANT_FALLBACK, true);

          recordCounter('media.variant.fallback.total', 1, {
            [Attributes.WALLPAPER_ID]: id,
            [Attributes.VARIANT_ID]: selection.variantId!,
          });

          recordCounter('media.s3.operations.total', 1, {
            [Attributes.OPERATION_NAME]: 'get_object',
            [Attributes.OPERATION_SUCCESS]: 'false',
            source: 'variant',
            [Attributes.ERROR_TYPE]: error instanceof Error ? error.constructor.name : 'UnknownError',
          });

          console.warn(
            `Variant ${selection.variantId} file missing from MinIO, falling back to original`,
          );

          // Retry with original
          try {
            const s3StartTime = Date.now();

            const command = new GetObjectCommand({
              Bucket: wallpaper.storageBucket,
              Key: wallpaper.storageKey,
            });

            const response = await this.minio.getClient().send(command);

            const s3DurationMs = Date.now() - s3StartTime;

            recordCounter('media.s3.operations.total', 1, {
              [Attributes.OPERATION_NAME]: 'get_object',
              [Attributes.OPERATION_SUCCESS]: 'true',
              source: 'original',
              fallback: 'true',
            });

            recordHistogram('media.s3.get_duration_ms', s3DurationMs, {
              [Attributes.OPERATION_NAME]: 'get_object',
              source: 'original',
            });

            if (!response.Body) {
              throw new Error("MinIO returned no body");
            }

            const inputStream = response.Body as Readable;

            // Apply resize if requested
            if (options?.width || options?.height) {
              const resizedStream = await this.resizeService.resizeImage(
                inputStream,
                {
                  width: options.width,
                  height: options.height,
                  fit: options.fit || "contain",
                  mimeType: wallpaper.mimeType,
                },
              );

              return {
                stream: resizedStream,
                mimeType: wallpaper.mimeType,
              };
            }

            return {
              stream: inputStream,
              mimeType: wallpaper.mimeType,
              fileSizeBytes: wallpaper.fileSizeBytes,
            };
          } catch (fallbackError) {
            recordCounter('media.s3.operations.total', 1, {
              [Attributes.OPERATION_NAME]: 'get_object',
              [Attributes.OPERATION_SUCCESS]: 'false',
              source: 'original',
              fallback: 'true',
              [Attributes.ERROR_TYPE]: fallbackError instanceof Error ? fallbackError.constructor.name : 'UnknownError',
            });

            console.error(
              `Failed to retrieve original file from MinIO for wallpaper ${id}:`,
              fallbackError,
            );
            return null;
          }
        }

        // Original file not found in MinIO (or other S3 error)
        recordCounter('media.s3.operations.total', 1, {
          [Attributes.OPERATION_NAME]: 'get_object',
          [Attributes.OPERATION_SUCCESS]: 'false',
          source: 'original',
          [Attributes.ERROR_TYPE]: error instanceof Error ? error.constructor.name : 'UnknownError',
        });

        console.error(`Failed to retrieve file from MinIO for wallpaper ${id}:`, error);
        return null;
      }
    }
  );
}
```

**Metrics Created**:
- `media.s3.operations.total` (counter) - Labels: `operation.name`, `operation.success`, `source`, `fallback`, `error.type`
- `media.s3.get_duration_ms` (histogram) - Labels: `operation.name`, `source`
- `media.variant.fallback.total` (counter) - Labels: `wallpaper.id`, `variant.id`

**Special Handling**: Fallback logic when variant files are missing from MinIO. Records TWO S3 operations (failed variant + successful original retry).

---

### Phase 4: Instrument HTTP Layer

**File**: `apps/media/src/routes/media.routes.ts`

**Route**: `GET /wallpapers/:id`

```typescript
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';

fastify.get<{ Params: WallpaperParams; Querystring: ResizeQuerystring }>(
  "/wallpapers/:id",
  async (
    request: FastifyRequest<{
      Params: WallpaperParams;
      Querystring: ResizeQuerystring;
    }>,
    reply: FastifyReply,
  ) => {
    return await withSpan(
      'http.get_wallpaper',
      {
        [Attributes.WALLPAPER_ID]: request.params.id,
        'http.method': 'GET',
        'http.route': '/wallpapers/:id',
      },
      async (span) => {
        const startTime = Date.now();
        const { id } = request.params;

        // Validate query parameters
        let queryParams: z.infer<typeof ResizeQuerySchema>;
        try {
          queryParams = ResizeQuerySchema.parse(request.query);
        } catch (error) {
          if (error instanceof z.ZodError) {
            recordCounter('http.requests.validation_errors', 1, {
              route: '/wallpapers/:id',
              error_type: 'query_params',
            });

            const validationError = new InvalidDimensionsError(
              error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
              `/wallpapers/${id}`,
            );

            span.setAttribute('http.status_code', validationError.statusCode);

            return reply
              .status(validationError.statusCode)
              .type("application/problem+json")
              .send(validationError.toProblemDetails());
          }
          throw error;
        }

        span.setAttribute(Attributes.RESIZE_WIDTH, queryParams.w);
        span.setAttribute(Attributes.RESIZE_HEIGHT, queryParams.h);
        span.setAttribute(Attributes.RESIZE_FIT_MODE, queryParams.fit);

        // Retrieve wallpaper with optional resizing
        const result = await mediaService.getWallpaperResized(id, {
          width: queryParams.w,
          height: queryParams.h,
          fit: queryParams.fit,
        });

        if (!result) {
          const durationMs = Date.now() - startTime;

          recordCounter('http.requests.not_found', 1, {
            route: '/wallpapers/:id',
          });

          recordHistogram('http.wallpaper_retrieval_duration_ms', durationMs, {
            status: 'not_found',
            resize: (queryParams.w || queryParams.h) ? 'true' : 'false',
          });

          span.setAttribute('http.status_code', 404);
          span.setAttribute('wallpaper.found', false);

          return reply.status(404).type("application/problem+json").send({
            type: "https://wallpaperdb.dev/problems/not-found",
            title: "Wallpaper Not Found",
            status: 404,
            detail: `Wallpaper with ID '${id}' was not found or file is missing from storage`,
            instance: `/wallpapers/${id}`,
          });
        }

        const durationMs = Date.now() - startTime;
        const hasResize = queryParams.w || queryParams.h;

        span.setAttribute('http.status_code', 200);
        span.setAttribute('wallpaper.found', true);
        span.setAttribute('resize_requested', hasResize !== undefined);

        recordCounter('http.wallpaper_retrievals.total', 1, {
          status: 'success',
          resize: hasResize ? 'true' : 'false',
          fit_mode: queryParams.fit,
        });

        recordHistogram('http.wallpaper_retrieval_duration_ms', durationMs, {
          status: 'success',
          resize: hasResize ? 'true' : 'false',
        });

        // Set response headers
        reply.type(result.mimeType);

        if (result.fileSizeBytes !== undefined) {
          reply.header("Content-Length", result.fileSizeBytes);
          span.setAttribute(Attributes.FILE_SIZE_BYTES, result.fileSizeBytes);
        }

        reply.header("Cache-Control", "public, max-age=31536000, immutable");

        // Stream the file
        return reply.send(result.stream);
      }
    );
  },
);
```

**Metrics Created**:
- `http.requests.validation_errors` (counter) - Labels: `route`, `error_type`
- `http.requests.not_found` (counter) - Labels: `route`
- `http.wallpaper_retrievals.total` (counter) - Labels: `status`, `resize`, `fit_mode`
- `http.wallpaper_retrieval_duration_ms` (histogram) - Labels: `status`, `resize`

**Key Points**:
- Measures END-TO-END latency from HTTP request to response
- Includes resize performance (Sharp pipeline processing time)
- Tracks validation errors separately from business logic errors

---

### Phase 5: Instrument Event Consumer

**File**: `apps/media/src/services/consumers/wallpaper-uploaded-consumer.service.ts`

**Note**: `BaseEventConsumer` already provides most telemetry (spans for event processing, counters for success/failure, trace context propagation). We add business-specific metrics.

**Method**: `handleEvent(event, context)`

```typescript
import { recordHistogram, Attributes } from '@wallpaperdb/core/telemetry';

async handleEvent(
  event: WallpaperUploadedEvent,
  _context: MessageContext,
): Promise<void> {
  console.log(
    `[WallpaperUploadedConsumer] Processing event ${event.eventId} for wallpaper ${event.wallpaper.id}`,
  );

  try {
    const startTime = Date.now();

    await this.repository.upsert({
      id: event.wallpaper.id,
      storageBucket: event.wallpaper.storageBucket,
      storageKey: event.wallpaper.storageKey,
      mimeType: event.wallpaper.mimeType,
      width: event.wallpaper.width,
      height: event.wallpaper.height,
      fileSizeBytes: event.wallpaper.fileSizeBytes,
    });

    const durationMs = Date.now() - startTime;

    // Record business-specific metric (repository upsert already has db metrics)
    recordHistogram('media.consumer.upsert_duration_ms', durationMs, {
      [Attributes.EVENT_TYPE]: 'wallpaper.uploaded',
    });

    console.log(
      `[WallpaperUploadedConsumer] Successfully processed wallpaper ${event.wallpaper.id}`,
    );
  } catch (error) {
    console.error(
      `[WallpaperUploadedConsumer] Failed to process event ${event.eventId}:`,
      error,
    );
    throw error; // Re-throw for retry logic
  }
}
```

**Metrics Created**:
- `media.consumer.upsert_duration_ms` (histogram) - Labels: `event.type`

**Inherited from BaseEventConsumer** (automatic):
- `events.consumed.total` (counter) - Labels: `event.type`, `status`
- `events.consume_duration_ms` (histogram) - Labels: `event.type`
- `events.validation_errors.total` (counter) - Labels: `event.type`
- Trace context propagation from NATS headers
- Automatic span creation for event processing

**Methods**: `onValidationError()` and `onMaxRetriesExceeded()` already log appropriately. No additional telemetry needed (BaseEventConsumer handles this).

---

## Summary of New Telemetry

### New Attributes (9 total)

Added to `packages/core/src/telemetry/attributes.ts`:

1. `RESIZE_WIDTH` - Target width for resize operation
2. `RESIZE_HEIGHT` - Target height for resize operation
3. `RESIZE_FIT_MODE` - Resize fit mode (contain, cover, fill)
4. `RESIZE_SOURCE` - Source used for resize (original, variant)
5. `VARIANT_ID` - Variant identifier
6. `VARIANT_SELECTION_RESULT` - Selection outcome (hit, miss, no_resize, upscale_avoided)
7. `VARIANT_FALLBACK` - Boolean flag when variant file missing, fell back to original
8. `IMAGE_FORMAT` - Image format (jpeg, png, webp)
9. `IMAGE_QUALITY` - Compression quality setting

### New Metrics (14 total)

**S3 Operations (2 metrics)**:
- `media.s3.operations.total` (counter) - Labels: `operation.name`, `operation.success`, `source`, `fallback`, `error.type`
- `media.s3.get_duration_ms` (histogram) - Labels: `operation.name`, `source`

**Variant Selection (3 metrics)**:
- `media.variant_selection.total` (counter) - Labels: `result` (hit, miss, no_resize, upscale_avoided)
- `media.variant_selection.efficiency_percent` (histogram) - Measures size reduction from using variant
- `media.variant.fallback.total` (counter) - Labels: `wallpaper.id`, `variant.id`

**Resize Operations (2 metrics)**:
- `media.resize.setup_duration_ms` (histogram) - Labels: `resize.fit_mode`, `image.format`
- `media.resize.pipeline.errors` (counter) - Labels: `error_type`

**Database Operations (2 metrics)**:
- `db.queries.total` (counter) - Labels: `table`, `operation`, `found`
- `db.query_duration_ms` (histogram) - Labels: `table`, `operation`

**HTTP Endpoint (4 metrics)**:
- `http.requests.validation_errors` (counter) - Labels: `route`, `error_type`
- `http.requests.not_found` (counter) - Labels: `route`
- `http.wallpaper_retrievals.total` (counter) - Labels: `status`, `resize`, `fit_mode`
- `http.wallpaper_retrieval_duration_ms` (histogram) - Labels: `status`, `resize`

**Event Consumer (1 metric)**:
- `media.consumer.upsert_duration_ms` (histogram) - Labels: `event.type`

### New Spans (8 total)

1. `db.wallpaper.find_by_id` - Database query for wallpaper metadata
2. `db.wallpaper.upsert` - Database upsert for event consumer
3. `db.variant.find_smallest_suitable` - Variant query for selection algorithm
4. `media.variant_selection` - Variant selection logic
5. `media.resize.setup_pipeline` - Sharp pipeline setup (sync)
6. `media.get_wallpaper` - Simple retrieval without resize
7. `media.get_wallpaper_resized` - Complex retrieval with variant selection and optional resize
8. `http.get_wallpaper` - HTTP endpoint handler

**Inherited from BaseEventConsumer** (automatic):
- `events.consume` - Event processing lifecycle

---

## Critical Files to Modify

1. **`packages/core/src/telemetry/attributes.ts`** - Add 9 new attribute constants
2. **`apps/media/src/repositories/wallpaper.repository.ts`** - Add spans and metrics to `findById()` and `upsert()`
3. **`apps/media/src/repositories/variant.repository.ts`** - Add spans and metrics to `findSmallestSuitable()`
4. **`apps/media/src/services/variant-selector.service.ts`** - **MOST CRITICAL** - Add variant selection tracking
5. **`apps/media/src/services/resize.service.ts`** - Add resize pipeline telemetry
6. **`apps/media/src/services/media.service.ts`** - Add S3 operation tracking and fallback metrics
7. **`apps/media/src/routes/media.routes.ts`** - Add HTTP endpoint telemetry
8. **`apps/media/src/services/consumers/wallpaper-uploaded-consumer.service.ts`** - Add business-specific consumer metrics

---

## Testing Strategy

### Manual Testing (Recommended)

**Prerequisites**:
1. Infrastructure running: `make infra-start`
2. Media service running: `make media-dev` (or equivalent)
3. Grafana open: http://localhost:3000
4. Sample wallpaper uploaded via ingestor service

**Test Scenarios**:

#### Test 1: Simple Retrieval (No Resize)

**Request**:
```bash
curl -v http://localhost:3003/wallpapers/wlpr_01234567890ABCDEFGHIJK
```

**Expected Telemetry**:
- Span: `http.get_wallpaper` → `media.get_wallpaper_resized` → `media.variant_selection` → `db.wallpaper.find_by_id` → S3 GetObject
- Metrics:
  - `media.variant_selection.total{result="no_resize"}` = 1
  - `db.queries.total{table="wallpapers",operation="find_by_id",found="true"}` = 1
  - `media.s3.operations.total{operation.name="get_object",operation.success="true",source="original"}` = 1
  - `http.wallpaper_retrievals.total{status="success",resize="false"}` = 1

#### Test 2: Resize with Variant Hit

**Setup**: Ensure variant exists for wallpaper in database

**Request**:
```bash
curl -v "http://localhost:3003/wallpapers/wlpr_01234567890ABCDEFGHIJK?w=1920&h=1080&fit=contain"
```

**Expected Telemetry**:
- Span: `http.get_wallpaper` → `media.get_wallpaper_resized` → `media.variant_selection` → `db.variant.find_smallest_suitable` → `media.resize.setup_pipeline` → S3 GetObject
- Metrics:
  - `media.variant_selection.total{result="hit"}` = 1
  - `media.variant_selection.efficiency_percent` = histogram value (e.g., 50% smaller)
  - `db.queries.total{table="variants",operation="find_smallest_suitable",found="true"}` = 1
  - `media.s3.operations.total{source="variant"}` = 1
  - `media.resize.setup_duration_ms{resize.fit_mode="contain"}` = histogram value
  - `http.wallpaper_retrievals.total{status="success",resize="true",fit_mode="contain"}` = 1

#### Test 3: Resize with Variant Miss

**Setup**: Remove variants from database for test wallpaper

**Request**:
```bash
curl -v "http://localhost:3003/wallpapers/wlpr_01234567890ABCDEFGHIJK?w=800&h=600&fit=cover"
```

**Expected Telemetry**:
- Metrics:
  - `media.variant_selection.total{result="miss"}` = 1
  - `db.queries.total{table="variants",operation="find_smallest_suitable",found="false"}` = 1
  - `media.s3.operations.total{source="original"}` = 1
  - `http.wallpaper_retrievals.total{status="success",resize="true",fit_mode="cover"}` = 1

#### Test 4: Variant Fallback (Variant File Missing from MinIO)

**Setup**: Have variant in DB but delete from MinIO

**Request**:
```bash
curl -v "http://localhost:3003/wallpapers/wlpr_01234567890ABCDEFGHIJK?w=1920&h=1080"
```

**Expected Telemetry**:
- Metrics:
  - `media.variant_selection.total{result="hit"}` = 1 (selected variant)
  - `media.s3.operations.total{source="variant",operation.success="false"}` = 1 (variant fetch failed)
  - `media.variant.fallback.total` = 1
  - `media.s3.operations.total{source="original",fallback="true",operation.success="true"}` = 1 (original fetch succeeded)

#### Test 5: 404 Not Found

**Request**:
```bash
curl -v http://localhost:3003/wallpapers/wlpr_NONEXISTENT
```

**Expected Telemetry**:
- Span: `http.get_wallpaper` with `wallpaper.found=false`, `http.status_code=404`
- Metrics:
  - `http.requests.not_found{route="/wallpapers/:id"}` = 1
  - `http.wallpaper_retrieval_duration_ms{status="not_found"}` = histogram value

#### Test 6: Query Parameter Validation Error

**Request**:
```bash
curl -v "http://localhost:3003/wallpapers/wlpr_01234567890ABCDEFGHIJK?w=99999&h=-100"
```

**Expected Telemetry**:
- Metrics:
  - `http.requests.validation_errors{route="/wallpapers/:id",error_type="query_params"}` = 1

#### Test 7: Event Consumer Processing

**Trigger**: Publish `wallpaper.uploaded` event to NATS (via ingestor upload)

**Expected Telemetry**:
- Span: `events.consume` (from BaseEventConsumer) → `db.wallpaper.upsert`
- Metrics:
  - `events.consumed.total{event.type="wallpaper.uploaded",status="success"}` = 1
  - `media.consumer.upsert_duration_ms` = histogram value
  - `db.queries.total{table="wallpapers",operation="upsert"}` = 1

### Verification in Grafana

**Explore → Tempo (Traces)**:
1. Query: `{service.name="media"}`
2. Filter by operation: `http.get_wallpaper`, `media.variant_selection`, etc.
3. Inspect spans for attributes (wallpaper.id, resize.width, variant.selection.result, etc.)
4. Verify trace context propagation from NATS events (parent span from ingestor)

**Explore → Prometheus (Metrics)**:
1. Query variant hit rate:
   ```promql
   sum by (result) (rate(media_variant_selection_total[5m]))
   ```
2. Query resize performance:
   ```promql
   histogram_quantile(0.95, rate(media_resize_setup_duration_ms_bucket[5m]))
   ```
3. Query S3 operation success rate:
   ```promql
   sum by (operation_success) (rate(media_s3_operations_total[5m]))
   ```
4. Query HTTP endpoint latency:
   ```promql
   histogram_quantile(0.95, rate(http_wallpaper_retrieval_duration_ms_bucket[5m]))
   ```

---

## Business Value Tracking

### Variant Optimization Effectiveness

**Key Metrics**:
- **Variant Hit Rate**: `sum(rate(media_variant_selection_total{result="hit"}[5m])) / sum(rate(media_variant_selection_total[5m]))`
- **Efficiency Percentage**: `histogram_quantile(0.50, rate(media_variant_selection_efficiency_percent_bucket[5m]))`
- **Fallback Rate**: `sum(rate(media_variant_fallback_total[5m]))`

**Interpretation**:
- **High hit rate (>70%)** + **High efficiency (>50%)** = Variant strategy working well
- **High hit rate** + **Low efficiency (<20%)** = Variants too close to original size, wasting storage
- **Low hit rate (<30%)** + **High miss rate** = Need more variant sizes or different algorithm
- **High fallback rate (>5%)** = Storage consistency issues (variants in DB but not MinIO)

### Performance Monitoring

**Key Metrics**:
- **P95 HTTP Latency**: `histogram_quantile(0.95, rate(http_wallpaper_retrieval_duration_ms_bucket[5m]))`
- **P95 Resize Setup Time**: `histogram_quantile(0.95, rate(media_resize_setup_duration_ms_bucket[5m]))`
- **S3 Error Rate**: `sum(rate(media_s3_operations_total{operation_success="false"}[5m])) / sum(rate(media_s3_operations_total[5m]))`

**Alerting Thresholds**:
- P95 HTTP latency > 500ms → Investigate S3 performance or resize optimization
- S3 error rate > 1% → MinIO connectivity or storage issues
- Variant fallback rate > 5% → Database/storage sync problem

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add 9 new attributes to `packages/core/src/telemetry/attributes.ts`
- [ ] Verify attributes exported correctly

### Phase 2: Repository Layer
- [ ] Instrument `WallpaperRepository.findById()`
- [ ] Instrument `WallpaperRepository.upsert()`
- [ ] Instrument `VariantRepository.findSmallestSuitable()`
- [ ] Test database telemetry with simple queries

### Phase 3: Service Layer
- [ ] Instrument `VariantSelectorService.selectSource()` (MOST CRITICAL)
- [ ] Instrument `ResizeService.resizeImage()`
- [ ] Instrument `MediaService.getWallpaper()`
- [ ] Instrument `MediaService.getWallpaperResized()` with fallback logic
- [ ] Test variant selection telemetry (hit/miss scenarios)
- [ ] Test resize telemetry
- [ ] Test S3 operation telemetry

### Phase 4: HTTP Layer
- [ ] Instrument `GET /wallpapers/:id` route handler
- [ ] Test HTTP endpoint telemetry (200, 404, validation errors)
- [ ] Verify end-to-end latency measurement

### Phase 5: Event Consumer
- [ ] Add business-specific metrics to `WallpaperUploadedConsumerService.handleEvent()`
- [ ] Test event consumer telemetry (process sample event)
- [ ] Verify trace context propagation from ingestor

### Phase 6: Testing & Validation
- [ ] Run all 7 manual test scenarios
- [ ] Verify traces in Grafana Tempo
- [ ] Verify metrics in Grafana Prometheus
- [ ] Create monitoring dashboards (optional)
- [ ] Document expected telemetry for each operation

---

## Success Criteria

1. **All operations instrumented**: Every service method has appropriate spans and metrics
2. **Variant hit rate visible**: Can track optimization effectiveness in Grafana
3. **Performance baselines established**: Know P50/P95/P99 latencies for key operations
4. **Error visibility**: Can identify S3 failures, fallback scenarios, validation errors
5. **Distributed tracing works**: Can trace request from ingestor upload → NATS event → media consumer
6. **No performance regression**: Telemetry overhead < 5ms per request
