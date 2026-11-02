import { retryAction, retryStage } from './retry.js';
import { Effect, Layer, Random, Option } from 'effect';
import { reconcileStages, currentStage, hasAnsweredQuestion } from './stages.js';
import {
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
    const continuation = Option.getOrUndefined(yield* Effect.serviceOption(ContinuationAdmission));
    const observe = (intent: Intent) =>
      Effect.gen(function* () {
        const observation = yield* execution.observe(
          intent,
          (yield* currentStage(store)) ?? undefined
        );
        if ((yield* store.readControl()).cancelled && observation.kind === 'found')
          yield* execution.interrupt(intent, observation.threadId);
        const delivery: Delivery | undefined = yield* reconcileStages(
          store,
          execution,
          issues,
          intent,
          observation,
          time,
          continuation
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
            intent,
            control,
            stage,
            observation,
            delivery
          ));
        const now = yield* time.now();
        return {
          kind: 'job' as const,
          intent,
          prerequisite: control.cancelled ? undefined : control.prerequisite,
          resume,
          execution: observation,
          delivery: delivery
            ? { ...delivery, active: delivery.active ?? !delivery.ready }
            : delivery,
          elapsedMs: Math.max(0, now - intent.createdAt),
        };
      }).pipe(Effect.withSpan('factory.job.observe'));
    const resumeQuestion = (
      intent: Intent,
      command: Extract<import('./contract.js').Resume, { questionId: string }>
    ) =>
      Effect.gen(function* () {
        const waiting = yield* currentStage(store);
        const control = yield* store.readControl();
        if (!waiting) return { kind: 'rejected' as const };
        if (!matchesResume(intent, waiting, control, command)) return { kind: 'rejected' as const };
        const observed = yield* execution.observe(intent, waiting);
        if (hasAnsweredQuestion(observed, command.questionId)) return yield* observe(intent);
        if (!resumable(observed, waiting)) return { kind: 'rejected' as const };
        const evidence = yield* resumeEvidence(execution, intent, waiting, observed);
        if (!evidence) return { kind: 'rejected' as const };
        const request = {
          ...waiting,
          index: waiting.index + 1,
          ordinal: evidence.ordinal + 1,
          previousRunId: evidence.runId,
          resume: true,
          observedRunId: undefined,
          question: undefined,
          deliveryIndex: undefined,
        };
        yield* store.saveStage(request);
        return yield* observe(intent);
      });
    return {
      status: () =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          return intent ? yield* observe(intent) : { kind: 'empty' as const };
        }),
      resume: (command) =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          if (!intent) return { kind: 'rejected' as const };
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
            branch: `factory/job-${id}`,
            expectedStage: 'implementation',
          };
          if (!(yield* store.reserve(intent))) return { kind: 'occupied' as const };
          if (yield* store.claimLaunch()) yield* execution.launch(intent);
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
function eligible(issue: {
  open: boolean;
  author: string;
  labels: readonly string[];
  blockersReady: boolean;
}): boolean {
  return (
    issue.open &&
    ['rafaeltab', 'zero-two-rafaeltab'].includes(issue.author) &&
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
  execution: import('./contract.js').Execution,
  intent: Intent,
  waiting: import('./contract.js').StageRequest,
  observed: Extract<import('./contract.js').Observation, { kind: 'found' }>
) {
  if (observed.run)
    return Effect.succeed({ runId: observed.run.id, ordinal: observed.run.ordinal });
  return execution.inspectStage(intent, waiting);
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
