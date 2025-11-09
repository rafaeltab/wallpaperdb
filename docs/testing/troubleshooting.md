# Troubleshooting

Common issues and solutions when working with the TesterBuilder pattern and Testcontainers.

## Container Startup Issues

### "Could not find a working container runtime strategy"

**Symptoms:**
```
Error: Could not find a working container runtime strategy
```

**Cause:** Docker is not running or not accessible

**Solutions:**

1. Start Docker Desktop (Mac/Windows) or Docker daemon (Linux)
   ```bash
   # Linux
   sudo systemctl start docker
   
   # Mac/Windows
   # Open Docker Desktop application
   ```

2. Verify Docker is running
   ```bash
   docker ps
   ```

3. Check Docker permissions (Linux)
   ```bash
   sudo usermod -aG docker $USER
   # Log out and back in
   ```

---

### "Port already in use"

**Symptoms:**
```
Error: bind: address already in use
```

**Cause:** Another container or process is using the port

**Solutions:**

1. Use unique database names (generates random ports)
   ```typescript
   tester.withPostgres((b) =>
     b.withDatabase(`test_${Date.now()}`)  // ← Unique name
   );
   ```

2. Stop conflicting containers
   ```bash
   docker ps
   docker stop <container-id>
   ```

3. Kill process using the port
   ```bash
   # Find process
   lsof -i :5432  # Replace with your port
   
   # Kill it
   kill -9 <pid>
   ```

---

### "Container failed to start within timeout"

**Symptoms:**
```
Error: Container did not start within 60000ms
```

**Cause:** Container takes longer than timeout to start

**Solutions:**

1. Increase test timeout
   ```typescript
   beforeAll(async () => {
     // ... setup
   }, 120000);  // ← Increase to 120 seconds
   ```

2. Check container logs
   ```bash
   docker logs <container-id>
   ```

3. Verify image is pulled
   ```bash
   docker images
   docker pull postgres:16-alpine
   ```

---

### "Network not found"

**Symptoms:**
```
Error: network <id> not found
```

**Cause:** Network was removed before containers

**Solutions:**

1. Ensure proper destroy order (should happen automatically)
   ```typescript
   // Builders destroy in LIFO order automatically
   // Network is always destroyed last
   ```

2. Clean up dangling networks
   ```bash
   docker network prune
   ```

## Type Errors

### "Property 'withX' does not exist"

**Symptoms:**
```typescript
tester.withPostgres(...)
//     ^^^^^^^^^^^^ Property 'withPostgres' does not exist
```

**Cause:** Builder not added to composition

**Solution:** Add the required builder
```typescript
// ❌ Missing PostgresTesterBuilder
createTesterBuilder()
  .with(MinioTesterBuilder)
  .build();

// ✅ Add PostgresTesterBuilder
createTesterBuilder()
  .with(PostgresTesterBuilder)  // ← Add this
  .with(MinioTesterBuilder)
  .build();
```

---

### "Type 'X' is not assignable to type 'Y'"

**Symptoms:**
```typescript
.with(PostgresTesterBuilder)
// Type error: missing required dependency
```

**Cause:** Required dependency not added

**Solution:** Add dependencies in correct order
```typescript
// ❌ PostgresTesterBuilder needs DockerTesterBuilder
createTesterBuilder()
  .with(PostgresTesterBuilder)  // Error!
  .build();

// ✅ Add DockerTesterBuilder first
createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .build();
```

---

### "Cannot find name 'getPostgres'"

**Symptoms:**
```typescript
const postgres = this.getPostgres();
//                    ^^^^^^^^^^^^ Cannot find name
```

**Cause:** Accessing method from undeclared dependency

**Solution:** Declare dependency in builder
```typescript
export class MyBuilder extends BaseTesterBuilder<
  "MyBuilder",
  [PostgresTesterBuilder]  // ← Declare dependency
> {
  // Now this.getPostgres() works
}
```

## Connection Errors

### "ECONNREFUSED" in Integration Tests

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Cause:** Using Docker network for in-process tests

**Solution:** Don't create Docker network
```typescript
// ❌ Wrong for integration tests
tester.withNetwork()

// ✅ Correct - no network for in-process
// (just don't call withNetwork)
```

---

### "getaddrinfo ENOTFOUND postgres"

**Symptoms:**
```
Error: getaddrinfo ENOTFOUND postgres
```

**Cause:** Missing Docker network for E2E tests

**Solution:** Create network and use aliases
```typescript
// ❌ Missing network
createTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  // ...

// ✅ Add network
tester
  .withNetwork()  // ← Create network
  .withPostgres((b) =>
    b.withNetworkAlias("postgres")  // ← Use alias
  )
```

