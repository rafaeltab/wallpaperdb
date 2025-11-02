import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { getTestConfig } from './setup.js';
import { createApp } from '../src/app.js';

describe('Health Endpoint', () => {
  let fastify: FastifyInstance;
  let config: ReturnType<typeof getTestConfig>;

  beforeAll(async () => {
    config = getTestConfig();

    // Create MinIO bucket before starting the app
    const s3Client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
      forcePathStyle: true,
    });

    try {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: config.s3Bucket,
        })
      );
      console.log('MinIO bucket created');
    } catch (error) {
      // Bucket might already exist, that's okay
      if (error instanceof Error && !error.message.includes('BucketAlreadyOwnedByYou')) {
        console.error('Failed to create bucket:', error);
      }
    }

    console.log('Creating app');
    // Create the actual app using the real implementation
    fastify = await createApp(config, { logger: false });
    console.log('Created app');
  }, 60000); // 60 second timeout for beforeAll

  afterAll(async () => {
    if (fastify) {
      await fastify.close();
    }
  });

  it('should return healthy status when all services are up', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.status).toBe('healthy');
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toBe(true);
    expect(body.checks.minio).toBe(true);
    expect(body.checks.nats).toBe(true);
    expect(body.checks.otel).toBe(true);
    expect(body.timestamp).toBeDefined();
  });
});
