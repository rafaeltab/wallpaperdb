# Phase 3: Fixtures and Helpers Integration

> **Status**: Planning
> **Dependencies**: Phase 1 (Core Builder), Phase 2 (Workspace Builders)
> **Related Docs**: [Test Infrastructure Refactoring Plan](./test-infrastructure-refactoring.md)

## Overview

This plan details Phase 3 of the test infrastructure refactoring: integrating fixtures and helper methods into the TesterBuilder pattern. This phase eliminates the need for separate utility files and provides a consistent, discoverable API for common test operations.

## Problem Statement

### Current State (Post Phase 1 & 2)

**What Works:**
- ✅ Infrastructure builders (Docker, Postgres, MinIO, NATS, Redis)
- ✅ Workspace-specific builders (IngestorMigrations, InProcessIngestor, ContainerizedIngestor)
- ✅ Composable, type-safe test setup
- ✅ Two-phase lifecycle: `setup()` and `destroy()`

**What's Missing:**
- ❌ Test fixtures scattered in workspace files (`apps/ingestor/test/fixtures.ts`)
- ❌ Test helpers scattered in workspace files (`apps/ingestor/test/helpers.ts`)
- ❌ Manual cleanup operations (no middle lifecycle phase)
- ❌ Repeated client creation (S3Client, postgres connections)
- ❌ No namespacing - unclear which builder provides which method

### Existing Utilities Not Yet Integrated

**In `apps/ingestor/test/fixtures.ts`:**
- `createTestImage(options)` - Sharp-based image generation
- `createTestVideo()` - Fake MP4 header
- `generateContentHash(buffer)` - SHA256 hashing
- `TEST_IMAGES` - Predefined fixtures (validJpeg, tooSmall, etc.)
- `generateTestUserId()` - Random user ID
- `generateTestFilename(extension)` - Timestamped filename

**In `apps/ingestor/test/helpers.ts`:**
- `cleanupMinio(config)` - Delete all objects from bucket
- `cleanupDatabase(config)` - TODO/stub
- `uploadFile(fastify, options)` - Multipart form upload
- `waitFor(condition, options)` - Polling helper

**Pattern Issues:**
```typescript
// Current: No namespace, unclear ownership
await tester.query('SELECT * FROM wallpapers');  // Which service?
const client = tester.getClient();                // Which client?

// Desired: Namespaced by builder
await tester.postgres.query('SELECT * FROM wallpapers');
const s3Client = tester.minio.getS3Client();
```

## Solution Architecture

### Design Principles

1. **Namespaced Methods**: Each builder exposes methods under its name
   ```typescript
   tester.postgres.query(...)    // PostgresTesterBuilder methods
   tester.minio.uploadObject(...) // MinioTesterBuilder methods
   tester.fixtures.createImage()  // FixturesTesterBuilder methods
   ```

2. **Three-Phase Lifecycle**: Lifecycle hooks provided by dedicated builders
   - `setup()` - Start infrastructure (SetupTesterBuilder)
   - `cleanup()` - Remove test data between tests (CleanupTesterBuilder)
   - `destroy()` - Stop infrastructure (DestroyTesterBuilder)

3. **Hybrid Fixture Approach**:
   - General fixtures (images, IDs) → FixturesTesterBuilder (no dependencies)
   - Infrastructure-specific operations → Their respective builders

4. **Cached Clients**: Singleton pattern for S3Client, postgres connections, etc.

5. **Auto-Cleanup Opt-In**: Builders can register cleanup hooks, tests call `cleanup()` when needed

### Namespaced Builder Pattern with Helper Classes

**Core Concept**: Each builder adds a property named after itself that contains:
1. A `config` property with the infrastructure configuration (existing pattern)
2. Helper methods for common operations (new)

**Implementation Pattern**: Use separate helper classes that receive the parent tester instance.

