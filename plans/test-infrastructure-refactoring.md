# Test Infrastructure Refactoring Plan

## Overview

This plan addresses the test setup duplication and complexity across the `apps/ingestor` and `apps/ingestor-e2e` workspaces by introducing a **mixin-based test builder pattern** that provides a unified, flexible API for test environment setup.

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

## Solution: Mixin-Based Test Builder

### Architecture Overview

**Core Concept**: Use TypeScript mixins to compose test environments from reusable building blocks. Each mixin adds specific capabilities and can declare dependencies on other mixins.

```typescript
// Example: Integration test setup
const env = await new TestEnvironmentBuilder()
  .with(PostgresMixin())
  .with(MinioMixin())
  .with(NatsMixin({ jetStream: true }))
  .with(IngestorMigrationsMixin())  // Requires PostgresMixin
  .with(InProcessIngestorMixin())   // Requires Postgres, Minio, Nats
  .build();

// Example: E2E test setup
const env = await new TestEnvironmentBuilder()
  .with(DockerNetworkMixin())
  .with(PostgresMixin({ network: true }))
  .with(MinioMixin({ network: true }))
  .with(NatsMixin({ network: true }))
  .with(IngestorMigrationsMixin())
  .with(ContainerizedIngestorMixin({ instances: 1 }))
  .build();

// Example: Distributed rate limiting test
const env = await new TestEnvironmentBuilder()
  .with(DockerNetworkMixin())
  .with(PostgresMixin({ network: true }))
  .with(MinioMixin({ network: true }))
  .with(NatsMixin({ network: true }))
  .with(RedisMixin({ network: true }))
  .with(IngestorMigrationsMixin())
  .with(ContainerizedIngestorMixin({
    instances: 3,
    config: { redis: { enabled: true } }
  }))
  .build();
```

### Key Design Principles

1. **Separation of Concerns**: Infrastructure, workspace-specific logic, and utilities are separate
2. **Type-Safe Dependencies**: Mixins can require other mixins (enforced at compile-time)
3. **Composability**: Mix and match components for any test scenario
4. **No Duplication**: Each concern implemented once and reused everywhere
5. **Backward Compatible**: Existing tests continue working during gradual migration

---

## Phase 1: Core Builder and Infrastructure Mixins

**Goal**: Create the foundation - the builder pattern implementation and base infrastructure mixins that work for any workspace.

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

### 1.2 Implement Core Builder

**File**: `packages/test-utils/src/builder/types.ts`

```typescript
import type { StartedNetwork, StartedPostgreSqlContainer } from 'testcontainers';
import type { StartedMinioContainer } from '@testcontainers/minio';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { StartedNatsContainer } from '@wallpaperdb/testcontainers';
import type { GenericContainer, StartedTestContainer } from 'testcontainers';

/**
 * Context shared across all mixins
 * Mixins populate this during their setup phase
 */
export interface TestEnvironmentContext {
  // Infrastructure containers
  network?: StartedNetwork;
  postgres?: {
    container: StartedPostgreSqlContainer;
    connectionString: string;
    host: string;
    port: number;
    database: string;
  };
  minio?: {
    container: StartedMinioContainer;
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket?: string;
  };
  nats?: {
    container: StartedNatsContainer;
    url: string;
    streamName?: string;
  };
  redis?: {
    container: StartedRedisContainer;
    url: string;
    host: string;
    port: number;
  };

  // Application containers (workspace-specific)
  ingestorContainers?: StartedTestContainer[];
  ingestorBaseUrl?: string;

  // Cleanup functions registered by mixins
  cleanupFunctions: Array<() => Promise<void>>;

  // Custom data (for workspace-specific mixins)
  custom: Record<string, unknown>;
}

/**
 * Mixin interface - all mixins implement this
 */
export interface TestEnvironmentMixin {
  /** Unique identifier for this mixin */
  readonly name: string;

  /** Mixins that must be applied before this one */
  readonly dependencies?: string[];

  /** Setup logic - mutates context */
  setup(context: TestEnvironmentContext): Promise<void>;

  /** Optional teardown logic */
  teardown?(context: TestEnvironmentContext): Promise<void>;
}

/**
 * Built test environment - returned by builder.build()
 */
export interface TestEnvironment {
  /** Access to the shared context */
  readonly context: Readonly<TestEnvironmentContext>;

  /** Clean up resources (per-test cleanup) */
  cleanup(): Promise<void>;

  /** Tear down all infrastructure (after all tests) */
  teardown(): Promise<void>;
}
```

