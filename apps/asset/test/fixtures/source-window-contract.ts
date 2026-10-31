import { expect } from 'vitest';
import type { SourceState, SourceStorePort } from '../../src/capabilities/sources/index.js';

export type WindowRun = (
  selection: Parameters<SourceStorePort['transact']>[3],
  change?: (state: SourceState) => void
) => Promise<SourceState | null>;

/** Shared guarantees of selected Source transactions, independent of storage technology. */
export async function sourceWindowContract(run: WindowRun, assetId: string, size: number) {
  const selection = { kind: 'candidate' as const, candidateId: `${assetId}_0` };
  const first = await run(selection);
  expect(first?.candidates.map((entry) => entry.candidateId)).toEqual([`${assetId}_0`]);
  expect((await run({ kind: 'candidate', candidateId: 'missing' }))?.candidates).toEqual([]);
  const replay = await run({ kind: 'replay', key: 'history-0', now: '2030-01-01T00:00:00Z' });
  expect(replay?.candidates).toEqual(first?.candidates);
  expect(replay?.activeCandidateCount).toBe(0);
  const page = await run({ kind: 'page' });
  expect(page?.candidates).toHaveLength(32);
  expect(page?.candidates.at(-1)?.candidateId).toBe(`${assetId}_${size - 1}`);
  if (size > 32) {
    expect(page?.candidatePage?.nextCursor).toBe(`${size - 32}:${assetId}_${size - 32}`);
    const second = await run({ kind: 'page', cursor: page?.candidatePage?.nextCursor });
    expect(second?.candidates).toHaveLength(32);
    expect(second?.candidates.at(-1)?.candidateId).toBe(`${assetId}_${size - 33}`);
  } else expect(page?.candidatePage?.nextCursor).toBeUndefined();
  expect(await run({ kind: 'page', cursor: `0:${assetId}_1` })).toMatchObject({
    candidatePage: { valid: false },
  });
  const neighbor = await run({ kind: 'candidate', candidateId: `${assetId}_1` });
  await run(selection, (state) => {
    const candidate = state.candidates[0];
    if (!candidate) throw new Error('Missing candidate');
    candidate.reason = 'independent-mutation';
  });
  expect((await run(selection))?.candidates[0]).toEqual({
    ...first?.candidates[0],
    reason: 'independent-mutation',
  });
  expect((await run({ kind: 'candidate', candidateId: `${assetId}_1` }))?.candidates).toEqual(
    neighbor?.candidates
  );
  await expect(
    run(selection, (state) => {
      const candidate = state.candidates[0];
      if (!candidate) throw new Error('Missing candidate');
      candidate.reason = 'must-roll-back';
      throw new Error('deliberate rollback');
    })
  ).rejects.toThrow();
  expect((await run(selection))?.candidates[0]?.reason).toBe('independent-mutation');
  for (const index of [1, 2])
    await run({ kind: 'candidate', candidateId: `${assetId}_${index}` }, (state) => {
      const candidate = state.candidates[0];
      if (!candidate) throw new Error('Missing pending control');
      candidate.status = 'awaiting-bytes';
      state.nonterminalCandidateCount++;
    });
  expect(
    (await run({ kind: 'replay', key: 'new-key', now: '2030-01-01T00:00:00Z' }))
      ?.activeCandidateCount
  ).toBe(1);
}
