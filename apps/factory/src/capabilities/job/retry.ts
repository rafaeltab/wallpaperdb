import { Effect } from 'effect';
import type {
  Control,
  Execution,
  Intent,
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
    ['implementation', 'review'].includes(stage.stage) &&
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
  intent: Intent,
  control: Control,
  stage: StageRequest | null,
  observation: Observation
) {
  return Effect.gen(function* () {
    if (!retryableStage(control, stage) || !terminalRun(stage, observation)) return undefined;
    const evidence = yield* execution.inspectStage(intent, stage);
    if (!matchingEvidence(evidence, stage, observation.run)) return undefined;
    if (!(yield* store.bindRun(stage, evidence.runId, evidence.ordinal))) return undefined;
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
