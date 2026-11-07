import type { Attention, Job, Maintenance, PullRequest, StatusCode } from './model.js';
const stageStatus: Record<Job['stage'], StatusCode> = {
  implementation: 'implementing',
  review: 'reviewing-code',
  publication: 'publishing',
  ci: 'ci-running',
  babysitting: 'babysitting',
  unknown: 'unknown',
};
export function factoryStatus(
  jobs: readonly Job[],
  maintenance: readonly Maintenance[],
  question: boolean
): StatusCode | undefined {
  if (
    maintenance.some((m) => m.phase === 'manual-recovery') ||
    jobs.some((j) => j.activity === 'manual-recovery')
  )
    return 'manual-recovery';
  if (question || jobs.some((j) => !j.cancelled && j.question)) return 'awaiting-answer';
  if (jobs.some((j) => j.cancelled)) return 'cancelled';
  if (maintenance.some((m) => m.phase === 'unknown')) return 'unknown';
  if (maintenance.length) return 'restacking';
  if (jobs.some((j) => j.activity === 'continuation-pending' || j.activity === 'resume-pending'))
    return 'continuation-pending';
  if (jobs.some((j) => j.execution.state === 'unknown')) return 'launching';
  if (jobs.some((j) => j.activity === 'repairing')) return 'repairing-ci';
  return jobs[0] ? stageStatus[jobs[0].stage] : undefined;
}
export function providerStatus(pr: PullRequest | undefined): StatusCode | undefined {
  if (!pr) return undefined;
  if (pr.readiness.state === 'ready') return 'ready';
  if (pr.readiness.state === 'landed') return 'landed';
  if (
    pr.reviews.state === 'known' &&
    pr.reviews.value.state === 'required' &&
    pr.metadata.state === 'known' &&
    !pr.metadata.value.draft
  )
    return 'needs-review';
  if (pr.metadata.state === 'known' && pr.metadata.value.mergeability === 'conflicting')
    return 'conflict';
  if (pr.checks.state === 'known' && pr.checks.value.state === 'failed') return 'ci-failed';
  if (pr.checks.state === 'known' && pr.checks.value.state === 'pending') return 'ci-running';
  return undefined;
}
export function attention(code: StatusCode): Attention {
  switch (code) {
    case 'manual-recovery':
      return {
        state: 'required',
        sourceIds: ['source:factory'],
        reasons: [
          {
            code: 'manual-recovery',
            message: 'Operator reconciliation is required.',
            actionIds: [],
          },
        ],
      };
    case 'awaiting-answer':
      return {
        state: 'required',
        sourceIds: ['source:factory'],
        reasons: [
          { code: 'awaiting-answer', message: 'Answer in the owning T3 thread.', actionIds: [] },
        ],
      };
    case 'needs-review':
      return {
        state: 'required',
        sourceIds: ['source:github'],
        reasons: [{ code: 'needs-review', message: 'Human review is required.', actionIds: [] }],
      };
    case 'unknown':
    case 'ci-failed':
    case 'conflict':
    case 'launching':
      return {
        state: 'unknown',
        sourceIds: ['source:factory', 'source:github'],
        reasons: [{ code: 'unknown-authority', message: 'The next actor cannot be established.' }],
      };
    default:
      return { state: 'none', sourceIds: ['source:factory', 'source:github'] };
  }
}