```typescript
import type { TesterInstance } from '../framework.js';

// Separate config type (existing pattern)
export interface PostgresConfig {
  container: StartedPostgreSqlContainer;
  connectionString: string;
  host: string;
  port: number;
  database: string;
  options: PostgresOptions;
}

// NEW: Helper class with access to parent tester
class PostgresHelpers {
  private client: PostgresType | undefined;

  constructor(private tester: TesterInstance<PostgresTesterBuilder>) {}

  get config(): PostgresConfig {
    const config = this.tester._postgresConfig;
    if (!config) {
      throw new Error('PostgreSQL not initialized. Call withPostgres() and setup() first.');
    }
    return config;
  }

  getClient(): PostgresType {
    if (!this.client) {
      this.client = createPostgresClient(this.config.connectionString, { max: 10 });
    }
    return this.client;
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (params) {
      return this.getClient().unsafe<T>(sql, params);
    }
    return this.getClient().unsafe<T>(sql);
  }

  async truncateTable(tableName: string): Promise<void> {
    await this.query(`TRUNCATE TABLE ${tableName} CASCADE`);
  }

  async truncateAllTables(): Promise<void> {
    const tables = await this.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    if (tables.length > 0) {
      const tableNames = tables.map(t => t.tablename).join(', ');
      await this.query(`TRUNCATE TABLE ${tableNames} CASCADE`);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = undefined;
    }
  }
}

export class PostgresTesterBuilder extends BaseTesterBuilder<'postgres', [DockerTesterBuilder]> {
  name = 'postgres' as const;

  addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
    return class Postgres extends Base {
      // Private: internal config storage (renamed to avoid conflict)
      _postgresConfig: PostgresConfig | undefined;

      // Private: cleanup tracking
      private postgresCleanupTables: string[] = [];

      // Public: helper instance
      readonly postgres = new PostgresHelpers(this);

      // Configuration method (existing)
      withPostgres(configure: (pg: PostgresBuilder) => PostgresBuilder = (a) => a) {
        const options = configure(new PostgresBuilder()).build();

        this.addSetupHook(async () => {
          console.log('Starting PostgreSQL container...');
          // ... container setup logic ...

          this._postgresConfig = {
            container: started,
            connectionString,
            host,
            port,
            database,
            options,
          };
        });

        this.addDestroyHook(async () => {
          await this.postgres.close();  // Close client
          if (this._postgresConfig) {
            await this._postgresConfig.container.stop();
          }
        });

        return this;
      }

      // Auto-cleanup configuration
      withAutoCleanup(tables: string[]) {
        this.postgresCleanupTables = tables;
        this.addCleanupHook(async () => {
          for (const table of this.postgresCleanupTables) {
            await this.postgres.truncateTable(table);
          }
        });
        return this;
      }

      // Backward compatibility: expose config getter
      getPostgres(): PostgresConfig {
        return this.postgres.config;
      }
    };
  }
}
```

**Usage:**
```typescript
const tester = new TesterClass();
await tester.setup();

// Access config
const connectionString = tester.postgres.config.connectionString;

// Use helper methods
await tester.postgres.truncateTable('wallpapers');
const rows = await tester.postgres.query('SELECT * FROM users WHERE id = $1', [userId]);

// Backward compatible
const config = tester.getPostgres(); // Same as tester.postgres.config
```

**Key Benefits:**
1. ✅ Clear separation: `config` property vs helper methods
2. ✅ Helper class has full type access to parent tester
3. ✅ Can maintain state (cached clients) within helper class
4. ✅ Easy to test helpers in isolation
5. ✅ Backward compatible via `getPostgres()` method

### Lifecycle Builders

**Move lifecycle methods from base `Tester` class to dedicated builders.**

#### SetupTesterBuilder

```typescript
export class SetupTesterBuilder extends BaseTesterBuilder<'setup', []> {
  name = 'setup' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      private setupHooks: (() => Promise<void>)[] = [];

      addSetupHook(hook: () => Promise<void>) {
        this.setupHooks.push(hook);
      }

      async setup() {
        for (const hook of this.setupHooks) {
          await hook();
        }
        return this;
      }
    };
  }
}
```

#### CleanupTesterBuilder

```typescript
export class CleanupTesterBuilder extends BaseTesterBuilder<'cleanup', []> {
  name = 'cleanup' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      private cleanupHooks: (() => Promise<void>)[] = [];

      addCleanupHook(hook: () => Promise<void>) {
        this.cleanupHooks.push(hook);
      }

      async cleanup() {
        // Run in reverse order (LIFO)
        const reversed = [...this.cleanupHooks].reverse();
        for (const hook of reversed) {
          await hook();
        }
        return this;
      }
    };
  }
}
```

#### DestroyTesterBuilder

```typescript
export class DestroyTesterBuilder extends BaseTesterBuilder<'destroy', []> {
  name = 'destroy' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      private destroyHooks: (() => Promise<void>)[] = [];

      addDestroyHook(hook: () => Promise<void>) {
        this.destroyHooks.push(hook);
      }

      async destroy() {
        // Run in reverse order (LIFO)
        const reversed = [...this.destroyHooks].reverse();
        for (const hook of reversed) {
          await hook();
        }
        return this;
      }
    };
  }
}
```

**Note**: All builders must include these three lifecycle builders in composition.

### FixturesTesterBuilder

**Provides general test data generation (no infrastructure dependencies).**

