import { timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DatabaseConnection } from '../connections/database.js';
import { profiles, profilePictureAssets } from '../db/schema.js';
import {
  InvalidProfilePictureError,
  ProfilePictureTooLargeError,
} from '../services/profile-picture-processing.js';
import { PictureStorageUnavailableError } from '../services/profile-picture-storage.js';
import multipart from '@fastify/multipart';
import { type IAuthService, IAuthServiceToken } from '@wallpaperdb/auth';
import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ProfileService, ProfileVersionConflictError } from '../services/profile.service.js';
import type { Config } from '../config.js';
import { ProfilePictureIngestionService } from '../services/profile-picture-ingestion.service.js';

export default async function profilePictureRoutes(fastify: FastifyInstance): Promise<void> {
  const config = container.resolve<Config>('config');
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ProfileVersionConflictError)
      return reply.code(409).type('application/problem+json').send({
        type: 'https://wallpaperdb.example/problems/profile-version-conflict',
        title: 'Profile version conflict',
        status: 409,
        detail: error.message,
        instance: request.url,
      });
    const oversized =
      error instanceof ProfilePictureTooLargeError ||
      (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE');
    if (error instanceof InvalidProfilePictureError || oversized) {
      const status = oversized ? 413 : 400;
      return reply
        .code(status)
        .type('application/problem+json')
        .send({
          type: `https://wallpaperdb.example/problems/${oversized ? 'picture-too-large' : 'invalid-picture'}`,
          title: oversized ? 'Picture too large' : 'Invalid picture',
          status,
          detail:
            error instanceof InvalidProfilePictureError
              ? error.message
              : 'Picture exceeds the upload byte limit',
          instance: request.url,
        });
    }
    if (error instanceof PictureStorageUnavailableError)
      return reply.code(503).type('application/problem+json').send({
        type: 'https://wallpaperdb.example/problems/picture-storage-unavailable',
        title: 'Picture storage unavailable',
        status: 503,
        detail: error.message,
        instance: request.url,
      });
    return reply.send(error);
  });
  await fastify.register(multipart, {
    limits: {
      fileSize: config.profilePictureMaxBytes,
      files: 1,
      fields: 1,
      parts: 2,
      fieldSize: 32,
    },
  });
  fastify.get<{ Params: { pictureId: string } }>(
    '/internal/profile-pictures/:pictureId/availability',
    { config: { skipAuth: true } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const expected = config.userMediaServiceToken
        ? Buffer.from(`Bearer ${config.userMediaServiceToken}`)
        : null;
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (!expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return reply.code(401).send();
      const [active] = await container
        .resolve(DatabaseConnection)
        .getClient()
        .db.select({ id: profiles.id })
        .from(profiles)
        .innerJoin(
          profilePictureAssets,
          and(
            eq(profiles.pictureAssetId, profilePictureAssets.id),
            eq(profiles.id, profilePictureAssets.profileId)
          )
        )
        .where(
          and(
            eq(profilePictureAssets.id, request.params.pictureId),
            eq(profilePictureAssets.state, 'active')
          )
        )
        .limit(1);
      return reply.code(active ? 204 : 404).send();
    }
  );
  fastify.delete('/profile/me/picture', async (request, reply) => {
    const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
    const body = request.body as { expectedVersion?: unknown } | null;
    if (
      !body ||
      typeof body.expectedVersion !== 'number' ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 1
    )
      return reply
        .code(400)
        .send({ detail: 'A positive integer expected Profile version is required' });
    return container.resolve(ProfileService).adoptPicture(user.id, null, body.expectedVersion);
  });
  fastify.put('/profile/me/picture', async (request, reply) => {
    const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
    let bytes: Buffer | undefined;
    let expectedVersion: number | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'picture') bytes = await part.toBuffer();
      else if (
        part.type === 'field' &&
        part.fieldname === 'expectedVersion' &&
        typeof part.value === 'string' &&
        /^[1-9]\d*$/.test(part.value)
      )
        expectedVersion = Number(part.value);
      else
        return reply
          .code(400)
          .send({ detail: 'A picture and expected Profile version are required' });
    }
    if (!bytes || typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion))
      return reply
        .code(400)
        .send({ detail: 'A picture and expected Profile version are required' });
    return container
      .resolve(ProfilePictureIngestionService)
      .upload(user.id, bytes, expectedVersion);
  });
}
