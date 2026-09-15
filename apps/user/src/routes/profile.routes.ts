import { type IAuthService, IAuthServiceToken } from '@wallpaperdb/auth';
import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  AliasNotFoundError,
  AliasNotScheduledError,
  IdentityUnavailableError,
  HandleCooldownError,
  HandleUnavailableError,
  InvalidDisplayNameError,
  InvalidBiographyError,
  UnavailableBiographyWallpaperError,
  InvalidHandleError,
  InvalidAliasCommandError,
  IneligibleHandleError,
  AliasLimitError,
  ProfileService,
  ProfileVersionConflictError,
} from '../services/profile.service.js';

interface ProfileUpdateBody {
  displayName?: string;
  biographyMarkdown?: string;
  expectedVersion: number;
}

function isProfileUpdateBody(body: unknown): body is ProfileUpdateBody {
  if (!body || typeof body !== 'object') return false;

  const update = body as Record<string, unknown>;
  return (
    typeof update.expectedVersion === 'number' &&
    (typeof update.displayName === 'string' || typeof update.biographyMarkdown === 'string') &&
    (update.displayName === undefined || typeof update.displayName === 'string') &&
    (update.biographyMarkdown === undefined || typeof update.biographyMarkdown === 'string')
  );
}

function isHandleChangeBody(body: unknown): body is { handle: string; expectedVersion: number } {
  if (!body || typeof body !== 'object') return false;
  const change = body as Record<string, unknown>;
  return (
    typeof change.handle === 'string' &&
    typeof change.expectedVersion === 'number' &&
    Number.isInteger(change.expectedVersion) &&
    change.expectedVersion > 0
  );
}