```typescript
export class FixturesTesterBuilder extends BaseTesterBuilder<'fixtures', []> {
  name = 'fixtures' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      fixtures = {
        // Image generation
        createTestImage: async (options?: TestImageOptions): Promise<Buffer> => {
          const { width = 1920, height = 1080, format = 'jpeg', background = { r: 100, g: 150, b: 200 } } = options ?? {};

          let image = sharp({
            create: { width, height, channels: 3, background },
          });

          switch (format) {
            case 'jpeg': image = image.jpeg({ quality: 90 }); break;
            case 'png': image = image.png(); break;
            case 'webp': image = image.webp({ quality: 90 }); break;
          }

          return image.toBuffer();
        },

        // Predefined images
        images: {
          validJpeg: () => this.fixtures.createTestImage({ width: 1920, height: 1080, format: 'jpeg' }),
          validPng: () => this.fixtures.createTestImage({ width: 1920, height: 1080, format: 'png' }),
          validWebp: () => this.fixtures.createTestImage({ width: 1920, height: 1080, format: 'webp' }),
          tooSmall: () => this.fixtures.createTestImage({ width: 800, height: 600, format: 'jpeg' }),
          tooLarge: () => this.fixtures.createTestImage({ width: 8192, height: 8192, format: 'jpeg' }),
          portrait: () => this.fixtures.createTestImage({ width: 1080, height: 1920, format: 'jpeg' }),
          landscape: () => this.fixtures.createTestImage({ width: 2560, height: 1440, format: 'jpeg' }),
          square: () => this.fixtures.createTestImage({ width: 1920, height: 1920, format: 'jpeg' }),
        },

        // Video stub
        createTestVideo: (): Buffer => {
          // Minimal valid MP4 header
          return Buffer.from([
            0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
            // ... MP4 header bytes
          ]);
        },

        // Utilities
        generateContentHash: async (buffer: Buffer): Promise<string> => {
          const hash = createHash('sha256');
          hash.update(buffer);
          return hash.digest('hex');
        },

        generateTestUserId: (): string => {
          return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        },

        generateTestFilename: (extension: string): string => {
          return `test_${Date.now()}.${extension}`;
        },
      };
    };
  }
}
```

**Usage:**
```typescript
const image = await tester.fixtures.createTestImage({ width: 1920, height: 1080 });
const jpeg = await tester.fixtures.images.validJpeg();
const userId = tester.fixtures.generateTestUserId();
```

---

## Enhanced Infrastructure Builders

### Enhanced MinioTesterBuilder

**Add helper class for MinIO operations.**

```typescript
import type { TesterInstance } from '../framework.js';

// Existing config type
export interface MinioConfig {
  container: StartedMinioContainer;
  endpoint: string;
  options: MinioOptions;
  buckets: string[];
}

// NEW: Helper class
class MinioHelpers {
  private s3Client: S3Client | undefined;

  constructor(private tester: TesterInstance<MinioTesterBuilder>) {}

  get config(): MinioConfig {
    const config = this.tester._minioConfig;
    if (!config) {
      throw new Error('MinIO not initialized. Call withMinio() and setup() first.');
    }
    return config;
  }

  getS3Client(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        endpoint: this.config.endpoint,
        region: 'us-east-1',
        credentials: {
          accessKeyId: this.config.options.accessKey,
          secretAccessKey: this.config.options.secretKey,
        },
        forcePathStyle: true,
      });
    }
    return this.s3Client;
  }

  async uploadObject(bucket: string, key: string, body: Buffer): Promise<void> {
    await this.getS3Client().send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body })
    );
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.getS3Client().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    );
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.getS3Client().send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );
      return true;
    } catch (error) {
      if ((error as any).name === 'NotFound') return false;
      throw error;
    }
  }

  async listObjects(bucket: string, prefix?: string): Promise<string[]> {
    const response = await this.getS3Client().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
    );
    return response.Contents?.map(obj => obj.Key!) ?? [];
  }

  async cleanupBuckets(): Promise<void> {
    for (const bucket of this.config.buckets) {
      const keys = await this.listObjects(bucket);
      if (keys.length > 0) {
        await this.getS3Client().send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map(Key => ({ Key })) },
          })
        );
      }
    }
  }
}

export class MinioTesterBuilder extends BaseTesterBuilder<'minio', [DockerTesterBuilder]> {
  name = 'minio' as const;

  addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
    return class Minio extends Base {
      // Private: internal config storage
      _minioConfig: MinioConfig | undefined;

      // Private: bucket tracking
      private desiredBuckets: string[] = [];

      // Public: helper instance
      readonly minio = new MinioHelpers(this);

      // Configuration methods (existing)
      withMinioBucket(name: string) {
        this.desiredBuckets.push(name);
        return this;
      }

      withMinio(configure: (minio: MinioBuilder) => MinioBuilder = (a) => a) {
        const options = configure(new MinioBuilder()).build();

        this.addSetupHook(async () => {
          console.log('Starting MinIO container...');
          // ... container setup logic ...

          this._minioConfig = {
            container: started,
            endpoint,
            options,
            buckets: [],
          };

          // Create buckets
          if (this.desiredBuckets.length > 0) {
            for (const bucket of this.desiredBuckets) {
              await this.minio.getS3Client().send(
                new CreateBucketCommand({ Bucket: bucket })
              );
              this._minioConfig.buckets.push(bucket);
            }
          }
        });

        this.addDestroyHook(async () => {
          if (this._minioConfig) {
            await this._minioConfig.container.stop();
          }
        });

        return this;
      }

      // Auto-cleanup registration
      withAutoCleanup() {
        this.addCleanupHook(async () => {
          await this.minio.cleanupBuckets();
        });
        return this;
      }

      // Backward compatibility
      getMinio(): MinioConfig {
        return this.minio.config;
      }
    };
  }
}
```

