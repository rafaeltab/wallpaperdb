import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { BaseConnection } from './base/base-connection.js';

@singleton()
export class MinioConnection extends BaseConnection<S3Client, Config> {
  constructor(@inject('config') config: Config) {
    super(config);
  }

  protected createClient(): S3Client {
    console.log(`Connecting to minio at ${this.config.s3Endpoint}`);
    return new S3Client({
      endpoint: this.config.s3Endpoint,
      region: this.config.s3Region,
      credentials: {
        accessKeyId: this.config.s3AccessKeyId,
        secretAccessKey: this.config.s3SecretAccessKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  protected closeClient(_client: S3Client): void {
    // S3 client doesn't need explicit closing
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.getClient().send(
        new HeadBucketCommand({
          Bucket: this.config.s3Bucket,
        })
      );
      return true;
    } catch (error) {
      console.error('MinIO health check failed:', error);
      return false;
    }
  }
}
