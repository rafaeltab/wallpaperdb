import { Effect, Option } from 'effect';
import type { ScheduleState, ScheduleStore } from '../../src/capabilities/plan/index.js';
export function controlledScheduleStore(
  currentJob?: (
    issue: number,
    generation: number
  ) => { jobId: string; revision: number; cancelled: boolean } | undefined
): ScheduleStore {
  let state: ScheduleState = {
    revision: -1,
    concurrency: 1,
    allowance: 1,
    paused: false,
    admissions: [],
  };
  let owned = false;
  return {
    withCycle: (work) =>
      Effect.suspend(() => {
        if (owned) return Effect.succeed(Option.none());
        owned = true;
        return work.pipe(
          Effect.map(Option.some),
          Effect.ensuring(
            Effect.sync(() => {
              owned = false;
            })
          )
        );
      }),
    read: () => Effect.sync(() => state),
    save: (next, guards) =>
      Effect.sync(() => {
        if (next.revision !== state.revision + 1) return false;
        if (
          guards?.some((guard) => {
            const current = currentJob?.(guard.issue, guard.generation ?? 0);
            return (
              !current ||
              current.cancelled ||
              current.jobId !== guard.jobId ||
              current.revision !== guard.controlRevision
            );
          })
        )
          return false;
        state = next;
        return true;
      }),
  };
}
