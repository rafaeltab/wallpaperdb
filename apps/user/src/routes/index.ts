import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import healthRoutes from './health.routes.js';

export async function registerRoutes(fastify: FastifyInstance, config?: Config): Promise<void> {
  await fastify.register(healthRoutes, { config });
}
