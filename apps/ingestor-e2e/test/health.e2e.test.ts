import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'undici';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
  ContainerizedIngestorTesterBuilder,
  IngestorMigrationsTesterBuilder,
} from './builders/index.js';

describe('Health Endpoint E2E', () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createDefaultTesterBuilder>['build']>>;
  let baseUrl: string;

  beforeAll(async () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(ContainerizedIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    tester
      .withNetwork()
      .withPostgres((builder) =>
        builder
          .withDatabase(`test_e2e_health_${Date.now()}`)
          .withNetworkAlias('postgres')
      )
      .withMinio((builder) => builder.withNetworkAlias('minio'))
      .withMinioBucket('wallpapers')
      .withNats((builder) =>
        builder.withNetworkAlias('nats').withJetstream()
      )
      .withStream('WALLPAPERS')
      .withMigrations()
      .withContainerizedApp();

    await tester.setup();
    baseUrl = tester.getBaseUrl();
  }, 120000);

  afterAll(async () => {
    if (tester) {
      await tester.destroy();
    }
  });

  test('GET /health returns healthy status', async () => {
    // Act: Make HTTP request to Docker container
    const response = await request(`${baseUrl}/health`, {
      method: 'GET',
    });

    // Verify: HTTP response
    expect(response.statusCode).toBe(200);

    const body = await response.body.json();

    // Verify: Response structure
    expect(body).toMatchObject({
      status: 'healthy',
      checks: {
        database: true,
        minio: true,
        nats: true,
        otel: true,
      },
      timestamp: expect.any(String),
    });
  });

  test('GET /ready returns ready status', async () => {
    // Act: Make HTTP request to Docker container
    const response = await request(`${baseUrl}/ready`, {
      method: 'GET',
    });

    // Verify: HTTP response
    expect(response.statusCode).toBe(200);

    const body = await response.body.json();

    // Verify: Response structure
    expect(body).toMatchObject({
      ready: true,
      timestamp: expect.any(String),
    });
  });
});
