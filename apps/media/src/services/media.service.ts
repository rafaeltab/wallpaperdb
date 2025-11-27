import { GetObjectCommand } from '@aws-sdk/client-s3';
import { inject, injectable } from 'tsyringe';
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import type { Readable } from 'node:stream';
import { MinioConnection } from '../connections/minio.js';
import { WallpaperRepository } from '../repositories/wallpaper.repository.js';
import { ResizeService } from './resize.service.js';
import { VariantSelectorService } from './variant-selector.service.js';

/**
 * Service for retrieving wallpaper files from object storage.
 */
@injectable()
export class MediaService {
  constructor(
    @inject(WallpaperRepository) private readonly repository: WallpaperRepository,
    @inject(MinioConnection) private readonly minio: MinioConnection,
    @inject(ResizeService) private readonly resizeService: ResizeService,
    @inject(VariantSelectorService)
    private readonly variantSelector: VariantSelectorService
  ) {}

  /**
   * Get wallpaper file stream and metadata.
   *
   * @param id - The wallpaper ID
   * @returns Object containing file stream, mime type, and file size, or null if not found
   */
  async getWallpaper(id: string): Promise<{
    stream: Readable;
    mimeType: string;
    fileSizeBytes: number;
  } | null> {
    return await withSpan(
      'media.get_wallpaper',
      { [Attributes.WALLPAPER_ID]: id },
      async (span) => {
        // Query database for wallpaper metadata
        const wallpaper = await this.repository.findById(id);

        if (!wallpaper) {
          span.setAttribute('wallpaper.found', false);
          return null; // Wallpaper not found in database
        }

        span.setAttribute('wallpaper.found', true);
        span.setAttribute(Attributes.STORAGE_BUCKET, wallpaper.storageBucket);
        span.setAttribute(Attributes.STORAGE_KEY, wallpaper.storageKey);
        span.setAttribute(Attributes.FILE_MIME_TYPE, wallpaper.mimeType);
        span.setAttribute(Attributes.FILE_SIZE_BYTES, wallpaper.fileSizeBytes);

        try {
          const s3StartTime = Date.now();

          // Get file from MinIO
          const command = new GetObjectCommand({
            Bucket: wallpaper.storageBucket,
            Key: wallpaper.storageKey,
          });

          const response = await this.minio.getClient().send(command);

          const s3DurationMs = Date.now() - s3StartTime;

          recordCounter('media.s3.operations.total', 1, {
            [Attributes.OPERATION_NAME]: 'get_object',
            [Attributes.OPERATION_SUCCESS]: 'true',
          });

          recordHistogram('media.s3.get_duration_ms', s3DurationMs, {
            [Attributes.OPERATION_NAME]: 'get_object',
          });

          if (!response.Body) {
            throw new Error('MinIO returned no body');
          }

          return {
            stream: response.Body as Readable,
            mimeType: wallpaper.mimeType,
            fileSizeBytes: wallpaper.fileSizeBytes,
          };
        } catch (error) {
          recordCounter('media.s3.operations.total', 1, {
            [Attributes.OPERATION_NAME]: 'get_object',
            [Attributes.OPERATION_SUCCESS]: 'false',
            [Attributes.ERROR_TYPE]:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          });

          // File not found in MinIO (or other S3 error)
          console.error(`Failed to retrieve file from MinIO for wallpaper ${id}:`, error);
          return null;
        }
      }
    );
  }

