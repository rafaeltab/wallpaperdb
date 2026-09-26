import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import { Clock, Context, Effect, Layer, Random, Schema } from 'effect';

/** The authenticated actor. The owner is derived from this value, never a command field. */
export interface ProfilePrincipal { readonly profileId: string }
export interface ProfilePolicy {
  readonly profileHandleMinLength: number;
  readonly profileHandleMaxLength: number;
  readonly profileDisplayNameMaxLength: number;
  readonly profileBiographyMaxLength: number;
  readonly profileRetainedAliasLimit: number;
  readonly profileEvidenceRetentionDays: number;
  readonly profilePictureMaxBytes: number;
  readonly profilePictureMaxPixels: number;
  readonly profilePictureMaxDecodedBytes: number;
}
export interface Profile {
  id: string; displayName: string; handle: string; biographyMarkdown: string;
  pictureAssetId: string | null; version: number; lastHandleChangedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}
export interface OwnerProfile extends Profile {
  biographyMaxLength: number;
  pictureImportStatus: 'pending' | 'retrying' | 'complete';
  pictureUploadLimits: { maxBytes: number; maxPixels: number; maxDecodedBytes: number };
  aliases: Array<{ handle: string; claimGeneration: number; createdAt: string; expiresAt: string | null }>;
  retainedAliasLimit: number;
  historicalHandles: Array<{ handle: string; eligibleUntil: string; unavailableReason: null | 'claimed' | 'alias-limit' }>;
}
export interface AliasClaimReference { profileId: string; handle: string; claimGeneration: number }
export type RejectionReason = 'unauthorized' | 'invalid-display-name' | 'invalid-biography' | 'unavailable-biography-wallpaper' | 'invalid-handle' | 'invalid-alias-command' | 'ineligible-handle' | 'alias-limit' | 'alias-not-found' | 'alias-not-scheduled' | 'handle-unavailable' | 'handle-cooldown' | 'version-conflict' | 'picture-unavailable';
export interface ProfileRejection { readonly _tag: 'Rejected'; readonly reason: RejectionReason; readonly message: string; readonly retryable?: boolean; readonly nextHandleChangeAt?: Date }
export type ProfileOutcome = { readonly _tag: 'Success'; readonly profile: OwnerProfile } | ProfileRejection;
export class ProfileUnavailable extends Schema.TaggedError<ProfileUnavailable>()('ProfileUnavailable', { operation: Schema.String, cause: Schema.Defect() }) {}
export interface ExternalIdentity { displayName: string | null; firstName: string | null; lastName: string | null; imageUrl?: string | null }
export interface Identities { getIdentity(profileId: string): Effect.Effect<ExternalIdentity, ProfileUnavailable> }
export const Identities = Context.Service<Identities>('wallpaperdb.user.profile.Identities');
export interface CreateProfile { profileId: string; displayName: string; handle: string; imageUrl: string | null; now: Date }
export interface PictureAsset {
  id: string; profileId: string; storageBucket: string; storageKey: string; mimeType: 'image/webp';
  width: number; height: number; fileSizeBytes: number; state: string; expiresAt: Date | null;
}
export interface ProfileSnapshot {
  readonly profile: OwnerProfile;
  readonly targetClaim: { profileId: string; kind: string; claimGeneration: number; expiresAt: Date | null } | null;
  readonly eligibleHandles: readonly string[];
  readonly wallpaperOwners: readonly { wallpaperId: string; profileId: string }[];
  readonly asset: PictureAsset | null;
  readonly importJob: { status: 'pending' | 'retrying' | 'complete'; leaseToken: string | null } | null;
}
export type ProfileMutation =
  | { type: 'details'; displayName: string; biographyMarkdown: string }
  | { type: 'handle'; handle: string; scheduledAliases: Array<{ handle: string; expiresAt: string }> }
  | { type: 'reactivate'; handle: string; before: string | null }
  | { type: 'schedule'; handle: string; expiresAt: Date }
  | { type: 'expire'; handle: string; claimGeneration: number; before: string; reason: 'scheduled' | 'immediate' }
  | { type: 'picture'; asset: PictureAsset | null; source: 'clerk-import' | 'upload' | 'remove' };
