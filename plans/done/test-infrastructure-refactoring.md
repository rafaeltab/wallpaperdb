# Test Infrastructure Refactoring Plan

> **Note**: This document describes the original plan and has been updated to reflect the actual implementation. For up-to-date usage instructions, see:
> - [Testing Overview](../docs/testing/README.md)
> - [TesterBuilder Pattern Guide](../docs/testing/test-builder-pattern.md)
> - [Creating Custom Builders](../docs/testing/creating-custom-builders.md)
> - [API Reference](../docs/testing/api-reference.md)

## Overview

This plan addresses the test setup duplication and complexity across the `apps/ingestor` and `apps/ingestor-e2e` workspaces by introducing a **TesterBuilder pattern** that provides a unified, flexible API for test environment setup through composable class-based builders.

## Problem Statement

### Current Issues

1. **Massive Code Duplication**: PostgreSQL, MinIO, and NATS container setup is duplicated between integration and E2E test setups (200+ lines)
2. **Inflexible Architecture**: Special test scenarios (like distributed rate limiting) require completely separate vitest configs and duplicate all setup logic
3. **Fragile Path Dependencies**: E2E tests reach into sibling workspace for migration files (`../../ingestor/drizzle/...`)
4. **Scattered Utilities**: Test fixtures and helpers are duplicated or inconsistently organized
5. **No Composability**: Cannot easily mix and match infrastructure components for different test scenarios
6. **Environment Variable Pollution**: Tests set global `process.env` variables as workarounds

### What Varies Across Test Scenarios

| Concern | Integration | E2E | Distributed E2E |
|---------|-------------|-----|-----------------|
| PostgreSQL | ✅ Host ports | ✅ Docker network | ✅ Docker network |
| MinIO | ✅ Host ports | ✅ Docker network | ✅ Docker network |
| NATS | ✅ Host ports | ✅ Docker network | ✅ Docker network |
| Redis | ❌ Disabled | ❌ Not needed | ✅ Required |
| Ingestor | In-process | 1 container | 3 containers |
| Parallelism | Yes (5 threads) | Sequential | Sequential |
| Network | None | Shared Docker | Shared Docker |

## Solution: TesterBuilder Pattern

### Architecture Overview

**Core Concept**: Use composable TypeScript class builders to create test environments from reusable building blocks. Each builder adds specific capabilities and can declare compile-time dependencies on other builders.

**The actual implementation uses a two-phase pattern:**
1. **Composition Phase**: Define which builders to use (`.with()` + `.build()`)
2. **Configuration Phase**: Configure each builder via fluent methods
3. **Execution Phase**: Start infrastructure with `await tester.setup()`

```typescript
// Example: Integration test setup (in-process app)
const TesterClass = createTesterBuilder()
  .with(DockerTesterBuilder)               // Required base
  .with(PostgresTesterBuilder)             // Database
  .with(MinioTesterBuilder)                // Storage
  .with(NatsTesterBuilder)                 // Messaging
  .with(IngestorMigrationsTesterBuilder)   // Requires PostgresTesterBuilder
  .with(InProcessIngestorTesterBuilder)    // Requires Postgres, Minio, Nats
  .build();

const tester = new TesterClass();
tester
  .withPostgres(b => b.withDatabase('test_db'))
  .withMinio()
  .withMinioBucket('wallpapers')
  .withNats(b => b.withJetstream())
  .withStream('WALLPAPER');

await tester.setup();

// Example: E2E test setup (containerized app)
const TesterClass = createTesterBuilder()
  .with(DockerTesterBuilder)                    // Creates network
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)
  .with(ContainerizedIngestorTesterBuilder)     // Requires network
  .build();

const tester = new TesterClass();
tester
  .withNetwork()                                 // Enable Docker network
  .withPostgres()                                // Uses default alias 'postgres'
  .withMinio()                                   // Uses default alias 'minio'
  .withNats(b => b.withJetstream())              // Uses default alias 'nats'
  .withStream('WALLPAPER');

await tester.setup();

// Example: Distributed rate limiting test
const TesterClass = createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(RedisTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)
  .with(ContainerizedIngestorTesterBuilder)
  .build();

const tester = new TesterClass();
tester
  .withNetwork()
  .withPostgres()                                // Default aliases used automatically
  .withMinio()
  .withNats(b => b.withJetstream())
  .withRedis()
  .withIngestorInstances(3);

await tester.setup();
```

