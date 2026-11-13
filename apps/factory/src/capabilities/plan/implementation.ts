import { Effect, Layer, Option } from 'effect';
import { Unavailable, type Status } from '../job/index.js';
import {
  Plan,
  PlanningSource,
  IPlanner,
  ScheduleStore,
  type PlanningInput,
  type PlanningIssue,
  type Proposal,
} from './contract.js';
const trusted = (author: string) => author === 'rafaeltab' || author === 'zero-two-rafaeltab';
function exclusion(issue: PlanningIssue): string | undefined {
  if (issue.metadata?.candidate === false) return 'Context-only issue';
  if (!issue.open) return 'Closed issue';
  if (!trusted(issue.author)) return 'Untrusted author';
  if (!issue.labels.includes('ready-for-agent')) return 'Not ready for agent';
  if (issue.labels.includes('future-work')) return 'Postponed future work';
  if (issue.labels.includes('spec')) return 'Spec requires implementation tickets';
  return dependencyExclusion(issue);
}
function dependencyExclusion(issue: PlanningIssue) {
  if (!issue.blockersReady && !issue.joinRequired)
    return issue.blockedReason ?? 'Explicit blockers lack verified prerequisite readiness';
  return undefined;
}
function cycleCheck(issues: readonly PlanningIssue[]) {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const completed = new Map<number, boolean>();
  const active = new Set<number>();
  const cyclic = (number: number): boolean => {
    if (active.has(number)) return true;
    const known = completed.get(number);
    if (known !== undefined) return known;
    active.add(number);
    const result = byNumber.get(number)?.blockers.some(cyclic) ?? false;
    active.delete(number);
    completed.set(number, result);
    return result;
  };
  return cyclic;
}
function selectionReason(
  item: Proposal['selected'][number],
  input: PlanningInput,
  duplicates: boolean,
  cyclic: (number: number) => boolean
) {
  const issue = input.issues.find((i) => i.number === item.issue);
  if (!issue) return 'Unknown issue in proposal';
  const excluded = exclusion(issue);
  if (excluded) return excluded;
  if (cyclic(item.issue)) return 'Cyclic explicit dependencies';
  if (duplicates) return 'Duplicate issue in proposal';
  if (locallyBlocked(issue.blockers, input.jobs ?? []))
    return 'Prerequisite job is active or parked';
  return semanticReason(item, input);
}
function semanticReason(item: Proposal['selected'][number], input: PlanningInput) {
  if (!item.reason.trim()) return 'Missing semantic rationale';
  if ('dependsOn' in item || 'conflicts' in item || !Array.isArray(item.includeCodeFromIssues))
    return 'Legacy proposal has no execution authority';
  if (new Set(item.includeCodeFromIssues).size !== item.includeCodeFromIssues.length)
    return 'Duplicate included issue';
  if (item.includeCodeFromIssues.some((number) => !Number.isSafeInteger(number) || number < 1))
    return 'Invalid included issue';
  if (
    item.includeCodeFromIssues.some(
      (number) =>
        !input.issues.some((issue) => issue.number === number || issue.blockers.includes(number)) &&
        !knownJobs(input).some(
          (job) =>
            job.kind === 'job' &&
            job.intent.issue === number &&
            (job.delivery?.ready || job.delivery?.landed)
        )
    )
  )
    return 'Unknown included issue';
  if (locallyBlocked(item.includeCodeFromIssues, knownJobs(input)))
    return 'Included implementation is unresolved';
  if (knownJobs(input).some((job) => job.kind === 'job' && job.intent.issue === item.issue))
    return 'Already active or parked';
  if (input.admissions?.includes(item.issue)) return 'Already admitted';
  return undefined;
}
function repeated(issue: number, proposal: Proposal) {
  return (
    proposal.selected.filter((i) => i.issue === issue).length !== 1 ||
    proposal.deferred.some((i) => i.issue === issue)
  );
}
export function validate(proposal: Proposal, input: PlanningInput) {
  const cyclic = cycleCheck(input.issues);
  const selectedIssues = new Set(proposal.selected.map((item) => item.issue));
  const invalidBatch = proposal.selected.some((item) =>
    item.includeCodeFromIssues?.some((number) => selectedIssues.has(number))
  );
  const omittedMandatory = proposal.selected.some((item) =>
    input.issues
      .find((issue) => issue.number === item.issue)
      ?.blockers.some(
        (number) =>
          input.issues.some((issue) => issue.number === number && issue.open) &&
          !item.includeCodeFromIssues?.includes(number)
      )
  );
  const overCapacity =
    input.maximumSelections !== undefined && proposal.selected.length > input.maximumSelections;
  const selected: Proposal['selected'][number][] = [];
  const rejected = input.issues.flatMap((i) => {
    const reason = exclusion(i) ?? (cyclic(i.number) ? 'Cyclic explicit dependencies' : undefined);
    return reason ? [{ issue: i.number, reason }] : [];
  });
  for (const item of proposal.selected) {
    const reason = omittedMandatory
      ? 'Mandatory prerequisite omitted from inclusion list'
      : invalidBatch
        ? 'Inclusion names unfinished selected work'
        : overCapacity
          ? 'Proposal exceeds maximum selection count'
          : selectionReason(item, input, repeated(item.issue, proposal), cyclic);
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
  return {
    selected,
    rejected: rejected.filter(
      (item, index) =>
        rejected.findIndex(
          (other) => other.issue === item.issue && other.reason === item.reason
        ) === index
    ),
  };
}
export const PlanLive = Layer.effect(
  Plan,
  Effect.gen(function* () {
    const source = yield* PlanningSource;
    const planner = yield* IPlanner;
    const store = Option.getOrUndefined(yield* Effect.serviceOption(ScheduleStore));
    let pending = false;
    return {
      preview: (attempt) =>
        Effect.gen(function* () {
          if (pending)
            return yield* Effect.fail(new Unavailable({ operation: 'plan-busy', cause: null }));
          pending = true;
          return yield* Effect.gen(function* () {
            if (attempt) yield* attempt.progress('discovery');
            const observed = yield* source.read();
            const input = boundedInput({
              ...observed,
              maximumSelections: attempt?.maximumSelections ?? observed.maximumSelections,
            });
            if (!input.maximumSelections || (input.paused && attempt?.automatic))
              return {
                kind: 'preview' as const,
                selected: [],
                rejected: input.issues.map((issue) => ({
                  issue: issue.number,
                  reason:
                    exclusion(issue) ??
                    (knownJobs(input).some(
                      (job) => job.kind === 'job' && job.intent.issue === issue.number
                    )
                      ? 'Already active or parked'
                      : input.admissions?.includes(issue.number)
                        ? 'Already admitted'
                        : 'No available selection capacity'),
                })),
                input,
              };
            if (attempt) yield* attempt.progress('handoff');
            const proposal = yield* planner.propose(input, {
              requestId: attempt?.requestId,
              automatic: attempt?.automatic,
              attemptStartedAt: attempt?.attemptStartedAt,
            });
            if ('kind' in proposal)
              return { kind: 'paused' as const, selected: [], rejected: [], input };
            const ownership = attempt?.automatic ? yield* planner.ownership(false) : undefined;
            const modelAttemptId =
              ownership?.automatic && ownership.phase === 'succeeded' && ownership.run
                ? ownership.requestId
                : undefined;
            const validated = validate(proposal, input);
            const verify = source.verify;
            const unavailable =
              verify && validated.selected.length
                ? yield* Effect.forEach(validated.selected, (selection) =>
                    Effect.map(verify(selection), (reason) =>
                      reason ? { issue: selection.issue, reason } : undefined
                    )
                  )
                : [];
            if (attempt) yield* attempt.progress('freshness');
            const currentObserved = yield* source.read();
            const current = boundedInput({
              ...currentObserved,
              maximumSelections: attempt?.maximumSelections ?? currentObserved.maximumSelections,
            });
            if (JSON.stringify(comparable(input)) !== JSON.stringify(comparable(current)))
              return {
                kind: 'stale' as const,
                selected: [],
                rejected: [
                  { issue: 0, reason: 'Inputs changed during planning. Request a fresh preview.' },
                ],
                input: current,
              };
            if (unavailable.some(Boolean))
              return {
                kind: 'preview' as const,
                selected: [],
                rejected: [
                  ...validated.rejected,
                  ...unavailable.filter((item) => item !== undefined),
                ],
                input,
                modelAttemptId,
              };
            return {
              kind: 'preview' as const,
              ...validated,
              input,
              modelAttemptId,
            };
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                pending = false;
              })
            )
          );
        }).pipe(
          (work) =>
            !store || attempt?.automatic
              ? work
              : store
                  .withCycle(
                    Effect.gen(function* () {
                      const retained = (yield* store.read()).cycle;
                      if (retained && retained.selected?.length !== 0)
                        return yield* Effect.fail(
                          new Unavailable({ operation: 'plan-busy', cause: null })
                        );
                      return yield* work;
                    })
                  )
                  .pipe(
                    Effect.flatMap(
                      Option.match({
                        onNone: () =>
                          Effect.fail(new Unavailable({ operation: 'plan-busy', cause: null })),
                        onSome: Effect.succeed,
                      })
                    )
                  ),
          Effect.withSpan('factory.plan.preview')
        ),
    };
  })
);

