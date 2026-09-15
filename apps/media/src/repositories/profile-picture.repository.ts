import type { ProfileCreatedEvent, ProfileUpdatedEvent } from '@wallpaperdb/events';
import { and, eq, lt } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { DatabaseConnection } from '../connections/database.js';
import {
  profilePictureAssets,
  profilePictureHeads,
  type ProfilePictureAsset,
} from '../db/schema.js';

@singleton()
export class ProfilePictureRepository {
  constructor(@inject(DatabaseConnection) private readonly database: DatabaseConnection) {}

  async project(event: ProfileCreatedEvent | ProfileUpdatedEvent): Promise<void> {
    await this.database.getClient().db.transaction(async (tx) => {
      if (event.change.type === 'picture-changed' && event.change.asset) {
        await tx
          .insert(profilePictureAssets)
          .values({
            ...event.change.asset,
            profileId: event.profile.id,
            createdAt: new Date(event.timestamp),
          })
          .onConflictDoNothing({ target: profilePictureAssets.id });
      }
      const head = {
        profileId: event.profile.id,
        version: event.profile.version,
        pictureId: event.profile.pictureAssetId,
        updatedAt: new Date(event.profile.updatedAt),
      };
      await tx
        .insert(profilePictureHeads)
        .values(head)
        .onConflictDoUpdate({
          target: profilePictureHeads.profileId,
          set: head,
          setWhere: lt(profilePictureHeads.version, event.profile.version),
        });
    });
  }

  async findCurrent(pictureId: string): Promise<ProfilePictureAsset | null> {
    const [result] = await this.database
      .getClient()
      .db.select({ asset: profilePictureAssets })
      .from(profilePictureAssets)
      .innerJoin(
        profilePictureHeads,
        and(
          eq(profilePictureHeads.pictureId, profilePictureAssets.id),
          eq(profilePictureHeads.profileId, profilePictureAssets.profileId)
        )
      )
      .where(eq(profilePictureAssets.id, pictureId));
    return result?.asset ?? null;
  }
}
