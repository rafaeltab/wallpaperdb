# Creating Custom Builders

Custom builders encapsulate application-specific test setup, making tests cleaner and more maintainable. This guide shows you how to create your own builders using real examples from the ingestor package.

## Table of Contents

- [Why Create Custom Builders](#why-create-custom-builders)
- [Step-by-Step Tutorial](#step-by-step-tutorial)
- [Real Example 1: Database Migrations](#real-example-1-database-migrations)
- [Real Example 2: In-Process Application](#real-example-2-in-process-application)
- [Real Example 3: Containerized Application](#real-example-3-containerized-application)
- [Type Safety Patterns](#type-safety-patterns)
- [Common Patterns](#common-patterns)

## Why Create Custom Builders

Custom builders help you:

✅ **Encapsulate setup logic** - Keep test files clean
✅ **Reuse across tests** - Write once, use everywhere
✅ **Maintain type safety** - Catch errors at compile time
✅ **Express dependencies** - Declare what infrastructure you need
✅ **Follow DRY principle** - Don't repeat setup code

### When to Create a Custom Builder

Create a custom builder when you have:

- Database migrations or schema setup
- Application lifecycle management
- Test data fixtures
- Custom container configurations
- Multi-step setup procedures

## Step-by-Step Tutorial

### Step 1: Extend BaseTesterBuilder

```typescript
import { BaseTesterBuilder, type AddMethodsType } from "@wallpaperdb/test-utils";

export class MyCustomTesterBuilder extends BaseTesterBuilder<
  "MyCustom",              // Unique name
  [/* Dependencies */]     // Array of required builders
> {
  readonly name = "MyCustom" as const;

  constructor() {
    super();
  }
}
```

### Step 2: Declare Dependencies

List the builders your custom builder needs:

```typescript
export class MyCustomTesterBuilder extends BaseTesterBuilder<
  "MyCustom",
  [PostgresTesterBuilder, MinioTesterBuilder]  // Requires both
> {
  readonly name = "MyCustom" as const;
}
```

TypeScript will enforce that these are added before your builder.

### Step 3: Implement addMethods

The `addMethods` method extends the base tester with your functionality:

```typescript
addMethods<
  TBase extends AddMethodsType<[PostgresTesterBuilder, MinioTesterBuilder]>
>(Base: TBase) {
  return class extends Base {
    // Your setup logic here

    override async setup(): Promise<void> {
      await super.setup();  // IMPORTANT: Call parent setup first

      // Your setup code
      console.log("Running custom setup...");
    }

    override async destroy(): Promise<void> {
      // Your cleanup code
      console.log("Running custom cleanup...");

      await super.destroy();  // IMPORTANT: Call parent destroy last
    }
  };
}
```

### Step 4: Add Lifecycle Hooks

Use `setup()` for initialization and `destroy()` for cleanup:

```typescript
addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
  return class extends Base {
    private myResource: SomeResource | null = null;

    override async setup(): Promise<void> {
      await super.setup();

      // Initialize your resource
      this.myResource = await createResource();
    }

    override async destroy(): Promise<void> {
      // Clean up your resource
      if (this.myResource) {
        await this.myResource.close();
        this.myResource = null;
      }

      await super.destroy();
    }
  };
}
```

### Step 5: Provide Accessor Methods

Add getter methods to access your resources:

```typescript
addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
  return class extends Base {
    private myResource: SomeResource | null = null;

    override async setup(): Promise<void> {
      await super.setup();
      this.myResource = await createResource();
    }

    override async destroy(): Promise<void> {
      if (this.myResource) {
        await this.myResource.close();
        this.myResource = null;
      }
      await super.destroy();
    }

    // Accessor method
    getMyResource(): SomeResource {
      if (!this.myResource) {
        throw new Error("Resource not initialized. Call setup() first.");
      }
      return this.myResource;
    }
  };
}
```

### Step 6: Export and Use

```typescript
// Export from your builders/index.ts
export { MyCustomTesterBuilder } from "./MyCustomBuilder.js";

// Use in tests
import { MyCustomTesterBuilder } from "./builders/index.js";

const TesterClass = createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(MyCustomTesterBuilder)  // Your custom builder
  .build();

const tester = new TesterClass();
await tester.setup();

const resource = tester.getMyResource();  // Access your resource
```

## Real Example 1: Database Migrations

**Use Case:** Apply database migrations before running tests.

**File:** `apps/ingestor/test/builders/IngestorMigrationsBuilder.ts`

```typescript
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import createPostgresClient from "postgres";
import {
  BaseTesterBuilder,
  type PostgresTesterBuilder,
  type AddMethodsType,
} from "@wallpaperdb/test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IngestorMigrationsOptions {
  migrationPath?: string;
}

export class IngestorMigrationsTesterBuilder extends BaseTesterBuilder<
  "IngestorMigrations",
  [PostgresTesterBuilder]  // Only needs Postgres
> {
  readonly name = "IngestorMigrations" as const;
  private options: IngestorMigrationsOptions;

  constructor(options: IngestorMigrationsOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(
    Base: TBase,
  ) {
    const migrationPath =
      this.options.migrationPath ??
      join(__dirname, "../../drizzle/0000_left_starjammers.sql");

    return class extends Base {
      override async setup(): Promise<void> {
        await super.setup();

        const postgres = this.getPostgres();  // Access Postgres from parent

        console.log("Applying ingestor database migrations...");

        // Create temporary connection for migrations
        const sql = createPostgresClient(postgres.connectionString, { max: 1 });

        try {
          const migrationSql = readFileSync(migrationPath, "utf-8");
          await sql.unsafe(migrationSql);
          console.log("Database migrations applied successfully");
        } finally {
          await sql.end();  // Always close connection
        }
      }
    };
  }
}
```

**Usage:**

```typescript
createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)  // Migrations run automatically
  .build();
```

**Key Points:**
- Reads SQL file from disk
- Creates temporary Postgres connection
- Closes connection in `finally` block
- No destroy needed (no persistent resources)

## Real Example 2: In-Process Application

**Use Case:** Run your Fastify application in the same Node.js process as tests.

**File:** `apps/ingestor/test/builders/InProcessIngestorBuilder.ts`

```typescript
import type { FastifyInstance } from "fastify";
import {
  BaseTesterBuilder,
  type PostgresTesterBuilder,
  type MinioTesterBuilder,
  type NatsTesterBuilder,
  type AddMethodsType,
} from "@wallpaperdb/test-utils";
import { createApp } from "../../src/app.js";

export interface InProcessIngestorOptions {
  configOverrides?: Record<string, unknown>;
  logger?: boolean;
}

export class InProcessIngestorTesterBuilder extends BaseTesterBuilder<
  "InProcessIngestor",
  [PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
> {
  readonly name = "InProcessIngestor" as const;
  private options: InProcessIngestorOptions;

  constructor(options: InProcessIngestorOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<
    TBase extends AddMethodsType<
      [PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
    >,
  >(Base: TBase) {
    const options = this.options;

    return class extends Base {
      private app: FastifyInstance | null = null;

      override async setup(): Promise<void> {
        await super.setup();

        // Get connection info from parent builders
        const postgres = this.getPostgres();
        const minio = this.getMinio();
        const nats = this.getNats();

        console.log("Creating in-process Fastify app...");

        // Set environment variables for app config
        process.env.NODE_ENV = "test";
        process.env.DATABASE_URL = postgres.connectionString;
        process.env.S3_ENDPOINT = minio.endpoint;
        process.env.S3_ACCESS_KEY_ID = minio.options.accessKey;
        process.env.S3_SECRET_ACCESS_KEY = minio.options.secretKey;
        process.env.S3_BUCKET =
          minio.buckets.length > 0 ? minio.buckets[0] : "wallpapers";
        process.env.NATS_URL = nats.endpoint;
        process.env.NATS_STREAM =
          nats.streams.length > 0 ? nats.streams[0] : "WALLPAPERS";
        process.env.REDIS_ENABLED = "false";  // Disable Redis by default

        // Apply config overrides
        if (options.configOverrides) {
          for (const [key, value] of Object.entries(options.configOverrides)) {
            if (value !== undefined) {
              // Convert camelCase to SCREAMING_SNAKE_CASE
              const envKey = key
                .replace(/([A-Z])/g, "_$1")
                .toUpperCase()
                .replace(/^_/, "");
              process.env[envKey] = String(value);
            }
          }
        }

        // Import config and create app
        const { loadConfig } = await import("../../src/config.js");
        const config = loadConfig();

        this.app = await createApp(config, {
          logger: options.logger ?? false,
          enableOtel: false,
        });

        console.log("In-process Fastify app ready");
      }

      override async destroy(): Promise<void> {
        if (this.app) {
          console.log("Closing in-process Fastify app...");
          await this.app.close();
          this.app = null;
        }
        await super.destroy();
      }

      getApp(): FastifyInstance {
        if (!this.app) {
          throw new Error("App not initialized. Did you call setup() first?");
        }
        return this.app;
      }
    };
  }
}
```

**Usage:**

```typescript
const TesterClass = createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessIngestorTesterBuilder, { logger: false })
  .build();

const tester = new TesterClass();
await tester.setup();

const app = tester.getApp();
const response = await app.inject({ method: "GET", url: "/health" });
```

**Key Points:**
- Sets environment variables from container configs
- Imports and calls application factory
- Provides `getApp()` accessor
- Closes Fastify app in `destroy()`

## Real Example 3: Containerized Application

**Use Case:** Run your application as a Docker container for E2E tests.

**File:** `apps/ingestor-e2e/test/builders/ContainerizedIngestorBuilder.ts`

```typescript
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import {
  BaseTesterBuilder,
  type DockerTesterBuilder,
  type PostgresTesterBuilder,
  type MinioTesterBuilder,
  type NatsTesterBuilder,
  type AddMethodsType,
} from "@wallpaperdb/test-utils";

export interface ContainerizedIngestorOptions {
  instances?: number;
  image?: string;
  config?: Record<string, unknown>;
}

export class ContainerizedIngestorTesterBuilder extends BaseTesterBuilder<
  "ContainerizedIngestor",
  [DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
> {
  readonly name = "ContainerizedIngestor" as const;
  private options: ContainerizedIngestorOptions;

  constructor(options: ContainerizedIngestorOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
    >,
  >(Base: TBase) {
    const options = this.options;

    return class extends Base {
      private containers: StartedTestContainer[] = [];
      private baseUrl: string | null = null;

      override async setup(): Promise<void> {
        await super.setup();

        const network = this.getNetwork();
        const postgres = this.getPostgres();
        const minio = this.getMinio();
        const nats = this.getNats();

        const instances = options.instances ?? 1;
        const image = options.image ?? "wallpaperdb-ingestor:latest";

        console.log(`Starting ${instances} ingestor container(s)...`);

        for (let i = 0; i < instances; i++) {
          const environment: Record<string, string> = {
            NODE_ENV: "test",
            DATABASE_URL: postgres.connectionString,
            S3_ENDPOINT: minio.endpoint,
            S3_ACCESS_KEY_ID: minio.options.accessKey,
            S3_SECRET_ACCESS_KEY: minio.options.secretKey,
            S3_BUCKET: minio.buckets[0] ?? "wallpapers",
            NATS_URL: nats.endpoint,
            NATS_STREAM: nats.streams[0] ?? "WALLPAPERS",
            PORT: "3001",
          };

          const container = await new GenericContainer(image)
            .withNetwork(network)
            .withNetworkAliases(`ingestor-${i}`)
            .withEnvironment(environment)
            .withExposedPorts(3001)
            .withWaitStrategy(
              Wait.forLogMessage(/Server is running on port/i),
            )
            .start();

          const host = container.getHost();
          const port = container.getMappedPort(3001);

          console.log(`Ingestor instance ${i} started at ${host}:${port}`);

          this.containers.push(container);

          if (i === 0) {
            this.baseUrl = `http://${host}:${port}`;
          }
        }

        console.log(`All ${instances} ingestor instances ready`);
      }

      override async destroy(): Promise<void> {
        if (this.containers.length > 0) {
          console.log("Stopping ingestor containers...");
          await Promise.all(this.containers.map((c) => c.stop()));
          this.containers = [];
        }
        await super.destroy();
      }

      getIngestorContainers(): StartedTestContainer[] {
        if (this.containers.length === 0) {
          throw new Error("Containers not initialized. Call setup() first.");
        }
        return this.containers;
      }

      getBaseUrl(): string {
        if (!this.baseUrl) {
          throw new Error("Base URL not initialized. Call setup() first.");
        }
        return this.baseUrl;
      }
    };
  }
}
```

**Usage:**

```typescript
const TesterClass = createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(ContainerizedIngestorTesterBuilder, { instances: 3 })
  .build();

const tester = new TesterClass();
tester.withNetwork();  // Network required for E2E
await tester.setup();

const baseUrl = tester.getBaseUrl();
const response = await fetch(`${baseUrl}/health`);
```

**Key Points:**
- Starts Docker container with GenericContainer
- Waits for log message to ensure readiness
- Supports multiple instances
- Stores base URL for HTTP requests
- Stops containers in `destroy()`

## Type Safety Patterns

### Pattern 1: Capture Options in Closure

```typescript
addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
  const options = this.options;  // Capture options

  return class extends Base {
    // Use `options` here, not `this.options`
    override async setup(): Promise<void> {
      await super.setup();
      console.log(options.someValue);  // ✅ Works
    }
  };
}
```

### Pattern 2: Store State in Returned Class

```typescript
return class extends Base {
  private myState: SomeType | null = null;  // State here, not in builder

  override async setup(): Promise<void> {
    this.myState = await initialize();
  }

  getState(): SomeType {
    if (!this.myState) {
      throw new Error("Not initialized");
    }
    return this.myState;
  }
};
```

### Pattern 3: Access Parent Builder Methods

```typescript
override async setup(): Promise<void> {
  await super.setup();

  // Access methods from parent builders
  const postgres = this.getPostgres();
  const minio = this.getMinio();
  const nats = this.getNats();

  // Use their data
  console.log(postgres.connectionString);
}
```

## Common Patterns

### Pattern: Database Migrations

```typescript
export class MigrationsTesterBuilder extends BaseTesterBuilder<
  "Migrations",
  [PostgresTesterBuilder]
