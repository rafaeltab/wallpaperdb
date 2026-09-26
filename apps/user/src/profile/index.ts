import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { ulid } from 'ulid';

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
}
export const Profiles = Context.Service<Profiles>('wallpaperdb.user.profile.Profiles');

const reserved = new Set(['admin','api','color-extractor','documentation','docs','gateway','graphql','help','health','ingestor','login','media','openapi','profile','profiles','ready','security','settings','sign-in','sign-up','sso-callback','support','tags','upload','user','variant-generator','wallpapers']);
export function reject(reason: RejectionReason, message: string): ProfileRejection { return { _tag: 'Rejected', reason, message }; }
function normalizeName(value: string) { return value.replace(/\s+/gu, ' ').trim(); }
function slugify(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function hash(value: string) { let result = 0; for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0; return result; }
function collisionHandle(base: string, maximumLength: number) {
  const random = ulid().slice(-Math.min(6, Math.max(1, maximumLength - 2))).toLowerCase();
  if (maximumLength === 1) return random;
  if (maximumLength === 2) return `${base.slice(0, 1)}${random}`;
  return `${base.slice(0, maximumLength - random.length - 1).replace(/-+$/g, '')}-${random}`;
}
export const profilesLayer = (policy: ProfilePolicy) => Layer.effect(Profiles, Effect.gen(function* () {
  const store = yield* ProfileStore;
  const identities = yield* Identities;
  return Profiles.of({
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
        const handle = attempt === 0 ? base.slice(0, policy.profileHandleMaxLength).replace(/-+$/g, '') : collisionHandle(base, policy.profileHandleMaxLength);
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
