# Variant Generator Service Implementation Plan

**Status:** Planned
**Created:** 2025-12-14

---

## Overview

Create a new standalone service (`apps/variant-generator`) that generates lower resolution variants of wallpapers. The service consumes `wallpaper.uploaded` NATS events, generates variants at configurable resolutions while preserving aspect ratio and format, uploads them to MinIO, and publishes `wallpaper.variant.uploaded` events. The media service consumes these events to populate its variants table.

## User Requirements Summary

- **Architecture**: New standalone service (stateless, no database)
- **Trigger**: On upload via NATS events, but designed for future HTTP endpoint
- **Resolutions**: Configurable via config (no DB), includes standard, ultrawide, and phone sizes
- **Format**: Preserve original (PNG stays PNG, JPEG stays JPEG)
- **Aspect Ratio Matching**: Only generate presets that match the wallpaper's aspect ratio category

---

## Event Flow

```
Ingestor                    Variant Generator              Media Service
   │                              │                              │
   │  wallpaper.uploaded          │                              │
   ├─────────────────────────────>│                              │
   │                              │                              │
   │                              │ (generate variants)          │
   │                              │ (upload to MinIO)            │
   │                              │                              │
   │                              │  wallpaper.variant.uploaded  │
   │                              ├─────────────────────────────>│
   │                              │                              │
   │                              │                    (insert into variants table)
   │                              │                    (publish wallpaper.variant.available)
```

---

## Service Structure

```
apps/variant-generator/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── biome.json
├── esbuild.config.ts
├── Dockerfile
├── .env.example
├── src/
│   ├── index.ts                 # Entry point
│   ├── app.ts                   # Fastify app factory
│   ├── config.ts                # Config with resolution presets
│   ├── otel-init.ts
│   ├── connections/
│   │   ├── minio.ts             # Upload variants
│   │   └── nats.ts              # Consume/publish events
│   ├── services/
│   │   ├── consumers/
│   │   │   └── wallpaper-uploaded-consumer.service.ts
│   │   ├── publishers/
│   │   │   └── wallpaper-variant-uploaded.publisher.ts
│   │   ├── variant-generator.service.ts  # Core logic
│   │   ├── resolution-matcher.service.ts # Aspect ratio matching
│   │   ├── events.service.ts
│   │   └── health.service.ts
│   ├── routes/
│   │   ├── index.ts
│   │   └── health.routes.ts
│   └── errors/problem-details.ts
└── test/
    ├── builders/
    ├── integration/
    └── fixtures/images/

packages/events/src/schemas/
└── wallpaper-variant-uploaded.ts  # NEW EVENT SCHEMA
```

---

## Key Design Decisions

### 1. Stateless Architecture (No Database)

- Variant-generator has **no database connection**
- Uploads variants directly to MinIO
- Publishes `wallpaper.variant.uploaded` event with all metadata
- Media service consumes event and manages its own variants table
- This keeps variant-generator simple and horizontally scalable

### 2. New Event Schema: `wallpaper.variant.uploaded`

```typescript
// packages/events/src/schemas/wallpaper-variant-uploaded.ts
export const WallpaperVariantUploadedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("wallpaper.variant.uploaded"),
  timestamp: z.string().datetime(),

  variant: z.object({
    wallpaperId: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.number().positive(),
    format: z.enum(["image/jpeg", "image/png", "image/webp"]),
    fileSizeBytes: z.number().int().positive(),
    storageKey: z.string().min(1),
    storageBucket: z.string().min(1),
    createdAt: z.string().datetime(),
  }),
});
```

### 3. Resolution Presets by Aspect Ratio Category

```typescript
// Aspect ratio categories with tolerance
const ASPECT_RATIO_CATEGORIES = {
  ultrawide: { ratio: 21/9, tolerance: 0.1 },   // 2.33 ± 0.1 (21:9, 32:9)
  standard: { ratio: 16/9, tolerance: 0.15 },   // 1.78 ± 0.15 (16:9, 16:10)
  phone: { ratio: 9/16, tolerance: 0.15 },      // 0.5625 ± 0.15 (9:16, 9:19.5, 9:21)
};

// Resolution presets grouped by category
const resolutionPresets = {
  // Standard (16:9) - monitors and TVs
  standard: [
    { width: 3840, height: 2160, label: '4K' },
    { width: 2560, height: 1440, label: '2K/1440p' },
    { width: 1920, height: 1080, label: '1080p' },
    { width: 1600, height: 900, label: '900p' },
    { width: 1280, height: 720, label: '720p' },
    { width: 854, height: 480, label: '480p' },
    { width: 640, height: 360, label: '360p' },
  ],

  // Ultrawide (21:9) - gaming monitors
  ultrawide: [
    { width: 5120, height: 2160, label: '5K Ultrawide' },
    { width: 3440, height: 1440, label: 'UWQHD' },
    { width: 2560, height: 1080, label: 'UWFHD' },
  ],

  // Phone (9:16 and taller) - mobile devices
  phone: [
    { width: 1440, height: 3200, label: 'QHD+ Phone' },
    { width: 1080, height: 2400, label: 'FHD+ Phone' },
    { width: 1080, height: 1920, label: 'FHD Phone' },
    { width: 720, height: 1280, label: 'HD Phone' },
    { width: 480, height: 854, label: 'SD Phone' },
  ],
};
```

### 4. Aspect Ratio Matching Logic

