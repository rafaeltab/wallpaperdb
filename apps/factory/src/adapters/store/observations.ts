import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import type { ObservationStore, ReportingStore } from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import {
  stateConnection,
  githubRichFacts,
  githubIssues,
  githubPulls,
  observationRefresh as table,
} from '../../platform/index.js';
export function sqliteObservations(directory: string): ObservationStore & ReportingStore {
  const operation = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) => new Unavailable({ operation: 'observation-store', cause }),
    }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.observation-store'));
  return {
    begin: () =>
      operation(() =>
        stateConnection(directory, (db) =>
          db.transaction((tx) => {
            const prior = tx
              .select()
              .from(githubRichFacts)
              .where(eq(githubRichFacts.id, 1))
              .get()?.value;
            const generation = (prior?.reporting?.generation ?? 0) + 1;
            const value = {
              observedAt: 0,
              facts: { issues: [], pullRequests: [] },
              ...prior,
              reporting: { ...prior?.reporting, generation, items: prior?.reporting?.items ?? {} },
            };
            tx.insert(githubRichFacts)
              .values({ id: 1, value })
              .onConflictDoUpdate({ target: githubRichFacts.id, set: { value } })
              .run();
            return generation;
          })
        )
      ),
    publish: (generation, items) =>
      operation(() =>
        stateConnection(directory, (db) =>
          db.transaction((tx) => {
            const prior = tx
              .select()
              .from(githubRichFacts)
              .where(eq(githubRichFacts.id, 1))
              .get()?.value;
            if (!prior?.reporting || generation > prior.reporting.generation)
              throw new Error('Unknown reporting generation');
            const row = tx.select().from(table).where(eq(table.id, 1)).get();
            const freshness = { ...prior.reporting.items };
            const issues = new Map(prior.facts.issues.map((item) => [item.number, item]));
            const pulls = new Map(prior.facts.pullRequests.map((item) => [item.number, item]));
            const jobs = new Map(
              (row?.jobs ?? []).flatMap((item) =>
                item.kind === 'job' ? [[item.intent.id, item] as const] : []
              )
            );
            let jobsObservedAt = row?.jobsObservedAt;
            for (const item of items) {
              const itemGeneration = item.generation ?? generation;
              if (itemGeneration > prior.reporting.generation)
                throw new Error('Unknown item generation');
              if (
                item.kind !== 'job' &&
                !(item.kind === 'failure' && item.key.startsWith('job:')) &&
                itemGeneration < (prior.reporting.completedGeneration ?? 0)
              )
                continue;
              const key =
                item.kind === 'failure'
                  ? item.key
                  : item.kind === 'job'
                    ? `job:${item.value.intent.id}`
                    : `${item.kind}:${item.value.number}`;
              const previous = freshness[key];
              if (item.kind === 'job') {
                const priorJob = jobs.get(item.value.intent.id);
                if ((priorJob?.stageIndex ?? -1) > (item.value.stageIndex ?? -1)) continue;
                const before = priorJob?.execution;
                const after = item.value.execution;
                if (
                  priorJob?.stageIndex === item.value.stageIndex &&
                  before?.kind === 'found' &&
                  after.kind === 'found' &&
                  before.run &&
                  after.run &&
                  before.run.ordinal > after.run.ordinal
                )
                  continue;
              }
              if (
                previous &&
                (previous.generation > itemGeneration ||
                  (previous.generation === itemGeneration && previous.sequence >= item.sequence))
              )
                continue;
              freshness[key] = {
                generation: itemGeneration,
                sequence: item.sequence,
                attemptedAt: item.at,
                ...(item.kind === 'failure'
                  ? { observedAt: previous?.observedAt, failedAt: item.at, error: item.error }
                  : { observedAt: item.at }),
              };
              if (item.kind === 'issue') issues.set(item.value.number, item.value);
              if (item.kind === 'pull') {
                const before = pulls.get(item.value.number);
                pulls.set(item.value.number, {
                  ...item.value,
                  crossReferencedIssues: [
                    ...new Set([
                      ...(before?.crossReferencedIssues ?? []),
                      ...item.value.crossReferencedIssues,
                    ]),
                  ],
                });
              }
              if (item.kind === 'job') {
                const priorJob = jobs.get(item.value.intent.id);
                jobs.set(item.value.intent.id, {
                  ...item.value,
                  acknowledgement: item.value.acknowledgement ?? priorJob?.acknowledgement,
                });
                jobsObservedAt = Math.max(jobsObservedAt ?? 0, item.at);
              }
            }
            const value = {
              ...prior,
              facts: {
                ...prior.facts,
                verifiedPrBases: prior.facts.verifiedPrBases?.filter((edge) =>
                  [edge.base, edge.tip].every((n) => {
                    const before = prior.facts.pullRequests.find((pr) => pr.number === n);
                    const after = pulls.get(n);
                    return before?.head === after?.head && before?.base === after?.base;
                  })
                ),
                issues: [...issues.values()],
                pullRequests: [...pulls.values()],
              },
              reporting: { ...prior.reporting, items: freshness },
            };
            tx.update(githubRichFacts).set({ value }).where(eq(githubRichFacts.id, 1)).run();
            tx.insert(table)
              .values({ id: 1, jobs: [...jobs.values()], jobsObservedAt })
              .onConflictDoUpdate({
                target: table.id,
                set: { jobs: [...jobs.values()], jobsObservedAt },
              })
              .run();
          })
        )
      ),
    read: () =>
      operation(() =>
        stateConnection(directory, (db) => {
          const row = db.select().from(table).where(eq(table.id, 1)).get();
          const rich = db
            .select()
            .from(githubRichFacts)
            .where(eq(githubRichFacts.id, 1))
            .get()?.value;
          return {
            startedAt: row?.startedAt ?? undefined,
            observedAt: row?.observedAt ?? undefined,
            failedAt: row?.failedAt ?? undefined,
            error: row?.error ?? undefined,
            items: rich?.reporting?.items,
            facts:
              rich !== undefined &&
              (rich.reporting !== undefined || rich.observedAt === row?.observedAt)
                ? rich.facts
                : row?.observedAt == null
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
            const retained = tx
              .select()
              .from(githubRichFacts)
              .where(eq(githubRichFacts.id, 1))
              .get()?.value;
            if (
              value.generation !== undefined &&
              value.generation < (retained?.reporting?.completedGeneration ?? 0)
            )
              return;
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
              const prior = tx
                .select()
                .from(githubRichFacts)
                .where(eq(githubRichFacts.id, 1))
                .get()?.value;
              const generation = value.generation;
              const items = { ...prior?.reporting?.items };
              const merge = <T extends { number: number }>(
                kind: string,
                incoming: readonly T[],
                previous: readonly T[]
              ): T[] => {
                if (generation === undefined) return [...incoming];
                const newer = previous.filter(
                  (item) => (items[`${kind}:${item.number}`]?.generation ?? 0) > generation
                );
                const newerIds = new Set(newer.map((item) => item.number));
                const accepted = incoming.filter((item) => !newerIds.has(item.number));
                for (const item of accepted)
                  items[`${kind}:${item.number}`] = {
                    generation,
                    sequence: Number.MAX_SAFE_INTEGER,
                    attemptedAt: value.observedAt ?? 0,
                    observedAt: value.observedAt,
                  };
                return [...accepted, ...newer];
              };
              const mergedPulls = merge(
                'pull',
                value.facts.pullRequests,
                prior?.facts.pullRequests ?? []
              );
              const facts = {
                ...value.facts,
                issues: merge('issue', value.facts.issues, prior?.facts.issues ?? []),
                pullRequests: mergedPulls,
                verifiedPrBases: value.facts.verifiedPrBases?.filter((edge) =>
                  [edge.base, edge.tip].every((n) => {
                    const collected = value.facts?.pullRequests.find((pr) => pr.number === n);
                    const accepted = mergedPulls.find((pr) => pr.number === n);
                    return collected?.head === accepted?.head && collected?.base === accepted?.base;
                  })
                ),
              };
              const rich = {
                ...prior,
                observedAt: value.observedAt ?? 0,
                facts,
                ...(generation === undefined
                  ? {}
                  : {
                      reporting: {
                        ...prior?.reporting,
                        generation: prior?.reporting?.generation ?? generation,
                        completedGeneration: generation,
                        items,
                      },
                    }),
              };
              tx.insert(githubRichFacts)
                .values({ id: 1, value: rich })
                .onConflictDoUpdate({ target: githubRichFacts.id, set: { value: rich } })
                .run();
              tx.delete(githubIssues).run();
              tx.delete(githubPulls).run();
              for (const issue of facts.issues) tx.insert(githubIssues).values(issue).run();
              for (const pr of facts.pullRequests) tx.insert(githubPulls).values(pr).run();
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
          const rich = db
            .select()
            .from(githubRichFacts)
            .where(eq(githubRichFacts.id, 1))
            .get()?.value;
          const prior = db.select().from(table).where(eq(table.id, 1)).get();
          const current = new Map(
            (prior?.jobs ?? []).flatMap((job) =>
              job.kind === 'job' ? [[job.intent.id, job] as const] : []
            )
          );
          const retainedJobs = jobs.map((job) =>
            job.kind === 'job' && rich?.reporting?.items[`job:${job.intent.id}`]
              ? (current.get(job.intent.id) ?? job)
              : job
          );
          const present = new Set(
            retainedJobs.flatMap((job) => (job.kind === 'job' ? [job.intent.id] : []))
          );
          for (const job of current.values()) {
            if (!present.has(job.intent.id) && rich?.reporting?.items[`job:${job.intent.id}`])
              retainedJobs.push(job);
          }
          db.insert(table)
            .values({ id: 1, jobs: retainedJobs, jobsObservedAt, recoveries })
            .onConflictDoUpdate({
              target: table.id,
              set: { jobs: retainedJobs, jobsObservedAt, recoveries },
            })
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
