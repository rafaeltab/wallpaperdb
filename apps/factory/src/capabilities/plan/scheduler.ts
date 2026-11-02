import { Effect, Layer, Option, Semaphore } from 'effect';
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
  type ResumeClaim,
} from './contract.js';
import { validate, locallyBlocked } from './implementation.js';
const limit = (value: number) => Number.isSafeInteger(value) && (value === -1 || value > 0);
const active = (job: Status) => holdsSlot(job, false) && job.kind === 'job';
function holdsSlot(job: Status, resuming: boolean): boolean {
  if (job.kind === 'empty') return true;
  if (finished(job)) return false;
  return job.delivery?.active !== false || resuming;
}
const slots = (state: ScheduleState, jobs: readonly Status[]) =>
  jobs.filter((job, index) =>
    holdsSlot(
      job,
      (state.resuming ?? []).some((claim) => claim.issue === state.admissions[index]?.issue)
    )
  ).length;
const recoverySlots = (snapshot: ScheduleStatus) =>
  (snapshot.recoveries ?? []).filter((item) => item.active !== false).length;
const available = (snapshot: ScheduleStatus) => {
  const { state, jobs } = snapshot;
  return (
    !state.paused &&
    (state.allowance === -1 || state.admissions.length < state.allowance) &&
    (state.concurrency === -1 || slots(state, jobs) + recoverySlots(snapshot) < state.concurrency)
  );
};
export const SchedulerLive = Layer.effect(
  Scheduler,
  Effect.gen(function* () {
    const store = yield* ScheduleStore;
    const pool = yield* JobPool;
    const plan = yield* Plan;
    const issues = yield* Issues;
    const source = yield* PlanningSource;
    const writers = yield* Semaphore.make(1);
    const recoveryObservations = yield* Semaphore.make(1);
    let lastInput: string | undefined;
    let retryPreview: Preview | undefined;
    const observe = (
      state: ScheduleState
    ): Effect.Effect<ScheduleStatus, import('../job/index.js').Unavailable> =>
      Effect.gen(function* () {
        const jobs: Status[] = [];
        for (const admission of state.admissions) {
          const job = yield* pool.job(admission.issue);
          jobs.push(yield* job.status());
        }
        const remaining = (state.resuming ?? []).filter((claim) => !recoveredResume(claim, jobs));
        if (remaining.length !== state.resuming?.length && state.resuming) {
          const next = { ...state, revision: state.revision + 1, resuming: remaining };
          if (yield* store.save(next)) return { state: next, jobs };
          return yield* observe(yield* store.read());
        }
        return { state, jobs };
      });
    const status = () =>
      Effect.gen(function* () {
        const snapshot = yield* Effect.flatMap(store.read(), observe);
        return { ...snapshot, recoveries: yield* issues.recoveries?.() ?? Effect.succeed([]) };
      });
    const reserve = (command: Start, snapshot: ScheduleStatus) =>
      Effect.gen(function* () {
        const { state } = snapshot;
        if (state.admissions.some((a) => a.issue === command.issue)) return false;
        // Empty reserved jobs still occupy capacity until reconciled. Never release an uncertain launch.
        if (!available(snapshot)) return false;
        return yield* store.save({
          ...state,
          revision: state.revision + 1,
          admissions: [...state.admissions, command],
        });
      });
    const admitRecovery = (
      issue: number,
      continuation?: import('../job/index.js').ContinuationReceipt
    ) =>
      Effect.gen(function* () {
        const snapshot = yield* status();
        if (continuation) return yield* reserveContinuation(issue, continuation, snapshot);
        const recoveries = snapshot.recoveries ?? [];
        if (recoveries.some((item) => item.issue === issue && item.active !== false)) return true;
        return (
          snapshot.state.concurrency === -1 ||
          slots(snapshot.state, snapshot.jobs) + recoverySlots(snapshot) <
            snapshot.state.concurrency
        );
      }).pipe(
        // Job.status can reconcile the same repair that requested capacity.
        // A nested query must defer, never wait on its own observation or send.
        recoveryObservations.withPermitsIfAvailable(1),
        Effect.map(Option.getOrElse(() => false))
      );
    const reserveContinuation = (
      issue: number,
      receipt: import('../job/index.js').ContinuationReceipt,
      snapshot: ScheduleStatus
    ) =>
      Effect.gen(function* () {
        const target = snapshot.jobs.find(
          (job) => job.kind === 'job' && job.intent.issue === issue
        );
        if (!continuationMatches(target, receipt)) return false;
        const claim: ResumeClaim = {
          issue,
          index: receipt.index,
          questionId: `continuation:${JSON.stringify(receipt)}`,
          run: receipt.run,
        };
        const prior = snapshot.state.resuming?.find((value) => value.issue === issue);
        if (prior) return sameResume(prior, claim);
        if (!continuationCapacity(snapshot)) return false;
        return yield* store.save({
          ...snapshot.state,
          revision: snapshot.state.revision + 1,
          resuming: [...(snapshot.state.resuming ?? []), claim],
        });
      });
    const reconcile = () =>
      Effect.gen(function* () {
        yield* issues.reconcile?.(admitRecovery) ?? Effect.void;
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
    const prepareIssue = (
      number: number,
      jobs: readonly Status[],
      initial?: Effect.Success<ReturnType<Issues['inspect']>>
    ) =>
      Effect.gen(function* () {
        let issue = initial ?? (yield* issues.inspect(number));
        if (issue.joinRequired && !locallyBlocked(issue.blockers, jobs)) {
          yield* issues.prepare?.(number, admitRecovery) ?? Effect.void;
          issue = yield* issues.inspect(number);
        }
        return issue;
      });
    const dispatch = (preview: Preview, base: string, initialRevision: number) =>
      Effect.gen(function* () {
        let revision = initialRevision;
        for (const selection of preview.selected) {
          const current = yield* status();
          if (!currentDispatch(current, revision)) break;
          const validated = validate(
            { selected: [selection], deferred: [] },
            {
              ...preview.input,
              jobs: current.jobs,
              admissions: current.state.admissions.map((a) => a.issue),
            }
          );
          if (!validated.selected.length) continue;
          const planned = plannedStart(selection, preview, base);

          const inspected = yield* prepareIssue(selection.issue, current.jobs);
          const after = yield* status();
          if (after.state.revision !== current.state.revision) break;
          if (!dispatchable(inspected, after.jobs)) continue;
          const command = prerequisiteStart(planned, inspected.prerequisite);
          if (!(yield* reserve(command, after))) continue;
          revision++;
          yield* (yield* pool.job(selection.issue)).start(command);
        }
      });
    const retry = (preview: Preview | undefined, base: string, revision: number) =>
      Effect.gen(function* () {
        if (preview) yield* dispatch(preview, base, revision);
        return yield* status();
      });
    const claimResume = (claim: ResumeClaim, target: Status, snapshot: ScheduleStatus) =>
      Effect.gen(function* () {
        const { state } = snapshot;
        // A prior uncertain send must be reconciled, never retried based on a rejected stale command.
        if (state.resuming?.some((existing) => existing.issue === claim.issue)) return false;
        if (!resumeCapacity(target, snapshot)) return false;
        return yield* store.save({
          ...state,
          revision: state.revision + 1,
          resuming: [...(state.resuming ?? []), claim],
        });
      });
    const releaseResume = (claim: ResumeClaim) =>
      Effect.gen(function* () {
        for (;;) {
          const current = yield* store.read();
          const claims = current.resuming ?? [];
          if (
            yield* store.save({
              ...current,
              revision: current.revision + 1,
              resuming: claims.filter((existing) => !sameResume(existing, claim)),
            })
          )
            return;
        }
      });
    return {
      authorizeRecovery: admitRecovery,
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
          let issue = yield* issues.inspect(command.issue);
          if (!eligible({ ...issue, blockersReady: issue.blockersReady || !!issue.joinRequired }))
            return { kind: 'rejected' as const };
          const before = yield* status();
          if (!available(before)) return { kind: 'occupied' as const };
          issue = yield* prepareIssue(command.issue, before.jobs, issue);
          const snapshot = yield* status();
          if (!dispatchable(issue, snapshot.jobs)) return { kind: 'rejected' as const };
          const resolved = prerequisiteStart(command, issue.prerequisite);
          if (!(yield* reserve(resolved, snapshot))) return { kind: 'occupied' as const };
          return yield* (yield* pool.job(command.issue)).start(resolved);
        }).pipe(writers.withPermits(1), Effect.withSpan('factory.scheduler.start')),
      tick: (base) =>
        Effect.gen(function* () {
          yield* reconcile();
          const snapshot = yield* status();
          if (!available(snapshot)) return snapshot;
          const input = yield* source.read();
          const normalized = {
            ...input,
            job: normalize(input.job),
            jobs: input.jobs?.map(normalize),
          };
          const signature = JSON.stringify(normalized);
          if (!hasFrontier(input, snapshot.state)) return snapshot;
          if (signature === lastInput) {
            return yield* retry(retryPreview, base, snapshot.state.revision);
          }
          const preview = yield* plan.preview();
          if (preview.kind === 'stale') return yield* status();
          lastInput = signature;
          retryPreview = joinPreview(preview);
          // Source freshness is checked by Plan; this CAS binds local controls/jobs to its proposal.
          if (preview.input.scheduleRevision !== snapshot.state.revision) return yield* status();
          yield* dispatch(preview, base, snapshot.state.revision);
          return yield* status();
        }).pipe(writers.withPermits(1), Effect.withSpan('factory.scheduler.tick')),
      resume: (command) =>
        Effect.gen(function* () {
          const snapshot = yield* status();
          const target = snapshot.jobs.find(
            (job) => job.kind === 'job' && job.intent.id === command.jobId
          );
          if (target?.kind !== 'job') return { kind: 'rejected' as const };
          const issue = target.intent.issue;
          const claim = {
            issue,
            ...resumeIdentity(command),
            run: observedRun(target),
          };
          if (!(yield* claimResume(claim, target, snapshot))) return { kind: 'occupied' as const };
          const job = yield* pool.job(issue);
          const result = yield* job.resume(command);
          if (result.kind === 'rejected' || resolvedStart(claim, result))
            yield* releaseResume(claim);
          return result;
        }).pipe(writers.withPermits(1), Effect.withSpan('factory.scheduler.resume')),
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
  return job.delivery?.ready || job.delivery?.landed || job.delivery?.activity === 'cancelled';
}
function resumeCapacity(target: Status, snapshot: ScheduleStatus) {
  return (
    active(target) ||
    snapshot.state.concurrency === -1 ||
    slots(snapshot.state, snapshot.jobs) + recoverySlots(snapshot) < snapshot.state.concurrency
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
    context: '',
    prerequisiteEvidence:
      preview.input.issues.find((issue) => issue.number === selection.issue)
        ?.prerequisiteEvidence ?? '',
  };
}

function observedRun(job: Status) {
  return job.kind === 'job' && job.execution.kind === 'found' ? job.execution.run : undefined;
}
function sameResume(first: ResumeClaim, second: ResumeClaim) {
  return (
    first.issue === second.issue &&
    first.index === second.index &&
    first.questionId === second.questionId &&
    first.runId === second.runId
  );
}
function recoveredResume(claim: ResumeClaim, jobs: readonly Status[]) {
  const job = jobs.find((job) => job.kind === 'job' && job.intent.issue === claim.issue);
  if (job?.kind !== 'job') return false;
  if (finished(job)) return true;
  const run = observedRun(job);
  return successorRun(claim.run, run);
}
function successorRun(previous: ResumeClaim['run'], current: ResumeClaim['run']) {
  if (!previous || !current) return false;
  return current.id !== previous.id && current.ordinal > previous.ordinal;
}

function resolvedStart(claim: ResumeClaim, result: import('../job/index.js').StartResult) {
  return result.kind === 'job' && recoveredResume(claim, [result]);
}

function prerequisiteStart(
  command: Start,
  prerequisite?: { base: string; prBase: string; evidence: string }
): Start {
  return prerequisite
    ? {
        ...command,
        base: prerequisite.base,
        prBase: prerequisite.prBase,
        prerequisiteEvidence: prerequisite.evidence,
      }
    : command;
}

function dispatchable(
  issue: Parameters<typeof eligible>[0] & { blockers: readonly number[] },
  jobs: readonly Status[]
) {
  return eligible(issue) && !locallyBlocked(issue.blockers, jobs);
}

function currentDispatch(snapshot: ScheduleStatus, revision: number) {
  return snapshot.state.revision === revision && available(snapshot);
}

function joinPreview(preview: Preview) {
  return preview.selected.some((selection) =>
    preview.input.issues.some((issue) => issue.number === selection.issue && issue.joinRequired)
  )
    ? preview
    : undefined;
}

function continuationMatches(
  target: Status | undefined,
  receipt: import('../job/index.js').ContinuationReceipt
) {
  if (target?.kind !== 'job' || target.execution.kind !== 'found') return false;
  return (
    target.execution.threadId === receipt.threadId &&
    target.execution.run?.id === receipt.run.id &&
    target.execution.run.ordinal === receipt.run.ordinal
  );
}
function continuationCapacity(snapshot: ScheduleStatus) {
  return (
    snapshot.state.concurrency === -1 ||
    slots(snapshot.state, snapshot.jobs) + recoverySlots(snapshot) < snapshot.state.concurrency
  );
}

function resumeIdentity(command: import('../job/index.js').Resume) {
  return 'questionId' in command
    ? { index: command.index, questionId: command.questionId }
    : { index: command.index, runId: command.runId };
}
