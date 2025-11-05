# Rate Limiting with Redis Implementation Plan

## Overview

This plan implements **distributed rate limiting** using Redis to prevent abuse across multiple service instances. Without Redis, each instance tracks rate limits independently, allowing users to bypass limits by hitting different instances.

## Problem Statement

1. **Current State**: No rate limiting implemented
2. **Multi-Instance Problem**: In-memory rate limiting doesn't work across multiple instances
3. **Production Requirement**: Need true distributed rate limiting for horizontal scaling

## Solution

Use **Redis as a shared rate limit store** with `@fastify/rate-limit` plugin to enforce limits across all service instances.

---

## Phase 1: Infrastructure Setup

### 1.1 Add Redis to Docker Compose

**File**: `infra/docker-compose.yml`

**Add Redis Service**:
```yaml
redis:
  image: redis:7-alpine
  container_name: wallpaperdb-redis
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
  command: redis-server --appendonly yes
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 5
  networks:
    - wallpaperdb
  restart: unless-stopped

# Add to volumes section
volumes:
  redis-data:
    driver: local
```

**Why Redis 7 Alpine**:
- Lightweight (~30MB image)
- Production-ready
- AOF (Append-Only File) persistence enabled
- Healthcheck for container orchestration

### 1.2 Update Makefile

**File**: `Makefile`

Add Redis commands:
```makefile
# Redis commands
.PHONY: redis-cli
redis-cli:
	docker exec -it wallpaperdb-redis redis-cli

.PHONY: redis-flush
redis-flush:
	docker exec -it wallpaperdb-redis redis-cli FLUSHALL

.PHONY: redis-info
redis-info:
	docker exec wallpaperdb-redis redis-cli INFO
```

---

## Phase 2: Application Configuration

### 2.1 Add Redis Config

**File**: `apps/ingestor/src/config.ts`

**Add to Schema**:
```typescript
// Redis (for distributed rate limiting)
redisHost: z.string().default('localhost'),
redisPort: z.number().int().positive().default(6379),
redisPassword: z.string().optional(),
redisEnabled: z.boolean().default(true),
```

**Add to loadConfig()**:
```typescript
redisHost: process.env.REDIS_HOST || 'localhost',
redisPort: process.env.REDIS_PORT ? Number.parseInt(process.env.REDIS_PORT, 10) : 6379,
redisPassword: process.env.REDIS_PASSWORD,
redisEnabled: process.env.REDIS_ENABLED !== 'false',
```

**Environment Variables**:
- `REDIS_HOST` - Redis server hostname (default: localhost)
- `REDIS_PORT` - Redis server port (default: 6379)
- `REDIS_PASSWORD` - Redis password (optional)
- `REDIS_ENABLED` - Enable/disable Redis (default: true)

### 2.2 Install Dependencies

```bash
pnpm --filter @wallpaperdb/ingestor add ioredis
pnpm --filter @wallpaperdb/ingestor add -D @types/ioredis
```

---

## Phase 3: Redis Connection Module

### 3.1 Create Redis Connection Manager

**File**: `apps/ingestor/src/connections/redis.ts`

```typescript
import Redis from 'ioredis';
import type { Config } from '../config.js';

let redis: Redis | null = null;

/**
 * Create Redis connection for distributed rate limiting
 */
export function createRedisConnection(config: Config): Redis {
  if (redis) {
    return redis;
  }

  if (!config.redisEnabled) {
    throw new Error('Redis is not enabled');
  }

  redis = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false, // Fail fast if Redis unavailable
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts
      }
      return Math.min(times * 100, 2000); // Exponential backoff (max 2s)
    },
    lazyConnect: true, // Don't connect until explicitly called
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  redis.on('connect', () => {
    console.log('Redis connected successfully');
  });

  redis.on('close', () => {
    console.log('Redis connection closed');
  });

  return redis;
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call createRedisConnection first.');
  }
  return redis;
}

export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
```

**Key Design Decisions**:
- **Lazy connect**: Don't connect until explicitly requested
- **Fail fast**: `enableOfflineQueue: false` - don't queue commands if Redis unavailable
- **Graceful degradation**: App can fall back to in-memory if Redis fails
- **Singleton pattern**: One connection per service instance

### 3.2 Initialize in App

**File**: `apps/ingestor/src/app.ts`

