# Dependency Injection Implementation Plan - Using TSyringe

## Overview

This plan implements comprehensive dependency injection for the ingestor service using **TSyringe** (Microsoft's DI container for TypeScript).

**Strategy:**
- Migration Style: Big Bang - Complete conversion in one feature branch
- Service Pattern: Convert all function-based services to classes
- DI Library: TSyringe with decorators
- Fastify Integration: Single `fastify.container` decorator
- Testing: TestAppContainer with mock helper methods

---

## Why TSyringe?

- **Microsoft-backed** - Well-maintained, production-proven (used in VS Code)
- **Minimal decorators** - Just `@injectable()` and `@inject()` when needed
- **Auto-wiring** - Container automatically resolves dependencies
- **Type-safe** - Full TypeScript support
- **Lifecycle management** - Built-in singleton/transient/scoped support
- **Testing-friendly** - Easy to override services with mocks
- **No proxy magic** - Unlike Awilix, uses standard decorators and reflection

---

## Phase 1: Setup TSyringe

### 1.1 Install Dependencies

```bash
pnpm --filter @wallpaperdb/ingestor add tsyringe reflect-metadata
```

**Packages:**
- `tsyringe@^4.8.0` - DI container
- `reflect-metadata@^0.2.0` - Required for decorator metadata

### 1.2 Update TypeScript Configuration

**File**: `apps/ingestor/tsconfig.json`

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    // ... existing config
  }
}
```

### 1.3 Import reflect-metadata

**File**: `apps/ingestor/src/index.ts` (top of file)

```typescript
import "reflect-metadata";
// ... rest of imports
```

---

## Phase 2: Convert Function Services to Injectable Classes

### 2.1 StorageService

**File**: `services/storage.service.ts`

**Before:**
```typescript
export async function uploadToStorage(
  wallpaperId: string,
  buffer: Buffer,
  mimeType: string,
  extension: string,
  bucket: string,
  userId: string
): Promise<StorageResult> {
  const client = getMinioClient();
  // ...
}
```

**After:**
```typescript
import { injectable, inject } from "tsyringe";
import type { S3Client } from "@aws-sdk/client-s3";

@injectable()
export class StorageService {
  constructor(
    @inject("S3Client") private readonly s3Client: S3Client,
    @inject("Config") private readonly config: Config
  ) {}

  async upload(
    wallpaperId: string,
    buffer: Buffer,
    mimeType: string,
    extension: string,
    userId: string
  ): Promise<StorageResult> {
    const bucket = this.config.s3Bucket;
    // Use this.s3Client instead of getMinioClient()
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    // Use this.s3Client
  }

  async delete(bucket: string, key: string): Promise<void> {
    // Use this.s3Client
  }
}
```

### 2.2 EventsService

**File**: `services/events.service.ts`

**Before:**
```typescript
export async function publishWallpaperUploadedEvent(
  wallpaper: WallpaperRecord
): Promise<void> {
  const natsClient = getNatsClient();
  // ...
}
```

**After:**
```typescript
import { injectable, inject } from "tsyringe";
import type { NatsConnection } from "nats";

@injectable()
export class EventsService {
  constructor(
    @inject("NatsConnection") private readonly natsClient: NatsConnection,
    @inject("Config") private readonly config: Config
  ) {}

  async publishUploadedEvent(wallpaper: WallpaperRecord): Promise<void> {
    const streamName = this.config.natsStream;
    // Use this.natsClient
  }
}
```

### 2.3 FileProcessorService

**File**: `services/file-processor.service.ts`

**Before:**
```typescript
export async function processFile(
  buffer: Buffer,
  filename: string,
  limits: ValidationLimits,
  providedMimeType: string
): Promise<FileMetadata> {
  // Processing logic
}

export function sanitizeFilename(filename: string): string { }
export function calculateContentHash(buffer: Buffer): string { }
```

**After:**
```typescript
import { injectable } from "tsyringe";

@injectable()
export class FileProcessorService {
  // No dependencies - stateless utility service

