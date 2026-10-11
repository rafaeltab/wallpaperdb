import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { Profiles, type ProfileOutcome } from '../src/capabilities/profile/index.js';
import {
  PictureCodec,
  PictureObjects,
  PictureSource,
  PictureStore,
  PictureUnavailable,
  Pictures,
  picturesLayer,
  type StoredPicture,
} from '../src/capabilities/pictures/index.js';

const runtimes: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

function setup(maxOutputBytes = 5242880, normalize: (bytes: Buffer) => Buffer = (bytes) => bytes) {
  const policies: unknown[] = [];
  const assets = new Map<string, StoredPicture & { state: 'uploading' | 'staged' | 'deleting' }>();
  const objects = new Map<string, Buffer>();
  const adoptions: Array<{ profileId: string; assetId: string | null; expectedVersion: number }> =
    [];
  let storageFailure = false;
  const rejected = () =>
    Effect.succeed<ProfileOutcome>({
      _tag: 'Rejected',
      reason: 'version-conflict',
      message: 'Profile has changed since it was last loaded',
    });
  const profiles = {
    ensure: rejected,
    updateDetails: rejected,
    changeHandle: rejected,
    reactivateAlias: rejected,
    scheduleAliasExpiry: rejected,
    expireAliasImmediately: rejected,
    expireDueAlias: () => Effect.succeed(false),
    adoptPicture: (
      principal: { profileId: string },
      assetId: string | null,
      expectedVersion: number
    ) => {
      adoptions.push({ ...principal, assetId, expectedVersion });
      return rejected();
    },
    adoptImportedPicture: rejected,
  };
  const store: PictureStore = {
    createCandidate: (input) =>
      Effect.sync(() => {
        const id = `pic_${assets.size}`;
        const asset = {
          ...input,
          id,
        };
        assets.set(id, { ...asset, state: 'uploading' });
        return asset;
      }),
    beginUpload: (id) => Effect.succeed(assets.get(id)?.state === 'uploading'),
    finishUpload: (id) =>
      Effect.sync(() => {
        const asset = assets.get(id);
        if (!asset || asset.state !== 'uploading') return false;
        asset.state = 'staged';
        return true;
      }),
    available: () => Effect.succeed(false),
    expired: (now, cursor) =>
      Effect.succeed(
        [...assets.values()]
          .filter(
            (asset) =>
              asset.expiresAt && asset.expiresAt <= now && (!cursor || asset.id > cursor.id)
          )
          .slice(0, 100)
      ),
    claimDeletion: (id) =>
      Effect.sync(() => {
        const asset = assets.get(id);
        if (!asset || asset.state === 'uploading') return null;
        asset.state = 'deleting';
        return asset;
      }),
    finishDeletion: (id) => Effect.sync(() => assets.delete(id)),
    dueImports: () => Effect.succeed([]),
    claimImport: () => Effect.succeed(null),
    settleImport: () => Effect.void,
  };
  const objectStore: PictureObjects = {
    put: (assetId, bytes) =>
      Effect.gen(function* () {
        expect(assets.get(assetId)?.state).toBe('uploading');
        if (storageFailure)
          return yield* Effect.fail(
            new PictureUnavailable({ operation: 'put-picture', cause: new Error('Reply lost') })
          );
        objects.set(assetId, bytes);
      }),
    delete: (assetId) =>
      Effect.gen(function* () {
        expect(assets.get(assetId)?.state).toBe('deleting');
        if (storageFailure)
          return yield* Effect.fail(
            new PictureUnavailable({ operation: 'delete-picture', cause: new Error('Reply lost') })
          );
        objects.delete(assetId);
      }),
  };
  const runtime = ManagedRuntime.make(
    picturesLayer({
      profileEvidenceRetentionDays: 7,
      profilePictureImportTimeoutMs: 1000,
      profilePictureMaxBytes: maxOutputBytes,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Profiles, profiles),
          Layer.succeed(PictureStore, store),
          Layer.succeed(PictureObjects, objectStore),
          Layer.succeed(PictureCodec, {
            process: (bytes, policy) => {
              policies.push(policy);
              return Effect.succeed(
                bytes.length === 0
                  ? {
                      _tag: 'Rejected',
                      reason: 'invalid-picture',
                      message: 'Picture could not be decoded',
                    }
                  : {
                      _tag: 'Processed',
                      picture: {
                        bytes: normalize(bytes),
                        mimeType: 'image/webp',
                        width: 512,
                        height: 512,
                      },
                    }
              );
            },
          }),
          Layer.succeed(PictureSource, { download: () => Effect.die('Unexpected source download') })
        )
      )
    )
  );
  runtimes.push(runtime);
  return {
    assets,
    policies,
    objects,
    adoptions,
    failStorage: () => {
      storageFailure = true;
    },
    recoverStorage: () => {
      storageFailure = false;
    },
    run: <A>(operation: (pictures: Pictures) => Effect.Effect<A, unknown>) =>
      runtime.runPromise(Effect.flatMap(Pictures, operation)),
  };
}

