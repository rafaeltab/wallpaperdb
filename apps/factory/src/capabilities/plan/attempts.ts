import { Effect, Layer } from 'effect';
import { Time, Unavailable } from '../job/index.js';
import {
  Attempts,
  AttemptStore,
  Plan,
  IPlanner,
  type PlanningAttempt,
  type PlannerOwnership,
} from './contract.js';
export const AttemptsLive = Layer.effect(
  Attempts,
  Effect.gen(function* () {
    const store = yield* AttemptStore;
    const plan = yield* Plan;
    const planner = yield* IPlanner;
    const time = yield* Time;
    const conflict = () =>
      Effect.fail(new Unavailable({ operation: 'attempt-conflict', cause: null }));
    const save = (attempt: PlanningAttempt) =>
      store.save(attempt).pipe(Effect.flatMap((saved) => (saved ? Effect.void : conflict())));
    const pending = () => store.pending();
    return {
      pending,
      submit: (id) =>
        Effect.gen(function* () {
          const startedAt = yield* time.now();
          const existing = yield* pending();
          if (existing) return { kind: 'busy' as const, id: existing.id };
          // A bound worker can finish after a deadline. Reconcile it before deciding busy.
          const ownership = yield* planner.ownership().pipe(
            Effect.timeoutOrElse({
              duration: 1000,
              orElse: () =>
                Effect.fail(
                  new Unavailable({ operation: 'planner-observation-timeout', cause: null })
                ),
            })
          );
          if (ownership && !ownership.retired) {
            const known = yield* store.get(ownership.requestId);
            return known
              ? { kind: 'busy' as const, id: known.id }
              : {
                  kind: 'blocked' as const,
                  requestId: ownership.requestId,
                  reason: ownership.run
                    ? ('outstanding' as const)
                    : ('reconciliation-required' as const),
                };
          }
          const attempt: PlanningAttempt = {
            id,
            revision: 0,
            startedAt,
            deadline: startedAt + 600000,
            phase: 'discovery',
          };
          const created = yield* store.create(attempt);
          if (created) return { kind: 'accepted' as const, id: attempt.id };
          const winner = yield* store.pending();
          const same = winner ?? (yield* store.get(id));
          return same ? { kind: 'busy' as const, id: same.id } : { kind: 'conflict' as const };
        }),
      observe: (id) =>
        Effect.gen(function* () {
          const attempt = yield* store.get(id);
          if (!attempt) return undefined;
          const ownership = yield* planner.ownership(false, id);
          const launch = ownership?.requestId === id ? ownership : undefined;
          const now = yield* time.now();
          return {
            ...attempt,
            phase:
              attempt.phase === 'discovery' &&
              launch &&
              launch.phase !== 'succeeded' &&
              launch.phase !== 'failed'
                ? (launch.phase ?? (launch.run ? 'running' : 'uncertain'))
                : attempt.phase,
            elapsedMs: Math.max(0, (attempt.finishedAt ?? now) - attempt.startedAt),
            launch,
          };
        }),
      execute: (id) =>
        Effect.gen(function* () {
          const attempt = yield* store.get(id);
          if (!attempt || attempt.finishedAt !== undefined) return;
          const original = attempt;
          const operation = Effect.gen(function* () {
            const now = yield* time.now();
            if (now >= original.deadline)
              return yield* Effect.fail(
                new Unavailable({ operation: 'planning-deadline', cause: null })
              );
            const result = yield* plan
              .preview({
                requestId: id,
                deadline: original.deadline,
                progress: (phase) =>
                  Effect.gen(function* () {
                    const current = yield* store.get(id);
                    if (!current) return yield* conflict();
                    yield* save({ ...current, revision: current.revision + 1, phase });
                  }),
              })
              .pipe(
                Effect.timeoutOrElse({
                  duration: original.deadline - now,
                  orElse: () =>
                    Effect.fail(new Unavailable({ operation: 'planning-deadline', cause: null })),
                })
              );
            const current = yield* store.get(id);
            if (!current) return yield* conflict();
            yield* save({
              ...current,
              revision: current.revision + 1,
              phase: 'succeeded',
              finishedAt: yield* time.now(),
              result: {
                kind: result.kind,
                selected: result.selected,
                rejected: result.rejected,
                input: {
                  issues: result.input.issues.map(
                    ({ number, title, blockers, parents, recovery }) => ({
                      number,
                      title,
                      blockers,
                      parents,
                      recovery,
                    })
                  ),
                },
              },
            });
          });
          yield* operation.pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                const current = yield* store.get(id);
                if (!current) return yield* conflict();
                const ownership = yield* planner.ownership(false, id);
                yield* save({
                  ...current,
                  revision: current.revision + 1,
                  phase: 'failed',
                  finishedAt: yield* time.now(),
                  detail:
                    error.operation === 'planning-deadline'
                      ? deadlineDetail(
                          current.phase,
                          ownership?.requestId === id ? ownership : undefined
                        )
                      : ownership?.requestId === id && ownership.detail
                        ? ownership.detail
                        : 'Planning dependency failed. No implementation dispatched.',
                });
              })
            )
          );
        }).pipe(Effect.withSpan('factory.planning.attempt')),
    };
  })
);

function deadlineDetail(phase: PlanningAttempt['phase'], ownership?: PlannerOwnership) {
  if (ownership && !ownership.retired) {
    return ownership.run
      ? 'Overall planning deadline exceeded. This attempt has a bound advisory run whose launch ownership remains outstanding; observe the run before retrying.'
      : 'Overall planning deadline exceeded after launch intent. This attempt has an uncertain launch outcome; operator reconciliation is required before retrying.';
  }
  if (phase === 'freshness')
    return 'Overall planning deadline exceeded during freshness validation. The advisory proposal is not validated; no implementation was dispatched.';
  if (ownership?.run)
    return 'Overall planning deadline exceeded after the advisory run. Its launch ownership is retired; no validated preview is available.';
  if (ownership)
    return "Overall planning deadline exceeded before a planner run was bound. This attempt's launch ownership is retired; no launch reconciliation is required.";
  if (phase === 'handoff')
    return 'Overall planning deadline exceeded during handoff before recorded launch ownership. No planner launch was recorded; no launch reconciliation is required.';
  return 'Overall planning deadline exceeded during discovery before planner launch. No planner launch was recorded for this attempt; no launch reconciliation is required.';
}
