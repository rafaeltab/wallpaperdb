import { Effect } from 'effect';
import {
  SourceFailure,
  type SourceState,
  type SourceStorePort,
} from '../../src/capabilities/sources/index.js';
type Change = ReturnType<Parameters<SourceStorePort['transact']>[2]>;
export function controlledSources(
  initial: SourceState,
  active: () => string = () => 'revision-1',
  committed: (change: Change) => Effect.Effect<void, SourceFailure> = () => Effect.void
) {
  let state = structuredClone(initial);
  const port: SourceStorePort = {
    releaseRead: () => Effect.void,
    transact: (id, revision, change) =>
      Effect.suspend(() => {
        if (revision !== null && revision !== active())
          return Effect.fail(new SourceFailure({ operation: 'inactive-policy', cause: null }));
        const changed = change(id === state.asset.id ? structuredClone(state) : null);
        if (changed.state) state = structuredClone(changed.state);
        return committed(changed).pipe(Effect.as(changed.result));
      }),
  };
  return {
    port,
    get state() {
      return structuredClone(state);
    },
  };
}
