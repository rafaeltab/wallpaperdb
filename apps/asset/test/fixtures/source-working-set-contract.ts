import type { Effect } from 'effect';
import { expect } from 'vitest';
import {
  SourceStore,
  type Candidate,
  type SourceState,
} from '../../src/capabilities/sources/index.js';

export async function verifyWorkingSet(
  run: <A>(effect: Effect.Effect<A, unknown, SourceStore>) => Promise<A>,
  assetId: string
) {
  const candidate = (i: number): Candidate => ({
    candidateId: `candidate-${i}`,
    sourceId: `source-${i}`,
    idempotencyKey: `key-${i}`,
    operation: 'add',
    expectedSourceSetRevision: '0',
    status: i < 70 ? 'cancelled' : 'awaiting-bytes',
    expiresAt: i === 70 ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
    orphanExpiresAt: '2099-01-01T00:00:00Z',
    layout: 'asset-layout-1',
  });
  await run(
    SourceStore.use((store) =>
      store.transact(assetId, null, (state) => {
        if (!state) throw new Error('Expected Asset');
        state.candidates = Array.from({ length: 74 }, (_, i) => candidate(i));
        state.nonterminalCandidateCount = 4;
        return { state, result: undefined };
      })
    )
  );
  const read = (selection?: import('../../src/capabilities/sources/index.js').CandidateSelection) =>
    run(
      SourceStore.use((store) =>
        store.transact(assetId, null, (state) => ({ state, result: state }), selection)
      )
    );
  expect((await read())?.candidates).toEqual([]);
  const exact = await read({ kind: 'candidate', candidateId: 'candidate-0' });
  expect(exact?.candidates).toEqual([candidate(0)]);
  const replay = await read({ kind: 'create', idempotencyKey: 'key-0', now: Date.now(), limit: 2 });
  expect(replay?.candidates).toHaveLength(3);
  expect(replay?.candidates.some((c) => c.candidateId === 'candidate-0')).toBe(true);
  expect(replay?.candidates.some((c) => c.candidateId === 'candidate-70')).toBe(false);
  expect(replay?.nonterminalCandidateCount).toBe(4);
  const page = await read({ kind: 'page' });
  expect(page?.candidates).toHaveLength(32);
  expect(page?.candidates[0]?.candidateId).toBe('candidate-73');
  const next = await read({ kind: 'page', cursor: page?.candidatePage?.nextCursor });
  expect(next?.candidates[0]?.candidateId).toBe('candidate-41');
  expect((await read({ kind: 'page', cursor: '42:wrong' }))?.candidatePage?.valid).toBe(false);
  await expect(
    run(
      SourceStore.use((store) =>
        store.transact(
          assetId,
          null,
          (state) => {
            if (!state?.candidates[0]) throw new Error('Expected selected candidate');
            state.candidates[0].status = 'rejected';
            throw new Error('rollback-working-set');
          },
          { kind: 'candidate', candidateId: 'candidate-71' }
        )
      )
    )
  ).rejects.toThrow();
  expect(
    (await read({ kind: 'candidate', candidateId: 'candidate-71' }))?.candidates[0]?.status
  ).toBe('awaiting-bytes');
  // Updating one record cannot overwrite the candidates omitted from its working set.
  await run(
    SourceStore.use((store) =>
      store.transact(
        assetId,
        null,
        (state) => {
          if (!state?.candidates[0]) throw new Error('Expected selected candidate');
          state.candidates[0].status = 'cancelled';
          state.nonterminalCandidateCount--;
          return { state, result: undefined };
        },
        { kind: 'candidate', candidateId: 'candidate-71' }
      )
    )
  );
  expect((await read({ kind: 'candidate', candidateId: 'candidate-72' }))?.candidates).toEqual([
    candidate(72),
  ]);
  return read({ kind: 'candidate', candidateId: 'candidate-71' });
}

export function emptySourceState(assetId: string): SourceState {
  return {
    asset: {
      id: assetId,
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
}
