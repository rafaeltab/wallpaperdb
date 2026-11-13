import { Effect, Option } from 'effect';
import type { ScheduleState, ScheduleStore } from '../../src/capabilities/plan/index.js';
export function controlledScheduleStore(): ScheduleStore {
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
    save: (next) =>
      Effect.sync(() => {
        if (next.revision !== state.revision + 1) return false;
        state = next;
        return true;
      }),
  };
}
