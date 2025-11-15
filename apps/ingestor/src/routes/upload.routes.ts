import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import { eq, and, inArray } from 'drizzle-orm';
import type { Config } from '../config.js';
import { getDatabase } from '../connections/database.js';
import { wallpapers } from '../db/schema.js';
import { DefaultValidationLimitsService } from '../services/validation-limits.service.js';
import { processFile, sanitizeFilename } from '../services/file-processor.service.js';
import { uploadToStorage } from '../services/storage.service.js';
import { publishWallpaperUploadedEvent } from '../services/events.service.js';
import { ProblemDetailsError, MissingFileError, MissingUserId } from '../errors/problem-details.js';
import type { MultipartFile } from '@fastify/multipart';
import { RateLimitExceededError } from '../services/rate-limit.service.js';

const validationLimitsService = new DefaultValidationLimitsService();

// Store config as a closure variable
let config: Config;

async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const db = getDatabase();

  try {
    // Use cached multipart data from preHandler
    const cachedData = (request as any).cachedMultipartData;

    let buffer: Buffer;
    let originalFilename: string;
    let providedMimeType: string;
    let userId: string;

    if (cachedData) {
      // Use cached data from preHandler
      buffer = cachedData.buffer;
      originalFilename = cachedData.filename;
      providedMimeType = cachedData.mimetype;
      userId = cachedData.userId;
    } else {
      // If not cached (shouldn't happen), parse again
      const data = await request.file();

      if (!data) {
        throw new MissingFileError();
      }

      userId = parseUserId(data);
      buffer = await data.toBuffer();
      originalFilename = data.filename;
      providedMimeType = data.mimetype;
    }

    // Step 1: Check rate limit for user
    const rateLimitResult = await request.server.rateLimitService.checkRateLimit(userId);

    // Step 2: Get user validation limits
    const limits = await validationLimitsService.getLimitsForUser(userId);

    // Step 3: Process file (hash, validate, extract metadata)
    const fileMetadata = await processFile(buffer, originalFilename, limits, providedMimeType);

    // Step 4: Check for duplicate upload (by content hash)
    const existing = await db.query.wallpapers.findFirst({
      where: and(
        eq(wallpapers.userId, userId),
        eq(wallpapers.contentHash, fileMetadata.contentHash),
        inArray(wallpapers.uploadState, ['stored', 'processing', 'completed'])
      ),
    });

    if (existing) {
      // Return existing upload (idempotency) with rate limit headers
      return reply
        .code(200)
        .header('X-RateLimit-Limit', String(request.server.rateLimitService.config.rateLimitMax))
        .header('X-RateLimit-Remaining', String(rateLimitResult.remaining))
        .header('X-RateLimit-Reset', String(rateLimitResult.reset))
        .send({
          id: existing.id,
          status: 'already_uploaded',
          uploadedAt: existing.uploadedAt.toISOString(),
          fileType: existing.fileType,
          mimeType: existing.mimeType,
          width: existing.width,
          height: existing.height,
          fileSizeBytes: existing.fileSizeBytes,
        });
    }

    // Step 5: Generate ID and record intent (write-ahead)
    const id = `wlpr_${ulid()}`;

    await db.insert(wallpapers).values({
      id,
      userId,
      contentHash: fileMetadata.contentHash,
      uploadState: 'initiated',
      uploadAttempts: 0,
    });

    try {
      // Step 6: Update state to 'uploading' and upload to MinIO
      await db
        .update(wallpapers)
        .set({
          uploadState: 'uploading',
          stateChangedAt: new Date(),
        })
        .where(eq(wallpapers.id, id));

      const storageResult = await uploadToStorage(
        id,
        buffer,
        fileMetadata.mimeType,
        fileMetadata.extension,
        config.s3Bucket,
        userId
      );

      // Step 7: Update to 'stored' with full metadata
      await db
        .update(wallpapers)
        .set({
          uploadState: 'stored',
          stateChangedAt: new Date(),
          fileType: fileMetadata.fileType,
          mimeType: fileMetadata.mimeType,
          fileSizeBytes: fileMetadata.fileSizeBytes,
          width: fileMetadata.width,
          height: fileMetadata.height,
          aspectRatio: (fileMetadata.width / fileMetadata.height).toFixed(4),
          storageKey: storageResult.storageKey,
          storageBucket: storageResult.storageBucket,
          originalFilename: sanitizeFilename(originalFilename),
        })
        .where(eq(wallpapers.id, id));

      // Step 8: Publish event to NATS (non-blocking failure)
      try {
        // Fetch the complete wallpaper record for event publishing
        const wallpaper = await db.query.wallpapers.findFirst({
          where: eq(wallpapers.id, id),
        });

        if (!wallpaper) {
          throw new Error('Wallpaper not found after insertion');
        }

        await publishWallpaperUploadedEvent(wallpaper);

        // Event published successfully
        await db
          .update(wallpapers)
          .set({
            uploadState: 'processing',
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, id));
      } catch (natsError) {
        // NATS publish failed, but file is uploaded
        // Don't fail the request - reconciliation will retry
        request.log.warn(
          { id, error: natsError },
          'NATS publish failed, will be retried by reconciliation'
        );
        // Leave state as 'stored' - reconciliation will republish
      }

      // Step 9: Return success response with rate limit headers
      return reply
        .code(200)
        .header('X-RateLimit-Limit', String(request.server.rateLimitService.config.rateLimitMax))
        .header('X-RateLimit-Remaining', String(rateLimitResult.remaining))
        .header('X-RateLimit-Reset', String(rateLimitResult.reset))
        .send({
          id,
          status: 'processing',
          uploadedAt: new Date().toISOString(),
          fileType: fileMetadata.fileType,
          mimeType: fileMetadata.mimeType,
          width: fileMetadata.width,
          height: fileMetadata.height,
          fileSizeBytes: fileMetadata.fileSizeBytes,
        });
    } catch (error) {
      // Upload or processing failed, mark as failed in DB
      await db
        .update(wallpapers)
        .set({
          uploadState: 'failed',
          processingError: error instanceof Error ? error.message : 'Unknown error',
        })
        .where(eq(wallpapers.id, id));

      throw error;
    }
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

export default async function uploadRoutes(fastify: FastifyInstance, options: { config: Config }) {
  // Store config in closure
  config = options.config;

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
  fastify.addHook('preHandler', async (request, reply) => {
    // Only for POST /upload
    if (request.url === '/upload' && request.method === 'POST') {
      try {
        const data = await request.file();
        if (data) {
          const userId = parseUserId(data);
          const buffer = await data.toBuffer();

          // Set userId for future rate limiting (won't affect current request)
          (request as any).rateLimitUserId = userId;

          // Cache data for handler
          (request as any).cachedMultipartData = {
            buffer,
            filename: data.filename,
            mimetype: data.mimetype,
            userId,
          };
        }
      } catch (error) {
        // Let main handler deal with errors
      }
    }
  });

  // POST /upload - Upload a wallpaper
  fastify.post('/upload', uploadHandler);
}

function parseUserId(data: MultipartFile): string {
  const userIdField = data.fields.userId;
  if (userIdField && 'value' in userIdField) {
    return String(userIdField.value);
  }
  throw new MissingUserId();
}
