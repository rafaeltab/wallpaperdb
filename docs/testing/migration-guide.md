# Migration Guide: From Manual Setup to Builders

This guide helps you migrate from manual Testcontainers setup to the builder pattern, making tests cleaner and more maintainable.

## Benefits of Migration

After migration, your tests will be:

✅ **Shorter**: ~60% less code
✅ **Type-Safe**: Compile-time dependency checking
✅ **Composable**: Mix and match builders easily
✅ **Maintainable**: Setup logic in one place
✅ **Consistent**: Same patterns across all tests

## Before and After

### Before: Manual Setup

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { MinioContainer } from "@testcontainers/minio";
import { createNatsContainer } from "@wallpaperdb/testcontainers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

describe("Health Endpoint", () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let minioContainer: StartedMinioContainer;
  let natsContainer: StartedNatsContainer;
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    // Start Postgres
    postgresContainer = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("test_db")
      .withUsername("test")
      .withPassword("test")
      .start();

    // Start MinIO
    minioContainer = await new MinioContainer("minio/minio:latest")
      .withUsername("minioadmin")
      .withPassword("minioadmin")
      .start();

    // Start NATS
    natsContainer = await createNatsContainer()
      .withJetstream(true)
      .start();

    // Apply migrations
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
    });
    const migrationSQL = readFileSync(
      join(__dirname, "../drizzle/0000_left_starjammers.sql"),
      "utf-8"
    );
    await pool.query(migrationSQL);

    // Create S3 bucket
    const s3Client = new S3Client({
      endpoint: minioContainer.getEndpoint(),
      credentials: {
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin",
      },
      forcePathStyle: true,
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: "wallpapers" }));

    // Set environment variables
    process.env.DATABASE_URL = postgresContainer.getConnectionUri();
    process.env.S3_ENDPOINT = minioContainer.getEndpoint();
    process.env.NATS_URL = `nats://127.0.0.1:${natsContainer.getPort()}`;
    // ... more env vars

    // Create app
    app = await createApp(loadConfig());
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await postgresContainer?.stop();
    await minioContainer?.stop();
    await natsContainer?.stop();
  });

  it("returns healthy status", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
```

**Problems:**
- 80+ lines of setup code
- Manual container lifecycle management
- Easy to forget cleanup steps
- Hard to reuse across tests
- No type safety for dependencies

### After: Builder Pattern

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTesterBuilder,
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
    const TesterClass = createTesterBuilder()
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(InProcessIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    tester
      .withPostgres((b) => b.withDatabase("test_db"))
      .withMinio()
      .withMinioBucket("wallpapers")
      .withNats((b) => b.withJetstream());

    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  it("returns healthy status", async () => {
    const app = tester.getApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
```

**Benefits:**
- ~30 lines (60% reduction!)
- Automatic lifecycle management
- Type-safe composition
- Reusable across tests
- Declarative and readable

## Step-by-Step Migration

### Step 1: Identify Setup Patterns

Look at your `beforeAll` and identify what's being set up:

```typescript
// What containers are started?
- PostgreSQL
- MinIO
- NATS

// What setup happens?
- Database migrations
- S3 bucket creation
- App initialization
```

### Step 2: Choose Appropriate Builders

Map your setup to builders:

| Your Setup | Builder |
|------------|---------|
| PostgreSQL container | `PostgresTesterBuilder` |
| MinIO container | `MinioTesterBuilder` |
| NATS container | `NatsTesterBuilder` |
| Redis container | `RedisTesterBuilder` |
| Database migrations | Create custom builder |
| App initialization | Create custom builder |
| Test fixtures | Create custom builder |

### Step 3: Replace Container Setup

**Before:**
```typescript
const postgresContainer = await new PostgreSqlContainer("postgres:16-alpine")
  .withDatabase("test_db")
  .withUsername("test")
  .withPassword("test")
  .start();
```

**After:**
```typescript
createTesterBuilder()
  .with(PostgresTesterBuilder)
  // ...

tester.withPostgres((builder) =>
  builder
    .withDatabase("test_db")
    .withUser("test")
    .withPassword("test")
);
```

### Step 4: Replace Custom Setup

For custom setup (migrations, app initialization), create builders:

**Before:**
```typescript
const migrationSQL = readFileSync("migrations.sql", "utf-8");
await pool.query(migrationSQL);
```

**After:**
```typescript
// Create IngestorMigrationsTesterBuilder (see Creating Custom Builders guide)

createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)  // Handles migrations
```

### Step 5: Update Test Structure

**Before:**
```typescript
let postgresContainer: StartedPostgreSqlContainer;
let minioContainer: StartedMinioContainer;
let app: FastifyInstance;

beforeAll(async () => {
  postgresContainer = await ...
  minioContainer = await ...
  app = await ...
});

it("test", async () => {
  const response = await app.inject(...);
});
```

**After:**
```typescript
let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

beforeAll(async () => {
  const TesterClass = createTesterBuilder()
    .with(...)
    .build();

  tester = new TesterClass();
  await tester.setup();
});

it("test", async () => {
  const app = tester.getApp();
  const response = await app.inject(...);
});
```

### Step 6: Clean Up

Remove manual cleanup code:

**Before:**
```typescript
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await postgresContainer?.stop();
  await minioContainer?.stop();
  await natsContainer?.stop();
});
```

**After:**
```typescript
afterAll(async () => {
  await tester.destroy();  // That's it!
});
```

## Common Migration Scenarios

### Scenario 1: Single Container (Postgres Only)

**Before:**
```typescript
let postgresContainer: StartedPostgreSqlContainer;

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("test")
    .start();
  
  const pool = new Pool({
    connectionString: postgresContainer.getConnectionUri(),
  });
  await pool.query(migrationSQL);
  await pool.end();
});

afterAll(async () => {
  await postgresContainer?.stop();
});
```

**After:**
```typescript
let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

beforeAll(async () => {
  const TesterClass = createTesterBuilder()
    .with(PostgresTesterBuilder)
    .with(MigrationsTesterBuilder)
    .build();

  tester = new TesterClass();
  tester.withPostgres((b) => b.withDatabase("test"));
  await tester.setup();
});

afterAll(async () => {
  await tester.destroy();
});
```

### Scenario 2: Multiple Containers

**Before:**
```typescript
let postgresContainer, minioContainer, natsContainer;

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer(...).start();
  minioContainer = await new MinioContainer(...).start();
  natsContainer = await createNatsContainer(...).start();
  // ... setup code
});

afterAll(async () => {
  await postgresContainer?.stop();
  await minioContainer?.stop();
  await natsContainer?.stop();
});
```

**After:**
```typescript
let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

beforeAll(async () => {
  const TesterClass = createTesterBuilder()
    .with(PostgresTesterBuilder)
    .with(MinioTesterBuilder)
    .with(NatsTesterBuilder)
    .build();

  tester = new TesterClass();
  // Configure...
  await tester.setup();
});

afterAll(async () => {
  await tester.destroy();
});
```

### Scenario 3: Custom Setup Requirements

If you have custom setup that doesn't fit existing builders, create a custom builder:

**Before:**
```typescript
beforeAll(async () => {
  // ... start containers
  
  // Custom setup
  await applyMigrations(postgres);
  await seedTestData(postgres);
  await uploadTestFiles(minio);
  await createStreams(nats);
});
```

**After:**
```typescript
// Create custom builder
class TestSetupTesterBuilder extends BaseTesterBuilder<
  "TestSetup",
  [PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder]
> {
  addMethods<TBase extends AddMethodsType<[...]>>(Base: TBase) {
    return class extends Base {
      override async setup(): Promise<void> {
        await super.setup();
        
        await applyMigrations(this.getPostgres());
        await seedTestData(this.getPostgres());
        await uploadTestFiles(this.getMinio());
        await createStreams(this.getNats());
      }
    };
  }
}

// Use in tests
createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(TestSetupTesterBuilder)  // All custom setup happens here
  .build();
```

## Migration Checklist

- [ ] Identify all containers being started
- [ ] Choose appropriate builders for each
- [ ] Create custom builders for application-specific setup
- [ ] Replace container startup code with builder composition
- [ ] Replace manual cleanup with `tester.destroy()`
- [ ] Update test code to use `tester.getXyz()` methods
- [ ] Run tests to verify functionality
- [ ] Remove unused imports and variables
- [ ] Update test timeouts if needed

## Gotchas and Tips

### Gotcha 1: Network vs No-Network

**Problem:** Integration tests using Docker network

**Solution:** Don't call `withNetwork()` for in-process tests

```typescript
// ❌ Wrong for integration tests
tester.withNetwork()

// ✅ Correct - let containers expose ports
// (don't call withNetwork at all)
```

### Gotcha 2: Environment Variables

**Problem:** Manually setting environment variables

**Solution:** Let builders handle it (or create a custom builder)

```typescript
// ❌ Manual env vars in test
process.env.DATABASE_URL = postgres.getConnectionUri();

// ✅ Let InProcessIngestorTesterBuilder handle it
// (it reads from getPostgres() and sets env vars)
```

### Gotcha 3: Lifecycle Ordering

**Problem:** Setup happens in wrong order

**Solution:** Add builders in dependency order

```typescript
// ✅ Correct order
createTesterBuilder()
  .with(PostgresTesterBuilder)      // 1. Infrastructure
  .with(MigrationsTesterBuilder)    // 2. Schema
  .with(InProcessIngestorTesterBuilder)  // 3. App
```

### Tip 1: Migrate Incrementally

Don't migrate all tests at once. Start with one:

1. Pick simplest test file
2. Migrate it to builders
3. Verify it works
4. Use as template for others

### Tip 2: Create Shared Builders

If multiple test files have similar setup, create shared builders:

```
test/
├─ builders/
│  ├─ migrations.builder.ts      (shared)
│  ├─ fixtures.builder.ts        (shared)
│  └─ app.builder.ts             (shared)
├─ upload.test.ts                (uses shared builders)
├─ validation.test.ts            (uses shared builders)
└─ reconciliation.test.ts        (uses shared builders)
```

### Tip 3: Use Examples as Templates

Copy from existing examples:

- `apps/ingestor/test/health-builder.test.ts` - Integration test example
- `apps/ingestor-e2e/test/health-builder.e2e.test.ts` - E2E test example

## Next Steps

- **[Creating Custom Builders](./creating-custom-builders.md)** - Learn to create builders for your app
- **[Integration vs E2E](./integration-vs-e2e.md)** - Understand test types
- **[Troubleshooting](./troubleshooting.md)** - Solve common issues