---

**File**: `packages/test-utils/src/builder/TestEnvironmentBuilder.ts`

```typescript
import type {
  TestEnvironmentContext,
  TestEnvironmentMixin,
  TestEnvironment,
} from './types.js';

export class TestEnvironmentBuilder {
  private mixins: TestEnvironmentMixin[] = [];

  /**
   * Add a mixin to the builder
   * Mixins are applied in the order they're added
   */
  with(mixin: TestEnvironmentMixin): this {
    this.mixins.push(mixin);
    return this;
  }

  /**
   * Build the test environment
   * - Validates mixin dependencies
   * - Runs setup in order
   * - Returns TestEnvironment with cleanup/teardown
   */
  async build(): Promise<TestEnvironment> {
    // Initialize empty context
    const context: TestEnvironmentContext = {
      cleanupFunctions: [],
      custom: {},
    };

    // Validate dependencies
    this.validateDependencies();

    // Run setup for each mixin in order
    for (const mixin of this.mixins) {
      console.log(`Setting up mixin: ${mixin.name}`);
      await mixin.setup(context);
    }

    console.log('Test environment ready');

    // Return environment with cleanup/teardown
    return {
      context: context as Readonly<TestEnvironmentContext>,

      async cleanup() {
        // Run cleanup functions in reverse order
        for (const cleanupFn of context.cleanupFunctions.reverse()) {
          await cleanupFn();
        }
        // Reset cleanup array
        context.cleanupFunctions = [];
      },

      async teardown() {
        // Run mixin teardown in reverse order
        for (const mixin of [...this.mixins].reverse()) {
          if (mixin.teardown) {
            console.log(`Tearing down mixin: ${mixin.name}`);
            await mixin.teardown(context);
          }
        }
        console.log('Test environment torn down');
      },
    };
  }

  /**
   * Validate that all mixin dependencies are satisfied
   * Throws error if dependencies missing or circular
   */
  private validateDependencies(): void {
    const mixinNames = new Set(this.mixins.map(m => m.name));

    for (const mixin of this.mixins) {
      if (!mixin.dependencies) continue;

      for (const dep of mixin.dependencies) {
        if (!mixinNames.has(dep)) {
          throw new Error(
            `Mixin "${mixin.name}" requires "${dep}" but it was not added to the builder. ` +
            `Add it with: .with(${dep}Mixin())`
          );
        }

        // Check that dependency comes before dependent
        const depIndex = this.mixins.findIndex(m => m.name === dep);
        const mixinIndex = this.mixins.findIndex(m => m.name === mixin.name);

        if (depIndex > mixinIndex) {
          throw new Error(
            `Mixin "${mixin.name}" depends on "${dep}" but "${dep}" was added after. ` +
            `Add mixins in dependency order.`
          );
        }
      }
    }
  }
}
```

---

### 1.3 Implement Infrastructure Mixins

**File**: `packages/test-utils/src/mixins/DockerNetworkMixin.ts`

```typescript
import { Network } from 'testcontainers';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '../builder/types.js';

export interface DockerNetworkOptions {
  name?: string;
}

export function DockerNetworkMixin(options: DockerNetworkOptions = {}): TestEnvironmentMixin {
  return {
    name: 'DockerNetwork',

    async setup(context) {
      console.log('Creating Docker network...');

      const network = await new Network({
        name: options.name || `test-network-${Date.now()}`,
      }).start();

      context.network = network;
      console.log(`Docker network created: ${network.getName()}`);
    },

    async teardown(context) {
      if (context.network) {
        console.log('Stopping Docker network...');
        await context.network.stop();
      }
    },
  };
}
```

---

**File**: `packages/test-utils/src/mixins/PostgresMixin.ts`

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '../builder/types.js';

