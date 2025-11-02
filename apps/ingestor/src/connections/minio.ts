import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

let s3Client: S3Client | null = null;

export function createMinioConnection(config: Config): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
    forcePathStyle: true, // Required for MinIO
  });

  return s3Client;
}

export async function checkMinioHealth(config: Config): Promise<boolean> {
  if (!s3Client) {
    return false;
  }

  try {
    await s3Client.send(
      new HeadBucketCommand({
        Bucket: config.s3Bucket,
      })
    );
    return true;
  } catch (error) {
    console.error('MinIO health check failed:', error);
    return false;
  }
}

export function getMinioClient(): S3Client {
  if (!s3Client) {
    throw new Error('MinIO client not initialized. Call createMinioConnection first.');
  }
  return s3Client;
}

export function closeMinioConnection(): void {
  // S3 client doesn't need explicit closing
  s3Client = null;
}
