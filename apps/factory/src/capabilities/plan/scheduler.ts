import { Effect, Layer, Option, Semaphore, Random } from 'effect';
import { Issues, Time, Unavailable, type Start, type Status } from '../job/index.js';
import {
  Plan,
  IPlanner,
  PlanningSource,
  ScheduleStore,
  ScheduleObservations,
  JobPool,
  Scheduler,
  type ScheduleState,
  type ScheduleStatus,
  type PlanningInput,
  type ResumeClaim,
  type ExecutionCycle,
} from './contract.js';
import { locallyBlocked, planningInputIdentity, requirementsIdentity } from './implementation.js';
import { PlanningSafety } from './safety-contract.js';
const limit = (value: number) => Number.isSafeInteger(value) && (value === -1 || value > 0);
const active = (job: Status) => holdsSlot(job, false) && job.kind === 'job';
export function holdsSlot(job: Status, resuming: boolean): boolean {
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
  new Set([
    ...(snapshot.recoveries ?? [])
      .filter((item) => item.active !== false)
      .map((item) => item.issue),
    ...(snapshot.state.recovering ?? []),
  ]).size;
const batchSlots = (state: ScheduleState) =>
  (state.cycle?.selected ?? []).filter(
    (selection) => !state.admissions.some((admission) => admission.issue === selection.issue)
  ).length;
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
    const observations = Option.getOrUndefined(yield* Effect.serviceOption(ScheduleObservations));
    const pool = yield* JobPool;
    const plan = yield* Plan;
    const planner = Option.getOrUndefined(yield* Effect.serviceOption(IPlanner));
    const issues = yield* Issues;
    const source = yield* PlanningSource;
    const time = yield* Time;
    const planningSafety = yield* PlanningSafety;
    const writers = yield* Semaphore.make(1);
    const recoveryObservations = yield* Semaphore.make(1);
    let lastInput: string | undefined;

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
        const recoveries = yield* issues.recoveries?.() ?? Effect.succeed([]);
        const remaining = snapshot.state.recovering?.filter(
          (number) => !recoveries.some((item) => item.issue === number && item.active !== false)
        );
        if (remaining && remaining.length !== snapshot.state.recovering?.length) {
          const next = {
            ...snapshot.state,
            revision: snapshot.state.revision + 1,
            recovering: remaining,
          };
          if (yield* store.save(next)) return { ...snapshot, state: next, recoveries };
        }
        return { ...snapshot, recoveries };
      }).pipe(Effect.tap((snapshot) => observations?.publish(snapshot) ?? Effect.void));
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
        if (snapshot.state.recovering?.includes(issue)) return true;
        if (snapshot.state.cycle && snapshot.state.cycle.selected === undefined) return false;
        if (
          snapshot.state.concurrency !== -1 &&
          slots(snapshot.state, snapshot.jobs) +
            recoverySlots(snapshot) +
            batchSlots(snapshot.state) >=
            snapshot.state.concurrency
        )
          return false;
        return yield* store.save({
          ...snapshot.state,
          revision: snapshot.state.revision + 1,
          recovering: [...(snapshot.state.recovering ?? []), issue],
        });
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
        if (
          !continuationMatches(target, receipt) ||
          (snapshot.state.cycle && snapshot.state.cycle.selected === undefined)
        )
          return false;
        const claim: ResumeClaim = {
          issue,
          index: receipt.index,
          questionId: `continuation:${JSON.stringify(receipt)}`,
          run: receipt.run,
        };
        const prior = snapshot.state.resuming?.find((value) => value.issue === issue);
        if (prior) return sameResume(prior, claim);
        if (!continuationCapacity(snapshot, batchSlots(snapshot.state))) return false;
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
    const saveCycle = (state: ScheduleState, cycle: ExecutionCycle | undefined) =>
      Effect.gen(function* () {
        const saved = yield* store.save({
          ...state,
          controlsRevision: state.controlsRevision ?? state.revision,
          revision: state.revision + 1,
          cycle,
        });
        if (saved) yield* status();
        return saved;
      });
    const replan = (state: ScheduleState) =>
      Effect.gen(function* () {
        const startedAt = yield* time.now();
        return yield* saveCycle(state, {
          requestId: `cycle-${startedAt}-${yield* Random.nextInt}`,
          startedAt,
          concurrency: state.concurrency,
          allowance: state.allowance,
        });
      });
    const selectedPreparation = (cycle: ExecutionCycle) => (_issue: number) =>
      Effect.map(
        store.read(),
        (state) =>
          !state.paused &&
          state.cycle?.requestId === cycle.requestId &&
          state.concurrency === cycle.concurrency &&
          state.allowance === cycle.allowance &&
          batchSlots(state) > 0
      );
    const dispatch = (cycle: ExecutionCycle) =>
      Effect.gen(function* () {
        for (const selection of cycle.selected ?? []) {
          let snapshot = yield* status();
          if (snapshot.state.paused || snapshot.state.cycle?.requestId !== cycle.requestId) return;
          if (snapshot.state.admissions.some((item) => item.issue === selection.issue)) continue;
          const input = yield* source.read();
          if (
            requirementsIdentity(input, cycle.selected ?? []) !== cycle.scope ||
            snapshot.state.concurrency !== cycle.concurrency ||
            snapshot.state.allowance !== cycle.allowance
          ) {
            yield* Effect.logWarning(
              'Accepted selection invalidated by external requirements or controls; gather and replan',
              { requestId: cycle.requestId, issue: selection.issue }
            );
            yield* replan(snapshot.state);
            return;
          }
          let selectionBase = snapshot.state.cycle?.bases?.find(
            (item) => item.issue === selection.issue
          )?.base;
          let inspected = yield* issues.inspect(selection.issue, {
            includeCodeFromIssues: selection.includeCodeFromIssues,
            selectionBase,
          });
          if (
            !eligible({
              ...inspected,
              blockersReady: inspected.blockersReady || !!inspected.joinRequired,
            }) ||
            locallyBlocked(selection.includeCodeFromIssues, snapshot.jobs)
          ) {
            yield* Effect.logWarning(
              'Accepted selection is no longer executable; gather and replan',
              { issue: selection.issue, reason: inspected.blockedReason }
            );
            yield* replan(yield* store.read());
            return;
          }
          if (!selectionBase) {
            selectionBase = inspected.selectionBase;
            if (!selectionBase)
              return yield* Effect.fail(
                new Unavailable({ operation: 'selection-base-missing', cause: selection.issue })
              );
            const state = yield* store.read();
            if (state.cycle?.requestId !== cycle.requestId) return;
            if (
              !(yield* saveCycle(state, {
                ...state.cycle,
                bases: [
                  ...(state.cycle.bases ?? []),
                  { issue: selection.issue, base: selectionBase },
                ],
              }))
            )
              return;
          }
          if (inspected.joinRequired) {
            yield* issues.prepare?.(selection.issue, selectedPreparation(cycle), {
              includeCodeFromIssues: selection.includeCodeFromIssues,
              selectionBase,
            }) ?? Effect.void;
            inspected = yield* issues.inspect(selection.issue, {
              includeCodeFromIssues: selection.includeCodeFromIssues,
              selectionBase,
            });
          }
          // Preparation can remain in an explicit recovery/verification state. The durable batch owns the retry.
          if (!dispatchable(inspected, snapshot.jobs)) return;
          const fresh = yield* source.read();
          snapshot = yield* status();
          if (snapshot.state.paused) return;
          if (requirementsIdentity(fresh, cycle.selected ?? []) !== cycle.scope) {
            yield* Effect.logWarning('Requirements changed during preparation; gather and replan', {
              requestId: cycle.requestId,
            });
            yield* replan(snapshot.state);
            return;
          }
          if (!inspected.prerequisite)
            return yield* Effect.fail(
              new Unavailable({ operation: 'selection-comparison-missing', cause: selection.issue })
            );
          const command: Start = {
            issue: selection.issue,
            includeCodeFromIssues: selection.includeCodeFromIssues,
            selectionBase,
            base: inspected.prerequisite.base,
            prBase: inspected.prerequisite.prBase,
            prerequisiteEvidence: inspected.prerequisite.evidence,
            context: '',
          };
          if (!(yield* reserve(command, snapshot))) return;
          const result = yield* (yield* pool.job(selection.issue)).start(command);
          if (result.kind === 'rejected' || result.kind === 'occupied')
            yield* Effect.logWarning(
              'Reserved admission did not report a new started job; retained for reconciliation',
              { issue: selection.issue, result: result.kind }
            );
        }
        const state = yield* store.read();
        if (
          state.cycle?.requestId === cycle.requestId &&
          (cycle.selected ?? []).every((item) =>
            state.admissions.some((admission) => admission.issue === item.issue)
          )
        )
          yield* saveCycle(state, undefined);
      });
    const tick = () =>
      Effect.gen(function* () {
        yield* reconcile();
        let snapshot = yield* status();
        if (snapshot.state.paused) return snapshot;
        let cycle = snapshot.state.cycle;
        if (cycle?.selected !== undefined) {
          if (cycle.modelAttemptId) yield* planningSafety.accepted(cycle.modelAttemptId);
          if (cycle.selected.length) {
            yield* dispatch(cycle);
            return yield* status();
          }
          const input = yield* source.read();
          if (
            requirementsIdentity(input, []) === cycle.scope &&
            cycle.concurrency === snapshot.state.concurrency &&
            cycle.allowance === snapshot.state.allowance
          ) {
            lastInput = planningInputIdentity({ ...input, scheduleRevision: undefined });
            yield* saveCycle(snapshot.state, undefined);
            return yield* status();
          }
          if (!(yield* saveCycle(snapshot.state, undefined))) return yield* status();
          snapshot = yield* status();
          cycle = undefined;
        }
        if (!available(snapshot)) return snapshot;
        if (!cycle) {
          const gatheredAt = yield* time.now();
          const input = yield* source.poll?.() ?? source.read();
          if (!input || !hasFrontier(input, snapshot.state)) return snapshot;
          const signature = planningInputIdentity({ ...input, scheduleRevision: undefined });
          if (signature === lastInput) return snapshot;
          cycle = {
            requestId: `cycle-${yield* time.now()}-${yield* Random.nextInt}`,
            startedAt: gatheredAt,
            concurrency: snapshot.state.concurrency,
            allowance: snapshot.state.allowance,
          };
          if (!(yield* saveCycle(snapshot.state, cycle))) return yield* status();
        }
        const free = Math.min(
          snapshot.state.concurrency === -1
            ? Infinity
            : snapshot.state.concurrency -
                slots(snapshot.state, snapshot.jobs) -
                recoverySlots(snapshot),
          snapshot.state.allowance === -1
            ? Infinity
            : snapshot.state.allowance - snapshot.state.admissions.length
        );
        const preview = yield* plan
          .preview({
            maximumSelections: Number.isFinite(free) ? Math.max(0, free) : undefined,
            requestId: cycle.requestId,
            automatic: true,
            attemptStartedAt: cycle.startedAt,
            progress: () => Effect.void,
          })
          .pipe(
            Effect.tapError(() =>
              Effect.gen(function* () {
                const ownership = planner
                  ? yield* planner.ownership(false, cycle.requestId)
                  : undefined;
                if (ownership?.retired) {
                  const state = yield* store.read();
                  if (state.cycle?.requestId === cycle.requestId)
                    yield* saveCycle(state, undefined);
                }
              })
            )
          );
        if (preview.kind === 'paused') return yield* status();
        snapshot = yield* status();
        if (
          preview.kind === 'stale' ||
          preview.input.scheduleRevision !== snapshot.state.revision
        ) {
          yield* Effect.logWarning(
            'Planning inputs changed before batch acceptance; gather and replan',
            {
              requestId: cycle.requestId,
              reason:
                preview.kind === 'stale'
                  ? 'Requirements or planning inputs changed'
                  : 'Schedule changed during planning',
            }
          );
          if (snapshot.state.paused) yield* saveCycle(snapshot.state, undefined);
          else yield* replan(snapshot.state);
          return yield* status();
        }
        // Retain selection before acceptance bookkeeping or base/launch effects. Exact request ownership
        // also replays a completed proposal after a crash or failed local publication.
        const accepted: ExecutionCycle = {
          ...cycle,
          selected: preview.selected,
          scope: requirementsIdentity(preview.input, preview.selected),
          modelAttemptId: preview.modelAttemptId,
        };
        if (!(yield* saveCycle(snapshot.state, accepted))) return yield* status();
        if (preview.modelAttemptId) yield* planningSafety.accepted(preview.modelAttemptId);
        lastInput = planningInputIdentity({ ...preview.input, scheduleRevision: undefined });
        if (accepted.selected?.length) yield* dispatch(accepted);
        else yield* saveCycle(yield* store.read(), undefined);
        return yield* status();
      });
    const owned = <A>(
      work: Effect.Effect<A, Unavailable>,
      busy: () => Effect.Effect<A, Unavailable>
    ) =>
      store
        .withCycle(work)
        .pipe(Effect.flatMap(Option.match({ onNone: busy, onSome: Effect.succeed })));
    const claimResume = (claim: ResumeClaim, target: Status, snapshot: ScheduleStatus) =>
      Effect.gen(function* () {
        const { state } = snapshot;
        // A prior uncertain send must be reconciled, never retried based on a rejected stale command.
        if (state.resuming?.some((existing) => existing.issue === claim.issue)) return false;
        if (
          !resumeCapacity(target, snapshot) ||
          (snapshot.state.cycle !== undefined && !active(target))
        )
          return false;
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
      retry: (command, revision) =>
        Effect.gen(function* () {
          const snapshot = yield* status();
          const target = snapshot.jobs.find(
            (job) => job.kind === 'job' && job.intent.id === command.jobId
          );
          if (
            snapshot.state.revision !== revision ||
            snapshot.state.paused ||
            target?.kind !== 'job' ||
            !target.retry ||
            target.retry.runId !== command.runId ||
            target.retry.threadId !== command.threadId
          )
            return { kind: 'rejected' as const };
          const claim = {
            issue: target.intent.issue,
            index: command.index,
            runId: command.runId,
            retryThreadId: command.threadId,
            run: observedRun(target),
          };
          if (!(yield* claimResume(claim, target, snapshot))) return { kind: 'occupied' as const };
          const result = yield* (yield* pool.job(target.intent.issue)).retry(command);
          if (result.kind === 'rejected' || resolvedStart(claim, result))
            yield* releaseResume(claim);
          return result;
        }).pipe(
          (work) => owned(work, () => Effect.succeed({ kind: 'occupied' as const })),
          writers.withPermits(1),
          Effect.withSpan('factory.scheduler.retry')
        ),
      authorizeRecovery: admitRecovery,
      status,
      configure: (command) =>
        Effect.gen(function* () {
          if (!limit(command.concurrency) || !limit(command.allowance)) return 'rejected' as const;
          const state = yield* store.read();
          if (command.revision !== state.revision && command.revision !== state.controlsRevision)
            return 'conflict' as const;
          return yield* planningSafety.configure({ ...command, revision: state.revision });
        }).pipe(Effect.withSpan('factory.scheduler.configure')),
      start: (command) =>
        Effect.gen(function* () {
          if (!validStart(command)) return { kind: 'rejected' as const };
          let issue = yield* issues.inspect(command.issue);
          if (!eligible({ ...issue, blockersReady: issue.blockersReady || !!issue.joinRequired }))
            return { kind: 'rejected' as const };
          const before = yield* status();
          if (before.state.cycle || !available(before)) return { kind: 'occupied' as const };
          issue = yield* prepareIssue(command.issue, before.jobs, issue);
          const snapshot = yield* status();
          if (!dispatchable(issue, snapshot.jobs)) return { kind: 'rejected' as const };
          const resolved = prerequisiteStart(command, issue.prerequisite);
          if (!(yield* reserve(resolved, snapshot))) return { kind: 'occupied' as const };
          return yield* (yield* pool.job(command.issue)).start(resolved);
        }).pipe(
          (work) => owned(work, () => Effect.succeed({ kind: 'occupied' as const })),
          writers.withPermits(1),
          Effect.withSpan('factory.scheduler.start')
        ),
      tick: (_base) =>
        owned(tick(), status).pipe(
          writers.withPermits(1),
          Effect.withSpan('factory.scheduler.tick')
        ),
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
        }).pipe(
          (work) => owned(work, () => Effect.succeed({ kind: 'occupied' as const })),
          writers.withPermits(1),
          Effect.withSpan('factory.scheduler.resume')
        ),
      cancel: (id) =>
        Effect.gen(function* () {
          const job = yield* commandJob(id);
          return job ? yield* job.cancel(id) : { kind: 'rejected' as const };
        }),
    } satisfies Scheduler;
  })
);

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
  if (claim.retryThreadId && job.execution.kind === 'found')
    return job.execution.threadId !== claim.retryThreadId && job.execution.run !== undefined;
  const run = observedRun(job);
  return successorRun(claim.run, run);
}
function successorRun(previous: ResumeClaim['run'], current: ResumeClaim['run']) {
  if (!previous || !current) return false;
  return current.id !== previous.id;
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

function continuationMatches(
  target: Status | undefined,
  receipt: import('../job/index.js').ContinuationReceipt
) {
  if (target?.kind !== 'job' || target.execution.kind !== 'found') return false;
  return (
    target.execution.threadId === receipt.threadId && target.execution.run?.id === receipt.run.id
  );
}
function continuationCapacity(snapshot: ScheduleStatus, reserved = 0) {
  return (
    snapshot.state.concurrency === -1 ||
    slots(snapshot.state, snapshot.jobs) + recoverySlots(snapshot) + reserved <
      snapshot.state.concurrency
  );
}

function resumeIdentity(command: import('../job/index.js').Resume) {
  return 'questionId' in command
    ? { index: command.index, questionId: command.questionId }
    : { index: command.index, runId: command.runId };
}

export function capacityOccupied(snapshot: ScheduleStatus) {
  return slots(snapshot.state, snapshot.jobs) + recoverySlots(snapshot);
}