### Key Design Principles

1. **Separation of Concerns**: Infrastructure, workspace-specific logic, and utilities are separate
2. **Type-Safe Dependencies**: Builders declare dependencies enforced at compile-time (TypeScript type system)
3. **Composability**: Mix and match components for any test scenario
4. **No Duplication**: Each concern implemented once and reused everywhere
5. **Backward Compatible**: Existing tests continue working during gradual migration
6. **Two-Phase API**: Separate composition from configuration for flexibility
7. **Compile-Time Safety**: Catch missing dependencies before runtime

---

## Phase 1: Core Builder and Infrastructure Builders

**Goal**: Create the foundation - the TesterBuilder pattern implementation and base infrastructure builders that work for any workspace.

> **Implementation Note**: The actual implementation uses class-based builders, not function-based mixins. See Phase 1 sections below for the planned interface vs. actual implementation notes.

### 1.1 Create `packages/test-utils` Package

**File**: `packages/test-utils/package.json`

```json
{
  "name": "@wallpaperdb/test-utils",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./fixtures": "./src/fixtures/index.ts",
    "./helpers": "./src/helpers/index.ts"
  },
  "dependencies": {
    "@testcontainers/postgresql": "^10.13.2",
    "@testcontainers/minio": "^10.13.2",
    "@testcontainers/redis": "^10.13.2",
    "@wallpaperdb/testcontainers": "workspace:*",
    "testcontainers": "^10.13.2",
    "postgres": "^3.4.3",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@types/node": "^20.11.5",
    "typescript": "^5.3.3"
  }
}
```

**File**: `packages/test-utils/tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

---

### 1.2 Implement Core Builder Framework

**File**: `packages/test-utils/src/framework.ts`

The actual implementation uses a sophisticated TypeScript mixin system with compile-time type checking:

```typescript
/**
 * Base Tester class - provides lifecycle hooks
 */
class Tester {
  setupHooks: (() => Promise<void>)[] = [];
  destroyHooks: (() => Promise<void>)[] = [];

  addSetupHook(hook: () => Promise<void>) {
    this.setupHooks.push(hook);
  }

  addDestroyHook(hook: () => Promise<void>) {
    this.destroyHooks.push(hook);
  }

  public async setup() {
    for (const setupHook of this.setupHooks) {
      await setupHook();
    }
    return this;
  }

  public async destroy() {
    // Execute destroy hooks in reverse order (LIFO)
    // This ensures dependencies are destroyed after dependents
    const reversedHooks = [...this.destroyHooks].reverse();
    for (const destroyHook of reversedHooks) {
      await destroyHook();
    }
    return this;
  }
}

/**
 * TesterBuilder - composes builders into a final class
 */
class TesterBuilder<TTesters extends TupleOfTesters = []> {
  private testers: TupleOfTesters = [];

  constructor(testers: TupleOfTesters) {
    this.testers = testers;
  }

  /**
   * Add a builder to the composition
   * TypeScript enforces that required dependencies are present
   */
  public with<TTester extends AnyTester>(
    testerConstructor: RequireTesters<TTesterConstructor, TRequiredTesters, TTesters>
  ): TesterBuilder<MergeTester<TTester, TTesters>> {
    return new TesterBuilder([new testerConstructor(), ...this.testers]);
  }

  /**
   * Build final tester class
   * Applies all builder addMethods() to create composed class
   */
  public build(): AddMethodsType<[...TTesters]> {
    let ctor = Tester;
    for (const tester of this.testers) {
      ctor = tester.addMethods(ctor);  // Apply mixin
    }
    return ctor as any as AddMethodsType<[...TTesters]>;
  }
}

/**
 * Factory function - entry point for test setup
 */
export function createTesterBuilder(): TesterBuilder<[]> {
  return new TesterBuilder<[]>([]);
}

/**
 * Base class for all builders
 * Builders extend this and implement addMethods()
 */
