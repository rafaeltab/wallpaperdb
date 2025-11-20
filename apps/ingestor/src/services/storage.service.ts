import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
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

    // Storage key format: wlpr_<ulid>/original.<ext>
    const storageKey = `${wallpaperId}/original.${extension}`;

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

      return {
        storageKey,
        storageBucket: bucket,
      };
    } catch (error) {
      console.error('MinIO upload failed:', error);
      throw new StorageUploadFailedError();
    }
  }

  /**
   * Check if object exists in storage
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete object from storage
   */
  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    } catch (error) {
      console.error('Failed to delete from MinIO:', error);
      // Don't throw - this is a cleanup operation
    }
  }
}
