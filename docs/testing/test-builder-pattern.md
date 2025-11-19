# TesterBuilder Pattern

The TesterBuilder pattern provides a composable, type-safe way to set up test infrastructure using Testcontainers. Instead of manually managing Docker containers in each test file, you compose reusable builders that handle setup and cleanup automatically.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Quick Start](#quick-start)
  - [Integration Test Example](#integration-test-example)
  - [E2E Test Example](#e2e-test-example)
- [Available Infrastructure Builders](#available-infrastructure-builders)
- [Best Practices](#best-practices)

## Core Concepts

### Composition Over Configuration

Instead of writing imperative setup code, you **declare** what infrastructure you need:

```typescript
// ❌ Old Way: Manual setup
const postgres = await new PostgreSqlContainer().start();
const minio = await new MinioContainer().start();
const nats = await createNatsContainer().start();
// ... manual cleanup in afterAll

// ✅ New Way: Builder composition
const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .build();

const tester = new TesterClass();
```

### Type-Safe Dependencies

Builders can declare dependencies on other builders. The TypeScript compiler **prevents** you from adding a builder without its dependencies:

```typescript
// ❌ This fails at compile time - PostgresTesterBuilder requires DockerTesterBuilder
createTesterBuilder()
  .with(PostgresTesterBuilder)  // Type error!

// ✅ This works - dependencies satisfied
createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)

// ✅ Most convenient - use default builder which includes DockerTesterBuilder
createDefaultTesterBuilder()
  .with(PostgresTesterBuilder)  // DockerTesterBuilder already included!
```

**Note:** All infrastructure builders (Postgres, MinIO, NATS, Redis) require `DockerTesterBuilder` as a dependency. Use `createDefaultTesterBuilder()` to avoid manually adding it every time.

### Lifecycle Management

Builders manage setup and cleanup automatically:

- **Setup Phase**: Builders execute in the order they're added
- **Destroy Phase**: Builders execute in **reverse order** (LIFO)

This ensures dependent resources are cleaned up before their dependencies:

```typescript
createTesterBuilder()
  .with(DockerTesterBuilder)      // 1. Create network
  .with(PostgresTesterBuilder)    // 2. Start Postgres (uses network)
  .with(MinioTesterBuilder)       // 3. Start MinIO (uses network)
  .build();

// Setup order:    Docker → Postgres → MinIO
// Destroy order:  MinIO → Postgres → Docker  (LIFO!)
```

### Fluent API

Each builder provides methods to configure infrastructure:

```typescript
tester
  .withPostgres((builder) =>
    builder
      .withDatabase("my_test_db")
      .withUser("test_user")
      .withPassword("test_pass")
  )
  .withMinio((builder) =>
    builder.withAccessKey("custom_key")
  )
  .withMinioBucket("my-bucket");
```

## Quick Start

### Integration Test Example

Integration tests run your application **in-process** (same Node.js process as the test). This is fast and doesn't require Docker for the application itself.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import {
  IngestorMigrationsTesterBuilder,
  InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import type { FastifyInstance } from "fastify";

describe("Health Endpoint", () => {
  const setup = () => {
    // 1. Build the tester class using createDefaultTesterBuilder
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)                    // Required by infrastructure builders
      .with(PostgresTesterBuilder)                  // Database
      .with(MinioTesterBuilder)                     // S3 storage
      .with(NatsTesterBuilder)                      // Messaging
      .with(RedisTesterBuilder)                     // Cache
      .with(IngestorMigrationsTesterBuilder)        // Apply DB migrations
      .with(InProcessIngestorTesterBuilder)         // Start app in-process
      .build();

    // 2. Create an instance
    const tester = new TesterClass();

    // 3. Configure infrastructure (no Docker network for in-process)
    tester
      .withPostgres((b) => b.withDatabase(`test_health_${Date.now()}`))
      .withMinio()
      .withMinioBucket("wallpapers")
      .withNats((b) => b.withJetstream())
      .withMigrations()       // Shorthand for migrations
      .withInProcessApp();    // Shorthand for in-process app

    return tester;
  };

  let tester: ReturnType<typeof setup>;
  let fastify: FastifyInstance;

  beforeAll(async () => {
    tester = setup();
    // 4. Start everything
    await tester.setup();
    fastify = tester.getApp();
  }, 60000);

  afterAll(async () => {
    // Cleanup happens automatically
    await tester.destroy();
  });

  it("returns healthy status", async () => {
    // Make in-process HTTP call (fast!)
    const response = await fastify.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("healthy");
  });
});
```

**Key Points:**
- Use `createDefaultTesterBuilder()` for less boilerplate
- `DockerTesterBuilder` is required even for in-process tests (dependency of infrastructure builders)
- Use shorthand methods: `withMigrations()`, `withInProcessApp()`
- Use `setup()` function pattern for cleaner type inference
- No Docker network needed (app runs on host)
- Use `app.inject()` for HTTP calls (fast)
- Infrastructure containers expose ports to host
- Great for unit and integration testing

### E2E Test Example

E2E tests run your application **in a Docker container**. This tests the actual deployment artifact.

```typescript
import { describe, test, expect, beforeAll, afterAll, afterEach } from "vitest";
import { request } from "undici";
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import {
  ContainerizedIngestorTesterBuilder,
  IngestorMigrationsTesterBuilder,
} from "./builders/index.js";

describe("Health Endpoint E2E", () => {
  const setup = () => {
    // 1. Build the tester class using createDefaultTesterBuilder
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)                    // Required by infrastructure builders
      .with(PostgresTesterBuilder)                  // Database
      .with(MinioTesterBuilder)                     // S3 storage
      .with(NatsTesterBuilder)                      // Messaging
      .with(RedisTesterBuilder)                     // Cache
      .with(IngestorMigrationsTesterBuilder)        // Apply DB migrations
      .with(ContainerizedIngestorTesterBuilder)     // App in Docker
      .build();

    // 2. Create an instance
    const tester = new TesterClass();

    // 3. Configure infrastructure (uses host.docker.internal, NO withNetwork())
    tester
      .withPostgres((b) => b.withDatabase(`test_e2e_health_${Date.now()}`))
      .withPostgresAutoCleanup(["wallpapers"])      // Auto-cleanup tables
      .withMinio()
      .withMinioBucket("wallpapers")
      .withMinioAutoCleanup()                       // Auto-cleanup buckets
      .withNats()
      .withStream("WALLPAPER")
      .withNatsAutoCleanup()                        // Auto-cleanup streams
      .withMigrations()                             // Shorthand for migrations
      .withContainerizedApp();                      // Shorthand for containerized app

    return tester;
  };

  let tester: ReturnType<typeof setup>;
  let baseUrl: string;

  beforeAll(async () => {
    tester = setup();
    // 4. Start everything
    await tester.setup();
    baseUrl = tester.getBaseUrl();
  }, 120000); // E2E needs more time

  afterAll(async () => {
    await tester.destroy();
  });

  afterEach(async () => {
    await tester.cleanup();  // Triggers all auto-cleanup
  });

  test("GET /health returns healthy status", async () => {
    // Make real HTTP call over network
    const response = await request(`${baseUrl}/health`, {
      method: "GET",
    });

    expect(response.statusCode).toBe(200);
    const body = await response.body.json();
    expect(body.status).toBe("healthy");
  });
});
```

**Key Points:**
- Use `createDefaultTesterBuilder()` for less boilerplate
- `DockerTesterBuilder` is required (dependency of infrastructure builders)
- **NO `withNetwork()` call** - uses `host.docker.internal` for communication
- Use auto-cleanup features: `withPostgresAutoCleanup()`, `withMinioAutoCleanup()`, `withNatsAutoCleanup()`
- Call `tester.cleanup()` in `afterEach` to trigger auto-cleanup
- Use shorthand methods: `withMigrations()`, `withContainerizedApp()`
- Use `setup()` function pattern for cleaner type inference
- Use `undici.request()` for HTTP calls (real network)
- Tests the actual Docker image
- Great for end-to-end and deployment testing

## Available Infrastructure Builders

### DockerTesterBuilder

Provides Docker container management foundation for infrastructure builders.

**Dependencies:** None

**Methods:**
- ~~`withNetwork()`~~ - **Deprecated/Removed:** No longer needed, use `host.docker.internal` instead

**Use Case:** Required as a dependency by all infrastructure builders (PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder, RedisTesterBuilder).

**Example:**
```typescript
// Always include DockerTesterBuilder before infrastructure builders
const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)      // Required!
  .with(PostgresTesterBuilder)    // Depends on DockerTesterBuilder
  .build();

// Or use createDefaultTesterBuilder which includes it by default
```

**Network Architecture:** Previously, E2E tests used Docker networks with `withNetwork()`. This has been **removed** due to reliability issues. Instead, containerized applications communicate with infrastructure containers via `host.docker.internal`, which is simpler and more reliable.

---

### PostgresTesterBuilder

Manages PostgreSQL database containers.

**Dependencies:** `[DockerTesterBuilder]`

**Configuration Options:**
- `withImage(string)`: PostgreSQL Docker image (default: `postgres:16-alpine`)
- `withDatabase(string)`: Database name (default: `test`)
- `withUser(string)`: Username (default: `test`)
- `withPassword(string)`: Password (default: `test`)
- `withNetworkAlias(string)`: Network alias (default: `postgres`)

**Methods:**
- `withPostgres(configure?)`: Setup database
- `withPostgresAutoCleanup(tables)`: Auto-cleanup tables after each test
- `getPostgres()`: Get connection info
- `tester.postgres.query(sql, params)`: Execute SQL queries directly

**Returns:**
```typescript
{
  container: StartedPostgreSqlContainer,
  connectionString: string,   // Connection URL
  host: string,               // Host (localhost or network alias)
  port: number,              // Port number
  database: string,          // Database name
  options: PostgresOptions   // Configuration
}
```

**Example:**
```typescript
tester
  .withPostgres((builder) =>
    builder.withDatabase(`test_db_${Date.now()}`)
  )
  .withPostgresAutoCleanup(["wallpapers", "users"]);  // Auto-truncate tables

// Later in tests...
afterEach(async () => {
  await tester.cleanup();  // Triggers auto-cleanup
});

// Get connection info
const postgres = tester.getPostgres();
console.log(postgres.connectionString);
// → postgres://test:test@localhost:55432/test_db_1234567890

// Direct SQL queries
const result = await tester.postgres.query("SELECT * FROM wallpapers WHERE id = $1", [wallpaperId]);
```

---

### MinioTesterBuilder

Manages MinIO (S3-compatible storage) containers.

**Dependencies:** `[DockerTesterBuilder]`

**Configuration Options:**
- `withImage(string)`: MinIO Docker image (default: `minio/minio:latest`)
- `withAccessKey(string)`: Access key (default: `minioadmin`)
- `withSecretKey(string)`: Secret key (default: `minioadmin`)
- `withNetworkAlias(string)`: Network alias (default: `minio`)

**Methods:**
- `withMinio(configure?)`: Setup MinIO
- `withMinioBucket(name)`: Create bucket (can call multiple times)
- `withMinioAutoCleanup()`: Auto-cleanup buckets after each test
- `getMinio()`: Get connection info
- `tester.minio.listObjects(bucket)`: List objects in bucket
- `tester.minio.cleanupBuckets()`: Manually cleanup all buckets
- `tester.minio.getS3Client()`: Get S3 client instance

**Returns:**
```typescript
{
  container: StartedMinioContainer,
  endpoint: string,           // S3 endpoint URL
  options: MinioOptions,      // Configuration
  buckets: string[]          // Created buckets
}
```

**Example:**
```typescript
tester
  .withMinio()
  .withMinioBucket("wallpapers")
  .withMinioBucket("thumbnails")  // Multiple buckets OK
  .withMinioAutoCleanup();        // Auto-empty buckets after each test

// Later in tests...
afterEach(async () => {
  await tester.cleanup();  // Triggers auto-cleanup
});

// Get connection info
const minio = tester.getMinio();
console.log(minio.endpoint);     // → http://localhost:55433
console.log(minio.buckets);      // → ["wallpapers", "thumbnails"]

// List objects in bucket
const objects = await tester.minio.listObjects("wallpapers");

// Get S3 client for advanced operations
const s3Client = tester.minio.getS3Client();
```

---

### NatsTesterBuilder

Manages NATS messaging containers with JetStream support.

**Dependencies:** `[DockerTesterBuilder]`

**Configuration Options:**
- `withImage(string)`: NATS Docker image (default: `nats:2.10-alpine`)
- `withJetstream()`: Enable JetStream
- `withNetworkAlias(string)`: Network alias (default: `nats`)

**Methods:**
- `withNats(configure?)`: Setup NATS
- `withStream(name)`: Create JetStream stream (can call multiple times)
- `withNatsAutoCleanup()`: Auto-cleanup streams after each test
- `getNats()`: Get connection info
- `tester.nats.getConnection()`: Get NATS connection instance

**Returns:**
```typescript
{
  container: StartedNatsContainer,
  endpoint: string,           // NATS URL
  options: NatsOptions,       // Configuration
  streams: string[]          // Created streams
}
```

**Example:**
```typescript
tester
  .withNats((builder) => builder.withJetstream())
  .withStream("WALLPAPER")
  .withStream("EVENTS")
  .withNatsAutoCleanup();        // Auto-purge streams after each test

// Later in tests...
afterEach(async () => {
  await tester.cleanup();  // Triggers auto-cleanup
});

// Get connection info
const nats = tester.getNats();
console.log(nats.endpoint);      // → nats://127.0.0.1:55434
console.log(nats.streams);       // → ["WALLPAPER", "EVENTS"]

// Get NATS connection for advanced operations
const connection = tester.nats.getConnection();
```

**Stream Subjects:** Each stream automatically gets a subject pattern of `<stream_name_lowercase>.*`

---

### RedisTesterBuilder

Manages Redis cache containers.

**Dependencies:** `[DockerTesterBuilder]`

**Configuration Options:**
- `withImage(string)`: Redis Docker image (default: `redis:7-alpine`)
- `withNetworkAlias(string)`: Network alias (default: `redis`)

**Methods:**
- `withRedis(configure?)`: Setup Redis
- `getRedis()`: Get connection info

**Returns:**
```typescript
{
  container: StartedRedisContainer,
  endpoint: string,           // Redis connection string
  options: RedisOptions      // Configuration
}
```

**Example:**
```typescript
tester.withRedis((builder) =>
  builder.withNetworkAlias("redis")
);

// Later, get connection info
const redis = tester.getRedis();
console.log(redis.endpoint);     // → redis://localhost:55435
```

## Best Practices

### 1. Choose the Right Test Type

- **Integration (in-process)**: Fast, for business logic and API testing
- **E2E (containerized)**: Slower, for deployment validation

See [Integration vs E2E](./integration-vs-e2e.md) for detailed guidance.

### 2. Use Auto-Cleanup for Test Isolation

Auto-cleanup prevents test pollution by automatically cleaning data between tests:

```typescript
tester
  .withPostgres((b) => b.withDatabase(`test_${Date.now()}`))
  .withPostgresAutoCleanup(["wallpapers", "users"])  // Truncate tables
  .withMinio()
  .withMinioAutoCleanup()                            // Empty buckets
  .withNats()
  .withNatsAutoCleanup();                            // Purge streams

afterEach(async () => {
  await tester.cleanup();  // Triggers all auto-cleanup
});
```

This is **much cleaner** than manual cleanup:

```typescript
// ❌ Manual cleanup - verbose and error-prone
afterEach(async () => {
  await pool.query("TRUNCATE wallpapers CASCADE");
  await pool.query("TRUNCATE users CASCADE");
  await s3.send(new DeleteObjectsCommand({ /* ... */ }));
  // ... etc
});

// ✅ Auto-cleanup - simple and declarative
afterEach(async () => {
  await tester.cleanup();
});
```

### 3. Use Unique Database Names

Prevent test interference by using unique database names:

```typescript
tester.withPostgres((builder) =>
  builder.withDatabase(`test_${Date.now()}`)
);
```

### 4. Set Generous Timeouts

Container startup can be slow:

```typescript
beforeAll(async () => {
  // Setup code...
}, 60000);  // 60 seconds for integration
           // 120 seconds for E2E
```

### 5. Always Destroy in afterAll

```typescript
afterAll(async () => {
  if (tester) {
    await tester.destroy();  // Cleanup resources
  }
});
```

### 6. Use `createDefaultTesterBuilder()` for Standard Tests

Start with `createDefaultTesterBuilder()` which includes `DockerTesterBuilder` by default:

```typescript
// ✅ Most convenient - use default builder
const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)       // Already included by default
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .build();

// ⚠️ Only use plain createTesterBuilder() if you need minimal deps
const TesterClass = createTesterBuilder()
  .with(DockerTesterBuilder)       // Must add manually
  .with(PostgresTesterBuilder)
  .build();
```

### 7. Compose Builders Incrementally

Start simple, add complexity as needed:

```typescript
// Start with just Postgres
createTesterBuilder()
  .with(PostgresTesterBuilder)

// Add MinIO when you need storage
createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)