**Usage:**
```typescript
// Access config
const endpoint = tester.minio.config.endpoint;

// Upload test image
await tester.minio.uploadObject('test-bucket', 'test.jpg', imageBuffer);

// Check existence
const exists = await tester.minio.objectExists('test-bucket', 'test.jpg');

// Manual cleanup
await tester.minio.cleanupBuckets();

// Or auto-cleanup in beforeEach
beforeEach(async () => {
  await tester.cleanup(); // Runs all cleanup hooks
});

// Backward compatible
const config = tester.getMinio(); // Same as tester.minio.config
```

### Enhanced PostgresTesterBuilder

**Pattern already shown in "Namespaced Builder Pattern with Helper Classes" section above.**

Key points:
- `PostgresHelpers` class with `config` getter and helper methods
- `_postgresConfig` private property for internal storage
- `tester.postgres` is instance of `PostgresHelpers`
- `getPostgres()` method for backward compatibility

### Enhanced NatsTesterBuilder

**Add helper class for NATS operations.**

```typescript
import type { TesterInstance } from '../framework.js';

// Existing config type
export interface NatsConfig {
  container: StartedNatsContainer;
  url: string;
  options: NatsOptions;
  streams: string[];
}

// NEW: Helper class
class NatsHelpers {
  private connection: NatsConnection | undefined;
  private jsClient: JetStreamClient | undefined;

  constructor(private tester: TesterInstance<NatsTesterBuilder>) {}

  get config(): NatsConfig {
    const config = this.tester._natsConfig;
    if (!config) {
      throw new Error('NATS not initialized. Call withNats() and setup() first.');
    }
    return config;
  }

  getConnection(): NatsConnection {
    if (!this.connection) {
      // Create NATS connection
      this.connection = /* implementation */;
    }
    return this.connection;
  }

  getJsClient(): JetStreamClient {
    if (!this.jsClient) {
      this.jsClient = this.getConnection().jetstream();
    }
    return this.jsClient;
  }

  async publishEvent(subject: string, data: unknown): Promise<void> {
    const js = this.getJsClient();
    await js.publish(subject, JSON.stringify(data));
  }

  async getStreamInfo(streamName: string): Promise<StreamInfo> {
    const jsm = await this.getConnection().jetstreamManager();
    return jsm.streams.info(streamName);
  }

  async purgeStream(streamName: string): Promise<void> {
    const jsm = await this.getConnection().jetstreamManager();
    await jsm.streams.purge(streamName);
  }

  async purgeAllStreams(): Promise<void> {
    for (const stream of this.config.streams) {
      await this.purgeStream(stream);
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
      this.jsClient = undefined;
    }
  }
}

export class NatsTesterBuilder extends BaseTesterBuilder<'nats', [DockerTesterBuilder]> {
  name = 'nats' as const;

  addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
    return class Nats extends Base {
      // Private: internal config storage
      _natsConfig: NatsConfig | undefined;

      // Private: stream tracking
      private desiredStreams: string[] = [];

      // Public: helper instance
      readonly nats = new NatsHelpers(this);

      // Configuration methods (existing pattern)
      withStream(name: string) {
        this.desiredStreams.push(name);
        return this;
      }

      withNats(configure: (nats: NatsBuilder) => NatsBuilder = (a) => a) {
        const options = configure(new NatsBuilder()).build();

        this.addSetupHook(async () => {
          console.log('Starting NATS container...');
          // ... container setup logic ...

          this._natsConfig = {
            container: started,
            url,
            options,
            streams: [],
          };

          // Create streams
          if (this.desiredStreams.length > 0) {
            const jsm = await this.nats.getConnection().jetstreamManager();
            for (const stream of this.desiredStreams) {
              await jsm.streams.add({ name: stream, subjects: [`${stream.toLowerCase()}.*`] });
              this._natsConfig.streams.push(stream);
            }
          }
        });

        this.addDestroyHook(async () => {
          await this.nats.close();
          if (this._natsConfig) {
            await this._natsConfig.container.stop();
          }
        });

        return this;
      }

      // Auto-cleanup registration
      withAutoCleanup() {
        this.addCleanupHook(async () => {
          await this.nats.purgeAllStreams();
        });
        return this;
      }

      // Backward compatibility
      getNats(): NatsConfig {
        return this.nats.config;
      }
    };
  }
}

**Usage:**
```typescript
// Access config
const connectionString = tester.nats.config.url;

// Publish event
await tester.nats.publishEvent('wallpaper.uploaded', { id: 'wlpr_123' });

// Get stream info
const info = await tester.nats.getStreamInfo('WALLPAPER');

// Manual cleanup
await tester.nats.purgeStream('WALLPAPER');

