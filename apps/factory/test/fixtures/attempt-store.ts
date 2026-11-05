import { Effect } from 'effect';
import type { AttemptStore, PlanningAttempt } from '../../src/capabilities/plan/index.js';
export function controlledAttemptStore(): AttemptStore {
  const rows = new Map<string, PlanningAttempt>();
  return {
    pending: () =>
      Effect.sync(() =>
        [...rows.values()].find((row) => row.phase === 'discovery' || row.phase === 'freshness')
      ),
    get: (id) => Effect.sync(() => rows.get(id)),
    create: (attempt) =>
      Effect.sync(() => {
        if (rows.has(attempt.id) || [...rows.values()].some((row) => row.finishedAt === undefined))
          return false;
        rows.set(attempt.id, structuredClone(attempt));
        return true;
      }),
    save: (attempt) =>
      Effect.sync(() => {
        const current = rows.get(attempt.id);
        if (
          !current ||
          current.revision + 1 !== attempt.revision ||
          current.startedAt !== attempt.startedAt ||
          current.deadline !== attempt.deadline
        )
          return false;
        rows.set(attempt.id, structuredClone(attempt));
        return true;
      }),
  };
}