export interface PostgresOptions {
  image?: string;
  database?: string;
  username?: string;
  password?: string;
  network?: boolean;  // If true, requires DockerNetworkMixin
  networkAlias?: string;
}

export function PostgresMixin(options: PostgresOptions = {}): TestEnvironmentMixin {
  const {
    image = 'postgres:16-alpine',
    database = `test_db_${Date.now()}`,
    username = 'test',
    password = 'test',
    network = false,
    networkAlias = 'postgres',
  } = options;

  return {
    name: 'Postgres',
    dependencies: network ? ['DockerNetwork'] : undefined,

    async setup(context) {
      console.log('Starting PostgreSQL container...');

      let container = new PostgreSqlContainer(image)
        .withDatabase(database)
        .withUsername(username)
        .withPassword(password);

      if (network && context.network) {
        container = container
          .withNetwork(context.network)
          .withNetworkAliases(networkAlias);
      }

      const started = await container.start();

      // Build connection strings
      const host = network ? networkAlias : started.getHost();
      const port = network ? 5432 : started.getPort();

      const connectionString = network
        ? `postgresql://${username}:${password}@${networkAlias}:5432/${database}`
        : started.getConnectionUri();

      context.postgres = {
        container: started,
        connectionString,
        host,
        port,
        database,
      };

      console.log(`PostgreSQL started: ${connectionString}`);
    },

    async teardown(context) {
      if (context.postgres) {
        console.log('Stopping PostgreSQL container...');
        await context.postgres.container.stop();
      }
    },
  };
}
```

---

**File**: `packages/test-utils/src/mixins/MinioMixin.ts`

```typescript
import { MinioContainer } from '@testcontainers/minio';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '../builder/types.js';

export interface MinioOptions {
  image?: string;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;  // Auto-create bucket if provided
  network?: boolean;
  networkAlias?: string;
}

export function MinioMixin(options: MinioOptions = {}): TestEnvironmentMixin {
  const {
    image = 'minio/minio:latest',
    accessKey = 'minioadmin',
    secretKey = 'minioadmin',
    bucket,
    network = false,
    networkAlias = 'minio',
  } = options;

  return {
    name: 'Minio',
    dependencies: network ? ['DockerNetwork'] : undefined,

    async setup(context) {
      console.log('Starting MinIO container...');

      let container = new MinioContainer(image)
        .withUsername(accessKey)
        .withUserPassword(secretKey);

      if (network && context.network) {
        container = container
          .withNetwork(context.network)
          .withNetworkAliases(networkAlias);
      }

      const started = await container.start();

      const endpoint = network
        ? `http://${networkAlias}:9000`
        : `http://${started.getHost()}:${started.getPort()}`;

      context.minio = {
        container: started,
        endpoint,
        accessKey,
        secretKey,
      };

      // Create bucket if specified
      if (bucket) {
        const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
        const s3Client = new S3Client({
          endpoint: `http://127.0.0.1:${started.getPort()}`,
          region: 'us-east-1',
          credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
          },
          forcePathStyle: true,
        });

        try {
          await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
          console.log(`Created S3 bucket: ${bucket}`);
          context.minio.bucket = bucket;
        } catch (error) {
          if ((error as Error).name !== 'BucketAlreadyOwnedByYou') {
            throw error;
          }
        }
      }

      console.log(`MinIO started: ${endpoint}`);
    },

    async teardown(context) {
      if (context.minio) {
        console.log('Stopping MinIO container...');
        await context.minio.container.stop();
      }
    },
  };
}
```

---

**File**: `packages/test-utils/src/mixins/NatsMixin.ts`

```typescript
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '../builder/types.js';

export interface NatsOptions {
  image?: string;
  jetStream?: boolean;
  streamName?: string;  // Auto-create stream if provided
  network?: boolean;
  networkAlias?: string;
}

