import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { BaseConnection } from "./base/base-connection.js";
import type { S3Config } from "./types.js";

export interface S3ConnectionOptions {
  /**
   * Whether to use path-style URLs for S3 requests.
   * Required for local S3-compatible storage. Defaults to true.
   *
   * @default true
   */
  forcePathStyle?: boolean;
}

/**
 * S3 connection manager (SeaweedFS in local development and tests).
 * Uses the AWS S3 API and accepts any configured S3-compatible endpoint.
 * Extends BaseConnection to provide lifecycle management for S3Client.
 *
 * @example
 * ```typescript
 * const connection = new S3Connection(config);
 * await connection.initialize();
 *
 * const client = connection.getClient();
 * await client.send(new PutObjectCommand({...}));
 *
 * await connection.close();
 * ```
 */
export class S3Connection extends BaseConnection<S3Client, S3Config> {
  constructor(
    config: S3Config,
    private readonly options: S3ConnectionOptions = {}
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
   * Check S3 connection health by attempting to access the configured bucket.
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
      console.error("S3 health check failed:", error);
      return false;
    }
  }
}
