import { and, asc, count, desc, eq, isNull, like, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Effect } from 'effect';
import { z } from 'zod';
import {
  initialScheduleState,
  type PlanningSafetyStore,
  type PlanningNotice,
} from '../../capabilities/plan/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import {
  stateConnection,
  records,
  scheduleSchema,
  planningSafety as safety,
  planningNotices as notices,
  planningDeadlineFailures as failures,
} from '../../platform/index.js';

const timestamp = z.number().int().nonnegative().safe();
const failureSchema = z
  .object({
    attemptId: z.string().min(1),
    code: z.literal('model-deadline'),
    message: z.string().min(1).max(1000),
    attemptStartedAt: timestamp,
    modelHandedOffAt: timestamp,
    deadline: timestamp,
    failedAt: timestamp,
    attemptElapsedMs: timestamp,
    modelElapsedMs: timestamp,
    threadId: z.string().min(1).nullable(),
    runId: z.string().min(1).nullable(),
  })
  .strict();
const safetySchema = z.object({
  version: z.number().int().nonnegative().safe(),
  consecutiveModelDeadlineFailures: z.number().int().min(0).max(3),
  currentNoticeId: z.string().nullable(),
});
type Reader = Pick<BetterSQLite3Database, 'select'>;
const readState = (db: Reader) => {
  const row = db.select().from(safety).where(eq(safety.id, 1)).get();
  return safetySchema.parse(
    row ?? {
      version: 0,
      consecutiveModelDeadlineFailures: 0,
      currentNoticeId: null,
    }
  );
};
const readSchedule = (db: Reader, namespace: string) => {
  const row = db
    .select()
    .from(records)
    .where(and(eq(records.namespace, namespace), like(records.name, 'schedule-%.json')))
    .orderBy(desc(sql`json_extract(${records.value}, '$.revision')`))
    .limit(1)
    .get();
  return row ? scheduleSchema.parse(row.value) : initialScheduleState;
};
const readNotice = (
  db: Reader,
  row: typeof notices.$inferSelect | undefined
): PlanningNotice | null => {
  if (!row) return null;
  const items = db
    .select()
    .from(failures)
    .where(eq(failures.noticeId, row.id))
    .orderBy(asc(failures.position))
    .limit(3)
    .all();
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    failures: items.map((item) => failureSchema.parse(item.value)),
  };
};

export function sqlitePlanningSafety(directory: string): PlanningSafetyStore {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'planning-safety-store', cause }),
    }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan('factory.planning.safety-store')
    );
  return {
    read: (attemptId) =>
      operation(() =>
        stateConnection(directory, (db, namespace) =>
          db.transaction((tx) => {
            const state = readState(tx);
            const current = state.currentNoticeId
              ? tx.select().from(notices).where(eq(notices.id, state.currentNoticeId)).get()
              : undefined;
            const pending = tx
              .select()
              .from(notices)
              .where(isNull(notices.acknowledgedAt))
              .orderBy(asc(notices.sequence))
              .limit(1)
              .get();
            const displayed =
              pending ?? tx.select().from(notices).orderBy(desc(notices.sequence)).limit(1).get();
            return {
              state,
              schedule: readSchedule(tx, namespace),
              currentNotice: readNotice(tx, current),
              displayedNotice: readNotice(tx, displayed),
              pendingNoticeCount:
                tx
                  .select({ value: count() })
                  .from(notices)
                  .where(isNull(notices.acknowledgedAt))
                  .get()?.value ?? 0,
              failureRecorded:
                !!attemptId &&
                !!tx
                  .select({ id: failures.attemptId })
                  .from(failures)
                  .where(eq(failures.attemptId, attemptId))
                  .get(),
            };
          })
        )
      ),
    commit: (change) =>
      operation(() =>
        stateConnection(directory, (db, namespace) =>
          db.transaction(
            (tx) => {
              if (
                change.failure &&
                tx
                  .select({ id: failures.attemptId })
                  .from(failures)
                  .where(eq(failures.attemptId, change.failure.attemptId))
                  .get()
              )
                return 'duplicate' as const;
              if (
                readState(tx).version !== change.expectedVersion ||
                readSchedule(tx, namespace).revision !== change.expectedScheduleRevision
              )
                return 'conflict' as const;
              const state = safetySchema.parse(change.state);
              if (state.version !== change.expectedVersion + 1)
                throw new Error('Invalid planning safety revision');
              if (change.notice) {
                const notice = change.notice;
                const current = tx.select().from(notices).where(eq(notices.id, notice.id)).get();
                if (current?.version !== change.expectedNoticeVersion) return 'conflict' as const;
                if (
                  notice.version !== (current?.version ?? 0) + 1 ||
                  notice.failures.length < 1 ||
                  notice.failures.length > 3
                )
                  throw new Error('Invalid planning notice revision or bound');
                const value = {
                  id: notice.id,
                  version: notice.version,
                  createdAt: notice.createdAt,
                  acknowledgedAt: notice.acknowledgedAt,
                };
                if (current) tx.update(notices).set(value).where(eq(notices.id, notice.id)).run();
                else tx.insert(notices).values(value).run();
                if (change.failure)
                  tx.insert(failures)
                    .values({
                      attemptId: change.failure.attemptId,
                      noticeId: notice.id,
                      position: notice.failures.length,
                      value: failureSchema.parse(change.failure),
                    })
                    .run();
              }
              tx.insert(safety)
                .values({ id: 1, ...state })
                .onConflictDoUpdate({ target: safety.id, set: state })
                .run();
              if (change.schedule) {
                const next = scheduleSchema.parse(change.schedule);
                if (next.revision !== change.expectedScheduleRevision + 1)
                  throw new Error('Invalid schedule revision');
                if (
                  tx
                    .insert(records)
                    .values({ namespace, name: `schedule-${next.revision}.json`, value: next })
                    .onConflictDoNothing()
                    .run().changes !== 1
                )
                  throw new Error('Schedule changed concurrently');
              }
              return 'saved' as const;
            },
            { behavior: 'immediate' }
          )
        )
      ),
  };
}
