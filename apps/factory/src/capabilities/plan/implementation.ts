import { Effect, Layer } from 'effect';
import { Unavailable } from '../job/index.js';
import {
  Plan,
  PlanningSource,
  IPlanner,
  type PlanningInput,
  type PlanningIssue,
  type Proposal,
} from './contract.js';
const trusted = (author: string) => author === 'rafaeltab' || author === 'zero-two-rafaeltab';
function exclusion(issue: PlanningIssue): string | undefined {
  if (!issue.open) return 'Closed issue';
  if (!trusted(issue.author)) return 'Untrusted author';
  if (!issue.labels.includes('ready-for-agent')) return 'Not ready for agent';
  if (issue.labels.includes('future-work')) return 'Postponed future work';
  if (issue.labels.includes('spec')) return 'Spec requires implementation tickets';
  if (!issue.blockersReady) return 'Explicit blockers lack verified prerequisite readiness';
  return undefined;
}
function cyclic(
  number: number,
  issues: readonly PlanningIssue[],
  path: readonly number[] = []
): boolean {
  if (path.includes(number)) return true;
  const issue = issues.find((i) => i.number === number);
  return issue?.blockers.some((b) => cyclic(b, issues, [...path, number])) ?? false;
}
function selectionReason(
  item: Proposal['selected'][number],
  input: PlanningInput,
  duplicates: boolean
) {
  const issue = input.issues.find((i) => i.number === item.issue);
  if (!issue) return 'Unknown issue in proposal';
  const excluded = exclusion(issue);
  if (excluded) return excluded;
  if (cyclic(item.issue, input.issues)) return 'Cyclic explicit dependencies';
  if (duplicates) return 'Duplicate issue in proposal';
  if (!item.reason.trim()) return 'Missing semantic rationale';
  if (item.dependsOn.length) return 'Inferred prerequisite requires resolution before selection';
  if (item.conflicts.length) return 'Semantic conflict requires resolution before selection';
  if (input.job.kind === 'job' && input.job.intent.issue === item.issue)
    return 'Already active or parked';
  return undefined;
}
function validate(proposal: Proposal, input: PlanningInput) {
  const selected: Proposal['selected'][number][] = [];
  const rejected = input.issues.flatMap((i) => {
    const reason =
      exclusion(i) ?? (cyclic(i.number, input.issues) ? 'Cyclic explicit dependencies' : undefined);
    return reason ? [{ issue: i.number, reason }] : [];
  });
  for (const item of proposal.selected) {
    const reason = selectionReason(
      item,
      input,
      proposal.selected.filter((i) => i.issue === item.issue).length !== 1
    );
    if (reason) rejected.push({ issue: item.issue, reason });
    else selected.push(item);
  }
  for (const item of proposal.deferred) rejected.push(item);
  for (const issue of input.issues) {
    if (
      !selected.some((i) => i.issue === issue.number) &&
      !rejected.some((i) => i.issue === issue.number)
    )
      rejected.push({ issue: issue.number, reason: 'Not selected by semantic planner' });
  }
  return { selected, rejected };
}
export const PlanLive = Layer.effect(
  Plan,
  Effect.gen(function* () {
    const source = yield* PlanningSource;
    const planner = yield* IPlanner;
    let pending = false;
    return {
      preview: () =>
        Effect.gen(function* () {
          if (pending)
            return yield* Effect.fail(new Unavailable({ operation: 'plan-busy', cause: null }));
          pending = true;
          return yield* Effect.gen(function* () {
            const input = yield* source.read();
            const proposal = yield* planner.propose(input);
            const current = yield* source.read();
            if (
              JSON.stringify({
                ...input,
                job: input.job.kind === 'job' ? { ...input.job, elapsedMs: 0 } : input.job,
              }) !==
              JSON.stringify({
                ...current,
                job: current.job.kind === 'job' ? { ...current.job, elapsedMs: 0 } : current.job,
              })
            )
              return {
                kind: 'stale' as const,
                selected: [],
                rejected: [
                  { issue: 0, reason: 'Inputs changed during planning. Request a fresh preview.' },
                ],
                input: current,
              };
            return { kind: 'preview' as const, ...validate(proposal, input), input };
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                pending = false;
              })
            )
          );
        }).pipe(Effect.withSpan('factory.plan.preview')),
    };
  })
);