  async process(
    buffer: Buffer,
    filename: string,
    limits: ValidationLimits,
    providedMimeType: string
  ): Promise<FileMetadata> {
    // Processing logic
  }

  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 255);
  }

  calculateContentHash(buffer: Buffer): string {
    const hash = crypto.createHash('sha256');
    hash.update(buffer);
    return hash.digest('hex');
  }

  async detectMimeType(buffer: Buffer): Promise<{ mime: string; ext: string } | null> {
    const result = await fileTypeFromBuffer(buffer);
    return result ? { mime: result.mime, ext: result.ext } : null;
  }
}
```

---

## Phase 3: Add @injectable Decorators to Existing Services

### 3.1 Singleton Services

**Add `@injectable()` decorator to:**

1. `ValidationLimitsService` (already class-based)
2. `RateLimitService` (already class-based)
3. `HealthService` (already class-based)

**Example:**
```typescript
import { injectable, inject } from "tsyringe";

@injectable()
export class DefaultValidationLimitsService implements ValidationLimitsService {
  // No changes to implementation
}

@injectable()
export class RateLimitService {
  constructor(
    @inject("Config") private readonly config: Config,
    @inject("Redis") private readonly redis?: Redis
  ) {}
}

@injectable()
export class HealthService {
  constructor(
    @inject("Config") private readonly config: Config
  ) {}
}
```

### 3.2 State Machine Service

**File**: `services/state-machine/wallpaper-state-machine.service.ts`

```typescript
import { injectable, inject } from "tsyringe";

@injectable()
export class WallpaperStateMachine {
  constructor(
    @inject("Database") private readonly db: DbType,
    private readonly timeService: TimeService = systemTimeService
  ) {}
}
```

### 3.3 Upload Orchestrator

**File**: `services/upload/upload-orchestrator.service.ts`

**Before:**
```typescript
export class UploadOrchestrator {
  constructor(
    private readonly db: DbType,
    private readonly validationLimitsService: ValidationLimitsService,
    private readonly storageBucket: string,
    private readonly logger: FastifyBaseLogger,
    private readonly timeService: TimeService = systemTimeService
  ) {
    this.stateMachine = new WallpaperStateMachine(db, timeService);
  }
}
```

**After:**
```typescript
import { injectable, inject } from "tsyringe";

@injectable()
export class UploadOrchestrator {
  constructor(
    @inject("Database") private readonly db: DbType,
    private readonly validationLimitsService: ValidationLimitsService,
    private readonly storageService: StorageService,
    private readonly eventsService: EventsService,
    private readonly fileProcessorService: FileProcessorService,
    @inject("Config") private readonly config: Config,
    @inject("Logger") private readonly logger: FastifyBaseLogger,
    private readonly timeService: TimeService,
    private readonly stateMachine: WallpaperStateMachine
  ) {}

  async handleUpload(params: UploadParams): Promise<UploadResult> {
    // Replace function calls with service methods:
    // processFile() → this.fileProcessorService.process()
    // uploadToStorage() → this.storageService.upload()
    // publishWallpaperUploadedEvent() → this.eventsService.publishUploadedEvent()
    // sanitizeFilename() → this.fileProcessorService.sanitizeFilename()
  }
}
```

### 3.4 Reconciliation Services

**Add `@injectable()` and inject dependencies:**

```typescript
// stuck-uploads-reconciliation.service.ts
import { injectable } from "tsyringe";

@injectable()
export class StuckUploadsReconciliation extends BaseReconciliation<WallpaperRecord> {
  constructor(
    @inject("Config") private readonly config: Config,
    private readonly storageService: StorageService
  ) {
    super();
  }

  protected async processRecord(record: WallpaperRecord, tx: TransactionType): Promise<void> {
    // Replace objectExists() with this.storageService.objectExists()
  }
}
```

```typescript
// missing-events-reconciliation.service.ts
import { injectable } from "tsyringe";

@injectable()
export class MissingEventsReconciliation extends BaseReconciliation<WallpaperRecord> {
  constructor(
    private readonly eventsService: EventsService
  ) {
    super();
  }

  protected async processRecord(record: WallpaperRecord, tx: TransactionType): Promise<void> {
    // Replace publishWallpaperUploadedEvent() with this.eventsService.publishUploadedEvent()
  }
}
```

```typescript
// orphaned-minio-reconciliation.service.ts
import { injectable, inject } from "tsyringe";

