import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createNatsContainer,
  type StartedNatsContainer,
} from '@wallpaperdb/testcontainers/containers';

// MinIO container types
import type { StartedMinioContainer } from '@testcontainers/minio';
import { beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../src/config.js';
import * as schema from '../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Global test state
let postgresContainer: StartedPostgreSqlContainer;
let minioContainer: StartedMinioContainer;
let natsContainer: StartedNatsContainer;
let testConfig: Config;

export function getTestConfig(): Config {
  if (!testConfig) {
    throw new Error('Test config not initialized. Make sure tests run after beforeAll hook.');
  }
  return testConfig;
}

beforeAll(async () => {
  console.log('Starting testcontainers...');

  // Start PostgreSQL container
  postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('wallpaperdb_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  console.log('PostgreSQL container started');

  // Start MinIO container using dynamic import
  const { MinioContainer } = await import('@testcontainers/minio');
  minioContainer = await new MinioContainer('minio/minio:latest').start();
  console.log('MinIO container started');

  // Start NATS container with JetStream support
  natsContainer = await createNatsContainer({
    enableJetStream: true,
  });
  console.log('NATS container started');

  // Get connection URL from the NATS container
  const natsUrl = natsContainer.getConnectionUrl();

  // Create test config
  testConfig = {
    port: 0, // Will use random port for tests
    nodeEnv: 'test',
    databaseUrl: postgresContainer.getConnectionUri(),
    s3Endpoint: `http://${minioContainer.getHost()}:${minioContainer.getPort()}`,
    s3AccessKeyId: minioContainer.getUsername(),
    s3SecretAccessKey: minioContainer.getPassword(),
    s3Bucket: 'wallpapers-test',
    s3Region: 'us-east-1',
    natsUrl,
    natsStream: 'WALLPAPERS_TEST',
    otelEndpoint: 'http://localhost:4318', // OTEL can stay local or be mocked
    otelServiceName: 'ingestor-test',
    reconciliationIntervalMs: 100,
    minioCleanupIntervalMs: 500,
    rateLimitMax: 100,
    rateLimitWindowMs: 60 * 60 * 1000, // 1 hour
    redisHost: 'localhost',
    redisPort: 6379,
    redisPassword: undefined,
    redisEnabled: false, // Disable Redis for integration tests (use in-memory)
  };

  // Set environment variables so that loadConfig() works in scheduler service
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testConfig.databaseUrl;
  process.env.S3_ENDPOINT = testConfig.s3Endpoint;
  process.env.S3_ACCESS_KEY_ID = testConfig.s3AccessKeyId;
  process.env.S3_SECRET_ACCESS_KEY = testConfig.s3SecretAccessKey;
  process.env.S3_BUCKET = testConfig.s3Bucket;
  process.env.S3_REGION = testConfig.s3Region;
  process.env.NATS_URL = testConfig.natsUrl;
  process.env.NATS_STREAM = testConfig.natsStream;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = testConfig.otelEndpoint;
  process.env.OTEL_SERVICE_NAME = testConfig.otelServiceName;

  // Initialize database schema
  const pool = new Pool({
    connectionString: testConfig.databaseUrl,
  });

  try {
    // Read and execute migration SQL
    const migrationPath = join(__dirname, '../drizzle/0000_left_starjammers.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    await pool.query(migrationSQL);
    console.log('Database schema created');
  } finally {
    await pool.end();
  }
}, 60000);

afterAll(async () => {
  console.log('Stopping testcontainers...');

  if (natsContainer) {
    await natsContainer.stop();
    console.log('NATS container stopped');
  }

  if (minioContainer) {
    await minioContainer.stop();
    console.log('MinIO container stopped');
  }

  if (postgresContainer) {
    await postgresContainer.stop();
    console.log('PostgreSQL container stopped');
  }
}, 60000);
