# Input Validation and Injection Prevention

> **Status:** Planned  
> **Priority:** High  
> **Estimated Effort:** 1 week  
> **Dependencies:** All services  
> **Triggered By:** Security audit findings  

---

## Overview

While the codebase uses Drizzle ORM (which provides SQL injection protection) and has basic validation in some areas, there are gaps in input validation that could lead to security vulnerabilities, edge cases, and poor error messages. This plan systematically addresses input validation across all services.

---

## Current State

### ✅ What's Already Good

1. **Drizzle ORM prevents SQL injection**
   - All database queries use parameterized queries
   - No raw SQL string concatenation

2. **Content-based MIME detection (Ingestor)**
   - Uses `file-type` package to detect actual file type
   - Doesn't trust client-provided `Content-Type`

3. **Filename sanitization (Ingestor)**
   ```typescript
   // apps/ingestor/src/services/file-processor.service.ts:30-33
   sanitizeFilename(filename: string): string {
     return filename
       .replace(/[^a-zA-Z0-9._-]/g, '_')
       .slice(0, 255);
   }
   ```

4. **Sharp decompression bomb protection**
   - Limits input pixels to prevent memory exhaustion

5. **Zod validation on Media resize params**
   ```typescript
   // apps/media/src/routes/media.routes.ts:23-27
   const ResizeQuerySchema = z.object({
     w: z.coerce.number().int().min(1).max(7680).optional(),
     h: z.coerce.number().int().min(1).max(4320).optional(),
     fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
   });
   ```

---

## Current Gaps

### 1. GraphQL Input Validation (Gateway)

**Issue:** GraphQL resolver arguments are not validated with Zod schemas

**Current Code:**
```typescript
// apps/gateway/src/graphql/resolvers.ts:75-80
Query: {
  searchWallpapers: async (_parent: unknown, args: SearchArgs) => {
    return await this.searchWallpapers(args);
  },
  getWallpaper: async (_parent: unknown, args: GetWallpaperArgs) => {
    return await this.getWallpaper(args);
  },
},
```

**Problems:**
- No validation on `args.filter.userId` format
- No validation on `args.filter.variants.*` values
- `aspectRatio` could be negative, zero, or NaN
- `format` field accepts any string (should be enum)
- No bounds checking on pagination params

**Attack Scenarios:**
```graphql
# Negative values
query { searchWallpapers(filter: { variants: { width: -100 } }) }

# Extreme values
query { searchWallpapers(first: 999999999) }

# Invalid aspect ratio
query { searchWallpapers(filter: { variants: { aspectRatio: NaN } }) }

# SQL injection attempt (Drizzle prevents, but unclear error)
query { searchWallpapers(filter: { userId: "'; DROP TABLE wallpapers; --" }) }
```

---

### 2. Wallpaper ID Validation (Gateway & Media)

**Issue:** Only Gateway validates wallpaper ID format, Media doesn't

**Gateway (Good):**
```typescript
// apps/gateway/src/graphql/resolvers.ts:11-18
function validateWallpaperId(wallpaperId: string): void {
  if (!wallpaperId || wallpaperId.trim() === '') {
    throw new Error('wallpaperId cannot be empty');
  }
  if (!wallpaperId.startsWith('wlpr_')) {
    throw new Error('wallpaperId must start with "wlpr_"');
  }
}
```

**Media (Missing):**
```typescript
// apps/media/src/routes/media.routes.ts:39-47
fastify.get<{ Params: WallpaperParams }>(
  '/wallpapers/:id',
  async (request, reply) => {
    const { id } = request.params; // ❌ No validation!
    // ...
  }
);
```

**Attack Scenario:**
```bash
# Path traversal attempt
GET /wallpapers/../../../etc/passwd

# Invalid format
GET /wallpapers/invalid-id  # Should return 400, not 404
```

---

### 3. Storage Key Validation (All Services)

**Issue:** No validation that storage keys match expected patterns before S3 operations

