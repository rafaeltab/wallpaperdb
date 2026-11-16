import { Effect } from 'effect';
import type {
  ObservationState,
  ObservationStore,
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
        let jobsObservedAt = value.jobsObservedAt;
        for (const item of updates) {
          const itemGeneration = item.generation ?? current;
          if (
            item.kind !== 'job' &&
            !(item.kind === 'failure' && item.key.startsWith('job:')) &&
            itemGeneration < completedGeneration
          )
            continue;
          const key =
            item.kind === 'failure'
              ? item.key
              : item.kind === 'job'
                ? `job:${item.value.intent.id}`
                : `${item.kind}:${item.value.number}`;
          const previous = items[key];
          if (item.kind === 'job') {
            const priorJob = jobs.get(item.value.intent.id);
            if ((priorJob?.stageIndex ?? -1) > (item.value.stageIndex ?? -1)) continue;
            const before = priorJob?.execution;
            const after = item.value.execution;
            if (
              priorJob?.stageIndex === item.value.stageIndex &&
              (before?.kind === 'found' || before?.kind === 'unverified') &&
              (after.kind === 'found' || after.kind === 'unverified') &&
              before.run?.id &&
              before.run.id === after.run?.id &&
              ['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
                before.status
              ) &&
              ['running', 'waiting', 'preparing', 'queued', 'starting'].includes(after.status)
            )
              continue;
            if (
              priorJob?.stageIndex === item.value.stageIndex &&
              (before?.kind === 'found' || before?.kind === 'unverified') &&
              (after.kind === 'found' || after.kind === 'unverified') &&
              before.run &&
              after.run &&
              before.run.ordinal > after.run.ordinal
            )
              continue;
          }
          if (
            previous &&
            (previous.generation > itemGeneration ||
              (previous.generation === itemGeneration && previous.sequence >= item.sequence))
          )
            continue;
          items[key] = {
            generation: itemGeneration,
            sequence: item.sequence,
            attemptedAt: item.at,
            ...(item.kind === 'failure'
              ? { observedAt: previous?.observedAt, failedAt: item.at, error: item.error }
              : { observedAt: item.at }),
          };
          if (item.kind === 'issue') issues.set(item.value.number, item.value);
          if (item.kind === 'pull') {
            const previousPull = pulls.get(item.value.number);
            pulls.set(item.value.number, {
              ...item.value,
              linkedIssues: [
                ...new Set([...(previousPull?.linkedIssues ?? []), ...item.value.linkedIssues]),
              ],
              crossReferencedIssues: [
                ...new Set([
                  ...(previousPull?.crossReferencedIssues ?? []),
                  ...item.value.crossReferencedIssues,
                ]),
              ],
            });
          }
          if (item.kind === 'job') {
            jobsObservedAt = Math.max(jobsObservedAt ?? 0, item.at);
            const previousJob = jobs.get(item.value.intent.id);
            jobs.set(item.value.intent.id, {
              ...item.value,
              acknowledgement: item.value.acknowledgement ?? previousJob?.acknowledgement,
            });
          }
        }
        value = {
          ...value,
          items,
          jobsObservedAt,
          facts: {
            ...value.facts,
            verifiedPrBases: value.facts?.verifiedPrBases?.filter((edge) =>
              [edge.base, edge.tip].every((n) => {
                const before = value.facts?.pullRequests.find((pr) => pr.number === n);
                const after = pulls.get(n);
                return before?.head === after?.head && before?.base === after?.base;
              })
            ),
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
          const acceptedPulls = facts.pullRequests;
          facts = {
            ...facts,
            verifiedPrBases: incoming.verifiedPrBases?.filter((edge) =>
              [edge.base, edge.tip].every((n) => {
                const collected = incoming.pullRequests.find((pr) => pr.number === n);
                const accepted = acceptedPulls.find((pr) => pr.number === n);
                return collected?.head === accepted?.head && collected?.base === accepted?.base;
              })
            ),
          };
          const items = { ...value.items };
          for (const [kind, observations] of [
            ['issue', facts.issues],
            ['pull', facts.pullRequests],
          ] as const) {
            for (const item of observations) {
              const key = `${kind}:${item.number}`;
              if ((items[key]?.generation ?? 0) > current) continue;
              items[key] = {
                generation: current,
                sequence: Number.MAX_SAFE_INTEGER,
                attemptedAt: update.observedAt ?? 0,
                observedAt: update.observedAt,
              };
            }
          }
          value = { ...value, items };
          completedGeneration = current;
        }
        const metadata = { ...update };
        delete metadata.generation;
        value = {
          ...value,
          ...metadata,
          ...(facts ? { facts } : {}),
          ...(update.observedAt !== undefined ? { error: undefined, failedAt: undefined } : {}),
        };
      }),
    jobs: (jobs, jobsObservedAt, recoveries) =>
      Effect.sync(() => {
        const current = new Map(
          value.jobs?.flatMap((job) => (job.kind === 'job' ? [[job.intent.id, job] as const] : []))
        );
        const incoming = jobs.map((job) =>
          job.kind === 'job' && value.items?.[`job:${job.intent.id}`]
            ? (current.get(job.intent.id) ?? job)
            : job
        );
        const present = new Set(
          incoming.flatMap((job) => (job.kind === 'job' ? [job.intent.id] : []))
        );
        for (const job of current.values())
          if (!present.has(job.intent.id) && value.items?.[`job:${job.intent.id}`])
            incoming.push(job);
        value = { ...value, jobs: incoming, jobsObservedAt, ...(recoveries ? { recoveries } : {}) };
      }),
  };
}
