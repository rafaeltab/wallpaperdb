import { Effect, Layer } from 'effect';
import {
  Identities,
  Profiles,
  ProfileStore,
  profilesLayer,
  describeOwnerProfile,
  type CreateProfile,
  type ExternalIdentity,
  type OwnerProfile,
  type Profile,
  type ProfileMutation,
  type ProfilePolicy,
  type ProfileSnapshot,
} from '../../src/profile/index.js';

export const profilePolicy: ProfilePolicy = {
  profileHandleMinLength: 1,
  profileHandleMaxLength: 20,
  profileDisplayNameMaxLength: 80,
  profileBiographyMaxLength: 5000,
  profileRetainedAliasLimit: 3,
  profileEvidenceRetentionDays: 30,
  profilePictureMaxBytes: 5242880,
  profilePictureMaxPixels: 16000000,
  profilePictureMaxDecodedBytes: 67108864,
};
type Claim = {
  profileId: string;
  kind: 'profile' | 'alias';
  claimGeneration: number;
  createdAt: Date;
  expiresAt: Date | null;
};
type RecordedTransition = {
  profileId: string;
  at: Date;
  mutation: ProfileMutation | { type: 'created'; handle: string };
};

/** One synchronous state transition is atomic. Reads return detached snapshots;
 * rejected/no-op decisions cannot change state or append an occurrence. Claims
 * share a unique namespace, and generations increase even after release.
 * History derives only from accepted Handle transitions and its strict cutoff.
 */
