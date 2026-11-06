import type { PlanningAttempt } from '../plan/index.js';
import type { FactoryV2Snapshot, FactoryV2PlanDetails, PlanAttempt, Tables } from './model.js';
import { entity, timestamp, issueId, unknown } from './values.js';
export function planDetails(
  attempt: PlanningAttempt,
  snapshot: FactoryV2Snapshot,
  basis?: PlanAttempt['basis']
): FactoryV2PlanDetails {
  const issues: Tables['issues'] = { ...snapshot.entities.issues };
  const referenced = new Set<number>();
  for (const selected of attempt.result?.selected ?? []) {
    referenced.add(selected.issue);
    for (const n of [...selected.dependsOn, ...selected.conflicts]) referenced.add(n);
  }
  for (const rejected of attempt.result?.rejected ?? [])
    if (rejected.issue > 0) referenced.add(rejected.issue);
  for (const number of referenced) {
    const id = issueId(number);
    if (!issues[id])
      Object.assign(issues, {
        [id]: entity({
          id,
          repositoryId: 'repository:rafaeltab/wallpaperdb',
          number,
          metadata: unknown(
            'source:github',
            'Historical proposal context is not currently observed.'
          ),
          project: unknown('source:github'),
          eligibility: { state: 'unknown', reasons: [], sourceIds: ['source:github'] },
        }),
      });
  }
  const plan: PlanAttempt = entity({
    id: `plan:${attempt.id}`,
    startedAt: new Date(attempt.startedAt).toISOString(),
    deadline: new Date(attempt.deadline).toISOString(),
    finishedAt: timestamp(attempt.finishedAt),
    phase: attempt.phase,
    progress: attempt.detail ?? attempt.phase,
    threadId: null,
    basis: basis ?? {
      boardCursor: snapshot.cursor,
      inputVersion: 'unknown',
      controlVersion: 'unknown',
    },
    applicability: attempt.result?.kind === 'stale' ? 'stale' : 'unknown',
    result: attempt.result
      ? {
          selected: attempt.result.selected.map((s) => ({
            issueId: issueId(s.issue),
            reason: s.reason,
            dependsOn: s.dependsOn.map(issueId),
            conflicts: s.conflicts.map(issueId),
          })),
          rejected: attempt.result.rejected
            .filter((r) => r.issue > 0)
            .map((r) => ({ issueId: issueId(r.issue), reason: r.reason })),
          deferred: [],
        }
      : null,
  });
  const { repositories, labels, users, sources, threads } = snapshot.entities;
  return {
    apiVersion: 2,
    attempt: plan,
    entities: { issues, repositories, labels, users, sources, threads },
  };
}
