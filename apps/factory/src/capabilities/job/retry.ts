import { Effect } from 'effect';
import type {
  Control,
  Delivery,
  Execution,
  Intent,
  Issues,
  PullRequestObservation,
  JobStore,
  Observation,
  Resume,
  ResumeAction,
  StageRequest,
  StageEvidence,
  Status,
  Unavailable,
} from './contract.js';
import { currentStage } from './stages.js';
function retryableStage(control: Control, stage: StageRequest | null): stage is StageRequest {
  return (
    !control.cancelled &&
    stage !== null &&
    stage.stage !== 'ci' &&
    control.parked?.index !== stage.index
  );
}
function terminalRun(
  stage: StageRequest,
  observation: Observation
): observation is Extract<Observation, { kind: 'found' }> & {
  run: { id: string; ordinal: number };
} {
  return (
    observation.kind === 'found' &&
    observation.threadId === stage.threadId &&
    !observation.question &&
    ['interrupted', 'failed'].includes(observation.status) &&
    observation.run !== undefined
  );
}
export function retryAction(
  store: JobStore,
  execution: Execution,
  issues: Issues,
  intent: Intent,
  control: Control,
  stage: StageRequest | null,
  observation: Observation,
  delivery?: Delivery
) {
  return Effect.gen(function* () {
    if (!stage || !eligibleRetry(stage, control, observation, delivery)) return undefined;
    const evidence = yield* execution.inspectStage(intent, stage);
    if (!matchingEvidence(evidence, stage, observation.run)) return undefined;
    if (!retryWorktree(stage, evidence)) return undefined;
    if (!(yield* store.bindRun(stage, evidence.runId, evidence.ordinal))) return undefined;
    if (!(yield* reconcilePublication(issues, intent, stage, evidence))) return undefined;
    return { index: stage.index, runId: evidence.runId, revision: control.revision };
  });
}

export function retryStage(
  store: JobStore,
  intent: Intent,
  command: Extract<Resume, { runId: string }>,
  observe: (intent: Intent) => Effect.Effect<Extract<Status, { kind: 'job' }>, Unavailable>
) {
  return Effect.gen(function* () {
    const latest = yield* observe(intent);
    const action = latest.resume;
    if (intent.id !== command.jobId || !matchesRetry(action, command))
      return { kind: 'rejected' as const };
    const waiting = yield* currentStage(store);
    const control = yield* store.readControl();
    if (!currentRetry(waiting, control, command)) return { kind: 'rejected' as const };
    if (!(yield* store.saveControl({ ...control, revision: control.revision + 1 })))
      return { kind: 'rejected' as const };
    yield* store.saveStage({
      ...waiting,
      index: waiting.index + 1,
      ordinal: (waiting.ordinal ?? waiting.index + 1) + 1,
      previousRunId: command.runId,
      resume: true,
      observedRunId: undefined,
      question: undefined,
      deliveryIndex: undefined,
    });
    return yield* observe(intent);
  }).pipe(Effect.withSpan('factory.job.retry'));
}

function matchesRetry(
  action: ResumeAction | undefined,
  command: Extract<Resume, { runId: string }>
) {
  return (
    action !== undefined &&
    'runId' in action &&
    action.index === command.index &&
    action.runId === command.runId &&
    action.revision === command.revision
  );
}
function currentRetry(
  waiting: StageRequest | null,
  control: Control,
  command: Extract<Resume, { runId: string }>
): waiting is StageRequest {
  return (
    waiting !== null &&
    waiting.index === command.index &&
    control.revision === command.revision &&
    !control.cancelled
  );
}

function matchingEvidence(
  evidence: StageEvidence | null,
  stage: StageRequest,
  run: { id: string; ordinal: number }
): evidence is StageEvidence {
  return (
    evidence !== null &&
    evidence.runId === run.id &&
    evidence.ordinal === run.ordinal &&
    evidence.ordinal === (stage.ordinal ?? stage.index + 1)
  );
}

function retryWorktree(stage: StageRequest, evidence: StageEvidence) {
  return (
    stage.stage !== 'publication' ||
    (evidence.commit === stage.commit && evidence.worktreeClean === true)
  );
}

function reconcilePublication(
  issues: Issues,
  intent: Intent,
  stage: StageRequest,
  evidence: StageEvidence
) {
  if (!['publication', 'babysitting'].includes(stage.stage)) return Effect.succeed(true);
  return issues.pullRequest(intent).pipe(
    Effect.flatMap((pr) => {
      if (publicationMatches(pr, stage)) return Effect.succeed(true);
      if (!pendingReviewedPublication(stage, pr)) return Effect.succeed(false);
      return issues.claimPublicationRetry?.(intent, stage, evidence) ?? Effect.succeed(false);
    })
  );
}
function pendingReviewedPublication(stage: StageRequest, pr: PullRequestObservation) {
  return (
    stage.stage === 'publication' &&
    pr.kind === 'found' &&
    !pr.manualRecovery &&
    pr.maintenancePending
  );
}
function publicationMatches(pr: PullRequestObservation, stage: StageRequest) {
  if (pr.kind === 'absent') return stage.stage === 'publication';
  if (pr.kind !== 'found') return false;
  return pr.commit === stage.commit && !pr.manualRecovery && !pr.maintenancePending;
}

function eligibleRetry(
  stage: StageRequest,
  control: Control,
  observation: Observation,
  delivery?: Delivery
): observation is Extract<Observation, { kind: 'found' }> & {
  run: { id: string; ordinal: number };
} {
  return retryableStage(control, stage) && terminalRun(stage, observation) && !settled(delivery);
}
function settled(delivery?: Delivery) {
  return delivery?.ready === true || delivery?.landed === true;
}
