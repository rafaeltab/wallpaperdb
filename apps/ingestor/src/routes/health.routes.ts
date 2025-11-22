import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { getHealthStatusCode, getReadyStatusCode } from '@wallpaperdb/core/health';
import type { Config } from '../config.js';
import { HealthService } from '../services/health.service.js';

export interface HealthRoutesOptions extends FastifyPluginOptions {
  config: Config;
}

async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const healthService = container.resolve(HealthService);

  // Health check endpoint
  fastify.get('/health', async (_request, reply) => {
    const { isShuttingDown } = fastify.connectionsState;
    const result = await healthService.checkHealth(isShuttingDown);

    reply.code(getHealthStatusCode(result)).send(result);
  });

  // Readiness check endpoint
  fastify.get('/ready', async (_request, reply) => {
    const { isShuttingDown, connectionsInitialized } = fastify.connectionsState;
    const result = healthService.checkReady(isShuttingDown, connectionsInitialized);

    reply.code(getReadyStatusCode(result)).send(result);
  });
}

export default fp(healthRoutes, {
  name: 'health-routes',
});
