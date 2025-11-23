import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { MinioConnection } from '../connections/minio.js';
import { StorageUploadFailedError } from '../errors/problem-details.js';

export interface UploadResult {
  storageKey: string;
  storageBucket: string;
}

@injectable()
export class StorageService {
  private readonly s3Client: S3Client;

  constructor(
    @inject(MinioConnection) minioConnection: MinioConnection,
    @inject('config') private readonly config: Config
  ) {
    this.s3Client = minioConnection.getClient();
  }

  /**
   * Upload file to MinIO storage
   */
  async upload(
    wallpaperId: string,
    buffer: Buffer,
    mimeType: string,
    extension: string,
    userId: string
  ): Promise<UploadResult> {
    const bucket = this.config.s3Bucket;
    const storageKey = `${wallpaperId}/original.${extension}`;

    return await withSpan(
      'storage.s3.put_object',
      {
        [Attributes.STORAGE_BUCKET]: bucket,
        [Attributes.STORAGE_KEY]: storageKey,
        [Attributes.OPERATION_NAME]: 'put_object',
        [Attributes.FILE_SIZE_BYTES]: buffer.length,
        [Attributes.FILE_MIME_TYPE]: mimeType,
        [Attributes.USER_ID]: userId,
        [Attributes.WALLPAPER_ID]: wallpaperId,
      },
      async () => {
        const startTime = Date.now();

        try {
          await this.s3Client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: storageKey,
              Body: buffer,
              ContentType: mimeType,
              Metadata: {
                userId,
                uploadedAt: new Date().toISOString(),
              },
            })
          );

          this.recordStorageMetrics('put_object', true, startTime);

          return {
            storageKey,
            storageBucket: bucket,
          };
        } catch (error) {
          this.recordStorageMetrics('put_object', false, startTime);
          console.error('MinIO upload failed:', error);
          throw new StorageUploadFailedError();
        }
      }
    );
  }

  /**
   * Check if object exists in storage
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    return await withSpan(
      'storage.s3.head_object',
      {
        [Attributes.STORAGE_BUCKET]: bucket,
        [Attributes.STORAGE_KEY]: key,
        [Attributes.OPERATION_NAME]: 'head_object',
      },
      async (span) => {
        const startTime = Date.now();

        try {
          await this.s3Client.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: key,
            })
          );
          span.setAttribute('object_exists', true);
          this.recordStorageMetrics('head_object', true, startTime);
          return true;
        } catch {
          span.setAttribute('object_exists', false);
          this.recordStorageMetrics('head_object', true, startTime); // Not finding is still a successful operation
          return false;
        }
      }
    );
  }

  /**
   * Delete object from storage
   */
  async delete(bucket: string, key: string): Promise<void> {
    return await withSpan(
      'storage.s3.delete_object',
      {
        [Attributes.STORAGE_BUCKET]: bucket,
        [Attributes.STORAGE_KEY]: key,
        [Attributes.OPERATION_NAME]: 'delete_object',
      },
      async () => {
        const startTime = Date.now();

        try {
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: key,
            })
          );
          this.recordStorageMetrics('delete_object', true, startTime);
        } catch (error) {
          this.recordStorageMetrics('delete_object', false, startTime);
          console.error('Failed to delete from MinIO:', error);
          // Don't throw - this is a cleanup operation
        }
      }
    );
  }

  /**
   * Record storage operation metrics.
   */
  private recordStorageMetrics(operation: string, success: boolean, startTime: number): void {
    const durationMs = Date.now() - startTime;
    const attributes = {
      [Attributes.OPERATION_NAME]: operation,
      [Attributes.OPERATION_SUCCESS]: success,
    };

    recordCounter('storage.operations.total', 1, attributes);
    recordHistogram('storage.operation_duration_ms', durationMs, attributes);
  }
}
