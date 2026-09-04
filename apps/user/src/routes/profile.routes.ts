import { type IAuthService, IAuthServiceToken } from '@wallpaperdb/auth';
import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  IdentityUnavailableError,
  InvalidDisplayNameError,
  ProfileService,
  ProfileVersionConflictError,
} from '../services/profile.service.js';

interface ProfileUpdateBody {
  displayName: string;
  expectedVersion: number;
}

function isProfileUpdateBody(body: unknown): body is ProfileUpdateBody {
  if (!body || typeof body !== 'object') return false;

  const update = body as Record<string, unknown>;
  return typeof update.displayName === 'string' && typeof update.expectedVersion === 'number';
}

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

  fastify.patch('/profile/me', async (request, reply) => {
    const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
    if (!isProfileUpdateBody(request.body)) {
      return reply.code(400).type('application/problem+json').send({
        type: 'https://wallpaperdb.example/problems/invalid-profile-update',
        title: 'Invalid Profile update',
        status: 400,
        detail: 'Display name and expected Profile version are required',
        instance: request.url,
      });
    }

    try {
      const profile = await container
        .resolve(ProfileService)
        .updateDisplayName(user.id, request.body.displayName, request.body.expectedVersion);
      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof InvalidDisplayNameError) {
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/invalid-display-name',
          title: 'Invalid Display name',
          status: 400,
          detail: error.message,
          instance: request.url,
        });
      }
      if (error instanceof ProfileVersionConflictError) {
        return reply.code(409).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/profile-version-conflict',
          title: 'Profile version conflict',
          status: 409,
          detail: error.message,
          instance: request.url,
        });
      }
      throw error;
    }
  });
}
