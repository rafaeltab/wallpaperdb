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
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import sharp from 'sharp';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers/containers';
import type { StartedMinioContainer } from '@testcontainers/minio';
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    let network: StartedNetwork;
    let postgresContainer: StartedPostgreSqlContainer;
    let minioContainer: StartedMinioContainer;
    let natsContainer: StartedNatsContainer;
    let redisContainer: StartedTestContainer;
    let ingestor1: StartedTestContainer;
    let ingestor2: StartedTestContainer;
    let ingestor3: StartedTestContainer;

    let baseUrl1: string;
    let baseUrl2: string;
    let baseUrl3: string;
    let databaseUrl: string;
    let s3Bucket: string;

    beforeAll(async () => {
        console.log('Starting infrastructure containers...');

        // Create shared Docker network
        network = await new Network().start();
        console.log('Docker network created');

        // Start PostgreSQL
        postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
            .withDatabase('wallpaperdb_e2e_rate_limit_test')
            .withUsername('test')
            .withPassword('test')
            .withNetwork(network)
            .withNetworkAliases('postgres')
            .start();
        console.log('PostgreSQL container started');

        // Start MinIO
        const { MinioContainer } = await import('@testcontainers/minio');
        minioContainer = await new MinioContainer('minio/minio:latest')
            .withNetwork(network)
            .withNetworkAliases('minio')
            .start();
        console.log('MinIO container started');

        // Start NATS with JetStream
        natsContainer = await createNatsContainer({
            networkAliases: ['nats'],
            enableJetStream: true,
            network: network,
        });
        console.log('NATS container started');

        // Start Redis container
        redisContainer = await new GenericContainer('redis:7-alpine')
            .withExposedPorts(6379)
            .withNetwork(network)
            .withNetworkAliases('redis')
            .withCommand(['redis-server', '--appendonly', 'yes'])
            .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
            .start();
        console.log('Redis container started');

        // Initialize JetStream stream
        const { connect } = await import('nats');
        const nc = await connect({ servers: natsContainer.getConnectionUrl() });
        const jsm = await nc.jetstreamManager();

        try {
            await jsm.streams.add({
                name: 'WALLPAPERS_E2E_RATE_LIMIT_TEST',
                subjects: ['wallpaper.>'],
            });
            console.log('JetStream stream created');
        } catch (error: any) {
            if (!error.message?.includes('stream name already in use')) {
                console.error('Failed to create JetStream stream:', error);
            }
        }

        await nc.close();

        // Store configuration
        databaseUrl = postgresContainer.getConnectionUri();
        s3Bucket = 'wallpapers-rate-limit-test';

        // Initialize database schema
        const pool = new Pool({ connectionString: databaseUrl });

        try {
            const migrationPath = join(__dirname, '../../ingestor/drizzle/0000_left_starjammers.sql');
            const migrationSQL = readFileSync(migrationPath, 'utf-8');
            await pool.query(migrationSQL);
            console.log('Database schema created');
        } finally {
            await pool.end();
        }

        // Create S3 bucket
        const s3Client = new S3Client({
            endpoint: `http://${minioContainer.getHost()}:${minioContainer.getPort()}`,
            region: 'us-east-1',
            credentials: {
                accessKeyId: minioContainer.getUsername(),
                secretAccessKey: minioContainer.getPassword(),
            },
            forcePathStyle: true,
        });

        try {
            await s3Client.send(new CreateBucketCommand({ Bucket: s3Bucket }));
            console.log(`S3 bucket '${s3Bucket}' created`);
        } catch (error: any) {
            if (error.name !== 'BucketAlreadyOwnedByYou') {
                console.warn('Failed to create S3 bucket:', error);
            }
        }

        // Container environment (using network aliases)
        const containerDatabaseUrl = `postgresql://test:test@postgres:5432/wallpaperdb_e2e_rate_limit_test`;
        const containerS3Endpoint = 'http://minio:9000';
        const containerNatsUrl = 'nats://nats:4222';
        const containerRedisHost = 'redis';

        const baseEnvironment = {
            NODE_ENV: 'production',
            DATABASE_URL: containerDatabaseUrl,
            S3_ENDPOINT: containerS3Endpoint,
            S3_ACCESS_KEY_ID: minioContainer.getUsername(),
            S3_SECRET_ACCESS_KEY: minioContainer.getPassword(),
            S3_BUCKET: s3Bucket,
            S3_REGION: 'us-east-1',
            NATS_URL: containerNatsUrl,
            NATS_STREAM: 'WALLPAPERS_E2E_RATE_LIMIT_TEST',
            REDIS_HOST: containerRedisHost,
            REDIS_PORT: '6379',
            REDIS_ENABLED: 'true',
            RATE_LIMIT_MAX: '10', // Low limit for testing
            RATE_LIMIT_WINDOW_MS: '10000', // 10 seconds
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
            RECONCILIATION_INTERVAL_MS: '60000', // 1 minute (not needed for these tests)
            MINIO_CLEANUP_INTERVAL_MS: '60000', // 1 minute (not needed for these tests)
        };

        console.log('Starting 3 ingestor instances...');

        // Start instance 1
        ingestor1 = await new GenericContainer('wallpaperdb-ingestor:latest')
            .withNetwork(network)
            .withExposedPorts(3001)
            .withEnvironment({ ...baseEnvironment, PORT: '3001', OTEL_SERVICE_NAME: 'ingestor-e2e-instance-1' })
            .withWaitStrategy(Wait.forLogMessage('Server is running on port'))
            .withStartupTimeout(60000)
            .start();
        baseUrl1 = `http://${ingestor1.getHost()}:${ingestor1.getMappedPort(3001)}`;
        console.log(`Instance 1 started at ${baseUrl1}`);

        // Start instance 2
        ingestor2 = await new GenericContainer('wallpaperdb-ingestor:latest')
            .withNetwork(network)
            .withExposedPorts(3001)
            .withEnvironment({ ...baseEnvironment, PORT: '3001', OTEL_SERVICE_NAME: 'ingestor-e2e-instance-2' })
            .withWaitStrategy(Wait.forLogMessage('Server is running on port'))
            .withStartupTimeout(60000)
            .start();
        baseUrl2 = `http://${ingestor2.getHost()}:${ingestor2.getMappedPort(3001)}`;
        console.log(`Instance 2 started at ${baseUrl2}`);

        // Start instance 3
        ingestor3 = await new GenericContainer('wallpaperdb-ingestor:latest')
            .withNetwork(network)
            .withExposedPorts(3001)
            .withEnvironment({ ...baseEnvironment, PORT: '3001', OTEL_SERVICE_NAME: 'ingestor-e2e-instance-3' })
            .withWaitStrategy(Wait.forLogMessage('Server is running on port'))
            .withStartupTimeout(60000)
            .start();
        baseUrl3 = `http://${ingestor3.getHost()}:${ingestor3.getMappedPort(3001)}`;
        console.log(`Instance 3 started at ${baseUrl3}`);

        // Give instances a moment to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }, 180000); // 3 minute timeout for startup

    afterAll(async () => {
        console.log('Stopping containers...');
        if (ingestor1) await ingestor1.stop();
        if (ingestor2) await ingestor2.stop();
        if (ingestor3) await ingestor3.stop();
        if (redisContainer) await redisContainer.stop();
        if (natsContainer) await natsContainer.stop();
        if (minioContainer) await minioContainer.stop();
        if (postgresContainer) await postgresContainer.stop();
        if (network) await network.stop();
        console.log('All containers stopped');
    }, 60000);

    beforeEach(async () => {
        // Flush Redis before each test to start fresh
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
