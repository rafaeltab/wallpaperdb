import { ulid } from 'ulid';
import { eq, and, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyBaseLogger } from 'fastify';
import { wallpapers } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import type { ValidationLimitsService } from '../validation-limits.service.js';
import { processFile, sanitizeFilename } from '../file-processor.service.js';
import { uploadToStorage } from '../storage.service.js';
import { publishWallpaperUploadedEvent } from '../events.service.js';
import { WallpaperStateMachine } from '../state-machine/wallpaper-state-machine.service.js';
import type { TimeService } from '../core/time.service.js';
import { systemTimeService } from '../core/time.service.js';

type DbType = NodePgDatabase<typeof schema>;

export interface UploadParams {
  buffer: Buffer;
  originalFilename: string;
  providedMimeType: string;
  userId: string;
}

export interface UploadResult {
  id: string;
  status: 'processing' | 'already_uploaded';
  uploadedAt: string;
  fileType: 'image' | 'video';
  mimeType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

/**
 * Orchestrates the wallpaper upload process.
 * Handles the complex multi-step upload workflow:
 * 1. Validate file and extract metadata
 * 2. Check for duplicates (idempotency)
 * 3. Record intent (write-ahead log)
 * 4. Upload to storage
 * 5. Update metadata
 * 6. Publish NATS event
 */
export class UploadOrchestrator {
  private readonly stateMachine: WallpaperStateMachine;

  constructor(
    private readonly db: DbType,
    private readonly validationLimitsService: ValidationLimitsService,
    private readonly storageBucket: string,
    private readonly logger: FastifyBaseLogger,
    private readonly timeService: TimeService = systemTimeService
  ) {
    this.stateMachine = new WallpaperStateMachine(db, timeService);
  }

  /**
   * Execute the full upload workflow.
   */
  async handleUpload(params: UploadParams): Promise<UploadResult> {
    const { buffer, originalFilename, providedMimeType, userId } = params;

    // Step 1: Get user validation limits
    const limits = await this.validationLimitsService.getLimitsForUser(userId);

    // Step 2: Process file (hash, validate, extract metadata)
    const fileMetadata = await processFile(buffer, originalFilename, limits, providedMimeType);

    // Step 3: Check for duplicate upload (by content hash)
    const existing = await this.checkDuplicate(userId, fileMetadata.contentHash);
    if (existing) {
      return this.createIdempotentResponse(existing);
    }

    // Step 4: Generate ID and record intent (write-ahead)
    const wallpaperId = `wlpr_${ulid()}`;
    await this.recordIntent(wallpaperId, userId, fileMetadata.contentHash);

    try {
      // Step 5-7: Execute upload workflow
      return await this.executeUpload(wallpaperId, params, fileMetadata);
    } catch (error) {
      // Mark as failed and rethrow
      await this.markAsFailed(wallpaperId, error);
      throw error;
    }
  }

  /**
   * Check if a wallpaper with the same content hash already exists.
   */
  private async checkDuplicate(
    userId: string,
    contentHash: string
  ): Promise<typeof wallpapers.$inferSelect | null> {
    const existing = await this.db.query.wallpapers.findFirst({
      where: and(
        eq(wallpapers.userId, userId),
        eq(wallpapers.contentHash, contentHash),
        inArray(wallpapers.uploadState, ['stored', 'processing', 'completed'])
      ),
    });

    return existing || null;
  }

  /**
   * Create idempotent response for duplicate upload.
   */
  private createIdempotentResponse(
    existing: typeof wallpapers.$inferSelect
  ): UploadResult {
    return {
      id: existing.id,
      status: 'already_uploaded',
      uploadedAt: existing.uploadedAt.toISOString(),
      fileType: existing.fileType as 'image' | 'video',
      mimeType: existing.mimeType as string,
      width: existing.width as number,
      height: existing.height as number,
      fileSizeBytes: existing.fileSizeBytes as number,
    };
  }

  /**
   * Record upload intent (write-ahead log).
   */
  private async recordIntent(
    wallpaperId: string,
    userId: string,
    contentHash: string
  ): Promise<void> {
    await this.db.insert(wallpapers).values({
      id: wallpaperId,
      userId,
      contentHash,
      uploadState: 'initiated',
      uploadAttempts: 0,
    });
  }

  /**
   * Execute the upload workflow: upload to storage, update metadata, publish event.
   */
  private async executeUpload(
    wallpaperId: string,
    params: UploadParams,
    fileMetadata: Awaited<ReturnType<typeof processFile>>
  ): Promise<UploadResult> {
    // Step 5: Transition to 'uploading' and upload to MinIO
    await this.stateMachine.transitionToUploading(wallpaperId);

    const storageResult = await uploadToStorage(
      wallpaperId,
      params.buffer,
      fileMetadata.mimeType,
      fileMetadata.extension,
      this.storageBucket,
      params.userId
    );

    // Step 6: Transition to 'stored' with full metadata
    await this.stateMachine.transitionToStored(wallpaperId, {
      fileType: fileMetadata.fileType,
      mimeType: fileMetadata.mimeType,
      fileSizeBytes: fileMetadata.fileSizeBytes,
      width: fileMetadata.width,
      height: fileMetadata.height,
      aspectRatio: (fileMetadata.width / fileMetadata.height).toFixed(4),
      storageKey: storageResult.storageKey,
      storageBucket: storageResult.storageBucket,
      originalFilename: sanitizeFilename(params.originalFilename),
    });

    // Step 7: Publish event to NATS (non-blocking failure)
    try {
      await this.publishEvent(wallpaperId);
    } catch (natsError) {
      // NATS publish failed, but file is uploaded
      // Don't fail the request - reconciliation will retry
      this.logger.warn(
        { id: wallpaperId, error: natsError },
        'NATS publish failed, will be retried by reconciliation'
      );
      // Leave state as 'stored' - reconciliation will republish
    }

    // Return success response
    return {
      id: wallpaperId,
      status: 'processing',
      uploadedAt: this.timeService.now().toISOString(),
      fileType: fileMetadata.fileType,
      mimeType: fileMetadata.mimeType,
      width: fileMetadata.width,
      height: fileMetadata.height,
      fileSizeBytes: fileMetadata.fileSizeBytes,
    };
  }

  /**
   * Publish NATS event and transition to 'processing' state.
   */
  private async publishEvent(wallpaperId: string): Promise<void> {
    // Fetch the complete wallpaper record for event publishing
    const wallpaper = await this.db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, wallpaperId),
    });

    if (!wallpaper) {
      throw new Error('Wallpaper not found after insertion');
    }

    await publishWallpaperUploadedEvent(wallpaper);

    // Event published successfully - transition to 'processing'
    await this.stateMachine.transitionToProcessing(wallpaperId);
  }

  /**
   * Mark upload as failed with error message.
   */
  private async markAsFailed(wallpaperId: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await this.stateMachine.transitionToFailed(wallpaperId, errorMessage);
  }
}
