import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import FormData from 'form-data';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  type TesterInstance,
} from '@wallpaperdb/test-utils';
import { InProcessIngestorTesterBuilder } from './builders/InProcessIngestorBuilder.js';
import { IngestorMigrationsTesterBuilder } from './builders/IngestorMigrationsBuilder.js';
import { wallpapers } from '../src/db/schema.js';
import { createTestImage } from './fixtures.js';

/**
 * Rate Limiting Tests
 *
 * Tests verify that rate limiting is properly applied per user:
 * - Users can upload within their rate limit
 * - Uploads beyond limit are rejected with 429
 * - Rate limits are isolated per user
 * - Rate limits reset after time window
 * - Proper RFC 7807 error responses
 */

// Global counter for unique test IDs (ensures no collisions across fast-running tests)
let testIdCounter = 0;

describe('Rate Limiting', () => {
  /**
   * Subclass pattern for custom rate limit configuration.
   * The InProcessIngestorTesterBuilder requires constructor options,
   * so we create a subclass that passes the desired config.
   */
  class RateLimitIngestorTesterBuilder extends InProcessIngestorTesterBuilder {
    constructor() {
      super({
        configOverrides: {
          rateLimitMax: 15,
          rateLimitWindowMs: 5000,
        },
        logger: false,
      });
    }
  }

  type TesterType = TesterInstance<
    | typeof DockerTesterBuilder
    | typeof PostgresTesterBuilder
    | typeof MinioTesterBuilder
    | typeof NatsTesterBuilder
    | typeof IngestorMigrationsTesterBuilder
    | typeof RateLimitIngestorTesterBuilder
  >;

  let tester: TesterType;

  beforeAll(async () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(RateLimitIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    tester
      .withPostgres((builder) => builder.withDatabase(`test_ratelimit_${Date.now()}`))
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPERS')
      .withMigrations()
      .withInProcessApp();

    await tester.setup();
  });

  afterAll(async () => {
    await tester.destroy();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await tester.postgres.getDrizzle().delete(wallpapers);
  });

  it('should allow uploads within rate limit', async () => {
    const userId = `user_ratelimit_test_${++testIdCounter}`;

    // Make 5 uploads (well within limit of 10)
    for (let i = 0; i < 5; i++) {
      // Create unique image for each upload (avoid deduplication)
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 10 + i, g: 10 + i, b: 10 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      const response = await tester.getApp().inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
    }

    // Verify all 5 uploads are in database
    const allUploads = await db.select().from(wallpapers);
    expect(allUploads.length).toBe(5);
  });

  it('should return 429 when user exceeds rate limit', async () => {
    const userId = `user_exceed_limit_${++testIdCounter}`;

    // Make 15 uploads (hit the limit)
    for (let i = 0; i < 15; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 20 + i, g: 20 + i, b: 20 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      const response = await tester.getApp().inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // 16th upload should be rate limited
    const testImage11 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 30, g: 30, b: 30 },
    });
    const form = new FormData();
    form.append('file', testImage11, { filename: 'test-11.jpg', contentType: 'image/jpeg' });
    form.append('userId', userId);

    const response = await tester.getApp().inject({
      method: 'POST',
      url: '/upload',
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(429);

    // Verify only 10 uploads in database (11th was rejected)
    const allUploads = await db.select().from(wallpapers);
    expect(allUploads.length).toBe(15);
  });

  it('should return RFC 7807 Problem Details on rate limit exceeded', async () => {
    const userId = `user_rfc7807_test_${++testIdCounter}`;

    // Hit the rate limit (15 uploads)
    for (let i = 0; i < 15; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 40 + i, g: 40 + i, b: 40 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Exceed limit
    const testImageExceed = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 50, g: 50, b: 50 },
    });
    const form = new FormData();
    form.append('file', testImageExceed, {
      filename: 'test-exceed.jpg',
      contentType: 'image/jpeg',
    });
    form.append('userId', userId);

    const response = await tester.getApp().inject({
      method: 'POST',
      url: '/upload',
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = JSON.parse(response.body);
    expect(body.type).toBe('https://wallpaperdb.example/problems/rate-limit-exceeded');
    expect(body.title).toBe('Rate Limit Exceeded');
    expect(body.status).toBe(429);
    expect(body.detail).toBeDefined();
    expect(body.instance).toBe('/upload');
    expect(body.retryAfter).toBeDefined();
    expect(typeof body.retryAfter).toBe('number');
  });

  it('should apply rate limits per user independently', async () => {
    const timestamp = ++testIdCounter;
    const userA = `user_a_isolation_${timestamp}`;
    const userB = `user_b_isolation_${timestamp}`;

    // User A: Hit rate limit (10 uploads)
    for (let i = 0; i < 15; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 60 + i, g: 60 + i, b: 60 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `userA-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userA);

      const response = await tester.getApp().inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // User A: 16th upload should fail
    const testImageA11 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 70, g: 70, b: 70 },
    });
    const formA11 = new FormData();
    formA11.append('file', testImageA11, { filename: 'userA-11.jpg', contentType: 'image/jpeg' });
    formA11.append('userId', userA);

    const responseA11 = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formA11.getHeaders(),
      payload: formA11,
    });

    expect(responseA11.statusCode).toBe(429);

    // User B: First upload should succeed (independent rate limit)
    const testImageB1 = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 80, g: 80, b: 80 },
    });
    const formB1 = new FormData();
    formB1.append('file', testImageB1, { filename: 'userB-1.jpg', contentType: 'image/jpeg' });
    formB1.append('userId', userB);

    const responseB1 = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formB1.getHeaders(),
      payload: formB1,
    });

    expect(responseB1.statusCode).toBe(200);

    // Verify: 10 from User A, 1 from User B
    const allUploads = await db.select().from(wallpapers);
    expect(allUploads.length).toBe(16);
  });

  it('should reset rate limit after time window expires', async () => {
    const userId = `user_reset_test_${++testIdCounter}`;

    // Hit the rate limit (15 uploads)
    for (let i = 0; i < 15; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 90 + i, g: 90 + i, b: 90 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      const response = await tester.getApp().inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // Verify rate limit is active
    const testImageExceed = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 100, g: 100, b: 100 },
    });
    const formExceed = new FormData();
    formExceed.append('file', testImageExceed, {
      filename: 'test-exceed.jpg',
      contentType: 'image/jpeg',
    });
    formExceed.append('userId', userId);

    const responseExceed = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formExceed.getHeaders(),
      payload: formExceed,
    });

    expect(responseExceed.statusCode).toBe(429);

    // Wait for rate limit window to expire (5 seconds + buffer)
    await new Promise((resolve) => setTimeout(resolve, 5500));

    // After window expires, upload should succeed
    const testImageAfterReset = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 110, g: 110, b: 110 },
    });
    const formAfterReset = new FormData();
    formAfterReset.append('file', testImageAfterReset, {
      filename: 'test-after-reset.jpg',
      contentType: 'image/jpeg',
    });
    formAfterReset.append('userId', userId);

    const responseAfterReset = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formAfterReset.getHeaders(),
      payload: formAfterReset,
    });

    expect(responseAfterReset.statusCode).toBe(200);
  });

  it('should include rate limit headers in responses', async () => {
    const userId = `user_headers_test_${++testIdCounter}`;
    const testImage = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 120, g: 120, b: 120 },
    });

    const form = new FormData();
    form.append('file', testImage, { filename: 'test-headers.jpg', contentType: 'image/jpeg' });
    form.append('userId', userId);

    const response = await tester.getApp().inject({
      method: 'POST',
      url: '/upload',
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(200);

    // Check for rate limit headers
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();

    // Verify values are reasonable
    expect(Number(response.headers['x-ratelimit-limit'])).toBe(15);
    expect(Number(response.headers['x-ratelimit-remaining'])).toBeLessThan(15);
  });

  it('should not rate limit health and ready endpoints', async () => {
    const userId = `user_health_test_${++testIdCounter}`;

    // Hit rate limit on /upload
    for (let i = 0; i < 15; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 130 + i, g: 130 + i, b: 130 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Verify /upload is rate limited
    const testImageExceed = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 140, g: 140, b: 140 },
    });
    const formExceed = new FormData();
    formExceed.append('file', testImageExceed, {
      filename: 'test-exceed.jpg',
      contentType: 'image/jpeg',
    });
    formExceed.append('userId', userId);

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formExceed.getHeaders(),
      payload: formExceed,
    });

    expect(uploadResponse.statusCode).toBe(429);

    // Health and ready should still work (call many times)
    for (let i = 0; i < 50; i++) {
      const healthResponse = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(healthResponse.statusCode).toBe(200);

      const readyResponse = await app.inject({
        method: 'GET',
        url: '/ready',
      });
      expect(readyResponse.statusCode).toBe(200);
    }
  });

  it('should include Retry-After header when rate limited', async () => {
    const userId = `user_retry_after_test_${++testIdCounter}`;

    // Hit the rate limit
    for (let i = 0; i < 15; i++) {
      const testImage = await createTestImage({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        color: { r: 150 + i, g: 150 + i, b: 150 + i },
      });
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', userId);

      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Exceed limit
    const testImageExceed = await createTestImage({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      color: { r: 160, g: 160, b: 160 },
    });
    const form = new FormData();
    form.append('file', testImageExceed, {
      filename: 'test-exceed.jpg',
      contentType: 'image/jpeg',
    });
    form.append('userId', userId);

    const response = await tester.getApp().inject({
      method: 'POST',
      url: '/upload',
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();

    // Should be a number in seconds
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(5); // Should be <= window size (5 seconds)
  });
});
