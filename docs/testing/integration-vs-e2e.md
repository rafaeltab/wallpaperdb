# Integration vs E2E Tests

Understanding when to use integration tests (in-process) vs E2E tests (containerized) is crucial for effective testing. This guide explains the differences and helps you choose the right approach.

## Quick Comparison

| Aspect | Integration Tests | E2E Tests |
|--------|------------------|-----------|
| **Application** | Runs in-process (same Node.js) | Runs in Docker container |
| **Speed** | Fast (~2-5 seconds) | Slower (~10-30 seconds) |
| **Docker Network** | ❌ Not used | ✅ Required |
| **HTTP Calls** | `app.inject()` (no network) | `undici.request()` (real network) |
| **Builders** | `InProcessIngestorTesterBuilder` | `ContainerizedIngestorTesterBuilder` |
| **Test Execution** | Can run in parallel | Often sequential (single fork) |
| **What It Tests** | Business logic, APIs, database interactions | Deployment artifact, networking, container config |
| **Best For** | Unit/integration testing | End-to-end scenarios, deployment validation |

## Integration Tests (In-Process)

### Architecture

```
┌──────────────────────────────────────┐
│  Test Process (Node.js)              │
│  ├─ Vitest Test Runner               │
│  ├─ Your Application (Fastify)       │
│  └─ Test Code                        │
└──────────────────────────────────────┘
           ↓ connects to (exposed ports)
┌──────────────────────────────────────┐
│  Docker Containers                   │
│  ├─ Postgres (port 55432)            │
│  ├─ MinIO (port 55433)               │
│  └─ NATS (port 55434)                │
└──────────────────────────────────────┘
```

### Example

```typescript
import {
  createTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import { InProcessIngestorTesterBuilder } from "./builders/index.js";

describe("Upload Flow", () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

  beforeAll(async () => {
    const TesterClass = createTesterBuilder()
      .with(PostgresTesterBuilder)          // No DockerTesterBuilder!
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(InProcessIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    // NO withNetwork() call
    tester
      .withPostgres((b) => b.withDatabase("test_db"))
      .withMinio()
      .withMinioBucket("uploads")
      .withNats((b) => b.withJetstream())
      .withStream("EVENTS");

    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  it("uploads a file", async () => {
    const app = tester.getApp();

    // Fast in-process HTTP call
    const response = await app.inject({
      method: "POST",
      url: "/upload",
      payload: fileData,
    });

    expect(response.statusCode).toBe(201);
  });
});
```

### When to Use Integration Tests

✅ **Use for:**
- Testing business logic
- API endpoint behavior
- Database interactions
- Service integrations
- Error handling
- Input validation
- Most development work

❌ **Don't use for:**
- Docker networking issues
- Container configuration
- Deployment validation
- Load testing

### Advantages

- ⚡ **Fast**: No Docker build, quick startup
- 🔍 **Easy Debugging**: Can use debugger, see stack traces
- 💰 **Resource Efficient**: Lower memory/CPU usage
- 🔄 **Quick Feedback**: Ideal for TDD

### Disadvantages

- ❌ Doesn't test Docker image
- ❌ Doesn't test container networking
- ❌ Doesn't test deployment configuration
- ❌ May miss environment-specific issues

## E2E Tests (Containerized)

### Architecture

```
┌──────────────────────────────────────┐
│  Test Process (Node.js)              │
│  ├─ Vitest Test Runner               │
│  └─ Test Code (HTTP client)          │
└──────────────────────────────────────┘
           ↓ HTTP requests
┌──────────────────────────────────────┐
│  Docker Network                      │
│  ├─ Your Application Container       │
│  │   (ingestor:latest)               │
│  ├─ Postgres Container               │
│  ├─ MinIO Container                  │
│  └─ NATS Container                   │
│  (communicate via network aliases)   │
└──────────────────────────────────────┘
```

### Example

```typescript
import { request } from "undici";
import {
  createTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import { ContainerizedIngestorTesterBuilder } from "./builders/index.js";

describe("Upload Flow E2E", () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createTesterBuilder>["build"]>>;

  beforeAll(async () => {
    const TesterClass = createTesterBuilder()
      .with(DockerTesterBuilder)            // Network required
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(ContainerizedIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    // WITH withNetwork() - containers need to communicate
    tester
      .withNetwork()                         // Create network
      .withPostgres((b) =>
        b.withDatabase("test_e2e_db")
        // Default alias 'postgres' automatically used
      )
      .withMinio()                           // Default alias 'minio'
      .withMinioBucket("uploads")
      .withNats((b) => b.withJetstream())    // Default alias 'nats'
      .withStream("EVENTS");

    await tester.setup();
  }, 120000);  // Longer timeout for Docker build

  afterAll(async () => {
    await tester.destroy();
  });

  it("uploads a file", async () => {
    const baseUrl = tester.getBaseUrl();

    // Real HTTP request over network
    const response = await request(`${baseUrl}/upload`, {
      method: "POST",
      body: fileData,
    });

    expect(response.statusCode).toBe(201);
  });
});
```

