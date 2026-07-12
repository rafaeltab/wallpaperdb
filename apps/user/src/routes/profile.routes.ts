import type { IAuthService } from '@wallpaperdb/auth';
import { IAuthServiceToken } from '@wallpaperdb/auth';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { IdentityProviderUnavailableError } from '../identity/clerk.js';
import { ProfileService } from '../services/profile.service.js';

const profileResponse = {
  type: 'object',
  required: [
    'id',
    'handle',
    'displayName',
    'biographyMarkdown',
    'version',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    handle: { type: 'string' },
    displayName: { type: 'string' },
    biographyMarkdown: { type: 'string' },
    pictureAssetId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    version: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const serviceUnavailableProblem = {
  type: 'object',
  required: ['type', 'title', 'status', 'detail', 'instance'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer', const: 503 },
    detail: { type: 'string' },
    instance: { type: 'string' },
  },
} as const;

async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/profile/me/ensure',
    {
      schema: {
        summary: "Ensure the signed-in User's Profile exists",
        tags: ['Profile'],
        security: [{ clerkOAuth: [] }],
        response: { 200: profileResponse, 503: serviceUnavailableProblem },
      },
    },
    async (request, reply) => {
      const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
      try {
        const profile = await container.resolve(ProfileService).ensure(user.id);
        return reply.send(profile);
      } catch (error) {
        if (error instanceof IdentityProviderUnavailableError) {
          return reply.code(503).header('content-type', 'application/problem+json').send({
            type: 'https://wallpaperdb.example/problems/identity-provider-unavailable',
            title: 'Service Unavailable',
            status: 503,
            detail: 'Profile creation is temporarily unavailable.',
            instance: request.url,
          });
        }
        throw error;
      }
    }
  );
}

export default fp(profileRoutes, { name: 'profile-routes' });
