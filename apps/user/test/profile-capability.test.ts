import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { Identities, Profiles, ProfileStore, profilesLayer, type ProfilePolicy, type OwnerProfile, type ProfileStore as Store, type ProfileMutation, type ExternalIdentity } from '../src/profile/index.js';

const policy: ProfilePolicy = {
  profileHandleMinLength: 1, profileHandleMaxLength: 20, profileDisplayNameMaxLength: 80,
  profileBiographyMaxLength: 5000, profileRetainedAliasLimit: 3, profileEvidenceRetentionDays: 30,
  profilePictureMaxBytes: 5242880, profilePictureMaxPixels: 16000000, profilePictureMaxDecodedBytes: 67108864,
};
const owner: OwnerProfile = {
  id: 'owner', displayName: 'Ada', handle: 'ada', biographyMarkdown: '', pictureAssetId: null,
  version: 1, lastHandleChangedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  aliases: [], historicalHandles: [], biographyMaxLength: 5000, retainedAliasLimit: 3,
  pictureImportStatus: 'complete', pictureUploadLimits: { maxBytes: 5242880, maxPixels: 16000000, maxDecodedBytes: 67108864 },
};

function controlled(customPolicy: ProfilePolicy = policy, identity: ExternalIdentity = { displayName: null, firstName: '  Ada ', lastName: ' Lovelace  ', imageUrl: null }) {
  const mutations: ProfileMutation[] = [];
  let current = { ...owner };
  const created: Array<{ profileId: string; displayName: string; handle: string; imageUrl: string | null }> = [];
  const store: Store = {
    read: () => Effect.succeed(null),
    create: input => Effect.sync(() => {
      created.push(input);
      return { ...owner, id: input.profileId, displayName: input.displayName, handle: input.handle };
    }),
    transact: (_query, decide) => Effect.sync(() => {
      const decision = decide({ observedAt: _query.now, profile: current, targetClaim: null, eligibleHandles: [], wallpaperOwners: [], asset: null, importJob: null });
      if (decision._tag === 'Rejected') return { outcome: decision, changed: false };
      if (decision._tag === 'Change') {
        if (decision.mutation.type !== 'details') throw new Error('Unsupported controlled transition');
        mutations.push(decision.mutation);
        current = { ...current, displayName: decision.mutation.displayName, biographyMarkdown: decision.mutation.biographyMarkdown, version: current.version + 1, updatedAt: _query.now };
      }
      return { outcome: { _tag: 'Success', profile: current }, changed: decision._tag === 'Change' };
    }),
  };
  const layer = profilesLayer(customPolicy).pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(ProfileStore, store),
    Layer.succeed(Identities, { getIdentity: () => Effect.succeed(identity) }),
  )));
  return { created, mutations, run: <A, E>(use: (profiles: Profiles) => Effect.Effect<A, E>) => Effect.runPromise(Effect.gen(function* () { return yield* use(yield* Profiles); }).pipe(Effect.provide(layer))) };
}

describe('Profiles capability', () => {
  it('keeps a generated handle inside the configured minimum when truncation removes a trailing hyphen', async () => {
    const test = controlled({ ...policy, profileHandleMinLength: 3, profileHandleMaxLength: 3 }, { displayName: 'Ab cd', firstName: null, lastName: null });
    expect(await test.run(profiles => profiles.ensure({ profileId: 'owner' }))).toMatchObject({ _tag: 'Success', profile: { handle: 'ab0' } });
  });
  it('normalizes changed details once and preserves the version on a repeated no-op', async () => {
    const test = controlled();
    expect(await test.run(profiles => profiles.updateDetails({ profileId: 'owner' }, { displayName: '  Ada   Lovelace ' }, 1))).toMatchObject({ _tag: 'Success', profile: { displayName: 'Ada Lovelace', version: 2 } });
    expect(await test.run(profiles => profiles.updateDetails({ profileId: 'owner' }, { displayName: 'Ada Lovelace' }, 2))).toMatchObject({ _tag: 'Success', profile: { version: 2 } });
    expect(test.mutations).toEqual([{ type: 'details', displayName: 'Ada Lovelace', biographyMarkdown: '' }]);
  });
  it('rejects a stale command even when its values would be unchanged', async () => {
    const test = controlled();
    expect(await test.run(profiles => profiles.updateDetails({ profileId: 'owner' }, { displayName: 'Ada' }, 2))).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    expect(test.mutations).toEqual([]);
  });
  it('rejects a blank display name before persistence', async () => {
    const test = controlled();
    expect(await test.run(profiles => profiles.updateDetails({ profileId: 'owner' }, { displayName: '  ' }, 1))).toEqual({ _tag: 'Rejected', reason: 'invalid-display-name', message: 'Display name must not be blank' });
  });
  it('creates the authenticated owner with normalized identity and a public handle', async () => {
    const test = controlled();
    expect(await test.run(profiles => profiles.ensure({ profileId: 'owner' }))).toMatchObject({
      _tag: 'Success', profile: { id: 'owner', displayName: 'Ada Lovelace', handle: 'ada-lovelace' },
    });
    expect(test.created).toEqual([expect.objectContaining({ profileId: 'owner', displayName: 'Ada Lovelace', handle: 'ada-lovelace', imageUrl: null })]);
  });
});
