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
- **[Migration Guide](./migration-guide.md)** - From manual Testcontainers to builders
  - Before/after comparisons
  - Step-by-step migration process
  - Common scenarios

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
   ├─ Converting existing tests?
   │  └─ → migration-guide.md
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

## 📖 Example: Health Check Test

```typescript
import {
  createTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import { InProcessIngestorTesterBuilder } from "./builders/index.js";

describe("Health Check", () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

  beforeAll(async () => {
    const TesterClass = createTesterBuilder()
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(InProcessIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    tester
      .withPostgres((b) => b.withDatabase("test_db"))
      .withMinio()
      .withMinioBucket("wallpapers")
      .withNats((b) => b.withJetstream())
      .withStream("WALLPAPERS");

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

**See [test-builder-pattern.md](./test-builder-pattern.md) for more examples and explanations.**

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
