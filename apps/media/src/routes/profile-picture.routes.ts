import type { FastifyInstance } from 'fastify';
import { ProfilePictureService } from '../services/profile-picture.service.js';

export async function registerProfilePictureRoutes(app: FastifyInstance): Promise<void> {
  const service = app.container.resolve(ProfilePictureService);
  app.get<{ Params: { pictureId: string } }>(
    '/profile-pictures/:pictureId',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const bytes = await service.getPicture(request.params.pictureId);
        if (!bytes) {
          return reply.code(404).type('application/problem+json').send({
            type: 'https://wallpaperdb.example/problems/profile-picture-not-found',
            title: 'Profile picture not found',
            status: 404,
            detail: 'This Profile picture is not publicly available.',
            instance: request.url,
          });
        }
        return reply
          .type('image/webp')
          .header('Content-Length', bytes.length)
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .send(bytes);
      } catch (error) {
        request.log.error({ err: error }, 'Unable to serve Profile picture');
        return reply.code(503).type('application/problem+json').send({
          type: 'https://wallpaperdb.example/problems/profile-picture-unavailable',
          title: 'Profile picture unavailable',
          status: 503,
          detail: 'Profile picture delivery is temporarily unavailable. Try again.',
          instance: request.url,
        });
      }
    }
  );
}
