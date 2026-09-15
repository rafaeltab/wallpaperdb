import { and, eq, lte, sql } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { DatabaseConnection } from '../connections/database.js';
import { type ProfilePictureAsset, profilePictureAssets, profiles } from '../db/schema.js';
import { ProfilePictureStorage } from './profile-picture-storage.js';

@singleton()
export class ProfilePictureRetentionService {
  private cursor: Pick<ProfilePictureAsset, 'expiresAt' | 'id'> | undefined;

  constructor(
    @inject(DatabaseConnection) private readonly database: DatabaseConnection,
    @inject(ProfilePictureStorage) private readonly storage: ProfilePictureStorage
  ) {}

  async cleanupExpired(
    now: Date,
    isStopping: () => boolean = () => false
  ): Promise<{ deleted: number; failed: number }> {
    const db = this.database.getClient().db;
    const candidates = await db
      .select()
      .from(profilePictureAssets)
      .where(
        and(
          eq(profilePictureAssets.state, 'retired'),
          lte(profilePictureAssets.expiresAt, now),
          this.cursor?.expiresAt
            ? sql`(${profilePictureAssets.expiresAt}, ${profilePictureAssets.id}) > (${this.cursor.expiresAt.toISOString()}, ${this.cursor.id})`
            : undefined
        )
      )
      .orderBy(profilePictureAssets.expiresAt, profilePictureAssets.id)
      .limit(100);
    const result = { deleted: 0, failed: 0 };
    for (const candidate of candidates) {
      if (isStopping()) break;
      // Advance even after failure or a lock skip, so old poison records cannot
      // starve later expired pictures. Wrap after reaching the end of the scan.
      this.cursor = candidate;
      try {
        const deleted = await db.transaction(async (tx) => {
          // Adoption also locks the Profile before touching picture assets.
          const [profile] = await tx
            .select()
            .from(profiles)
            .where(eq(profiles.id, candidate.profileId))
            .for('update', { skipLocked: true });
          if (!profile || profile.pictureAssetId === candidate.id) return false;
          const [asset] = await tx
            .select()
            .from(profilePictureAssets)
            .where(eq(profilePictureAssets.id, candidate.id))
            .for('update', { skipLocked: true });
          if (!asset || asset.state !== 'retired' || !asset.expiresAt || asset.expiresAt > now) {
            return false;
          }
          await this.storage.delete(asset);
          await tx.delete(profilePictureAssets).where(eq(profilePictureAssets.id, asset.id));
          return true;
        });
        if (deleted) result.deleted++;
      } catch {
        // Keep the row after failed/ambiguous DELETE or database commit.
        // Deleting an already absent S3 key is safe on the next attempt.
        result.failed++;
      }
    }
    if (candidates.length < 100 && !isStopping()) this.cursor = undefined;
    return result;
  }
}
