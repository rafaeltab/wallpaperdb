import { eq } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { profilePictureAssets, profiles } from '../db/schema.js';
import { processProfilePicture } from './profile-picture-processing.js';
import { ProfilePictureStorage } from './profile-picture-storage.js';
import { profileEvidenceRetentionMs } from './profile-retention-policy.js';
import { type OwnerProfile, ProfileService } from './profile.service.js';

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
    const picture = await processProfilePicture(bytes, {
      maxBytes: this.config.profilePictureMaxBytes,
      maxPixels: this.config.profilePictureMaxPixels,
      maxDecodedBytes: this.config.profilePictureMaxDecodedBytes,
    });
    const id = `pic_${ulid()}`;
    const now = new Date();
    // Record the private candidate before PUT. A failed or ambiguous adoption must
    // never delete bytes that a committed Profile may already reference.
    const [asset] = await this.database
      .getClient()
      .db.insert(profilePictureAssets)
      .values({
        id,
        profileId: userId,
        storageBucket: this.config.profilePictureBucket,
        storageKey: `${userId}/${id}.webp`,
        mimeType: picture.mimeType,
        width: picture.width,
        height: picture.height,
        fileSizeBytes: picture.bytes.length,
        state: 'staged',
        createdAt: now,
        expiresAt: new Date(now.getTime() + profileEvidenceRetentionMs(this.config)),
      })
      .returning();
    await this.database.getClient().db.transaction(async (tx) => {
      // Keep the committed candidate for ambiguous PUT failures. Cleanup and
      // adoption take these locks in the same order and cannot race this write.
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for('update');
      const [candidate] = await tx
        .select()
        .from(profilePictureAssets)
        .where(eq(profilePictureAssets.id, asset.id))
        .for('update');
      if (
        !profile ||
        !candidate ||
        candidate.state !== 'staged' ||
        !candidate.expiresAt ||
        candidate.expiresAt.getTime() <= Date.now()
      ) {
        throw new Error('Staged Profile picture expired before its upload could start');
      }
      await this.storage.put(candidate, picture.bytes);
    });
    return id;
  }
}