export abstract class BaseTesterBuilder<
  TName extends string,
  TRequiredTesters extends TupleOfTesters = [],
> {
  abstract name: TName;

  /**
   * Add methods and properties to the base class
   * This is where the "mixin" happens - extending the class
   */
  abstract addMethods<TBase extends AddMethodsType<TRequiredTesters>>(
    Base: TBase
  ): AnyConstructorFor<any>;
}
```

**Key Features**:

1. **Compile-Time Type Safety**: TypeScript enforces builder dependencies at compile time
2. **Class Composition**: Each builder adds methods via `addMethods()`
3. **Hook-Based Lifecycle**: Builders register setup/destroy hooks
4. **LIFO Destroy Order**: Resources cleaned up in reverse order
5. **Type Inference**: Return type automatically includes all builder methods

---

### 1.3 Implement Infrastructure Builders

**File**: `packages/test-utils/src/builders/DockerTesterBuilder.ts`

```typescript
import { Network, type StartedNetwork } from 'testcontainers';
import { type AddMethodsType, BaseTesterBuilder } from '../framework.js';

export interface DockerConfig {
  network?: StartedNetwork;
}

export class DockerTesterBuilder extends BaseTesterBuilder<'docker', []> {
  name = 'docker' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class Docker extends Base {
      docker: DockerConfig = {};

      withNetwork() {
        this.addSetupHook(async () => {
          console.log('Creating Docker network...');
          const network = await new Network().start();
          this.docker.network = network;
          console.log(`Docker network created: ${network.getName()}`);
        });

        this.addDestroyHook(async () => {
          if (this.docker.network) {
            console.log('Stopping Docker network...');
            await this.docker.network.stop();
          }
        });

        return this;
      }

      getNetwork(): StartedNetwork {
        if (!this.docker.network) {
          throw new Error('Docker network not initialized. Call withNetwork() and setup() first.');
        }
        return this.docker.network;
      }
    };
  }
}
```

**Pattern**: Each builder extends `BaseTesterBuilder` and:
1. Declares its name (e.g., `'docker'`)
2. Declares dependencies as type parameter (e.g., `[]` means no dependencies)
3. Implements `addMethods()` which returns a class that:
   - Extends the base class
   - Adds configuration properties
   - Provides `with*()` methods that register hooks
   - Provides `get*()` methods for accessing resources

**File**: `packages/test-utils/src/builders/PostgresTesterBuilder.ts`

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type AddMethodsType, BaseTesterBuilder } from '../framework.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';

export interface PostgresOptions {
  image: string;
  database: string;
  username: string;
  password: string;
  networkAlias: string;
}

// Internal builder for configuration
class PostgresBuilder {
  private image = 'postgres:16-alpine';
  private database = `test_db_${Date.now()}`;
  private username = 'test';
  private password = 'test';
  private networkAlias = 'postgres';

  withImage(image: string) { this.image = image; return this; }
  withDatabase(db: string) { this.database = db; return this; }
  withUser(username: string) { this.username = username; return this; }
  withPassword(password: string) { this.password = password; return this; }
  withNetworkAlias(alias: string) { this.networkAlias = alias; return this; }

  build(): PostgresOptions {
    return {
      image: this.image,
      database: this.database,
      username: this.username,
      password: this.password,
      networkAlias: this.networkAlias,
    };
  }
}

export interface PostgresConfig {
  container: StartedPostgreSqlContainer;
  connectionString: string;
  host: string;
  port: number;
  database: string;
  options: PostgresOptions;
}

export class PostgresTesterBuilder extends BaseTesterBuilder<'postgres', [DockerTesterBuilder]> {
  name = 'postgres' as const;

  addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
    return class Postgres extends Base {
      postgres: PostgresConfig | undefined;

      withPostgres(configure: (pg: PostgresBuilder) => PostgresBuilder = (a) => a) {
        const options = configure(new PostgresBuilder()).build();
        const { image, database, username, password, networkAlias } = options;

        this.addSetupHook(async () => {
          console.log('Starting PostgreSQL container...');

          // Check if network is available
          const dockerNetwork = this.docker.network;

          let container = new PostgreSqlContainer(image)
            .withDatabase(database)
            .withUsername(username)
            .withPassword(password);

          if (dockerNetwork) {
            container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
          }

          const started = await container.start();

          // Build connection strings
          const host = dockerNetwork ? networkAlias : started.getHost();
          const port = dockerNetwork ? 5432 : started.getPort();

          const connectionString = dockerNetwork
            ? `postgresql://${username}:${password}@${host}:5432/${database}`
            : started.getConnectionUri();

          this.postgres = {
            container: started,
            connectionString,
            host,
            port,
            database,
            options,
          };

          console.log(`PostgreSQL started: ${connectionString}`);
        });

        this.addDestroyHook(async () => {
          if (this.postgres) {
            console.log('Stopping PostgreSQL container...');
            await this.postgres.container.stop();
          }
        });

        return this;
      }

      getPostgres(): PostgresConfig {
        if (!this.postgres) {
          throw new Error('Postgres not initialized. Call withPostgres() and setup() first.');
        }
        return this.postgres;
      }
    };
  }
}
```

**Note**: The nested `PostgresBuilder` class provides type-safe configuration via callback pattern.

**Other Infrastructure Builders** (MinIO, NATS, Redis) follow the same pattern:

- **MinioTesterBuilder**: Provides `withMinio()` and `withMinioBucket(name)` methods
- **NatsTesterBuilder**: Provides `withNats()` and `withStream(name)` methods
- **RedisTesterBuilder**: Provides `withRedis()` method

Each builder:
- Declares `[DockerTesterBuilder]` as dependency
- Uses nested builder class for configuration options
- Auto-detects network via `this.docker.network`
- Uses default network aliases ('minio', 'nats', 'redis')
- Registers setup/destroy hooks
- Provides typed getter methods

See actual implementation in `packages/test-utils/src/builders/*.ts`

---

### 1.4 Export Infrastructure Builders

**File**: `packages/test-utils/src/index.ts`

```typescript
// Core framework
export { createTesterBuilder, BaseTesterBuilder } from './framework.js';
export type { AddMethodsType } from './framework.js';

// Infrastructure builders
export { DockerTesterBuilder } from './builders/DockerTesterBuilder.js';
export type { DockerConfig } from './builders/DockerTesterBuilder.js';

export { PostgresTesterBuilder } from './builders/PostgresTesterBuilder.js';
export type { PostgresOptions, PostgresConfig } from './builders/PostgresTesterBuilder.js';

export { MinioTesterBuilder } from './builders/MinioTesterBuilder.js';
export type { MinioOptions, MinioConfig } from './builders/MinioTesterBuilder.js';

export { NatsTesterBuilder } from './builders/NatsTesterBuilder.js';
export type { NatsOptions, NatsConfig } from './builders/NatsTesterBuilder.js';

export { RedisTesterBuilder } from './builders/RedisTesterBuilder.js';
export type { RedisOptions, RedisConfig } from './builders/RedisTesterBuilder.js';
```

---

## Phase 2: Workspace-Specific Builders

**Goal**: Add workspace-specific builders that depend on infrastructure builders (e.g., database migrations, application deployment).

### 2.1 Create Ingestor-Specific Builders

These builders live in the **workspace** (not shared package) because they depend on workspace-specific code.

**File**: `apps/ingestor/test/builders/IngestorMigrationsBuilder.ts`

```typescript
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import createPostgresClient from 'postgres';
import {
  BaseTesterBuilder,
  type PostgresTesterBuilder,
  type AddMethodsType,
} from '@wallpaperdb/test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IngestorMigrationsOptions {
  migrationPath?: string;
}

export class IngestorMigrationsTesterBuilder extends BaseTesterBuilder<
  'IngestorMigrations',
  [PostgresTesterBuilder]
> {
  readonly name = 'IngestorMigrations' as const;
  private options: IngestorMigrationsOptions;

  constructor(options: IngestorMigrationsOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
    const migrationPath =
      this.options.migrationPath ??
      join(__dirname, '../../drizzle/0000_left_starjammers.sql');

    return class extends Base {
      override async setup(): Promise<void> {
        await super.setup();

        const postgres = this.getPostgres();

        console.log('Applying ingestor database migrations...');

        const sql = createPostgresClient(postgres.connectionString, { max: 1 });

        try {
          const migrationSql = readFileSync(migrationPath, 'utf-8');
          await sql.unsafe(migrationSql);
          console.log('Database migrations applied successfully');
        } finally {
          await sql.end();
        }
      }
    };
  }
}
```

**Pattern**: Workspace builders can:
- Accept configuration via constructor (not callback)
- Override `setup()` to run logic after infrastructure is ready
- Access infrastructure via typed getters (`this.getPostgres()`)
- No need for destroy hooks if no cleanup needed

**Other Workspace Builders**:

- **InProcessIngestorTesterBuilder**: Starts Fastify app in-process for integration tests
  - Provides `getApp()` method to access FastifyInstance
  - Sets up environment variables from infrastructure configs

- **ContainerizedIngestorTesterBuilder**: Starts Fastify app in Docker for E2E tests
  - Provides `withIngestorInstances(count)` method
  - Provides `getBaseUrl()` to access HTTP endpoint
  - Requires `DockerTesterBuilder` with network

See actual implementations in `apps/ingestor/test/builders/`

---

### 2.2 Export Workspace Builders

**File**: `apps/ingestor/test/builders/index.ts`

```typescript
export { IngestorMigrationsTesterBuilder } from './IngestorMigrationsBuilder.js';
export type { IngestorMigrationsOptions } from './IngestorMigrationsBuilder.js';

export { InProcessIngestorTesterBuilder } from './InProcessIngestorBuilder.js';

export { ContainerizedIngestorTesterBuilder } from './ContainerizedIngestorBuilder.js';
```

**File**: `apps/ingestor-e2e/test/builders/index.ts`

```typescript
// Re-export for E2E tests
export {
  IngestorMigrationsTesterBuilder,
  ContainerizedIngestorTesterBuilder,
} from '../../../ingestor/test/builders/index.js';
```

---

## Phase 3: Centralized Fixtures and Helpers

**Goal**: Extract and centralize test utilities (fixtures, helpers, cleanup) into `packages/test-utils`.

### 3.1 Test Fixtures

**File**: `packages/test-utils/src/fixtures/images.ts`

```typescript
import sharp from 'sharp';

export interface TestImageOptions {
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp';
  background?: { r: number; g: number; b: number };
}

/**
 * Generate a test image buffer
 * Uses Sharp to create real image data
 */