// Backward compatible
const config = tester.getNats(); // Same as tester.nats.config
```

---

## Summary: Builder Enhancements

All three infrastructure builders follow the same pattern:

**Common Pattern:**
1. Create a separate helper class (e.g., `PostgresHelpers`, `MinioHelpers`, `NatsHelpers`)
2. Helper class receives parent tester via constructor: `constructor(private tester: TesterInstance<BuilderType>)`
3. Helper class has `config` getter that accesses `tester._builderConfig`
4. Helper class provides all helper methods
5. Builder's `addMethods()` returns class with:
   - Private `_builderConfig` property
   - Public `readonly builderName = new BuilderHelpers(this)`
   - Configuration methods (existing)
   - `withAutoCleanup()` to register cleanup hooks
   - `getBuilder()` for backward compatibility

**Benefits:**
- ✅ Clear namespace: `tester.postgres.query()`, `tester.minio.uploadObject()`, `tester.nats.publishEvent()`
- ✅ Type-safe access to parent tester from helpers
- ✅ Cached clients within helper classes
- ✅ Backward compatible via `get*()` methods
- ✅ Testable helper classes

---

## Framework Changes

### Export TesterInstance Type

**Add to `packages/test-utils/src/framework.ts`:**

```typescript
/**
 * Extracts the class type created by a builder's addMethods() function.
 * This is useful for creating helper classes that need access to the parent tester instance.
 *
 * @example
 * ```typescript
 * class PostgresHelpers {
 *   constructor(private tester: TesterInstance<PostgresTesterBuilder>) {}
 *
 *   async query(sql: string) {
 *     const config = this.tester._postgresConfig;
 *     // ... use config
 *   }
 * }
 * ```
 */
export type TesterInstance<TTester extends AnyTester> = InferAddMethodClass<TTester>;
```

This type was already internal (`InferAddMethodClass`) but now exposed with a clearer name and documentation.

**Export from `packages/test-utils/src/index.ts`:**

```typescript
export type { TesterInstance } from './framework.js';
```

### Update Base Tester Class

**Remove lifecycle methods from base class - they're now provided by builders.**

```typescript
// OLD (Phase 1 & 2):
class Tester {
  setupHooks: (() => Promise<void>)[] = [];
  destroyHooks: (() => Promise<void>)[] = [];

  addSetupHook(hook: () => Promise<void>) { ... }
  addDestroyHook(hook: () => Promise<void>) { ... }

  async setup() { ... }
  async destroy() { ... }
}

// NEW (Phase 3):
class Tester {
  // Empty base class - all functionality from builders
}
```

**All tests must include lifecycle builders:**

```typescript
const TesterClass = createTesterBuilder()
  .with(SetupTesterBuilder)      // Provides setup() and addSetupHook()
  .with(CleanupTesterBuilder)    // Provides cleanup() and addCleanupHook()
  .with(DestroyTesterBuilder)    // Provides destroy() and addDestroyHook()
  .with(DockerTesterBuilder)
  // ... other builders
  .build();
```

### Type System Updates

**Update `AddMethodsType` to properly infer namespaced properties.**

Current type system should already support this pattern, but may need refinement for autocomplete on namespaced properties.

---

## Implementation Plan

### Step 1: Create Lifecycle Builders
**Files to create:**
- `packages/test-utils/src/builders/SetupTesterBuilder.ts`
- `packages/test-utils/src/builders/CleanupTesterBuilder.ts`
- `packages/test-utils/src/builders/DestroyTesterBuilder.ts`

**Changes:**
- Move hook arrays and lifecycle methods from `Tester` base class to builders
- Update exports in `packages/test-utils/src/index.ts`

### Step 2: Create FixturesTesterBuilder
**File to create:**
- `packages/test-utils/src/builders/FixturesTesterBuilder.ts`

**Features:**
- `fixtures.createTestImage(options)`
- `fixtures.images.*` predefined fixtures
- `fixtures.createTestVideo()`
- `fixtures.generateContentHash(buffer)`
- `fixtures.generateTestUserId()`
- `fixtures.generateTestFilename(extension)`

### Step 3: Enhance MinioTesterBuilder
**File to modify:**
- `packages/test-utils/src/builders/MinioTesterBuilder.ts`

**Add to `minio` namespace:**
- `getS3Client()` - Cached client
- `uploadObject(bucket, key, body)`
- `deleteObject(bucket, key)`
- `objectExists(bucket, key)`
- `listObjects(bucket, prefix?)`
- `cleanupBuckets()`

**Add configuration:**
- `withAutoCleanup()` - Register cleanup hook

### Step 4: Enhance PostgresTesterBuilder
**File to modify:**
- `packages/test-utils/src/builders/PostgresTesterBuilder.ts`

**Add to `postgres` namespace:**
- `getClient()` - Cached postgres.js client
- `query(sql, params?)`
- `truncateTable(tableName)`
- `truncateAllTables()`
- `cleanupTables()`

**Add configuration:**
- `withAutoCleanup(tables)` - Register cleanup hook

**Update destroy:**
- Close postgres client in destroy hook

### Step 5: Enhance NatsTesterBuilder
**File to modify:**
- `packages/test-utils/src/builders/NatsTesterBuilder.ts`

**Add to `nats` namespace:**
- `getConnection()` - Cached connection
- `getJsClient()` - Cached JetStream client
- `publishEvent(subject, data)`
- `consumeEvent(stream, consumer?)`
- `getStreamInfo(streamName)`
- `purgeStream(streamName)`
- `purgeAllStreams()`

**Add configuration:**
- `withAutoCleanup()` - Register cleanup hook

### Step 6: Update Framework Base Class
**File to modify:**
- `packages/test-utils/src/framework.ts`

**Changes:**
- Remove lifecycle methods from `Tester` class (now in builders)
- Ensure type system supports namespaced properties

### Step 7: Update Exports
**File to modify:**
- `packages/test-utils/src/index.ts`

**Add exports:**
- `SetupTesterBuilder`, `CleanupTesterBuilder`, `DestroyTesterBuilder`
- `FixturesTesterBuilder`
- Updated type definitions

### Step 8: Create Migration Examples
**Files to create:**
- `packages/test-utils/examples/phase3-migration.md`

**Show before/after:**
- Using separate fixture files → Using FixturesTesterBuilder
- Manual cleanup → Using cleanup hooks
- Creating clients manually → Using cached clients from builders

### Step 9: Update Documentation
**Files to modify:**
- `docs/testing/test-builder-pattern.md`
  - Add "Lifecycle Builders" section
  - Add "Namespaced Methods" section
  - Add "Cleanup Phase" section
- `docs/testing/api-reference.md`
  - Document all new lifecycle builders
  - Document FixturesTesterBuilder API
  - Document enhanced infrastructure builder methods
  - Update all examples to use lifecycle builders
- `docs/testing/creating-custom-builders.md`
  - Show how to add namespaced helpers to custom builders
  - Show how to register cleanup hooks

### Step 10: Update Existing Test Examples
**Files to modify:**
- `apps/ingestor/test/health-builder.test.ts`
- `apps/ingestor-e2e/test/health-builder.e2e.test.ts`

**Changes:**
- Add lifecycle builders to composition
- Demonstrate cleanup hooks
- Use namespaced methods

---

## Example Usage

### Complete Integration Test Example

```typescript
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTesterBuilder,
  SetupTesterBuilder,
  CleanupTesterBuilder,
  DestroyTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  FixturesTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
  IngestorMigrationsTesterBuilder,
  InProcessIngestorTesterBuilder,
} from './builders/index.js';

