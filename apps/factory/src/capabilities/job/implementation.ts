import { retryAction, retryStage } from './retry.js';
import { attemptIntent, matchesRestart, restartAction } from './restart.js';
import { Effect, Layer, Random, Option } from 'effect';
import { reconcileStages, currentStage, hasAnsweredQuestion, stageRunOrder } from './stages.js';
import {
  AgentReconciliationPolicy,
  defaultAgentReconciliationLimit,
  JobReporting,
  Execution,
  Issues,
  Job,
  JobStore,
  type Start,
  type Intent,
  type Delivery,
  Time,
  ContinuationAdmission,
} from './contract.js';
export const JobLive = Layer.effect(
  Job,
  Effect.gen(function* () {
    const store = yield* JobStore;
    const time = yield* Time;
    const issues = yield* Issues;
    const execution = yield* Execution;
    const policy = Option.getOrUndefined(yield* Effect.serviceOption(AgentReconciliationPolicy));
    const reporting = Option.getOrUndefined(yield* Effect.serviceOption(JobReporting));
    const continuation = Option.getOrUndefined(yield* Effect.serviceOption(ContinuationAdmission));
    const observe = (intent: Intent) =>
      Effect.gen(function* () {
        const generation = reporting ? yield* reporting.begin() : 0;
        const reportingExecution: Execution = {
          ...execution,
          sendStage: (active, request) =>
            execution
              .sendStage(active, request)
              .pipe(
                Effect.andThen(
                  () =>
                    reporting?.accepted(
                      { ...active, id: intent.id },
                      request.stage,
                      request.index,
                      request.commit
                    ) ?? Effect.void
                )
              ),
        };
        return yield* Effect.gen(function* () {
          const before = yield* store.readControl();
          const activeIntent = attemptIntent(intent, before.restart?.index ?? 0);
          const observation = yield* execution.observe(
            activeIntent,
            (yield* currentStage(store)) ?? undefined
          );
          if ((yield* store.readControl()).cancelled && observation.kind === 'found')
            yield* execution.interrupt(activeIntent, observation.threadId);
          const delivery: Delivery | undefined = yield* reconcileStages(
            store,
            reportingExecution,
            issues,
            activeIntent,
            observation,
            time,
            continuation,
            before.restart?.index ?? 0,
            policy?.limit ?? defaultAgentReconciliationLimit
          );
          yield* retainPrerequisite(store, delivery);
          const control = yield* store.readControl();
          const stage = yield* currentStage(store);
          const resume =
            resumeCommand(control, stage, observation) ??
            (yield* retryAction(
              store,
              execution,
              issues,
              activeIntent,
              control,
              stage,
              observation,
              delivery
            ));
          const now = yield* time.now();
          const status = {
            kind: 'job' as const,
            stageIndex: stage?.index,
            reconciliation: control.reconciliation
              ? {
                  attempts: control.reconciliation.attempts,
                  migrated: control.reconciliation.migrated,
                  limit: policy?.limit ?? defaultAgentReconciliationLimit,
                  revision: control.revision,
                }
              : undefined,
            intent: { ...intent, branch: activeIntent.branch },
            prerequisite: control.cancelled ? undefined : control.prerequisite,
            resume,
            retry: yield* restartAction(
              store,
              execution,
              activeIntent,
              control,
              stage,
              observation
            ),
            execution: observation,
            delivery: delivery
              ? { ...delivery, active: delivery.active ?? !delivery.ready }
              : delivery,
            elapsedMs: Math.max(0, now - intent.createdAt),
          };
          if (reporting) yield* reporting.observed(generation, status);
          return status;
        }).pipe(
          Effect.tapError(
            (error) => reporting?.failed(generation, intent, error.operation) ?? Effect.void
          )
        );
      }).pipe(Effect.withSpan('factory.job.observe'));
    const resumeQuestion = (
      intent: Intent,
      command: Extract<import('./contract.js').Resume, { questionId: string }>
    ) =>
      Effect.gen(function* () {
        const waiting = yield* currentStage(store);
        const control = yield* store.readControl();
        const activeIntent = attemptIntent(intent, control.restart?.index ?? 0);
        if (!waiting) return { kind: 'rejected' as const };
        if (!matchesResume(intent, waiting, control, command)) return { kind: 'rejected' as const };
        const observed = yield* execution.observe(activeIntent, waiting);
        if (hasAnsweredQuestion(observed, command.questionId)) return yield* observe(intent);
        if (!resumable(observed, waiting)) return { kind: 'rejected' as const };
        const evidence = yield* resumeEvidence(store, execution, activeIntent, waiting, observed);
        if (!evidence) return { kind: 'rejected' as const };
        const request: import('./contract.js').StageRequest = {
          ...waiting,
          index: waiting.index + 1,
          ordinal: evidence.ordinal + 1,
          previousRunId: evidence.runId,
          resume: true,
          receiptProtocol: 'delivery-v1',
          observedRunId: undefined,
          question: undefined,
          deliveryIndex: undefined,
        };
        yield* store.saveStage(request);
        return yield* observe(intent);
      });
    return {
      retry: (command) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent || intent.id !== command.jobId) return { kind: 'rejected' as const };
          const latest = yield* observe(intent);
          if (!matchesRestart(latest.retry, command)) return { kind: 'rejected' as const };
          const issue = yield* issues.inspect(intent.issue, {
            base: intent.base,
            includeCodeFromIssues: intent.includeCodeFromIssues,
            selectionBase: intent.selectionBase,
            prBase: intent.prBase,
          });
          if (
            !eligible(issue) ||
            (issue.prerequisite &&
              (issue.prerequisite.base !== intent.base ||
                issue.prerequisite.prBase !== intent.prBase))
          )
            return { kind: 'rejected' as const };
          const activeIntent = attemptIntent(intent, command.attempt);
          if ((yield* issues.pullRequest(activeIntent)).kind !== 'absent')
            return { kind: 'rejected' as const };
          const current = yield* observe(intent);
          if (!matchesRestart(current.retry, command)) return { kind: 'rejected' as const };
          const control = yield* store.readControl();
          const stage = yield* currentStage(store);
          if (control.revision !== command.revision || stage?.index !== command.index)
            return { kind: 'rejected' as const };
          const index = stage.index + 1;
          if (
            !(yield* store.saveControl({
              ...control,
              revision: control.revision + 1,
              restart: { index },
              manualRepair: undefined,
              parked: undefined,
            }))
          )
            return { kind: 'rejected' as const };
          if (yield* store.claimStage(index)) {
            if (!(yield* store.readControl()).cancelled) {
              const active = attemptIntent(intent, index);
              const launch = yield* execution.launch(active);
              if (launch.kind === 'submitted' && reporting)
                yield* reporting.accepted({ ...active, id: intent.id }, 'implementation', index);
            }
          }
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.retry-fresh')),
      status: () =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          return intent ? yield* observe(intent) : { kind: 'empty' as const };
        }),
      resume: (command) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent) return { kind: 'rejected' as const };
          if ('runId' in command && command.resetReconciliation) {
            const control = yield* store.readControl();
            const stage = yield* currentStage(store);
            if (
              intent.id !== command.jobId ||
              control.cancelled ||
              control.revision !== command.revision ||
              stage?.index !== command.index
            )
              return { kind: 'rejected' as const };
            const owner = yield* execution.observe(
              attemptIntent(intent, control.restart?.index ?? 0),
              stage ?? undefined
            );
            if (owner.kind !== 'found' || owner.run?.id !== command.runId)
              return { kind: 'rejected' as const };
            if (
              !(yield* store.saveControl({
                ...control,
                revision: control.revision + 1,
                reconciliation: { attempts: 0, migrated: false },
              }))
            )
              return { kind: 'rejected' as const };
            return yield* observe(intent);
          }
          if ('runId' in command) return yield* retryStage(store, intent, command, observe);
          return yield* resumeQuestion(intent, command);
        }).pipe(Effect.withSpan('factory.job.resume')),
      cancel: (jobId) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent || intent.id !== jobId) return { kind: 'rejected' as const };
          for (;;) {
            const state = yield* store.readControl();
            if (state.cancelled) break;
            if (
              yield* store.saveControl({ ...state, revision: state.revision + 1, cancelled: true })
            )
              break;
          }
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.cancel')),
      start: (command: Start) =>
        Effect.gen(function* () {
          if (yield* store.read()) return { kind: 'occupied' as const };
          if (!validCommand(command)) return { kind: 'rejected' as const };
          const issue = yield* issues.inspect(command.issue, {
            base: command.base,
            includeCodeFromIssues: command.includeCodeFromIssues,
            selectionBase: command.selectionBase,
            prBase: command.prBase,
          });
          if (!eligible(issue)) return { kind: 'rejected' as const };
          if (!matchesPrerequisite(command, issue.prerequisite))
            return { kind: 'rejected' as const };
          const createdAt = yield* time.now();
          const id = `${createdAt}-${yield* Random.nextInt}-${yield* Random.nextInt}`;
          const intent: Intent = {
            ...command,
            ...prerequisiteBinding(command, issue.prerequisite),
            id,
            createdAt,
            issueUrl: issue.url,
            issueTitle: issue.title,
            branch: `factory/job-${id}`,
            expectedStage: 'implementation',
            receiptProtocol: 'delivery-v1',
          };
          if (!(yield* store.reserve(intent))) return { kind: 'occupied' as const };
          if (yield* store.claimLaunch()) {
            const launch = yield* execution.launch(intent);
            if (launch.kind === 'submitted' && reporting)
              yield* reporting.accepted(intent, 'implementation', 0);
          }
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.start')),
    } satisfies Job;
  })
);

