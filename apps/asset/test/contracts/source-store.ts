import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { SourceStorePort, SourceState } from '../../src/capabilities/sources/index.js';
export const contractSourceState: SourceState = {
  asset: {
    id: 'asset_contract',
    applicationId: 'wallpaper',
    assetType: 'wallpaper',
    owner: { namespace: 'clerk', subject: 'owner' },
  },
  sourceSetRevision: '0',
  deliveryRevision: '0',
  sources: [],
  candidates: [],
  nonterminalCandidateCount: 0,
  defaultSourceId: null,
  initialAnalysisSourceId: null,
};
export function sourceStoreContract(
  open: () => Promise<{
    port: SourceStorePort;
    activate: (revision: string) => Promise<unknown>;
    close: () => Promise<unknown>;
  }>
) {
  it('looks up by Asset, detaches state, rolls back callback defects and fences policy changes', async () => {
    const f = await open();
    const read = () =>
      Effect.runPromise(
        f.port.transact('asset_contract', null, (state) => ({ state, result: state }))
      );
    try {
      expect(
        await Effect.runPromise(
          f.port.transact('asset_unknown', null, (state) => ({ state, result: state }))
        )
      ).toBeNull();
      const before = await read();
      await expect(
        Effect.runPromise(
          f.port.transact('asset_contract', 'revision-1', (state) => {
            if (!state) throw new Error('Missing Asset');
            state.sourceSetRevision = '99';
            throw new Error('rollback proof');
          })
        )
      ).rejects.toThrow();
      expect(await read()).toEqual(before);
      const detached = await read();
      if (!detached) throw new Error('Missing Asset');
      detached.sourceSetRevision = '123';
      expect((await read())?.sourceSetRevision).toBe('0');
      await f.activate('revision-2');
      let called = false;
      await expect(
        Effect.runPromise(
          f.port.transact('asset_contract', 'revision-1', (state) => {
            called = true;
            return { state, result: null };
          })
        )
      ).rejects.toThrow();
      expect(called).toBe(false);
      expect(await read()).toEqual(before);
      await Effect.runPromise(
        f.port.transact('asset_contract', 'revision-2', (state) => {
          if (!state) throw new Error('Missing Asset');
          state.sourceSetRevision = '1';
          return { state, result: null };
        })
      );
      expect((await read())?.sourceSetRevision).toBe('1');
    } finally {
      await f.close();
    }
  });
}
