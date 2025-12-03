import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { BaseConnection } from "./base/base-connection.js";
import type { MinioConfig } from "./types.js";

export interface MinioConnectionOptions {
  /**
   * Whether to use path-style URLs for S3 requests.
   * Required for MinIO. Defaults to true.
   *
   * @default true
   */
  forcePathStyle?: boolean;
}

/**
 * MinIO/S3 connection manager.
 * Extends BaseConnection to provide lifecycle management for S3Client.
 *
 * @example
 * ```typescript
 * const connection = new MinioConnection(config);
 * await connection.initialize();
 *
 * const client = connection.getClient();
 * await client.send(new PutObjectCommand({...}));
 *
 * await connection.close();
 * ```
 */
export class MinioConnection extends BaseConnection<S3Client, MinioConfig> {
  constructor(
    config: MinioConfig,
    private readonly options: MinioConnectionOptions = {}
  ) {
    super(config);
  }

  protected createClient(): S3Client {
    return new S3Client({
      endpoint: this.config.s3Endpoint,
      region: this.config.s3Region,
      credentials: {
        accessKeyId: this.config.s3AccessKeyId,
        secretAccessKey: this.config.s3SecretAccessKey,
      },
      forcePathStyle: this.options.forcePathStyle ?? true,
    });
  }

  protected closeClient(_client: S3Client): void {
    // S3 client doesn't require explicit cleanup
  }

  /**
   * Check MinIO connection health by attempting to access the configured bucket.
   *
   * @returns true if bucket is accessible, false otherwise
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.getClient().send(
        new HeadBucketCommand({
          Bucket: this.config.s3Bucket,
        })
      );
      return true;
    } catch (error) {
      console.error("MinIO health check failed:", error);
      return false;
    }
  }
}
