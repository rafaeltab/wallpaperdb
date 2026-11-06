import { Effect } from 'effect';
import type { ThreadStore } from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { stateConnection, t3Observations } from '../../platform/index.js';
export function sqliteThreads(directory: string): ThreadStore {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'thread-store', cause }),
    }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.thread-store'));
  return {
    read: () =>
      operation(() =>
        stateConnection(directory, (db) => db.select().from(t3Observations).get()?.value ?? {})
      ),
    save: (value) =>
      operation(() =>
        stateConnection(directory, (db) => {
          db.insert(t3Observations)
            .values({ id: 1, value })
            .onConflictDoUpdate({ target: t3Observations.id, set: { value } })
            .run();
        })
      ),
  };
}