export async function createTestImage(options: TestImageOptions = {}): Promise<Buffer> {
  const {
    width = 1920,
    height = 1080,
    format = 'jpeg',
    background = { r: 100, g: 150, b: 200 },
  } = options;

  let image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background,
    },
  });

  switch (format) {
    case 'jpeg':
      image = image.jpeg({ quality: 90 });
      break;
    case 'png':
      image = image.png();
      break;
    case 'webp':
      image = image.webp({ quality: 90 });
      break;
  }

  return image.toBuffer();
}

/**
 * Predefined test images for common scenarios
 */
export const TEST_IMAGES = {
  validJpeg: () => createTestImage({ width: 1920, height: 1080, format: 'jpeg' }),
  validPng: () => createTestImage({ width: 1920, height: 1080, format: 'png' }),
  validWebP: () => createTestImage({ width: 1920, height: 1080, format: 'webp' }),

  tooSmall: () => createTestImage({ width: 800, height: 600, format: 'jpeg' }),
  tooLarge: () => createTestImage({ width: 8192, height: 8192, format: 'jpeg' }),

  portrait: () => createTestImage({ width: 1080, height: 1920, format: 'jpeg' }),
  landscape: () => createTestImage({ width: 2560, height: 1440, format: 'jpeg' }),
  square: () => createTestImage({ width: 1920, height: 1920, format: 'jpeg' }),
};
```

**File**: `packages/test-utils/src/fixtures/index.ts`

```typescript
export { createTestImage, TEST_IMAGES } from './images.js';
export type { TestImageOptions } from './images.js';
```

---

### 3.2 Test Helpers

**File**: `packages/test-utils/src/helpers/upload.ts`

```typescript
import { FormData, File } from 'undici';

