/**
 * E2E Multi-Instance Rate Limiting Tests
 *
 * NOTE: This test file has its own dedicated vitest config (vitest.distributed.config.ts)
 * that runs INDEPENDENTLY of the global setup.ts to avoid conflicts.
 *
 * To run: pnpm vitest --config vitest.distributed.config.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request } from 'undici';
import sharp from 'sharp';
import {
	createDefaultTesterBuilder,
	DockerTesterBuilder,
	PostgresTesterBuilder,
	MinioTesterBuilder,
	NatsTesterBuilder,
	RedisTesterBuilder,
	type TesterInstance,
} from '@wallpaperdb/test-utils';
import { ContainerizedIngestorTesterBuilder } from './builders/ContainerizedIngestorBuilder.js';
import { IngestorMigrationsTesterBuilder } from './builders/IngestorMigrationsTesterBuilder.js';

/**
 * Test Scenarios:
 * 1. Multiple instances enforce same rate limit (not per-instance)
 * 2. Rate limit counter is shared across all instances
 * 3. One instance hitting limit blocks requests on other instances
 * 4. Different users have isolated rate limits
 */

// Helper to create a test JPEG image
async function createTestJpeg(): Promise<Buffer> {
    return sharp({
        create: {
            width: 1920,
            height: 1080,
            channels: 3,
            background: { r: 100, g: 150, b: 200 },
        },
    })
        .jpeg()
        .toBuffer();
}

