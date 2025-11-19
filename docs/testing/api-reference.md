# API Reference

Complete reference for the TesterBuilder pattern and all available builders.

## Core API

### createDefaultTesterBuilder()

**Recommended:** Factory function to create a new tester builder with common defaults included.

```typescript
function createDefaultTesterBuilder(): TesterBuilder<[DockerTesterBuilder]>
```

**Returns:** `TesterBuilder` with `DockerTesterBuilder` already included

**Example:**
```typescript
const builder = createDefaultTesterBuilder()
  .with(PostgresTesterBuilder)  // DockerTesterBuilder already included!
  .with(MinioTesterBuilder);
```

**When to use:**
- Most tests (recommended default)
- Any test using infrastructure builders (Postgres, MinIO, NATS, Redis)

---

### createTesterBuilder()

Factory function to create a new tester builder with no defaults.

```typescript
function createTesterBuilder(): TesterBuilder<[]>
```

**Returns:** Empty `TesterBuilder` ready for composition

**Example:**
```typescript
const builder = createTesterBuilder()
  .with(DockerTesterBuilder)     // Must add manually
  .with(PostgresTesterBuilder);
```

**When to use:**
- Only when you need minimal dependencies
- Custom builder composition scenarios

---

### TesterBuilder.with()

Add a builder to the composition.

```typescript
.with<TTesterBuilder>(
  testerConstructor: Constructor<TTesterBuilder>,
  options?: BuilderOptions
): TesterBuilder<[TTesterBuilder, ...Previous]>
```

**Type Safety:** Enforces that all dependencies of `TTesterBuilder` are already added.

**Example:**
```typescript
createTesterBuilder()
  .with(PostgresTesterBuilder)
  .with(MinioTesterBuilder)
```

---

### TesterBuilder.build()

Build the final Tester class with all composed builders.

```typescript
.build(): Constructor<Tester>
```

**Returns:** Constructor for the composed Tester class

**Example:**
```typescript
const TesterClass = createTesterBuilder()
  .with(PostgresTesterBuilder)
  .build();

const tester = new TesterClass();
```

---

### Tester.setup()

Initialize all builders and start containers.

```typescript
async setup(): Promise<void>
```

**Execution Order:** Builders run in the order they were added.

**Example:**
```typescript
await tester.setup();
```

---

### Tester.destroy()

Clean up all resources in reverse order (LIFO).

```typescript
async destroy(): Promise<void>
```

**Execution Order:** Builders destroy in **reverse** order (LIFO).

**Example:**
```typescript
await tester.destroy();
```

---

### BaseTesterBuilder

Base class for creating custom builders.

```typescript
abstract class BaseTesterBuilder<
  TName extends string,
  TRequiredTesters extends TupleOfTesters = []
>
```

**Type Parameters:**
- `TName`: Unique name for the builder
- `TRequiredTesters`: Array of required builder dependencies

**Abstract Members:**
```typescript
abstract name: TName;
abstract addMethods<TBase extends AddMethodsType<TRequiredTesters>>(
  Base: TBase
): AnyConstructorFor<any>;
```

**Example:**
```typescript
export class MyBuilder extends BaseTesterBuilder<
  "MyBuilder",
  [PostgresTesterBuilder]
> {
  readonly name = "MyBuilder" as const;
  
  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
    return class extends Base {
      // Implementation
    };
  }
}
```

## Auto-Cleanup Features

### withPostgresAutoCleanup()

Automatically truncate tables after each test.

```typescript
withPostgresAutoCleanup(tables: string[]): this
```

**Parameters:**
- `tables`: Array of table names to truncate

**Usage:**
```typescript
tester.withPostgresAutoCleanup(["wallpapers", "users"]);

// Trigger in afterEach
afterEach(async () => {
  await tester.cleanup();
});
```

---

### withMinioAutoCleanup()

Automatically empty all buckets after each test.

```typescript
withMinioAutoCleanup(): this
```

**Usage:**
```typescript
tester.withMinioAutoCleanup();

afterEach(async () => {
  await tester.cleanup();
});
```

---

### withNatsAutoCleanup()

Automatically purge all JetStream streams after each test.

```typescript
withNatsAutoCleanup(): this
```

**Usage:**
```typescript
tester.withNatsAutoCleanup();

afterEach(async () => {
  await tester.cleanup();
});
```

---

### tester.cleanup()

Triggers all registered auto-cleanup operations.

```typescript
async cleanup(): Promise<void>
```

**Usage:**
```typescript
afterEach(async () => {
  await tester.cleanup();  // Runs all auto-cleanup
});
```

