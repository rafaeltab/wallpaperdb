import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
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
import {
  handleClaims,
  outboxEvents,
  type Profile,
  profiles,
  profilePictureAssets,
  profilePictureImports,
  wallpaperOwnership,
} from '../db/schema.js';
import {
  type ExternalIdentity,
  type IdentityProvider,
  IdentityProviderToken,
} from './clerk-identity.service.js';

import { type ProfileReader, recentHistoricalHandles } from './profile-history.js';
import { profileEvidenceRetentionMs } from './profile-retention-policy.js';

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
  biographyMaxLength: number;
  pictureImportStatus: 'pending' | 'retrying' | 'complete';
  pictureUploadLimits: { maxBytes: number; maxPixels: number; maxDecodedBytes: number };
  aliases: Array<{
    handle: string;
    claimGeneration: number;
    createdAt: string;
    expiresAt: string | null;
  }>;
  retainedAliasLimit: number;
  historicalHandles: Array<{
    handle: string;
    eligibleUntil: string;
    unavailableReason: null | 'claimed' | 'alias-limit';
  }>;
}

export class IdentityUnavailableError extends Error {}
export class InvalidDisplayNameError extends Error {}
export class InvalidBiographyError extends Error {}
export class UnavailableBiographyWallpaperError extends Error {
  constructor(readonly retryable: boolean) {
    super(
      retryable
        ? 'A referenced wallpaper is not available yet. Check the ID or wait for publication and try again.'
        : 'Biography images must be published wallpapers owned by this Profile.'
    );
  }
}
export class InvalidHandleError extends Error {}
export class InvalidAliasCommandError extends Error {}
export class IneligibleHandleError extends Error {}
export class AliasLimitError extends Error {}
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

          if (identity.imageUrl)
            await tx.insert(profilePictureImports).values({
              profileId: userId,
              sourceUrl: identity.imageUrl,
              createdAt: now,
              nextAttemptAt: now,
            });

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
            createdAt: now,
          });
          return this.ownerProfile(profile, tx, [], now);
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
        const aliases = await this.profileAliases(updated, tx);
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
            aliases,
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
          createdAt: now,
        });
        return this.ownerProfile(updated, tx, aliases, now);
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error))
          throw new HandleUnavailableError('This Handle is already in use; choose another name');
        throw error;
      });
  }

  async reactivateAlias(
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
      if (current.handle === handle)
        throw new InvalidAliasCommandError('Your current Handle cannot also be an alias');
      const now = new Date();
      const history = await recentHistoricalHandles(tx, userId, now, profileEvidenceRetentionMs(this.config));
      if (!history.some((entry) => entry.handle === handle)) {
        throw new IneligibleHandleError('This Handle is outside your retained Profile history');
      }
      const existing = await tx.query.handleClaims.findFirst({
        where: eq(handleClaims.handle, handle),
      });
      if (existing && (existing.profileId !== userId || existing.kind !== 'alias')) {
        throw new HandleUnavailableError('This Handle is already claimed');
      }
      if (existing && !existing.expiresAt) return this.ownerProfile(current, tx);
      const retained = await tx.query.handleClaims.findMany({
        where: and(
          eq(handleClaims.profileId, userId),
          eq(handleClaims.kind, 'alias'),
          isNull(handleClaims.expiresAt)
        ),
        columns: { handle: true },
      });
      if (retained.length >= this.config.profileRetainedAliasLimit) {
        throw new AliasLimitError('No retained alias slot is available');
      }
      const [alias] = existing
        ? await tx
            .update(handleClaims)
            .set({ expiresAt: null, createdAt: now })
            .where(eq(handleClaims.handle, handle))
            .returning()
        : await tx
            .insert(handleClaims)
            .values({ handle, profileId: userId, kind: 'alias', createdAt: now })
            .onConflictDoNothing()
            .returning();
      if (!alias) throw new HandleUnavailableError('This Handle is already claimed');
      const [updated] = await tx
        .update(profiles)
        .set({ version: sql`${profiles.version} + 1`, updatedAt: now })
        .where(eq(profiles.id, userId))
        .returning();
      const claim = await tx.query.handleClaims.findFirst({
        where: eq(handleClaims.handle, current.handle),
      });
      if (!claim) throw new Error('Current Profile Handle claim is missing');
      const aliases = await this.profileAliases(updated, tx);
      const event: ProfileUpdatedEvent = {
        eventId: `evt_${ulid()}`,
        eventType: PROFILE_UPDATED_SUBJECT,
        timestamp: now.toISOString(),
        change: {
          type: 'alias-reactivated',
          handle,
          claimGeneration: alias.claimGeneration,
          before: existing?.expiresAt?.toISOString() ?? null,
          after: null,
        },
        profile: {
          id: updated.id,
          displayName: updated.displayName,
          handle: updated.handle,
          claimGeneration: claim.claimGeneration,
          aliases,
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
        createdAt: now,
      });
      return this.ownerProfile(updated, tx, aliases, now);
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
      const aliases = await this.profileAliases(updated, tx);
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
          aliases,
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
        createdAt: now,
      });
      return this.ownerProfile(updated, tx, aliases, now);
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
    const aliases = await this.profileAliases(updated, tx);
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
        aliases,
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
      aggregateId: profile.id,
      payload: event,
      createdAt: now,
    });
    return this.ownerProfile(updated, tx, aliases, now);
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

  private async profileAliases(
    profile: Profile,
    reader: ProfileReader
  ): Promise<OwnerProfile['aliases']> {
    const aliases = await reader.query.handleClaims.findMany({
      where: and(eq(handleClaims.profileId, profile.id), eq(handleClaims.kind, 'alias')),
      columns: { handle: true, claimGeneration: true, createdAt: true, expiresAt: true },
      orderBy: [handleClaims.createdAt, handleClaims.handle],
    });
    return aliases.map((alias) => ({
      ...alias,
      createdAt: alias.createdAt.toISOString(),
      expiresAt: alias.expiresAt?.toISOString() ?? null,
    }));
  }

  private async ownerProfile(
    profile: Profile,
    reader: ProfileReader,
    aliases?: OwnerProfile['aliases'],
    now = new Date()
  ): Promise<OwnerProfile> {
    const pictureImport = await reader.query.profilePictureImports.findFirst({
      where: eq(profilePictureImports.profileId, profile.id),
      columns: { status: true },
    });
    const activeAliases = aliases ?? (await this.profileAliases(profile, reader));
    const retained = new Set(
      activeAliases.filter((alias) => alias.expiresAt === null).map((alias) => alias.handle)
    );
    const history = await recentHistoricalHandles(reader, profile.id, now, profileEvidenceRetentionMs(this.config));
    const historicalHandles = history.filter(
      ({ handle }) => handle !== profile.handle && !retained.has(handle)
    );
    const claims =
      historicalHandles.length > 0
        ? await reader.query.handleClaims.findMany({
            where: inArray(
              handleClaims.handle,
              historicalHandles.map(({ handle }) => handle)
            ),
            columns: { handle: true, profileId: true },
          })
        : [];
    const claimedByOthers = new Set(
      claims.filter((claim) => claim.profileId !== profile.id).map((claim) => claim.handle)
    );
    return {
      ...profile,
      retainedAliasLimit: this.config.profileRetainedAliasLimit,
      biographyMaxLength: this.config.profileBiographyMaxLength,
      aliases: activeAliases,
      pictureImportStatus: pictureImport?.status ?? 'complete',
      pictureUploadLimits: this.pictureUploadLimits(),
      historicalHandles: historicalHandles.map((entry) => ({
        ...entry,
        unavailableReason: claimedByOthers.has(entry.handle)
          ? 'claimed'
          : retained.size >= this.config.profileRetainedAliasLimit
            ? 'alias-limit'
            : null,
      })),
    };
  }

  private pictureUploadLimits(): OwnerProfile['pictureUploadLimits'] {
    return {
      maxBytes: this.config.profilePictureMaxBytes,
      maxPixels: this.config.profilePictureMaxPixels,
      maxDecodedBytes: this.config.profilePictureMaxDecodedBytes,
    };
  }

  async adoptPicture(
    userId: string,
    assetId: string | null,
    expectedVersion: number | undefined,
    importLeaseToken?: string
  ): Promise<OwnerProfile> {
    return this.database.getClient().db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for('update');
      if (!current)
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      const [job] = await tx
        .select()
        .from(profilePictureImports)
        .where(eq(profilePictureImports.profileId, userId))
        .for('update');
      if (importLeaseToken) {
        if (
          !job ||
          job.leaseToken !== importLeaseToken ||
          job.status === 'complete' ||
          current.pictureAssetId !== null
        )
          return this.ownerProfile(current, tx);
      } else if (current.version !== expectedVersion)
        throw new ProfileVersionConflictError('Profile has changed since it was last loaded');
      if (current.pictureAssetId === assetId && (!job || job.status === 'complete'))
        return this.ownerProfile(current, tx);
      const asset = assetId
        ? await tx.query.profilePictureAssets.findFirst({
            where: and(
              eq(profilePictureAssets.id, assetId),
              eq(profilePictureAssets.profileId, userId),
              eq(profilePictureAssets.state, 'staged')
            ),
          })
        : null;
      if (assetId && !asset) throw new Error('Staged Profile picture is missing');
      const now = new Date();
      if (current.pictureAssetId) {
        await tx
          .update(profilePictureAssets)
          .set({
            state: 'retired',
            retiredAt: now,
            expiresAt: new Date(now.getTime() + profileEvidenceRetentionMs(this.config)),
          })
          .where(eq(profilePictureAssets.id, current.pictureAssetId));
      }
      if (assetId)
        await tx
          .update(profilePictureAssets)
          .set({ state: 'active', expiresAt: null })
          .where(eq(profilePictureAssets.id, assetId));
      if (job)
        await tx
          .update(profilePictureImports)
          .set({ status: 'complete', sourceUrl: null, leaseToken: null, leaseUntil: null })
          .where(eq(profilePictureImports.profileId, userId));
      const [updated] = await tx
        .update(profiles)
        .set({ pictureAssetId: assetId, version: current.version + 1, updatedAt: now })
        .where(eq(profiles.id, userId))
        .returning();
      const claim = await tx.query.handleClaims.findFirst({
        where: eq(handleClaims.handle, updated.handle),
      });
      if (!claim) throw new Error('Current Profile Handle claim is missing');
      const aliases = await this.profileAliases(updated, tx);
      const event: ProfileUpdatedEvent = {
        eventId: `evt_${ulid()}`,
        eventType: PROFILE_UPDATED_SUBJECT,
        timestamp: now.toISOString(),
        change: {
          type: 'picture-changed',
          before: current.pictureAssetId,
          after: assetId,
          source: importLeaseToken ? 'clerk-import' : assetId ? 'upload' : 'remove',
          asset: asset
            ? {
                id: asset.id,
                storageBucket: asset.storageBucket,
                storageKey: asset.storageKey,
                mimeType: asset.mimeType,
                width: asset.width,
                height: asset.height,
                fileSizeBytes: asset.fileSizeBytes,
              }
            : null,
        },
        profile: {
          id: updated.id,
          displayName: updated.displayName,
          handle: updated.handle,
          claimGeneration: claim.claimGeneration,
          aliases,
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
        createdAt: now,
      });
      return this.ownerProfile(updated, tx, aliases, now);
    });
  }

  async updateDisplayName(
    userId: string,
    displayName: string,
    expectedVersion: number
  ): Promise<OwnerProfile> {
    return this.updateDetails(userId, { displayName }, expectedVersion);
  }

  async updateDetails(
    userId: string,
    changes: { displayName?: string; biographyMarkdown?: string },
    expectedVersion: number
  ): Promise<OwnerProfile> {
    const displayName =
      changes.displayName === undefined ? undefined : normalizeDisplayName(changes.displayName);
    if (displayName !== undefined) {
      if (!displayName) throw new InvalidDisplayNameError('Display name must not be blank');
      if ([...displayName].length > this.config.profileDisplayNameMaxLength)
        throw new InvalidDisplayNameError(
          `Display name must be at most ${this.config.profileDisplayNameMaxLength} characters`
        );
    }
    const biographyMarkdown = changes.biographyMarkdown;
    let wallpaperIds: string[] = [];
    if (biographyMarkdown !== undefined) {
      const validation = validateProfileMarkdown(biographyMarkdown, {
        maxCharacters: this.config.profileBiographyMaxLength,
      });
      if (!validation.valid)
        throw new InvalidBiographyError(
          validation.errors[0]?.message ?? 'Biography Markdown is invalid'
        );
      wallpaperIds = validation.wallpaperIds;
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
      if (
        (displayName === undefined || current.displayName === displayName) &&
        (biographyMarkdown === undefined || current.biographyMarkdown === biographyMarkdown)
      )
        return this.ownerProfile(current, tx);
      if (biographyMarkdown !== current.biographyMarkdown && wallpaperIds.length > 0) {
        const published = await tx.query.wallpaperOwnership.findMany({
          where: inArray(wallpaperOwnership.wallpaperId, wallpaperIds),
        });
        if (published.some((wallpaper) => wallpaper.profileId !== userId))
          throw new UnavailableBiographyWallpaperError(false);
        if (published.length !== wallpaperIds.length)
          throw new UnavailableBiographyWallpaperError(true);
      }

      const now = new Date();
      const [updated] = await tx
        .update(profiles)
        .set({
          displayName: displayName ?? current.displayName,
          biographyMarkdown: biographyMarkdown ?? current.biographyMarkdown,
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

      const aliases = await this.profileAliases(updated, tx);
      const event: ProfileUpdatedEvent = {
        eventId: `evt_${ulid()}`,
        eventType: PROFILE_UPDATED_SUBJECT,
        timestamp: now.toISOString(),
        change:
          current.displayName !== updated.displayName &&
          current.biographyMarkdown !== updated.biographyMarkdown
            ? {
                type: 'profile-details-changed',
                before: {
                  displayName: current.displayName,
                  biographyMarkdown: current.biographyMarkdown,
                },
                after: {
                  displayName: updated.displayName,
                  biographyMarkdown: updated.biographyMarkdown,
                },
              }
            : current.biographyMarkdown !== updated.biographyMarkdown
              ? {
                  type: 'biography-changed',
                  before: current.biographyMarkdown,
                  after: updated.biographyMarkdown,
                }
              : {
                  type: 'display-name-changed',
                  before: current.displayName,
                  after: updated.displayName,
                },
        profile: {
          id: updated.id,
          displayName: updated.displayName,
          handle: updated.handle,
          claimGeneration: claim.claimGeneration,
          aliases,
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
        createdAt: now,
      });
      return this.ownerProfile(updated, tx, aliases, now);
    });
  }

  private hash(value: string): number {
    let hash = 0;
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash;
  }
}