// Helper to create multipart form data
function createFormData(imageBuffer: Buffer, userId: string, filename = 'test.jpg'): { body: Buffer; headers: Record<string, string> } {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const parts: Buffer[] = [];

    // Add userId field
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="userId"\r\n\r\n` +
        `${userId}\r\n`
    ));

    // Add file field
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
    ));
    parts.push(imageBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    return {
        body: Buffer.concat(parts),
        headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
        },
    };
}

describe('E2E Multi-Instance Rate Limiting', () => {
    type TesterType = TesterInstance<
        | typeof DockerTesterBuilder
        | typeof PostgresTesterBuilder
        | typeof MinioTesterBuilder
        | typeof NatsTesterBuilder
        | typeof RedisTesterBuilder
        | typeof IngestorMigrationsTesterBuilder
        | typeof ContainerizedIngestorTesterBuilder
    >;

    let tester: TesterType;
    let baseUrl1: string;
    let baseUrl2: string;
    let baseUrl3: string;

    beforeAll(async () => {
        /**
         * Pattern: Subclassing to Pass Constructor Options
         *
         * The TesterBuilder framework's `.with()` method instantiates builders with no arguments.
         * When a builder requires constructor parameters (like ContainerizedIngestorTesterBuilder),
         * create a subclass that calls super() with the desired configuration.
         *
         * This approach maintains type safety while working within the framework's constraints.
         */
        class DistributedIngestorTesterBuilder extends ContainerizedIngestorTesterBuilder {
            constructor() {
                super({
                    instances: 3,
                    enableRedis: true,
                    config: {
                        rateLimitMax: 10,
                        rateLimitWindowMs: 10000,
                        reconciliationIntervalMs: 60000,
                        minioCleanupIntervalMs: 60000,
                    },
                });
            }
        }

        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(DistributedIngestorTesterBuilder)
            .build();

        tester = new TesterClass();

        tester
            .withNetwork()
            .withPostgres((builder) =>
                builder
                    .withDatabase(`test_e2e_rate_limit_${Date.now()}`)
                    .withNetworkAlias('postgres')
            )
            .withMinio((builder) => builder.withNetworkAlias('minio'))
            .withMinioBucket('wallpapers-rate-limit-test')
            .withNats((builder) =>
                builder.withNetworkAlias('nats').withJetstream()
            )
            .withStream('WALLPAPERS_E2E_RATE_LIMIT_TEST')
            .withRedis((builder) => builder.withNetworkAlias('redis'))
            .withMigrations()
            .withContainerizedApp();

        await tester.setup();

        // Get base URLs for all 3 instances
        const containers = tester.getIngestorContainers();
        baseUrl1 = `http://${containers[0].getHost()}:${containers[0].getMappedPort(3001)}`;
        baseUrl2 = `http://${containers[1].getHost()}:${containers[1].getMappedPort(3001)}`;
        baseUrl3 = `http://${containers[2].getHost()}:${containers[2].getMappedPort(3001)}`;

        console.log(`Instance 1: ${baseUrl1}`);
        console.log(`Instance 2: ${baseUrl2}`);
        console.log(`Instance 3: ${baseUrl3}`);

        // Give instances a moment to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }, 180000); // 3 minute timeout for startup

    afterAll(async () => {
        await tester.destroy();
    });

    beforeEach(async () => {
        // Flush Redis before each test to start fresh
        const redisContainer = tester.redis.config.container;
        await redisContainer.exec(['redis-cli', 'FLUSHALL']);
        console.log('Redis flushed');
    });

    test('should enforce rate limit across all instances (not per-instance)', async () => {
        const testImage = await createTestJpeg();
        const userId = `user_distributed_${Date.now()}`;
        const instances = [baseUrl1, baseUrl2, baseUrl3];

        console.log(`Testing with userId: ${userId}`);

        // Make 10 requests distributed across 3 instances in round-robin fashion (rate limit = 10)
        // Sending sequentially to avoid upload concurrency issues (not related to rate limiting)
        const responses = [];
        for (let i = 0; i < 10; i++) {
            const instanceUrl = instances[i % 3];
            const formData = createFormData(testImage, userId, `test-${i}.jpg`);

            const response = await request(`${instanceUrl}/upload`, {
                method: 'POST',
                headers: formData.headers,
                body: formData.body,
            });

            responses.push(response);
            expect(response.statusCode).toBe(200);
        }

        console.log(`✓ All 10 requests succeeded across instances in round-robin fashion`);

        // 11th request should fail on ANY instance
        const formData11 = createFormData(testImage, userId, 'test-11.jpg');
        const response11 = await request(`${baseUrl1}/upload`, {
            method: 'POST',
            headers: formData11.headers,
            body: formData11.body,
        });

        expect(response11.statusCode).toBe(429);
        console.log(`✓ 11th request correctly rejected with 429`);

        // Verify error format (RFC 7807)
        const body = await response11.body.json();
        expect(body).toMatchObject({
            type: 'https://wallpaperdb.example/problems/rate-limit-exceeded',
            status: 429,
            title: 'Rate Limit Exceeded',
        });
        expect(body.retryAfter).toBeDefined();
        expect(response11.headers['retry-after']).toBeDefined();
        expect(response11.headers['x-ratelimit-limit']).toBe('10');
        expect(response11.headers['x-ratelimit-remaining']).toBe('0');
        console.log(`✓ Error response format correct`);
    });

    test('should share rate limit counter across instances', async () => {
        const testImage = await createTestJpeg();
        const userId = `user_counter_${Date.now()}`;

        console.log(`Testing counter sharing with userId: ${userId}`);

        // Instance 1: Make 5 requests
        for (let i = 0; i < 5; i++) {
            const formData = createFormData(testImage, userId, `app1-${i}.jpg`);
            const response = await request(`${baseUrl1}/upload`, {
                method: 'POST',
                headers: formData.headers,
                body: formData.body,
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['x-ratelimit-limit']).toBe('10');
            expect(response.headers['x-ratelimit-remaining']).toBe(String(10 - (i + 1)));
        }
        console.log(`✓ Instance 1 made 5 requests, remaining should be 5`);

        // Instance 2: Make 5 more requests (should reach limit)
        for (let i = 0; i < 5; i++) {
            const formData = createFormData(testImage, userId, `app2-${i}.jpg`);
            const response = await request(`${baseUrl2}/upload`, {
                method: 'POST',
                headers: formData.headers,
                body: formData.body,
            });

            expect(response.statusCode).toBe(200);
        }
        console.log(`✓ Instance 2 made 5 more requests, total now 10`);

        // Instance 3: 11th request should fail
        const formData11 = createFormData(testImage, userId, 'app3-exceed.jpg');
        const response11 = await request(`${baseUrl3}/upload`, {
            method: 'POST',
            headers: formData11.headers,
            body: formData11.body,
        });

        expect(response11.statusCode).toBe(429);
        expect(response11.headers['x-ratelimit-remaining']).toBe('0');
        console.log(`✓ Instance 3 correctly rejected 11th request`);
    });

    test('should isolate rate limits per user across instances', async () => {
        const testImage = await createTestJpeg();
        const userA = `user_a_isolated_${Date.now()}`;
        const userB = `user_b_isolated_${Date.now()}`;

        console.log(`Testing user isolation: ${userA} vs ${userB}`);

        // User A: Hit limit on instance 1
        for (let i = 0; i < 10; i++) {
            const formData = createFormData(testImage, userA, `userA-${i}.jpg`);
            await request(`${baseUrl1}/upload`, {
                method: 'POST',
                headers: formData.headers,
                body: formData.body,
            });
        }
        console.log(`✓ User A hit rate limit`);

        // User A: Verify rate limited on instance 2
        const formDataA11 = createFormData(testImage, userA, 'userA-exceed.jpg');
        const responseA11 = await request(`${baseUrl2}/upload`, {
            method: 'POST',
            headers: formDataA11.headers,
            body: formDataA11.body,
        });

        expect(responseA11.statusCode).toBe(429);
        console.log(`✓ User A correctly rate limited on different instance`);

        // User B: Should still be able to upload on instance 3
        const formDataB1 = createFormData(testImage, userB, 'userB-1.jpg');
        const responseB1 = await request(`${baseUrl3}/upload`, {
            method: 'POST',
            headers: formDataB1.headers,
            body: formDataB1.body,
        });

        expect(responseB1.statusCode).toBe(200);
        console.log(`✓ User B can still upload (rate limits are per-user)`);
    });

    test('should reset rate limit after time window expires', async () => {
        const testImage = await createTestJpeg();
        const userId = `user_reset_${Date.now()}`;

        console.log(`Testing rate limit reset with userId: ${userId}`);

        // Hit rate limit across instances
        for (let i = 0; i < 10; i++) {
            const instanceUrl = [baseUrl1, baseUrl2, baseUrl3][i % 3];
            const formData = createFormData(testImage, userId, `test-${i}.jpg`);
            await request(`${instanceUrl}/upload`, {
                method: 'POST',
                headers: formData.headers,
                body: formData.body,
            });
        }
        console.log(`✓ Rate limit hit (10 uploads)`);

        // Verify rate limited
        const formDataExceed = createFormData(testImage, userId, 'test-exceed.jpg');
        const responseExceed = await request(`${baseUrl1}/upload`, {
            method: 'POST',
            headers: formDataExceed.headers,
            body: formDataExceed.body,
        });

        expect(responseExceed.statusCode).toBe(429);
        console.log(`✓ Confirmed rate limited`);

        // Wait for window to expire (10 seconds + buffer)
        console.log('Waiting for rate limit window to expire (11 seconds)...');
        await new Promise(resolve => setTimeout(resolve, 11000));

        // After reset, should be able to upload again
        const formDataAfterReset = createFormData(testImage, userId, 'test-after-reset.jpg');
        const responseAfterReset = await request(`${baseUrl2}/upload`, {
            method: 'POST',
            headers: formDataAfterReset.headers,
            body: formDataAfterReset.body,
        });

        expect(responseAfterReset.statusCode).toBe(200);
        console.log(`✓ After window reset, uploads work again`);
    }, 30000); // Extended timeout for waiting

    test('should include proper rate limit headers in all responses', async () => {
        const testImage = await createTestJpeg();
        const userId = `user_headers_${Date.now()}`;

        const formData = createFormData(testImage, userId, 'test-headers.jpg');
        const response = await request(`${baseUrl1}/upload`, {
            method: 'POST',
            headers: formData.headers,
            body: formData.body,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['x-ratelimit-limit']).toBe('10');
        expect(response.headers['x-ratelimit-remaining']).toBe('9');
        expect(response.headers['x-ratelimit-reset']).toBeDefined();

        const resetTime = Number(response.headers['x-ratelimit-reset']);
        expect(resetTime).toBeGreaterThan(Date.now());
        console.log(`✓ Rate limit headers present and valid`);
    });
});