// Add NATS when you need messaging
createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
```

### 8. Create Custom Builders for Application Logic

Don't put application setup in test files. Create builders instead:

```typescript
// ❌ Bad: Setup code in test
beforeAll(async () => {
  // ... start containers
  const migrationSql = readFileSync("migrations.sql");
  await pool.query(migrationSql);  // Migration logic in test
});

// ✅ Good: Builder handles it
createDefaultTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)  // Encapsulates migration logic
```

See [Creating Custom Builders](./creating-custom-builders.md) for details.

### 9. Use the `setup()` Function Pattern

Extract tester configuration into a `setup()` function for cleaner type inference:

```typescript
// ✅ Best practice - setup() function
const setup = () => {
  const TesterClass = createDefaultTesterBuilder()
    .with(PostgresTesterBuilder)
    .with(MinioTesterBuilder)
    .build();

  const tester = new TesterClass();
  tester.withPostgres(/* ... */).withMinio(/* ... */);
  return tester;
};

let tester: ReturnType<typeof setup>;  // Simple type inference!

beforeAll(async () => {
  tester = setup();
  await tester.setup();
});

// ⚠️ Alternative - manual type annotation (more verbose)
let tester: InstanceType<ReturnType<ReturnType<typeof createDefaultTesterBuilder>["build"]>>;
```

## Next Steps

- **[Creating Custom Builders](./creating-custom-builders.md)** - Build application-specific test helpers
- **[Integration vs E2E](./integration-vs-e2e.md)** - Understand the differences
- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
