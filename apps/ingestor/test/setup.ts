import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

// MinIO container types
import type { StartedMinioContainer } from '@testcontainers/minio';
import { beforeAll, afterAll } from 'vitest';
// import { drizzle } from 'drizzle-orm/node-postgres';
// import { Pool } from 'pg';
import type { Config } from '../src/config.js';

// Global test state
let postgresContainer: StartedPostgreSqlContainer;
let minioContainer: StartedMinioContainer;
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
  // const pool = new Pool({
  //   connectionString: testConfig.databaseUrl,
  // });
  // const db = drizzle(pool);
  // await pool.query(`
  //   Some SQl
  // `);
  //
  // await pool.end();
  // console.log('Database schema created');
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
