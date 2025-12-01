import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  OpenSearchTesterBuilder,
} from '@wallpaperdb/test-utils';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessGatewayTesterBuilder } from './builders/index.js';

describe('Health and Ready Endpoints', () => {
  const setup = () => {
    const TesterClass = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(OpenSearchTesterBuilder)
      .with(InProcessGatewayTesterBuilder)
      .build();

    const tester = new TesterClass();

    tester.withOpenSearch().withInProcessApp();

    return tester;
  };

  let tester: ReturnType<typeof setup>;
  let fastify: FastifyInstance;

  beforeAll(async () => {
    tester = setup();
    await tester.setup();
    fastify = tester.getApp();
  }, 60000);

  afterAll(async () => {
    await tester.destroy();
  });

  describe('/health', () => {
    it('should return ok status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });
  });

  describe('/ready', () => {
    it('should return ready status when OpenSearch is available', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.status).toBe('ready');
      expect(body.dependencies).toBeDefined();
      expect(body.dependencies.opensearch).toBe('ok');
    });
  });

  describe('GraphQL', () => {
    it('should respond to simple hello query', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/graphql',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          query: '{ hello }',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.hello).toBe('Hello from WallpaperDB Gateway!');
    });
  });
});