**After other connection initialization**:
```typescript
// Initialize Redis connection (optional - for rate limiting)
let redisClient: Redis | undefined;
if (config.redisEnabled) {
  try {
    redisClient = createRedisConnection(config);
    await redisClient.connect();
    fastify.log.info('Redis connection created');
  } catch (error) {
    fastify.log.warn(
      { err: error },
      'Redis connection failed, rate limiting will use in-memory store'
    );
    redisClient = undefined;
  }
}
```

**In onClose Hook**:
```typescript
fastify.addHook('onClose', async () => {
  // ... existing cleanup
  if (redisClient) {
    await closeRedisConnection();
  }
});
```

---

## Phase 4: Rate Limiting Implementation

### 4.1 Register Rate Limit Plugin

**File**: `apps/ingestor/src/app.ts`

**After Redis initialization**:
```typescript
// Register rate limiting plugin
await fastify.register(import('@fastify/rate-limit'), {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindowMs,
  cache: 10000, // In-memory cache size (fallback if Redis unavailable)

  // Use Redis for distributed rate limiting
  redis: redisClient,
  nameSpace: 'wallpaperdb:ratelimit:', // Redis key prefix

  // Per-user rate limiting
  keyGenerator: (request) => {
    // Extract userId from request (set by upload route preHandler)
    const userId = (request as any).rateLimitUserId;
    if (userId) {
      return `user:${userId}`;
    }
    // Fallback to IP for non-upload routes
    return `ip:${request.ip}`;
  },

  // Skip health/ready endpoints
  skip: (request) => {
    return request.url === '/health' || request.url === '/ready';
  },

  // Add rate limit headers to all responses
  addHeadersOnExceeding: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },

  // RFC 7807 Problem Details error format
  errorResponseBuilder: (request, context) => {
    const retryAfterSeconds = Math.ceil(context.ttl / 1000);
    const windowMinutes = Math.ceil(config.rateLimitWindowMs / 60000);

    return {
      type: 'https://wallpaperdb.example/problems/rate-limit-exceeded',
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: `You have exceeded the upload limit of ${context.max} uploads per ${windowMinutes} minute${windowMinutes > 1 ? 's' : ''}. Please try again later.`,
      instance: request.url,
      max: context.max,
      windowMs: config.rateLimitWindowMs,
      retryAfter: retryAfterSeconds,
    };
  },

  // Enable Retry-After header (RFC 6585)
  enableDraftSpec: true,
});

const rateLimitStore = redisClient ? 'Redis' : 'in-memory';
fastify.log.info(`Rate limiting configured (store: ${rateLimitStore})`);
```

### 4.2 Extract userId in Upload Route

**File**: `apps/ingestor/src/routes/upload.routes.ts`

**Problem**: Rate limit plugin's `keyGenerator` runs before multipart parsing.

**Solution**: Use `preHandler` hook to parse multipart and extract userId.

**Add before route registration**:
```typescript
// Pre-handler to extract userId for rate limiting
fastify.addHook('preHandler', async (request, reply) => {
  // Only for POST /upload
  if (request.url === '/upload' && request.method === 'POST') {
    try {
      // Parse multipart data to extract userId
      const data = await request.file();

      if (data) {
        const userId = parseUserId(data);

        // Store for rate limiting keyGenerator
        (request as any).rateLimitUserId = userId;

        // Cache parsed data for main handler (avoid re-parsing)
        (request as any).cachedMultipartData = data;
      }
    } catch (error) {
      // If parsing fails, let main handler deal with it
      // Rate limiting will fall back to IP-based
    }
  }
});
```

**Update uploadHandler**:
```typescript
async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const db = getDatabase();

  try {
    // Use cached multipart data from preHandler
    let data = (request as any).cachedMultipartData;

    // If not cached (shouldn't happen), parse again
    if (!data) {
      data = await request.file();
    }

    if (!data) {
      throw new MissingFileError();
    }

    const userId = (request as any).rateLimitUserId || parseUserId(data);

    // ... rest of existing handler
```

---

## Phase 5: E2E Multi-Instance Tests

### 5.1 Create E2E Test File

**File**: `apps/ingestor-e2e/test/rate-limiting-distributed.test.ts`

