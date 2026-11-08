import { Effect, Layer, Semaphore } from 'effect';
import { Time, attemptIntent } from '../job/index.js';
import {
  Observations,
  ObservationStore,
  ObservationSource,
  LocalSnapshot,
  observationStaleAfterMs,
} from './contract.js';
export const ObservationsLive = Layer.effect(
  Observations,
  Effect.gen(function* () {
    const store = yield* ObservationStore;
    const source = yield* ObservationSource;
    const local = yield* LocalSnapshot;
    const time = yield* Time;
    const lock = yield* Semaphore.make(1);
    return {
      snapshot: () =>
        Effect.gen(function* () {
          const value = yield* store.read();
          const now = yield* time.now();
          return dated(value, now);
        }),
      schedule: () =>
        Effect.gen(function* () {
          const { state, entries } = yield* local.read();
          const retained = yield* store.read();
          const now = yield* time.now();
          const jobs = entries.map(({ intent, control }): import('../job/index.js').Status => {
            if (!intent) return { kind: 'empty' };
            const prior = retained.jobs?.find(
              (value) => value.kind === 'job' && value.intent.id === intent.id
            );
            const resume = prior?.kind === 'job' ? prior.resume : undefined;
            const validResume =
              resume &&
              ('revision' in resume
                ? resume.revision === control.revision
                : resume.questionId === control.parked?.question.id &&
                  resume.index === control.parked.index);
            return {
              ...(prior?.kind === 'job'
                ? prior
                : { kind: 'job' as const, execution: { kind: 'ambiguous' as const } }),
              intent: {
                ...intent,
                branch: attemptIntent(intent, control.restart?.index ?? 0).branch,
              },
              elapsedMs: Math.max(0, now - intent.createdAt),
              prerequisite: control.cancelled ? undefined : control.prerequisite,
              delivery:
                prior?.kind === 'job' && prior.delivery && control.cancelled
                  ? { ...prior.delivery, activity: 'cancelled', active: false, ready: false }
                  : prior?.kind === 'job'
                    ? prior.delivery
                    : undefined,
              resume: !control.cancelled && validResume ? resume : undefined,
            };
          });
          return {
            state,
            jobs,
            observations: dated(retained, now),
            recoveries: retained.recoveries,
            localWork: entries,
            relationships: retained.facts?.issues.map((i) => ({
              issue: i.number,
              blockers: i.blockers,
            })),
          };
        }),
      refresh: () =>
        Effect.gen(function* () {
          const startedAt = yield* time.now();
          yield* store.refresh({ startedAt });
          yield* source.read().pipe(
            Effect.flatMap((facts) =>
              Effect.flatMap(time.now(), (observedAt) =>
                store.refresh({ startedAt, observedAt, facts })
              )
            ),
            Effect.catch((error) =>
              Effect.flatMap(time.now(), (failedAt) =>
                store.refresh({ startedAt, failedAt, error: error.operation })
              )
            )
          );
        }).pipe(lock.withPermits(1), Effect.withSpan('factory.observations.refresh')),
    } satisfies Observations;
  })
);

function dated(value: import('./contract.js').ObservationState, now: number) {
  const loading =
    value.startedAt !== undefined &&
    value.startedAt > Math.max(value.observedAt ?? -1, value.failedAt ?? -1);
  const state: 'loading' | 'error' | 'initial' | 'stale' | 'current' = loading
    ? 'loading'
    : value.error
      ? 'error'
      : value.observedAt === undefined
        ? 'initial'
        : now - value.observedAt > observationStaleAfterMs
          ? 'stale'
          : 'current';
  const ageMs = value.observedAt === undefined ? undefined : Math.max(0, now - value.observedAt);
  return { ...value, state, ageMs, stale: ageMs !== undefined && ageMs > observationStaleAfterMs };
}