export default async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.put<{ Params: { handle: string } }>(
    '/profile/me/aliases/:handle',
    async (request, reply) => {
      const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
      const body = request.body as { expectedVersion?: unknown } | null;
      if (!body || typeof body.expectedVersion !== 'number') {
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/invalid-alias-command',
          title: 'Invalid alias command',
          status: 400,
          detail: 'A positive integer expected Profile version is required',
          instance: request.url,
        });
      }
      try {
        const profile = await container
          .resolve(ProfileService)
          .reactivateAlias(user.id, request.params.handle, body.expectedVersion);
        return reply.code(200).send(profile);
      } catch (error) {
        if (
          error instanceof ProfileVersionConflictError ||
          error instanceof HandleUnavailableError ||
          error instanceof IneligibleHandleError ||
          error instanceof AliasLimitError ||
          error instanceof InvalidAliasCommandError
        ) {
          const [status, type, title] =
            error instanceof ProfileVersionConflictError
              ? ([409, 'profile-version-conflict', 'Profile version conflict'] as const)
              : error instanceof HandleUnavailableError
                ? ([409, 'handle-unavailable', 'Handle unavailable'] as const)
                : error instanceof AliasLimitError
                  ? ([409, 'alias-limit', 'Retained alias limit reached'] as const)
                  : error instanceof IneligibleHandleError
                    ? ([400, 'ineligible-handle', 'Handle is not eligible'] as const)
                    : ([400, 'invalid-alias-command', 'Invalid alias command'] as const);
          return reply
            .code(status)
            .type('application/problem+json')
            .send({
              type: `https://wallpaperdb.example/problems/${type}`,
              title,
              status,
              detail: error.message,
              instance: request.url,
            });
        }
        throw error;
      }
    }
  );

  fastify.post<{ Params: { handle: string } }>(
    '/profile/me/aliases/:handle/expire',
    async (request, reply) => {
      const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
      const body = request.body as { expectedVersion?: unknown } | null;
      if (!body || typeof body.expectedVersion !== 'number') {
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/invalid-alias-command',
          title: 'Invalid alias command',
          status: 400,
          detail: 'A positive integer expected Profile version is required',
          instance: request.url,
        });
      }
      try {
        const profile = await container
          .resolve(ProfileService)
          .expireAliasImmediately(user.id, request.params.handle, body.expectedVersion);
        return reply.code(200).send(profile);
      } catch (error) {
        if (
          error instanceof ProfileVersionConflictError ||
          error instanceof AliasNotFoundError ||
          error instanceof InvalidAliasCommandError ||
          error instanceof AliasNotScheduledError
        ) {
          const [status, type, title] =
            error instanceof ProfileVersionConflictError
              ? ([409, 'profile-version-conflict', 'Profile version conflict'] as const)
              : error instanceof AliasNotFoundError
                ? ([404, 'alias-not-found', 'Alias not found'] as const)
                : error instanceof AliasNotScheduledError
                  ? ([409, 'alias-not-scheduled', 'Alias not scheduled'] as const)
                  : ([400, 'invalid-alias-command', 'Invalid alias command'] as const);
          return reply
            .code(status)
            .type('application/problem+json')
            .send({
              type: `https://wallpaperdb.example/problems/${type}`,
              title,
              status,
              detail: error.message,
              instance: request.url,
            });
        }
        throw error;
      }
    }
  );

  fastify.delete<{ Params: { handle: string } }>(
    '/profile/me/aliases/:handle',
    async (request, reply) => {
      const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
      const body = request.body as { expectedVersion?: unknown } | null;
      if (!body || typeof body.expectedVersion !== 'number') {
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/invalid-alias-command',
          title: 'Invalid alias command',
          status: 400,
          detail: 'A positive integer expected Profile version is required',
          instance: request.url,
        });
      }
      try {
        const profile = await container
          .resolve(ProfileService)
          .scheduleAliasExpiry(user.id, request.params.handle, body.expectedVersion);
        return reply.code(200).send(profile);
      } catch (error) {
        if (
          error instanceof ProfileVersionConflictError ||
          error instanceof AliasNotFoundError ||
          error instanceof InvalidAliasCommandError
        ) {
          const [status, type, title] =
            error instanceof ProfileVersionConflictError
              ? ([409, 'profile-version-conflict', 'Profile version conflict'] as const)
              : error instanceof AliasNotFoundError
                ? ([404, 'alias-not-found', 'Alias not found'] as const)
                : ([400, 'invalid-alias-command', 'Invalid alias command'] as const);
          return reply
            .code(status)
            .type('application/problem+json')
            .send({
              type: `https://wallpaperdb.example/problems/${type}`,
              title,
              status,
              detail: error.message,
              instance: request.url,
            });
        }
        throw error;
      }
    }
  );

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

  fastify.put('/profile/me/handle', async (request, reply) => {
    const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
    if (!isHandleChangeBody(request.body)) {
      return reply.code(400).type('application/problem+json').send({
        type: 'https://wallpaperdb.example/problems/invalid-handle',
        title: 'Invalid Handle command',
        status: 400,
        detail: 'Handle and a positive integer expected Profile version are required',
        instance: request.url,
      });
    }
    try {
      const profile = await container
        .resolve(ProfileService)
        .changeHandle(user.id, request.body.handle, request.body.expectedVersion);
      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof ProfileVersionConflictError) {
        return reply.code(409).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/profile-version-conflict',
          title: 'Profile version conflict',
          status: 409,
          detail: error.message,
          instance: request.url,
        });
      }
      if (error instanceof HandleUnavailableError) {
        return reply.code(409).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/handle-unavailable',
          title: 'Handle unavailable',
          status: 409,
          detail: error.message,
          instance: request.url,
        });
      }
      if (error instanceof HandleCooldownError) {
        return reply.code(429).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/handle-cooldown',
          title: 'Handle change cooldown',
          status: 429,
          detail: error.message,
          instance: request.url,
          nextHandleChangeAt: error.nextHandleChangeAt.toISOString(),
        });
      }
      if (error instanceof InvalidHandleError) {
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/invalid-handle',
          title: 'Invalid Handle',
          status: 400,
          detail: error.message,
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
        detail: 'Display name or Biography and an expected Profile version are required',
        instance: request.url,
      });
    }

    try {
      const profile = await container
        .resolve(ProfileService)
        .updateDetails(user.id, request.body, request.body.expectedVersion);
      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof UnavailableBiographyWallpaperError)
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/unavailable-wallpaper',
          title: 'Wallpaper unavailable',
          status: 400,
          detail: error.message,
          retryable: error.retryable,
          instance: request.url,
        });
      if (error instanceof InvalidBiographyError)
        return reply.code(400).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/invalid-biography',
          title: 'Invalid Biography',
          status: 400,
          detail: error.message,
          instance: request.url,
        });
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