---

## Helper Methods

### tester.postgres.query()

Execute SQL queries directly.

```typescript
async query<T>(sql: string, params?: any[]): Promise<T[]>
```

**Usage:**
```typescript
const wallpapers = await tester.postgres.query(
  "SELECT * FROM wallpapers WHERE user_id = $1",
  [userId]
);
```

---

### tester.minio.listObjects()

List objects in a bucket.

```typescript
async listObjects(bucket: string): Promise<string[]>
```

**Usage:**
```typescript
const objects = await tester.minio.listObjects("wallpapers");
console.log(objects);  // ["wlpr_123/original.jpg", ...]
```

---

### tester.minio.getS3Client()

Get the underlying S3 client for advanced operations.

```typescript
getS3Client(): S3Client
```

**Usage:**
```typescript
const s3 = tester.minio.getS3Client();
await s3.send(new DeleteObjectCommand({ ... }));
```

---

### tester.nats.getConnection()

Get the underlying NATS connection.

```typescript
getConnection(): NatsConnection
```

**Usage:**
```typescript
const nats = tester.nats.getConnection();
const js = nats.jetstream();
```

---

## Infrastructure Builders

### DockerTesterBuilder

Provides Docker container management foundation for infrastructure builders.

```typescript
class DockerTesterBuilder extends BaseTesterBuilder<'Docker', []>
```

**Dependencies:** None

**Note:** Required by all infrastructure builders (PostgresTesterBuilder, MinioTesterBuilder, NatsTesterBuilder, RedisTesterBuilder).

**Methods:**

#### ~~withNetwork()~~ (Deprecated)

~~Create an isolated Docker network.~~ **Removed due to reliability issues.**

Use `host.docker.internal` for container-to-container communication instead.

**Returns:** `DockerConfig`
```typescript
{
  network: StartedNetwork | undefined
}
```

**Example:**
```typescript
tester.withNetwork();
const network = tester.getNetwork();
```

---

### PostgresTesterBuilder

Manages PostgreSQL database containers.

```typescript
class PostgresTesterBuilder extends BaseTesterBuilder<
  'postgres',
  [DockerTesterBuilder]
>
```

**Dependencies:** `[DockerTesterBuilder]`

**Methods:**

#### withPostgres(configure?)

Setup PostgreSQL container.

```typescript
withPostgres(
  configure?: (builder: PostgresBuilder) => PostgresBuilder
): this
```

**Configuration Methods:**
- `withImage(image: string)`: Docker image (default: `postgres:16-alpine`)
- `withDatabase(name: string)`: Database name (default: `test`)
- `withUser(user: string)`: Username (default: `test`)
- `withPassword(password: string)`: Password (default: `test`)
- `withNetworkAlias(alias: string)`: Network alias (default: `postgres`)

**Returns:** `PostgresConfig`
```typescript
{
  container: StartedPostgreSqlContainer,
  connectionString: string,
  host: string,
  port: number,
  database: string,
  options: PostgresOptions
}
```

**Example:**
```typescript
tester.withPostgres((b) =>
  b.withDatabase("my_db")
   .withUser("admin")
   .withPassword("secret")
   // Network alias defaults to 'postgres' - only override if needed
);

const postgres = tester.getPostgres();
console.log(postgres.connectionString);
// → postgres://admin:secret@localhost:55432/my_db
```

---

### MinioTesterBuilder

Manages MinIO (S3-compatible) containers.

```typescript
class MinioTesterBuilder extends BaseTesterBuilder<
  'minio',
  [DockerTesterBuilder]
>
```

**Dependencies:** `[DockerTesterBuilder]`

**Methods:**

#### withMinio(configure?)

Setup MinIO container.

```typescript
withMinio(
  configure?: (builder: MinioBuilder) => MinioBuilder
): this
```

**Configuration Methods:**
- `withImage(image: string)`: Docker image (default: `minio/minio:latest`)
- `withAccessKey(key: string)`: Access key (default: `minioadmin`)
- `withSecretKey(key: string)`: Secret key (default: `minioadmin`)
- `withNetworkAlias(alias: string)`: Network alias (default: `minio`)

#### withMinioBucket(name)

Create an S3 bucket. Can be called multiple times.

```typescript
withMinioBucket(name: string): this
```

**Returns:** `MinioConfig`
```typescript
{
  container: StartedMinioContainer,
  endpoint: string,
  options: MinioOptions,
  buckets: string[]
}
```

