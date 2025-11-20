# Shared Packages Migration Plan

**Status:** Planning
**Parent Plan:** [Multi-Service Architecture](./multi-service-architecture.md)
**Estimated Duration:** 2 weeks
**Prerequisites:** None (this is Phase 0)

---

## Overview

Extract reusable infrastructure patterns from `apps/ingestor` into shared packages that can be used by all services.

**Critical Principle:** INCREMENTAL migration. Extract one component at a time, test after each extraction, never big-bang refactoring.

---

## Package Structure

```
packages/
├── core/                          # @wallpaperdb/core
│   ├── src/
│   │   ├── connections/
│   │   │   ├── base/
│   │   │   │   └── base-connection.ts
│   │   │   ├── database.connection.ts
│   │   │   ├── minio.connection.ts
│   │   │   ├── nats.connection.ts
│   │   │   ├── redis.connection.ts
│   │   │   └── otel.connection.ts
│   │   ├── errors/
│   │   │   ├── problem-details.ts
│   │   │   └── application/
│   │   │       └── *.error.ts
│   │   ├── telemetry/
│   │   │   ├── index.ts           # withSpan, recordMetric helpers
│   │   │   ├── metrics.ts         # Pre-defined metrics
│   │   │   └── attributes.ts      # Attribute constants
│   │   ├── config/
│   │   │   └── base-config.ts     # Common config patterns
│   │   └── health/
│   │       └── health-check.ts    # Health check utilities
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
└── events/                        # @wallpaperdb/events
    ├── src/
    │   ├── schemas/
    │   │   ├── wallpaper-uploaded.schema.ts
    │   │   └── *.schema.ts
    │   ├── consumer/
    │   │   └── base-event-consumer.ts
    │   └── publisher/
    │       └── base-event-publisher.ts
    ├── package.json
    ├── tsconfig.json
    └── vitest.config.ts
```

---

## Extraction Order

Extract in this order to minimize dependencies and risk:

### Week 1: Core Infrastructure

1. **BaseConnection** (Day 1)
2. **Database Connection** (Day 1)
3. **MinIO Connection** (Day 2)
4. **NATS Connection** (Day 2)
5. **Redis Connection** (Day 3)
6. **OTEL Connection** (Day 3)
7. **RFC 7807 Errors** (Day 4)
8. **Telemetry Module** (Day 4-5)

### Week 2: Events & Polish

9. **Event Schemas** (Day 6)
10. **Event Consumer/Publisher** (Day 7)
11. **Config Patterns** (Day 8)
12. **Health Utilities** (Day 8)
13. **Documentation** (Day 9)
14. **Final Validation** (Day 10)

---

## Detailed Migration Steps

### Step 1: BaseConnection (Day 1 Morning)

**Goal:** Extract abstract base class for all connections

#### 1.1 Create Package Structure

```bash
# DO NOT use pnpm create yet - manual creation for first package
mkdir -p packages/core/src/connections/base
mkdir -p packages/core/test
```

#### 1.2 Create package.json

**File:** `packages/core/package.json`

```json
{
  "name": "@wallpaperdb/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./connections": "./src/connections/index.ts",
    "./connections/base": "./src/connections/base/base-connection.ts",
    "./errors": "./src/errors/index.ts"
  },
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "build": "tsc",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  },
  "dependencies": {
    "tsyringe": "^4.8.0"
  }
}
```

#### 1.3 Create tsconfig.json

**File:** `packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

#### 1.4 Copy BaseConnection

**File:** `packages/core/src/connections/base/base-connection.ts`

```typescript
// Copy from apps/ingestor/src/connections/base/base-connection.ts
// NO CHANGES to the code yet - exact copy
```

#### 1.5 Write Tests

**File:** `packages/core/test/base-connection.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { BaseConnection } from '../src/connections/base/base-connection';

class TestConnection extends BaseConnection<string> {
  protected async createClient(): Promise<string> {
    return 'test-client';
  }

  protected async closeClient(): Promise<void> {
    // cleanup
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }
}

