import type { ProfileCreatedEvent } from '@wallpaperdb/events';
import { eq } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { DatabaseConnection } from '../connections/database.js';
import { handleClaims, type Profile, profileEvents, profiles } from '../db/schema.js';

export class HandleAlreadyClaimedError extends Error {}
export class ProfileAlreadyExistsError extends Error {}

export interface CreateProfileInput {
  profileId: string;
  displayName: string;
  handle: string;
  eventId: string;
  occurredAt: Date;
}

@singleton()
export class ProfileRepository {
  constructor(@inject(DatabaseConnection) private readonly database: DatabaseConnection) {}

  async findById(profileId: string): Promise<Profile | undefined> {
    return this.database.getClient().db.query.profiles.findFirst({
      where: eq(profiles.id, profileId),
    });
  }

  async create(input: CreateProfileInput): Promise<Profile> {
    const { profileId, displayName, handle, eventId, occurredAt } = input;
    try {
      return await this.database.getClient().db.transaction(async (tx) => {
        const [profile] = await tx
          .insert(profiles)
          .values({
            id: profileId,
            displayName,
            handle,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          })
          .returning();
        await tx.insert(handleClaims).values({ handle, profileId, kind: 'current' });

        const event: ProfileCreatedEvent = {
          eventId,
          eventType: 'profile.created',
          timestamp: occurredAt.toISOString(),
          profileVersion: profile.version,
          change: { type: 'created' },
          profile: {
            id: profile.id,
            handle: profile.handle,
            displayName: profile.displayName,
            biographyMarkdown: profile.biographyMarkdown,
            pictureAssetId: profile.pictureAssetId,
            version: profile.version,
            createdAt: profile.createdAt.toISOString(),
            updatedAt: profile.updatedAt.toISOString(),
          },
        };
        await tx.insert(profileEvents).values({
          id: eventId,
          profileId,
          type: 'profile.created',
          profileVersion: profile.version,
          event,
          occurredAt,
        });
        return profile;
      });
    } catch (error) {
      const constraint = uniqueConstraint(error);
      if (constraint === 'profiles_pkey') throw new ProfileAlreadyExistsError();
      if (constraint === 'handle_claims_pkey' || constraint === 'profiles_handle_unique') {
        throw new HandleAlreadyClaimedError();
      }
      throw error;
    }
  }
}

function uniqueConstraint(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && error.code === '23505' && 'constraint' in error) {
    return typeof error.constraint === 'string' ? error.constraint : undefined;
  }
  return 'cause' in error ? uniqueConstraint(error.cause) : undefined;
}