**Example:**
```typescript
tester
  .withMinio((b) =>
    b.withAccessKey("custom_key")
     .withSecretKey("custom_secret")
     .withNetworkAlias("minio")
  )
  .withMinioBucket("uploads")
  .withMinioBucket("backups");

const minio = tester.getMinio();
console.log(minio.endpoint);    // → http://localhost:55433
console.log(minio.buckets);     // → ["uploads", "backups"]
```

---

### NatsTesterBuilder

Manages NATS messaging containers with JetStream support.

```typescript
class NatsTesterBuilder extends BaseTesterBuilder<
  'nats',
  [DockerTesterBuilder]
>
```

**Dependencies:** `[DockerTesterBuilder]`

**Methods:**

#### withNats(configure?)

Setup NATS container.

```typescript
withNats(
  configure?: (builder: NatsBuilder) => NatsBuilder
): this
```

**Configuration Methods:**
- `withImage(image: string)`: Docker image (default: `nats:2.10-alpine`)
- `withJetstream()`: Enable JetStream
- `withNetworkAlias(alias: string)`: Network alias (default: `nats`)

#### withStream(name)

Create a JetStream stream. Can be called multiple times.

```typescript
withStream(name: string): this
```

**Stream Subject Pattern:** Each stream gets subject pattern `<name_lowercase>.*`

**Returns:** `NatsConfig`
```typescript
{
  container: StartedNatsContainer,
  endpoint: string,
  options: NatsOptions,
  streams: string[]
}
```

**Example:**
```typescript
tester
  .withNats((b) =>
    b.withJetstream()
     .withNetworkAlias("nats")
  )
  .withStream("ORDERS")
  .withStream("EVENTS");

const nats = tester.getNats();
console.log(nats.endpoint);     // → nats://127.0.0.1:55434
console.log(nats.streams);      // → ["ORDERS", "EVENTS"]
```

---

### RedisTesterBuilder

Manages Redis cache containers.

```typescript
class RedisTesterBuilder extends BaseTesterBuilder<
  'redis',
  [DockerTesterBuilder]
>
```

**Dependencies:** `[DockerTesterBuilder]`

**Methods:**

#### withRedis(configure?)

Setup Redis container.

```typescript
withRedis(
  configure?: (builder: RedisBuilder) => RedisBuilder
): this
```

**Configuration Methods:**
- `withImage(image: string)`: Docker image (default: `redis:7-alpine`)
- `withNetworkAlias(alias: string)`: Network alias (default: `redis`)

**Returns:** `RedisConfig`
```typescript
{
  container: StartedRedisContainer,
  endpoint: string,
  options: RedisOptions
}
```

**Example:**
```typescript
tester.withRedis((b) =>
  b.withNetworkAlias("redis")
);

const redis = tester.getRedis();
console.log(redis.endpoint);    // → redis://localhost:55435
```

## Type Utilities

### AddMethodsType<T>

Type helper for the `addMethods` method signature.

```typescript
type AddMethodsType<TTesters extends TupleOfTesters>
```

**Usage:**
```typescript
addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(
  Base: TBase
) {
  return class extends Base {
    // Implementation
  };
}
```

## Complete Example

```typescript
import {
  createTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from "@wallpaperdb/test-utils";

describe("Complete Example", () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

  beforeAll(async () => {
    // 1. Build tester class
    const TesterClass = createTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .build();

    // 2. Create instance
    tester = new TesterClass();

    // 3. Configure infrastructure
    tester
      .withNetwork()
      .withPostgres((b) =>
        b.withDatabase("test_db")
         .withUser("test")
         .withPassword("test")
         // Default alias 'postgres' is automatically used
      )
      .withMinio()  // Default alias 'minio'
      .withMinioBucket("uploads")
      .withNats((b) => b.withJetstream())  // Default alias 'nats'
      .withStream("EVENTS");

    // 4. Initialize
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    // 5. Cleanup
    await tester.destroy();
  });

  it("can access all infrastructure", () => {
    // Access methods available from builders
    const network = tester.getNetwork();
    const postgres = tester.getPostgres();
    const minio = tester.getMinio();
    const nats = tester.getNats();

    expect(postgres.connectionString).toContain("postgres://");
    expect(minio.endpoint).toContain("http://");
    expect(nats.endpoint).toContain("nats://");
    expect(minio.buckets).toContain("uploads");
    expect(nats.streams).toContain("EVENTS");
  });
});
```

## Next Steps

- **[Test Builder Pattern](./test-builder-pattern.md)** - Learn the core concepts
- **[Creating Custom Builders](./creating-custom-builders.md)** - Build your own builders
- **[Integration vs E2E](./integration-vs-e2e.md)** - Choose the right test type
