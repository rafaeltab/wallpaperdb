import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { getHealthStatusCode, getReadyStatusCode } from '@wallpaperdb/core/health';
import {
  HealthResponseJsonSchema,
  ReadyResponseJsonSchema,
} from '@wallpaperdb/core/openapi';
import type { Config } from '../config.js';
import { HealthService } from '../services/health.service.js';

export interface HealthRoutesOptions extends FastifyPluginOptions {
  config: Config;
}

async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const healthService = container.resolve(HealthService);

  // Health check endpoint
  fastify.get(
    '/health',
    {
      schema: {
        summary: 'Health check',
        description: 'Returns health status of the service and its dependencies',
        tags: ['Health'],
        response: {
          200: HealthResponseJsonSchema,
          503: HealthResponseJsonSchema,
        },
      },
    },
    async (_request, reply) => {
      const { isShuttingDown } = fastify.connectionsState;
      const result = await healthService.checkHealth(isShuttingDown);

      reply.code(getHealthStatusCode(result) as 200 | 503).send(result);
    }
  );

  // Readiness check endpoint
  fastify.get(
    '/ready',
    {
      schema: {
        summary: 'Readiness check',
        description: 'Returns 200 if service is ready to handle requests, 503 otherwise',
        tags: ['Health'],
        response: {
          200: ReadyResponseJsonSchema,
          503: ReadyResponseJsonSchema,
        },
      },
    },
    async (_request, reply) => {
      const { isShuttingDown, connectionsInitialized } = fastify.connectionsState;
      const result = healthService.checkReady(isShuttingDown, connectionsInitialized);

      reply.code(getReadyStatusCode(result) as 200 | 503).send(result);
    }
  );
}

export default fp(healthRoutes, {
  name: 'health-routes',
});
