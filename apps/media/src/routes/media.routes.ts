import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { MediaService } from '../services/media.service.js';
import { InvalidDimensionsError } from '../errors/problem-details.js';

interface WallpaperParams {
  id: string;
}

interface ResizeQuerystring {
  w?: number;
  h?: number;
  fit?: 'contain' | 'cover' | 'fill';
}

/**
 * Zod schema for resize query parameters.
 * - w: width (1-7680)
 * - h: height (1-4320)
 * - fit: resize mode (contain, cover, fill) - defaults to "contain"
 */
const ResizeQuerySchema = z.object({
  w: z.coerce.number().int().min(1).max(7680).optional(),
  h: z.coerce.number().int().min(1).max(4320).optional(),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
});

/**
 * Register media routes for wallpaper retrieval.
 */
export async function registerMediaRoutes(fastify: FastifyInstance) {
  const mediaService = fastify.container.resolve(MediaService);

  /**
   * GET /wallpapers/:id
   * Retrieve a wallpaper file with optional resizing
   */
  fastify.get<{ Params: WallpaperParams; Querystring: ResizeQuerystring }>(
    '/wallpapers/:id',
    async (
      request: FastifyRequest<{
        Params: WallpaperParams;
        Querystring: ResizeQuerystring;
      }>,
      reply: FastifyReply
    ) => {
      return await withSpan(
        'http.get_wallpaper',
        {
          [Attributes.WALLPAPER_ID]: request.params.id,
          'http.method': 'GET',
          'http.route': '/wallpapers/:id',
        },
        async (span) => {
          const startTime = Date.now();
          const { id } = request.params;

          // Validate query parameters
          let queryParams: z.infer<typeof ResizeQuerySchema>;
          try {
            queryParams = ResizeQuerySchema.parse(request.query);
          } catch (error) {
            if (error instanceof z.ZodError) {
              recordCounter('http.requests.validation_errors', 1, {
                route: '/wallpapers/:id',
                error_type: 'query_params',
              });

              const validationError = new InvalidDimensionsError(
                error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
                `/wallpapers/${id}`
              );

              span.setAttribute('http.status_code', validationError.statusCode);

              return reply
                .status(validationError.statusCode)
                .type('application/problem+json')
                .send(validationError.toProblemDetails());
            }
            throw error;
          }

          if (queryParams.w !== undefined) {
            span.setAttribute(Attributes.RESIZE_WIDTH, queryParams.w);
          }
          if (queryParams.h !== undefined) {
            span.setAttribute(Attributes.RESIZE_HEIGHT, queryParams.h);
          }
          span.setAttribute(Attributes.RESIZE_FIT_MODE, queryParams.fit);

          // Retrieve wallpaper with optional resizing
          const result = await mediaService.getWallpaperResized(id, {
            width: queryParams.w,
            height: queryParams.h,
            fit: queryParams.fit,
          });

          if (!result) {
            const durationMs = Date.now() - startTime;

            recordCounter('http.requests.not_found', 1, {
              route: '/wallpapers/:id',
            });

            recordHistogram('http.wallpaper_retrieval_duration_ms', durationMs, {
              status: 'not_found',
              resize: queryParams.w || queryParams.h ? 'true' : 'false',
            });

            span.setAttribute('http.status_code', 404);
            span.setAttribute('wallpaper.found', false);

            // Return RFC 7807 problem details
            return reply
              .status(404)
              .type('application/problem+json')
              .send({
                type: 'https://wallpaperdb.dev/problems/not-found',
                title: 'Wallpaper Not Found',
                status: 404,
                detail: `Wallpaper with ID '${id}' was not found or file is missing from storage`,
                instance: `/wallpapers/${id}`,
              });
          }

          const durationMs = Date.now() - startTime;
          const hasResize = queryParams.w || queryParams.h;

          span.setAttribute('http.status_code', 200);
          span.setAttribute('wallpaper.found', true);
          span.setAttribute('resize_requested', hasResize !== undefined);

          recordCounter('http.wallpaper_retrievals.total', 1, {
            status: 'success',
            resize: hasResize ? 'true' : 'false',
            fit_mode: queryParams.fit,
          });

          recordHistogram('http.wallpaper_retrieval_duration_ms', durationMs, {
            status: 'success',
            resize: hasResize ? 'true' : 'false',
          });

          // Set response headers
          reply.type(result.mimeType);

          // Only set Content-Length for original files (not resized)
          if (result.fileSizeBytes !== undefined) {
            reply.header('Content-Length', result.fileSizeBytes);
            span.setAttribute(Attributes.FILE_SIZE_BYTES, result.fileSizeBytes);
          }

          reply.header('Cache-Control', 'public, max-age=31536000, immutable');

          // Stream the file
          return reply.send(result.stream);
        }
      );
    }
  );
}
