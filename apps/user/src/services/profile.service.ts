import {
  PROFILE_CREATED_SUBJECT,
  ProfileCreatedEventSchema,
  type ProfileCreatedEvent,
} from '@wallpaperdb/events';
import { eq } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import type { DatabaseConnection } from '../connections/database.js';
import { handleClaims, outboxEvents, type Profile, profiles } from '../db/schema.js';
import {
  type ExternalIdentity,
  type IdentityProvider,
  IdentityProviderToken,
} from './clerk-identity.service.js';

const RESERVED_HANDLES = new Set([
  'admin',
  'api',
  'help',
  'login',
  'profile',
  'security',
  'settings',
  'sign-in',
  'sign-up',
  'support',
]);
const FALLBACK_ADJECTIVES = ['quiet', 'bright', 'silver', 'wild'];
const FALLBACK_NOUNS = ['aurora', 'canvas', 'horizon', 'pixel'];

export class IdentityUnavailableError extends Error {}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@singleton()
export class ProfileService {
  constructor(
    private readonly database: DatabaseConnection,
    @inject(IdentityProviderToken) private readonly identities: IdentityProvider,
    @inject('config') private readonly config: Config
  ) {}

  async ensure(userId: string): Promise<Profile> {
    const existing = await this.database.getClient().db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
    });
    if (existing) return existing;

    let identity: ExternalIdentity;
    try {
      identity = await this.identities.getIdentity(userId);
    } catch (error) {
      throw new IdentityUnavailableError('Clerk identity lookup failed', { cause: error });
    }

    const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim();
    const generated = `${FALLBACK_ADJECTIVES[this.hash(userId) % FALLBACK_ADJECTIVES.length]} ${FALLBACK_NOUNS[Math.floor(this.hash(userId) / FALLBACK_ADJECTIVES.length) % FALLBACK_NOUNS.length]}`;
    const displayName = identity.displayName?.trim() || fullName || generated;
    const slug = slugify(displayName) || `profile-${this.hash(userId)}`;
    const minimumPaddedSlug = slug.padEnd(this.config.profileHandleMinLength, '0');
    const base = RESERVED_HANDLES.has(minimumPaddedSlug)
      ? `${minimumPaddedSlug}-profile`
      : minimumPaddedSlug;

    for (let attempt = 0; attempt < 100; attempt++) {
      const suffix = attempt === 0 ? '' : `-${ulid().slice(-6).toLowerCase()}`;
      const stemLength = this.config.profileHandleMaxLength - suffix.length;
      const handle = `${base.slice(0, stemLength).replace(/-+$/g, '')}${suffix}`;

      try {
        return await this.database.getClient().db.transaction(async (tx) => {
          const raced = await tx.query.profiles.findFirst({ where: eq(profiles.id, userId) });
          if (raced) return raced;

          const now = new Date();
          const [profile] = await tx
            .insert(profiles)
            .values({ id: userId, displayName, handle, version: 1, createdAt: now, updatedAt: now })
            .returning();
          await tx.insert(handleClaims).values({ handle, profileId: userId, kind: 'profile' });

          const event: ProfileCreatedEvent = {
            eventId: `evt_${ulid()}`,
            eventType: PROFILE_CREATED_SUBJECT,
            timestamp: now.toISOString(),
            profile: {
              id: profile.id,
              displayName: profile.displayName,
              handle: profile.handle,
              biographyMarkdown: profile.biographyMarkdown,
              pictureAssetId: profile.pictureAssetId,
              version: profile.version,
              createdAt: profile.createdAt.toISOString(),
              updatedAt: profile.updatedAt.toISOString(),
            },
          };
          ProfileCreatedEventSchema.parse(event);
          await tx.insert(outboxEvents).values({
            id: event.eventId,
            subject: event.eventType,
            aggregateId: userId,
            payload: event,
          });
          return profile;
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await this.database.getClient().db.query.profiles.findFirst({
          where: eq(profiles.id, userId),
        });
        if (raced) return raced;
      }
    }
    throw new Error('Unable to claim a unique profile handle');
  }

  private hash(value: string): number {
    let hash = 0;
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash;
  }
}
