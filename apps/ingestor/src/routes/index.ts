import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import healthRoutes from './health.routes.js';
import uploadRoutes from './upload.routes.js';

export async function registerRoutes(fastify: FastifyInstance, config: Config): Promise<void> {
  // Register health routes
  await fastify.register(healthRoutes, { config });

  // Register upload routes
  await fastify.register(uploadRoutes, { config });
}
