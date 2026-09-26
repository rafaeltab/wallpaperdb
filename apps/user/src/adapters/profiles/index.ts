import { PROFILE_CREATED_SUBJECT, ProfileCreatedEventSchema, type ProfileCreatedEvent, PROFILE_UPDATED_SUBJECT, ProfileUpdatedEventSchema, type ProfileUpdatedEvent } from '@wallpaperdb/events';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { ulid } from 'ulid';
import { handleClaims, outboxEvents, profiles, profilePictureAssets, profilePictureImports, wallpaperOwnership } from '../../db/schema.js';
import { ProfileStore, ProfileUnavailable, reject, versionConflict, type Profile, type OwnerProfile, type ProfilePolicy, type ProfileOutcome, type ProfileMutation } from '../../profile/index.js';
import { Database } from '../database/index.js';
import { recentHistoricalHandles, type ProfileReader } from './history.js';

type Db = Parameters<Parameters<Database['run']>[0]>[0];
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
const retentionMs = (policy: ProfilePolicy) => policy.profileEvidenceRetentionDays * 86400000;
function uniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && error.cause !== error && uniqueViolation(error.cause);
}
async function aliases(reader: ProfileReader, profileId: string): Promise<OwnerProfile['aliases']> {
  const claims = await reader.query.handleClaims.findMany({ where: and(eq(handleClaims.profileId, profileId), eq(handleClaims.kind, 'alias')), columns: { handle: true, claimGeneration: true, createdAt: true, expiresAt: true }, orderBy: [handleClaims.createdAt, handleClaims.handle] });
  return claims.map(claim => ({ ...claim, createdAt: claim.createdAt.toISOString(), expiresAt: claim.expiresAt?.toISOString() ?? null }));
}
async function ownerProfile(reader: ProfileReader, profile: Profile, policy: ProfilePolicy, now: Date): Promise<OwnerProfile> {
  const pictureImport = await reader.query.profilePictureImports.findFirst({ where: eq(profilePictureImports.profileId, profile.id), columns: { status: true } });
  const activeAliases = await aliases(reader, profile.id);
  const retained = new Set(activeAliases.filter(alias => alias.expiresAt === null).map(alias => alias.handle));
  const history = (await recentHistoricalHandles(reader, profile.id, now, retentionMs(policy))).filter(entry => entry.handle !== profile.handle && !retained.has(entry.handle));
  const claims = history.length ? await reader.query.handleClaims.findMany({ where: inArray(handleClaims.handle, history.map(entry => entry.handle)), columns: { handle: true, profileId: true } }) : [];
  const claimed = new Set(claims.filter(claim => claim.profileId !== profile.id).map(claim => claim.handle));
  return { ...profile, biographyMaxLength: policy.profileBiographyMaxLength, retainedAliasLimit: policy.profileRetainedAliasLimit, pictureImportStatus: pictureImport?.status ?? 'complete', pictureUploadLimits: { maxBytes: policy.profilePictureMaxBytes, maxPixels: policy.profilePictureMaxPixels, maxDecodedBytes: policy.profilePictureMaxDecodedBytes }, aliases: activeAliases, historicalHandles: history.map(entry => ({ ...entry, unavailableReason: claimed.has(entry.handle) ? 'claimed' : retained.size >= policy.profileRetainedAliasLimit ? 'alias-limit' : null })) };
}
async function appendEvent(tx: Transaction, profile: Profile, change: ProfileUpdatedEvent['change'] | { type: 'created' }, now: Date) {
  const claim = await tx.query.handleClaims.findFirst({ where: and(eq(handleClaims.handle, profile.handle), eq(handleClaims.profileId, profile.id), eq(handleClaims.kind, 'profile')) });
  if (!claim) throw new Error('Current Profile Handle claim is missing');
  const snapshot = { id: profile.id, displayName: profile.displayName, handle: profile.handle, claimGeneration: claim.claimGeneration, aliases: await aliases(tx, profile.id), biographyMarkdown: profile.biographyMarkdown, pictureAssetId: profile.pictureAssetId, version: profile.version, createdAt: profile.createdAt.toISOString(), updatedAt: profile.updatedAt.toISOString() };
  const occurrence = { eventId: `evt_${ulid()}`, timestamp: now.toISOString(), profile: snapshot };
  const event: ProfileCreatedEvent | ProfileUpdatedEvent = change.type === 'created' ? ProfileCreatedEventSchema.parse({ ...occurrence, eventType: PROFILE_CREATED_SUBJECT, change }) : ProfileUpdatedEventSchema.parse({ ...occurrence, eventType: PROFILE_UPDATED_SUBJECT, change });
  await tx.insert(outboxEvents).values({ id: event.eventId, subject: event.eventType, aggregateId: profile.id, payload: event, createdAt: now });
}

