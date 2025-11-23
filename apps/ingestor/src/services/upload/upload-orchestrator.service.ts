import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { and, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { DatabaseConnection } from '../../connections/database.js';
import { wallpapers } from '../../db/schema.js';
import type { Logger } from '../core/logger.service.js';
import type { TimeService } from '../core/time.service.js';
import { EventsService } from '../events.service.js';
import { FileProcessorService } from '../file-processor.service.js';
import { WallpaperStateMachine } from '../state-machine/wallpaper-state-machine.service.js';
import { StorageService } from '../storage.service.js';
import type { ValidationLimitsService } from '../validation-limits.service.js';

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
@injectable()
export class UploadOrchestrator {
  constructor(
    @inject(StorageService) private readonly storageService: StorageService,
    @inject(EventsService) private readonly eventService: EventsService,
    @inject(DatabaseConnection) private readonly databaseConnection: DatabaseConnection,
    @inject(FileProcessorService) private readonly fileProcessorService: FileProcessorService,
    @inject(WallpaperStateMachine) private readonly stateMachine: WallpaperStateMachine,
    @inject('ValidationLimitsService')
    private readonly validationLimitsService: ValidationLimitsService,
    @inject('Logger') private readonly logger: Logger,
    @inject('TimeService') private readonly timeService: TimeService
  ) {}

  /**
   * Execute the full upload workflow.
   */
  async handleUpload(params: UploadParams): Promise<UploadResult> {
    const { buffer, originalFilename, providedMimeType, userId } = params;
    const startTime = Date.now();

    return await withSpan(
      'upload.orchestrator.handle_upload',
      { [Attributes.USER_ID]: userId },
      async (span) => {
        try {
          // Step 1: Get user validation limits
          const limits = await this.validationLimitsService.getLimitsForUser(userId);

          // Step 2: Process file (hash, validate, extract metadata)
          const fileMetadata = await this.fileProcessorService.process(
            buffer,
            originalFilename,
            limits,
            providedMimeType
          );

          // Add file metadata to span
          span.setAttribute(Attributes.FILE_TYPE, fileMetadata.fileType);
          span.setAttribute(Attributes.FILE_MIME_TYPE, fileMetadata.mimeType);
          span.setAttribute(Attributes.FILE_SIZE_BYTES, fileMetadata.fileSizeBytes);
          span.setAttribute(Attributes.FILE_WIDTH, fileMetadata.width);
          span.setAttribute(Attributes.FILE_HEIGHT, fileMetadata.height);

          // Step 3: Check for duplicate upload (by content hash)
          const existing = await this.checkDuplicate(userId, fileMetadata.contentHash);
          if (existing) {
            this.recordUploadMetrics(
              'duplicate',
              fileMetadata.fileType,
              fileMetadata.fileSizeBytes,
              startTime
            );
            return this.createIdempotentResponse(existing);
          }

          // Step 4: Generate ID and record intent (write-ahead)
          const wallpaperId = `wlpr_${ulid()}`;
          span.setAttribute(Attributes.WALLPAPER_ID, wallpaperId);
          await this.recordIntent(wallpaperId, userId, fileMetadata.contentHash);

          try {
            // Step 5-7: Execute upload workflow
            const result = await this.executeUpload(wallpaperId, params, fileMetadata);
            this.recordUploadMetrics(
              'success',
              fileMetadata.fileType,
              fileMetadata.fileSizeBytes,
              startTime
            );
            return result;
          } catch (error) {
            // Mark as failed and rethrow
            await this.markAsFailed(wallpaperId, error);
            throw error;
          }
        } catch (error) {
          this.recordUploadMetrics('error', 'unknown', buffer.length, startTime);
          throw error;
        }
      }
    );
  }

  /**
   * Record upload metrics (counter and histogram).
   */
  private recordUploadMetrics(
    status: 'success' | 'duplicate' | 'error',
    fileType: string,
    fileSizeBytes: number,
    startTime: number
  ): void {
    const durationMs = Date.now() - startTime;
    const attributes = {
      status,
      [Attributes.FILE_TYPE]: fileType,
    };

    recordCounter('upload.requests.total', 1, attributes);
    recordHistogram('upload.duration_ms', durationMs, attributes);
    recordHistogram('upload.file_size_bytes', fileSizeBytes, { [Attributes.FILE_TYPE]: fileType });
  }

  /**
   * Check if a wallpaper with the same content hash already exists.
   */
  private async checkDuplicate(
    userId: string,
    contentHash: string
  ): Promise<typeof wallpapers.$inferSelect | null> {
    return await withSpan(
      'upload.orchestrator.check_duplicate',
      { [Attributes.USER_ID]: userId, [Attributes.FILE_HASH]: contentHash },
      async (span) => {
        const existing = await this.databaseConnection.getClient().db.query.wallpapers.findFirst({
          where: and(
            eq(wallpapers.userId, userId),
            eq(wallpapers.contentHash, contentHash),
            inArray(wallpapers.uploadState, ['stored', 'processing', 'completed'])
          ),
        });

        span.setAttribute('duplicate_found', existing != null);
        if (existing) {
          span.setAttribute(Attributes.WALLPAPER_ID, existing.id);
        }

        return existing || null;
      }
    );
  }

  /**
   * Create idempotent response for duplicate upload.
   */
  private createIdempotentResponse(existing: typeof wallpapers.$inferSelect): UploadResult {
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
    return await withSpan(
      'upload.orchestrator.record_intent',
      {
        [Attributes.WALLPAPER_ID]: wallpaperId,
        [Attributes.USER_ID]: userId,
        [Attributes.FILE_HASH]: contentHash,
      },
      async () => {
        await this.databaseConnection.getClient().db.insert(wallpapers).values({
          id: wallpaperId,
          userId,
          contentHash,
          uploadState: 'initiated',
          uploadAttempts: 0,
        });
      }
    );
  }

  /**
   * Execute the upload workflow: upload to storage, update metadata, publish event.
   */
  private async executeUpload(
    wallpaperId: string,
    params: UploadParams,
    fileMetadata: Awaited<ReturnType<FileProcessorService['process']>>
  ): Promise<UploadResult> {
    return await withSpan(
      'upload.orchestrator.execute_upload',
      {
        [Attributes.WALLPAPER_ID]: wallpaperId,
        [Attributes.USER_ID]: params.userId,
        [Attributes.FILE_TYPE]: fileMetadata.fileType,
        [Attributes.FILE_SIZE_BYTES]: fileMetadata.fileSizeBytes,
      },
      async (span) => {
        // Step 5: Transition to 'uploading' and upload to MinIO
        await this.stateMachine.transitionToUploading(wallpaperId);

        const storageResult = await this.storageService.upload(
          wallpaperId,
          params.buffer,
          fileMetadata.mimeType,
          fileMetadata.extension,
          params.userId
        );

        span.setAttribute(Attributes.STORAGE_BUCKET, storageResult.storageBucket);
        span.setAttribute(Attributes.STORAGE_KEY, storageResult.storageKey);

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
          originalFilename: this.fileProcessorService.sanitizeFilename(params.originalFilename),
        });

        // Step 7: Publish event to NATS (non-blocking failure)
        try {
          await this.publishEvent(wallpaperId);
          span.setAttribute('nats_publish_success', true);
        } catch (natsError) {
          // NATS publish failed, but file is uploaded
          // Don't fail the request - reconciliation will retry
          span.setAttribute('nats_publish_success', false);
          this.logger.warn('NATS publish failed, will be retried by reconciliation', {
            id: wallpaperId,
            error: natsError,
          });
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
    );
  }

  /**
   * Publish NATS event and transition to 'processing' state.
   */
  private async publishEvent(wallpaperId: string): Promise<void> {
    // Fetch the complete wallpaper record for event publishing
    const wallpaper = await this.databaseConnection.getClient().db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, wallpaperId),
    });

    if (!wallpaper) {
      throw new Error('Wallpaper not found after insertion');
    }

    await this.eventService.publishUploadedEvent(wallpaper);

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
