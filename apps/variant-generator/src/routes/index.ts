import type { FastifyInstance } from 'fastify';
import healthRoutes from './health.routes.js';

/**
 * Register all route plugins
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Health routes
  await app.register(healthRoutes);
}
