import { and, eq, lte } from 'drizzle-orm';
import { Effect } from 'effect';
import type { ObservationCheckpoints } from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import {
  stateConnection,
  observationCheckpoints,
  observationEntities,
} from '../../platform/index.js';

export function sqliteObservationCheckpoints(directory: string): ObservationCheckpoints {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      // Drizzle's wrapper includes bound transcript values. Preserve the SQLite
      // diagnostic without exporting those private values in logs or traces.
      catch: (cause) =>
        new Unavailable({
          operation: 'observation-checkpoint',
          cause: cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause,
        }),
    }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.observation-checkpoint'));
  return {
    read: (stream) =>
      operation(() =>
        stateConnection(directory, (connection) =>
          connection.transaction((db) => {
            const row = db
              .select()
              .from(observationCheckpoints)
              .where(eq(observationCheckpoints.stream, stream))
              .get();
            if (!row) return null;
            const entities = db
              .select({ id: observationEntities.id, value: observationEntities.value })
              .from(observationEntities)
              .where(eq(observationEntities.stream, stream))
              .orderBy(observationEntities.id)
              .all();
            return {
              revision: row.revision,
              sequence: row.sequence,
              value: row.value,
              ...(entities.length ? { entities } : {}),
            };
          })
        )
      ),
    publish: (stream, expectedRevision, checkpoint) =>
      operation(() =>
        stateConnection(directory, (connection) =>
          connection.transaction((db) => {
            const updated =
              expectedRevision === 0
                ? db
                    .insert(observationCheckpoints)
                    .values({
                      stream,
                      revision: 1,
                      sequence: checkpoint.sequence,
                      value: checkpoint.value,
                    })
                    .onConflictDoNothing()
                    .run().changes === 1
                : db
                    .update(observationCheckpoints)
                    .set({
                      sequence: checkpoint.sequence,
                      value: checkpoint.value,
                      revision: expectedRevision + 1,
                    })
                    .where(
                      and(
                        eq(observationCheckpoints.stream, stream),
                        eq(observationCheckpoints.revision, expectedRevision),
                        lte(observationCheckpoints.sequence, checkpoint.sequence)
                      )
                    )
                    .run().changes === 1;
            if (!updated) return false;
            if (checkpoint.replaceEntities)
              db.delete(observationEntities).where(eq(observationEntities.stream, stream)).run();
            for (const entity of checkpoint.entities ?? []) {
              if (entity.value === null)
                db.delete(observationEntities)
                  .where(
                    and(
                      eq(observationEntities.stream, stream),
                      eq(observationEntities.id, entity.id)
                    )
                  )
                  .run();
              else
                db.insert(observationEntities)
                  .values({ stream, id: entity.id, value: entity.value })
                  .onConflictDoUpdate({
                    target: [observationEntities.stream, observationEntities.id],
                    set: { value: entity.value },
                  })
                  .run();
            }
            return true;
          })
        )
      ),
  };
}