@injectable()
export class OrphanedMinioReconciliation {
  constructor(
    @inject("Database") private readonly database: DbType,
    private readonly storageService: StorageService,
    @inject("Config") private readonly config: Config
  ) {}

  private async processObject(objectKey: string): Promise<void> {
    // Replace deleteFromStorage() with this.storageService.delete()
  }
}
```

---

## Phase 4: Convert Scheduler to Injectable Class

**File**: `services/scheduler.service.ts`

**Before:** Module-level functions with state

**After:**
```typescript
import { injectable, inject } from "tsyringe";

@injectable()
export class SchedulerService {
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private minioCleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isReconciling = false;

  constructor(
    @inject("Config") private readonly config: Config,
    @inject("Database") private readonly database: { db: DbType },
    private readonly stuckUploadsReconciliation: StuckUploadsReconciliation,
    private readonly missingEventsReconciliation: MissingEventsReconciliation,
    private readonly orphanedIntentsReconciliation: OrphanedIntentsReconciliation,
    private readonly orphanedMinioReconciliation: OrphanedMinioReconciliation
  ) {}

  start(): void {
    if (this.isRunning) {
      console.log('Scheduler already running');
      return;
    }

    this.reconciliationInterval = setInterval(
      () => this.runReconciliationCycle(),
      this.config.reconciliationIntervalMs
    );

    this.minioCleanupInterval = setInterval(
      () => this.runMinioCleanupCycle(),
      this.config.minioCleanupIntervalMs
    );

    this.isRunning = true;
  }

  private async runReconciliationCycle(): Promise<void> {
    if (this.isReconciling) return;
    this.isReconciling = true;

    try {
      await this.stuckUploadsReconciliation.reconcile(this.database.db);
      await this.missingEventsReconciliation.reconcile(this.database.db);
      await this.orphanedIntentsReconciliation.reconcile(this.database.db);
    } finally {
      this.isReconciling = false;
    }
  }

  private async runMinioCleanupCycle(): Promise<void> {
    await this.orphanedMinioReconciliation.reconcile();
  }

  stop(): void { /* ... */ }
  async stopAndWait(): Promise<void> { /* ... */ }
}
```

---

## Phase 5: Create DI Container Setup

### 5.1 Create Container Module

**File**: `containers/di-container.ts`

```typescript
import "reflect-metadata";
import { container } from "tsyringe";
import type { Config } from "../config.js";
import {
  createDatabaseConnection,
  closeDatabaseConnection,
  type DatabaseClient
} from "../connections/database.js";
import {
  createMinioConnection,
  closeMinioConnection
} from "../connections/minio.js";
import {
  createNatsConnection,
  closeNatsConnection
} from "../connections/nats.js";
import {
  createRedisConnection,
  closeRedisConnection
} from "../connections/redis.js";

/**
 * Initialize DI container with all infrastructure and services
 */
export async function initializeContainer(config: Config): Promise<void> {
  // Register config
  container.register("Config", { useValue: config });

  // Initialize and register infrastructure connections
  const dbConnection = createDatabaseConnection(config);
  container.register("Database", { useValue: dbConnection });

  const s3Client = createMinioConnection(config);
  container.register("S3Client", { useValue: s3Client });

  const natsConnection = await createNatsConnection(config);
  container.register("NatsConnection", { useValue: natsConnection });

  if (config.redisEnabled) {
    const redis = createRedisConnection(config);
    await redis.connect();
    container.register("Redis", { useValue: redis });
  }

  // Register TimeService (singleton)
  container.register("TimeService", {
    useValue: new SystemTimeService()
  });

  // All @injectable() services are auto-registered when first resolved
  // No need to manually register StorageService, EventsService, etc.
}

/**
 * Close all connections and clean up container
 */
export async function closeContainer(): Promise<void> {
  try {
    await closeNatsConnection();
    closeMinioConnection();
    await closeDatabaseConnection();

    if (container.isRegistered("Redis")) {
      const redis = container.resolve<Redis>("Redis");
      await closeRedisConnection();
    }
  } catch (error) {
    console.error("Error closing container:", error);
  }

  // Clear container
  container.clearInstances();
}

