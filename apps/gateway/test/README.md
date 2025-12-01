# Gateway Tests

## Current Status

Basic test infrastructure is in place with OpenSearchTesterBuilder created in `@wallpaperdb/test-utils`.

## Known Issues

### OpenSearch Testcontainer Configuration

The OpenSearch testcontainer uses HTTPS with authentication by default (`admin/admin`), which differs from the local infrastructure setup (HTTP without auth).

**Current behavior:**
- Container starts successfully
- Connection attempts result in `ResponseError`
- SSL/auth configuration needs refinement

**TODO for next iteration:**
- Fine-tune OpenSearch client SSL configuration
- Verify testcontainer OpenSearch auth credentials
- Consider using `getConnectionString()` method from testcontainer if available
- Add integration tests that verify OpenSearch connectivity

**Workaround:**
For now, tests can be run against the local infrastructure (`make infra-start`) for manual verification. The app successfully connects to OpenSearch when running locally.

## Running Tests

```bash
# Start infrastructure first
make infra-start

# Run tests (currently has OpenSearch connectivity issues in CI)
make gateway-test

# Manual verification - start the service
make gateway-dev

# Test endpoints manually
curl http://localhost:3004/health
curl http://localhost:3004/ready
curl -X POST http://localhost:3004/graphql -H "Content-Type: application/json" -d '{"query":"{ hello }"}'
```

All endpoints work correctly when tested manually against local infrastructure.

## Manual Verification Results

✅ All endpoints verified working with proper health checks:

```bash
# Health check with OpenSearch status
$ curl http://localhost:3004/health
{"status":"healthy","checks":{"opensearch":true,"otel":true},"timestamp":"2025-12-01T10:29:47.361Z","totalDurationMs":2}

# Readiness check
$ curl http://localhost:3004/ready
{"ready":true,"timestamp":"2025-12-01T10:29:47.366Z"}

# GraphQL endpoint
$ curl -X POST http://localhost:3004/graphql -H "Content-Type: application/json" -d '{"query":"{ hello }"}'
{"data":{"hello":"Hello from WallpaperDB Gateway!"}}
```