**Current Code:**
```typescript
// apps/media/src/services/media.service.ts
// No validation on storageKey before GetObjectCommand
await this.s3.send(new GetObjectCommand({
  Bucket: wallpaper.storageBucket,
  Key: wallpaper.storageKey, // ❌ No format validation
}));
```

**Attack Scenario (Theoretical):**
```typescript
// If metadata was corrupted/injected
storageKey: "../../sensitive-data/secrets.txt"
```

**Note:** This requires database compromise, but defense-in-depth is important.

---

### 4. Missing Validation on Event Schemas (Consumers)

**Issue:** Event consumers trust NATS event payloads without validation

**Current Code:**
```typescript
// apps/gateway/src/consumers/wallpaper-uploaded.consumer.ts
protected async handleMessage(event: WallpaperUploadedEvent): Promise<void> {
  // ❌ Assumes event.width, event.height are valid numbers
  await this.repository.upsert({
    wallpaperId: event.wallpaperId,
    userId: event.userId,
    variants: [],
    uploadedAt: event.uploadedAt,
    updatedAt: event.uploadedAt,
  });
}
```

**Problems:**
- No validation that `width` / `height` are positive integers
- No validation that `wallpaperId` matches format
- Malformed events could corrupt database

**Attack Scenario:**
```json
{
  "wallpaperId": "invalid",
  "width": -100,
  "height": "not a number"
}
```

---

### 5. Filename Sanitization Too Permissive (Ingestor)

**Issue:** Current regex allows dots and dashes, which can be exploited

**Current Code:**
```typescript
// apps/ingestor/src/services/file-processor.service.ts:31-32
return filename
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .slice(0, 255);
```

**Problems:**
- Allows `../../etc/passwd` → becomes `.._.._etc_passwd` (still suspicious)
- Allows `.htaccess`, `.env` (hidden files)
- No extension validation

**Better Approach:**
```typescript
sanitizeFilename(filename: string): string {
  // Remove path separators completely
  const basename = filename.replace(/[\/\\]/g, '');
  
  // Extract extension (validated separately)
  const lastDot = basename.lastIndexOf('.');
  const name = lastDot > 0 ? basename.substring(0, lastDot) : basename;
  const ext = lastDot > 0 ? basename.substring(lastDot) : '';
  
  // Sanitize name part (alphanumeric, underscore, hyphen only)
  const safeName = name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^\.+/, '') // Remove leading dots
    .slice(0, 200); // Leave room for extension
  
  // Validate extension against allowlist
  const safeExt = this.validateExtension(ext);
  
  return `${safeName}${safeExt}`;
}

private validateExtension(ext: string): string {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm'];
  const normalized = ext.toLowerCase();
  
  if (!allowedExtensions.includes(normalized)) {
    return '.bin'; // Default safe extension
  }
  
  return normalized;
}
```

---

## Solution Design

### 1. GraphQL Input Validation (Gateway)

**Implementation:** Add Zod validation to all resolver arguments

```typescript
// apps/gateway/src/graphql/validation.ts

import { z } from 'zod';

// Shared validators
const WallpaperIdSchema = z.string()
  .regex(/^wlpr_[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid wallpaper ID format (must be wlpr_ + ULID)');

const UserIdSchema = z.string()
  .min(1)
  .max(255);

const VariantFilterSchema = z.object({
  width: z.number().int().positive().max(7680).optional(),
  height: z.number().int().positive().max(4320).optional(),
  aspectRatio: z.number().positive().finite().optional(),
  format: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
}).optional();

const WallpaperFilterSchema = z.object({
  userId: UserIdSchema.optional(),
  variants: VariantFilterSchema,
}).optional();

// Pagination (cursor-based)
const PaginationSchema = z.object({
  first: z.number().int().positive().max(100).optional(),
  after: z.string().optional(),
  last: z.number().int().positive().max(100).optional(),
  before: z.string().optional(),
}).refine(
  (data) => !(data.first && data.last),
  'Cannot specify both first and last'
);

// Query argument schemas
export const SearchWallpapersArgsSchema = z.object({
  filter: WallpaperFilterSchema,
}).merge(PaginationSchema);

export const GetWallpaperArgsSchema = z.object({
  wallpaperId: WallpaperIdSchema,
});
```

