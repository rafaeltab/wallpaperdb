import { eligible, trustedAuthor } from '../job/index.js';
import type { Facts, IssueObservation } from '../observe/index.js';
import type { ScheduleState } from '../plan/index.js';
import type { Decision, Relationship } from './model.js';
import { known, pullId, unknown } from './values.js';
export function issueEligibility(issue: IssueObservation, state: ScheduleState): Decision {
  const decision = (status: Decision['state'], message: string): Decision => ({
    state: status,
    reasons: message ? [{ code: status, message }] : [],
    sourceIds: ['source:github', 'source:factory'],
  });
  if (!issue.open || !issue.candidate)
    return decision('blocked', 'An open ready-for-agent issue is required.');
  if (state.admissions.some((a) => a.issue === issue.number))
    return decision('blocked', 'Issue already admitted.');
  if (issue.evaluation)
    return decision(
      issue.evaluation.allowed ? 'allowed' : 'blocked',
      issue.evaluation.allowed
        ? ''
        : 'Current factory policy or prerequisite verification prevents admission.'
    );
  if (issue.blockers.length || !issue.author)
    return decision('unknown', 'Current factory eligibility verification is unavailable.');
  return decision(
    eligible({ ...issue, author: issue.author, blockersReady: true }) ? 'allowed' : 'blocked',
    ''
  );
}
export function relationshipEvidence(native: boolean, issue: IssueObservation, at: string | null) {
  if (!at) return unknown('source:github');
  if (native) return known('github-native' as const, 'source:github', at);
  return issue.author && trustedAuthor(issue.author)
    ? known('trusted-fallback' as const, 'source:github', at)
    : unknown('source:github', 'Fallback relationship is not authored by a trusted maintainer.');
}
export function satisfaction(
  issue: IssueObservation,
  blocker: number,
  facts: Facts
): Extract<Relationship, { kind: 'prerequisite' }>['satisfaction'] {
  const unavailable = {
    state: 'unknown' as const,
    reasons: [
      { code: 'unverified', message: 'Current-tree prerequisite verification is unavailable.' },
    ],
  };
  const evaluation = issue.evaluation;
  if (!evaluation?.blockersReady) return unavailable;
  const proof = evaluation.prerequisites.find((p) => p.issue === blocker);
  if (!proof) return unavailable;
  const pr = facts.pullRequests.find((p) => p.number === proof.pr);
  if (!pr || pr.head !== proof.commit) return unavailable;
  if (
    proof.basis === 'verified-unmerged' &&
    (pr.state !== 'OPEN' || proof.parent !== pr.base || proof.prBase !== pr.baseBranch)
  )
    return unavailable;
  if (proof.basis === 'verified-landed' && pr.state !== 'MERGED') return unavailable;
  return {
    state: 'satisfied',
    basis: proof.basis,
    pullRequestId: pullId(pr.number),
    comparison: { headOid: pr.head, baseOid: pr.base, baseRef: pr.baseBranch },
    verifiedAt: new Date(evaluation.verifiedAt).toISOString(),
  };
}
