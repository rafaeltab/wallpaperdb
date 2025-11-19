import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config.js';
import { BaseConnection } from './base/base-connection.js';

class MinioConnection extends BaseConnection<S3Client> {
  protected createClient(config: Config): S3Client {
    return new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  protected closeClient(_client: S3Client): void {
    // S3 client doesn't need explicit closing
  }

  async checkHealth(client: S3Client, config: Config): Promise<boolean> {
    try {
      await client.send(
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
}

// Singleton instance
const minioConnection = new MinioConnection();

// Legacy API for backward compatibility
export function createMinioConnection(config: Config): S3Client {
  if (minioConnection.isInitialized()) {
    return minioConnection.getClient();
  }

  const client = minioConnection['createClient'](config);
  minioConnection['client'] = client;
  return client;
}

export async function checkMinioHealth(config: Config): Promise<boolean> {
  if (!minioConnection.isInitialized()) {
    return false;
  }
  return await minioConnection.checkHealth(minioConnection.getClient(), config);
}

export function getMinioClient(): S3Client {
  return minioConnection.getClient();
}

export function closeMinioConnection(): void {
  minioConnection['client'] = null;
}

// Export the connection instance for DI usage
export { minioConnection };
