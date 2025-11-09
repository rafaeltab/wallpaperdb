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
const TesterClass = createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .build();

const tester = new TesterClass();
```

### Type-Safe Dependencies

Builders can declare dependencies on other builders. The TypeScript compiler **prevents** you from adding a builder without its dependencies:

```typescript
// ✅ This works - PostgresTesterBuilder has no dependencies
createTesterBuilder()
  .with(PostgresTesterBuilder)

// ❌ This fails at compile time - PostgresTesterBuilder requires DockerTesterBuilder
createTesterBuilder()
  .with(PostgresTesterBuilder)  // Type error!

// ✅ This works - dependencies satisfied
createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
```

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
  createTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import {
  IngestorMigrationsTesterBuilder,
  InProcessIngestorTesterBuilder,
} from "./builders/index.js";

describe("Health Endpoint", () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

  beforeAll(async () => {
    // 1. Build the tester class
    const TesterClass = createTesterBuilder()
      .with(DockerTesterBuilder)                    // Required by other builders
      .with(PostgresTesterBuilder)                  // Database
      .with(MinioTesterBuilder)                     // S3 storage
      .with(NatsTesterBuilder)                      // Messaging
      .with(IngestorMigrationsTesterBuilder)        // Apply DB migrations
      .with(InProcessIngestorTesterBuilder)         // Start app in-process
      .build();

    // 2. Create an instance
    tester = new TesterClass();

    // 3. Configure infrastructure (no Docker network for in-process)
    tester
      .withPostgres((builder) =>
        builder.withDatabase(`test_${Date.now()}`)
      )
      .withMinio()
      .withMinioBucket("wallpapers")
      .withNats((builder) => builder.withJetstream())
      .withStream("WALLPAPERS");

    // 4. Start everything
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    // Cleanup happens automatically
    await tester.destroy();
  });

  it("returns healthy status", async () => {
    // Access the Fastify app
    const app = tester.getApp();

    // Make in-process HTTP call (fast!)
    const response = await app.inject({
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
- No Docker network needed (app runs on host)
- Use `app.inject()` for HTTP calls (fast)
- Infrastructure containers expose ports to host
- Great for unit and integration testing

### E2E Test Example

E2E tests run your application **in a Docker container**. This tests the actual deployment artifact.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request } from "undici";
import {
  createTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import { ContainerizedIngestorTesterBuilder } from "./builders/index.js";

describe("Health Endpoint E2E", () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

  beforeAll(async () => {
    // 1. Build the tester class
    const TesterClass = createTesterBuilder()
      .with(DockerTesterBuilder)                    // Docker network required
      .with(PostgresTesterBuilder)                  // Database
      .with(MinioTesterBuilder)                     // S3 storage
      .with(NatsTesterBuilder)                      // Messaging
      .with(ContainerizedIngestorTesterBuilder)     // App in Docker
      .build();

    // 2. Create an instance
    tester = new TesterClass();

    // 3. Configure infrastructure (WITH Docker network for E2E)
    tester
      .withNetwork()                                 // Create network
      .withPostgres((builder) =>
        builder.withDatabase(`test_e2e_${Date.now()}`)
        // Network alias 'postgres' is already the default
      )
      .withMinio()                                   // Default alias 'minio'
      .withMinioBucket("wallpapers")
      .withNats((builder) => builder.withJetstream())  // Default alias 'nats'
      .withStream("WALLPAPERS");

    // 4. Start everything
    await tester.setup();
  }, 120000); // E2E needs more time

  afterAll(async () => {
    await tester.destroy();
  });

  it("returns healthy status", async () => {
    // Get the app's URL
    const baseUrl = tester.getBaseUrl();

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
- Docker network required (containers communicate via network aliases)
- Use `undici.request()` for HTTP calls (real network)
- Tests the actual Docker image
- Great for end-to-end and deployment testing

## Available Infrastructure Builders

### DockerTesterBuilder

Manages Docker networks for inter-container communication.

**Dependencies:** None

**Methods:**
- `withNetwork()`: Creates an isolated Docker network

**Use Case:** Required by other builders when network communication is needed (E2E tests).

**Example:**
```typescript
tester.withNetwork();  // Create network for containers
```

**Important:** For integration tests (in-process app), **DON'T** call `withNetwork()`. The app runs on the host and connects to containers via exposed ports.

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
- `getPostgres()`: Get connection info

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
tester.withPostgres((builder) =>
  builder
    .withDatabase("my_test_db")
    .withUser("test_user")
    .withPassword("secret")
    // Note: Network alias defaults to 'postgres' when withNetwork() is called
    // Only override if you need a custom alias
);

// Later, get connection info
const postgres = tester.getPostgres();
console.log(postgres.connectionString);
// → postgres://test_user:secret@localhost:55432/my_test_db
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
- `getMinio()`: Get connection info

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
  .withMinio((builder) =>
    builder
      .withAccessKey("my_key")
      .withSecretKey("my_secret")
      .withNetworkAlias("minio")
  )
  .withMinioBucket("uploads")
  .withMinioBucket("thumbnails");  // Multiple buckets OK

// Later, get connection info
const minio = tester.getMinio();
console.log(minio.endpoint);     // → http://localhost:55433
console.log(minio.buckets);      // → ["uploads", "thumbnails"]
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
- `getNats()`: Get connection info

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
  .withNats((builder) =>
    builder
      .withJetstream()
      .withNetworkAlias("nats")
  )
  .withStream("ORDERS")
  .withStream("EVENTS");

// Later, get connection info
const nats = tester.getNats();
console.log(nats.endpoint);      // → nats://127.0.0.1:55434
console.log(nats.streams);       // → ["ORDERS", "EVENTS"]
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

### 2. Don't Use Networks for Integration Tests

```typescript
// ❌ Bad: Network not needed for in-process tests
createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  // ... other builders

tester.withNetwork()  // DON'T DO THIS

// ✅ Good: Let containers expose ports
createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  // ... other builders

// No withNetwork() call - containers use exposed ports
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

### 6. Compose Builders Incrementally

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

### 7. Create Custom Builders for Application Logic

Don't put application setup in test files. Create builders instead:

```typescript
// ❌ Bad: Setup code in test
beforeAll(async () => {
  // ... start containers
  const migrationSql = readFileSync("migrations.sql");
  await pool.query(migrationSql);  // Migration logic in test
});

// ✅ Good: Builder handles it
createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)  // Encapsulates migration logic
```

See [Creating Custom Builders](./creating-custom-builders.md) for details.

### 8. Use TypeScript's Type Inference

Let TypeScript infer the complex tester type:

```typescript
// ✅ Good: Let TypeScript infer
let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

// Or use auto type inference
const TesterClass = createTesterBuilder()
  .with(PostgresTesterBuilder)
  .build();

const tester = new TesterClass();  // Type inferred automatically
```

## Next Steps

- **[Creating Custom Builders](./creating-custom-builders.md)** - Build application-specific test helpers
- **[Integration vs E2E](./integration-vs-e2e.md)** - Understand the differences
- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