### When to Use E2E Tests

✅ **Use for:**
- Testing the actual Docker image
- Verifying deployment configuration
- Testing container networking
- Multi-instance scenarios
- Performance/load testing
- Pre-release validation

❌ **Don't use for:**
- Rapid development iteration
- Debugging specific logic
- Most day-to-day testing

### Advantages

- ✅ **Tests Real Artifact**: Actual Docker image you deploy
- ✅ **Full Stack**: Tests entire deployment setup
- ✅ **Networking**: Catches network configuration issues
- ✅ **Environment Parity**: Closer to production

### Disadvantages

- 🐌 **Slow**: Docker build + startup time
- 🔍 **Harder to Debug**: Can't attach debugger easily
- 💰 **Resource Heavy**: More memory/CPU usage
- 🚫 **Sequential**: Often can't parallelize

## Decision Matrix

### Start Here

```
What are you testing?
├─ Business logic / API behavior?
│  └─ → Use Integration Tests
│
├─ Database queries / transactions?
│  └─ → Use Integration Tests
│
├─ Service integration (Postgres/MinIO/NATS)?
│  └─ → Use Integration Tests
│
├─ Docker image / deployment?
│  └─ → Use E2E Tests
│
├─ Container networking?
│  └─ → Use E2E Tests
│
└─ Multi-instance scenarios?
   └─ → Use E2E Tests
```

### Testing Pyramid

```
    ╱╲
   ╱  ╲       E2E Tests (Few)
  ╱────╲      ← Containerized, slow, comprehensive
 ╱      ╲
╱────────╲    Integration Tests (Many)
           ← In-process, fast, focused

────────────  Unit Tests (Most, if applicable)
```

## Common Patterns

### Pattern 1: Integration Tests for Development

During development, use integration tests for quick feedback:

```bash
# Watch mode for rapid iteration
pnpm test:watch

# Tests run in ~2-5 seconds
✓ POST /upload validates file type
✓ POST /upload stores in MinIO
✓ POST /upload publishes NATS event
```

### Pattern 2: E2E Tests for CI/CD

In CI/CD pipelines, run E2E tests before deployment:

```yaml
# .github/workflows/test.yml
- name: Build Docker image
  run: make ingestor-build

- name: Run E2E tests
  run: make ingestor-e2e-test

- name: Deploy
  if: success()
  run: ./deploy.sh
```

### Pattern 3: Hybrid Approach

Use both test types strategically:

```
apps/ingestor/
├─ test/                    (Integration tests)
│  ├─ upload-flow.test.ts
│  ├─ validation.test.ts
│  └─ reconciliation.test.ts
│
apps/ingestor-e2e/
└─ test/                    (E2E tests)
   ├─ health.e2e.test.ts
   ├─ upload.e2e.test.ts    (Smoke tests only)
   └─ multi-instance.e2e.test.ts
```

## Best Practices

### For Integration Tests

1. **Use unique database names** to avoid conflicts
   ```typescript
   .withPostgres((b) => b.withDatabase(`test_${Date.now()}`))
   ```

2. **Don't create Docker networks**
   ```typescript
   // ❌ Bad
   tester.withNetwork()

   // ✅ Good
   // (don't call withNetwork at all)
   ```

3. **Run in parallel** when possible
   ```typescript
   // vitest.config.ts
   export default {
     test: {
       maxConcurrency: 5,
     },
   };
   ```

### For E2E Tests

1. **Always create Docker networks**
   ```typescript
   // ✅ Required
   tester.withNetwork()
   ```

2. **Enable Docker network**
   ```typescript
   .withNetwork()  // Default aliases ('postgres', 'minio', etc.) are automatically used
   ```

3. **Run sequentially** (single fork)
   ```typescript
   // vitest.config.ts
   export default {
     test: {
       pool: 'forks',
       singleFork: true,
     },
   };
   ```

4. **Set longer timeouts**
   ```typescript
   beforeAll(async () => {
     // ...setup
   }, 120000);  // 2 minutes for E2E
   ```

## Troubleshooting

### "ECONNREFUSED" in Integration Tests

❌ **Problem**: App can't connect to containers

✅ **Solution**: Don't use Docker network for integration tests

```typescript
// ❌ Bad
tester.withNetwork()

// ✅ Good
// Let containers expose ports
```

### "Container not found" in E2E Tests

❌ **Problem**: Containers can't find each other

✅ **Solution**: Create network and use aliases

```typescript
tester
  .withNetwork()
  .withPostgres()  // Default alias 'postgres' is automatically used
```

### Slow Test Execution

❌ **Problem**: Tests take too long

✅ **Solutions**:
- Use integration tests for most testing
- Reserve E2E for critical paths
- Run E2E tests only in CI/CD

## Next Steps

- **[Test Builder Pattern](./test-builder-pattern.md)** - Learn the core concepts
- **[Creating Custom Builders](./creating-custom-builders.md)** - Build your own builders
- **[Migration Guide](./migration-guide.md)** - Convert existing tests
- **[Troubleshooting](./troubleshooting.md)** - Solve common issues