describe('Upload Flow (Phase 3 Pattern)', () => {
  const TesterClass = createTesterBuilder()
    // Lifecycle builders (required)
    .with(SetupTesterBuilder)
    .with(CleanupTesterBuilder)
    .with(DestroyTesterBuilder)
    // Infrastructure builders
    .with(DockerTesterBuilder)
    .with(PostgresTesterBuilder)
    .with(MinioTesterBuilder)
    .with(NatsTesterBuilder)
    // Fixture builder
    .with(FixturesTesterBuilder)
    // Application builders
    .with(IngestorMigrationsTesterBuilder)
    .with(InProcessIngestorTesterBuilder)
    .build();

  const tester = new TesterClass();

  beforeAll(async () => {
    tester
      .withPostgres(b => b.withDatabase('upload_test'))
      .withAutoCleanup(['wallpapers']) // Auto-cleanup on tester.cleanup()
      .withMinio()
      .withMinioBucket('test-bucket')
      .withAutoCleanup() // Auto-cleanup bucket on tester.cleanup()
      .withNats(b => b.withJetstream())
      .withStream('WALLPAPER')
      .withAutoCleanup(); // Auto-purge streams on tester.cleanup()

    await tester.setup();
  }, 60000);

  // Clean between tests (removes data, keeps infrastructure running)
  beforeEach(async () => {
    await tester.cleanup();
  });

  afterAll(async () => {
    await tester.destroy(); // Stop all containers
  });

  it('uploads a valid JPEG', async () => {
    // Generate test image using fixtures builder
    const imageBuffer = await tester.fixtures.images.validJpeg();
    const userId = tester.fixtures.generateTestUserId();
    const filename = tester.fixtures.generateTestFilename('jpg');

    // Upload via application
    const app = tester.getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      payload: createMultipartForm(imageBuffer, filename),
      headers: { 'x-user-id': userId },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);

    // Verify in MinIO using namespaced helper
    const exists = await tester.minio.objectExists(
      'test-bucket',
      body.storageKey
    );
    expect(exists).toBe(true);

    // Verify in database using namespaced helper
    const wallpapers = await tester.postgres.query(
      'SELECT * FROM wallpapers WHERE id = $1',
      [body.id]
    );
    expect(wallpapers).toHaveLength(1);
    expect(wallpapers[0].upload_state).toBe('completed');

    // Verify NATS event
    const streamInfo = await tester.nats.getStreamInfo('WALLPAPER');
    expect(streamInfo.state.messages).toBe(1);
  });

  it('rejects too-small images', async () => {
    const imageBuffer = await tester.fixtures.images.tooSmall();
    const userId = tester.fixtures.generateTestUserId();

    const app = tester.getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      payload: createMultipartForm(imageBuffer, 'small.jpg'),
      headers: { 'x-user-id': userId },
    });

    expect(response.statusCode).toBe(400);

    // Verify nothing in storage
    const objects = await tester.minio.listObjects('test-bucket');
    expect(objects).toHaveLength(0);
  });

  it('handles manual cleanup', async () => {
    // Upload test data
    await tester.minio.uploadObject('test-bucket', 'test.jpg', Buffer.from('test'));
    await tester.postgres.query(
      'INSERT INTO wallpapers (id, user_id, upload_state) VALUES ($1, $2, $3)',
      ['wlpr_test', 'user_test', 'completed']
    );

    // Manual cleanup
    await tester.minio.cleanupBuckets();
    await tester.postgres.truncateTable('wallpapers');

    // Verify cleaned
    const objects = await tester.minio.listObjects('test-bucket');
    expect(objects).toHaveLength(0);

    const rows = await tester.postgres.query('SELECT * FROM wallpapers');
    expect(rows).toHaveLength(0);
  });
});
```

### E2E Test Example

```typescript
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTesterBuilder,
  SetupTesterBuilder,
  CleanupTesterBuilder,
  DestroyTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  FixturesTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
  IngestorMigrationsTesterBuilder,
  ContainerizedIngestorTesterBuilder,
} from './builders/index.js';