describe('BaseConnection', () => {
  let connection: TestConnection;

  beforeEach(() => {
    connection = new TestConnection();
  });

  it('should initialize client on first access', async () => {
    const client = await connection.getClient();
    expect(client).toBe('test-client');
  });

  it('should return same client on subsequent calls', async () => {
    const client1 = await connection.getClient();
    const client2 = await connection.getClient();
    expect(client1).toBe(client2);
  });

  it('should report healthy', async () => {
    const health = await connection.checkHealth();
    expect(health).toBe(true);
  });

  // Add more tests...
});
```

#### 1.6 Run Tests

```bash
cd packages/core
pnpm install
pnpm test
```

✅ **Checkpoint:** Tests pass for BaseConnection in package

#### 1.7 Update Ingestor to Use Package

**File:** `apps/ingestor/package.json`

```json
{
  "dependencies": {
    "@wallpaperdb/core": "workspace:*"
  }
}
```

**File:** `apps/ingestor/src/connections/database.ts`

```typescript
// Change import
- import { BaseConnection } from './base/base-connection.js';
+ import { BaseConnection } from '@wallpaperdb/core/connections/base';

// Rest of file unchanged
```

#### 1.8 Run Ingestor Tests

```bash
make ingestor-test
```

✅ **Checkpoint:** All ingestor tests still pass

#### 1.9 Commit

```bash
git add packages/core apps/ingestor/package.json apps/ingestor/src/connections/database.ts
git commit -m "refactor: extract BaseConnection to @wallpaperdb/core

- Create @wallpaperdb/core package
- Extract BaseConnection with tests
- Update DatabaseConnection to use package
- All tests passing"
```

---

### Step 2: Database Connection (Day 1 Afternoon)

**Goal:** Extract full DatabaseConnection to package

#### 2.1 Copy DatabaseConnection

**File:** `packages/core/src/connections/database.connection.ts`

```typescript
// Copy from apps/ingestor/src/connections/database.ts
// Update imports to use relative paths
import { BaseConnection } from './base/base-connection.js';

// Add necessary dependencies to package.json:
// - drizzle-orm
// - pg
// - zod (for config types)
```

#### 2.2 Extract Config Type

**File:** `packages/core/src/connections/types.ts`

```typescript
export interface DatabaseConfig {
  databaseUrl: string;
}

export interface MinioConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
}

// etc...
```

#### 2.3 Update DatabaseConnection

```typescript
import type { DatabaseConfig } from './types.js';

export class DatabaseConnection extends BaseConnection<DbType> {
  constructor(private config: DatabaseConfig) {
    super();
  }
  // ...
}
```

#### 2.4 Write Tests

**File:** `packages/core/test/database-connection.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { DatabaseConnection } from '../src/connections/database.connection';

describe('DatabaseConnection', () => {
  it('should create connection pool', async () => {
    const conn = new DatabaseConnection({
      databaseUrl: 'postgresql://test:test@localhost:5432/test'
    });

    const client = await conn.getClient();
    expect(client).toBeDefined();
    expect(client.db).toBeDefined();
  });

  // More tests...
});
```

#### 2.5 Update Ingestor

**File:** `apps/ingestor/src/connections/database.ts`

DELETE THIS FILE (or keep temporarily for reference)

**File:** `apps/ingestor/src/app.ts`

```typescript
// Change import
- import { DatabaseConnection } from './connections/database.js';
+ import { DatabaseConnection } from '@wallpaperdb/core/connections';
```

#### 2.6 Run Tests

```bash
make test-packages  # New package tests
make ingestor-test  # Ingestor still works
```

✅ **Checkpoint:** All tests pass

#### 2.7 Commit

```bash
git add .
git commit -m "refactor: extract DatabaseConnection to @wallpaperdb/core

