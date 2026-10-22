import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Sources,
  SourceStore,
  SourceBytes,
  MandatoryInspection,
  sourcesLayer,
  type SourceState,
  type SourceStorePort,
} from '../src/capabilities/sources/index.js';
import { initialSourcePolicies } from '../src/capabilities/sources/policy.js';

it('keeps private bytes outside membership until immutable preparation and first acceptance commit', async () => {
  let state: SourceState = {
    asset: {
      id: 'asset_1',
      applicationId: 'wallpaper',
      assetType: 'wallpaper',
      owner: { namespace: 'clerk', subject: 'owner' },
    },
    sourceSetRevision: '0',
    deliveryRevision: '0',
    defaultSourceId: null,
    initialAnalysisSourceId: null,
    sources: [],
    candidates: [],
  };
  const confirmations: unknown[] = [];
  const objects = new Map<string, Uint8Array>();
  const store: SourceStorePort = {
    transact: (_id, _revision, change) =>
      Effect.sync(() => {
        const changed = change(structuredClone(state));
        if (!changed.state) throw new Error('Unexpected missing Asset');
        state = changed.state;
        if (changed.confirmation) confirmations.push(changed.confirmation);
        return changed.result;
      }),
  };
  const runtime = ManagedRuntime.make(
    sourcesLayer({ revision: 'policy-1', types: initialSourcePolicies }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(SourceStore, store),
          Layer.succeed(SourceBytes, {
            put: (identity, bytes) =>
              Effect.sync(() => {
                objects.set(identity, bytes);
              }),
            prepare: (candidateId, sourceId) =>
              Effect.sync(() => {
                const bytes = objects.get(candidateId);
                if (!bytes) throw new Error('Missing bytes');
                objects.set(sourceId, bytes);
              }),
            read: (sourceId) =>
              Effect.succeed({
                bytes: (async function* () {
                  yield objects.get(sourceId)!;
                })(),
                close: () => Effect.void,
              }),
          }),
          Layer.succeed(MandatoryInspection, {
            inspect: () =>
              Effect.succeed({
                kind: 'verified',
                facts: {
                  model: 'sdr-png',
                  mimeType: 'image/png',
                  width: 2,
                  height: 2,
                  byteLength: 4,
                  digest: 'test-digest',
                },
              }),
          })
        )
      )
    )
  );
  const owner = { namespace: 'clerk', subject: 'owner' };
  try {
    const candidate = await runtime.runPromise(
      Sources.use((s) =>
        s.create(owner, 'asset_1', {
          idempotencyKey: 'first',
          operation: 'add',
          expectedSourceSetRevision: '0',
        })
      )
    );
    expect(candidate.kind).toBe('candidate');
    if (candidate.kind !== 'candidate') throw new Error('Expected candidate');
    const id = candidate.candidate.candidateId;
    expect(state.sources).toEqual([]);
    expect(
      await runtime.runPromise(
        Sources.use((s) =>
          s.upload(
            owner,
            'asset_1',
            id,
            (async function* () {
              yield new Uint8Array([1, 2, 3, 4]);
            })()
          )
        )
      )
    ).toMatchObject({ kind: 'candidate', candidate: { status: 'ready' } });
    expect(state.sources).toEqual([]);
    expect(
      await runtime.runPromise(
        Sources.use((s) =>
          s.accept(owner, 'asset_1', id, { expectedSourceSetRevision: '0', operation: 'add' })
        )
      )
    ).toMatchObject({
      kind: 'candidate',
      candidate: { status: 'accepted', sourceSetRevision: '1' },
    });
    expect(state.defaultSourceId).toBe(state.sources[0]?.sourceId);
    expect(state.initialAnalysisSourceId).toBe(state.defaultSourceId);
    expect(state.deliveryRevision).toBe('1');
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({
      assetId: 'asset_1',
      applicationId: 'wallpaper',
      sourceSetRevision: '1',
      candidateId: id,
    });
  } finally {
    await runtime.dispose();
  }
});
