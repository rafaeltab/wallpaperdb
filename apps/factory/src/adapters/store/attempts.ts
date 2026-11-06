import { and, eq, inArray, desc } from 'drizzle-orm';
import { Effect } from 'effect';
import { z } from 'zod';
import type { AttemptStore, PlanningAttempt } from '../../capabilities/plan/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { stateConnection, planningAttempts as table } from '../../platform/index.js';
const numbers = z.array(z.number().int().positive().safe());
const resultSchema = z
  .object({
    kind: z.enum(['preview', 'stale']),
    selected: z.array(
      z
        .object({
          issue: z.number().int().positive(),
          reason: z.string(),
          dependsOn: numbers,
          conflicts: numbers,
        })
        .strict()
    ),
    rejected: z.array(
      z.object({ issue: z.number().int().nonnegative(), reason: z.string() }).strict()
    ),
    input: z
      .object({
        issues: z.array(
          z
            .object({
              number: z.number().int().positive(),
              title: z.string(),
              blockers: numbers,
              parents: numbers,
              recovery: z
                .object({
                  progress: z.string(),
                  active: z.boolean().optional(),
                  classification: z.enum(['SIMPLE', 'COMPLEX']).optional(),
                  threadId: z.string().optional(),
                  question: z.string().optional(),
                })
                .strict()
                .optional(),
            })
            .strict()
        ),
      })
      .strict(),
  })
  .strict();
const schema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    startedAt: z.number().finite(),
    deadline: z.number().finite(),
    phase: z.enum(['discovery', 'handoff', 'freshness', 'succeeded', 'failed']),
    finishedAt: z.number().finite().optional(),
    detail: z.string().max(1000).optional(),
    result: resultSchema.optional(),
  })
  .strict();
export function sqliteAttemptStore(directory: string): AttemptStore {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'attempt-store', cause }),
    }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan('factory.attempt-store')
    );
  const translate = (row: typeof table.$inferSelect | undefined) =>
    row
      ? schema.parse({
          id: row.id,
          revision: row.revision,
          startedAt: row.startedAt,
          deadline: row.deadline,
          phase: row.phase,
          finishedAt: row.finishedAt ?? undefined,
          detail: row.detail ?? undefined,
          result: row.result ?? undefined,
        })
      : undefined;
  return {
    latest: () =>
      operation(() =>
        stateConnection(directory, (db) =>
          translate(db.select().from(table).orderBy(desc(table.startedAt)).limit(1).get())
        )
      ),
    pending: () =>
      operation(() =>
        stateConnection(directory, (db) =>
          translate(
            db
              .select()
              .from(table)
              .where(inArray(table.phase, ['discovery', 'handoff', 'freshness']))
              .get()
          )
        )
      ),
    get: (id) =>
      operation(() =>
        stateConnection(directory, (db) =>
          translate(db.select().from(table).where(eq(table.id, id)).get())
        )
      ),
    create: (attempt) =>
      operation(() =>
        stateConnection(directory, (db) => {
          const parsed = schema.parse(attempt);
          if (parsed.revision !== 0 || parsed.phase !== 'discovery')
            throw new Error('Invalid initial attempt');
          return db.insert(table).values(parsed).onConflictDoNothing().run().changes === 1;
        })
      ),
    save: (attempt) =>
      operation(() =>
        stateConnection(directory, (db) => {
          const parsed: PlanningAttempt = schema.parse(attempt);
          return (
            db
              .update(table)
              .set({
                revision: parsed.revision,
                phase: parsed.phase,
                finishedAt: parsed.finishedAt,
                detail: parsed.detail,
                result: parsed.result,
              })
              .where(
                and(
                  eq(table.id, parsed.id),
                  eq(table.revision, parsed.revision - 1),
                  eq(table.startedAt, parsed.startedAt),
                  eq(table.deadline, parsed.deadline)
                )
              )
              .run().changes === 1
          );
        })
      ),
  };
}