---

### "Connection terminated unexpectedly"

**Symptoms:**
```
Error: Connection terminated unexpectedly
```

**Cause:** Container stopped or crashed

**Solutions:**

1. Check container logs
   ```bash
   docker logs <container-id>
   ```

2. Verify container is running
   ```bash
   docker ps -a
   ```

3. Check for resource limits
   ```bash
   docker stats
   ```

## Test Execution Issues

### Tests Hang Indefinitely

**Symptoms:** Tests never complete

**Causes & Solutions:**

1. **Forgot to call `setup()`**
   ```typescript
   beforeAll(async () => {
     const TesterClass = createTesterBuilder()...build();
     tester = new TesterClass();
     // ❌ Forgot this:
     await tester.setup();  // ← Add this
   });
   ```

2. **Forgot to call `destroy()`**
   ```typescript
   afterAll(async () => {
     await tester.destroy();  // ← Add this
   });
   ```

3. **Wait strategy never satisfied**
   ```typescript
   // Container not logging expected message
   .withWaitStrategy(Wait.forLogMessage(/Server is running/))
   
   // Solution: Check actual log message or use different strategy
   .withWaitStrategy(Wait.forHealthCheck())
   ```

---

### "App not initialized"

**Symptoms:**
```
Error: App not initialized. Did you call setup() first?
```

**Cause:** Accessing resources before `setup()`

**Solution:** Call `setup()` in `beforeAll`
```typescript
beforeAll(async () => {
  const TesterClass = createTesterBuilder()...build();
  tester = new TesterClass();
  // ... configure
  await tester.setup();  // ← Must call this
});

it("test", async () => {
  const app = tester.getApp();  // Now works
});
```

---

### Slow Test Execution

**Symptoms:** Tests take minutes instead of seconds

**Solutions:**

1. **Use integration tests instead of E2E**
   - Integration: ~2-5 seconds
   - E2E: ~10-30 seconds

2. **Reuse containers across tests**
   ```typescript
   // ✅ Good - one setup for all tests in suite
   beforeAll(async () => {
     await tester.setup();
   });

   // ❌ Bad - setup before each test
   beforeEach(async () => {
     await tester.setup();  // Slow!
   });
   ```

3. **Run integration tests in parallel**
   ```typescript
   // vitest.config.ts
   export default {
     test: {
       maxConcurrency: 5,
     },
   };
   ```

4. **Cache Docker images**
   ```bash
   # Pre-pull images
   docker pull postgres:16-alpine
   docker pull minio/minio:latest
   docker pull nats:2.10-alpine
   ```

## Memory Issues

### "Docker out of memory"

**Symptoms:**
```
Error: OOM
```

**Solutions:**

1. Increase Docker memory limit (Docker Desktop)
   - Settings → Resources → Memory → 4GB+

2. Clean up old containers
   ```bash
   docker system prune -a
   ```

3. Limit concurrent tests
   ```typescript
   // vitest.config.ts
   export default {
     test: {
       maxConcurrency: 3,  // Reduce from 5
     },
   };
   ```

## Platform-Specific Issues

### Linux: Permission Denied

**Symptoms:**
```
Error: permission denied while trying to connect to the Docker daemon
```

**Solution:** Add user to docker group
```bash
sudo usermod -aG docker $USER
# Log out and back in
```

### macOS: DNS Resolution Slow

**Symptoms:** Tests slow, "localhost" resolution takes 5s

**Solution:** Use `127.0.0.1` instead of `localhost`
```typescript
// Already handled by builders automatically
// getPostgres() returns 127.0.0.1 on Mac
```

### Windows: Path Issues

**Symptoms:** File paths not found

**Solution:** Use path.join() for cross-platform paths
```typescript
import { join } from "node:path";

const migrationPath = join(__dirname, "../../migrations.sql");
```

## Getting Help

If you're still stuck:

1. **Check existing tests** for examples
   - `apps/ingestor/test/health-builder.test.ts`
   - `apps/ingestor-e2e/test/health-builder.e2e.test.ts`

2. **Review documentation**
   - [Test Builder Pattern](./test-builder-pattern.md)
   - [Creating Custom Builders](./creating-custom-builders.md)
   - [Integration vs E2E](./integration-vs-e2e.md)

3. **Check container logs**
   ```bash
   docker logs <container-id>
   ```

4. **Enable debug logging**
   ```typescript
   // In your test
   process.env.DEBUG = "testcontainers*";
   ```

5. **Ask for help** with:
   - Error message
   - Minimal reproduction
   - Docker/Node/OS versions
