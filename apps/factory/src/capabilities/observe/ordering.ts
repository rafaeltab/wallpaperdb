import type { ItemObservation } from './contract.js';

type JobObservation = Extract<ItemObservation, { kind: 'job' }>['value'];

/** Eligibility precedes collection ordering in both buffering and persistence. */
export function jobObservationIsOlder(previous: JobObservation | undefined, next: JobObservation) {
  if (!previous) return false;
  if ((previous.stageIndex ?? -1) > (next.stageIndex ?? -1)) return true;
  const before = previous.execution;
  const after = next.execution;
  // A provisional lifecycle report must not erase a fully reconciled view of
  // the same execution. Changed lifecycle facts still publish immediately.
  if (
    previous.controlRevision !== undefined &&
    next.controlRevision === undefined &&
    previous.stageIndex === next.stageIndex &&
    before.kind === after.kind &&
    (before.kind === 'found' || before.kind === 'unverified') &&
    (after.kind === 'found' || after.kind === 'unverified') &&
    before.threadId === after.threadId &&
    before.run?.id === after.run?.id &&
    before.status === after.status &&
    JSON.stringify(questionLifecycle(before)) === JSON.stringify(questionLifecycle(after))
  )
    return true;
  if (
    previous.stageIndex === next.stageIndex &&
    (before.kind === 'found' || before.kind === 'unverified') &&
    (after.kind === 'found' || after.kind === 'unverified') &&
    before.threadId === after.threadId &&
    before.run?.id &&
    before.run.id === after.run?.id &&
    ['completed', 'idle', 'failed', 'interrupted', 'cancelled', 'rolled_back'].includes(
      before.status
    ) &&
    ['running', 'waiting', 'preparing', 'queued', 'starting'].includes(after.status)
  )
    return true;
  return (
    previous.stageIndex === next.stageIndex &&
    (before.kind === 'found' || before.kind === 'unverified') &&
    (after.kind === 'found' || after.kind === 'unverified') &&
    before.threadId === after.threadId &&
    !!before.run &&
    !!after.run &&
    before.run.ordinal > after.run.ordinal
  );
}

function questionLifecycle(execution: JobObservation['execution']) {
  return execution.kind === 'found'
    ? {
        question: execution.question,
        closed: [...(execution.closedQuestions ?? [])].sort(),
        answered: [...(execution.answeredQuestions ?? [])].sort(),
      }
    : null;
}

/** A completed replacement watcher changes execution evidence, not the retained wait ownership.
 * Explicit delivery outcomes, active repairs, questions and stage changes end that retention. */
export function retainedWaitDelivery(previous: JobObservation | undefined, next: JobObservation) {
  const delivery = previous?.delivery;
  const before = previous?.execution;
  const after = next.execution;
  if (
    next.controlRevision !== undefined ||
    next.delivery?.activity !== undefined ||
    previous?.intent.id !== next.intent.id ||
    previous?.stageIndex !== next.stageIndex ||
    !delivery ||
    delivery.ready ||
    delivery.landed ||
    !['waiting-for-ci', 'waiting-for-github', 'continuation-pending'].includes(
      delivery.activity ?? ''
    ) ||
    delivery.pr?.kind !== 'found' ||
    (next.delivery?.commit !== delivery.commit && next.delivery?.commit !== delivery.waitCommit) ||
    before?.kind !== 'found' ||
    after.kind !== 'found' ||
    before.threadId !== after.threadId ||
    !['completed', 'idle'].includes(after.status) ||
    after.question ||
    after.manual
  )
    return next.delivery;
  return delivery;
}
