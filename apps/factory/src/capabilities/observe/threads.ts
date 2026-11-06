import { Effect, Layer, Semaphore } from 'effect';
import { Time } from '../job/index.js';
import {
  Threads,
  ThreadStore,
  ThreadSource,
  LocalSnapshot,
  ObservationStore,
  observationStaleAfterMs,
  type ThreadFacts,
} from './contract.js';
export const ThreadsLive = Layer.effect(
  Threads,
  Effect.gen(function* () {
    const store = yield* ThreadStore;
    const source = yield* ThreadSource;
    const time = yield* Time;
    const local = yield* LocalSnapshot;
    const github = yield* ObservationStore;
    const lock = yield* Semaphore.make(1);
    return {
      snapshot: () =>
        Effect.gen(function* () {
          const value = yield* store.read();
          const now = yield* time.now();
          const ageMs =
            value.observedAt === undefined ? undefined : Math.max(0, now - value.observedAt);
          const stale = ageMs !== undefined && ageMs > observationStaleAfterMs;
          const loading =
            value.startedAt !== undefined &&
            value.startedAt > Math.max(value.observedAt ?? -1, value.failedAt ?? -1);
          return {
            ...value,
            ageMs,
            stale,
            state: loading
              ? ('loading' as const)
              : value.error
                ? ('error' as const)
                : value.observedAt === undefined
                  ? ('initial' as const)
                  : stale
                    ? ('stale' as const)
                    : ('current' as const),
          };
        }),
      refresh: () =>
        Effect.gen(function* () {
          const previous = yield* store.read();
          const startedAt = yield* time.now();
          yield* store.save({ ...previous, startedAt });
          yield* source.read().pipe(
            Effect.flatMap((facts) =>
              Effect.gen(function* () {
                const { entries } = yield* local.read();
                const retained = yield* github.read();
                const observedAt = yield* time.now();
                yield* store.save({
                  startedAt,
                  observedAt,
                  facts: associate(facts, entries, retained),
                });
              })
            ),
            Effect.catch((error) =>
              Effect.flatMap(time.now(), (failedAt) =>
                store.save({ ...previous, startedAt, failedAt, error: error.operation })
              )
            )
          );
        }).pipe(lock.withPermits(1), Effect.withSpan('factory.threads.refresh')),
    } satisfies Threads;
  })
);

function associate(
  facts: ThreadFacts,
  entries: readonly import('./contract.js').LocalWork[],
  retained: import('./contract.js').ObservationState
): ThreadFacts {
  return {
    ...facts,
    threads: facts.threads.map((thread) => {
      const bindings = entries.flatMap(({ intent }) => {
        if (!intent) return [];
        const job = retained.jobs?.find((job) => job.kind === 'job' && job.intent.id === intent.id);
        return job?.kind === 'job' &&
          job.execution.kind === 'found' &&
          job.execution.threadId === thread.threadId
          ? [{ intent, execution: job.execution }]
          : [];
      });
      const associations: {
        issue: number;
        evidence: 'factory-binding' | 'github-closing-reference';
        observedAt: number | null;
      }[] = bindings.map((binding) => ({
        issue: binding.intent.issue,
        evidence: 'factory-binding' as const,
        observedAt: retained.jobsObservedAt ?? null,
      }));
      for (const pr of thread.pullRequests) {
        const observed = retained.facts?.pullRequests.find(
          (value) => value.number === pr.number && value.url === pr.url
        );
        for (const issue of observed?.linkedIssues ?? [])
          associations.push({
            issue,
            evidence: 'github-closing-reference',
            observedAt: retained.observedAt ?? null,
          });
      }
      const conflicting =
        bindings.length > 1 ||
        (new Set(associations.map((value) => value.issue)).size > 1 && bindings.length > 0);
      const binding = !conflicting ? bindings[0] : undefined;
      return {
        ...thread,
        branch: binding?.execution.branch ?? null,
        worktree: binding?.execution.worktree ?? null,
        associations,
        associationState: conflicting
          ? ('conflicting' as const)
          : associations.length
            ? ('evidenced' as const)
            : thread.pullRequests.length && !retained.facts
              ? ('unavailable' as const)
              : ('absent' as const),
      };
    }),
  };
}