/**
 * Get the global DI container instance
 */
export function getContainer() {
  return container;
}
```

### 5.2 Create Request-Scoped Container Helper

**File**: `containers/request-container.ts`

```typescript
import { container } from "tsyringe";
import type { FastifyBaseLogger } from "fastify";

/**
 * Create a child container for request-scoped dependencies
 * This allows each request to have its own logger instance
 */
export function createRequestContainer(logger: FastifyBaseLogger) {
  const childContainer = container.createChildContainer();
  childContainer.register("Logger", { useValue: logger });
  return childContainer;
}
```

---

## Phase 6: Integrate with Fastify

### 6.1 Update app.ts

**File**: `app.ts`

```typescript
import "reflect-metadata";
import Fastify from "fastify";
import { initializeContainer, closeContainer, getContainer } from "./containers/di-container.js";
import { createRequestContainer } from "./containers/request-container.js";
import type { Config } from "./config.js";
import healthRoutes from "./routes/health.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

// Extend Fastify types
declare module "fastify" {
  interface FastifyInstance {
    container: typeof container;
  }

  interface FastifyRequest {
    container: DependencyContainer; // Request-scoped container
  }
}

export async function createApp(config: Config) {
  // Initialize DI container
  await initializeContainer(config);
  const diContainer = getContainer();

  const fastify = Fastify({
    logger: true,
  });

  // Add global container as decorator
  fastify.decorate("container", diContainer);

  // Create request-scoped container for each request
  fastify.addHook("onRequest", async (request, _reply) => {
    request.container = createRequestContainer(request.log);
  });

  // Register rate limiting hook
  const rateLimitService = diContainer.resolve(RateLimitService);
  fastify.decorate("rateLimitService", rateLimitService);

  // Register rate limit preHandler
  fastify.addHook("preHandler", async (request, reply) => {
    if (request.url === "/upload" && request.method === "POST") {
      const userId = (request as RequestWithCache).rateLimitUserId;
      if (userId) {
        await rateLimitService.checkRateLimit(userId);
      }
    }
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(uploadRoutes);

  // Cleanup on shutdown
  fastify.addHook("onClose", async () => {
    await closeContainer();
  });

  return fastify;
}
```

### 6.2 Update Type Definitions

**File**: `types.ts` (or add to `app.ts`)

```typescript
import type { DependencyContainer } from "tsyringe";
import type { RateLimitService } from "./services/rate-limit.service.js";

declare module "fastify" {
  interface FastifyInstance {
    container: DependencyContainer;
    rateLimitService: RateLimitService;
  }

  interface FastifyRequest {
    container: DependencyContainer;
  }
}
```

---

## Phase 7: Update Route Handlers

### 7.1 Update upload.routes.ts

**Before:**
```typescript
async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const db = getDatabase();
  const orchestrator = new UploadOrchestrator(
    db,
    validationLimitsService,
    config.s3Bucket,
    request.log
  );

  const rateLimitResult = await request.server.rateLimitService.checkRateLimit(userId);
  const result = await orchestrator.handleUpload({ ... });
  // ...
}
```

**After:**
```typescript
import { UploadOrchestrator } from "../services/upload/upload-orchestrator.service.js";

async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  // Resolve orchestrator from request-scoped container
  // This gives it access to request.log via the "Logger" token
  const orchestrator = request.container.resolve(UploadOrchestrator);

  const rateLimitResult = await request.server.rateLimitService.checkRateLimit(userId);
  const result = await orchestrator.handleUpload({ ... });
  // ...
}

export default async function uploadRoutes(fastify: FastifyInstance) {
  // Remove: let config: Config
  // Remove: const validationLimitsService = new DefaultValidationLimitsService()

  // Register multipart
  await fastify.register(import("@fastify/multipart"), {
    limits: {
      fileSize: 200 * 1024 * 1024,
      files: 1,
    },
  });

  // Register preHandler (unchanged)
  fastify.addHook("preHandler", async (request, _reply) => { ... });

  // Register route
  fastify.post("/upload", uploadHandler);
}
```

### 7.2 Update health.routes.ts

**Before:**
```typescript
export default async function healthRoutes(
  fastify: FastifyInstance,
  options: { config: Config }
) {
  const healthService = new HealthService(options.config);

  fastify.get("/health", async (_request, reply) => {
    const result = await healthService.checkHealth(isShuttingDown);
    // ...
  });
}
```

**After:**
```typescript
import { HealthService } from "../services/health.service.js";

