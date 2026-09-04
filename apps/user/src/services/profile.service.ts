import {
  PROFILE_CREATED_SUBJECT,
  type ProfileCreatedEvent,
  ProfileCreatedEventSchema,
  PROFILE_UPDATED_SUBJECT,
  type ProfileUpdatedEvent,
  ProfileUpdatedEventSchema,
} from '@wallpaperdb/events';
import { and, eq, sql } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { handleClaims, outboxEvents, type Profile, profiles } from '../db/schema.js';
import {
  type ExternalIdentity,
  type IdentityProvider,
  IdentityProviderToken,
} from './clerk-identity.service.js';

const RESERVED_HANDLES = new Set([
  'admin',
  'api',
  'color-extractor',
  'documentation',
  'docs',
  'gateway',
  'graphql',
  'help',
  'health',
  'ingestor',
  'login',
  'media',
  'openapi',
  'profile',
  'profiles',
  'ready',
  'security',
  'settings',
  'sign-in',
  'sign-up',
  'sso-callback',
  'support',
  'tags',
  'upload',
  'user',
  'variant-generator',
  'wallpapers',
]);
const FALLBACK_ADJECTIVES = ['quiet', 'bright', 'silver', 'wild'];
const FALLBACK_NOUNS = ['aurora', 'canvas', 'horizon', 'pixel'];

export class IdentityUnavailableError extends Error {}
export class InvalidDisplayNameError extends Error {}
export class ProfileVersionConflictError extends Error {}

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

function withCollisionSuffix(base: string, maximumLength: number): string {
  const randomLength = Math.min(6, Math.max(1, maximumLength - 2));
  const random = ulid().slice(-randomLength).toLowerCase();

  if (maximumLength === 1) return random;
  if (maximumLength === 2) return `${base.slice(0, 1)}${random}`;

  const stemLength = maximumLength - random.length - 1;
  const stem = base.slice(0, stemLength).replace(/-+$/g, '');
  return `${stem}-${random}`;
}

function normalizeDisplayName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

@singleton()
export class ProfileService {
  constructor(
    @inject(DatabaseConnection) private readonly database: DatabaseConnection,
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

    const fullName = normalizeDisplayName(
      [identity.firstName, identity.lastName].filter(Boolean).join(' ')
    );
    const generated = `${FALLBACK_ADJECTIVES[this.hash(userId) % FALLBACK_ADJECTIVES.length]} ${FALLBACK_NOUNS[Math.floor(this.hash(userId) / FALLBACK_ADJECTIVES.length) % FALLBACK_NOUNS.length]}`;
    const selectedDisplayName =
      normalizeDisplayName(identity.displayName ?? '') || fullName || generated;
    const displayName = [...selectedDisplayName]
      .slice(0, this.config.profileDisplayNameMaxLength)
      .join('')
      .trim();
    const slug = slugify(displayName) || `profile-${this.hash(userId)}`;
    const minimumPaddedSlug = slug.padEnd(this.config.profileHandleMinLength, '0');
    const base = RESERVED_HANDLES.has(minimumPaddedSlug)
      ? `${minimumPaddedSlug}-profile`
      : minimumPaddedSlug;

    for (let attempt = 0; attempt < 100; attempt++) {
      const handle =
        attempt === 0
          ? base.slice(0, this.config.profileHandleMaxLength).replace(/-+$/g, '')
          : withCollisionSuffix(base, this.config.profileHandleMaxLength);
      if (RESERVED_HANDLES.has(handle)) continue;

      try {
        return await this.database.getClient().db.transaction(async (tx) => {
          const raced = await tx.query.profiles.findFirst({ where: eq(profiles.id, userId) });
          if (raced) return raced;

          const now = new Date();
          const [profile] = await tx
            .insert(profiles)
            .values({ id: userId, displayName, handle, version: 1, createdAt: now, updatedAt: now })
            .returning();
          const [claim] = await tx
            .insert(handleClaims)
            .values({ handle, profileId: userId, kind: 'profile' })
            .returning();

          const event: ProfileCreatedEvent = {
            eventId: `evt_${ulid()}`,
            eventType: PROFILE_CREATED_SUBJECT,
            timestamp: now.toISOString(),
            change: { type: 'created' },
            profile: {
              id: profile.id,
              displayName: profile.displayName,
              handle: profile.handle,
              claimGeneration: claim.claimGeneration,
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

  async updateDisplayName(
    userId: string,
    requestedDisplayName: string,
    expectedVersion: number
  ): Promise<Profile> {
    const displayName = normalizeDisplayName(requestedDisplayName);
    if (!displayName) throw new InvalidDisplayNameError('Display name must not be blank');
    if ([...displayName].length > this.config.profileDisplayNameMaxLength) {
      throw new InvalidDisplayNameError(
        `Display name must be at most ${this.config.profileDisplayNameMaxLength} characters`
      );
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new InvalidDisplayNameError('Expected Profile version must be a positive integer');
    }

    return this.database.getClient().db.transaction(async (tx) => {
      const current = await tx.query.profiles.findFirst({ where: eq(profiles.id, userId) });
      if (!current || current.version !== expectedVersion) {
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      }
      if (current.displayName === displayName) return current;

      const now = new Date();
      const [updated] = await tx
        .update(profiles)
        .set({
          displayName,
          version: sql`${profiles.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(profiles.id, userId), eq(profiles.version, expectedVersion)))
        .returning();
      if (!updated) {
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      }

      const claim = await tx.query.handleClaims.findFirst({
        where: eq(handleClaims.handle, updated.handle),
      });
      if (!claim) throw new Error('Current Profile Handle claim is missing');

      const event: ProfileUpdatedEvent = {
        eventId: `evt_${ulid()}`,
        eventType: PROFILE_UPDATED_SUBJECT,
        timestamp: now.toISOString(),
        change: {
          type: 'display-name-changed',
          before: current.displayName,
          after: updated.displayName,
        },
        profile: {
          id: updated.id,
          displayName: updated.displayName,
          handle: updated.handle,
          claimGeneration: claim.claimGeneration,
          biographyMarkdown: updated.biographyMarkdown,
          pictureAssetId: updated.pictureAssetId,
          version: updated.version,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      };
      ProfileUpdatedEventSchema.parse(event);
      await tx.insert(outboxEvents).values({
        id: event.eventId,
        subject: event.eventType,
        aggregateId: userId,
        payload: event,
      });
      return updated;
    });
  }

  private hash(value: string): number {
    let hash = 0;
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash;
  }
}