**Resolver Integration:**
```typescript
// apps/gateway/src/graphql/resolvers.ts

import { SearchWallpapersArgsSchema, GetWallpaperArgsSchema } from './validation.js';

Query: {
  searchWallpapers: async (_parent: unknown, args: unknown) => {
    // Validate and parse
    const validatedArgs = SearchWallpapersArgsSchema.parse(args);
    return await this.searchWallpapers(validatedArgs);
  },
  
  getWallpaper: async (_parent: unknown, args: unknown) => {
    const validatedArgs = GetWallpaperArgsSchema.parse(args);
    return await this.getWallpaper(validatedArgs);
  },
},
```

**Error Handling:**
```typescript
// apps/gateway/src/app.ts

import { ZodError } from 'zod';

// Mercurius error formatter
await fastify.register(mercurius, {
  // ...
  errorFormatter: (error, context) => {
    // Handle Zod validation errors
    if (error.originalError instanceof ZodError) {
      return {
        statusCode: 400,
        response: {
          errors: error.originalError.errors.map((e) => ({
            message: `Validation error: ${e.path.join('.')}: ${e.message}`,
            extensions: {
              code: 'VALIDATION_ERROR',
              field: e.path.join('.'),
            },
          })),
        },
      };
    }
    
    // Default error formatting
    return mercurius.defaultErrorFormatter(error, context);
  },
});
```

---

### 2. Wallpaper ID Validation (Shared)

**Implementation:** Move validation to shared package

```typescript
// packages/core/src/validation/wallpaper-id.ts

import { z } from 'zod';

/**
 * Wallpaper ID format: wlpr_<ULID>
 * ULID: 26 characters, base32-encoded (Crockford alphabet)
 */
export const WallpaperIdSchema = z.string()
  .regex(
    /^wlpr_[0-9A-HJKMNP-TV-Z]{26}$/,
    'Invalid wallpaper ID format (expected: wlpr_<ULID>)'
  );

export function validateWallpaperId(id: string): void {
  WallpaperIdSchema.parse(id);
}

export function isValidWallpaperId(id: string): boolean {
  return WallpaperIdSchema.safeParse(id).success;
}
```

**Usage in Media Service:**
```typescript
// apps/media/src/routes/media.routes.ts

import { WallpaperIdSchema } from '@wallpaperdb/core/validation';

const ParamsSchema = z.object({
  id: WallpaperIdSchema,
});

fastify.get<{ Params: WallpaperParams }>(
  '/wallpapers/:id',
  async (request, reply) => {
    try {
      const { id } = ParamsSchema.parse(request.params);
      // ... rest of handler
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          type: 'https://wallpaperdb.dev/problems/invalid-id',
          title: 'Invalid Wallpaper ID',
          status: 400,
          detail: error.errors[0].message,
          instance: request.url,
        });
      }
      throw error;
    }
  }
);
```

---

### 3. Storage Key Validation

**Implementation:** Validate storage keys before S3 operations

```typescript
// packages/core/src/validation/storage-key.ts

import { z } from 'zod';

/**
 * Storage key format: wlpr_<ULID>/{original|variant}.<ext>
 * Examples:
 *   - wlpr_01ABC.../original.jpg
 *   - wlpr_01ABC.../720p.webp
 */
export const StorageKeySchema = z.string()
  .regex(
    /^wlpr_[0-9A-HJKMNP-TV-Z]{26}\/(original|[0-9]+p)\.(jpg|jpeg|png|webp|mp4|webm)$/,
    'Invalid storage key format'
  )
  .refine(
    (key) => !key.includes('..'), // Path traversal check
    'Storage key cannot contain path traversal'
  )
  .refine(
    (key) => !key.includes('//'), // Double slash check
    'Storage key cannot contain double slashes'
  );

export function validateStorageKey(key: string): void {
  StorageKeySchema.parse(key);
}
```

