import { publisher, requiredRecord } from '../../platform/index.js';
import { Effect } from 'effect';
import { z } from 'zod';
import {
  intentSchema,
  stageSchema,
  waitSchema,
  controlSchema,
  scheduleSchema,
} from '../../platform/index.js';
import { type Intent, type JobStore, Unavailable } from '../../capabilities/job/index.js';

const code = (cause: unknown, expected: string) =>
  cause instanceof Error && 'code' in cause && cause.code === expected;
/** SQLite immutable records preserve reservations and revision CAS before external effects. */
export function fileStore(directory: string): JobStore {
  const effect = <A>(operation: string, work: () => Promise<A>) =>
    Effect.tryPromise({ try: work, catch: (cause) => new Unavailable({ operation, cause }) }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan(`factory.store.${operation}`)
    );
  const publish = publisher(directory);
  const readWait = async () => {
    let latest = null;
    for (let revision = 0; ; revision++) {
      try {
        latest = waitSchema.parse(await requiredRecord(directory, `wait-${revision}.json`));
      } catch (cause) {
        if (code(cause, 'ENOENT')) return latest;
        throw cause;
      }
    }
  };
  const readControl = async () => {
    let latest: import('../../capabilities/job/index.js').Control = {
      revision: -1,
      cancelled: false,
      claimed: [],
    };
    for (let revision = 0; ; revision++) {
      try {
        latest = controlSchema.parse(await requiredRecord(directory, `control-${revision}.json`));
      } catch (cause) {
        if (code(cause, 'ENOENT')) return latest;
        throw cause;
      }
    }
  };
  const saveControl = async (state: import('../../capabilities/job/index.js').Control) => {
    if (state.revision !== (await readControl()).revision + 1) return false;
    return publish(`control-${state.revision}.json`, controlSchema.parse(state));
  };
  return {
    readControl: () => effect('read-control', readControl),
    saveControl: (state) => effect('save-control', () => saveControl(state)),
    readWait: () => effect('read-wait', readWait),
    saveWait: (state) =>
      effect('save-wait', async () => {
        const current = await readWait();
        if (state.revision !== (current?.revision ?? -1) + 1) return false;
        return publish(`wait-${state.revision}.json`, waitSchema.parse(state));
      }),
    bindRun: (request, runId, ordinal = request.ordinal ?? request.index + 1) =>
      effect('bind-run', async () => {
        const initial = request.ordinal ?? request.index + 1;
        const name =
          ordinal === initial
            ? `stage-${request.index}-run.json`
            : `stage-${request.index}-run-${ordinal}.json`;
        await publish(name, { ...stageSchema.parse(request), runId });
        const saved = stageSchema
          .extend({ runId: z.string().min(1) })
          .parse(await requiredRecord(directory, name));
        return saved.runId === runId;
      }),
    readStage: (index) =>
      effect('read-stage', async () => {
        try {
          return stageSchema.parse(await requiredRecord(directory, `stage-${index}.json`));
        } catch (cause) {
          if (code(cause, 'ENOENT')) return null;
          throw cause;
        }
      }),
    saveStage: (request) =>
      effect('save-stage', () =>
        publish(`stage-${request.index}.json`, stageSchema.parse(request))
      ),
    claimStage: (index) =>
      effect('claim-stage', async () => {
        // Existing pre-question delivery claims remain authoritative.
        try {
          await requiredRecord(directory, `stage-${index}-claimed.json`);
          return false;
        } catch (cause) {
          if (!code(cause, 'ENOENT')) throw cause;
        }
        for (;;) {
          const state = await readControl();
          if (state.cancelled || state.claimed.includes(index)) return false;
          if (
            await saveControl({
              ...state,
              revision: state.revision + 1,
              claimed: [...state.claimed, index],
            })
          )
            return true;
        }
      }),
    read: () =>
      effect('read', async () => {
        try {
          return intentSchema.parse(await requiredRecord(directory, 'intent.json'));
        } catch (cause) {
          if (code(cause, 'ENOENT')) return null;
          throw cause;
        }
      }),
    reserve: (intent: Intent) =>
      effect('reserve', () => publish('intent.json', intentSchema.parse(intent))),
    claimLaunch: () => effect('claimLaunch', () => publish('launch-claimed.json', { version: 1 })),
  };
}

export function fileScheduleStore(
  directory: string
): import('../../capabilities/plan/index.js').ScheduleStore {
  const publish = publisher(directory);
  const effect = <A>(operation: string, work: () => Promise<A>) =>
    Effect.tryPromise({ try: work, catch: (cause) => new Unavailable({ operation, cause }) }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan('factory.store.schedule')
    );
  const read = async () => {
    let latest: import('../../capabilities/plan/index.js').ScheduleState = {
      revision: -1,
      concurrency: 1,
      allowance: 1,
      paused: false,
      admissions: [],
    };
    for (let revision = 0; ; revision++) {
      try {
        latest = scheduleSchema.parse(await requiredRecord(directory, `schedule-${revision}.json`));
      } catch (cause) {
        if (code(cause, 'ENOENT')) return latest;
        throw cause;
      }
    }
  };
  return {
    read: () => effect('read-schedule', read),
    save: (state) =>
      effect('save-schedule', async () => {
        if (state.revision !== (await read()).revision + 1) return false;
        return publish(`schedule-${state.revision}.json`, scheduleSchema.parse(state));
      }),
  };
}
