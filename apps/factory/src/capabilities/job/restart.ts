import { Effect } from 'effect';
import { associateStage } from './stages.js';
import type {
  Control,
  Execution,
  Intent,
  JobStore,
  Observation,
  Retry,
  RetryAction,
  StageRequest,
} from './contract.js';

export function attemptIntent(intent: Intent, index: number): Intent {
  return index === 0
    ? intent
    : {
        ...intent,
        id: `${intent.id}:retry-${index}`,
        branch: `${intent.branch}-retry-${index}`,
      };
}

export function restartAction(
  store: JobStore,
  execution: Execution,
  intent: Intent,
  control: Control,
  stage: StageRequest | null,
  observed: Observation
) {
  return Effect.gen(function* () {
    if (
      control.cancelled ||
      control.prerequisite ||
      control.parked?.index === stage?.index ||
      stage?.stage !== 'implementation' ||
      observed.kind !== 'found' ||
      stage.threadId !== observed.threadId ||
      observed.question ||
      !observed.run ||
      !['completed', 'failed', 'interrupted', 'cancelled'].includes(observed.status)
    )
      return undefined;
    const evidence = yield* execution.inspectStage(intent, stage);
    if (
      !evidence ||
      evidence.accepted ||
      evidence.runId !== observed.run.id ||
      evidence.ordinal !== observed.run.ordinal ||
      evidence.ordinal !== (stage.ordinal ?? stage.index + 1)
    )
      return undefined;
    if (!(yield* associateStage(store, evidence, stage))) return undefined;
    return {
      index: stage.index,
      attempt: control.restart?.index ?? 0,
      revision: control.revision,
      threadId: observed.threadId,
      runId: observed.run.id,
      base: intent.base,
    } satisfies RetryAction;
  });
}

export function matchesRestart(action: RetryAction | undefined, command: Retry) {
  return (
    action !== undefined &&
    action.index === command.index &&
    action.attempt === command.attempt &&
    action.revision === command.revision &&
    action.threadId === command.threadId &&
    action.runId === command.runId &&
    action.base === command.base
  );
}