export function NatsMixin(options: NatsOptions = {}): TestEnvironmentMixin {
  const {
    image = 'nats:2.10-alpine',
    jetStream = true,
    streamName,
    network = false,
    networkAlias = 'nats',
  } = options;

  return {
    name: 'Nats',
    dependencies: network ? ['DockerNetwork'] : undefined,

    async setup(context) {
      console.log('Starting NATS container...');

      const started = await createNatsContainer({
        image,
        enableJetStream: jetStream,
        network: network ? context.network : undefined,
        networkAliases: network ? [networkAlias] : undefined,
      });

      const url = network
        ? `nats://${networkAlias}:4222`
        : started.getConnectionUrl();

      context.nats = {
        container: started,
        url,
      };

      // Create JetStream stream if specified
      if (jetStream && streamName) {
        const { connect, StreamConfig } = await import('nats');
        const nc = await connect({ servers: started.getConnectionUrl() });
        const jsm = await nc.jetstreamManager();

        const streamConfig: Partial<StreamConfig> = {
          name: streamName,
          subjects: [`${streamName.toLowerCase()}.*`],
        };

        try {
          await jsm.streams.add(streamConfig);
          console.log(`Created NATS stream: ${streamName}`);
          context.nats.streamName = streamName;
        } catch (error) {
          if (!(error as Error).message.includes('already exists')) {
            throw error;
          }
        }

        await nc.close();
      }

      console.log(`NATS started: ${url}`);
    },

    async teardown(context) {
      if (context.nats) {
        console.log('Stopping NATS container...');
        await context.nats.container.stop();
      }
    },
  };
}
```

---

**File**: `packages/test-utils/src/mixins/RedisMixin.ts`

```typescript
import { RedisContainer } from '@testcontainers/redis';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '../builder/types.js';

export interface RedisOptions {
  image?: string;
  network?: boolean;
  networkAlias?: string;
}

export function RedisMixin(options: RedisOptions = {}): TestEnvironmentMixin {
  const {
    image = 'redis:7-alpine',
    network = false,
    networkAlias = 'redis',
  } = options;

  return {
    name: 'Redis',
    dependencies: network ? ['DockerNetwork'] : undefined,

    async setup(context) {
      console.log('Starting Redis container...');

      let container = new RedisContainer(image);

      if (network && context.network) {
        container = container
          .withNetwork(context.network)
          .withNetworkAliases(networkAlias);
      }

      const started = await container.start();

      const host = network ? networkAlias : started.getHost();
      const port = network ? 6379 : started.getPort();
      const url = `redis://${host}:${port}`;

      context.redis = {
        container: started,
        url,
        host,
        port,
      };

      console.log(`Redis started: ${url}`);
    },

    async teardown(context) {
      if (context.redis) {
        console.log('Stopping Redis container...');
        await context.redis.container.stop();
      }
    },
  };
}
```

---

### 1.4 Export Core Builder

**File**: `packages/test-utils/src/index.ts`

```typescript
// Builder
export { TestEnvironmentBuilder } from './builder/TestEnvironmentBuilder.js';
export type {
  TestEnvironment,
  TestEnvironmentContext,
  TestEnvironmentMixin,
} from './builder/types.js';

// Infrastructure mixins
export { DockerNetworkMixin } from './mixins/DockerNetworkMixin.js';
export type { DockerNetworkOptions } from './mixins/DockerNetworkMixin.js';

export { PostgresMixin } from './mixins/PostgresMixin.js';
export type { PostgresOptions } from './mixins/PostgresMixin.js';

export { MinioMixin } from './mixins/MinioMixin.js';
export type { MinioOptions } from './mixins/MinioMixin.js';

export { NatsMixin } from './mixins/NatsMixin.js';
export type { NatsOptions } from './mixins/NatsMixin.js';

export { RedisMixin } from './mixins/RedisMixin.js';
export type { RedisOptions } from './mixins/RedisMixin.js';
```

---

## Phase 2: Workspace-Specific Mixins

**Goal**: Add workspace-specific mixins that depend on infrastructure mixins (e.g., database migrations, application deployment).

### 2.1 Create Ingestor-Specific Mixins

These mixins live in the **workspace** (not shared package) because they depend on workspace-specific code.

**File**: `apps/ingestor/test/mixins/IngestorMigrationsMixin.ts`

```typescript
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '@wallpaperdb/test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IngestorMigrationsOptions {
  /** Path to migration SQL file (relative to workspace root) */
  migrationPath?: string;
}

