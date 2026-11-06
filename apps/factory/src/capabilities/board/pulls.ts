import { type ProjectionContext, gh, local, reason, repositoryId } from './context.js';
import type { Readiness } from './model.js';
import { entity, pullId, unknown } from './values.js';
export function populatePulls(context: ProjectionContext) {
  const { tables, fact, addUser, addLabel, ensureIssue, facts } = context;
  for (const p of facts?.pullRequests ?? []) {
    const id = pullId(p.number);
    const comparison = { headOid: p.head, baseOid: p.base, baseRef: p.baseBranch };
    const evidence = { headOid: p.evidenceHead, baseOid: null, baseRef: null };
    const readiness: Readiness = {
      state: 'unknown',
      reasons: [reason('unverified', 'Provider checks do not establish factory readiness.')],
      sourceIds: [local, gh],
    };
    tables.pullRequests[id] = entity({
      id,
      repositoryId,
      number: p.number,
      metadata:
        p.title !== undefined && p.draft !== undefined && p.updatedAt && p.labelDetails
          ? fact({
              title: p.title,
              url: p.url,
              state:
                p.state === 'OPEN'
                  ? ('open' as const)
                  : p.state === 'MERGED'
                    ? ('merged' as const)
                    : ('closed' as const),
              draft: p.draft,
              labelIds: p.labelDetails.map(addLabel),
              headRef: p.headBranch,
              baseRef: p.baseBranch,
              comparison,
              mergeability:
                p.mergeability === 'MERGEABLE'
                  ? ('clean' as const)
                  : p.mergeability === 'CONFLICTING'
                    ? ('conflicting' as const)
                    : p.mergeability === 'UNKNOWN'
                      ? ('pending' as const)
                      : ('unknown' as const),
              updatedAt: p.updatedAt,
            })
          : unknown(gh, 'Refresh rich PR metadata.'),
      checks: p.checkRuns
        ? fact({
            comparison: evidence,
            state:
              p.ci === 'SUCCESS'
                ? ('passed' as const)
                : p.ci === 'FAILURE'
                  ? ('failed' as const)
                  : p.ci === 'PENDING'
                    ? ('pending' as const)
                    : ('unknown' as const),
            complete: true,
            groups: p.checkRuns.map((c) => ({
              id: c.id,
              name: c.name,
              state: c.state,
              requirement: c.requirement ?? 'unknown',
              total: 1,
              completed: ['passed', 'failed', 'skipped', 'neutral'].includes(c.state) ? 1 : 0,
              url: c.url,
            })),
          })
        : unknown(gh, 'Individual checks not observed.'),
      reviews: p.reviewers
        ? fact({
            comparison: evidence,
            state:
              p.review === 'APPROVED'
                ? ('approved' as const)
                : p.review === 'CHANGES_REQUESTED'
                  ? ('changes-requested' as const)
                  : p.review === 'REVIEW_REQUIRED'
                    ? ('required' as const)
                    : ('unknown' as const),
            complete: true,
            reviewers: p.reviewers.map((r) => ({
              userId: addUser(r.user),
              state: r.state,
              submittedAt: r.submittedAt,
              reviewedHeadOid: r.head,
            })),
          })
        : unknown(gh, 'Reviewers not observed.'),
      readiness,
    });
    for (const n of [...p.linkedIssues, ...p.crossReferencedIssues]) {
      const iid = ensureIssue(n);
      const rid = `relationship:issue-pr/${n}/${p.number}` as const;
      const closing = p.linkedIssues.includes(n);
      tables.relationships[rid] = entity({
        id: rid,
        kind: 'issue-pr',
        issueId: iid,
        pullRequestId: id,
        evidence: fact(closing ? ('closing-reference' as const) : ('cross-reference' as const)),
        ownership: closing ? ('confirmed' as const) : ('context-only' as const),
      });
    }
  }
}
