import {
  PROFILE_CREATED_SUBJECT,
  type ProfileCreatedEvent,
  ProfileCreatedEventSchema,
  PROFILE_UPDATED_SUBJECT,
  type ProfileUpdatedEvent,
  ProfileUpdatedEventSchema,
} from '@wallpaperdb/events';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
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
const ALIAS_EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

type ProfileReader = Pick<ReturnType<DatabaseConnection['getClient']>['db'], 'query'>;
type ProfileTransaction = Parameters<
  Parameters<ReturnType<DatabaseConnection['getClient']>['db']['transaction']>[0]
>[0];
type AliasClaim = typeof handleClaims.$inferSelect;
export interface AliasClaimReference {
  profileId: string;
  handle: string;
  claimGeneration: number;
}
export interface OwnerProfile extends Profile {
  aliases: Array<{
    handle: string;
    claimGeneration: number;
    createdAt: string;
    expiresAt: string | null;
  }>;
  retainedAliasLimit: number;
}

export class IdentityUnavailableError extends Error {}
export class InvalidDisplayNameError extends Error {}
export class InvalidHandleError extends Error {}
export class InvalidAliasCommandError extends Error {}
export class AliasNotFoundError extends Error {}
export class AliasNotScheduledError extends Error {}
export class HandleUnavailableError extends Error {}
export class HandleCooldownError extends Error {
  constructor(readonly nextHandleChangeAt: Date) {
    super('You can change your Handle once every seven days');
  }
}
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

  async ensure(userId: string): Promise<OwnerProfile> {
    const existing = await this.findOwnerProfile(userId);
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
          const [raced] = await tx
            .select()
            .from(profiles)
            .where(eq(profiles.id, userId))
            .for('share');
          if (raced) return this.ownerProfile(raced, tx);

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
              aliases: [],
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
          return {
            ...profile,
            aliases: [],
            retainedAliasLimit: this.config.profileRetainedAliasLimit,
          };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await this.findOwnerProfile(userId);
        if (raced) return raced;
      }
    }
    throw new Error('Unable to claim a unique profile handle');
  }

  async changeHandle(
    userId: string,
    requestedHandle: string,
    expectedVersion: number
  ): Promise<OwnerProfile> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new InvalidHandleError('Expected Profile version must be a positive integer');
    }
    const handle = slugify(requestedHandle);
    if (
      handle.length < this.config.profileHandleMinLength ||
      handle.length > this.config.profileHandleMaxLength
    ) {
      throw new InvalidHandleError(
        `Handle must contain ${this.config.profileHandleMinLength}–${this.config.profileHandleMaxLength} letters, numbers, or single hyphens after normalization`
      );
    }
    if (RESERVED_HANDLES.has(handle))
      throw new InvalidHandleError('This Handle is reserved; choose another name');
    return this.database
      .getClient()
      .db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, userId))
          .for('update');
        if (!current || current.version !== expectedVersion) {
          throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
        }
        if (current.handle === handle) return this.ownerProfile(current, tx);
        const now = new Date();
        if (current.lastHandleChangedAt) {
          const deadline = new Date(
            current.lastHandleChangedAt.getTime() + 7 * 24 * 60 * 60 * 1000
          );
          if (now < deadline) throw new HandleCooldownError(deadline);
        }
        const [updated] = await tx
          .update(profiles)
          .set({
            handle,
            version: sql`${profiles.version} + 1`,
            updatedAt: now,
            lastHandleChangedAt: now,
          })
          .where(and(eq(profiles.id, userId), eq(profiles.version, expectedVersion)))
          .returning();
        if (!updated)
          throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
        const [claim] = await tx
          .insert(handleClaims)
          .values({ handle, profileId: userId, kind: 'profile' })
          .onConflictDoUpdate({
            target: handleClaims.handle,
            set: {
              kind: 'profile',
              claimGeneration: sql`excluded.claim_generation`,
              createdAt: now,
              expiresAt: null,
            },
            setWhere: and(eq(handleClaims.profileId, userId), eq(handleClaims.kind, 'alias')),
          })
          .returning();
        if (!claim)
          throw new HandleUnavailableError('This Handle is already in use; choose another name');
        await tx
          .update(handleClaims)
          .set({ kind: 'alias', createdAt: now, expiresAt: null })
          .where(eq(handleClaims.handle, current.handle));
        const retained = await tx.query.handleClaims.findMany({
          where: and(
            eq(handleClaims.profileId, userId),
            eq(handleClaims.kind, 'alias'),
            isNull(handleClaims.expiresAt)
          ),
          orderBy: [handleClaims.createdAt, handleClaims.handle],
        });
        const expiresAt = new Date(now.getTime() + ALIAS_EXPIRY_GRACE_MS);
        const scheduledAliases = retained
          .slice(0, Math.max(0, retained.length - this.config.profileRetainedAliasLimit))
          .map((alias) => ({ handle: alias.handle, expiresAt: expiresAt.toISOString() }));
        if (scheduledAliases.length > 0) {
          await tx
            .update(handleClaims)
            .set({ expiresAt })
            .where(
              inArray(
                handleClaims.handle,
                scheduledAliases.map((alias) => alias.handle)
              )
            );
        }
        const owner = await this.ownerProfile(updated, tx);
        const event: ProfileUpdatedEvent = {
          eventId: `evt_${ulid()}`,
          eventType: PROFILE_UPDATED_SUBJECT,
          timestamp: now.toISOString(),
          change: {
            type: 'handle-changed',
            before: current.handle,
            after: handle,
            scheduledAliases,
          },
          profile: {
            id: updated.id,
            displayName: updated.displayName,
            handle: updated.handle,
            claimGeneration: claim.claimGeneration,
            aliases: owner.aliases,
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
        return owner;
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error))
          throw new HandleUnavailableError('This Handle is already in use; choose another name');
        throw error;
      });
  }

  async scheduleAliasExpiry(
    userId: string,
    requestedHandle: string,
    expectedVersion: number
  ): Promise<OwnerProfile> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new InvalidAliasCommandError('Expected Profile version must be a positive integer');
    }
    const handle = requestedHandle.toLowerCase();
    return this.database.getClient().db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for('update');
      if (!current || current.version !== expectedVersion) {
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      }
      const alias = await tx.query.handleClaims.findFirst({
        where: and(
          eq(handleClaims.handle, handle),
          eq(handleClaims.profileId, userId),
          eq(handleClaims.kind, 'alias')
        ),
      });
      if (!alias) throw new AliasNotFoundError('This Handle is not one of your aliases');
      if (alias.expiresAt) return this.ownerProfile(current, tx);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ALIAS_EXPIRY_GRACE_MS);
      await tx.update(handleClaims).set({ expiresAt }).where(eq(handleClaims.handle, handle));
      const [updated] = await tx
        .update(profiles)
        .set({
          version: sql`${profiles.version} + 1`,
          updatedAt: now,
        })
        .where(eq(profiles.id, userId))
        .returning();
      const claim = await tx.query.handleClaims.findFirst({
        where: eq(handleClaims.handle, updated.handle),
      });
      if (!claim) throw new Error('Current Profile Handle claim is missing');
      const owner = await this.ownerProfile(updated, tx);
      const event: ProfileUpdatedEvent = {
        eventId: `evt_${ulid()}`,
        eventType: PROFILE_UPDATED_SUBJECT,
        timestamp: now.toISOString(),
        change: {
          type: 'alias-expiry-scheduled',
          handle,
          before: null,
          after: expiresAt.toISOString(),
        },
        profile: {
          id: updated.id,
          displayName: updated.displayName,
          handle: updated.handle,
          claimGeneration: claim.claimGeneration,
          aliases: owner.aliases,
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
      return owner;
    });
  }

  async expireDueAlias(reference: AliasClaimReference, now: Date): Promise<boolean> {
    return this.database.getClient().db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, reference.profileId))
        .for('update');
      if (!profile) return false;
      const alias = await tx.query.handleClaims.findFirst({
        where: and(
          eq(handleClaims.handle, reference.handle),
          eq(handleClaims.profileId, reference.profileId),
          eq(handleClaims.claimGeneration, reference.claimGeneration),
          eq(handleClaims.kind, 'alias')
        ),
      });
      if (!alias?.expiresAt || alias.expiresAt > now) return false;
      await this.releaseAlias(tx, profile, alias, now, 'scheduled');
      return true;
    });
  }

  async expireAliasImmediately(
    userId: string,
    requestedHandle: string,
    expectedVersion: number
  ): Promise<OwnerProfile> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new InvalidAliasCommandError('Expected Profile version must be a positive integer');
    }
    return this.database.getClient().db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for('update');
      if (!profile || profile.version !== expectedVersion) {
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      }
      const alias = await tx.query.handleClaims.findFirst({
        where: and(
          eq(handleClaims.handle, requestedHandle.toLowerCase()),
          eq(handleClaims.profileId, userId),
          eq(handleClaims.kind, 'alias')
        ),
      });
      if (!alias) throw new AliasNotFoundError('This Handle is not one of your aliases');
      if (!alias.expiresAt)
        throw new AliasNotScheduledError(
          'Schedule this alias for removal before expiring it immediately'
        );
      return this.releaseAlias(tx, profile, alias, new Date(), 'immediate');
    });
  }

  private async releaseAlias(
    tx: ProfileTransaction,
    profile: Profile,
    alias: AliasClaim,
    now: Date,
    reason: 'scheduled' | 'immediate'
  ): Promise<OwnerProfile> {
    if (!alias.expiresAt) throw new InvalidAliasCommandError('Only a scheduled alias can expire');
    await tx
      .delete(handleClaims)
      .where(
        and(
          eq(handleClaims.handle, alias.handle),
          eq(handleClaims.profileId, profile.id),
          eq(handleClaims.kind, 'alias'),
          eq(handleClaims.claimGeneration, alias.claimGeneration)
        )
      );
    const [updated] = await tx
      .update(profiles)
      .set({
        version: sql`${profiles.version} + 1`,
        updatedAt: now,
      })
      .where(eq(profiles.id, profile.id))
      .returning();
    const claim = await tx.query.handleClaims.findFirst({
      where: eq(handleClaims.handle, profile.handle),
    });
    if (!claim) throw new Error('Current Profile Handle claim is missing');
    const owner = await this.ownerProfile(updated, tx);
    const event: ProfileUpdatedEvent = {
      eventId: `evt_${ulid()}`,
      eventType: PROFILE_UPDATED_SUBJECT,
      timestamp: now.toISOString(),
      change: {
        type: 'alias-expired',
        handle: alias.handle,
        claimGeneration: alias.claimGeneration,
        before: alias.expiresAt.toISOString(),
        after: null,
        reason,
      },
      profile: {
        id: updated.id,
        displayName: updated.displayName,
        handle: updated.handle,
        claimGeneration: claim.claimGeneration,
        aliases: owner.aliases,
        biographyMarkdown: updated.biographyMarkdown,
        pictureAssetId: updated.pictureAssetId,
        version: updated.version,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    };
    ProfileUpdatedEventSchema.parse(event);
    await tx
      .insert(outboxEvents)
      .values({
        id: event.eventId,
        subject: event.eventType,
        aggregateId: profile.id,
        payload: event,
      });
    return owner;
  }

  private async findOwnerProfile(userId: string): Promise<OwnerProfile | undefined> {
    return this.database.getClient().db.transaction(async (tx) => {
      // Keep the Profile and its claims at one version while assembling owner state.
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for('share');
      return profile ? this.ownerProfile(profile, tx) : undefined;
    });
  }

  private async ownerProfile(profile: Profile, reader: ProfileReader): Promise<OwnerProfile> {
    const aliases = await reader.query.handleClaims.findMany({
      where: and(eq(handleClaims.profileId, profile.id), eq(handleClaims.kind, 'alias')),
      columns: { handle: true, claimGeneration: true, createdAt: true, expiresAt: true },
      orderBy: [handleClaims.createdAt, handleClaims.handle],
    });
    return {
      ...profile,
      retainedAliasLimit: this.config.profileRetainedAliasLimit,
      aliases: aliases.map((alias) => ({
        ...alias,
        createdAt: alias.createdAt.toISOString(),
        expiresAt: alias.expiresAt?.toISOString() ?? null,
      })),
    };
  }

  async updateDisplayName(
    userId: string,
    requestedDisplayName: string,
    expectedVersion: number
  ): Promise<OwnerProfile> {
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
      const [current] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for('update');
      if (!current || current.version !== expectedVersion) {
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      }
      if (current.displayName === displayName) return this.ownerProfile(current, tx);

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

      const owner = await this.ownerProfile(updated, tx);
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
          aliases: owner.aliases,
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
      return owner;
    });
  }

  private hash(value: string): number {
    let hash = 0;
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash;
  }
}
