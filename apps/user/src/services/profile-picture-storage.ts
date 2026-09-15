import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import type { ProfilePictureAsset } from '../db/schema.js';

export class PictureStorageUnavailableError extends Error {}

@singleton()
export class ProfilePictureStorage {
  private client: S3Client | undefined;
  constructor(@inject('config') private readonly config: Config) {}

  async put(asset: ProfilePictureAsset, bytes: Buffer): Promise<void> {
    const { s3Endpoint, s3AccessKeyId, s3SecretAccessKey, s3Region } = this.config;
    if (!s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey) {
      throw new PictureStorageUnavailableError('Picture storage is unavailable');
    }
    this.client ??= new S3Client({ endpoint: s3Endpoint, region: s3Region, forcePathStyle: true,
      credentials: { accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey } });
    try {
      await this.client.send(new PutObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey,
        Body: bytes, ContentType: asset.mimeType }), { abortSignal: AbortSignal.timeout(10_000) });
    } catch {
      throw new PictureStorageUnavailableError('Picture storage is unavailable');
    }
  }

  close(): void { this.client?.destroy(); }
}
