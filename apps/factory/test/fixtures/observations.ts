import { Effect } from 'effect';
import type { ObservationStore, ObservationState } from '../../src/capabilities/observe/index.js';
/** Stateful controlled persistence with the same replacement/retention guarantees as SQLite. */
export function controlledObservations(initial: ObservationState = {}): ObservationStore {
  let value = initial;
  return {
    read: () => Effect.sync(() => value),
    refresh: (update) =>
      Effect.sync(() => {
        value = {
          ...value,
          ...update,
          ...(update.observedAt !== undefined ? { error: undefined, failedAt: undefined } : {}),
        };
      }),
    jobs: (jobs, jobsObservedAt, recoveries) =>
      Effect.sync(() => {
        value = { ...value, jobs, jobsObservedAt, ...(recoveries ? { recoveries } : {}) };
      }),
  };
}
