import {
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getMinioClient } from '../connections/minio.js';
import { StorageUploadFailedError } from '../errors/problem-details.js';

export interface UploadResult {
  storageKey: string;
  storageBucket: string;
}

/**
 * Upload file to MinIO storage
 */
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

/**
 * Check if object exists in storage
 */
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

/**
 * Delete object from storage
 */
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
