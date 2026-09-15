import { inject, singleton } from 'tsyringe';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { profilePictureAssets } from '../db/schema.js';
import { processProfilePicture } from './profile-picture-processing.js';
import { ProfilePictureStorage } from './profile-picture-storage.js';
import { type OwnerProfile, ProfileService } from './profile.service.js';

const PRIVATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@singleton()
export class ProfilePictureIngestionService {
  constructor(
    @inject(DatabaseConnection) private readonly database: DatabaseConnection,
    @inject(ProfileService) private readonly profiles: ProfileService,
    @inject(ProfilePictureStorage) private readonly storage: ProfilePictureStorage,
    @inject('config') private readonly config: Config
  ) {}

  async upload(userId: string, bytes: Buffer, expectedVersion: number): Promise<OwnerProfile> {
    const id = await this.stage(userId, bytes);
    return this.profiles.adoptPicture(userId, id, expectedVersion);
  }

  async stage(userId: string, bytes: Buffer): Promise<string> {
    const picture = await processProfilePicture(bytes, { maxBytes: this.config.profilePictureMaxBytes,
      maxPixels: this.config.profilePictureMaxPixels, maxDecodedBytes: this.config.profilePictureMaxDecodedBytes });
    const id = `pic_${ulid()}`;
    const now = new Date();
    // Record the private candidate before PUT. A failed or ambiguous adoption must
    // never delete bytes that a committed Profile may already reference.
    const [asset] = await this.database.getClient().db.insert(profilePictureAssets).values({
      id, profileId: userId, storageBucket: this.config.profilePictureBucket, storageKey: `${userId}/${id}.webp`,
      mimeType: picture.mimeType, width: picture.width, height: picture.height, fileSizeBytes: picture.bytes.length,
      state: 'staged', createdAt: now, expiresAt: new Date(now.getTime() + PRIVATE_RETENTION_MS),
    }).returning();
    await this.storage.put(asset, picture.bytes);
    return id;
  }
}