export default async function healthRoutes(fastify: FastifyInstance) {
  // Resolve singleton HealthService from container
  const healthService = fastify.container.resolve(HealthService);

  fastify.get("/health", async (_request, reply) => {
    const result = await healthService.checkHealth(isShuttingDown);
    // ...
  });

  fastify.get("/ready", async (_request, reply) => {
    const result = await healthService.checkReadiness(isShuttingDown);
    // ...
  });
}
```

---

## Phase 8: Update index.ts (Scheduler Integration)

**File**: `index.ts`

**Before:**
```typescript
import { startScheduler, stopScheduler } from "./services/scheduler.service.js";

const fastify = await createApp(config);
await fastify.listen({ port: config.port, host: "0.0.0.0" });

startScheduler();

// Shutdown
process.on("SIGTERM", async () => {
  await stopScheduler();
  await fastify.close();
});
```

**After:**
```typescript
import { SchedulerService } from "./services/scheduler.service.js";

const fastify = await createApp(config);
await fastify.listen({ port: config.port, host: "0.0.0.0" });

// Start scheduler using DI container
const schedulerService = fastify.container.resolve(SchedulerService);
schedulerService.start();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, starting graceful shutdown...");

  // Stop scheduler and wait for current cycle to complete
  await schedulerService.stopAndWait();

  // Close Fastify (this will trigger container cleanup)
  await fastify.close();

  console.log("Graceful shutdown complete");
  process.exit(0);
});
```

---

## Phase 9: Remove Deprecated Code

### 9.1 Delete Reconciliation Facade

**File to delete**: `services/reconciliation.service.ts`

**Reason**: The facade functions (`reconcileStuckUploads()`, `reconcileMissingEvents()`, etc.) are no longer needed. Services are resolved directly from the container.

### 9.2 Update Connection Getters (Optional)

**Option 1: Keep getters private** (safer)
```typescript
// connections/database.ts
// Keep getDatabase() but mark as internal/deprecated
/** @internal - Use DI container instead */
export function getDatabase() { ... }
```

**Option 2: Remove getters entirely** (cleaner)
- Remove `getDatabase()`, `getMinioClient()`, `getNatsClient()`
- All access goes through container

---

## Phase 10: Testing Infrastructure

### 10.1 Create TestContainer Helper

**File**: `test/helpers/test-container.ts`

```typescript
import "reflect-metadata";
import { container, DependencyContainer } from "tsyringe";
import type { Config } from "../../src/config.js";

/**
 * Create a test container with mock services
 */
export function createTestContainer(): DependencyContainer {
  const testContainer = container.createChildContainer();
  return testContainer;
}

/**
 * Helper to register mock services
 */
export function withMock<T>(
  testContainer: DependencyContainer,
  token: string,
  mockInstance: T
): DependencyContainer {
  testContainer.register(token, { useValue: mockInstance });
  return testContainer;
}

/**
 * Create a fully mocked container for unit tests
 */
export function createMockedContainer(overrides: Partial<{
  config: Config;
  database: any;
  s3Client: any;
  natsConnection: any;
  redis: any;
}> = {}): DependencyContainer {
  const testContainer = createTestContainer();

  // Register mocks
  testContainer.register("Config", { useValue: overrides.config ?? mockConfig() });
  testContainer.register("Database", { useValue: overrides.database ?? mockDatabase() });
  testContainer.register("S3Client", { useValue: overrides.s3Client ?? mockS3Client() });
  testContainer.register("NatsConnection", { useValue: overrides.natsConnection ?? mockNatsConnection() });

  if (overrides.redis) {
    testContainer.register("Redis", { useValue: overrides.redis });
  }

  return testContainer;
}

// Mock factories
function mockConfig(): Config { /* ... */ }
function mockDatabase() { /* ... */ }
function mockS3Client() { /* ... */ }
function mockNatsConnection() { /* ... */ }
```

### 10.2 Unit Test Example

**File**: `test/unit/upload-orchestrator.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createMockedContainer } from "../helpers/test-container.js";
import { UploadOrchestrator } from "../../src/services/upload/upload-orchestrator.service.js";

