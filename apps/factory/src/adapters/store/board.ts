import { Effect } from 'effect';
import { and, eq, sql } from 'drizzle-orm';
import type { BoardStore } from '../../capabilities/board/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { stateConnection, v2Board, v2Commands } from '../../platform/index.js';
export function sqliteBoard(directory: string, scope = 'test'): BoardStore {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'v2-store', cause }),
    }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.v2.store'));
  return {
    read: () =>
      operation(() =>
        stateConnection(
          directory,
          (db) => db.select().from(v2Board).where(eq(v2Board.scope, scope)).get()?.value
        )
      ),
    save: (value, expectedCursor) =>
      operation(() =>
        stateConnection(directory, (db) =>
          db.transaction(
            (tx) => {
              const previous = tx
                .select()
                .from(v2Board)
                .where(eq(v2Board.scope, scope))
                .get()?.value;
              if ((previous?.snapshot.cursor ?? null) !== expectedCursor) return false;
              tx.insert(v2Board)
                .values({ scope, value })
                .onConflictDoUpdate({ target: v2Board.scope, set: { value } })
                .run();
              return true;
            },
            { behavior: 'immediate' }
          )
        )
      ),
    command: (id) =>
      operation(() =>
        stateConnection(directory, (db) =>
          db
            .select({
              request: v2Commands.request,
              receipt: v2Commands.receipt,
              basis: v2Commands.basis,
            })
            .from(v2Commands)
            .where(and(eq(v2Commands.id, id), eq(v2Commands.scope, scope)))
            .get()
        )
      ),
    accept: (record) =>
      operation(() =>
        stateConnection(
          directory,
          (db) =>
            db
              .insert(v2Commands)
              .values({ scope, id: record.request.commandId, ...record })
              .onConflictDoNothing()
              .run().changes === 1
        )
      ),
    claim: (record) =>
      operation(() =>
        stateConnection(
          directory,
          (db) =>
            db
              .update(v2Commands)
              .set({ receipt: record.receipt })
              .where(
                and(
                  eq(v2Commands.id, record.request.commandId),
                  eq(v2Commands.scope, scope),
                  sql`json_extract(${v2Commands.receipt}, '$.state') = 'accepted'`
                )
              )
              .run().changes === 1
        )
      ),
    finish: (record) =>
      operation(() =>
        stateConnection(directory, (db) => {
          const updated = db
            .update(v2Commands)
            .set({ receipt: record.receipt })
            .where(and(eq(v2Commands.id, record.request.commandId), eq(v2Commands.scope, scope)))
            .run();
          if (updated.changes !== 1) throw new Error('Missing command responsibility');
        })
      ),
    commands: () =>
      operation(() =>
        stateConnection(directory, (db) =>
          db
            .select({
              request: v2Commands.request,
              receipt: v2Commands.receipt,
              basis: v2Commands.basis,
            })
            .from(v2Commands)
            .where(eq(v2Commands.scope, scope))
            .all()
        )
      ),
  };
}
