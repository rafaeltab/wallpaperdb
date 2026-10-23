import type { Effect } from 'effect';
import type { CleanupWork } from '../../capabilities/cleanup/index.js';
import { observeWorkflow } from '../commands/index.js';

/** Restore the initiating operation across the durable handoff. Responsibility,
 * claim and notification identities remain distinct from that operation. */
export function observeCleanup<A extends string, E, R>(
  name: string,
  work: Pick<CleanupWork, 'id' | 'assetId' | 'target' | 'context'> &
    Partial<Pick<CleanupWork, 'attempts' | 'leaseId'>>,
  effect: Effect.Effect<A, E, R>,
  extra: Readonly<Record<string, string | number>> = {}
) {
  const context = work.context;
  return observeWorkflow(
    name,
    context,
    {
      'cleanup.responsibility_id': work.id,
      'asset.id': work.assetId,
      ...(work.target.kind === 'source'
        ? { 'source.id': work.target.sourceId }
        : { 'candidate.id': work.target.candidateId }),
      ...(work.attempts === undefined ? {} : { 'event.delivery_attempt': work.attempts }),
      ...(work.leaseId ? { 'cleanup.lease_id': work.leaseId } : {}),
      ...(context
        ? {
            'event.causation_id': context.occurrence.id,
            'event.causation_source': context.occurrence.source,
          }
        : {}),
      ...(context?.correlationId ? { 'event.correlation_id': context.correlationId } : {}),
      ...extra,
    },
    effect
  );
}