export function comparable(input: PlanningInput) {
  const normalize = (job: PlanningInput['job']) =>
    job.kind === 'job' ? { ...job, elapsedMs: 0 } : job;
  return { ...input, job: normalize(input.job), jobs: input.jobs?.map(normalize) };
}

function knownJobs(input: PlanningInput) {
  return [input.job, ...(input.jobs ?? [])];
}

export function locallyBlocked(blockers: readonly number[], jobs: readonly Status[]) {
  return blockers.some((number) =>
    jobs.some(
      (job) =>
        job.kind === 'job' &&
        job.intent.issue === number &&
        !job.delivery?.ready &&
        !job.delivery?.landed
    )
  );
}

export function planningInputIdentity(input: PlanningInput) {
  return JSON.stringify(comparable(boundedInput(input)));
}

function boundedInput(input: PlanningInput): PlanningInput {
  const candidates = input.issues.filter(
    (issue) =>
      !exclusion(issue) &&
      !input.admissions?.includes(issue.number) &&
      !knownJobs(input).some((job) => job.kind === 'job' && job.intent.issue === issue.number)
  ).length;
  const bounded = (value: number) => (value === -1 ? candidates : Math.max(0, value));
  return {
    ...input,
    maximumSelections: Math.min(
      candidates,
      input.maximumSelections ??
        Math.min(bounded(input.capacity.concurrency), bounded(input.capacity.admission))
    ),
  };
}

export function requirementsIdentity(input: PlanningInput, selected: Proposal['selected']) {
  const numbers = new Set(selected.flatMap((item) => [item.issue, ...item.includeCodeFromIssues]));
  if (!selected.length) input.issues.forEach((issue) => numbers.add(issue.number));
  for (const number of numbers) {
    const issue = input.issues.find((item) => item.number === number);
    issue?.parents.forEach((parent) => numbers.add(parent));
    issue?.blockers.forEach((blocker) => numbers.add(blocker));
  }
  return JSON.stringify(
    [...numbers]
      .sort((a, b) => a - b)
      .map((number) => {
        const issue = input.issues.find((item) => item.number === number);
        return issue
          ? {
              number,
              body: issue.body,
              comments: issue.comments,
              author: issue.author,
              open: issue.open,
              labels: issue.labels,
              blockers: issue.blockers,
              parents: issue.parents,
              candidate: issue.metadata?.candidate,
            }
          : { number, missing: true };
      })
  );
}
