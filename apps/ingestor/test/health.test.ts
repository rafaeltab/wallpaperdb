import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
  IngestorMigrationsTesterBuilder,
  InProcessIngestorTesterBuilder,
} from './builders/index.js';

describe('Health Endpoint', () => {
  let tester: InstanceType<ReturnType<ReturnType<typeof createDefaultTesterBuilder>['build']>>;
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(IngestorMigrationsTesterBuilder)
      .with(InProcessIngestorTesterBuilder)
      .build();

    tester = new TesterClass();

    tester
      .withPostgres((b) => b.withDatabase(`test_health_${Date.now()}`))
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((b) => b.withJetstream())
      .withMigrations()
      .withInProcessApp();

    await tester.setup();
    fastify = tester.getApp();
  }, 60000);

  afterAll(async () => {
    if (tester) {
      await tester.destroy();
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
