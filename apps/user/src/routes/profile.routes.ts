import { type IAuthService, IAuthServiceToken } from '@wallpaperdb/auth';
import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { IdentityUnavailableError, ProfileService } from '../services/profile.service.js';

export default async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/profile/me/ensure', async (request, reply) => {
    const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
    try {
      const profile = await container.resolve(ProfileService).ensure(user.id);
      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof IdentityUnavailableError) {
        return reply.code(503).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/identity-unavailable',
          title: 'Identity service unavailable',
          status: 503,
          detail: 'Clerk identity lookup failed',
          instance: request.url,
        });
      }
      throw error;
    }
  });
}
