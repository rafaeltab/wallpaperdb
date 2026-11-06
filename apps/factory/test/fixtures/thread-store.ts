import { Effect } from 'effect';
import type { ThreadState, ThreadStore } from '../../src/capabilities/observe/index.js';
/** Controlled implementation of the atomic replacement contract. */
export function controlledThreads(initial: ThreadState = {}): ThreadStore {
  let state = initial;
  return {
    read: () => Effect.sync(() => state),
    save: (value) =>
      Effect.sync(() => {
        state = value;
      }),
  };
}