function validCommand(command: Start): boolean {
  return (
    Number.isSafeInteger(command.issue) &&
    command.issue > 0 &&
    command.context.length <= 16000 &&
    /^[a-f0-9]{40}$/.test(command.base)
  );
}
export function eligible(issue: {
  open: boolean;
  author: string;
  labels: readonly string[];
  blockersReady: boolean;
}): boolean {
  return (
    issue.open &&
    trustedAuthor(issue.author) &&
    issue.labels.includes('ready-for-agent') &&
    !issue.labels.some((label) => ['future-work', 'spec'].includes(label)) &&
    issue.blockersReady
  );
}

function matchesResume(
  intent: Intent,
  waiting: import('./contract.js').StageRequest,
  control: import('./contract.js').Control,
  command: { jobId: string; index: number; questionId: string }
) {
  return (
    intent.id === command.jobId &&
    !control.cancelled &&
    waiting.index === command.index &&
    control.parked?.index === waiting.index &&
    control.parked.question.id === command.questionId
  );
}
function resumable(
  observed: import('./contract.js').Observation,
  waiting: import('./contract.js').StageRequest
): observed is Extract<import('./contract.js').Observation, { kind: 'found' }> {
  return (
    observed.kind === 'found' &&
    observed.threadId === waiting.threadId &&
    !observed.question &&
    ['completed', 'interrupted', 'failed', 'cancelled'].includes(observed.status)
  );
}

