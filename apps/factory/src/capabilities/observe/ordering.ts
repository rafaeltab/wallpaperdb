import type { ItemObservation } from './contract.js';

type JobObservation = Extract<ItemObservation, { kind: 'job' }>['value'];

/** Eligibility precedes collection ordering in both buffering and persistence. */
export function jobObservationIsOlder(previous: JobObservation | undefined, next: JobObservation) {
  if (!previous) return false;
  if ((previous.stageIndex ?? -1) > (next.stageIndex ?? -1)) return true;
  const before = previous.execution;
  const after = next.execution;
  return (
    previous.stageIndex === next.stageIndex &&
    before.kind === 'found' &&
    after.kind === 'found' &&
    !!before.run &&
    !!after.run &&
    before.run.ordinal > after.run.ordinal
  );
}
