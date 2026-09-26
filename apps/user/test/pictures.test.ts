import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { Profiles, type ProfileOutcome } from '../src/profile/index.js';
import {
  PictureCodec,
  PictureObjects,
  PictureSource,
  PictureStore,
  PictureUnavailable,
  Pictures,
  picturesLayer,
  type StoredPicture,
} from '../src/pictures/index.js';

const runtimes: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

function setup() {
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
          storageBucket: 'pictures',
          storageKey: `${input.profileId}/${id}.webp`,
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
    put: (asset, bytes) =>
      Effect.gen(function* () {
        expect(assets.get(asset.id)?.state).toBe('uploading');
        if (storageFailure)
          return yield* Effect.fail(
            new PictureUnavailable({ operation: 'put-picture', cause: new Error('Reply lost') })
          );
        objects.set(asset.id, bytes);
      }),
    delete: (asset) =>
      Effect.gen(function* () {
        expect(assets.get(asset.id)?.state).toBe('deleting');
        if (storageFailure)
          return yield* Effect.fail(
            new PictureUnavailable({ operation: 'delete-picture', cause: new Error('Reply lost') })
          );
        objects.delete(asset.id);
      }),
  };
  const runtime = ManagedRuntime.make(
    picturesLayer({ profileEvidenceRetentionDays: 7, profilePictureImportTimeoutMs: 1000 }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Profiles, profiles),
          Layer.succeed(PictureStore, store),
          Layer.succeed(PictureObjects, objectStore),
          Layer.succeed(PictureCodec, {
            process: (bytes) =>
              Effect.succeed(
                bytes.length === 0
                  ? {
                      _tag: 'Rejected',
                      reason: 'invalid-picture',
                      message: 'Picture could not be decoded',
                    }
                  : {
                      _tag: 'Processed',
                      picture: { bytes, mimeType: 'image/webp', width: 2, height: 3 },
                    }
              ),
          }),
          Layer.succeed(PictureSource, { download: () => Effect.die('Unexpected source download') })
        )
      )
    )
  );
  runtimes.push(runtime);
  return {
    assets,
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
  it('retains a private candidate after a lost PUT reply and never attempts adoption', async () => {
    const test = setup();
    test.failStorage();
    await expect(
      test.run((pictures) => pictures.upload({ profileId: 'owner' }, Buffer.from('image'), 4))
    ).rejects.toMatchObject({ _tag: 'PictureUnavailable' });
    expect([...test.assets.values()]).toMatchObject([
      { profileId: 'owner', state: 'uploading', storageBucket: 'pictures', fileSizeBytes: 5 },
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