/**
 * Create multipart form data for file upload
 */
export function createUploadFormData(
  buffer: Buffer,
  filename: string,
  mimeType: string = 'image/jpeg'
): FormData {
  const form = new FormData();
  const file = new File([buffer], filename, { type: mimeType });
  form.append('file', file);
  return form;
}

/**
 * Upload a file via HTTP (for E2E tests)
 */
export async function uploadFileHttp(
  baseUrl: string,
  buffer: Buffer,
  filename: string,
  mimeType: string = 'image/jpeg'
): Promise<Response> {
  const { request } = await import('undici');
  const form = createUploadFormData(buffer, filename, mimeType);

  return request(`${baseUrl}/upload`, {
    method: 'POST',
    body: form,
  });
}
```

---

**File**: `packages/test-utils/src/helpers/cleanup.ts`

```typescript
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

/**
 * Delete all objects in an S3 bucket
 */
export async function cleanupMinioBucket(
  s3Client: S3Client,
  bucket: string
): Promise<void> {
  const listResponse = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket })
  );

  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    return;
  }

  await s3Client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
      },
    })
  );
}

/**
 * Truncate all records from a database table
 */
export async function cleanupDbTable(
  connectionString: string,
  tableName: string
): Promise<void> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(connectionString, { max: 1 });

  try {
    await sql.unsafe(`TRUNCATE TABLE ${tableName} CASCADE`);
  } finally {
    await sql.end();
  }
}
```

---

**File**: `packages/test-utils/src/helpers/index.ts`

```typescript
export { createUploadFormData, uploadFileHttp } from './upload.js';
export { cleanupMinioBucket, cleanupDbTable } from './cleanup.js';
```

---

## Phase 4: Migration Strategy (Gradual)

**Goal**: Migrate existing tests one by one, starting with a proof-of-concept, then expand.

### 4.1 Proof of Concept: Migrate One Integration Test

**Before** (`apps/ingestor/test/upload-flow.test.ts`):
```typescript
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestConfig } from './setup.js';
import { createApp } from '../src/app.js';
// ... lots of setup boilerplate