- Move DatabaseConnection to shared package
- Extract config types
- Update ingestor to use package
- All tests passing"
```

---

### Step 3: MinIO Connection (Day 2 Morning)

**Repeat same process as DatabaseConnection:**

1. Copy MinioConnection to package
2. Extract MinioConfig type
3. Write package tests
4. Update ingestor imports
5. Run all tests
6. Commit

**File:** `packages/core/src/connections/minio.connection.ts`

---

### Step 4: NATS Connection (Day 2 Afternoon)

**Repeat same process:**

1. Copy NatsConnection to package
2. Extract NatsConfig type
3. Write package tests
4. Update ingestor imports
5. Run all tests
6. Commit

**File:** `packages/core/src/connections/nats.connection.ts`

---

### Step 5: Redis Connection (Day 3 Morning)

**Repeat same process:**

1. Copy RedisConnection to package
2. Extract RedisConfig type
3. Write package tests
4. Update ingestor imports
5. Run all tests
6. Commit

**File:** `packages/core/src/connections/redis.connection.ts`

---

### Step 6: OTEL Connection (Day 3 Afternoon)

**Repeat same process:**

1. Copy OtelConnection to package
2. Extract OtelConfig type
3. Write package tests
4. Update ingestor imports
5. Run all tests
6. Commit

**File:** `packages/core/src/connections/otel.connection.ts`

---

### Step 7: RFC 7807 Errors (Day 4 Morning)

#### 7.1 Create errors directory

```bash
mkdir -p packages/core/src/errors/application
```

#### 7.2 Copy base error classes

**File:** `packages/core/src/errors/problem-details.ts`

```typescript
// Copy from apps/ingestor/src/errors/problem-details.ts
```

#### 7.3 Copy application errors

**File:** `packages/core/src/errors/application/*.ts`

```typescript
// Copy all error classes from apps/ingestor/src/errors/application/
```

#### 7.4 Create index

**File:** `packages/core/src/errors/index.ts`

```typescript
export * from './problem-details.js';
export * from './application/invalid-file-format.error.js';
export * from './application/file-too-large.error.js';
// ... all errors
```

#### 7.5 Write Tests

**File:** `packages/core/test/errors.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { ProblemDetailsError, InvalidFileFormatError } from '../src/errors';

describe('RFC 7807 Errors', () => {
  it('should create problem details JSON', () => {
    const error = new InvalidFileFormatError('image/unknown');
    const json = error.toJSON();

    expect(json.type).toBe('https://wallpaperdb.example/problems/invalid-file-format');
    expect(json.status).toBe(400);
    expect(json.title).toBe('Invalid File Format');
  });

  // More tests...
});
```

#### 7.6 Update Ingestor

```typescript
// Change all error imports
- import { InvalidFileFormatError } from '../errors/application/invalid-file-format.error.js';
+ import { InvalidFileFormatError } from '@wallpaperdb/core/errors';
```

#### 7.7 Test & Commit

```bash
make test-packages
make ingestor-test
git add .
git commit -m "refactor: extract RFC 7807 errors to @wallpaperdb/core"
```

---

### Step 8: Telemetry Module (Day 4-5)

#### 8.1 Create telemetry directory

```bash
mkdir -p packages/core/src/telemetry
```

#### 8.2 Create helper functions

**File:** `packages/core/src/telemetry/index.ts`

```typescript
import { trace, metrics, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('wallpaperdb', '1.0.0');
const meter = metrics.getMeter('wallpaperdb', '1.0.0');

export async function withSpan<T>(
  name: string,
  attributes: Record<string, any>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = await fn(span);
    span.setStatus({ code: 1 }); // OK
    return result;
  } catch (error) {
    span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'Unknown' });
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function addEvent(name: string, attributes?: Record<string, any>): void {
  const span = getActiveSpan();
  span?.addEvent(name, attributes);
}

export { tracer, meter };
```

#### 8.3 Create metric definitions

**File:** `packages/core/src/telemetry/metrics.ts`

```typescript
import { meter } from './index.js';

// Pre-defined metrics that services can use
export const uploadRequestsCounter = meter.createCounter('upload.requests.total', {
  description: 'Total upload requests',
  unit: '1'
});

export const uploadDurationHistogram = meter.createHistogram('upload.duration', {
  description: 'Upload duration',
  unit: 'ms'
});

// ... more metrics
```

#### 8.4 Create attribute constants

**File:** `packages/core/src/telemetry/attributes.ts`

```typescript
// OpenTelemetry semantic convention attribute keys
export const Attributes = {
  WALLPAPER_ID: 'wallpaper.id',
  USER_ID: 'user.id',
  FILE_TYPE: 'file.type',
  FILE_MIME_TYPE: 'file.mime_type',
  FILE_SIZE_BYTES: 'file.size_bytes',
  // ... more
} as const;
```

#### 8.5 Write Tests

**File:** `packages/core/test/telemetry.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { withSpan, addEvent } from '../src/telemetry';

describe('Telemetry', () => {
  it('should create span and execute function', async () => {
    const result = await withSpan('test.operation', { foo: 'bar' }, async () => {
      return 'success';
    });

    expect(result).toBe('success');
  });

  it('should record exception on error', async () => {
    await expect(
      withSpan('test.operation', {}, async () => {
        throw new Error('test error');
      })
    ).rejects.toThrow('test error');
  });
});
```

#### 8.6 Update package.json

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.7.0"
  }
}
```

#### 8.7 Test & Commit

```bash
make test-packages
git add .
git commit -m "feat: add telemetry module to @wallpaperdb/core

- withSpan helper for easy instrumentation
- Pre-defined metrics
- Attribute constants
- No DI coupling - static imports"
```

---

### Step 9: Event Schemas (Day 6)

#### 9.1 Create events package

```bash
mkdir -p packages/events/src/schemas
mkdir -p packages/events/test
```

#### 9.2 Create package.json

**File:** `packages/events/package.json`

```json
{
  "name": "@wallpaperdb/events",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./schemas": "./src/schemas/index.ts",
    "./consumer": "./src/consumer/base-event-consumer.ts",
    "./publisher": "./src/publisher/base-event-publisher.ts"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@biomejs/biome": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

#### 9.3 Create event schemas

**File:** `packages/events/src/schemas/wallpaper-uploaded.schema.ts`

```typescript
import { z } from 'zod';

export const WallpaperUploadedEventSchema = z.object({
  eventId: z.string(),
  eventType: z.literal('wallpaper.uploaded'),
  timestamp: z.string().datetime(),
  wallpaper: z.object({
    id: z.string(),
    userId: z.string(),
    fileType: z.enum(['image', 'video']),
    mimeType: z.string(),
    fileSizeBytes: z.number(),
    width: z.number(),
    height: z.number(),
    storageKey: z.string(),
    storageBucket: z.string(),
  }),
});

export type WallpaperUploadedEvent = z.infer<typeof WallpaperUploadedEventSchema>;
```

#### 9.4 Create index

**File:** `packages/events/src/schemas/index.ts`

```typescript
export * from './wallpaper-uploaded.schema.js';
```

#### 9.5 Write Tests

**File:** `packages/events/test/schemas.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { WallpaperUploadedEventSchema } from '../src/schemas';

describe('Event Schemas', () => {
  it('should validate wallpaper.uploaded event', () => {
    const event = {
      eventId: 'evt_123',
      eventType: 'wallpaper.uploaded',
      timestamp: new Date().toISOString(),
      wallpaper: {
        id: 'wlpr_123',
        userId: 'user_123',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        storageKey: 'wlpr_123/original.jpg',
        storageBucket: 'wallpapers',
      },
    };

    const result = WallpaperUploadedEventSchema.parse(event);
    expect(result).toEqual(event);
  });

  it('should reject invalid event', () => {
    const invalid = { eventType: 'wrong' };
    expect(() => WallpaperUploadedEventSchema.parse(invalid)).toThrow();
  });
});
```

#### 9.6 Update Ingestor

**File:** `apps/ingestor/src/services/events.service.ts`

```typescript
- // Manual type definition
+ import { WallpaperUploadedEventSchema, type WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';

async publishUploadedEvent(wallpaper: Wallpaper): Promise<void> {
  const event: WallpaperUploadedEvent = {
    // ...
  };

  // Validate before publishing
  WallpaperUploadedEventSchema.parse(event);

  await js.publish('wallpaper.uploaded', JSON.stringify(event));
}
```

#### 9.7 Test & Commit

---

### Step 10-14: Continue Pattern

Continue the same incremental pattern for:
- Event Consumer/Publisher (Day 7)
- Config Patterns (Day 8)
- Health Utilities (Day 8)
- Documentation (Day 9)
- Final Validation (Day 10)

---

## Validation Checklist

After each step:

- [ ] Package tests pass (`make test-packages`)
- [ ] Ingestor tests pass (`make ingestor-test`)
- [ ] Linter passes (`make lint`)
- [ ] Types compile (`pnpm build`)
- [ ] Changes committed

After full migration:

- [ ] All packages have tests
- [ ] All packages have README
- [ ] Ingestor uses all shared packages
- [ ] Zero duplication between ingestor and packages
- [ ] Documentation complete
- [ ] Migration guide written

---

## Rollback Plan

If any step fails:

1. **Don't panic** - changes are incremental and committed
2. **Identify problem** - which test is failing?
3. **Rollback last commit** - `git reset --hard HEAD~1`
4. **Fix issue** - understand what broke
5. **Try again** - re-attempt the step

Each step is independent and reversible.

---

## Success Criteria

✅ `@wallpaperdb/core` package exists with all connections, errors, telemetry
✅ `@wallpaperdb/events` package exists with schemas and utilities
✅ Ingestor uses shared packages exclusively (no local copies)
✅ All tests passing (packages + ingestor)
✅ Zero regression in functionality
✅ Documentation complete
✅ Ready for Service #2 to use packages

---

## Next Steps

After completion:
1. Review [Observability Implementation Plan](./observability-implementation.md)
2. Begin Phase 1: Add OTEL instrumentation
3. Use shared telemetry module in ingestor

---

## Resources

- [Development Guidelines](../docs/development-guidelines.md) - Incremental migration pattern
- [Shared Packages Guide](../docs/architecture/shared-packages.md) - What belongs where
- [Extraction Guide](../docs/guides/extracting-shared-packages.md) - Step-by-step how-to
