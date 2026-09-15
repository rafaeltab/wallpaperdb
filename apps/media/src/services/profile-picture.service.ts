import { GetObjectCommand } from '@aws-sdk/client-s3';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { MinioConnection } from '../connections/minio.js';
import { ProfilePictureRepository } from '../repositories/profile-picture.repository.js';

@singleton()
export class ProfilePictureService {
  constructor(
    @inject(ProfilePictureRepository) private readonly repository: ProfilePictureRepository,
    @inject(MinioConnection) private readonly minio: MinioConnection,
    @inject('config') private readonly config: Config
  ) {}

  async getPicture(pictureId: string): Promise<Buffer | null> {
    const asset = await this.repository.findCurrent(pictureId);
    if (!asset) return null;
    if (!this.config.userServiceUrl || !this.config.userMediaServiceToken) {
      throw new Error('Profile picture availability is not configured');
    }
    const origin = this.config.userServiceUrl.replace(/\/+$/, '');
    const availability = await fetch(`${origin}/internal/profile-pictures/${encodeURIComponent(pictureId)}/availability`, {
      headers: { Authorization: `Bearer ${this.config.userMediaServiceToken}`, 'Cache-Control': 'no-store' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    await availability.body?.cancel();
    if (availability.status === 404) return null;
    if (availability.status !== 204) throw new Error('Profile picture availability could not be verified');

    const object = await this.minio.getClient().send(new GetObjectCommand({
      Bucket: asset.storageBucket, Key: asset.storageKey,
    }));
    if (!object.Body) throw new Error('Profile picture object is unavailable');
    // Read fully before enabling immutable caching; failed reads must remain retryable.
    return Buffer.from(await object.Body.transformToByteArray());
  }
}