**Usage in Media Service:**
```typescript
// apps/media/src/services/media.service.ts

import { validateStorageKey } from '@wallpaperdb/core/validation';

async getWallpaper(id: string): Promise<WallpaperResponse | null> {
  const wallpaper = await this.repository.findById(id);
  if (!wallpaper) return null;
  
  // Validate storage key before S3 operation
  try {
    validateStorageKey(wallpaper.storageKey);
  } catch (error) {
    this.logger.error('Invalid storage key in database', {
      wallpaperId: id,
      storageKey: wallpaper.storageKey,
    });
    throw new Error('Corrupted wallpaper metadata');
  }
  
  // Safe to fetch from S3
  const stream = await this.s3.send(new GetObjectCommand({
    Bucket: wallpaper.storageBucket,
    Key: wallpaper.storageKey,
  }));
  
  return { stream, mimeType: wallpaper.mimeType };
}
```

---

### 4. Event Schema Validation (Consumers)

**Implementation:** Validate events before processing

```typescript
// packages/events/src/schemas/wallpaper-uploaded.schema.ts

import { z } from 'zod';
import { WallpaperIdSchema } from '@wallpaperdb/core/validation';

export const WallpaperUploadedEventSchema = z.object({
  wallpaperId: WallpaperIdSchema,
  userId: z.string().min(1).max(255),
  storageKey: z.string().min(1),
  storageBucket: z.string().min(1),
  mimeType: z.string().regex(/^(image|video)\/(jpeg|png|webp|mp4|webm)$/),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  fileSizeBytes: z.number().int().positive(),
  uploadedAt: z.string().datetime(),
});

export type WallpaperUploadedEvent = z.infer<typeof WallpaperUploadedEventSchema>;
```

**Consumer Integration:**
```typescript
// apps/gateway/src/consumers/wallpaper-uploaded.consumer.ts

import { WallpaperUploadedEventSchema } from '@wallpaperdb/events';

export class WallpaperUploadedConsumer extends BaseEventConsumer<WallpaperUploadedEvent> {
  protected async handleMessage(rawEvent: unknown): Promise<void> {
    // Validate event
    let event: WallpaperUploadedEvent;
    try {
      event = WallpaperUploadedEventSchema.parse(rawEvent);
    } catch (error) {
      this.logger.error('Invalid event schema', {
        error,
        rawEvent,
      });
      // Acknowledge to prevent redelivery of malformed events
      return;
    }
    
    // Process validated event
    await this.repository.upsert({
      wallpaperId: event.wallpaperId,
      userId: event.userId,
      variants: [],
      uploadedAt: event.uploadedAt,
      updatedAt: event.uploadedAt,
    });
  }
}
```

---

### 5. Enhanced Filename Sanitization (Ingestor)

**Implementation:** Stricter filename sanitization

```typescript
// apps/ingestor/src/services/file-processor.service.ts

private readonly ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm'
]);

sanitizeFilename(filename: string): string {
  // Remove all path separators
  const noPath = filename.replace(/[\/\\]/g, '');
  
  // Split into name and extension
  const lastDot = noPath.lastIndexOf('.');
  const name = lastDot > 0 ? noPath.substring(0, lastDot) : noPath;
  const ext = lastDot > 0 ? noPath.substring(lastDot) : '';
  
  // Sanitize name: alphanumeric, underscore, hyphen only
  const safeName = name
    .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace special chars
    .replace(/^[._-]+/, '')          // Remove leading dots/underscores
    .replace(/[._-]+$/, '')          // Remove trailing dots/underscores
    .slice(0, 200);                  // Limit length
  
  // Validate and normalize extension
  const normalizedExt = ext.toLowerCase();
  const safeExt = this.ALLOWED_EXTENSIONS.has(normalizedExt) 
    ? normalizedExt 
    : '.bin'; // Default extension for unknown types
  
  return `${safeName || 'upload'}${safeExt}`;
}
```

---

## Implementation Phases

### Phase 1: Shared Validation Utilities (Day 1-2)

