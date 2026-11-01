import { Effect, Layer } from 'effect';
import { Issues, type Start, type Status } from '../job/index.js';
import {
  Plan,
  PlanningSource,
  ScheduleStore,
  JobPool,
  Scheduler,
  type ScheduleState,
  type ScheduleStatus,
} from './contract.js';
import { validate } from './implementation.js';
const limit = (value: number) => Number.isSafeInteger(value) && (value === -1 || value > 0);
const active = (job: Status) =>
  job.kind === 'job' &&
  !job.delivery?.ready &&
  job.delivery?.activity !== 'cancelled' &&
  job.delivery?.active !== false;
const available = (state: ScheduleState, jobs: readonly Status[]) =>
  !state.paused &&
  (state.allowance === -1 || state.admissions.length < state.allowance) &&
  (state.concurrency === -1 || jobs.filter(active).length < state.concurrency);
export const SchedulerLive = Layer.effect(
  Scheduler,
  Effect.gen(function* () {
    const store = yield* ScheduleStore;
    const pool = yield* JobPool;
    const plan = yield* Plan;
    const issues = yield* Issues;
    const source = yield* PlanningSource;
    let lastInput: string | undefined;
    const observe = (state: ScheduleState) =>
      Effect.gen(function* () {
        const jobs: Status[] = [];
        for (const admission of state.admissions) {
          const job = yield* pool.job(admission.issue);
          jobs.push(yield* job.status());
        }
        return { state, jobs };
      });
    const status = () => Effect.flatMap(store.read(), observe);
    const reserve = (command: Start, snapshot: ScheduleStatus) =>
      Effect.gen(function* () {
        const { state, jobs } = snapshot;
        if (state.admissions.some((a) => a.issue === command.issue)) return false;
        // Empty reserved jobs still occupy capacity until reconciled. Never release an uncertain launch.
        if (
          !available(state, jobs) ||
          (state.concurrency !== -1 &&
            jobs.filter(active).length + jobs.filter((j) => j.kind === 'empty').length >=
              state.concurrency)
        )
          return false;
        return yield* store.save({
          ...state,
          revision: state.revision + 1,
          admissions: [...state.admissions, command],
        });
      });
    const reconcile = () =>
      Effect.gen(function* () {
        const state = yield* store.read();
        for (const admission of state.admissions) {
          const job = yield* pool.job(admission.issue);
          if ((yield* job.status()).kind === 'empty') yield* job.start(admission);
        }
      });
    const commandJob = (id: string) =>
      Effect.gen(function* () {
        for (const admission of (yield* store.read()).admissions) {
          const job = yield* pool.job(admission.issue);
          const value = yield* job.status();
          if (value.kind === 'job' && value.intent.id === id) return job;
        }
        return null;
      });
    return {
      status,
      configure: (command) =>
        Effect.gen(function* () {
          if (!limit(command.concurrency) || !limit(command.allowance)) return 'rejected' as const;
          const state = yield* store.read();
          if (state.revision !== command.revision) return 'conflict' as const;
          return (yield* store.save({ ...state, ...command, revision: state.revision + 1 }))
            ? ('saved' as const)
            : ('conflict' as const);
        }).pipe(Effect.withSpan('factory.scheduler.configure')),
      start: (command) =>
        Effect.gen(function* () {
          if (
            !Number.isSafeInteger(command.issue) ||
            command.issue <= 0 ||
            command.context.length > 16000 ||
            !/^[a-f0-9]{40}$/.test(command.base)
          )
            return { kind: 'rejected' as const };
          const issue = yield* issues.inspect(command.issue);
          if (
            !issue.open ||
            !['rafaeltab', 'zero-two-rafaeltab'].includes(issue.author) ||
            !issue.labels.includes('ready-for-agent') ||
            issue.labels.some((label) => ['future-work', 'spec'].includes(label)) ||
            !issue.blockersReady
          )
            return { kind: 'rejected' as const };
          const snapshot = yield* status();
          if (!(yield* reserve(command, snapshot))) return { kind: 'occupied' as const };
          return yield* (yield* pool.job(command.issue)).start(command);
        }).pipe(Effect.withSpan('factory.scheduler.start')),
      tick: (base) =>
        Effect.gen(function* () {
          yield* reconcile();
          const snapshot = yield* status();
          if (!available(snapshot.state, snapshot.jobs)) return snapshot;
          const input = yield* source.read();
          const normalized = {
            ...input,
            job: normalize(input.job),
            jobs: input.jobs?.map(normalize),
          };
          const signature = JSON.stringify(normalized);
          if (
            signature === lastInput ||
            !input.issues.some(
              (issue) =>
                issue.open &&
                issue.labels.includes('ready-for-agent') &&
                !snapshot.state.admissions.some((a) => a.issue === issue.number)
            )
          )
            return snapshot;
          const preview = yield* plan.preview();
          if (preview.kind === 'stale') return yield* status();
          lastInput = signature;
          // Source freshness is checked by Plan; this CAS binds local controls/jobs to its proposal.
          if (preview.input.scheduleRevision !== snapshot.state.revision) return yield* status();
          let revision = snapshot.state.revision;
          for (const selection of preview.selected) {
            const current = yield* status();
            if (current.state.revision !== revision) break;
            const validated = validate(
              { selected: [selection], deferred: [] },
              {
                ...preview.input,
                jobs: current.jobs,
                admissions: current.state.admissions.map((a) => a.issue),
              }
            );
            if (!validated.selected.length) continue;
            const command = {
              issue: selection.issue,
              base,
              context:
                preview.input.issues.find((i) => i.number === selection.issue)
                  ?.prerequisiteEvidence ?? '',
            };
            if (!(yield* reserve(command, current))) continue;
            revision++;
            yield* (yield* pool.job(selection.issue)).start(command);
          }
          return yield* status();
        }).pipe(Effect.withSpan('factory.scheduler.tick')),
      resume: (command) =>
        Effect.gen(function* () {
          const job = yield* commandJob(command.jobId);
          return job ? yield* job.resume(command) : { kind: 'rejected' as const };
        }),
      cancel: (id) =>
        Effect.gen(function* () {
          const job = yield* commandJob(id);
          return job ? yield* job.cancel(id) : { kind: 'rejected' as const };
        }),
    } satisfies Scheduler;
  })
);

function normalize(job: Status) {
  return job.kind === 'job' ? { ...job, elapsedMs: 0 } : job;
}