export const profileStoreLayer = (policy: ProfilePolicy) => Layer.effect(ProfileStore, Effect.gen(function* () {
  const database = yield* Database;
  const operation = <A>(name: string, use: (db: Db) => Promise<A>) => Effect.tryPromise({ try: signal => database.run(use, signal), catch: cause => new ProfileUnavailable({ operation: name, cause }) });
  const adapter: ProfileStore = {
    read: (profileId, now) => operation('read-profile', db => db.transaction(async tx => {
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, profileId)).for('share');
      return profile ? ownerProfile(tx, profile, policy, now) : null;
    })),
    create: input => operation('create-profile', async db => {
      try {
        return await db.transaction(async tx => {
          const [raced] = await tx.select().from(profiles).where(eq(profiles.id, input.profileId)).for('share');
          if (raced) return ownerProfile(tx, raced, policy, input.now);
          const [profile] = await tx.insert(profiles).values({ id: input.profileId, displayName: input.displayName, handle: input.handle, version: 1, createdAt: input.now, updatedAt: input.now }).returning();
          if (!profile) throw new Error('Profile insert returned no row');
          await tx.insert(handleClaims).values({ handle: input.handle, profileId: input.profileId, kind: 'profile' });
          if (input.imageUrl) await tx.insert(profilePictureImports).values({ profileId: input.profileId, sourceUrl: input.imageUrl, createdAt: input.now, nextAttemptAt: input.now });
          await appendEvent(tx, profile, { type: 'created' }, input.now);
          return ownerProfile(tx, profile, policy, input.now);
        });
      } catch (cause) { if (uniqueViolation(cause)) return null; throw cause; }
    }),
    transact: (query, decide) => operation('transition-profile', async db => {
      try {
        return await db.transaction(async tx => {
          const [current] = await tx.select().from(profiles).where(eq(profiles.id, query.profileId)).for('update');
          if (!current) return { outcome: versionConflict(), changed: false };
          const profile = await ownerProfile(tx, current, policy, query.now);
          const targetClaim = query.handle ? await tx.query.handleClaims.findFirst({ where: eq(handleClaims.handle, query.handle) }) : null;
          const wallpaperOwners = query.wallpaperIds?.length ? await tx.query.wallpaperOwnership.findMany({ where: inArray(wallpaperOwnership.wallpaperId, [...query.wallpaperIds]) }) : [];
          const [importJob] = await tx.select().from(profilePictureImports).where(eq(profilePictureImports.profileId, query.profileId)).for('update');
          const [asset] = query.assetId ? await tx.select().from(profilePictureAssets).where(eq(profilePictureAssets.id, query.assetId)).for('update') : [];
          const eligibleHandles = (await recentHistoricalHandles(tx, current.id, query.now, retentionMs(policy))).map(entry => entry.handle);
          const decision = decide({ profile, eligibleHandles, targetClaim: targetClaim ?? null, wallpaperOwners, asset: asset ?? null, importJob: importJob ?? null });
          if (decision._tag === 'Rejected') return { outcome: decision, changed: false };
          if (decision._tag === 'Unchanged') return { outcome: { _tag: 'Success', profile } satisfies ProfileOutcome, changed: false };
          const { updated, change } = await applyMutation(tx, current, decision.mutation, query.now, policy);
          await appendEvent(tx, updated, change, query.now);
          return { outcome: { _tag: 'Success', profile: await ownerProfile(tx, updated, policy, query.now) } satisfies ProfileOutcome, changed: true };
        });
      } catch (cause) {
        if (cause instanceof ClaimConflict || uniqueViolation(cause)) return { outcome: reject('handle-unavailable', 'This Handle is already in use; choose another name'), changed: false };
        throw cause;
      }
    }),
  };
  return adapter;
}));

