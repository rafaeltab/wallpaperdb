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
  type Preview,
  type PlanningInput,
  type Proposal,
} from './contract.js';
import { validate } from './implementation.js';
const limit = (value: number) => Number.isSafeInteger(value) && (value === -1 || value > 0);
const active = (job: Status) => holdsSlot(job, false) && job.kind === 'job';
function holdsSlot(job: Status, resuming: boolean): boolean {
  if (job.kind === 'empty') return true;
  if (finished(job)) return false;
  return job.delivery?.active !== false || resuming;
}
const slots = (state: ScheduleState, jobs: readonly Status[]) =>
  jobs.filter((job, index) =>
    holdsSlot(job, (state.resuming ?? []).includes(state.admissions[index]?.issue ?? 0))
  ).length;
const available = (state: ScheduleState, jobs: readonly Status[]) =>
  !state.paused &&
  (state.allowance === -1 || state.admissions.length < state.allowance) &&
  (state.concurrency === -1 || slots(state, jobs) < state.concurrency);
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
        if (!available(state, jobs)) return false;
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
    const dispatch = (preview: Preview, base: string, initialRevision: number) =>
      Effect.gen(function* () {
        let revision = initialRevision;
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
          const command = plannedStart(selection, preview, base);
          if (!(yield* reserve(command, current))) continue;
          revision++;
          yield* (yield* pool.job(selection.issue)).start(command);
        }
      });
    const claimResume = (issue: number, target: Status, snapshot: ScheduleStatus) =>
      Effect.gen(function* () {
        const { state } = snapshot;
        if (state.resuming?.includes(issue)) return true;
        if (!resumeCapacity(target, snapshot)) return false;
        return yield* store.save({
          ...state,
          revision: state.revision + 1,
          resuming: [...(state.resuming ?? []), issue],
        });
      });
    const releaseResume = (issue: number) =>
      Effect.gen(function* () {
        for (;;) {
          const current = yield* store.read();
          const claims = current.resuming ?? [];
          if (
            yield* store.save({
              ...current,
              revision: current.revision + 1,
              resuming: claims.filter((number) => number !== issue),
            })
          )
            return;
        }
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
          if (!validStart(command)) return { kind: 'rejected' as const };
          if (!eligible(yield* issues.inspect(command.issue))) return { kind: 'rejected' as const };
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
          if (signature === lastInput || !hasFrontier(input, snapshot.state)) return snapshot;
          const preview = yield* plan.preview();
          if (preview.kind === 'stale') return yield* status();
          lastInput = signature;
          // Source freshness is checked by Plan; this CAS binds local controls/jobs to its proposal.
          if (preview.input.scheduleRevision !== snapshot.state.revision) return yield* status();
          yield* dispatch(preview, base, snapshot.state.revision);
          return yield* status();
        }).pipe(Effect.withSpan('factory.scheduler.tick')),
      resume: (command) =>
        Effect.gen(function* () {
          const snapshot = yield* status();
          const target = snapshot.jobs.find(
            (job) => job.kind === 'job' && job.intent.id === command.jobId
          );
          if (target?.kind !== 'job') return { kind: 'rejected' as const };
          const issue = target.intent.issue;
          if (!(yield* claimResume(issue, target, snapshot))) return { kind: 'occupied' as const };
          const job = yield* pool.job(issue);
          const result = yield* job.resume(command);
          yield* releaseResume(issue);
          return result;
        }).pipe(Effect.withSpan('factory.scheduler.resume')),
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

function validStart(command: Start) {
  return (
    Number.isSafeInteger(command.issue) &&
    command.issue > 0 &&
    command.context.length <= 16000 &&
    /^[a-f0-9]{40}$/.test(command.base)
  );
}
function eligible(issue: {
  open: boolean;
  author: string;
  labels: readonly string[];
  blockersReady: boolean;
}) {
  return (
    issue.open &&
    ['rafaeltab', 'zero-two-rafaeltab'].includes(issue.author) &&
    issue.labels.includes('ready-for-agent') &&
    !issue.labels.some((label) => ['future-work', 'spec'].includes(label)) &&
    issue.blockersReady
  );
}
function hasFrontier(input: PlanningInput, state: ScheduleState) {
  return input.issues.some(
    (issue) =>
      issue.open &&
      issue.labels.includes('ready-for-agent') &&
      !state.admissions.some((a) => a.issue === issue.number)
  );
}

function finished(job: Extract<Status, { kind: 'job' }>) {
  return job.delivery?.ready || job.delivery?.activity === 'cancelled';
}
function resumeCapacity(target: Status, snapshot: ScheduleStatus) {
  return (
    active(target) ||
    snapshot.state.concurrency === -1 ||
    slots(snapshot.state, snapshot.jobs) < snapshot.state.concurrency
  );
}
function plannedStart(
  selection: Proposal['selected'][number],
  preview: Preview,
  base: string
): Start {
  return {
    issue: selection.issue,
    base,
    context:
      preview.input.issues.find((issue) => issue.number === selection.issue)
        ?.prerequisiteEvidence ?? '',
  };
}