**Purpose**: Prove that rate limiting works across multiple service instances using shared Redis.

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../ingestor/src/app.js';
import { getTestConfig } from '../../ingestor/test/setup.js';
import FormData from 'form-data';
import { createTestImage } from '../../ingestor/test/fixtures.js';

/**
 * E2E Multi-Instance Rate Limiting Tests
 *
 * These tests verify that rate limiting works correctly when multiple
 * service instances share the same Redis store.
 *
 * Test Scenarios:
 * 1. Multiple instances enforce same rate limit (not per-instance)
 * 2. Rate limit counter is shared across all instances
 * 3. One instance hitting limit blocks requests on other instances
 */

describe('E2E Multi-Instance Rate Limiting', () => {
  let redisContainer: StartedTestContainer;
  let app1: FastifyInstance;
  let app2: FastifyInstance;
  let app3: FastifyInstance;
  let config: ReturnType<typeof getTestConfig>;

  beforeAll(async () => {
    // Get base test config
    config = getTestConfig();

    // Start Redis container
    console.log('Starting Redis container...');
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withHealthCheck({
        test: ['CMD', 'redis-cli', 'ping'],
        interval: 1000,
        timeout: 3000,
        retries: 5,
      })
      .start();

    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getMappedPort(6379);

    console.log(`Redis started at ${redisHost}:${redisPort}`);

    // Create test config with Redis and low rate limits
    const testConfig = {
      ...config,
      redisHost,
      redisPort,
      redisEnabled: true,
      rateLimitMax: 10, // Low limit for testing
      rateLimitWindowMs: 10000, // 10 seconds
    };

    // Start 3 app instances on different ports
    console.log('Starting app instances...');

    const config1 = { ...testConfig, port: 3001 };
    const config2 = { ...testConfig, port: 3002 };
    const config3 = { ...testConfig, port: 3003 };

    app1 = await createApp(config1, { logger: false, enableOtel: false });
    app2 = await createApp(config2, { logger: false, enableOtel: false });
    app3 = await createApp(config3, { logger: false, enableOtel: false });

    await app1.listen({ port: config1.port, host: '0.0.0.0' });
    await app2.listen({ port: config2.port, host: '0.0.0.0' });
    await app3.listen({ port: config3.port, host: '0.0.0.0' });

    console.log('All instances started');
  }, 120000); // 2 minute timeout for container startup

  afterAll(async () => {
    await app1.close();
    await app2.close();
    await app3.close();
    await redisContainer.stop();
  });

  beforeEach(async () => {
    // Flush Redis before each test
    await redisContainer.exec(['redis-cli', 'FLUSHALL']);
  });

  it('should enforce rate limit across all instances (not per-instance)', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });
    const userId = 'user_distributed_test';

    // Make 10 requests distributed across 3 instances (rate limit = 10)
    const requests = [];

    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      // Round-robin across instances
      const app = [app1, app2, app3][i % 3];

      requests.push(
        app.inject({
          method: 'POST',
          url: '/upload',
          headers: form.getHeaders(),
          payload: form,
        })
      );
    }

    const responses = await Promise.all(requests);

    // All 10 should succeed (exactly at limit)
    const successCount = responses.filter(r => r.statusCode === 200).length;
    expect(successCount).toBe(10);

    // 11th request should fail on ANY instance
    const form11 = new FormData();
    form11.append('file', testImage, { filename: 'test-11.jpg', contentType: 'image/jpeg' });
    form11.append('userId', userId);

    const response11 = await app1.inject({
      method: 'POST',
      url: '/upload',
      headers: form11.getHeaders(),
      payload: form11,
    });

    expect(response11.statusCode).toBe(429);

    // Verify error format
    const body = JSON.parse(response11.body);
    expect(body.type).toBe('https://wallpaperdb.example/problems/rate-limit-exceeded');
    expect(body.status).toBe(429);
    expect(body.retryAfter).toBeDefined();
  });

  it('should share rate limit counter across instances', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });
    const userId = 'user_counter_test';

    // Instance 1: Make 5 requests
    for (let i = 0; i < 5; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `app1-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      const response = await app1.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);

      // Check rate limit headers
      expect(response.headers['x-ratelimit-limit']).toBe('10');
      expect(Number(response.headers['x-ratelimit-remaining'])).toBe(10 - (i + 1));
    }

    // Instance 2: Make 5 more requests (should reach limit)
    for (let i = 0; i < 5; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `app2-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      const response = await app2.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // Instance 3: 11th request should fail
    const form11 = new FormData();
    form11.append('file', testImage, { filename: 'app3-exceed.jpg', contentType: 'image/jpeg' });
    form11.append('userId', userId);

    const response11 = await app3.inject({
      method: 'POST',
      url: '/upload',
      headers: form11.getHeaders(),
      payload: form11,
    });

    expect(response11.statusCode).toBe(429);
    expect(response11.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should isolate rate limits per user across instances', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // User A: Hit limit on instance 1
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `userA-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_a_isolated');

      await app1.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // User A: Verify rate limited on instance 2
    const formA11 = new FormData();
    formA11.append('file', testImage, { filename: 'userA-exceed.jpg', contentType: 'image/jpeg' });
    formA11.append('userId', 'user_a_isolated');

    const responseA11 = await app2.inject({
      method: 'POST',
      url: '/upload',
      headers: formA11.getHeaders(),
      payload: formA11,
    });

    expect(responseA11.statusCode).toBe(429);

    // User B: Should still be able to upload on instance 3
    const formB1 = new FormData();
    formB1.append('file', testImage, { filename: 'userB-1.jpg', contentType: 'image/jpeg' });
    formB1.append('userId', 'user_b_isolated');

    const responseB1 = await app3.inject({
      method: 'POST',
      url: '/upload',
      headers: formB1.getHeaders(),
      payload: formB1,
    });

    expect(responseB1.statusCode).toBe(200);
  });

  it('should reset rate limit after time window expires', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });
    const userId = 'user_reset_test';

    // Hit rate limit across instances
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      const app = [app1, app2, app3][i % 3];
      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Verify rate limited
    const formExceed = new FormData();
    formExceed.append('file', testImage, { filename: 'test-exceed.jpg', contentType: 'image/jpeg' });
    formExceed.append('userId', userId);

    const responseExceed = await app1.inject({
      method: 'POST',
      url: '/upload',
      headers: formExceed.getHeaders(),
      payload: formExceed,
    });

    expect(responseExceed.statusCode).toBe(429);

    // Wait for window to expire (10 seconds + buffer)
    console.log('Waiting for rate limit window to expire...');
    await new Promise(resolve => setTimeout(resolve, 11000));

    // After reset, should be able to upload again
    const formAfterReset = new FormData();
    formAfterReset.append('file', testImage, { filename: 'test-after-reset.jpg', contentType: 'image/jpeg' });
    formAfterReset.append('userId', userId);

    const responseAfterReset = await app2.inject({
      method: 'POST',
      url: '/upload',
      headers: formAfterReset.getHeaders(),
      payload: formAfterReset,
    });

    expect(responseAfterReset.statusCode).toBe(200);
  }, 30000); // Extended timeout for waiting
});
```

---

## Phase 6: Update Health Checks

### 6.1 Add Redis to Health Check

**File**: `apps/ingestor/src/services/health.service.ts`

**Add Redis check** (optional - don't fail health check if Redis unavailable):
```typescript
async checkHealth(isShuttingDown: boolean): Promise<HealthCheckResult> {
  const checks = {
    database: false,
    minio: false,
    nats: false,
    redis: false, // Optional check
  };

  // ... existing checks

  // Check Redis (optional - rate limiting can fall back to in-memory)
  try {
    if (this.config.redisEnabled) {
      const redis = getRedis();
      await redis.ping();
      checks.redis = true;
    } else {
      checks.redis = true; // Not required, mark as healthy
    }
  } catch {
    // Redis optional for rate limiting, don't fail health check
    checks.redis = false;
  }

  // Health check passes if critical services are up (DB, MinIO, NATS)
  const isHealthy = checks.database && checks.minio && checks.nats;

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    checks,
  };
}
```

---

## Phase 7: Update Integration Tests

### 7.1 Keep Integration Tests with In-Memory Store

**File**: `apps/ingestor/test/rate-limiting.test.ts`

**Why**: Integration tests should be fast and not require Redis.

**Override config to disable Redis**:
```typescript
const testConfig = {
  ...config,
  rateLimitMax: 10,
  rateLimitWindowMs: 5000,
  redisEnabled: false, // Use in-memory store for integration tests
};
```

**Rationale**:
- ✅ Fast test execution
- ✅ No Redis dependency for unit/integration tests
- ✅ E2E tests prove Redis integration works
- ✅ Integration tests prove rate limiting logic works

---

## Implementation Order (TDD)

### Step 1: Add Infrastructure
1. Add Redis to `docker-compose.yml`
2. Update Makefile with Redis commands
3. Start infrastructure: `make infra-start`
4. Verify Redis: `make redis-cli` → `PING` → `PONG`

### Step 2: Write E2E Tests FIRST
1. Create `apps/ingestor-e2e/test/rate-limiting-distributed.test.ts`
2. All tests will FAIL (expected - no implementation yet)
3. Commit: "Add E2E multi-instance rate limiting tests (failing)"

### Step 3: Add Configuration
1. Add Redis config to `config.ts`
2. Install `ioredis` dependency
3. Create `connections/redis.ts`

### Step 4: Implement Rate Limiting
1. Initialize Redis in `app.ts`
2. Register `@fastify/rate-limit` with Redis store
3. Add `preHandler` hook to extract userId
4. Update upload handler to use cached data

### Step 5: Run Tests
1. Run integration tests: `pnpm --filter @wallpaperdb/ingestor test rate-limiting.test.ts`
   - Should PASS (uses in-memory)
2. Run E2E tests: `pnpm --filter @wallpaperdb/ingestor-e2e test rate-limiting-distributed.test.ts`
   - Should PASS (uses Redis)

### Step 6: Verify Multi-Instance Manually
1. Build Docker image: `make ingestor-build:docker`
2. Start 3 instances with same Redis
3. Test rate limiting across instances
4. Verify Redis keys: `make redis-cli` → `KEYS wallpaperdb:ratelimit:*`

---

## Success Criteria

✅ Redis container starts with `make infra-start`
✅ App connects to Redis when available
✅ App falls back to in-memory when Redis unavailable
✅ All integration tests pass (in-memory store)
✅ All E2E tests pass (Redis store)
✅ Rate limits enforced across multiple instances
✅ Rate limits isolated per user
✅ Rate limit headers present in responses
✅ RFC 7807 error format on 429 responses
✅ Health check includes Redis status (non-critical)
✅ Graceful degradation if Redis fails

---

## Expected Benefits

**Multi-Instance Safety**: Rate limits work correctly across N instances
**Horizontal Scaling**: Can add more instances without affecting rate limiting
**Persistence**: Rate limits survive instance restarts (if Redis persists)
**Observability**: Redis CLI for debugging rate limit state
**Graceful Degradation**: Falls back to in-memory if Redis unavailable
**Testing**: E2E tests prove distributed rate limiting works

---

## Configuration Reference

**Environment Variables**:
```bash
# Rate Limiting
RATE_LIMIT_MAX=100                    # Max requests per window
RATE_LIMIT_WINDOW_MS=3600000          # Time window (1 hour)

# Redis
REDIS_HOST=localhost                  # Redis hostname
REDIS_PORT=6379                       # Redis port
REDIS_PASSWORD=                       # Optional password
REDIS_ENABLED=true                    # Enable Redis store
```

**Production Defaults**:
- Rate limit: 100 uploads per hour per user
- Redis enabled with local connection
- Graceful degradation to in-memory if Redis fails

**Test Defaults**:
- Rate limit: 10 uploads per 5-10 seconds (fast testing)
- Redis disabled for integration tests (in-memory)
- Redis enabled for E2E tests (testcontainers)

---

## Monitoring & Debugging

**Redis CLI Commands**:
```bash
# View all rate limit keys
KEYS wallpaperdb:ratelimit:*

# Check specific user's rate limit
GET wallpaperdb:ratelimit:user:user_123abc

# View TTL (time to reset)
TTL wallpaperdb:ratelimit:user:user_123abc

# Flush all rate limits (use with caution)
FLUSHALL

# Monitor real-time commands
MONITOR
```

**Metrics to Track**:
- Rate limit hits (429 responses) per user
- Redis connection failures
- Fallback to in-memory store events

---

## Notes

- **Redis is optional**: App works without it (in-memory fallback)
- **Testing strategy**: Integration tests use in-memory, E2E tests use Redis
- **Production**: Always use Redis for true distributed rate limiting
- **Security**: Consider Redis password in production
- **Scaling**: Redis can be clustered for high availability

This approach is production-ready and horizontally scalable! 🚀
