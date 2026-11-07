import { type ProjectionContext } from './context.js';
import { entity, threadId } from './values.js';
export function populateMaintenance(context: ProjectionContext) {
  const { tables, input, ensureIssue } = context;
  const threadFacts = input.threads?.facts;
  for (const recovery of input.recoveries ?? []) {
    if (recovery.phase === 'complete') continue;
    const pr = Object.values(tables.pullRequests).find(
      (p) => p.metadata.state === 'known' && p.metadata.value.url === recovery.pr
    );
    if (!pr) continue;
    const id = `maintenance:${recovery.issue}/${pr.number}` as const;
    const tid =
      threadFacts && recovery.threadId
        ? threadId(threadFacts.environmentId, recovery.threadId)
        : null;
    tables.maintenance[id] = entity({
      id,
      issueId: ensureIssue(recovery.issue),
      pullRequestId: pr.id,
      threadId: tid && tables.threads[tid] ? tid : null,
      phase:
        recovery.phase === 'waiting-capacity'
          ? ('restacking' as const)
          : recovery.phase === 'awaiting-answer' || !recovery.phase
            ? ('unknown' as const)
            : recovery.phase,
      resolution:
        recovery.classification === 'SIMPLE'
          ? ('simple' as const)
          : recovery.classification === 'COMPLEX'
            ? ('complex' as const)
            : ('unknown' as const),
      progress: recovery.question
        ? 'Awaiting an answer in the recovery thread.'
        : recovery.phase === 'manual-recovery'
          ? 'Operator reconciliation is required.'
          : 'Factory recovery is retained.',
      startedAt: null,
      occupiesCapacity: recovery.active !== false,
    });
  }
}
