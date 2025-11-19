# Testing Documentation

Welcome to the WallpaperDB testing documentation! This guide covers the composable test infrastructure built on Testcontainers and the TesterBuilder pattern.

## 📚 Documentation Index

### Getting Started
- **[TesterBuilder Pattern](./test-builder-pattern.md)** - Core concepts, quick start, and available builders
  - Start here if you're new to the testing approach
  - Learn the composition model and see complete examples
  - Reference for all infrastructure builders

### Advanced Topics
- **[Creating Custom Builders](./creating-custom-builders.md)** - Build application-specific test helpers
  - Step-by-step tutorial
  - Real examples from the ingestor package
  - Type safety patterns

- **[Integration vs E2E Tests](./integration-vs-e2e.md)** - Choose the right test type
  - Comparison table and decision matrix
  - In-process vs containerized architecture
  - Best practices for each type

### Reference
- **[API Reference](./api-reference.md)** - Complete API documentation
  - All builders and their options
  - Type signatures and return values
  - Method reference

### Guides
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
  - Container startup problems
  - Type errors
  - Connection issues
  - Performance tips

## 🎯 Quick Decision Tree

**"Which guide do I need?"**

```
Are you new to this testing approach?
├─ Yes → Start with test-builder-pattern.md
└─ No
   ├─ Writing a new test?
   │  ├─ Standard infrastructure (Postgres/MinIO/NATS)?
   │  │  └─ → test-builder-pattern.md (Quick Start section)
   │  └─ Custom application setup needed?
   │     └─ → creating-custom-builders.md
   │
   ├─ Choosing between integration and E2E?
   │  └─ → integration-vs-e2e.md
   │
   └─ Something not working?
      └─ → troubleshooting.md
```

## ✅ Testing Philosophy

WallpaperDB uses **real infrastructure** for all tests:

- ✅ Testcontainers for Postgres, MinIO, NATS, Redis
- ✅ Actual Docker containers, not mocks
- ✅ Production-like behavior
- ❌ No in-memory databases
- ❌ No service mocks
- ❌ No fake implementations

**Why?** This approach catches real-world issues and gives confidence that code works against actual services.

## 🏗️ Architecture Overview

```
Testing Infrastructure Layers:

┌─────────────────────────────────────────────────┐
│  Application Tests                              │
│  ├─ apps/ingestor/test/*.test.ts               │
│  └─ apps/ingestor-e2e/test/*.e2e.test.ts       │
└─────────────────────────────────────────────────┘
                    ↓ uses
┌─────────────────────────────────────────────────┐
│  Application-Specific Builders                  │
│  ├─ apps/ingestor/test/builders/               │
│  │   ├─ IngestorMigrationsTesterBuilder        │
│  │   ├─ InProcessIngestorTesterBuilder          │
│  │   └─ ContainerizedIngestorTesterBuilder      │
│  └─ apps/ingestor-e2e/test/builders/           │
│      └─ ContainerizedIngestorTesterBuilder      │
└─────────────────────────────────────────────────┘
                    ↓ uses
┌─────────────────────────────────────────────────┐
│  Core Test Infrastructure (packages/test-utils)│
│  ├─ DockerTesterBuilder (network management)   │
│  ├─ PostgresTesterBuilder (database)           │
│  ├─ MinioTesterBuilder (S3 storage)            │
│  ├─ NatsTesterBuilder (messaging)              │
│  └─ RedisTesterBuilder (cache)                 │
└─────────────────────────────────────────────────┘
                    ↓ uses
┌─────────────────────────────────────────────────┐
│  Testcontainers                                 │
│  ├─ packages/testcontainers (NATS setup)       │
│  └─ @testcontainers/* (official packages)      │
└─────────────────────────────────────────────────┘
```

## 📖 Example: Health Check Test (Integration)

```typescript
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

describe("Health Check", () => {
  const setup = () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(RedisTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(InProcessIngestorTesterBuilder)
      .build();

    const tester = new TesterClass();

    tester
      .withPostgres((b) => b.withDatabase(`test_health_${Date.now()}`))
      .withMinio()
      .withMinioBucket("wallpapers")
      .withNats((b) => b.withJetstream())
      .withMigrations()
      .withInProcessApp();

    return tester;
  };

  let tester: ReturnType<typeof setup>;
  let fastify: FastifyInstance;

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
    fastify = tester.getApp();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  it("returns healthy status", async () => {
    const response = await fastify.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
```

