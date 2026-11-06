import type { BoardPlan } from './contract.js';
import type { PlanDetails, BoardSnapshot, PlanAttempt, Tables } from './model.js';
import { entity, issueId, timestamp, unknown } from './values.js';
import { coverageFor } from './coverage.js';
export function includePlan(
  snapshot: BoardSnapshot,
  detail: PlanDetails,
  providerAvailable: boolean
): BoardSnapshot {
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      currentPlanId: detail.attempt.id,
      coverage: coverageFor(detail.entities.issues, providerAvailable),
    },
    entities: {
      ...snapshot.entities,
      issues: detail.entities.issues,
      plans: { [detail.attempt.id]: detail.attempt },
    },
  };
}
export function planDetails(
  attempt: BoardPlan,
  snapshot: BoardSnapshot,
  basis?: PlanAttempt['basis'],
  currentInputVersion?: string
): PlanDetails {
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
    phase:
      attempt.launch?.phase === 'uncertain' ||
      attempt.launch?.phase === 'launch-intent' ||
      (!!attempt.finishedAt &&
        !!attempt.launch &&
        !attempt.launch.retired &&
        attempt.launch.phase !== 'succeeded' &&
        attempt.launch.phase !== 'failed')
        ? 'uncertain'
        : attempt.phase,
    progress: attempt.detail ?? attempt.phase,
    threadId: attempt.launch?.run
      ? (Object.values(snapshot.entities.threads).find(
          (t) =>
            t.metadata.state === 'known' &&
            t.metadata.value.threadId === attempt.launch?.run?.threadId
        )?.id ?? null)
      : null,
    basis: basis ?? {
      boardCursor: 'unavailable',
      inputVersion: 'unknown',
      controlVersion: 'unknown',
    },
    applicability:
      attempt.result?.kind === 'stale'
        ? 'stale'
        : basis && currentInputVersion
          ? basis.inputVersion === currentInputVersion
            ? 'current'
            : 'stale'
          : 'unknown',
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
    attempt: plan,
    entities: { issues, repositories, labels, users, sources, threads },
  };
}