  /**
   * Get wallpaper file stream with optional resizing.
   *
   * @param id - The wallpaper ID
   * @param options - Resize options (width, height, fit mode)
   * @returns Object containing file stream and mime type, or null if not found
   * Note: No fileSizeBytes for resized images (unknown until streamed)
   */
  async getWallpaperResized(
    id: string,
    options?: {
      width?: number;
      height?: number;
      fit: 'contain' | 'cover' | 'fill';
    }
  ): Promise<{
    stream: Readable;
    mimeType: string;
    fileSizeBytes?: number;
  } | null> {
    return await withSpan(
      'media.get_wallpaper_resized',
      {
        [Attributes.WALLPAPER_ID]: id,
        [Attributes.RESIZE_WIDTH]: options?.width,
        [Attributes.RESIZE_HEIGHT]: options?.height,
        [Attributes.RESIZE_FIT_MODE]: options?.fit,
      },
      async (span) => {
        // Query database for wallpaper metadata
        const wallpaper = await this.repository.findById(id);

        if (!wallpaper) {
          span.setAttribute('wallpaper.found', false);
          return null; // Wallpaper not found in database
        }

        span.setAttribute('wallpaper.found', true);

        // Select best source (original or variant) for resize operation
        const selection = await this.variantSelector.selectSource(wallpaper, options);

        span.setAttribute(Attributes.RESIZE_SOURCE, selection.source);
        if (selection.variantId) {
          span.setAttribute(Attributes.VARIANT_ID, selection.variantId);
        }

        try {
          const s3StartTime = Date.now();

          // Get file from MinIO using selected source
          const command = new GetObjectCommand({
            Bucket: selection.storageBucket,
            Key: selection.storageKey,
          });

          const response = await this.minio.getClient().send(command);

          const s3DurationMs = Date.now() - s3StartTime;

          recordCounter('media.s3.operations.total', 1, {
            [Attributes.OPERATION_NAME]: 'get_object',
            [Attributes.OPERATION_SUCCESS]: 'true',
            source: selection.source,
          });

          recordHistogram('media.s3.get_duration_ms', s3DurationMs, {
            [Attributes.OPERATION_NAME]: 'get_object',
            source: selection.source,
          });

          if (!response.Body) {
            throw new Error('MinIO returned no body');
          }

          const inputStream = response.Body as Readable;

          // If resize requested, apply transformation
          if (options?.width || options?.height) {
            span.setAttribute('resize_applied', true);

            const resizedStream = await this.resizeService.resizeImage(inputStream, {
              width: options.width,
              height: options.height,
              fit: options.fit || 'contain',
              mimeType: selection.mimeType,
            });

            return {
              stream: resizedStream,
              mimeType: selection.mimeType,
              // No fileSizeBytes for resized images (streaming, unknown size)
            };
          }

          span.setAttribute('resize_applied', false);

          // No resize, return original
          return {
            stream: inputStream,
            mimeType: selection.mimeType,
            fileSizeBytes: wallpaper.fileSizeBytes,
          };
        } catch (error) {
          // FALLBACK LOGIC: Variant file might be missing from MinIO
          if (selection.source === 'variant' && selection.variantId) {
            span.setAttribute(Attributes.VARIANT_FALLBACK, true);

            recordCounter('media.variant.fallback.total', 1, {
              [Attributes.WALLPAPER_ID]: id,
              [Attributes.VARIANT_ID]: selection.variantId,
            });

            recordCounter('media.s3.operations.total', 1, {
              [Attributes.OPERATION_NAME]: 'get_object',
              [Attributes.OPERATION_SUCCESS]: 'false',
              source: 'variant',
              [Attributes.ERROR_TYPE]:
                error instanceof Error ? error.constructor.name : 'UnknownError',
            });

            console.warn(
              `Variant ${selection.variantId} file missing from MinIO, falling back to original`
            );

            // Retry with original
            try {
              const s3StartTime = Date.now();

              const command = new GetObjectCommand({
                Bucket: wallpaper.storageBucket,
                Key: wallpaper.storageKey,
              });

              const response = await this.minio.getClient().send(command);

              const s3DurationMs = Date.now() - s3StartTime;

              recordCounter('media.s3.operations.total', 1, {
                [Attributes.OPERATION_NAME]: 'get_object',
                [Attributes.OPERATION_SUCCESS]: 'true',
                source: 'original',
                fallback: 'true',
              });

              recordHistogram('media.s3.get_duration_ms', s3DurationMs, {
                [Attributes.OPERATION_NAME]: 'get_object',
                source: 'original',
              });

              if (!response.Body) {
                throw new Error('MinIO returned no body');
              }

              const inputStream = response.Body as Readable;

              // Apply resize if requested
              if (options?.width || options?.height) {
                const resizedStream = await this.resizeService.resizeImage(inputStream, {
                  width: options.width,
                  height: options.height,
                  fit: options.fit || 'contain',
                  mimeType: wallpaper.mimeType,
                });

                return {
                  stream: resizedStream,
                  mimeType: wallpaper.mimeType,
                };
              }

              return {
                stream: inputStream,
                mimeType: wallpaper.mimeType,
                fileSizeBytes: wallpaper.fileSizeBytes,
              };
            } catch (fallbackError) {
              recordCounter('media.s3.operations.total', 1, {
                [Attributes.OPERATION_NAME]: 'get_object',
                [Attributes.OPERATION_SUCCESS]: 'false',
                source: 'original',
                fallback: 'true',
                [Attributes.ERROR_TYPE]:
                  fallbackError instanceof Error ? fallbackError.constructor.name : 'UnknownError',
              });

              console.error(
                `Failed to retrieve original file from MinIO for wallpaper ${id}:`,
                fallbackError
              );
              return null;
            }
          }

          // Original file not found in MinIO (or other S3 error)
          recordCounter('media.s3.operations.total', 1, {
            [Attributes.OPERATION_NAME]: 'get_object',
            [Attributes.OPERATION_SUCCESS]: 'false',
            source: 'original',
            [Attributes.ERROR_TYPE]:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          });

          console.error(`Failed to retrieve file from MinIO for wallpaper ${id}:`, error);
          return null;
        }
      }
    );
  }
}
