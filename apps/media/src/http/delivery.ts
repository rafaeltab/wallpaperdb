import { Readable } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';
import { Effect } from 'effect';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MediaDelivery, type MediaOutcome } from '../delivery/index.js';

const querySchema = z.object({
  w: z.coerce.number().int().positive().optional(),
  h: z.coerce.number().int().positive().optional(),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
});
function problem(reply: FastifyReply, status: number, name: string, title: string, detail: string) {
  return reply
    .code(status)
    .type('application/problem+json')
    .header('Cache-Control', 'no-store')
    .send({
      type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
      title,
      status,
      detail,
    });
}
function respond(reply: FastifyReply, outcome: MediaOutcome, picture: boolean) {
  switch (outcome._tag) {
    case 'Rejected':
      return problem(reply, 400, 'invalid-dimensions', 'Invalid Dimensions', outcome.reason);
    case 'NotFound':
      return problem(
        reply,
        404,
        picture ? 'profile-picture-not-found' : 'not-found',
        picture ? 'Profile picture not found' : 'Wallpaper Not Found',
        picture
          ? 'This Profile picture is not publicly available.'
          : 'Wallpaper was not found or file is missing from storage'
      );
    case 'Found': {
      if (reply.raw.destroyed) {
        outcome.body.close();
        return reply;
      }
      const stream = Readable.from(outcome.body);
      reply.raw.once('close', () => {
        stream.destroy();
        outcome.body.close();
      });
      reply.type(outcome.mimeType).header('Cache-Control', 'public, max-age=31536000, immutable');
      if (outcome.fileSizeBytes !== undefined)
        reply.header('Content-Length', outcome.fileSizeBytes);
      return reply.send(stream);
    }
  }
}
export function registerDeliveryRoutes(
  app: FastifyInstance,
  run: <A, E>(
    effect: Effect.Effect<A, E, MediaDelivery>,
    headers: IncomingHttpHeaders,
    signal?: AbortSignal
  ) => Promise<A>
) {
  app.get<{ Params: { id: string } }>('/wallpapers/:id', async (request, reply) => {
    const controller = new AbortController();
    reply.raw.once('close', () => controller.abort());
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return problem(
        reply,
        400,
        'invalid-dimensions',
        'Invalid Dimensions',
        'Width and height must be positive integers, and fit must be contain, cover, or fill.'
      );
    const result = await run(
      MediaDelivery.use((service) =>
        service.wallpaper(request.params.id, {
          width: parsed.data.w,
          height: parsed.data.h,
          fit: parsed.data.fit,
        })
      ).pipe(
        Effect.catchTag('DeliveryUnavailable', () =>
          Effect.succeed({ _tag: 'Unavailable' } as const)
        )
      ),
      request.headers,
      controller.signal
    );
    if (result._tag === 'Unavailable')
      return problem(
        reply,
        503,
        'media-unavailable',
        'Media unavailable',
        'Wallpaper delivery is temporarily unavailable. Try again.'
      );
    return respond(reply, result, false);
  });
  app.get<{ Params: { pictureId: string } }>(
    '/profile-pictures/:pictureId',
    async (request, reply) => {
      const controller = new AbortController();
      reply.raw.once('close', () => controller.abort());
      const result = await run(
        MediaDelivery.use((service) => service.picture(request.params.pictureId)).pipe(
          Effect.catchTag('DeliveryUnavailable', () =>
            Effect.succeed({ _tag: 'Unavailable' } as const)
          )
        ),
        request.headers,
        controller.signal
      );
      if (result._tag === 'Unavailable')
        return problem(
          reply,
          503,
          'profile-picture-unavailable',
          'Profile picture unavailable',
          'Profile picture delivery is temporarily unavailable. Try again.'
        );
      return respond(reply, result, true);
    }
  );
}