describe('Upload E2E (Phase 3 Pattern)', () => {
  const TesterClass = createTesterBuilder()
    .with(SetupTesterBuilder)
    .with(CleanupTesterBuilder)
    .with(DestroyTesterBuilder)
    .with(DockerTesterBuilder)
    .with(PostgresTesterBuilder)
    .with(MinioTesterBuilder)
    .with(NatsTesterBuilder)
    .with(FixturesTesterBuilder)
    .with(IngestorMigrationsTesterBuilder)
    .with(ContainerizedIngestorTesterBuilder)
    .build();

  const tester = new TesterClass();

  beforeAll(async () => {
    tester
      .withNetwork() // Docker network for containerized app
      .withPostgres()
      .withAutoCleanup(['wallpapers'])
      .withMinio()
      .withMinioBucket('test-bucket')
      .withAutoCleanup()
      .withNats(b => b.withJetstream())
      .withStream('WALLPAPER')
      .withAutoCleanup();

    await tester.setup();
  }, 120000);

  beforeEach(async () => {
    await tester.cleanup();
  });

  afterAll(async () => {
    await tester.destroy();
  });

  it('uploads via HTTP', async () => {
    const imageBuffer = await tester.fixtures.images.validJpeg();
    const userId = tester.fixtures.generateTestUserId();

    // HTTP upload to containerized app
    const baseUrl = tester.getBaseUrl();
    const response = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: { 'x-user-id': userId },
      body: createMultipartForm(imageBuffer, 'test.jpg'),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    // Verify using namespaced helpers
    const exists = await tester.minio.objectExists('test-bucket', body.storageKey);
    expect(exists).toBe(true);
  });
});
```

---

## Migration Strategy

### Phase 3A: Enhance Builders (This Phase)
1. ✅ Create lifecycle builders
2. ✅ Create FixturesTesterBuilder
3. ✅ Enhance infrastructure builders with namespaced methods
4. ✅ Update documentation

**Result**: New capabilities available, existing tests unaffected

### Phase 3B: Migrate Tests (Future)
1. Update one test file at a time
2. Replace fixture imports with `tester.fixtures.*`
3. Replace helper calls with `tester.minio.*`, `tester.postgres.*`
4. Add lifecycle builders to composition
5. Use cleanup hooks instead of manual cleanup

**Result**: Gradual migration, no big-bang changes

### Phase 3C: Remove Old Utilities (Future)
1. Once all tests migrated, delete `apps/ingestor/test/fixtures.ts`
2. Delete `apps/ingestor/test/helpers.ts`
3. Update imports

---

## Breaking Changes

### Required Changes for All Tests

**Before (Phase 1 & 2):**
```typescript
const TesterClass = createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  // ...
  .build();
```

**After (Phase 3):**
```typescript
const TesterClass = createTesterBuilder()
  .with(SetupTesterBuilder)      // REQUIRED
  .with(CleanupTesterBuilder)    // REQUIRED
  .with(DestroyTesterBuilder)    // REQUIRED
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  // ...
  .build();
```

**Migration Path:**
- Create a helper that includes lifecycle builders by default
- Or: Update all test files to include lifecycle builders

### Recommended: Create Default Builder Factory

**File**: `packages/test-utils/src/createDefaultTesterBuilder.ts`

```typescript
export function createDefaultTesterBuilder() {
  return createTesterBuilder()
    .with(SetupTesterBuilder)
    .with(CleanupTesterBuilder)
    .with(DestroyTesterBuilder);
}
```

**Usage:**
```typescript
const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  // ...
  .build();
