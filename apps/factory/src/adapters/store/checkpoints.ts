import { and, eq, lte } from 'drizzle-orm';
import { Effect } from 'effect';
import type { ObservationCheckpoints } from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { stateConnection, observationCheckpoints } from '../../platform/index.js';

export function sqliteObservationCheckpoints(directory: string): ObservationCheckpoints {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'observation-checkpoint', cause }),
    }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.observation-checkpoint'));
  return {
    read: (stream) =>
      operation(() =>
        stateConnection(directory, (db) => {
          const row = db
            .select()
            .from(observationCheckpoints)
            .where(eq(observationCheckpoints.stream, stream))
            .get();
          return row ? { revision: row.revision, sequence: row.sequence, value: row.value } : null;
        })
      ),
    publish: (stream, expectedRevision, checkpoint) =>
      operation(() =>
        stateConnection(directory, (db) => {
          if (expectedRevision === 0)
            return (
              db
                .insert(observationCheckpoints)
                .values({
                  stream,
                  revision: 1,
                  ...checkpoint,
                })
                .onConflictDoNothing()
                .run().changes === 1
            );
          return (
            db
              .update(observationCheckpoints)
              .set({ ...checkpoint, revision: expectedRevision + 1 })
              .where(
                and(
                  eq(observationCheckpoints.stream, stream),
                  eq(observationCheckpoints.revision, expectedRevision),
                  lte(observationCheckpoints.sequence, checkpoint.sequence)
                )
              )
              .run().changes === 1
          );
        })
      ),
  };
}