```typescript
function matchAspectRatioCategory(width: number, height: number): string | null {
  const aspectRatio = width / height;

  for (const [category, config] of Object.entries(ASPECT_RATIO_CATEGORIES)) {
    if (Math.abs(aspectRatio - config.ratio) <= config.tolerance) {
      return category;
    }
  }
  return null; // No matching category
}

function getApplicablePresets(origWidth: number, origHeight: number): Resolution[] {
  const category = matchAspectRatioCategory(origWidth, origHeight);
  if (!category) return []; // Non-standard aspect ratio, no variants

  const presets = resolutionPresets[category];
  // Filter to presets smaller than original
  return presets.filter(p => p.width < origWidth && p.height < origHeight);
}
```

**Examples:**
- 4K standard (3840x2160, 16:9) → generates 2K, 1080p, 900p, 720p, 480p, 360p
- UWQHD (3440x1440, 21:9) → generates UWFHD only
- Phone (1080x2400, 9:20) → generates FHD Phone, HD Phone, SD Phone

### 5. Storage Path

`{wallpaperId}/variant_{width}x{height}.{ext}`

Example: `wlpr_01ABC/variant_1920x1080.jpg`

---

## Implementation Steps

### Phase 1: Event Schema (packages/events)

1. Create `packages/events/src/schemas/wallpaper-variant-uploaded.ts`
   - Define `WallpaperVariantUploadedEventSchema` with Zod
   - Export `WALLPAPER_VARIANT_UPLOADED_SUBJECT`
2. Update `packages/events/src/schemas/index.ts` to export new schema

### Phase 2: Project Setup (apps/variant-generator)

3. Create `apps/variant-generator/` directory structure
4. Create `package.json` with dependencies (sharp, nats, tsyringe, fastify) - **NO drizzle-orm**
5. Create config files (tsconfig.json, vitest.config.ts, biome.json, esbuild.config.ts)
6. Add Makefile targets (variant-generator-dev, variant-generator-build, etc.)

### Phase 3: Core Infrastructure

7. Create connection wrappers extending @wallpaperdb/core
   - `connections/minio.ts` - for uploading variants
   - `connections/nats.ts` - for consuming/publishing events
   - **NO database connection**
8. Create `config.ts` with:
   - Resolution presets by aspect ratio category
   - Quality settings (jpeg, webp, png)
   - Aspect ratio tolerance settings
9. Create `otel-init.ts`

### Phase 4: Business Logic

10. Create `services/resolution-matcher.service.ts`
    - `matchAspectRatioCategory(width, height)` - returns category or null
    - `getApplicablePresets(width, height)` - returns filtered presets
11. Create `services/variant-generator.service.ts`
    - `generateVariants(wallpaper)` - main orchestration
    - `generateSingleVariant()` - resize, encode, upload, publish event
    - Uses Sharp streaming for memory efficiency
12. Create `services/publishers/wallpaper-variant-uploaded.publisher.ts`
13. Create `services/events.service.ts` wrapper

### Phase 5: Event Consumer

14. Create `services/consumers/wallpaper-uploaded-consumer.service.ts`
    - Durable name: `variant-generator-wallpaper-uploaded-consumer`
    - Filter to images only (skip videos)
    - Longer ack wait (120s) for heavy processing

### Phase 6: App Assembly

15. Create `app.ts` following media service pattern (simpler, no DB)
16. Create `index.ts` entry point
17. Create health routes (`/health`, `/ready`)

### Phase 7: Testing

18. Create test builders (InProcessVariantGeneratorBuilder, MinioBuilder, NatsBuilder)
19. Create integration tests:
    - Standard (16:9) variant generation
    - Ultrawide (21:9) variant generation
    - Phone (9:16+) variant generation
    - Skip non-matching aspect ratios
    - Skip variants larger than original
    - Format preservation (PNG transparency)
    - Event publishing verification

### Phase 8: Media Service Updates

20. Create `apps/media/src/services/consumers/wallpaper-variant-uploaded-consumer.service.ts`
    - Consume `wallpaper.variant.uploaded` events
    - Insert into `variants` table
    - Publish `wallpaper.variant.available` event

### Phase 9: Infrastructure

21. Add to Makefile
22. Create Dockerfile
23. Update documentation

---

## Critical Files to Reference

| File | Purpose |
|------|---------|
| `apps/media/src/app.ts` | Service app factory pattern |
| `apps/media/src/config.ts` | Config composition pattern |
| `apps/media/src/services/resize.service.ts` | Sharp streaming patterns |
| `apps/media/src/services/consumers/wallpaper-uploaded-consumer.service.ts` | Consumer pattern |
| `packages/events/src/schemas/wallpaper-uploaded.ts` | Event to consume |
| `packages/events/src/schemas/wallpaper-variant-available.ts` | Reference for new event schema |

---

## Files to Create/Modify

### New Files

| Path | Description |
|------|-------------|
| `packages/events/src/schemas/wallpaper-variant-uploaded.ts` | New event schema |
| `apps/variant-generator/` (entire directory) | New service |
| `apps/media/src/services/consumers/wallpaper-variant-uploaded-consumer.service.ts` | New consumer in media |

### Modified Files

| Path | Description |
|------|-------------|
| `packages/events/src/schemas/index.ts` | Export new schema |
| `apps/media/src/app.ts` | Register new consumer |
| `Makefile` | Add variant-generator targets |

---

## Environment Variables

```bash
PORT=3004
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=wallpapers
NATS_URL=nats://localhost:4222
NATS_STREAM=WALLPAPER
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=variant-generator

# Quality settings (optional, has defaults)
JPEG_QUALITY=90
WEBP_QUALITY=90
PNG_COMPRESSION_LEVEL=6
```

**Note:** No `DATABASE_URL` - this service is stateless.

---

## Future HTTP Endpoint (Not in Initial Scope)

When needed, add `POST /generate` endpoint for on-demand generation:

```typescript
// Body: { wallpaperId: string, storageBucket: string, storageKey: string, ... }
// Returns: 202 Accepted
```