export type ProfileDecision = ProfileRejection | { readonly _tag: 'Unchanged' } | { readonly _tag: 'Change'; readonly mutation: ProfileMutation };
export interface ProfileQuery { readonly profileId: string; readonly now: Date; readonly handle?: string; readonly wallpaperIds?: readonly string[]; readonly assetId?: string | null }
/**
 * A locked owner snapshot and a pure decision form one transaction. The adapter
 * commits each accepted transition with its handle claims, picture state and
 * durable event. A rejected or unchanged decision writes nothing. A handle
 * conflict is a rejection; unrelated persistence failures are typed failures.
 * The decision must not escape its scope or perform external effects.
 */
export interface ProfileStore {
  read(profileId: string, now: Date): Effect.Effect<OwnerProfile | null, ProfileUnavailable>;
  create(input: CreateProfile): Effect.Effect<OwnerProfile | null, ProfileUnavailable>;
  transact(query: ProfileQuery, decide: (snapshot: ProfileSnapshot) => ProfileDecision): Effect.Effect<{ outcome: ProfileOutcome; changed: boolean }, ProfileUnavailable>;
}
export const ProfileStore = Context.Service<ProfileStore>('wallpaperdb.user.profile.ProfileStore');
export interface Profiles {
  ensure(principal: ProfilePrincipal): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  adoptPicture(principal: ProfilePrincipal, assetId: string | null, expectedVersion: number): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  adoptImportedPicture(lease: { profileId: string; leaseToken: string }, assetId: string | null): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  changeHandle(principal: ProfilePrincipal, requestedHandle: string, expectedVersion: number): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  reactivateAlias(principal: ProfilePrincipal, requestedHandle: string, expectedVersion: number): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  scheduleAliasExpiry(principal: ProfilePrincipal, requestedHandle: string, expectedVersion: number): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  expireAliasImmediately(principal: ProfilePrincipal, requestedHandle: string, expectedVersion: number): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  expireDueAlias(reference: AliasClaimReference, now: Date): Effect.Effect<boolean, ProfileUnavailable>;
  updateDetails(principal: ProfilePrincipal, changes: { displayName?: string; biographyMarkdown?: string }, expectedVersion: number): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
}
export const Profiles = Context.Service<Profiles>('wallpaperdb.user.profile.Profiles');

