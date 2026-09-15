import { timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DatabaseConnection } from '../connections/database.js';
import { profiles, profilePictureAssets } from '../db/schema.js';
import multipart from '@fastify/multipart';
import { type IAuthService, IAuthServiceToken } from '@wallpaperdb/auth';
import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import type { Config } from '../config.js';
import { ProfilePictureIngestionService } from '../services/profile-picture-ingestion.service.js';

export default async function profilePictureRoutes(fastify: FastifyInstance): Promise<void> {
  const config = container.resolve<Config>('config');
  await fastify.register(multipart, { limits: { fileSize: config.profilePictureMaxBytes, files: 1, fields: 1, parts: 2, fieldSize: 32 } });
  fastify.get<{ Params: { pictureId: string } }>('/internal/profile-pictures/:pictureId/availability', { config: { skipAuth: true } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const expected = config.userMediaServiceToken ? Buffer.from(`Bearer ${config.userMediaServiceToken}`) : null;
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (!expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send();
    const [active] = await container.resolve(DatabaseConnection).getClient().db.select({ id: profiles.id })
      .from(profiles).innerJoin(profilePictureAssets, and(eq(profiles.pictureAssetId, profilePictureAssets.id), eq(profiles.id, profilePictureAssets.profileId)))
      .where(and(eq(profilePictureAssets.id, request.params.pictureId), eq(profilePictureAssets.state, 'active'))).limit(1);
    return reply.code(active ? 204 : 404).send();
  });
  fastify.put('/profile/me/picture', async (request, reply) => {
    const user = container.resolve<IAuthService>(IAuthServiceToken).getUser(request);
    let bytes: Buffer | undefined;
    let expectedVersion: number | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'picture') bytes = await part.toBuffer();
      else if (part.type === 'field' && part.fieldname === 'expectedVersion' && typeof part.value === 'string' && /^[1-9]\d*$/.test(part.value)) expectedVersion = Number(part.value);
      else return reply.code(400).send({ detail: 'A picture and expected Profile version are required' });
    }
    if (!bytes || !Number.isSafeInteger(expectedVersion)) return reply.code(400).send({ detail: 'A picture and expected Profile version are required' });
    return container.resolve(ProfilePictureIngestionService).upload(user.id, bytes, expectedVersion!);
  });
}