> {
  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
    return class extends Base {
      override async setup(): Promise<void> {
        await super.setup();
        const { connectionString } = this.getPostgres();
        await applyMigrations(connectionString);
      }
    };
  }
}
```

### Pattern: Test Fixtures

```typescript
export class FixturesTesterBuilder extends BaseTesterBuilder<
  "Fixtures",
  [PostgresTesterBuilder]
> {
  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
    return class extends Base {
      override async setup(): Promise<void> {
        await super.setup();
        const { connectionString } = this.getPostgres();
        await seedTestData(connectionString);
      }

      // Provide helpers
      async createTestUser() {
        return await createUser(this.getPostgres().connectionString);
      }
    };
  }
}
```

### Pattern: Multi-Step Setup

```typescript
export class ComplexSetupTesterBuilder extends BaseTesterBuilder<
  "ComplexSetup",
  [PostgresTesterBuilder, MinioTesterBuilder]
> {
  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder, MinioTesterBuilder]>>(Base: TBase) {
    return class extends Base {
      override async setup(): Promise<void> {
        await super.setup();

        // Step 1: Database
        const postgres = this.getPostgres();
        await applyMigrations(postgres.connectionString);

        // Step 2: Storage
        const minio = this.getMinio();
        await uploadTestFiles(minio.endpoint);

        // Step 3: Verify
        await verifySetup();
      }
    };
  }
}
```

## Next Steps

- **[Integration vs E2E](./integration-vs-e2e.md)** - Choose the right test type for your builder
- **[API Reference](./api-reference.md)** - Complete type signatures
- **[Test Builder Pattern](./test-builder-pattern.md)** - Review core concepts
