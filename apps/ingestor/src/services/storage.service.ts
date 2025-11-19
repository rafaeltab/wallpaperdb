import {
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { injectable, inject } from 'tsyringe';
import type { Config } from '../config.js';
import { StorageUploadFailedError } from '../errors/problem-details.js';

export interface UploadResult {
  storageKey: string;
  storageBucket: string;
}

@injectable()
export class StorageService {
  constructor(
    @inject('S3Client') private readonly s3Client: S3Client,
    @inject('Config') private readonly config: Config
  ) {}

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

// Keep legacy function exports for gradual migration (will be removed in Phase 9)
import { getMinioClient } from '../connections/minio.js';

export async function uploadToStorage(
  wallpaperId: string,
  buffer: Buffer,
  mimeType: string,
  extension: string,
  bucket: string,
  userId: string
): Promise<UploadResult> {
  const client = getMinioClient();

  // Storage key format: wlpr_<ulid>/original.<ext>
  const storageKey = `${wallpaperId}/original.${extension}`;

  try {
    await client.send(
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

export async function objectExists(
  bucket: string,
  key: string,
  s3Client?: S3Client
): Promise<boolean> {
  const client = s3Client || getMinioClient();

  try {
    await client.send(
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

export async function deleteFromStorage(
  bucket: string,
  key: string,
  s3Client?: S3Client
): Promise<void> {
  const client = s3Client || getMinioClient();

  try {
    await client.send(
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
