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
import { ProblemDetailsError, MissingFileError } from '../errors/problem-details.js';

const validationLimitsService = new DefaultValidationLimitsService();

// Store config as a closure variable
let config: Config;

async function uploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const db = getDatabase();

  try {
    // Parse multipart form data
    const data = await request.file();

    if (!data) {
      throw new MissingFileError();
    }

    // Extract form fields
    // In production, userId would come from authenticated session
    // For now, we'll extract it from the form data (injected by gateway)
    const userId = (request.body as { userId?: string })?.userId || 'test-user';

    // Read file buffer
    const buffer = await data.toBuffer();
    const originalFilename = data.filename;

    // Step 1: Get user validation limits
    const limits = await validationLimitsService.getLimitsForUser(userId);

    // Step 2: Process file (hash, validate, extract metadata)
    const fileMetadata = await processFile(buffer, originalFilename, limits);

    // Step 3: Check for duplicate upload (by content hash)
    const existing = await db.query.wallpapers.findFirst({
      where: and(
        eq(wallpapers.userId, userId),
        eq(wallpapers.contentHash, fileMetadata.contentHash),
        inArray(wallpapers.uploadState, ['stored', 'processing', 'completed'])
      ),
    });

    if (existing) {
      // Return existing upload (idempotency)
      return reply.code(200).send({
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

    // Step 4: Generate ID and record intent (write-ahead)
    const id = `wlpr_${ulid()}`;

    await db.insert(wallpapers).values({
      id,
      userId,
      contentHash: fileMetadata.contentHash,
      uploadState: 'initiated',
      uploadAttempts: 0,
    });

    try {
      // Step 5: Update state to 'uploading' and upload to MinIO
      await db.update(wallpapers)
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

      // Step 6: Update to 'stored' with full metadata
      await db.update(wallpapers)
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

      // Step 7: Publish event to NATS (non-blocking failure)
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
        await db.update(wallpapers)
          .set({
            uploadState: 'processing',
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, id));
      } catch (natsError) {
        // NATS publish failed, but file is uploaded
        // Don't fail the request - reconciliation will retry
        request.log.warn({ id, error: natsError }, 'NATS publish failed, will be retried by reconciliation');
        // Leave state as 'stored' - reconciliation will republish
      }

      // Step 8: Return success response
      return reply.code(200).send({
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
      await db.update(wallpapers)
        .set({
          uploadState: 'failed',
          processingError: error instanceof Error ? error.message : 'Unknown error',
        })
        .where(eq(wallpapers.id, id));

      throw error;
    }

  } catch (error) {
    // Handle ProblemDetailsError (validation errors)
    if (error instanceof ProblemDetailsError) {
      return reply
        .code(error.status)
        .header('content-type', 'application/problem+json')
        .send(error.toJSON());
    }

    // Log and return generic error
    request.log.error({ err: error }, 'Upload failed with unexpected error');
    return reply
      .code(500)
      .header('content-type', 'application/problem+json')
      .send({
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

  // POST /upload - Upload a wallpaper
  fastify.post('/upload', uploadHandler);
}
