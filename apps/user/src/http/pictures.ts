import { timingSafeEqual } from 'node:crypto';
import multipart from '@fastify/multipart';
import { Effect } from 'effect';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Pictures, type PictureRejection } from '../pictures/index.js';
import { Profiles, type ProfileOutcome } from '../profile/index.js';
import type { Execution } from './execution.js';
import { problem } from './problem.js';
import { sendProfile } from './profile.js';

const remove = z.object({ expectedVersion: z.number().int().positive().safe() });
const pictureParams = z.object({ pictureId: z.string() });
function isPictureRejection(
  outcome: ProfileOutcome | PictureRejection
): outcome is PictureRejection {
  return (
    outcome._tag === 'Rejected' &&
    (outcome.reason === 'invalid-picture' ||
      outcome.reason === 'picture-too-large' ||
      outcome.reason === 'picture-source-rejected')
  );
}
function sendPicture(reply: FastifyReply, outcome: ProfileOutcome | PictureRejection) {
  if (isPictureRejection(outcome)) {
    const status = outcome.reason === 'picture-too-large' ? 413 : 400;
    return reply
      .code(status)
      .type('application/problem+json')
      .send(
        problem(
          status,
          outcome.reason,
          status === 413 ? 'Picture too large' : 'Invalid picture',
          outcome.message
        )
      );
  }
  return sendProfile(reply, outcome);
}
function pictureFailure(reply: FastifyReply, failure: { readonly operation: string }) {
  const storage = failure.operation === 'put-picture' || failure.operation === 'delete-picture';
  const status = storage ? 503 : 500;
  return reply
    .code(status)
    .type('application/problem+json')
    .send(
      problem(
        status,
        storage ? 'picture-storage-unavailable' : 'generic-server',
        storage ? 'Picture storage unavailable' : 'Internal server error'
      )
    );
}
function malformed(reply: FastifyReply) {
  return reply
    .code(400)
    .type('application/problem+json')
    .send(
      problem(
        400,
        'invalid-picture-command',
        'Invalid picture command',
        'A picture and positive integer expected Profile version are required'
      )
    );
}
export async function registerPictureRoutes(
  app: FastifyInstance,
  execution: Execution,
  config: { readonly profilePictureMaxBytes?: number; readonly userMediaServiceToken?: string }
) {
  await app.register(multipart, {
    limits: {
      fileSize: config.profilePictureMaxBytes ?? 5 * 1024 * 1024,
      files: 1,
      fields: 1,
      parts: 2,
      fieldSize: 32,
    },
  });
  app.get(
    '/internal/profile-pictures/:pictureId/availability',
    { config: { skipAuth: true } },
    (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const expected = config.userMediaServiceToken
        ? Buffer.from(`Bearer ${config.userMediaServiceToken}`)
        : null;
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (!expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return reply
          .code(401)
          .type('application/problem+json')
          .send(problem(401, 'unauthorized', 'Unauthorized'));
      const params = pictureParams.parse(request.params);
      return execution.run(
        Pictures.use((pictures) => pictures.pictureAvailable(params.pictureId)).pipe(
          Effect.match({
            onSuccess: (available) =>
              available
                ? reply.code(204).send()
                : reply
                    .code(404)
                    .type('application/problem+json')
                    .send(problem(404, 'not-found', 'Not found')),
            onFailure: (failure) => pictureFailure(reply, failure),
          })
        ),
        request,
        reply
      );
    }
  );
  app.delete('/profile/me/picture', (request, reply) => {
    const principal = request.profilePrincipal;
    const parsed = remove.safeParse(request.body);
    if (!principal || !parsed.success) return malformed(reply);
    return execution.run(
      Profiles.use((profiles) =>
        profiles.adoptPicture(principal, null, parsed.data.expectedVersion)
      ).pipe(
        Effect.match({
          onSuccess: (outcome) => sendProfile(reply, outcome),
          onFailure: (failure) => pictureFailure(reply, failure),
        })
      ),
      request,
      reply
    );
  });
  app.put('/profile/me/picture', async (request, reply) => {
    const principal = request.profilePrincipal;
    if (!principal) return malformed(reply);
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
      else return malformed(reply);
    }
    if (!bytes || expectedVersion === undefined || !Number.isSafeInteger(expectedVersion))
      return malformed(reply);
    return execution.run(
      Pictures.use((pictures) => pictures.upload(principal, bytes, expectedVersion)).pipe(
        Effect.match({
          onSuccess: (outcome) => sendPicture(reply, outcome),
          onFailure: (failure) => pictureFailure(reply, failure),
        })
      ),
      request,
      reply
    );
  });
}