class ClaimConflict extends Error {}
async function applyMutation(tx: Transaction, current: Profile, mutation: ProfileMutation, now: Date, policy: ProfilePolicy): Promise<{ updated: Profile; change: ProfileUpdatedEvent['change'] }> {
  const changes: Partial<Profile> = { version: current.version + 1, updatedAt: now };
  let change: ProfileUpdatedEvent['change'];
  switch (mutation.type) {
    case 'details':
      changes.displayName = mutation.displayName;
      changes.biographyMarkdown = mutation.biographyMarkdown;
      change = current.displayName !== mutation.displayName && current.biographyMarkdown !== mutation.biographyMarkdown
        ? { type: 'profile-details-changed', before: { displayName: current.displayName, biographyMarkdown: current.biographyMarkdown }, after: { displayName: mutation.displayName, biographyMarkdown: mutation.biographyMarkdown } }
        : current.biographyMarkdown !== mutation.biographyMarkdown ? { type: 'biography-changed', before: current.biographyMarkdown, after: mutation.biographyMarkdown }
        : { type: 'display-name-changed', before: current.displayName, after: mutation.displayName };
      break;
    case 'handle': {
      changes.handle = mutation.handle;
      changes.lastHandleChangedAt = now;
      const [claim] = await tx.insert(handleClaims).values({ handle: mutation.handle, profileId: current.id, kind: 'profile' }).onConflictDoUpdate({ target: handleClaims.handle, set: { kind: 'profile', claimGeneration: sql`excluded.claim_generation`, createdAt: now, expiresAt: null }, setWhere: and(eq(handleClaims.profileId, current.id), eq(handleClaims.kind, 'alias')) }).returning();
      if (!claim) throw new ClaimConflict();
      await tx.update(handleClaims).set({ kind: 'alias', createdAt: now, expiresAt: null }).where(eq(handleClaims.handle, current.handle));
      for (const scheduled of mutation.scheduledAliases) await tx.update(handleClaims).set({ expiresAt: new Date(scheduled.expiresAt) }).where(and(eq(handleClaims.handle, scheduled.handle), eq(handleClaims.profileId, current.id)));
      change = { type: 'handle-changed', before: current.handle, after: mutation.handle, scheduledAliases: mutation.scheduledAliases };
      break;
    }
    case 'reactivate': {
      const [claim] = await tx.insert(handleClaims).values({ handle: mutation.handle, profileId: current.id, kind: 'alias', createdAt: now }).onConflictDoUpdate({ target: handleClaims.handle, set: { createdAt: now, expiresAt: null }, setWhere: and(eq(handleClaims.profileId, current.id), eq(handleClaims.kind, 'alias')) }).returning();
      if (!claim) throw new ClaimConflict();
      change = { type: 'alias-reactivated', handle: mutation.handle, claimGeneration: claim.claimGeneration, before: mutation.before, after: null };
      break;
    }
    case 'schedule':
      await tx.update(handleClaims).set({ expiresAt: mutation.expiresAt }).where(and(eq(handleClaims.handle, mutation.handle), eq(handleClaims.profileId, current.id), eq(handleClaims.kind, 'alias')));
      change = { type: 'alias-expiry-scheduled', handle: mutation.handle, before: null, after: mutation.expiresAt.toISOString() };
      break;
    case 'expire':
      await tx.delete(handleClaims).where(and(eq(handleClaims.handle, mutation.handle), eq(handleClaims.profileId, current.id), eq(handleClaims.kind, 'alias'), eq(handleClaims.claimGeneration, mutation.claimGeneration)));
      change = { type: 'alias-expired', handle: mutation.handle, claimGeneration: mutation.claimGeneration, before: mutation.before, after: null, reason: mutation.reason };
      break;
    case 'picture': {
      changes.pictureAssetId = mutation.asset?.id ?? null;
      if (current.pictureAssetId) await tx.update(profilePictureAssets).set({ state: 'retired', retiredAt: now, expiresAt: new Date(now.getTime() + retentionMs(policy)) }).where(and(eq(profilePictureAssets.id, current.pictureAssetId), eq(profilePictureAssets.profileId, current.id)));
      if (mutation.asset) await tx.update(profilePictureAssets).set({ state: 'active', expiresAt: null }).where(and(eq(profilePictureAssets.id, mutation.asset.id), eq(profilePictureAssets.profileId, current.id)));
      await tx.update(profilePictureImports).set({ status: 'complete', sourceUrl: null, leaseToken: null, leaseUntil: null }).where(eq(profilePictureImports.profileId, current.id));
      const asset = mutation.asset;
      change = { type: 'picture-changed', before: current.pictureAssetId, after: changes.pictureAssetId, source: mutation.source, asset: asset ? { id: asset.id, storageBucket: asset.storageBucket, storageKey: asset.storageKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, fileSizeBytes: asset.fileSizeBytes } : null };
      break;
    }
  }
  const [updated] = await tx.update(profiles).set(changes).where(eq(profiles.id, current.id)).returning();
  if (!updated) throw new Error('Locked Profile disappeared');
  return { updated, change };
}
