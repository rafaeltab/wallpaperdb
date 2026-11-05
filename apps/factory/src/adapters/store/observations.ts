import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import type { ObservationStore } from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import {
  stateConnection,
  githubIssues,
  githubPulls,
  observationRefresh as table,
} from '../../platform/index.js';
export function sqliteObservations(directory: string): ObservationStore {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'observation-store', cause }),
    }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.observation-store'));
  return {
    read: () =>
      operation(() =>
        stateConnection(directory, (db) => {
          const row = db.select().from(table).where(eq(table.id, 1)).get();
          return {
            startedAt: row?.startedAt ?? undefined,
            observedAt: row?.observedAt ?? undefined,
            failedAt: row?.failedAt ?? undefined,
            error: row?.error ?? undefined,
            facts:
              row?.observedAt == null
                ? undefined
                : {
                    issues: db.select().from(githubIssues).all(),
                    pullRequests: db.select().from(githubPulls).all(),
                  },
            jobs: row?.jobs ?? undefined,
            recoveries: row?.recoveries ?? undefined,
            jobsObservedAt: row?.jobsObservedAt ?? undefined,
          };
        })
      ),
    refresh: (value) =>
      operation(() =>
        stateConnection(directory, (db) =>
          db.transaction((tx) => {
            const changes = {
              startedAt: value.startedAt,
              ...(value.observedAt !== undefined
                ? { observedAt: value.observedAt, failedAt: null, error: null }
                : {}),
              ...(value.failedAt !== undefined
                ? { failedAt: value.failedAt, error: value.error }
                : {}),
            };
            if (value.facts) {
              tx.delete(githubIssues).run();
              tx.delete(githubPulls).run();
              for (const issue of value.facts.issues) tx.insert(githubIssues).values(issue).run();
              for (const pr of value.facts.pullRequests) tx.insert(githubPulls).values(pr).run();
            }
            tx.insert(table)
              .values({ id: 1, ...changes })
              .onConflictDoUpdate({ target: table.id, set: changes })
              .run();
          })
        )
      ),
    jobs: (jobs, jobsObservedAt, recoveries) =>
      operation(() =>
        stateConnection(directory, (db) => {
          db.insert(table)
            .values({ id: 1, jobs, jobsObservedAt, recoveries })
            .onConflictDoUpdate({ target: table.id, set: { jobs, jobsObservedAt, recoveries } })
            .run();
        })
      ),
  };
}

/** The scheduler publishes only facts it has completely observed, independent of later planning. */
export function sqliteScheduleObservations(
  directory: string,
  time: import('../../capabilities/job/index.js').Time
): import('../../capabilities/plan/index.js').ScheduleObservations {
  const store = sqliteObservations(directory);
  return {
    publish: (snapshot) =>
      Effect.flatMap(time.now(), (now) => store.jobs(snapshot.jobs, now, snapshot.recoveries)),
  };
}