**Tasks:**
1. Create `packages/core/src/validation/` directory
2. Implement `WallpaperIdSchema`
3. Implement `StorageKeySchema`
4. Implement `UserIdSchema`
5. Write unit tests for all schemas
6. Export from `@wallpaperdb/core/validation`

**Acceptance Criteria:**
- [ ] All validation schemas pass unit tests
- [ ] Invalid inputs are rejected with clear error messages
- [ ] Valid inputs pass validation

---

### Phase 2: GraphQL Input Validation (Day 3-4)

**Tasks:**
1. Create `apps/gateway/src/graphql/validation.ts`
2. Define all query argument schemas
3. Update resolvers to validate arguments
4. Add error formatter for Zod errors
5. Write integration tests
6. Update GraphQL schema docs

**Acceptance Criteria:**
- [ ] All GraphQL arguments are validated
- [ ] Invalid inputs return 400 with clear errors
- [ ] Error format follows GraphQL spec
- [ ] Tests verify all validation rules

---

### Phase 3: Event Schema Validation (Day 5)

**Tasks:**
1. Add Zod validation to all event schemas
2. Update all consumers to validate events
3. Log malformed events without redelivery
4. Add telemetry for validation failures
5. Write tests for malformed events

**Acceptance Criteria:**
- [ ] All event consumers validate payloads
- [ ] Malformed events are logged and acknowledged
- [ ] Metrics track validation failure rate

---

### Phase 4: Media Service Validation (Day 6)

**Tasks:**
1. Add wallpaper ID validation to params
2. Add storage key validation before S3 operations
3. Update error responses to RFC 7807 format
4. Write integration tests
5. Add telemetry for validation failures

**Acceptance Criteria:**
- [ ] Invalid wallpaper IDs return 400 (not 404)
- [ ] Corrupted storage keys throw clear errors
- [ ] All validation has corresponding tests

---

### Phase 5: Enhanced Filename Sanitization (Day 7)

**Tasks:**
1. Update filename sanitization in Ingestor
2. Add extension allowlist validation
3. Add tests for edge cases (path traversal, hidden files)
4. Update documentation

**Acceptance Criteria:**
- [ ] Path separators are completely removed
- [ ] Hidden files (leading dots) are rejected
- [ ] Only allowed extensions are preserved
- [ ] Tests verify all edge cases

---

## Testing Strategy

### Unit Tests

```typescript
// packages/core/test/validation/wallpaper-id.test.ts

describe('WallpaperIdSchema', () => {
  it('should accept valid wallpaper IDs', () => {
    const validIds = [
      'wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      'wlpr_01H0000000000000000000000',
    ];
    
    for (const id of validIds) {
      expect(() => validateWallpaperId(id)).not.toThrow();
    }
  });
  
  it('should reject invalid wallpaper IDs', () => {
    const invalidIds = [
      'invalid',
      'wlpr_',
      'wlpr_toolong12345678901234567890',
      'wlpr_short',
      'wrong_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      '../wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    ];
    
    for (const id of invalidIds) {
      expect(() => validateWallpaperId(id)).toThrow();
    }
  });
});

// packages/core/test/validation/storage-key.test.ts

describe('StorageKeySchema', () => {
  it('should accept valid storage keys', () => {
    const validKeys = [
      'wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV/original.jpg',
      'wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV/720p.webp',
      'wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV/1080p.mp4',
    ];
    
    for (const key of validKeys) {
      expect(() => validateStorageKey(key)).not.toThrow();
    }
  });
  
  it('should reject path traversal attempts', () => {
    const maliciousKeys = [
      'wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV/../../../etc/passwd',
      'wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV//original.jpg',
      '../wlpr_01ARZ3NDEKTSV4RRFFQ69G5FAV/original.jpg',
    ];
    
    for (const key of maliciousKeys) {
      expect(() => validateStorageKey(key)).toThrow();
    }
  });
});
```

### Integration Tests

