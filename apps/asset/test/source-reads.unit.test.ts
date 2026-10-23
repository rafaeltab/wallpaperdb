import { Clock, Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { expect, it } from 'vitest';
import {
  MandatoryInspection,
  SourceBytes,
  SourceStore,
  Sources,
  sourcesLayer,
  initialSourcePolicies,
  type SourceState,
} from '../src/capabilities/sources/index.js';

it.each([
  'authorization',
  'storage-open',
] as const)('refuses a read whose finite reservation expires during %s', async (phase) => {
  const clockRuntime = ManagedRuntime.make(TestClock.layer());
  await clockRuntime.runPromise(TestClock.setTime(1000));
  const clock = await clockRuntime.runPromise(Clock.Clock);
  const reservations = new Set<string>();
  let opened = 0,
    closed = 0;
  const owner = { namespace: 'clerk', subject: 'owner' };
  const state: SourceState = {
    asset: { id: 'asset', applicationId: 'wallpaper', assetType: 'wallpaper', owner },
    sourceSetRevision: '1',
    deliveryRevision: '1',
    defaultSourceId: 'source',
    initialAnalysisSourceId: 'source',
    candidates: [],
    nonterminalCandidateCount: 0,
    sources: [
      {
        sourceId: 'source',
        layout: 'asset-layout-1',
        facts: {
          digest: 'a'.repeat(64),
          byteLength: 4,
          mimeType: 'image/png',
          model: 'sdr-png',
          width: 2,
          height: 2,
        },
      },
    ],
  };
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const runtime = ManagedRuntime.make(
    sourcesLayer({ revision: 'one', types: initialSourcePolicies, readLifetimeMs: 100 }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(SourceStore, {
            transact: (_id, _revision, change) =>
              Effect.gen(function* () {
                const changed = change(structuredClone(state));
                if (changed.readProtection) reservations.add(changed.readProtection.readId);
                if (phase === 'authorization')
                  yield* Effect.promise(() => clockRuntime.runPromise(TestClock.setTime(1200)));
                return changed.result;
              }),
            releaseRead: (id) =>
              Effect.sync(() => {
                reservations.delete(id);
              }),
          }),
          Layer.succeed(SourceBytes, {
            put: () => Effect.die('unused'),
            prepare: () => Effect.die('unused'),
            read: () =>
              Effect.gen(function* () {
                opened++;
                if (phase === 'storage-open')
                  yield* Effect.promise(() => clockRuntime.runPromise(TestClock.setTime(1200)));
                return {
                  bytes: (async function* () {
                    yield new Uint8Array([1, 2, 3, 4]);
                  })(),
                  closed: Effect.promise(() => ended),
                  close: () =>
                    Effect.sync(() => {
                      closed++;
                      finish();
                    }),
                };
              }),
          }),
          Layer.succeed(MandatoryInspection, { inspect: () => Effect.die('unused') })
        )
      )
    )
  );
  try {
    expect(
      await runtime.runPromise(
        Sources.use((sources) => sources.original(owner, 'asset', 'source')).pipe(
          Effect.provideService(Clock.Clock, clock)
        )
      )
    ).toEqual({ kind: 'unavailable' });
    expect(reservations.size).toBe(0);
    expect(opened).toBe(phase === 'authorization' ? 0 : 1);
    expect(closed).toBe(phase === 'authorization' ? 0 : 1);
  } finally {
    finish();
    await runtime.dispose();
    await clockRuntime.dispose();
  }
});
