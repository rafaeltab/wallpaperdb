import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer, StartedNatsContainer } from '@wallpaperdb/testcontainers/containers';
import type { StartedMinioContainer } from '@testcontainers/minio';
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers';
import { beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Global test state
let network: StartedNetwork;
let postgresContainer: StartedPostgreSqlContainer;
let minioContainer: StartedMinioContainer;
let natsContainer: StartedNatsContainer;
let ingestorContainer: StartedTestContainer;

// Test configuration
export let baseUrl: string;
export let databaseUrl: string;
export let s3Endpoint: string;
export let s3AccessKeyId: string;
export let s3SecretAccessKey: string;
export let s3Bucket: string;
export let natsUrl: string;

beforeAll(async () => {
    console.log('Starting infrastructure containers...');

    // Create shared Docker network for all containers
    network = await new Network().start();
    console.log('Docker network created');

    // Start PostgreSQL container on the network
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('wallpaperdb_e2e_test')
        .withUsername('test')
        .withPassword('test')
        .withNetwork(network)
        .withNetworkAliases('postgres')
        .start();

    console.log('PostgreSQL container started');

    // Start MinIO container using dynamic import
    const { MinioContainer } = await import('@testcontainers/minio');
    minioContainer = await new MinioContainer('minio/minio:latest')
        .withNetwork(network)
        .withNetworkAliases('minio')
        .start();
    console.log('MinIO container started');

    // Start NATS container with JetStream support
    natsContainer = await createNatsContainer({
        networkAliases: ['nats'],
        enableJetStream: true,
        network: network,
    });

    // Wrap in our custom class for the getConnectionUrl() method
    // natsContainer = new StartedNatsContainer(natsGenericContainer);
    console.log('NATS container started');

    // Store configuration for tests
    databaseUrl = postgresContainer.getConnectionUri();
    s3Endpoint = `http://${minioContainer.getHost()}:${minioContainer.getPort()}`;
    s3AccessKeyId = minioContainer.getUsername();
    s3SecretAccessKey = minioContainer.getPassword();
    s3Bucket = 'wallpapers-test';
    natsUrl = natsContainer.getConnectionUrl();

    // Initialize database schema
    const pool = new Pool({ connectionString: databaseUrl });

    try {
        // Read and execute migration SQL
        const migrationPath = join(__dirname, '../../ingestor/drizzle/0000_left_starjammers.sql');
        const migrationSQL = readFileSync(migrationPath, 'utf-8');
        await pool.query(migrationSQL);
        console.log('Database schema created');
    } finally {
        await pool.end();
    }

    // Create S3 bucket
    const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    const s3Client = new S3Client({
        endpoint: s3Endpoint,
        region: 'us-east-1',
        credentials: {
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey,
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

    // Build the Docker image (ingestor owns this via build:docker script)
    console.log('Building ingestor Docker image...');
    try {
        // execSync('pnpm --filter @wallpaperdb/ingestor build:docker', {
        //   stdio: 'inherit',
        //   cwd: join(__dirname, '../../..'),
        // });
        console.log('Docker image built successfully');
    } catch (error) {
        console.error('Failed to build Docker image:', error);
        throw error;
    }

    // Start the ingestor Docker container
    console.log('Starting ingestor container...');

    // Use container network aliases for inter-container communication
    const containerDatabaseUrl = `postgresql://test:test@postgres:5432/wallpaperdb_e2e_test`;
    const containerS3Endpoint = 'http://minio:9000';
    const containerNatsUrl = 'nats://nats:4222';

    console.log('Environment variables:');
    console.log(`  DATABASE_URL: ${containerDatabaseUrl}`);
    console.log(`  S3_ENDPOINT: ${containerS3Endpoint}`);
    console.log(`  NATS_URL: ${containerNatsUrl}`);

    ingestorContainer = await new GenericContainer('wallpaperdb-ingestor:latest')
        .withNetwork(network)
        .withExposedPorts(3001)
        .withEnvironment({
            NODE_ENV: 'production',
            PORT: '3001',
            DATABASE_URL: containerDatabaseUrl,
            S3_ENDPOINT: containerS3Endpoint,
            S3_ACCESS_KEY_ID: s3AccessKeyId,
            S3_SECRET_ACCESS_KEY: s3SecretAccessKey,
            S3_BUCKET: s3Bucket,
            S3_REGION: 'us-east-1',
            NATS_URL: containerNatsUrl,
            NATS_STREAM: 'WALLPAPERS_E2E_TEST',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
            OTEL_SERVICE_NAME: 'ingestor-e2e-test',
        })
        .withLogConsumer((stream) => {
            stream.on('data', (line) => console.log(`[INGESTOR] ${line}`));
            stream.on('err', (line) => console.error(`[INGESTOR ERR] ${line}`));
        })
        .withWaitStrategy(Wait.forLogMessage('Server is running on port'))
        .withStartupTimeout(60000)
        .start();

    const mappedPort = ingestorContainer.getMappedPort(3001);
    baseUrl = `http://${ingestorContainer.getHost()}:${mappedPort}`;

    console.log(`Ingestor container started at ${baseUrl}`);

    // Give it a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));
}, 120000); // Increased timeout for Docker build

afterAll(async () => {
    console.log('Stopping containers...');

    if (ingestorContainer) {
        await ingestorContainer.stop();
        console.log('Ingestor container stopped');
    }

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

    if (network) {
        await network.stop();
        console.log('Docker network stopped');
    }
}, 60000);