describe('Upload Flow', () => {
  let app: FastifyInstance;
  const config = getTestConfig();

  beforeAll(async () => {
    app = await createApp(config);
  });

  afterAll(async () => {
    await app.close();
  });

  // ... tests
});
```

**After** (with TesterBuilder - ACTUAL implementation):
```typescript
import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  createTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
  IngestorMigrationsTesterBuilder,
  InProcessIngestorTesterBuilder,
} from './builders/index.js';

describe('Upload Flow (Builder)', () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>['build']>>;

  beforeAll(async () => {
    const TesterClass = createTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(InProcessIngestorTesterBuilder)
      .build();

    tester = new TesterClass();
    tester
      .withPostgres(b => b.withDatabase('upload_flow_test'))
      .withMinio()
      .withMinioBucket('test-bucket')
      .withNats(b => b.withJetstream())
      .withStream('WALLPAPER');

    await tester.setup();
  });

  afterAll(async () => {
    await tester.destroy();
  });

  it('uploads a file', async () => {
    const app = tester.getApp();
    // ... test code
  });
});
```

**Benefits**:
- 30 lines of setup → 10 lines
- Declarative and readable
- No duplication
- Easy to customize (add Redis, change config, etc.)

---

### 4.2 Migration Checklist

**Phase 4.1: Core Migrations**
- [ ] Migrate `apps/ingestor/test/upload-flow.test.ts` (proof of concept)
- [ ] Migrate `apps/ingestor/test/validation.test.ts`
- [ ] Migrate `apps/ingestor/test/health.test.ts`

**Phase 4.2: Complex Scenarios**
- [ ] Migrate `apps/ingestor/test/reconciliation.test.ts`
- [ ] Migrate `apps/ingestor/test/multi-instance.test.ts`
- [ ] Migrate `apps/ingestor/test/scheduler.test.ts`

**Phase 4.3: Distributed Tests**
- [ ] Migrate `apps/ingestor/test/rate-limiting-distributed.test.ts` (add RedisTesterBuilder)
- [ ] Remove `vitest.distributed.config.ts` (no longer needed!)

**Phase 4.4: E2E Tests**
- [ ] Migrate `apps/ingestor-e2e/test/upload.e2e.test.ts`
- [ ] Migrate `apps/ingestor-e2e/test/reconciliation.e2e.test.ts`
- [ ] Migrate `apps/ingestor-e2e/test/rate-limiting-distributed.e2e.test.ts`
- [ ] Remove `apps/ingestor-e2e/test/setup.ts` (global setup no longer needed!)

**Phase 4.5: Cleanup**
- [ ] Delete `apps/ingestor/test/setup.ts`
- [ ] Delete `apps/ingestor-e2e/test/setup.ts`
- [ ] Delete `apps/ingestor-e2e/vitest.distributed.config.ts`
- [ ] Update documentation (CLAUDE.md, README.md)

---

## Implementation Order

### Step 1: Foundational Work (Phase 1)
1. Create `packages/test-utils` package
2. Implement `createTesterBuilder()` and `BaseTesterBuilder`
3. Implement infrastructure builders (Docker, Postgres, MinIO, NATS, Redis)
4. Write unit tests for builder (type safety, dependency validation)
5. **Commit**: "Add test-utils package with TesterBuilder pattern"

### Step 2: Workspace Builders (Phase 2)
1. Create `apps/ingestor/test/builders/` directory
2. Implement `IngestorMigrationsTesterBuilder`
3. Implement `InProcessIngestorTesterBuilder`
4. Implement `ContainerizedIngestorTesterBuilder`
5. **Commit**: "Add ingestor-specific test builders"

### Step 3: Fixtures and Helpers (Phase 3)
1. Implement `packages/test-utils/src/fixtures/images.ts`
2. Implement `packages/test-utils/src/helpers/upload.ts`
3. Implement `packages/test-utils/src/helpers/cleanup.ts`
4. Write tests for fixtures (ensure images are valid)
5. **Commit**: "Add centralized test fixtures and helpers"

### Step 4: Proof of Concept (Phase 4.1)
1. Migrate `apps/ingestor/test/upload-flow.test.ts` to use builder
2. Run test → verify it passes
3. Compare before/after (lines of code, readability)
4. **Commit**: "Migrate upload-flow test to use builder (POC)"

### Step 5: Incremental Migration (Phase 4.2-4.5)
1. Migrate one test file per commit
2. After each migration, run full test suite
3. Keep old `setup.ts` files until all tests migrated
4. **Final commit**: "Complete test infrastructure migration, remove old setup files"

---

## Success Criteria

### Code Metrics
✅ Reduce test setup duplication from ~400 LOC duplicated → ~0 LOC duplicated
✅ Reduce average test setup from ~30 lines → ~10 lines per test file
✅ Eliminate need for separate vitest configs for special cases

### Functionality
✅ All existing tests pass with new builder
✅ Builder validates dependencies at compile-time (TypeScript) and runtime
✅ Distributed tests work without separate config
✅ E2E tests work with containerized deployment

### Developer Experience
✅ New test scenarios require <10 lines of setup code
✅ Adding new infrastructure (e.g., Kafka) = 1 new builder, reused everywhere
✅ Clear compile-time error messages when dependencies missing
✅ Documentation includes examples for common scenarios

### Performance
✅ Test startup time unchanged or faster (parallel container startup)
✅ Container reuse possible (future optimization: shared containers across test files)

---

## Expected Benefits

### Immediate Benefits
1. **Zero Duplication**: Each infrastructure concern implemented once
2. **Composability**: Mix and match components for any test scenario
3. **Type Safety**: Builder dependencies enforced at compile-time
4. **Clarity**: Declarative setup reads like documentation
5. **No Workarounds**: Distributed tests no longer need separate configs

### Future Benefits
1. **Extensibility**: New workspaces (e.g., `apps/processor`) can reuse infrastructure builders
2. **Optimization**: Shared container pools across tests (advanced)
3. **Testability**: Each builder tested in isolation
4. **Maintainability**: Change database schema? Update one builder, all tests benefit

---

## Example: Before vs After

### Before (Distributed E2E Test)

**Required**:
- Separate `vitest.distributed.config.ts` (30 lines)
- Inline setup in test file (200+ lines)
- Manual coordination of container startup

**Total**: ~230 lines of setup code

```typescript
// apps/ingestor-e2e/test/rate-limiting-distributed.e2e.test.ts (BEFORE)
import { describe, it, beforeAll, afterAll } from 'vitest';
import { Network, PostgreSqlContainer, GenericContainer } from 'testcontainers';
// ... 20+ imports

