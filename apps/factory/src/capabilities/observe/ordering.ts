import type { ItemObservation } from './contract.js';

type JobObservation = Extract<ItemObservation, { kind: 'job' }>['value'];

/** Eligibility precedes collection ordering in both buffering and persistence. */
export function jobObservationIsOlder(previous: JobObservation | undefined, next: JobObservation) {
  if (!previous) return false;
  if ((previous.stageIndex ?? -1) > (next.stageIndex ?? -1)) return true;
  const before = previous.execution;
  const after = next.execution;
  if (
    previous.stageIndex === next.stageIndex &&
    (before.kind === 'found' || before.kind === 'unverified') &&
    (after.kind === 'found' || after.kind === 'unverified') &&
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
    !!before.run &&
    !!after.run &&
    before.run.ordinal > after.run.ordinal
  );
}
