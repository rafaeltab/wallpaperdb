# Ingestor E2E Tests

End-to-end tests that verify the ingestor service by testing the **actual Docker container** running in production mode.

## Architecture: Why This Guarantees Real Implementation Testing

This E2E test suite is **structurally designed** to make it impossible to fake the implementation:

### 1. **Physical Separation**
- ✅ Separate workspace package (`@wallpaperdb/ingestor-e2e`)
- ✅ Cannot import from `@wallpaperdb/ingestor` (ESLint enforced)
- ✅ Only `devDependency` for Turbo build ordering

### 2. **Docker-Only Execution**
- ✅ Tests run against the actual Docker image built from `Dockerfile`
- ✅ Same image used in production
- ✅ Tests use HTTP client (undici), not direct function calls
- ✅ Cannot bypass the containerized application

### 3. **Side Effect Verification**
- ✅ Tests verify actual S3 objects (via direct S3 client)
- ✅ Tests verify actual database records (via direct SQL queries)
- ✅ Tests verify actual NATS events (via direct NATS client)
- ✅ Cannot mock these external services

### 4. **Multiple Enforcement Layers**

| Layer | Enforcement | Check |
|-------|-------------|-------|
| **ESLint** | Prevents imports at development time | `make ingestor-e2e-verify` |
| **Package.json script** | Grep check for imports | `pnpm verify-no-imports` |
| **Test setup** | Requires Docker container startup | Fails if container not running |
| **Side effects** | Requires real infrastructure | S3/DB/NATS must have data |

## Quick Verification ("Vibe Check")

Before trusting these tests, verify the architecture is sound:

```bash
# 1. Check no application code dependency
cat apps/ingestor-e2e/package.json | grep -v devDependencies | grep "@wallpaperdb/ingestor"
# Should return nothing

# 2. Check ESLint rule exists
cat apps/ingestor-e2e/.eslintrc.json | grep "no-restricted-imports"
# Should show the rule

# 3. Verify no imports exist in test code
make ingestor-e2e-verify
# Should pass

# 4. Check setup uses Docker
grep "docker build" apps/ingestor-e2e/test/setup.ts
grep "GenericContainer" apps/ingestor-e2e/test/setup.ts
# Both should return matches
```

## Running Tests

```bash
# Prerequisites: Infrastructure must be running
make infra-start

# Run E2E tests (automatically builds Docker image first)
make ingestor-e2e-test

# Watch mode
make ingestor-e2e-test-watch

# Verify no forbidden imports
make ingestor-e2e-verify
```

## What Gets Tested

These tests focus on **critical user flows** and **production parity**:

- ✅ Health and readiness endpoints
- ✅ Upload flow (JPEG) with S3 and DB verification
- ✅ Invalid file upload (error handling + no pollution)
- 🔜 Duplicate upload (idempotency verification)
- 🔜 Reconciliation (eventual consistency)

## What's NOT Tested Here

These are covered by integration tests (`apps/ingestor/test/`):
- ❌ Internal service methods
- ❌ Edge cases and error conditions
- ❌ Detailed validation logic
- ❌ Unit-level functionality

## Test Architecture

```
apps/ingestor-e2e/
├── package.json          # NO dependency on @wallpaperdb/ingestor
├── .eslintrc.json        # Prevents imports via ESLint rule
├── test/
│   ├── setup.ts          # Starts Docker + infrastructure
│   ├── health.e2e.test.ts
│   └── upload.e2e.test.ts
```

### Test Pattern

Every test follows this pattern:

```typescript
test('description', async () => {
  // 1. Arrange: Create test data
  const testImage = createTestJpeg();

  // 2. Act: HTTP request to Docker container
  const response = await request(`${baseUrl}/endpoint`, { ... });

  // 3. Assert: HTTP response
  expect(response.statusCode).toBe(201);

  // 4. Verify: Side effects in S3
  const s3Objects = await s3Client.send(...);
  expect(s3Objects.Contents).toHaveLength(1);

  // 5. Verify: Side effects in database
  const dbResult = await dbPool.query(...);
  expect(dbResult.rows[0].upload_state).toBe('completed');
});
```

## CI/CD Integration

```yaml
# In your CI pipeline
- name: Run E2E tests
  run: |
    make infra-start
    make ingestor-e2e-verify  # Check no imports first
    make ingestor-e2e-test    # Run tests
```

## Troubleshooting

**Tests failing to start:**
- Ensure infrastructure is running: `make infra-start`
- Check Docker daemon is running
- Verify Docker image can be built: `make ingestor-docker-build`

**Container startup timeout:**
- Increase timeout in `test/setup.ts` if needed
- Check container logs: `docker logs <container-id>`
- Verify health endpoint is accessible

**Import violations:**
- Run `make ingestor-e2e-verify` to check
- ESLint will catch these in development
- CI will fail if imports are detected

## Why This Matters

Traditional E2E tests can be "faked" by:
1. Importing application code and calling functions directly
2. Mocking services instead of using real infrastructure
3. Skipping the Docker container and running code in-process

This architecture **structurally prevents all three**:
- Physical package separation prevents imports
- Docker-only execution prevents in-process running
- Side effect verification catches fake service mocks

**Result:** These tests truly verify the production artifact.
