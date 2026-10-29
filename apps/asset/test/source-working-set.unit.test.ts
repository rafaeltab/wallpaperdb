import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { SourceStore } from '../src/capabilities/sources/index.js';
import { workingSet, commitWorkingSet } from './fixtures/source-working-set.js';
import { emptySourceState, verifyWorkingSet } from './fixtures/source-working-set-contract.js';
it('qualifies the controlled Source candidate working set', async () => {
  let state = emptySourceState('working-set-controlled');
  const runtime = ManagedRuntime.make(
    Layer.succeed(SourceStore, {
      releaseRead: () => Effect.void,
      transact: (_assetId, _revision, change, selection) =>
        Effect.sync(() => {
          const changed = change(workingSet(state, selection));
          if (changed.state) state = commitWorkingSet(state, changed.state);
          return changed.result;
        }),
    })
  );
  try {
    const result = await verifyWorkingSet((effect) => runtime.runPromise(effect), state.asset.id);
    expect(result?.candidates[0]?.status).toBe('cancelled');
    expect(result?.nonterminalCandidateCount).toBe(3);
  } finally {
    await runtime.dispose();
  }
});
