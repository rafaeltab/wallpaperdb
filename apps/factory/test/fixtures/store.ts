import { Effect } from 'effect';
import type { Intent, JobStore } from '../../src/capabilities/job/index.js';
export function controlledStore(): JobStore {
  let intent: Intent | null = null;
  let launched = false;
  let control: import('../../src/capabilities/job/index.js').Control = {
    revision: -1,
    cancelled: false,
    claimed: [],
  };
  let wait: import('../../src/capabilities/job/index.js').WaitState | null = null;
  const stages = new Map<number, import('../../src/capabilities/job/index.js').StageRequest>();
  const runs = new Map<string, string>();
  const claims = new Set<number>();
  return {
    readControl: () => Effect.sync(() => control),
    saveControl: (state) =>
      Effect.sync(() => {
        if (state.revision !== control.revision + 1) return false;
        control = state;
        return true;
      }),
    readWait: () => Effect.sync(() => wait),
    saveWait: (state) =>
      Effect.sync(() => {
        if (state.revision !== (wait?.revision ?? -1) + 1) return false;
        wait = state;
        return true;
      }),
    bindRun: (request, runId, ordinal = request.ordinal ?? request.index + 1) =>
      Effect.sync(() => {
        const key = `${request.index}:${ordinal}`;
        const existing = runs.get(key);
        if (existing) return existing === runId;
        runs.set(key, runId);
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
        if (control.cancelled || claims.has(index)) return false;
        claims.add(index);
        control = {
          ...control,
          revision: control.revision + 1,
          claimed: [...control.claimed, index],
        };
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
