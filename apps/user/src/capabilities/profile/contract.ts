import { Context, type Effect, Schema } from 'effect';

/** The authenticated actor. The owner is derived from this value, never a command field. */
export interface ProfilePrincipal {
  readonly profileId: string;
}

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
  id: string;
  displayName: string;
  handle: string;
  biographyMarkdown: string;
  pictureAssetId: string | null;
  version: number;
  lastHandleChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

export interface AliasClaimReference {
  profileId: string;
  handle: string;
  claimGeneration: number;
}

export type RejectionReason =
  | 'unauthorized'
  | 'invalid-display-name'
  | 'invalid-biography'
  | 'unavailable-biography-wallpaper'
  | 'invalid-handle'
  | 'invalid-alias-command'
  | 'ineligible-handle'
  | 'alias-limit'
  | 'alias-not-found'
  | 'alias-not-scheduled'
  | 'handle-unavailable'
  | 'handle-cooldown'
  | 'version-conflict'
  | 'picture-unavailable';

export interface ProfileRejection {
  readonly _tag: 'Rejected';
  readonly reason: RejectionReason;
  readonly message: string;
  readonly retryable?: boolean;
  readonly nextHandleChangeAt?: Date;
}

export type ProfileOutcome =
  | { readonly _tag: 'Success'; readonly profile: OwnerProfile }
  | ProfileRejection;

export class ProfileUnavailable extends Schema.TaggedError<ProfileUnavailable>()(
  'ProfileUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}

export interface ExternalIdentity {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl?: string | null;
}

export interface Identities {
  getIdentity(profileId: string): Effect.Effect<ExternalIdentity, ProfileUnavailable>;
}

export const Identities = Context.Service<Identities>('wallpaperdb.user.profile.Identities');

export interface CreateProfile {
  profileId: string;
  displayName: string;
  handle: string;
  imageUrl: string | null;
  now: Date;
}

export interface PictureAsset {
  readonly id: string;
  readonly profileId: string;
  readonly state: string;
  readonly expiresAt: Date | null;
}

export interface ProfileSnapshot {
  readonly profile: OwnerProfile;
  readonly observedAt: Date;
  readonly targetClaim: {
    profileId: string;
    kind: string;
    claimGeneration: number;
    expiresAt: Date | null;
  } | null;
  readonly eligibleHandles: readonly string[];
  readonly wallpaperOwners: readonly { wallpaperId: string; profileId: string }[];
  readonly asset: PictureAsset | null;
  readonly importJob: {
    status: 'pending' | 'retrying' | 'complete';
    leaseToken: string | null;
  } | null;
}

export type ProfileMutation =
  | { type: 'details'; displayName: string; biographyMarkdown: string }
  | {
      type: 'handle';
      handle: string;
      scheduledAliases: Array<{ handle: string; expiresAt: string }>;
    }
  | { type: 'reactivate'; handle: string; before: string | null }
  | { type: 'schedule'; handle: string; expiresAt: Date }
  | {
      type: 'expire';
      handle: string;
      claimGeneration: number;
      before: string;
      reason: 'scheduled' | 'immediate';
    }
  | { type: 'picture'; asset: PictureAsset | null; source: 'clerk-import' | 'upload' | 'remove' };

export type ProfileDecision =
  | ProfileRejection
  | { readonly _tag: 'Unchanged' }
  | { readonly _tag: 'Change'; readonly mutation: ProfileMutation };

export interface ProfileQuery {
  readonly profileId: string;
  readonly now: Date;
  readonly handle?: string;
  readonly wallpaperIds?: readonly string[];
  readonly assetId?: string | null;
}

/**
 * A locked owner snapshot and a pure decision form one transaction. observedAt
 * is captured after acquiring the transaction locks and is never before query.now. The adapter
 * commits each accepted transition with its handle claims, picture state and
 * durable event. A rejected or unchanged decision writes nothing. A handle
 * conflict is a rejection; unrelated persistence failures are typed failures.
 * The decision must not escape its scope or perform external effects.
 */
export interface ProfileStore {
  read(profileId: string, now: Date): Effect.Effect<OwnerProfile | null, ProfileUnavailable>;
  create(input: CreateProfile): Effect.Effect<OwnerProfile | null, ProfileUnavailable>;
  transact(
    query: ProfileQuery,
    decide: (snapshot: ProfileSnapshot) => ProfileDecision
  ): Effect.Effect<{ outcome: ProfileOutcome; changed: boolean }, ProfileUnavailable>;
}

export const ProfileStore = Context.Service<ProfileStore>('wallpaperdb.user.profile.ProfileStore');

export interface Profiles {
  ensure(principal: ProfilePrincipal): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  adoptPicture(
    principal: ProfilePrincipal,
    assetId: string | null,
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  adoptImportedPicture(
    lease: { profileId: string; leaseToken: string },
    assetId: string | null
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  changeHandle(
    principal: ProfilePrincipal,
    requestedHandle: string,
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  reactivateAlias(
    principal: ProfilePrincipal,
    requestedHandle: string,
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  scheduleAliasExpiry(
    principal: ProfilePrincipal,
    requestedHandle: string,
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  expireAliasImmediately(
    principal: ProfilePrincipal,
    requestedHandle: string,
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
  expireDueAlias(
    reference: AliasClaimReference,
    now: Date
  ): Effect.Effect<boolean, ProfileUnavailable>;
  updateDetails(
    principal: ProfilePrincipal,
    changes: { displayName?: string; biographyMarkdown?: string },
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome, ProfileUnavailable>;
}

export const Profiles = Context.Service<Profiles>('wallpaperdb.user.profile.Profiles');