describe('Picture capability', () => {
  it('supplies effective normalization policy and rejects oversized final output before creating an Asset', async () => {
    const test = setup(4, () => Buffer.from('normalized'));
    const outcome = await test.run((pictures) =>
      pictures.upload({ profileId: 'owner' }, Buffer.from('src'), 4)
    );
    expect(outcome).toMatchObject({ _tag: 'Rejected', reason: 'picture-too-large' });
    expect(test.assets.size).toBe(0);
    expect(test.objects.size).toBe(0);
    expect(test.adoptions).toEqual([]);
    expect(test.policies).toEqual([
      {
        output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
        maxOutputBytes: 4,
        acceptedSourceFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        animation: { available: true },
        encoding: { staticQuality: 85, animationQuality: 85 },
      },
    ]);
  });
  it('stores canonical passthrough and normalized codec output without changing their bytes', async () => {
    for (const normalized of [false, true]) {
      const output = Buffer.from(normalized ? 'normalized' : 'canonical');
      const test = setup(100, () => output);
      const staged = await test.run((pictures) =>
        pictures.stage({ profileId: 'owner' }, Buffer.from('source'))
      );
      expect(staged._tag).toBe('Staged');
      expect([...test.objects.values()]).toEqual([output]);
      expect([...test.assets.values()]).toMatchObject([
        { width: 512, height: 512, fileSizeBytes: output.length },
      ]);
    }
  });
  it('resolves effective static and animated policy for the authenticated User with configurable output bytes', async () => {
    const test = setup(123456);
    expect(await test.run((pictures) => pictures.policy({ profileId: 'owner' }))).toEqual({
      _tag: 'Policy',
      policy: {
        output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
        maxOutputBytes: 123456,
        acceptedSourceFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        animation: { available: true },
        encoding: { staticQuality: 85, animationQuality: 85 },
      },
    });
    expect(await test.run((pictures) => pictures.policy({ profileId: '' }))).toMatchObject({
      _tag: 'Rejected',
      reason: 'unauthorized',
    });
    expect(test.assets.size).toBe(0);
  });
  it('retains a private candidate after a lost PUT reply and never attempts adoption', async () => {
    const test = setup();
    test.failStorage();
    await expect(
      test.run((pictures) => pictures.upload({ profileId: 'owner' }, Buffer.from('image'), 4))
    ).rejects.toMatchObject({ _tag: 'PictureUnavailable' });
    expect([...test.assets.values()]).toMatchObject([
      { profileId: 'owner', state: 'uploading', fileSizeBytes: 5 },
    ]);
    expect(test.adoptions).toEqual([]);
  });
  it('does not stage rejected bytes or permit an absent principal to consume image resources', async () => {
    const test = setup();
    expect(
      await test.run((pictures) => pictures.stage({ profileId: 'owner' }, Buffer.alloc(0)))
    ).toMatchObject({ _tag: 'Rejected', reason: 'invalid-picture' });
    expect(
      await test.run((pictures) => pictures.stage({ profileId: '' }, Buffer.from('image')))
    ).toMatchObject({ _tag: 'Rejected', reason: 'unauthorized' });
    expect(test.assets.size).toBe(0);
    expect(test.objects.size).toBe(0);
    expect(test.adoptions).toEqual([]);
  });

  it('keeps an immutable staged object after a version conflict for later retention', async () => {
    const test = setup();
    const result = await test.run((pictures) =>
      pictures.upload({ profileId: 'owner' }, Buffer.from('image'), 4)
    );
    expect(result).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    const asset = [...test.assets.values()][0];
    expect(asset).toMatchObject({ state: 'staged', profileId: 'owner' });
    expect(test.objects.get(asset.id)).toEqual(Buffer.from('image'));
    expect(test.adoptions).toEqual([{ profileId: 'owner', expectedVersion: 4, assetId: asset.id }]);
    expect(asset.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('retains deletion evidence after ambiguous storage failure and completes a retry', async () => {
    const test = setup();
    const staged = await test.run((pictures) =>
      pictures.stage({ profileId: 'owner' }, Buffer.from('image'))
    );
    if (staged._tag !== 'Staged') throw new Error('Expected a staged image');
    const asset = test.assets.get(staged.assetId);
    if (!asset?.expiresAt) throw new Error('Expected a retention deadline');
    const expiresAt = asset.expiresAt;
    test.failStorage();
    expect(await test.run((pictures) => pictures.cleanupExpired(expiresAt))).toEqual({
      deleted: 0,
      failed: 1,
    });
    expect(test.assets.get(staged.assetId)?.state).toBe('deleting');
    expect(test.objects.has(staged.assetId)).toBe(true);
    test.recoverStorage();
    expect(await test.run((pictures) => pictures.cleanupExpired(expiresAt))).toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(test.assets.size).toBe(0);
    expect(test.objects.size).toBe(0);
  });
});