## 📖 Example: Health Check Test (E2E)

```typescript
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
import { request } from "undici";

describe("Health Check E2E", () => {
  const setup = () => {
    const TesterClass = createDefaultTesterBuilder()
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
      .withPostgres((b) => b.withDatabase(`test_e2e_health_${Date.now()}`))
      .withPostgresAutoCleanup(["wallpapers"])
      .withMinio()
      .withMinioBucket("wallpapers")
      .withMinioAutoCleanup()
      .withNats()
      .withStream("WALLPAPER")
      .withNatsAutoCleanup()
      .withMigrations()
      .withContainerizedApp();

    return tester;
  };

  let tester: ReturnType<typeof setup>;
  let baseUrl: string;

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
    baseUrl = tester.getBaseUrl();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  afterEach(async () => {
    await tester.cleanup();
  });

  test("GET /health returns healthy status", async () => {
    const response = await request(`${baseUrl}/health`, { method: "GET" });
    expect(response.statusCode).toBe(200);
  });
});
```

**See [test-builder-pattern.md](./test-builder-pattern.md) for more examples and explanations.**

## 🔑 Key Features

### `createDefaultTesterBuilder()` vs `createTesterBuilder()`

**Use `createDefaultTesterBuilder()` for most tests** - it includes common infrastructure dependencies out of the box, reducing boilerplate.

**Use `createTesterBuilder()`** only when you need minimal dependencies or custom builder composition.

```typescript
// Default builder - includes common dependencies
const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)      // Already included by default
  .with(PostgresTesterBuilder)    // Add what you need
  .with(MinioTesterBuilder)
  .build();
```

### Auto-Cleanup Features

Automatically clean test data between tests without manual `beforeEach`/`afterEach` hooks:

```typescript
tester
  .withPostgres((b) => b.withDatabase("test_db"))
  .withPostgresAutoCleanup(["wallpapers", "users"])  // Truncates tables after each test
  .withMinio()
  .withMinioAutoCleanup()           // Empties buckets after each test
  .withNats()
  .withNatsAutoCleanup();           // Purges streams after each test

// Later in test hooks:
afterEach(async () => {
  await tester.cleanup();  // Triggers all auto-cleanup
});
```

### Shorthand Configuration Methods

Convenient methods reduce verbose configuration:

```typescript
// Shorthand methods (recommended)
tester
  .withMigrations()          // Run database migrations
  .withInProcessApp()        // Start in-process Fastify app (integration tests)
  .withContainerizedApp();   // Start containerized app (E2E tests)

// Equivalent verbose configuration (not needed)
tester.withIngestorMigrations((b) => b.withMigrationsPath("./drizzle"));
```

### Network Architecture (host.docker.internal)

E2E tests use `host.docker.internal` for container-to-container communication, eliminating the need for explicit Docker networks:

- **No `withNetwork()` calls needed** - removed due to issues
- Services communicate via `host.docker.internal` hostname
- Simpler, more reliable than custom Docker networks
- Works consistently across Docker environments

## 🚀 Getting Started Checklist

- [ ] Read [TesterBuilder Pattern](./test-builder-pattern.md) for core concepts
- [ ] Try the Quick Start examples (integration and E2E)
- [ ] Understand [Integration vs E2E](./integration-vs-e2e.md) differences
- [ ] Review [API Reference](./api-reference.md) for available builders
- [ ] Create your first test using the builder pattern
- [ ] (Optional) [Create custom builders](./creating-custom-builders.md) for your application

## 📝 Contributing

When adding new infrastructure:

1. Consider creating a builder in `packages/test-utils`
2. Follow the patterns in [Creating Custom Builders](./creating-custom-builders.md)
3. Add documentation to the appropriate guide
4. Include examples in your tests

## 🔗 Related Documentation

- [CLAUDE.md](../../CLAUDE.md) - Project overview and commands
- [testcontainers package](../../packages/testcontainers/README.md) - Custom NATS setup
- [ingestor-e2e README](../../apps/ingestor-e2e/README.md) - E2E testing philosophy
