import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { Identities, Profiles, ProfileStore, profilesLayer, type ProfilePolicy, type OwnerProfile, type ProfileStore as Store } from '../src/profile/index.js';

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

function controlled() {
  const created: Array<{ profileId: string; displayName: string; handle: string; imageUrl: string | null }> = [];
  const store: Store = {
    read: () => Effect.succeed(null),
    create: input => Effect.sync(() => {
      created.push(input);
      return { ...owner, id: input.profileId, displayName: input.displayName, handle: input.handle };
    }),
    transact: () => Effect.die('Unexpected transaction'),
  };
  const layer = profilesLayer(policy).pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(ProfileStore, store),
    Layer.succeed(Identities, { getIdentity: () => Effect.succeed({ displayName: null, firstName: '  Ada ', lastName: ' Lovelace  ', imageUrl: null }) }),
  )));
  return { created, run: <A, E>(use: (profiles: Profiles) => Effect.Effect<A, E>) => Effect.runPromise(Effect.gen(function* () { return yield* use(yield* Profiles); }).pipe(Effect.provide(layer))) };
}

describe('Profiles capability', () => {
  it('creates the authenticated owner with normalized identity and a public handle', async () => {
    const test = controlled();
    expect(await test.run(profiles => profiles.ensure({ profileId: 'owner' }))).toMatchObject({
      _tag: 'Success', profile: { id: 'owner', displayName: 'Ada Lovelace', handle: 'ada-lovelace' },
    });
    expect(test.created).toEqual([expect.objectContaining({ profileId: 'owner', displayName: 'Ada Lovelace', handle: 'ada-lovelace', imageUrl: null })]);
  });
});
