import { Effect } from 'effect';
import type { Intent, JobStore } from '../../src/capabilities/job/index.js';
export function controlledStore(): JobStore {
  let intent: Intent | null = null;
  let launched = false;
  return {
    read: () => Effect.succeed(intent),
    reserve: (value) =>
      Effect.sync(() => {
        if (intent) return false;
        intent = value;
        return true;
      }),
    claimLaunch: () =>
      Effect.sync(() => {
        if (launched) return false;
        launched = true;
        return true;
      }),
  };
}
