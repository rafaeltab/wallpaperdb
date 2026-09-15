import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import healthRoutes from './health.routes.js';
import profileRoutes from './profile.routes.js';
import profilePictureRoutes from './profile-picture.routes.js';

export async function registerRoutes(fastify: FastifyInstance, config?: Config): Promise<void> {
  await fastify.register(healthRoutes, { config });
  await fastify.register(profileRoutes);
  await fastify.register(profilePictureRoutes);
}
