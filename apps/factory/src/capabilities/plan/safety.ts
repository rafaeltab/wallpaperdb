import { Effect, Layer } from 'effect';
import { Unavailable } from '../job/index.js';
import { PlanningSafety, PlanningSafetyStore } from './safety-contract.js';

export const PlanningSafetyLive = Layer.effect(
  PlanningSafety,
  Effect.gen(function* () {
    const store = yield* PlanningSafetyStore;
    return {
      status: () =>
        Effect.map(store.read(), (snapshot) => ({
          schedule: snapshot.schedule,
          planning: {
            maximumAttempts: 3 as const,
            consecutiveModelDeadlineFailures: snapshot.state.consecutiveModelDeadlineFailures,
            pendingNoticeCount: snapshot.pendingNoticeCount,
            notice: snapshot.displayedNotice,
          },
        })),
      mayLaunch: () =>
        Effect.map(
          store.read(),
          (snapshot) =>
            !snapshot.schedule.paused && snapshot.state.consecutiveModelDeadlineFailures < 3
        ),
      failed: (failure) =>
        Effect.gen(function* () {
          for (;;) {
            const snapshot = yield* store.read(failure.attemptId);
            if (snapshot.failureRecorded) return;
            const count = snapshot.state.consecutiveModelDeadlineFailures + 1;
            if (count > 3)
              return yield* Effect.fail(
                new Unavailable({ operation: 'planning-attempt-limit', cause: null })
              );
            const previous = snapshot.currentNotice;
            const notice = {
              id: previous?.id ?? failure.attemptId,
              version: (previous?.version ?? 0) + 1,
              createdAt: previous?.createdAt ?? failure.failedAt,
              acknowledgedAt: null,
              failures: [...(previous?.failures ?? []), failure],
            };
            const result = yield* store.commit({
              expectedVersion: snapshot.state.version,
              expectedScheduleRevision: snapshot.schedule.revision,
              state: {
                version: snapshot.state.version + 1,
                consecutiveModelDeadlineFailures: count,
                currentNoticeId: notice.id,
              },
              notice,
              expectedNoticeVersion: previous?.version,
              failure,
              schedule:
                count === 3 && !snapshot.schedule.paused
                  ? { ...snapshot.schedule, revision: snapshot.schedule.revision + 1, paused: true }
                  : undefined,
            });
            if (result !== 'conflict') return;
          }
        }).pipe(Effect.withSpan('factory.planning.deadline-failure')),
    };
  })
);