export function IngestorMigrationsMixin(
  options: IngestorMigrationsOptions = {}
): TestEnvironmentMixin {
  const {
    migrationPath = join(__dirname, '../../drizzle/0000_left_starjammers.sql'),
  } = options;

  return {
    name: 'IngestorMigrations',
    dependencies: ['Postgres'],

    async setup(context) {
      if (!context.postgres) {
        throw new Error('PostgresMixin must be applied before IngestorMigrationsMixin');
      }

      console.log('Applying ingestor database migrations...');

      const sql = postgres(context.postgres.connectionString, { max: 1 });

      try {
        const migrationSql = readFileSync(migrationPath, 'utf-8');
        await sql.unsafe(migrationSql);
        console.log('Database migrations applied');
      } finally {
        await sql.end();
      }
    },
  };
}
```

---

**File**: `apps/ingestor/test/mixins/InProcessIngestorMixin.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '@wallpaperdb/test-utils';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

export interface InProcessIngestorOptions {
  /** Config overrides (e.g., rate limits, reconciliation intervals) */
  configOverrides?: Record<string, unknown>;
}

export function InProcessIngestorMixin(
  options: InProcessIngestorOptions = {}
): TestEnvironmentMixin {
  return {
    name: 'InProcessIngestor',
    dependencies: ['Postgres', 'Minio', 'Nats'],

    async setup(context) {
      if (!context.postgres || !context.minio || !context.nats) {
        throw new Error('InProcessIngestorMixin requires Postgres, Minio, and Nats');
      }

      console.log('Creating in-process Fastify app...');

      // Set environment variables for loadConfig()
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = context.postgres.connectionString;
      process.env.S3_ENDPOINT = context.minio.endpoint;
      process.env.S3_ACCESS_KEY = context.minio.accessKey;
      process.env.S3_SECRET_KEY = context.minio.secretKey;
      process.env.S3_BUCKET = context.minio.bucket || 'wallpapers';
      process.env.NATS_URL = context.nats.url;

      // Apply config overrides
      if (options.configOverrides) {
        for (const [key, value] of Object.entries(options.configOverrides)) {
          process.env[key] = String(value);
        }
      }

      const config = loadConfig();
      const app = await createApp(config);

      // Store app in custom context
      context.custom.ingestorApp = app;

      console.log('In-process Fastify app ready');
    },

    async teardown(context) {
      const app = context.custom.ingestorApp as FastifyInstance | undefined;
      if (app) {
        console.log('Closing in-process Fastify app...');
        await app.close();
      }
    },
  };
}
```

---

**File**: `apps/ingestor/test/mixins/ContainerizedIngestorMixin.ts`

```typescript
import { GenericContainer, Wait } from 'testcontainers';
import type { TestEnvironmentMixin, TestEnvironmentContext } from '@wallpaperdb/test-utils';

export interface ContainerizedIngestorOptions {
  /** Number of ingestor instances to start */
  instances?: number;

  /** Docker image name (must be built beforehand) */
  image?: string;

  /** Config overrides passed as environment variables */
  config?: Record<string, unknown>;
}

