import { Effect } from 'effect';
import type { Intent, JobStore } from '../../src/capabilities/job/index.js';
export function controlledStore(): JobStore {
  let intent: Intent | null = null;
  let launched = false;
  const stages = new Map<number, import('../../src/capabilities/job/index.js').StageRequest>();
  const claims = new Set<number>();
  return {
    readStage: (index) => Effect.sync(() => stages.get(index) ?? null),
    saveStage: (request) =>
      Effect.sync(() => {
        if (stages.has(request.index)) return false;
        stages.set(request.index, request);
        return true;
      }),
    claimStage: (index) =>
      Effect.sync(() => {
        if (claims.has(index)) return false;
        claims.add(index);
        return true;
      }),
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
