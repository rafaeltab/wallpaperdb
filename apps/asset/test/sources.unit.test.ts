import { controlledSources } from './fixtures/controlled-sources.js';
import { controlledBytes } from './fixtures/controlled-bytes.js';
import { createHash } from 'node:crypto';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Sources,
  SourceStore,
  SourceBytes,
  MandatoryInspection,
  sourcesLayer,
  type SourceState,
} from '../src/capabilities/sources/index.js';
import { initialSourcePolicies } from '../src/capabilities/sources/index.js';

it('keeps private bytes outside membership until immutable preparation and first acceptance commit', async () => {
  const initial: SourceState = {
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
    nonterminalCandidateCount: 0,
  };
  const confirmations: unknown[] = [];

  const controlled = controlledSources(
    initial,
    () => 'policy-1',
    (changed) =>
      Effect.sync(() => {
        if (changed.confirmation) confirmations.push(changed.confirmation);
      })
  );
  const store = controlled.port;
  const runtime = ManagedRuntime.make(
    sourcesLayer({ revision: 'policy-1', types: initialSourcePolicies }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(SourceStore, store),
          Layer.succeed(SourceBytes, controlledBytes()),
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
                  digest: createHash('sha256')
                    .update(new Uint8Array([1, 2, 3, 4]))
                    .digest('hex'),
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
    expect(controlled.state.sources).toEqual([]);
    expect(
      await runtime.runPromise(
        Sources.use((s) =>
          s.upload(
            owner,
            'asset_1',
            id,
            Object.assign(
              (async function* () {
                yield new Uint8Array([1, 2, 3, 4]);
              })(),
              { cancel: () => {} }
            )
          )
        )
      )
    ).toMatchObject({ kind: 'candidate', candidate: { status: 'ready' } });
    expect(controlled.state.sources).toEqual([]);
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
    expect(controlled.state.defaultSourceId).toBe(controlled.state.sources[0]?.sourceId);
    expect(controlled.state.initialAnalysisSourceId).toBe(controlled.state.defaultSourceId);
    expect(controlled.state.deliveryRevision).toBe('1');
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