const reserved = new Set(['admin','api','color-extractor','documentation','docs','gateway','graphql','help','health','ingestor','login','media','openapi','profile','profiles','ready','security','settings','sign-in','sign-up','sso-callback','support','tags','upload','user','variant-generator','wallpapers']);
export function reject(reason: RejectionReason, message: string): ProfileRejection { return { _tag: 'Rejected', reason, message }; }
export function versionConflict() { return reject('version-conflict', 'Profile has changed since it was last loaded'); }
function normalizeName(value: string) { return value.replace(/\s+/gu, ' ').trim(); }
function slugify(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function hash(value: string) { let result = 0; for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0; return result; }
function collisionHandle(base: string, maximumLength: number, entropy: number) {
  const length = Math.min(6, Math.max(1, maximumLength - 2));
  const random = entropy.toString(32).padStart(6, "0").slice(-length);
  if (maximumLength === 1) return random;
  if (maximumLength === 2) return `${base.slice(0, 1)}${random}`;
  return `${base.slice(0, maximumLength - random.length - 1).replace(/-+$/g, '')}-${random}`;
}
export const profilesLayer = (policy: ProfilePolicy) => Layer.effect(Profiles, Effect.gen(function* () {
  const store = yield* ProfileStore;
  const identities = yield* Identities;
  const adopt = Effect.fn('profiles.adopt-picture')(function* (principal: ProfilePrincipal, assetId: string | null, authorization: { type: 'owner'; expectedVersion: number } | { type: 'import'; leaseToken: string }) {
    if (!principal.profileId) return reject('unauthorized', 'Authentication is required');
    const now = new Date(yield* Clock.currentTimeMillis);
    const result = yield* store.transact({ profileId: principal.profileId, assetId, now }, ({ profile, importJob, asset }) => {
      if (authorization.type === 'import') {
        if (!authorization.leaseToken || !importJob || importJob.leaseToken !== authorization.leaseToken || importJob.status === 'complete' || profile.pictureAssetId !== null) return { _tag: 'Unchanged' };
      } else if (profile.version !== authorization.expectedVersion) return versionConflict();
      if (profile.pictureAssetId === assetId && (!importJob || importJob.status === 'complete')) return { _tag: 'Unchanged' };
      if (assetId && (!asset || asset.profileId !== principal.profileId || asset.state !== 'staged' || !asset.expiresAt || asset.expiresAt <= now)) return reject('picture-unavailable', 'The staged Profile picture is unavailable');
      return { _tag: 'Change', mutation: { type: 'picture', asset, source: authorization.type === 'import' ? 'clerk-import' : assetId ? 'upload' : 'remove' } };
    });
    return result.outcome;
  });
  const mutateAlias = Effect.fn('profiles.mutate-alias')(function* (principal: ProfilePrincipal, requestedHandle: string, expectedVersion: number, operation: 'reactivate' | 'schedule' | 'expire') {
    if (!principal.profileId) return reject('unauthorized', 'Authentication is required');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return reject('invalid-alias-command', 'Expected Profile version must be a positive integer');
    const handle = requestedHandle.toLowerCase();
    const now = new Date(yield* Clock.currentTimeMillis);
    const result = yield* store.transact({ profileId: principal.profileId, now, handle }, snapshot => {
      if (snapshot.profile.version !== expectedVersion) return versionConflict();
      return decideAlias(snapshot, handle, operation, now, policy);
    });
    return result.outcome;
  });
  const changeHandle = Effect.fn('profiles.change-handle')(function* (principal: ProfilePrincipal, requestedHandle: string, expectedVersion: number) {
    if (!principal.profileId) return reject('unauthorized', 'Authentication is required');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return reject('invalid-handle', 'Expected Profile version must be a positive integer');
    const handle = slugify(requestedHandle);
    if (handle.length < policy.profileHandleMinLength || handle.length > policy.profileHandleMaxLength) return reject('invalid-handle', `Handle must contain ${policy.profileHandleMinLength}–${policy.profileHandleMaxLength} letters, numbers, or single hyphens after normalization`);
    if (reserved.has(handle)) return reject('invalid-handle', 'This Handle is reserved; choose another name');
    const now = new Date(yield* Clock.currentTimeMillis);
    const result = yield* store.transact({ profileId: principal.profileId, now, handle }, ({ profile, targetClaim }) => {
      if (profile.version !== expectedVersion) return versionConflict();
      if (profile.handle === handle) return { _tag: 'Unchanged' };
      if (profile.lastHandleChangedAt) {
        const nextHandleChangeAt = new Date(profile.lastHandleChangedAt.getTime() + 7 * 86400000);
        if (now < nextHandleChangeAt) return { ...reject('handle-cooldown', 'You can change your Handle once every seven days'), nextHandleChangeAt };
      }
      if (targetClaim && targetClaim.profileId !== principal.profileId) return reject('handle-unavailable', 'This Handle is already in use; choose another name');
      const retained = profile.aliases.filter(alias => alias.expiresAt === null && alias.handle !== handle);
      retained.push({ handle: profile.handle, claimGeneration: 0, createdAt: now.toISOString(), expiresAt: null });
      retained.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
      const scheduledAliases = retained.slice(0, Math.max(0, retained.length - policy.profileRetainedAliasLimit)).map(alias => ({ handle: alias.handle, expiresAt: new Date(now.getTime() + 86400000).toISOString() }));
      return { _tag: 'Change', mutation: { type: 'handle', handle, scheduledAliases } };
    });
    return result.outcome;
  });
  const updateDetails = Effect.fn('profiles.update-details')(function* (principal: ProfilePrincipal, changes: { displayName?: string; biographyMarkdown?: string }, expectedVersion: number) {
    if (!principal.profileId) return reject('unauthorized', 'Authentication is required');
    const displayName = changes.displayName === undefined ? undefined : normalizeName(changes.displayName);
    if (displayName !== undefined) {
      if (!displayName) return reject('invalid-display-name', 'Display name must not be blank');
      if ([...displayName].length > policy.profileDisplayNameMaxLength) return reject('invalid-display-name', `Display name must be at most ${policy.profileDisplayNameMaxLength} characters`);
    }
    const biographyMarkdown = changes.biographyMarkdown;
    let wallpaperIds: string[] = [];
    if (biographyMarkdown !== undefined) {
      const validation = validateProfileMarkdown(biographyMarkdown, { maxCharacters: policy.profileBiographyMaxLength });
      if (!validation.valid) return reject('invalid-biography', validation.errors[0]?.message ?? 'Biography Markdown is invalid');
      wallpaperIds = validation.wallpaperIds;
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return reject('invalid-display-name', 'Expected Profile version must be a positive integer');
    const now = new Date(yield* Clock.currentTimeMillis);
    const result = yield* store.transact({ profileId: principal.profileId, now, wallpaperIds }, ({ profile, wallpaperOwners }) => {
      if (profile.version !== expectedVersion) return versionConflict();
      if ((displayName === undefined || profile.displayName === displayName) && (biographyMarkdown === undefined || profile.biographyMarkdown === biographyMarkdown)) return { _tag: 'Unchanged' };
      if (biographyMarkdown !== profile.biographyMarkdown && wallpaperIds.length > 0) {
        if (wallpaperOwners.some(wallpaper => wallpaper.profileId !== principal.profileId)) return { ...reject('unavailable-biography-wallpaper', 'Biography images must be published wallpapers owned by this Profile.'), retryable: false };
        if (wallpaperOwners.length !== wallpaperIds.length) return { ...reject('unavailable-biography-wallpaper', 'A referenced wallpaper is not available yet. Check the ID or wait for publication and try again.'), retryable: true };
      }
      return { _tag: 'Change', mutation: { type: 'details', displayName: displayName ?? profile.displayName, biographyMarkdown: biographyMarkdown ?? profile.biographyMarkdown } };
    });
    return result.outcome;
  });
  return Profiles.of({
    updateDetails,
    adoptPicture: (principal, assetId, expectedVersion) => adopt(principal, assetId, { type: 'owner', expectedVersion }),
    adoptImportedPicture: (lease, assetId) => adopt(lease, assetId, { type: 'import', leaseToken: lease.leaseToken }),
    changeHandle,
    reactivateAlias: (principal, handle, version) => mutateAlias(principal, handle, version, 'reactivate'),
    scheduleAliasExpiry: (principal, handle, version) => mutateAlias(principal, handle, version, 'schedule'),
    expireAliasImmediately: (principal, handle, version) => mutateAlias(principal, handle, version, 'expire'),
    expireDueAlias: (reference, now) => store.transact({ profileId: reference.profileId, now, handle: reference.handle }, ({ profile, targetClaim }) => {
      if (!targetClaim || targetClaim.profileId !== profile.id || targetClaim.kind !== 'alias' || targetClaim.claimGeneration !== reference.claimGeneration || !targetClaim.expiresAt || targetClaim.expiresAt > now) return { _tag: 'Unchanged' };
      return { _tag: 'Change', mutation: { type: 'expire', handle: reference.handle, claimGeneration: reference.claimGeneration, before: targetClaim.expiresAt.toISOString(), reason: 'scheduled' } };
    }).pipe(Effect.map(result => result.changed)),
    ensure: Effect.fn('profiles.ensure')(function* (principal: ProfilePrincipal) {
      if (!principal.profileId) return reject('unauthorized', 'Authentication is required');
      const now = new Date(yield* Clock.currentTimeMillis);
      const existing = yield* store.read(principal.profileId, now);
      if (existing) return { _tag: 'Success', profile: existing } as const;
      const identity = yield* identities.getIdentity(principal.profileId);
      const fullName = normalizeName([identity.firstName, identity.lastName].filter(Boolean).join(' '));
      const seed = hash(principal.profileId);
      const fallback = `${['quiet','bright','silver','wild'][seed % 4]} ${['aurora','canvas','horizon','pixel'][Math.floor(seed / 4) % 4]}`;
      const displayName = [...(normalizeName(identity.displayName ?? '') || fullName || fallback)].slice(0, policy.profileDisplayNameMaxLength).join('').trim();
      const slug = (slugify(displayName) || `profile-${seed}`).padEnd(policy.profileHandleMinLength, '0');
      const base = reserved.has(slug) ? `${slug}-profile` : slug;
      for (let attempt = 0; attempt < 100; attempt++) {
        const handle = attempt === 0 ? base.slice(0, policy.profileHandleMaxLength).replace(/-+$/g, '').padEnd(policy.profileHandleMinLength, '0') : collisionHandle(base, policy.profileHandleMaxLength, yield* Random.nextIntBetween(0, 32 ** 6));
        if (reserved.has(handle)) continue;
        const profile = yield* store.create({ profileId: principal.profileId, displayName, handle, imageUrl: identity.imageUrl ?? null, now });
        if (profile) return { _tag: 'Success', profile } as const;
        const raced = yield* store.read(principal.profileId, now);
        if (raced) return { _tag: 'Success', profile: raced } as const;
      }
      return yield* Effect.fail(new ProfileUnavailable({ operation: 'claim-initial-handle', cause: new Error('Handle attempts exhausted') }));
    }),
  });
}));

function decideAlias({ profile, targetClaim, eligibleHandles }: ProfileSnapshot, handle: string, operation: 'reactivate' | 'schedule' | 'expire', now: Date, policy: ProfilePolicy): ProfileDecision {
  if (operation === 'reactivate') {
    if (profile.handle === handle) return reject('invalid-alias-command', 'Your current Handle cannot also be an alias');
    if (!eligibleHandles.includes(handle)) return reject('ineligible-handle', 'This Handle is outside your retained Profile history');
    if (targetClaim && (targetClaim.profileId !== profile.id || targetClaim.kind !== 'alias')) return reject('handle-unavailable', 'This Handle is already claimed');
    if (targetClaim && !targetClaim.expiresAt) return { _tag: 'Unchanged' };
    if (profile.aliases.filter(alias => alias.expiresAt === null).length >= policy.profileRetainedAliasLimit) return reject('alias-limit', 'No retained alias slot is available');
    return { _tag: 'Change', mutation: { type: 'reactivate', handle, before: targetClaim?.expiresAt?.toISOString() ?? null } };
  }
  if (!targetClaim || targetClaim.profileId !== profile.id || targetClaim.kind !== 'alias') return reject('alias-not-found', 'This Handle is not one of your aliases');
  if (operation === 'schedule') {
    if (targetClaim.expiresAt) return { _tag: 'Unchanged' };
    return { _tag: 'Change', mutation: { type: 'schedule', handle, expiresAt: new Date(now.getTime() + 86400000) } };
  }
  if (!targetClaim.expiresAt) return reject('alias-not-scheduled', 'Schedule this alias for removal before expiring it immediately');
  return { _tag: 'Change', mutation: { type: 'expire', handle, claimGeneration: targetClaim.claimGeneration, before: targetClaim.expiresAt.toISOString(), reason: 'immediate' } };
}

/** Resolve all owner-facing limits and historical-handle availability in one place. */
export function describeOwnerProfile(
  profile: Profile,
  aliases: OwnerProfile['aliases'],
  history: Array<{ handle: string; eligibleUntil: string }>,
  claims: readonly { handle: string; profileId: string }[],
  pictureImportStatus: OwnerProfile['pictureImportStatus'],
  policy: ProfilePolicy
): OwnerProfile {
  const retained = new Set(aliases.filter(alias => alias.expiresAt === null).map(alias => alias.handle));
  const claimedByOthers = new Set(claims.filter(claim => claim.profileId !== profile.id).map(claim => claim.handle));
  return {
    ...profile, aliases, pictureImportStatus,
    biographyMaxLength: policy.profileBiographyMaxLength,
    retainedAliasLimit: policy.profileRetainedAliasLimit,
    pictureUploadLimits: { maxBytes: policy.profilePictureMaxBytes, maxPixels: policy.profilePictureMaxPixels, maxDecodedBytes: policy.profilePictureMaxDecodedBytes },
    historicalHandles: history.filter(entry => entry.handle !== profile.handle && !retained.has(entry.handle)).map(entry => ({ ...entry, unavailableReason: claimedByOthers.has(entry.handle) ? 'claimed' : retained.size >= policy.profileRetainedAliasLimit ? 'alias-limit' : null })),
  };
}