export function controlledProfiles(overrides: Partial<ProfilePolicy> = {}) {
  let policy = { ...profilePolicy, ...overrides };
  let generation = 0;
  const profiles = new Map<string, Profile>();
  const claims = new Map<string, Claim>();
  const identities = new Map<string, ExternalIdentity>();
  const wallpaperOwners = new Map<string, string>();
  const imports = new Map<string, NonNullable<ProfileSnapshot['importJob']>>();
  const assets = new Map<string, NonNullable<ProfileSnapshot['asset']>>();
  const transitions: RecordedTransition[] = [];
  const creations: CreateProfile[] = [];
  const identityReads: string[] = [];

  function references(transition: RecordedTransition): string[] {
    const change = transition.mutation;
    if (change.type === 'created') return [change.handle];
    if (change.type === 'handle') {
      // The previous current Handle becomes the alias created by this transition.
      const former = transitions
        .slice(0, transitions.indexOf(transition))
        .filter(
          (entry) =>
            entry.profileId === transition.profileId &&
            (entry.mutation.type === 'created' || entry.mutation.type === 'handle')
        )
        .at(-1)?.mutation;
      return [
        ...(former && 'handle' in former ? [former.handle] : []),
        change.handle,
        ...change.scheduledAliases.map((alias) => alias.handle),
      ];
    }
    return 'handle' in change ? [change.handle] : [];
  }
  function history(profileId: string, now: Date) {
    const deadlines = new Map<string, number>();
    for (const transition of transitions) {
      if (transition.profileId !== profileId || transition.at > now) continue;
      const deadline = transition.at.getTime() + policy.profileEvidenceRetentionDays * 86400000;
      if (deadline <= now.getTime()) continue;
      for (const handle of references(transition))
        deadlines.set(handle, Math.max(deadlines.get(handle) ?? 0, deadline));
    }
    return [...deadlines]
      .sort(([a, ad], [b, bd]) => bd - ad || a.localeCompare(b))
      .map(([handle, deadline]) => ({ handle, eligibleUntil: new Date(deadline).toISOString() }));
  }
  function owner(profile: Profile, now: Date): OwnerProfile {
    const aliases = [...claims]
      .filter(([, claim]) => claim.profileId === profile.id && claim.kind === 'alias')
      .sort(
        ([a, ac], [b, bc]) => ac.createdAt.getTime() - bc.createdAt.getTime() || a.localeCompare(b)
      )
      .map(([handle, claim]) => ({
        handle,
        claimGeneration: claim.claimGeneration,
        createdAt: claim.createdAt.toISOString(),
        expiresAt: claim.expiresAt?.toISOString() ?? null,
      }));
    return structuredClone(
      describeOwnerProfile(
        profile,
        aliases,
        history(profile.id, now),
        [...claims].map(([handle, claim]) => ({ handle, profileId: claim.profileId })),
        imports.get(profile.id)?.status ?? 'complete',
        policy
      )
    );
  }
  function assignClaim(profileId: string, handle: string, kind: Claim['kind'], now: Date) {
    claims.set(handle, {
      profileId,
      kind,
      claimGeneration: ++generation,
      createdAt: now,
      expiresAt: null,
    });
  }
  function requiredClaim(handle: string) {
    const claim = claims.get(handle);
    if (!claim) throw new Error(`Controlled store missing claim ${handle}`);
    return claim;
  }
  function commit(profile: Profile, mutation: ProfileMutation, now: Date) {
    switch (mutation.type) {
      case 'details':
        Object.assign(profile, {
          displayName: mutation.displayName,
          biographyMarkdown: mutation.biographyMarkdown,
        });
        break;
      case 'handle': {
        const old = requiredClaim(profile.handle);
        Object.assign(old, { kind: 'alias', createdAt: now, expiresAt: null });
        assignClaim(profile.id, mutation.handle, 'profile', now);
        for (const alias of mutation.scheduledAliases)
          requiredClaim(alias.handle).expiresAt = new Date(alias.expiresAt);
        Object.assign(profile, { handle: mutation.handle, lastHandleChangedAt: now });
        break;
      }
      case 'reactivate': {
        const existing = claims.get(mutation.handle);
        if (existing) Object.assign(existing, { createdAt: now, expiresAt: null });
        else assignClaim(profile.id, mutation.handle, 'alias', now);
        break;
      }
      case 'schedule':
        requiredClaim(mutation.handle).expiresAt = mutation.expiresAt;
        break;
      case 'expire':
        claims.delete(mutation.handle);
        break;
      case 'picture': {
        if (profile.pictureAssetId) {
          const previous = assets.get(profile.pictureAssetId);
          if (previous)
            assets.set(previous.id, {
              ...previous,
              state: 'retired',
              expiresAt: new Date(now.getTime() + policy.profileEvidenceRetentionDays * 86400000),
            });
        }
        if (mutation.asset)
          assets.set(mutation.asset.id, { ...mutation.asset, state: 'active', expiresAt: null });
        profile.pictureAssetId = mutation.asset?.id ?? null;
        if (imports.has(profile.id))
          imports.set(profile.id, { status: 'complete', leaseToken: null });
        break;
      }
    }
    profile.version++;
    profile.updatedAt = now;
    transitions.push(structuredClone({ profileId: profile.id, at: now, mutation }));
  }
  const store: ProfileStore = {
    read: (profileId, now) =>
      Effect.sync(() => {
        const profile = profiles.get(profileId);
        return profile ? owner(profile, now) : null;
      }),
    create: (input) =>
      Effect.sync(() => {
        creations.push(structuredClone(input));
        const existing = profiles.get(input.profileId);
        if (existing) return owner(existing, input.now);
        if (claims.has(input.handle)) return null;
        const profile: Profile = {
          id: input.profileId,
          displayName: input.displayName,
          handle: input.handle,
          biographyMarkdown: '',
          pictureAssetId: null,
          version: 1,
          createdAt: input.now,
          updatedAt: input.now,
          lastHandleChangedAt: null,
        };
        profiles.set(input.profileId, profile);
        assignClaim(input.profileId, input.handle, 'profile', input.now);
        if (input.imageUrl) imports.set(profile.id, { status: 'pending', leaseToken: null });
        transitions.push({
          profileId: profile.id,
          at: input.now,
          mutation: { type: 'created', handle: input.handle },
        });
        return owner(profile, input.now);
      }),
    transact: (query, decide) =>
      Effect.sync(() => {
        const current = profiles.get(query.profileId);
        if (!current)
          return {
            outcome: {
              _tag: 'Rejected',
              reason: 'version-conflict',
              message: 'Profile has changed since it was last loaded',
            },
            changed: false,
          };
        const now = new Date(Math.max(query.now.getTime(), Date.now()));
        const snapshot: ProfileSnapshot = structuredClone({
          profile: owner(current, now),
          observedAt: now,
          targetClaim: query.handle ? (claims.get(query.handle) ?? null) : null,
          eligibleHandles: history(current.id, now).map((entry) => entry.handle),
          wallpaperOwners: (query.wallpaperIds ?? []).flatMap((wallpaperId) => {
            const profileId = wallpaperOwners.get(wallpaperId);
            return profileId ? [{ wallpaperId, profileId }] : [];
          }),
          asset: query.assetId ? (assets.get(query.assetId) ?? null) : null,
          importJob: imports.get(current.id) ?? null,
        });
        const decision = decide(snapshot);
        if (decision._tag === 'Rejected') return { outcome: decision, changed: false };
        if (decision._tag === 'Change') {
          const mutation = decision.mutation;
          if (mutation.type === 'handle' || mutation.type === 'reactivate') {
            const claimed = claims.get(mutation.handle);
            if (claimed && claimed.profileId !== current.id)
              return {
                outcome: {
                  _tag: 'Rejected',
                  reason: 'handle-unavailable',
                  message: 'This Handle is already in use; choose another name',
                },
                changed: false,
              };
          }
          commit(current, mutation, now);
        }
        return {
          outcome: { _tag: 'Success', profile: owner(current, now) },
          changed: decision._tag === 'Change',
        };
      }),
  };
  const run = <A, E>(use: (service: Profiles) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Profiles.use(use).pipe(
        Effect.provide(
          profilesLayer(policy).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ProfileStore, store),
                Layer.succeed(Identities, {
                  getIdentity: (profileId) =>
                    Effect.sync(() => {
                      identityReads.push(profileId);
                      return (
                        identities.get(profileId) ?? {
                          displayName: 'Ada',
                          firstName: null,
                          lastName: null,
                        }
                      );
                    }),
                })
              )
            )
          )
        )
      )
    );
  async function ensure(profileId = 'owner', identity?: ExternalIdentity) {
    if (identity) identities.set(profileId, identity);
    const result = await run((service) => service.ensure({ profileId }));
    if (result._tag !== 'Success') throw new Error(result.message);
    return result.profile;
  }
  return {
    run,
    ensure,
    transitions,
    creations,
    identityReads,
    setIdentity: (profileId: string, identity: ExternalIdentity) =>
      identities.set(profileId, identity),
    setPolicy: (changes: Partial<ProfilePolicy>) => {
      policy = { ...policy, ...changes };
    },
    stagePicture: (asset: { id: string; profileId: string; expiresAt: Date }) => {
      if (assets.has(asset.id)) throw new Error('Picture is already staged');
      assets.set(asset.id, structuredClone({ ...asset, state: 'staged' }));
    },
    publishWallpaper: (wallpaperId: string, profileId: string) => {
      if (!wallpaperOwners.has(wallpaperId)) wallpaperOwners.set(wallpaperId, profileId);
    },
  };
}