function resumeCommand(
  control: import('./contract.js').Control,
  stage: import('./contract.js').StageRequest | null,
  observation: import('./contract.js').Observation
) {
  const parked = control.parked;
  if (control.cancelled || !parked || parked.index !== stage?.index) return undefined;
  if (hasAnsweredQuestion(observation, parked.question.id)) return undefined;
  return { index: parked.index, questionId: parked.question.id };
}

function resumeEvidence(
  store: import('./contract.js').JobStore,
  execution: import('./contract.js').Execution,
  intent: Intent,
  waiting: import('./contract.js').StageRequest,
  observed: Extract<import('./contract.js').Observation, { kind: 'found' }>
) {
  return Effect.gen(function* () {
    const evidence = observed.run
      ? { runId: observed.run.id, ordinal: observed.run.ordinal }
      : yield* execution.inspectStage(intent, waiting);
    if (!evidence) return null;
    return stageRunOrder(waiting, yield* store.readControl(), {
      id: evidence.runId,
      ordinal: evidence.ordinal,
    })
      ? evidence
      : null;
  });
}

function matchesPrerequisite(command: Start, prerequisite?: { base: string }) {
  return !prerequisite || command.base === prerequisite.base;
}

function prerequisiteBinding(command: Start, prerequisite?: { prBase: string; evidence: string }) {
  return prerequisite
    ? { prBase: prerequisite.prBase, prerequisiteEvidence: prerequisite.evidence }
    : { prBase: command.prBase, prerequisiteEvidence: command.prerequisiteEvidence };
}

function retainPrerequisite(
  store: import('./contract.js').JobStore,
  delivery: Delivery | undefined
) {
  return Effect.gen(function* () {
    const pr = verifiedPublication(delivery);
    if (!pr) return;
    const prerequisite = {
      url: pr.url,
      commit: pr.commit,
      reviewedCommit: pr.reviewedCommit,
      parent: pr.parent,
      base: pr.base,
    };
    for (;;) {
      const current = yield* store.readControl();
      if (JSON.stringify(current.prerequisite) === JSON.stringify(prerequisite)) return;
      if (yield* store.saveControl({ ...current, revision: current.revision + 1, prerequisite }))
        return;
    }
  }).pipe(Effect.withSpan('factory.job.retain-prerequisite'));
}

function verifiedPublication(delivery: Delivery | undefined) {
  if (!(delivery?.ready || delivery?.landed)) return null;
  return delivery.pr?.kind === 'found' ? delivery.pr : null;
}

export function trustedAuthor(author: string) {
  return ['rafaeltab', 'zero-two-rafaeltab'].includes(author);
}