describe('Distributed Rate Limiting', () => {
  let network: StartedNetwork;
  let postgres: StartedPostgreSqlContainer;
  let minio: StartedMinioContainer;
  let nats: StartedNatsContainer;
  let redis: StartedRedisContainer;
  let ingestors: StartedTestContainer[];

  beforeAll(async () => {
    // 200+ lines of setup...
    network = await new Network().start();
    postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withNetwork(network)
      .withNetworkAliases('postgres')
      // ... more config
      .start();
    // ... repeat for minio, nats, redis, 3x ingestor containers
  });

  afterAll(async () => {
    // 30+ lines of teardown...
  });

  // ... tests
});
```

---

### After (TesterBuilder - ACTUAL implementation)

**Required**:
- Test file with builder setup (~20 lines)
- No separate config needed!

**Total**: ~20 lines of setup code

```typescript
// apps/ingestor-e2e/test/rate-limiting-distributed.e2e.test.ts (AFTER)
import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  createTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  RedisTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
  IngestorMigrationsTesterBuilder,
  ContainerizedIngestorTesterBuilder,
} from './builders/index.js';

describe('Distributed Rate Limiting', () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>['build']>>;

  beforeAll(async () => {
    const TesterClass = createTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(RedisTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(ContainerizedIngestorTesterBuilder)
      .build();

    tester = new TesterClass();
    tester
      .withNetwork()
      .withPostgres()
      .withMinio()
      .withMinioBucket('test')
      .withNats(b => b.withJetstream())
      .withRedis()
      .withIngestorInstances(3);

    await tester.setup();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  // ... tests (no changes!)
});
```

**Reduction**: ~230 lines → ~20 lines (91% reduction)
**No separate config file needed!**

---

## Notes

### Why TesterBuilder Pattern Over Alternatives?

**The TesterBuilder Pattern** provides:
1. **Workspace Isolation**: Ingestor-specific logic stays in `apps/ingestor/test/builders/`
2. **Compile-Time Dependencies**: `IngestorMigrationsTesterBuilder` type-checks dependencies at compile time
3. **Reusability**: Infrastructure builders shared via `@wallpaperdb/test-utils`, workspace builders stay local
4. **Testability**: Each builder tested independently
5. **Discoverability**: IDE autocomplete shows available builders and their configuration methods
6. **Type Safety**: TypeScript enforces correct builder composition before runtime

**Alternatives Considered**:
- Single builder with methods: Would require all workspaces to depend on shared package
- Functional mixins (original plan): Less type-safe, runtime validation only
- Factory functions: Less composable, harder to express dependencies
- Plugins: More complex, overkill for this use case

### Builder Dependency Resolution

The builder validates dependencies at **compile time** (TypeScript) and **runtime**:
- TypeScript type system checks that required builders are present
- Compile-time errors show which builders are missing
- Provides clear error messages with fix suggestions

Example compile-time error:
```typescript
// ❌ Type error: PostgresTesterBuilder requires DockerTesterBuilder
createTesterBuilder()
  .with(PostgresTesterBuilder)  // Missing DockerTesterBuilder!
```

### Actual Implementation: Single Destroy Method

> **Note**: The actual implementation differs from the plan here.

The actual implementation has a single `destroy()` method that:
- Stops all containers
- Cleans up all resources
- Called once in `afterAll()`

There is **no separate cleanup method** for per-test cleanup. If needed, tests can manually truncate tables or clear buckets between tests using the helper functions in `@wallpaperdb/test-utils/helpers`.

---

This TesterBuilder architecture provides the flexibility, composability, compile-time safety, and maintainability needed for a growing test suite across multiple workspaces. 🚀
