import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessVariantGeneratorTesterBuilder } from './builders/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessVariantGeneratorTesterBuilder)
  .build();

describe('Health Endpoints', () => {
  let tester: InstanceType<typeof TesterClass>;
  let app: FastifyInstance;

  beforeAll(async () => {
    tester = new TesterClass();
    tester
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withInProcessApp();

    await tester.setup();
    app = tester.getApp();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  describe('GET /health', () => {
    it('should return healthy status when all dependencies are up', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
      expect(body.checks).toBeDefined();
      // Individual checks return boolean true when healthy
      expect(body.checks.minio).toBe(true);
      expect(body.checks.nats).toBe(true);
      expect(body.checks.otel).toBe(true);
    });
  });

  describe('GET /ready', () => {
    it('should return ready when service is fully initialized', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ready).toBe(true);
    });
  });
});
