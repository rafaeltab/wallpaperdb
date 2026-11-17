import type { ScheduleSnapshot } from '../observe/index.js';
import { capacityOccupied } from '../plan/index.js';
import type { ActivityCategory, FactoryActivity, Reason } from './model.js';
import { timestamp } from './values.js';

// Taxonomy only. Presentation order and summary selection belong to the client.
const categories: readonly ActivityCategory[] = [
  'refreshing-github',
  'refreshing-t3',
  'publishing',
  'reviewing',
  'implementing',
  'restacking',
  'recovering',
  'planning',
  'gathering-planning-context',
  'checking-plan-freshness',
  'waiting-for-ci',
  'waiting-for-answers',
];
export function activityFacts(input: ScheduleSnapshot, at: string): FactoryActivity {
  const uncertainty: string[] = [];
  if (input.coordinationIdle !== true || input.state.cycle)
    uncertainty.push('Coordination activity coverage is incomplete.');
  const unfinished = input.state.admissions.some((admission) => {
    const work = input.localWork.find((w) => w.intent?.issue === admission.issue);
    if (work?.control.cancelled) return false;
    const job = input.jobs.find((j) => j.kind === 'job' && j.intent.issue === admission.issue);
    return job?.kind !== 'job' || !(job.delivery?.ready || job.delivery?.landed);
  });
  if (
    unfinished ||
    input.state.recovering?.length ||
    input.state.resuming?.length ||
    input.recoveries?.some((r) => r.phase !== 'complete')
  )
    uncertainty.push('Managed execution or wait coverage is incomplete.');
  const items: FactoryActivity['items'][number][] = [];
  const source = input.observations;
  if (
    source.startedAt !== undefined &&
    source.startedAt > Math.max(source.observedAt ?? -1, source.failedAt ?? -1)
  )
    items.push({
      id: `github-refresh:${source.startedAt}`,
      category: 'refreshing-github',
      lifecycle: 'current',
      issue: null,
      pullRequest: null,
      startedAt: timestamp(source.startedAt),
      reason: 'Reading repository and managed PR metadata',
    });
  const reasons: Reason[] = [];
  if (input.state.paused) reasons.push({ code: 'paused', message: 'Admissions paused' });
  if (input.state.concurrency !== -1 && capacityOccupied(input) >= input.state.concurrency)
    reasons.push({ code: 'concurrency-full', message: 'Concurrency full' });
  if (input.state.allowance !== -1 && input.state.admissions.length >= input.state.allowance)
    reasons.push({ code: 'allowance-exhausted', message: 'Admission allowance exhausted' });
  if (
    source.facts &&
    source.observedAt !== undefined &&
    !source.stale &&
    !source.error &&
    !source.facts.issues.some((i) => i.open && i.candidate)
  )
    reasons.push({ code: 'no-ready-matches', message: 'No ready-filter matches' });
  // Candidate discovery alone cannot establish a planner assessment.
  reasons.push({ code: 'eligibility-unknown', message: 'Eligibility unknown' });
  return {
    observedAt: at,
    items,
    uncertainty,
    admissionReasons: reasons,
    coverage: categories.map((category) => ({
      category,
      state: category === 'refreshing-github' || !uncertainty.length ? 'complete' : 'unknown',
      reason:
        category === 'refreshing-github' || !uncertainty.length
          ? null
          : 'Lifecycle not yet instrumented.',
    })),
  };
}
