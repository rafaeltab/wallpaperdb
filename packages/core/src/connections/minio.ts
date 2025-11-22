import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { MinioConfig } from "./types.js";

export interface S3ClientOptions {
  /** Force path-style URLs (required for MinIO, default: true) */
  forcePathStyle?: boolean;
}

/**
 * Creates an S3 client configured for MinIO.
 *
 * @example
 * ```typescript
 * import { createS3Client } from '@wallpaperdb/core/connections';
 *
 * const client = createS3Client({
 *   s3Endpoint: config.s3Endpoint,
 *   s3Region: config.s3Region,
 *   s3AccessKeyId: config.s3AccessKeyId,
 *   s3SecretAccessKey: config.s3SecretAccessKey,
 *   s3Bucket: config.s3Bucket,
 * });
 * ```
 */
export function createS3Client(
  config: MinioConfig,
  options: S3ClientOptions = {}
): S3Client {
  return new S3Client({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
    forcePathStyle: options.forcePathStyle ?? true,
  });
}

/**
 * Checks if an S3/MinIO client can access the specified bucket.
 */
export async function checkS3Health(
  client: S3Client,
  bucket: string
): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}
