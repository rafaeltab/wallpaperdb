import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import healthRoutes from './health.routes.js';

export async function registerRoutes(fastify: FastifyInstance, config: Config): Promise<void> {
  // Register health routes
  await fastify.register(healthRoutes, { config });

  // Future routes can be registered here:
  // await fastify.register(uploadRoutes, { config });
  // await fastify.register(wallpaperRoutes, { config });
}
