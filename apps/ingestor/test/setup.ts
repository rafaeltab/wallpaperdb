import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

// MinIO container types
import type { StartedMinIOContainer } from '@testcontainers/minio';
import { beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Config } from '../src/config.js';

// Global test state
let postgresContainer: StartedPostgreSqlContainer;
let minioContainer: StartedMinIOContainer;
let natsContainer: StartedTestContainer;
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

  // Start NATS container
  natsContainer = await new GenericContainer('nats:2.10-alpine')
    .withExposedPorts(4222)
    .withCommand(['-js']) // Enable JetStream
    .start();
  console.log('NATS container started');

  const natsPort = natsContainer.getMappedPort(4222);
  const natsHost = natsContainer.getHost();

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
    natsUrl: `nats://${natsHost}:${natsPort}`,
    natsStream: 'WALLPAPERS_TEST',
    otelEndpoint: 'http://localhost:4318', // OTEL can stay local or be mocked
    otelServiceName: 'ingestor-test',
  };

  // Initialize database schema
  const pool = new Pool({
    connectionString: testConfig.databaseUrl,
  });

  const db = drizzle(pool);

  // Create ENUMs
  await pool.query(`
    CREATE TYPE file_type AS ENUM ('image', 'video');
  `);

  await pool.query(`
    CREATE TYPE upload_state AS ENUM (
      'initiated',
      'uploading',
      'stored',
      'processing',
      'completed',
      'failed'
    );
  `);

  // Create wallpapers table
  await pool.query(`
    CREATE TABLE wallpapers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content_hash TEXT,
      upload_state upload_state NOT NULL DEFAULT 'initiated',
      state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      upload_attempts INTEGER NOT NULL DEFAULT 0,
      processing_error TEXT,
      file_type file_type,
      mime_type TEXT,
      file_size_bytes BIGINT,
      original_filename TEXT,
      width INTEGER,
      height INTEGER,
      aspect_ratio DECIMAL(10, 4) GENERATED ALWAYS AS (
        CASE WHEN width IS NOT NULL AND height IS NOT NULL
        THEN width::decimal / height::decimal
        ELSE NULL END
      ) STORED,
      storage_key TEXT,
      storage_bucket TEXT DEFAULT 'wallpapers',
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_wallpapers_user_id ON wallpapers(user_id);
    CREATE INDEX idx_wallpapers_upload_state ON wallpapers(upload_state);
    CREATE INDEX idx_wallpapers_state_changed_at ON wallpapers(state_changed_at);
    CREATE INDEX idx_wallpapers_uploaded_at ON wallpapers(uploaded_at DESC);
    CREATE INDEX idx_wallpapers_file_type ON wallpapers(file_type) WHERE file_type IS NOT NULL;
    CREATE UNIQUE INDEX idx_wallpapers_content_hash
      ON wallpapers(user_id, content_hash)
      WHERE content_hash IS NOT NULL AND upload_state IN ('stored', 'processing', 'completed');
  `);

  await pool.end();

  console.log('Database schema created');
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
