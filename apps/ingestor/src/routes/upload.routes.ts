import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IAuthServiceToken } from '@wallpaperdb/auth';
import type { IAuthService } from '@wallpaperdb/auth';
import type { Config } from '../config.js';
import { MissingFileError, ProblemDetailsError } from '../errors/problem-details.js';
import { RateLimitExceededError } from '../services/rate-limit.service.js';
import { UploadOrchestrator } from '../services/upload/upload-orchestrator.service.js';
import { uploadRouteSchema } from './schemas/upload.schema.js';

interface CachedMultipartData {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

interface RequestWithCache extends FastifyRequest {
  cachedMultipartData?: CachedMultipartData;
}

async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const orchestrator = container.resolve(UploadOrchestrator);
  const authService = container.resolve<IAuthService>(IAuthServiceToken);

  try {
    const cachedData = (request as RequestWithCache).cachedMultipartData;

    if (!cachedData) {
      throw new MissingFileError();
    }

    const user = authService.getUser(request);
    const buffer = cachedData.buffer;
    const originalFilename = cachedData.filename;
    const providedMimeType = cachedData.mimetype;

    const rateLimitResult = await request.server.rateLimitService.checkRateLimit(user);

    const result = await orchestrator.handleUpload({
      buffer,
      originalFilename,
      providedMimeType,
      user,
    });

    return reply
      .code(200)
      .header('X-RateLimit-Limit', String(container.resolve<Config>('config').rateLimitMax))
      .header('X-RateLimit-Remaining', String(rateLimitResult.remaining))
      .header('X-RateLimit-Reset', String(rateLimitResult.reset))
      .send(result);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return reply
        .code(429)
        .header('content-type', 'application/problem+json')
        .header('Retry-After', String(error.retryAfter))
        .header('X-RateLimit-Limit', String(error.max))
        .header('X-RateLimit-Remaining', '0')
        .header('X-RateLimit-Reset', String(error.reset))
        .send({
          type: 'https://wallpaperdb.example/problems/rate-limit-exceeded',
          title: 'Rate Limit Exceeded',
          status: 429,
          detail: `Rate limit exceeded. Maximum ${error.max} requests per ${Math.floor(error.windowMs / 1000)} seconds.`,
          instance: '/upload',
          retryAfter: error.retryAfter,
        });
    }

    if (error instanceof ProblemDetailsError) {
      return reply
        .code(error.status)
        .header('content-type', 'application/problem+json')
        .send(error.toJSON());
    }

    request.log.error({ err: error }, 'Upload failed with unexpected error');
    return reply.code(500).header('content-type', 'application/problem+json').send({
      type: 'https://wallpaperdb.example/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
      instance: '/upload',
    });
  }
}

export default async function uploadRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 200 * 1024 * 1024,
      files: 1,
    },
  });

  fastify.addHook('preHandler', async (request, _reply) => {
    if (request.url === '/upload' && request.method === 'POST') {
      const data = await request.file();
      if (data) {
        const buffer = await data.toBuffer();

        (request as RequestWithCache).cachedMultipartData = {
          buffer,
          filename: data.filename,
          mimetype: data.mimetype,
        };
      }
    }
  });

  fastify.post('/upload', { schema: uploadRouteSchema }, uploadHandler);
}
