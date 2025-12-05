import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import type { Config } from '../config.js';
import { MissingFileError, MissingUserId, ProblemDetailsError } from '../errors/problem-details.js';
import { RateLimitExceededError } from '../services/rate-limit.service.js';
import { UploadOrchestrator } from '../services/upload/upload-orchestrator.service.js';
import { uploadRouteSchema } from './schemas/upload.schema.js';

interface CachedMultipartData {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  userId: string | undefined;
}

interface RequestWithCache extends FastifyRequest {
  cachedMultipartData?: CachedMultipartData;
  rateLimitUserId?: string;
}

async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const orchestrator = container.resolve(UploadOrchestrator);

  try {
    // Use cached multipart data from preHandler
    const cachedData = (request as RequestWithCache).cachedMultipartData;

    // preHandler should always cache the data
    if (!cachedData) {
      throw new MissingFileError();
    }

    // Check for missing userId
    if (!cachedData.userId) {
      throw new MissingUserId();
    }

    const buffer = cachedData.buffer;
    const originalFilename = cachedData.filename;
    const providedMimeType = cachedData.mimetype;
    const userId = cachedData.userId;

    // Check rate limit for user
    const rateLimitResult = await request.server.rateLimitService.checkRateLimit(userId);

    // Execute upload workflow through orchestrator
    const result = await orchestrator.handleUpload({
      buffer,
      originalFilename,
      providedMimeType,
      userId,
    });

    // Return success response with rate limit headers
    return reply
      .code(200)
      .header('X-RateLimit-Limit', String(container.resolve<Config>('config').rateLimitMax))
      .header('X-RateLimit-Remaining', String(rateLimitResult.remaining))
      .header('X-RateLimit-Reset', String(rateLimitResult.reset))
      .send(result);
  } catch (error) {
    // Handle rate limit exceeded
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

    // Handle ProblemDetailsError (validation errors)
    if (error instanceof ProblemDetailsError) {
      return reply
        .code(error.status)
        .header('content-type', 'application/problem+json')
        .send(error.toJSON());
    }

    // Log and return generic error
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
  // Register multipart plugin with size limits
  await fastify.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 200 * 1024 * 1024, // 200MB max (covers both images and videos)
      files: 1, // Only one file per upload
    },
  });

  // IMPORTANT: This preHandler runs AFTER rate limiting check!
  // Rate limiting uses a unique key per request (skip:requestId) when userId is not available.
  // Once userId is extracted here, future requests from this user will be properly rate limited.
  fastify.addHook('preHandler', async (request, _reply) => {
    // Only for POST /upload
    if (request.url === '/upload' && request.method === 'POST') {
      const data = await request.file();
      if (data) {
        // Read buffer first (consumes stream)
        const buffer = await data.toBuffer();

        // Try to get userId (may be missing)
        let userId: string | undefined;
        try {
          userId = parseUserId(data);
          // Set userId for future rate limiting (won't affect current request)
          (request as RequestWithCache).rateLimitUserId = userId;
        } catch {
          // userId is missing - handler will throw proper error
        }

        // Always cache data for handler (even without userId)
        (request as RequestWithCache).cachedMultipartData = {
          buffer,
          filename: data.filename,
          mimetype: data.mimetype,
          userId,
        };
      }
    }
  });

  // POST /upload - Upload a wallpaper
  fastify.post('/upload', { schema: uploadRouteSchema }, uploadHandler);
}

function parseUserId(data: MultipartFile): string {
  const userIdField = data.fields.userId;
  if (userIdField && 'value' in userIdField) {
    return String(userIdField.value);
  }
  throw new MissingUserId();
}