describe("UploadOrchestrator", () => {
  let testContainer: DependencyContainer;

  beforeEach(() => {
    testContainer = createMockedContainer({
      config: createTestConfig(),
      database: createMockDb(),
    });
  });

  it("should handle duplicate uploads", async () => {
    // Resolve orchestrator with all mocked dependencies
    const orchestrator = testContainer.resolve(UploadOrchestrator);

    // Test business logic without real infrastructure
    const result = await orchestrator.handleUpload({
      buffer: Buffer.from("test"),
      originalFilename: "test.jpg",
      providedMimeType: "image/jpeg",
      userId: "test-user",
    });

    expect(result.status).toBe("already_uploaded");
  });
});
```

### 10.3 Integration Test Updates

**File**: `test/upload-flow.test.ts`

**No major changes needed!** Integration tests use TesterBuilder which creates real infrastructure. The DI container will use those real connections.

**Minor update:**
```typescript
// app.ts can optionally accept a pre-initialized container for testing
export async function createApp(config: Config, options?: {
  container?: DependencyContainer;
}) {
  if (options?.container) {
    // Use provided container (for testing)
    const fastify = Fastify({ logger: true });
    fastify.decorate("container", options.container);
    // ... rest of setup
  } else {
    // Normal initialization
    await initializeContainer(config);
    // ... rest of setup
  }
}
```

---

## Phase 11: Update Documentation

### 11.1 Update CLAUDE.md

**Add section: Dependency Injection**

```markdown
## Dependency Injection

The ingestor service uses **TSyringe** for dependency injection.

### Container Setup

All services are registered in the DI container during app initialization:

\`\`\`typescript
import { container } from "tsyringe";

// Infrastructure connections
container.register("Config", { useValue: config });
container.register("Database", { useValue: dbConnection });
container.register("S3Client", { useValue: s3Client });

// Services are auto-registered via @injectable() decorator
const storageService = container.resolve(StorageService);
\`\`\`

### Creating Injectable Services

All services should use the `@injectable()` decorator:

\`\`\`typescript
import { injectable, inject } from "tsyringe";

@injectable()
export class MyService {
  constructor(
    @inject("Config") private config: Config,
    private otherService: OtherService // Auto-injected if @injectable
  ) {}
}
\`\`\`

### Service Lifetimes

- **Singleton**: Created once, shared across all requests
  - StorageService, EventsService, FileProcessorService
  - ValidationLimitsService, RateLimitService, HealthService
  - All infrastructure connections

- **Transient**: Created per request/use
  - UploadOrchestrator (per request)
  - Reconciliation services (per cycle)

- **Scoped**: Per-request instances
  - Logger (via request.container)

### Using Services in Routes

\`\`\`typescript
// Access singleton services via fastify.container
const healthService = fastify.container.resolve(HealthService);

// Access request-scoped services via request.container
const orchestrator = request.container.resolve(UploadOrchestrator);
\`\`\`

### Testing with DI

\`\`\`typescript
import { createMockedContainer } from "../test/helpers/test-container.js";

// Create container with mocks
const testContainer = createMockedContainer({
  database: mockDb,
  s3Client: mockS3,
});

// Resolve service with mocked dependencies
const service = testContainer.resolve(MyService);
\`\`\`

### Adding New Services

1. Create service class with `@injectable()` decorator
2. Inject dependencies via constructor
3. Use `@inject("TokenName")` for tokens (Config, Database, etc.)
4. Service is auto-registered when first resolved
\`\`\`
```

---

## File Changes Summary

### New Files (3)
1. `containers/di-container.ts` - Container initialization
2. `containers/request-container.ts` - Request-scoped container helper
3. `test/helpers/test-container.ts` - Test container utilities

