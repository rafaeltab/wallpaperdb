import { Effect, Layer } from 'effect';
import { PlanningSafety, ScheduleStore } from '../../src/capabilities/plan/index.js';
import { Unavailable } from '../../src/capabilities/job/index.js';

// These scheduler fixtures have no model ownership. Fail unexpected safety workflows;
// the real timeout, notice and acknowledgement policy is exercised through startup/HTTP.
export const controlledPlanningSafetyLayer = Layer.effect(
  PlanningSafety,
  Effect.gen(function* () {
    const schedule = yield* ScheduleStore;
    const unexpected = () =>
      Effect.fail(new Unavailable({ operation: 'unexpected-planning-safety-call', cause: null }));
    return {
      status: unexpected,
      mayLaunch: unexpected,
      failed: unexpected,
      configure: (command) =>
        Effect.gen(function* () {
          const current = yield* schedule.read();
          if (current.revision !== command.revision) return 'conflict' as const;
          return (yield* schedule.save({ ...current, ...command, revision: current.revision + 1 }))
            ? ('saved' as const)
            : ('conflict' as const);
        }),
    };
  })
);