export function ContainerizedIngestorMixin(
  options: ContainerizedIngestorOptions = {}
): TestEnvironmentMixin {
  const {
    instances = 1,
    image = 'wallpaperdb-ingestor:latest',
    config = {},
  } = options;

  return {
    name: 'ContainerizedIngestor',
    dependencies: ['DockerNetwork', 'Postgres', 'Minio', 'Nats'],

    async setup(context) {
      if (!context.network || !context.postgres || !context.minio || !context.nats) {
        throw new Error('ContainerizedIngestorMixin requires DockerNetwork, Postgres, Minio, and Nats');
      }

      console.log(`Starting ${instances} ingestor container(s)...`);

      const containers = [];

      for (let i = 0; i < instances; i++) {
        const container = await new GenericContainer(image)
          .withNetwork(context.network)
          .withNetworkAliases(`ingestor-${i}`)
          .withEnvironment({
            NODE_ENV: 'test',
            DATABASE_URL: context.postgres.connectionString,
            S3_ENDPOINT: context.minio.endpoint,
            S3_ACCESS_KEY: context.minio.accessKey,
            S3_SECRET_KEY: context.minio.secretKey,
            S3_BUCKET: context.minio.bucket || 'wallpapers',
            NATS_URL: context.nats.url,
            // Redis if present
            ...(context.redis ? { REDIS_URL: context.redis.url } : {}),
            // Custom config overrides
            ...Object.fromEntries(
              Object.entries(config).map(([k, v]) => [k, String(v)])
            ),
          })
          .withExposedPorts(3000)
          .withWaitStrategy(Wait.forHttp('/health', 3000))
          .start();

        console.log(`Ingestor instance ${i} started at ${container.getHost()}:${container.getMappedPort(3000)}`);
        containers.push(container);
      }

      // Store containers and base URL (first instance)
      context.ingestorContainers = containers;
      context.ingestorBaseUrl = `http://${containers[0].getHost()}:${containers[0].getMappedPort(3000)}`;

      console.log(`All ${instances} ingestor instances ready`);
    },

    async teardown(context) {
      if (context.ingestorContainers) {
        console.log('Stopping ingestor containers...');
        await Promise.all(
          context.ingestorContainers.map(c => c.stop())
        );
      }
    },
  };
}
```

---

### 2.2 Export Ingestor Mixins

**File**: `apps/ingestor/test/mixins/index.ts`

```typescript
export { IngestorMigrationsMixin } from './IngestorMigrationsMixin.js';
export type { IngestorMigrationsOptions } from './IngestorMigrationsMixin.js';

export { InProcessIngestorMixin } from './InProcessIngestorMixin.js';
export type { InProcessIngestorOptions } from './InProcessIngestorMixin.js';

export { ContainerizedIngestorMixin } from './ContainerizedIngestorMixin.js';
export type { ContainerizedIngestorOptions } from './ContainerizedIngestorMixin.js';
```

---

### 2.3 Re-Export for E2E Tests

E2E tests can import from the main ingestor workspace:

**File**: `apps/ingestor-e2e/test/mixins/index.ts`

```typescript
// Re-export ingestor mixins for E2E tests
export {
  IngestorMigrationsMixin,
  ContainerizedIngestorMixin,
} from '../../../ingestor/test/mixins/index.js';

// Note: E2E tests don't use InProcessIngestorMixin
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

**After** (with builder):
```typescript
import { describe, it, beforeAll, afterAll } from 'vitest';
import { TestEnvironmentBuilder, PostgresMixin, MinioMixin, NatsMixin } from '@wallpaperdb/test-utils';
import { IngestorMigrationsMixin, InProcessIngestorMixin } from './mixins/index.js';
import type { FastifyInstance } from 'fastify';

describe('Upload Flow (Builder)', () => {
  let env: Awaited<ReturnType<typeof TestEnvironmentBuilder.prototype.build>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    env = await new TestEnvironmentBuilder()
      .with(PostgresMixin({ database: 'upload_flow_test' }))
      .with(MinioMixin({ bucket: 'test-bucket' }))
      .with(NatsMixin({ jetStream: true, streamName: 'WALLPAPERS' }))
      .with(IngestorMigrationsMixin())
      .with(InProcessIngestorMixin())
      .build();

    app = env.context.custom.ingestorApp as FastifyInstance;
  });

  afterAll(async () => {
    await env.teardown();
  });

  // ... tests (no changes needed!)
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
- [ ] Migrate `apps/ingestor/test/rate-limiting-distributed.test.ts` (add RedisMixin)
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
2. Implement `TestEnvironmentBuilder` and type definitions
3. Implement infrastructure mixins (Postgres, MinIO, NATS, Redis, DockerNetwork)
4. Write unit tests for builder (dependency validation, setup order)
5. **Commit**: "Add test-utils package with mixin-based builder"

### Step 2: Workspace Mixins (Phase 2)
1. Create `apps/ingestor/test/mixins/` directory
2. Implement `IngestorMigrationsMixin`
3. Implement `InProcessIngestorMixin`
4. Implement `ContainerizedIngestorMixin`
5. **Commit**: "Add ingestor-specific test mixins"

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
✅ Builder validates mixin dependencies at compile-time and runtime
✅ Distributed tests work without separate config
✅ E2E tests work with containerized deployment

### Developer Experience
✅ New test scenarios require <10 lines of setup code
✅ Adding new infrastructure (e.g., Kafka) = 1 new mixin, reused everywhere
✅ Clear error messages when dependencies missing
✅ Documentation includes examples for common scenarios

### Performance
✅ Test startup time unchanged or faster (parallel container startup)
✅ Container reuse possible (future optimization: shared containers across test files)

---

## Expected Benefits

### Immediate Benefits
1. **Zero Duplication**: Each infrastructure concern implemented once
2. **Composability**: Mix and match components for any test scenario
3. **Type Safety**: Mixin dependencies enforced at compile-time
4. **Clarity**: Declarative setup reads like documentation
5. **No Workarounds**: Distributed tests no longer need separate configs

### Future Benefits
1. **Extensibility**: New workspaces (e.g., `apps/processor`) can reuse infrastructure mixins
2. **Optimization**: Shared container pools across tests (advanced)
3. **Testability**: Each mixin tested in isolation
4. **Maintainability**: Change database schema? Update one mixin, all tests benefit

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

### After (Mixin-Based)

**Required**:
- Test file with builder setup (12 lines)
- No separate config needed!

**Total**: ~12 lines of setup code

```typescript
// apps/ingestor-e2e/test/rate-limiting-distributed.e2e.test.ts (AFTER)
import { describe, it, beforeAll, afterAll } from 'vitest';
import { TestEnvironmentBuilder, PostgresMixin, MinioMixin, NatsMixin, RedisMixin, DockerNetworkMixin } from '@wallpaperdb/test-utils';
import { IngestorMigrationsMixin, ContainerizedIngestorMixin } from './mixins/index.js';

