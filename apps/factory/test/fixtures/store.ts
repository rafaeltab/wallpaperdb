import { Effect } from 'effect';
import type { Intent, JobStore } from '../../src/capabilities/job/index.js';
export function controlledStore(): JobStore {
  let intent: Intent | null = null;
  let launched = false;
  let wait: import('../../src/capabilities/job/index.js').WaitState | null = null;
  const stages = new Map<number, import('../../src/capabilities/job/index.js').StageRequest>();
  const runs = new Map<number, string>();
  const claims = new Set<number>();
  return {
    readWait: () => Effect.sync(() => wait),
    saveWait: (state) =>
      Effect.sync(() => {
        if (state.revision !== (wait?.revision ?? -1) + 1) return false;
        wait = state;
        return true;
      }),
    bindRun: (request, runId) =>
      Effect.sync(() => {
        const existing = runs.get(request.index);
        if (existing) return existing === runId;
        runs.set(request.index, runId);
        return true;
      }),
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
