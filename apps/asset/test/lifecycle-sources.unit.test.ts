import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Lifecycle } from '../src/capabilities/lifecycle/index.js';
import { lifecycleSourceInspectionLayer } from '../src/source-lifecycle.js';
import { Sources } from '../src/capabilities/sources/index.js';
it('composes owned Asset inspection with accepted Source membership rather than an empty snapshot', async () => {
  const owner = { namespace: 'clerk', subject: 'owner' };
  const expected = {
    kind: 'found' as const,
    asset: {
      assetId: 'asset_one',
      assetType: 'wallpaper',
      sources: [],
      candidates: [],
      defaultSourceId: 'source_one',
      sourceSetRevision: '1',
      deliveryRevision: '1',
    },
  };
  const runtime = ManagedRuntime.make(
    lifecycleSourceInspectionLayer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(Lifecycle, {
            command: () => Effect.die('unused'),
            inspect: () => Effect.die('empty inspection must be replaced'),
          }),
          Layer.succeed(Sources, {
            list: (actualOwner, assetId) =>
              Effect.sync(() => {
                expect(actualOwner).toEqual(owner);
                expect(assetId).toBe('asset_one');
                return expected;
              }),
            policy: () => Effect.die('unused'),
            create: () => Effect.die('unused'),
            status: () => Effect.die('unused'),
            upload: () => Effect.die('unused'),
            accept: () => Effect.die('unused'),
            cancel: () => Effect.die('unused'),
            original: () => Effect.die('unused'),
          })
        )
      )
    )
  );
  try {
    expect(await runtime.runPromise(Lifecycle.use((s) => s.inspect(owner, 'asset_one')))).toEqual(
      expected
    );
  } finally {
    await runtime.dispose();
  }
});