```typescript
// apps/gateway/test/integration/graphql-validation.test.ts

describe('GraphQL Input Validation', () => {
  it('should reject invalid pagination params', async () => {
    const query = `
      query {
        searchWallpapers(first: 9999999) {
          edges { node { wallpaperId } }
        }
      }
    `;
    
    const response = await tester.graphql(query);
    expect(response.status).toBe(400);
    expect(response.body.errors[0].message).toContain('first');
  });
  
  it('should reject invalid variant filters', async () => {
    const query = `
      query {
        searchWallpapers(filter: { variants: { width: -100 } }) {
          edges { node { wallpaperId } }
        }
      }
    `;
    
    const response = await tester.graphql(query);
    expect(response.status).toBe(400);
    expect(response.body.errors[0].message).toContain('width');
  });
  
  it('should reject malformed wallpaper IDs', async () => {
    const query = `
      query {
        getWallpaper(wallpaperId: "invalid-id") {
          wallpaperId
        }
      }
    `;
    
    const response = await tester.graphql(query);
    expect(response.status).toBe(400);
    expect(response.body.errors[0].extensions.code).toBe('VALIDATION_ERROR');
  });
});

// apps/media/test/integration/validation.test.ts

describe('Media Service Validation', () => {
  it('should return 400 for invalid wallpaper ID format', async () => {
    const response = await tester.get('/wallpapers/invalid-id');
    
    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Invalid Wallpaper ID');
  });
  
  it('should return 400 for path traversal attempt', async () => {
    const response = await tester.get('/wallpapers/../../../etc/passwd');
    
    expect(response.status).toBe(400);
  });
});
```

---

## Telemetry

### Metrics to Add

```typescript
// Validation failures
recordCounter('validation.failures', 1, {
  service: 'gateway',
  validator: 'WallpaperIdSchema',
  field: 'wallpaperId',
});

// Invalid events
recordCounter('event.validation_failures', 1, {
  eventType: 'wallpaper.uploaded',
  consumer: 'gateway',
});

// Storage key validation failures
recordCounter('storage.invalid_key', 1, {
  service: 'media',
  wallpaperId: id,
});
```

---

## Success Criteria

- [ ] All GraphQL inputs validated with Zod
- [ ] All event payloads validated before processing
- [ ] Wallpaper ID validation shared across services
- [ ] Storage keys validated before S3 operations
- [ ] Enhanced filename sanitization prevents exploits
- [ ] Clear, actionable error messages for all validation failures
- [ ] Zero false positives (legitimate inputs accepted)
- [ ] All integration tests pass
- [ ] Telemetry tracks validation failure rates

---

## Files to Create/Modify

### New Files

```
packages/core/src/validation/
├── index.ts                    # Export all validators
├── wallpaper-id.ts             # Wallpaper ID validation
├── storage-key.ts              # Storage key validation
└── user-id.ts                  # User ID validation

packages/core/test/validation/
├── wallpaper-id.test.ts
├── storage-key.test.ts
└── user-id.test.ts

apps/gateway/src/graphql/
└── validation.ts               # GraphQL argument schemas

apps/gateway/test/integration/
└── graphql-validation.test.ts

apps/media/test/integration/
└── validation.test.ts
```

### Modified Files

```
packages/events/src/schemas/
├── wallpaper-uploaded.schema.ts    # Add Zod validation
└── wallpaper-variant-available.schema.ts

apps/gateway/src/graphql/
└── resolvers.ts                    # Use validated args

apps/gateway/src/consumers/
├── wallpaper-uploaded.consumer.ts  # Validate events
└── wallpaper-variant-available.consumer.ts

apps/media/src/routes/
└── media.routes.ts                 # Validate params

apps/media/src/services/
└── media.service.ts                # Validate storage keys

apps/ingestor/src/services/
└── file-processor.service.ts       # Enhanced sanitization
```

---

## Dependencies

No new dependencies required (Zod already in use).

---

## Related Plans

- [GraphQL Security Hardening](./graphql-security-hardening.md)
- [Monitoring and Alerting Improvements](./monitoring-alerting-improvements.md)

---

## References

- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [Zod Documentation](https://zod.dev)
- [ULID Specification](https://github.com/ulid/spec)
