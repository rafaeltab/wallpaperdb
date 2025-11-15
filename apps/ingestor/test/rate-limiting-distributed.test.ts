import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import FormData from 'form-data';
import { createTestImage } from './fixtures.js';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  RedisTesterBuilder,
  type TesterInstance,
} from '@wallpaperdb/test-utils';
import { IngestorMigrationsTesterBuilder } from './builders/IngestorMigrationsBuilder.js';
import { wallpapers } from '../src/db/schema.js';
import { loadConfig } from '../src/config.js';

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
 * 4. Rate limits are isolated per user across instances
 * 5. Rate limit resets after time window expires
 */

describe('E2E Multi-Instance Rate Limiting', () => {
  type TesterType = TesterInstance<
    | typeof DockerTesterBuilder
    | typeof PostgresTesterBuilder
    | typeof MinioTesterBuilder
    | typeof NatsTesterBuilder
    | typeof RedisTesterBuilder
    | typeof IngestorMigrationsTesterBuilder
  >;

  let tester: TesterType;
  let app1: FastifyInstance;
  let app2: FastifyInstance;
  let app3: FastifyInstance;

  beforeAll(async () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(RedisTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .build();

    tester = new TesterClass();

    tester
      .withPostgres((builder) =>
        builder.withDatabase(`test_ratelimit_distributed_${Date.now()}`)
      )
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPERS')
      .withRedis()
      .withMigrations();

    await tester.setup();

    console.log('Starting app instances...');

    // Get infrastructure endpoints
    const postgres = tester.postgres;
    const minio = tester.minio;
    const nats = tester.nats;
    const redis = tester.redis;

    // Set environment variables for all app instances
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = postgres.connectionString;
    process.env.S3_ENDPOINT = minio.endpoint;
    process.env.S3_ACCESS_KEY_ID = minio.options.accessKey;
    process.env.S3_SECRET_ACCESS_KEY = minio.options.secretKey;
    process.env.S3_BUCKET = minio.buckets[0];
    process.env.NATS_URL = nats.endpoint;
    process.env.NATS_STREAM = nats.streams[0];
    process.env.REDIS_HOST = redis.host;
    process.env.REDIS_PORT = String(redis.port);
    process.env.REDIS_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = '10';
    process.env.RATE_LIMIT_WINDOW_MS = '10000';

    const config = loadConfig();

    // Start 3 app instances
    const config1 = { ...config, port: 0 }; // Use random port
    const config2 = { ...config, port: 0 };
    const config3 = { ...config, port: 0 };

    app1 = await createApp(config1, { logger: false, enableOtel: false });
    app2 = await createApp(config2, { logger: false, enableOtel: false });
    app3 = await createApp(config3, { logger: false, enableOtel: false });

    await app1.ready();
    await app2.ready();
    await app3.ready();

    console.log('All instances started');
  }, 120000); // 2 minute timeout for container startup

  afterAll(async () => {
    await app1.close();
    await app2.close();
    await app3.close();
    await tester.destroy();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await tester.postgres.getDrizzle().delete(wallpapers);
    // Flush Redis before each test
    await tester.redis.flush();
  });

  it('should enforce rate limit across all instances (not per-instance)', async () => {
    const userId = 'user_distributed_test';

    // Make 10 requests distributed across 3 instances (rate limit = 10)
    const requests = [];

    for (let i = 0; i < 10; i++) {
      // Create unique image for each upload (to avoid deduplication)
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 100 + i, g: 100 + i, b: 100 + i },
      });

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
    const successCount = responses.filter((r) => r.statusCode === 200).length;
    expect(successCount).toBe(10);

    // 11th request should fail on ANY instance
    const testImage11 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 111, g: 111, b: 111 },
    });
    const form11 = new FormData();
    form11.append('file', testImage11, { filename: 'test-11.jpg', contentType: 'image/jpeg' });
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
    const userId = 'user_counter_test';

    // Instance 1: Make 5 requests
    for (let i = 0; i < 5; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 50 + i, g: 50 + i, b: 50 + i },
      });
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
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 60 + i, g: 60 + i, b: 60 + i },
      });
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
    const testImage11 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 70, g: 70, b: 70 },
    });
    const form11 = new FormData();
    form11.append('file', testImage11, { filename: 'app3-exceed.jpg', contentType: 'image/jpeg' });
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
    // User A: Hit limit on instance 1
    for (let i = 0; i < 10; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 80 + i, g: 80 + i, b: 80 + i },
      });
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
    const testImageA11 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 90, g: 90, b: 90 },
    });
    const formA11 = new FormData();
    formA11.append('file', testImageA11, {
      filename: 'userA-exceed.jpg',
      contentType: 'image/jpeg',
    });
    formA11.append('userId', 'user_a_isolated');

    const responseA11 = await app2.inject({
      method: 'POST',
      url: '/upload',
      headers: formA11.getHeaders(),
      payload: formA11,
    });

    expect(responseA11.statusCode).toBe(429);

    // User B: Should still be able to upload on instance 3
    const testImageB1 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 95, g: 95, b: 95 },
    });
    const formB1 = new FormData();
    formB1.append('file', testImageB1, { filename: 'userB-1.jpg', contentType: 'image/jpeg' });
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
    const userId = 'user_reset_test';

    // Hit rate limit across instances
    for (let i = 0; i < 10; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 120 + i, g: 120 + i, b: 120 + i },
      });
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
    const testImageExceed = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 130, g: 130, b: 130 },
    });
    const formExceed = new FormData();
    formExceed.append('file', testImageExceed, {
      filename: 'test-exceed.jpg',
      contentType: 'image/jpeg',
    });
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
    await new Promise((resolve) => setTimeout(resolve, 11000));

    // After reset, should be able to upload again
    const testImageAfterReset = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 140, g: 140, b: 140 },
    });
    const formAfterReset = new FormData();
    formAfterReset.append('file', testImageAfterReset, {
      filename: 'test-after-reset.jpg',
      contentType: 'image/jpeg',
    });
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
