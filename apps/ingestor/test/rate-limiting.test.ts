import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import FormData from 'form-data';
import { createApp } from '../src/app.js';
import { getTestConfig } from './setup.js';
import * as schema from '../src/db/schema.js';
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

describe('Rate Limiting', () => {
  let app: FastifyInstance;
  let config: ReturnType<typeof getTestConfig>;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    // Get test config from setup
    config = getTestConfig();

    // Setup database connection
    pool = new Pool({ connectionString: config.databaseUrl });
    db = drizzle(pool, { schema: schema });

    // Create app with test configuration
    // Override rate limit config for faster testing
    const testConfig = {
      ...config,
      rateLimitMax: 10, // Low limit for testing
      rateLimitWindowMs: 5000, // 5 seconds for faster tests
    };

    app = await createApp(testConfig, { logger: false, enableOtel: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await db.delete(wallpapers);
  });

  it('should allow uploads within rate limit', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Make 5 uploads (well within limit of 10)
    for (let i = 0; i < 5; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_ratelimit_test');

      const response = await app.inject({
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
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Make 10 uploads (hit the limit)
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_exceed_limit');

      const response = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // 11th upload should be rate limited
    const form = new FormData();
    form.append('file', testImage, { filename: 'test-11.jpg', contentType: 'image/jpeg' });
    form.append('userId', 'user_exceed_limit');

    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: form.getHeaders(),
      payload: form,
    });

    expect(response.statusCode).toBe(429);

    // Verify only 10 uploads in database (11th was rejected)
    const allUploads = await db.select().from(wallpapers);
    expect(allUploads.length).toBe(10);
  });

  it('should return RFC 7807 Problem Details on rate limit exceeded', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Hit the rate limit (10 uploads)
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_rfc7807_test');

      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Exceed limit
    const form = new FormData();
    form.append('file', testImage, { filename: 'test-exceed.jpg', contentType: 'image/jpeg' });
    form.append('userId', 'user_rfc7807_test');

    const response = await app.inject({
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
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // User A: Hit rate limit (10 uploads)
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `userA-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_a_isolation');

      const response = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // User A: 11th upload should fail
    const formA11 = new FormData();
    formA11.append('file', testImage, { filename: 'userA-11.jpg', contentType: 'image/jpeg' });
    formA11.append('userId', 'user_a_isolation');

    const responseA11 = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formA11.getHeaders(),
      payload: formA11,
    });

    expect(responseA11.statusCode).toBe(429);

    // User B: First upload should succeed (independent rate limit)
    const formB1 = new FormData();
    formB1.append('file', testImage, { filename: 'userB-1.jpg', contentType: 'image/jpeg' });
    formB1.append('userId', 'user_b_isolation');

    const responseB1 = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formB1.getHeaders(),
      payload: formB1,
    });

    expect(responseB1.statusCode).toBe(200);

    // Verify: 10 from User A, 1 from User B
    const allUploads = await db.select().from(wallpapers);
    expect(allUploads.length).toBe(11);
  });

  it('should reset rate limit after time window expires', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Hit the rate limit (10 uploads)
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_reset_test');

      const response = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(200);
    }

    // Verify rate limit is active
    const formExceed = new FormData();
    formExceed.append('file', testImage, { filename: 'test-exceed.jpg', contentType: 'image/jpeg' });
    formExceed.append('userId', 'user_reset_test');

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
    const formAfterReset = new FormData();
    formAfterReset.append('file', testImage, {
      filename: 'test-after-reset.jpg',
      contentType: 'image/jpeg',
    });
    formAfterReset.append('userId', 'user_reset_test');

    const responseAfterReset = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: formAfterReset.getHeaders(),
      payload: formAfterReset,
    });

    expect(responseAfterReset.statusCode).toBe(200);
  });

  it('should include rate limit headers in responses', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    const form = new FormData();
    form.append('file', testImage, { filename: 'test-headers.jpg', contentType: 'image/jpeg' });
    form.append('userId', 'user_headers_test');

    const response = await app.inject({
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
    expect(Number(response.headers['x-ratelimit-limit'])).toBe(10);
    expect(Number(response.headers['x-ratelimit-remaining'])).toBeLessThan(10);
  });

  it('should not rate limit health and ready endpoints', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Hit rate limit on /upload
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_health_test');

      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Verify /upload is rate limited
    const formExceed = new FormData();
    formExceed.append('file', testImage, { filename: 'test-exceed.jpg', contentType: 'image/jpeg' });
    formExceed.append('userId', 'user_health_test');

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
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Hit the rate limit
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', testImage, { filename: `test-${i}.jpg`, contentType: 'image/jpeg' });
      form.append('userId', 'user_retry_after_test');

      await app.inject({
        method: 'POST',
        url: '/upload',
        headers: form.getHeaders(),
        payload: form,
      });
    }

    // Exceed limit
    const form = new FormData();
    form.append('file', testImage, { filename: 'test-exceed.jpg', contentType: 'image/jpeg' });
    form.append('userId', 'user_retry_after_test');

    const response = await app.inject({
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