```

---

## Success Criteria

### Functional Requirements
- ✅ All builder methods namespaced by builder name
- ✅ Three-phase lifecycle: setup → cleanup → destroy
- ✅ Fixtures available via FixturesTesterBuilder
- ✅ Infrastructure helpers integrated into their builders
- ✅ Clients cached as singletons on builder instances
- ✅ Auto-cleanup available via opt-in flags
- ✅ Existing tests continue working (backward compatible)

### Code Quality
- ✅ All new methods fully typed
- ✅ Comprehensive JSDoc comments
- ✅ Consistent patterns across all builders
- ✅ Clear error messages for misconfiguration

### Documentation
- ✅ All lifecycle builders documented
- ✅ All new methods in API reference
- ✅ Migration examples provided
- ✅ Updated test examples use new patterns

### Testing
- ✅ Example test files demonstrate new features
- ✅ Documentation examples are copy-pasteable
- ✅ All builders tested in real integration tests

---

## Future Enhancements (Post Phase 3)

### Possible Future Additions

**HTTP Testing Helper Builder:**
```typescript
export class HttpTesterBuilder extends BaseTesterBuilder<'http', []> {
  http = {
    uploadFile: async (url, buffer, filename) => { ... },
    waitForStatus: async (url, status, timeout) => { ... },
  };
}
```

**Assertion Helper Builder:**
```typescript
export class AssertionTesterBuilder extends BaseTesterBuilder<'assertions', []> {
  assertions = {
    assertMinioObjectExists: async (bucket, key) => { ... },
    assertDatabaseRowCount: async (table, count) => { ... },
    assertNatsMessagePublished: async (stream, subject) => { ... },
  };
}
```

**Timing/Wait Helper Builder:**
```typescript
export class TimingTesterBuilder extends BaseTesterBuilder<'timing', []> {
  timing = {
    waitFor: async (condition, options) => { ... },
    waitForMinioObject: async (bucket, key, timeout) => { ... },
    waitForDatabaseRow: async (table, condition, timeout) => { ... },
  };
}
```

---

## Notes

### Design Rationale: Namespaced Methods

**Problem with flat namespace:**
```typescript
tester.query(...)         // Postgres query? NATS query? Unclear!
tester.getClient()        // Which client? S3? Postgres? Redis?
tester.uploadObject(...)  // To MinIO? Or something else?
```

**Solution: Namespace by builder:**
```typescript
tester.postgres.query(...)       // Clear: Postgres query
tester.minio.getS3Client()       // Clear: S3Client for MinIO
tester.minio.uploadObject(...)   // Clear: Upload to MinIO
```

**Benefits:**
- ✅ Self-documenting code
- ✅ IDE autocomplete groups related methods
- ✅ No naming conflicts between builders
- ✅ Clear ownership of functionality

### Design Rationale: Lifecycle Builders

**Why move lifecycle to builders?**

1. **Consistency**: Everything is a builder, including lifecycle
2. **Composability**: Tests can omit cleanup if not needed
3. **Type Safety**: Compiler enforces presence of lifecycle builders
4. **Flexibility**: Future builders can extend lifecycle (e.g., pause/resume)

**Alternative considered: Keep in base class**
- Simpler (no need to add lifecycle builders)
- Less flexible (all tests get all lifecycle methods)
- Less composable (can't opt-out of phases)

### Design Rationale: Hybrid Fixtures

**Why separate FixturesTesterBuilder?**

1. **No Infrastructure Dependency**: Image generation doesn't need containers
2. **Reusability**: Any test can use fixtures, even unit tests
3. **Separation of Concerns**: Test data generation vs infrastructure management
4. **Composition**: Can use fixtures without any infrastructure builders

**Why infrastructure-specific helpers in their builders?**

1. **Cohesion**: MinIO operations belong with MinIO builder
2. **Dependencies**: Helpers need access to clients/connections
3. **Type Safety**: Helper methods typed based on builder config
4. **Discoverability**: All MinIO operations under `tester.minio.*`

---

## Implementation Checklist

### Core Implementation
- [ ] Create `SetupTesterBuilder.ts`
- [ ] Create `CleanupTesterBuilder.ts`
- [ ] Create `DestroyTesterBuilder.ts`
- [ ] Create `FixturesTesterBuilder.ts`
- [ ] Update `Tester` base class (remove lifecycle methods)
- [ ] Update `framework.ts` exports

### Infrastructure Builder Enhancements
- [ ] Enhance `MinioTesterBuilder.ts` with namespaced helpers
- [ ] Enhance `PostgresTesterBuilder.ts` with namespaced helpers
- [ ] Enhance `NatsTesterBuilder.ts` with namespaced helpers
- [ ] Update all builder exports in `index.ts`

### Documentation
- [ ] Update `test-builder-pattern.md` (lifecycle, namespaces)
- [ ] Update `api-reference.md` (all new methods)
- [ ] Update `creating-custom-builders.md` (namespaced helpers)
- [ ] Create `phase3-migration.md` example file

### Examples
- [ ] Update `health-builder.test.ts` to use lifecycle builders
- [ ] Update `health-builder.e2e.test.ts` to use lifecycle builders
- [ ] Add cleanup examples to test files
- [ ] Add fixture usage examples to test files

### Testing
- [ ] Run existing tests with lifecycle builders
- [ ] Verify cleanup hooks work correctly
- [ ] Test namespaced methods in real scenarios
- [ ] Verify cached clients are reused

### Utilities (Optional)
- [ ] Create `createDefaultTesterBuilder()` helper
- [ ] Add migration script (find/replace patterns)

---

This plan maintains backward compatibility while introducing powerful new capabilities. Tests can be migrated gradually, and the new patterns are more discoverable and maintainable.
