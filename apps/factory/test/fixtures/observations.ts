import { Effect } from 'effect';
import type {
  ObservationStore,
  ObservationState,
  ReportingStore,
} from '../../src/capabilities/observe/index.js';
/** Stateful controlled persistence with the same replacement/retention guarantees as SQLite. */
export function controlledObservations(
  initial: ObservationState = {}
): ObservationStore & ReportingStore {
  let value = initial;
  let generation = 0;
  let completedGeneration = 0;
  return {
    begin: () => Effect.sync(() => ++generation),
    publish: (current, updates) =>
      Effect.sync(() => {
        const items = { ...value.items };
        const issues = new Map(value.facts?.issues.map((item) => [item.number, item]));
        const pulls = new Map(value.facts?.pullRequests.map((item) => [item.number, item]));
        const jobs = new Map(
          value.jobs?.flatMap((item) =>
            item.kind === 'job' ? [[item.intent.id, item] as const] : []
          )
        );
        for (const item of updates) {
          if (item.kind !== 'job' && current < completedGeneration) continue;
          const key =
            item.kind === 'failure'
              ? item.key
              : item.kind === 'job'
                ? `job:${item.value.intent.id}`
                : `${item.kind}:${item.value.number}`;
          const previous = items[key];
          if (
            previous &&
            (previous.generation > current ||
              (previous.generation === current && previous.sequence >= item.sequence))
          )
            continue;
          items[key] = {
            generation: current,
            sequence: item.sequence,
            attemptedAt: item.at,
            ...(item.kind === 'failure'
              ? { observedAt: previous?.observedAt, failedAt: item.at, error: item.error }
              : { observedAt: item.at }),
          };
          if (item.kind === 'issue') issues.set(item.value.number, item.value);
          if (item.kind === 'pull') pulls.set(item.value.number, item.value);
          if (item.kind === 'job') jobs.set(item.value.intent.id, item.value);
        }
        value = {
          ...value,
          items,
          facts: {
            ...value.facts,
            issues: [...issues.values()],
            pullRequests: [...pulls.values()],
          },
          jobs: [...jobs.values()],
        };
      }),
    read: () => Effect.sync(() => value),
    refresh: (update) =>
      Effect.sync(() => {
        if (update.generation !== undefined && update.generation < completedGeneration) return;
        let facts = update.facts;
        if (facts && update.generation !== undefined) {
          const incoming = facts;
          const current = update.generation;
          const newerIssues =
            value.facts?.issues.filter(
              (item) => (value.items?.[`issue:${item.number}`]?.generation ?? 0) > current
            ) ?? [];
          const newerPulls =
            value.facts?.pullRequests.filter(
              (item) => (value.items?.[`pull:${item.number}`]?.generation ?? 0) > current
            ) ?? [];
          facts = {
            ...incoming,
            issues: [
              ...incoming.issues.filter(
                (item) => !newerIssues.some((old) => old.number === item.number)
              ),
              ...newerIssues,
            ],
            pullRequests: [
              ...incoming.pullRequests.filter(
                (item) => !newerPulls.some((old) => old.number === item.number)
              ),
              ...newerPulls,
            ],
          };
          completedGeneration = current;
        }
        value = {
          ...value,
          ...update,
          ...(facts ? { facts } : {}),
          ...(update.observedAt !== undefined ? { error: undefined, failedAt: undefined } : {}),
        };
      }),
    jobs: (jobs, jobsObservedAt, recoveries) =>
      Effect.sync(() => {
        value = { ...value, jobs, jobsObservedAt, ...(recoveries ? { recoveries } : {}) };
      }),
  };
}