describe('Distributed Rate Limiting', () => {
  let env: Awaited<ReturnType<typeof TestEnvironmentBuilder.prototype.build>>;

  beforeAll(async () => {
    env = await new TestEnvironmentBuilder()
      .with(DockerNetworkMixin())
      .with(PostgresMixin({ network: true }))
      .with(MinioMixin({ network: true, bucket: 'test' }))
      .with(NatsMixin({ network: true, jetStream: true }))
      .with(RedisMixin({ network: true }))
      .with(IngestorMigrationsMixin())
      .with(ContainerizedIngestorMixin({ instances: 3, config: { redis: { enabled: true } } }))
      .build();
  });

  afterAll(async () => {
    await env.teardown();
  });

  // ... tests (no changes!)
});
```

**Reduction**: ~230 lines → ~12 lines (95% reduction)
**No separate config file needed!**

---

## Notes

### Why Mixins Over Single Builder?

**Mixins** provide:
1. **Workspace Isolation**: Ingestor-specific logic stays in `apps/ingestor/test/mixins/`
2. **Dependency Declaration**: `IngestorMigrationsMixin` explicitly requires `PostgresMixin`
3. **Reusability**: Infrastructure mixins shared, workspace mixins stay local
4. **Testability**: Each mixin tested independently
5. **Discoverability**: IDE autocomplete shows available mixins

**Alternatives Considered**:
- Single builder with methods: Would require all workspaces to depend on shared package
- Factory functions: Less composable, harder to express dependencies
- Plugins: More complex, overkill for this use case

### Mixin Dependency Resolution

The builder validates dependencies at **build time**:
- Checks that required mixins are present
- Checks that dependencies are added in correct order
- Provides clear error messages with fix suggestions

Example error:
```
Error: Mixin "IngestorMigrations" requires "Postgres" but it was not added to the builder.
Add it with: .with(PostgresMixin())
```

### Cleanup vs Teardown

**Cleanup**: Per-test cleanup (e.g., delete S3 objects, truncate tables)
- Called after each test
- Leaves infrastructure running
- Fast (no container restarts)

**Teardown**: Full infrastructure teardown
- Called once after all tests
- Stops containers
- Used in `afterAll()`

---

This mixin-based architecture provides the flexibility, composability, and maintainability needed for a growing test suite across multiple workspaces. 🚀