### Modified Files (15)
1. `package.json` - Add tsyringe, reflect-metadata
2. `tsconfig.json` - Enable decorator support
3. `index.ts` - Import reflect-metadata, use SchedulerService
4. `app.ts` - Initialize container, add decorators
5. `services/storage.service.ts` - Convert to @injectable class
6. `services/events.service.ts` - Convert to @injectable class
7. `services/file-processor.service.ts` - Convert to @injectable class
8. `services/scheduler.service.ts` - Convert to @injectable class
9. `services/upload/upload-orchestrator.service.ts` - Add @injectable, inject services
10. `services/state-machine/wallpaper-state-machine.service.ts` - Add @injectable
11. `services/reconciliation/stuck-uploads-reconciliation.service.ts` - Add @injectable, inject StorageService
12. `services/reconciliation/missing-events-reconciliation.service.ts` - Add @injectable, inject EventsService
13. `services/reconciliation/orphaned-minio-reconciliation.service.ts` - Add @injectable, inject services
14. `routes/upload.routes.ts` - Use container for services
15. `routes/health.routes.ts` - Use container for HealthService

### Deleted Files (1)
1. `services/reconciliation.service.ts` - Facade no longer needed

---

## Testing Strategy

### Phase-by-Phase Testing

1. **After Phase 1-2**: Install packages, verify TypeScript compiles
2. **After Phase 3**: Test that decorated services can be resolved
3. **After Phase 4-5**: Test container initialization in isolation
4. **After Phase 6-7**: Run integration tests (all 102 must pass)
5. **After Phase 8**: Test scheduler with real reconciliation
6. **Phase 10**: Add unit tests for individual services

### Success Criteria

✅ All 102 existing integration tests pass
✅ TypeScript compiles without errors
✅ Services can be resolved from container
✅ Container initializes and closes cleanly
✅ Scheduler works with injected services
✅ New unit tests pass (minimum 10 tests)
✅ No runtime errors in production mode

---

## Rollback Plan

If issues occur:

1. **Decorator Issues**: Check tsconfig.json has correct flags
2. **Resolution Issues**: Verify all @injectable() decorators are present
3. **Token Issues**: Check @inject("TokenName") matches registered tokens
4. **Test Failures**: Use createMockedContainer for isolated debugging
5. **Full Rollback**: Revert entire branch, analyze issues offline

---

## Migration Checklist

### Prerequisites
- [ ] Install tsyringe and reflect-metadata
- [ ] Update tsconfig.json with decorator support
- [ ] Import reflect-metadata in index.ts

### Service Conversion
- [ ] Convert StorageService to class
- [ ] Convert EventsService to class
- [ ] Convert FileProcessorService to class
- [ ] Add @injectable to ValidationLimitsService
- [ ] Add @injectable to RateLimitService
- [ ] Add @injectable to HealthService
- [ ] Add @injectable to WallpaperStateMachine
- [ ] Add @injectable to UploadOrchestrator
- [ ] Add @injectable to all reconciliation services
- [ ] Convert SchedulerService to class

### Container Setup
- [ ] Create di-container.ts
- [ ] Create request-container.ts
- [ ] Update app.ts to initialize container
- [ ] Add Fastify type definitions

### Route Updates
- [ ] Update upload.routes.ts
- [ ] Update health.routes.ts
- [ ] Update index.ts for scheduler

### Testing
- [ ] Create test-container.ts
- [ ] Update integration tests
- [ ] Add unit tests for services
- [ ] Run full test suite

### Cleanup
- [ ] Delete reconciliation.service.ts
- [ ] Update CLAUDE.md
- [ ] Remove deprecated getters (optional)

---

## Estimated Timeline

- **Phase 1**: Setup (30 minutes)
- **Phase 2-3**: Service conversion (2 hours)
- **Phase 4**: Scheduler conversion (1 hour)
- **Phase 5**: Container setup (1 hour)
- **Phase 6-7**: Fastify integration (1.5 hours)
- **Phase 8**: Scheduler integration (30 minutes)
- **Phase 9**: Cleanup (30 minutes)
- **Phase 10**: Testing (1.5 hours)
- **Phase 11**: Documentation (30 minutes)

**Total**: ~9 hours for complete implementation

---

## Next Steps

1. Review this plan
2. Create feature branch: `feat/dependency-injection`
3. Start with Phase 1 (setup)
4. Run tests after each phase
5. Document any issues encountered
6. Submit PR when all tests pass
