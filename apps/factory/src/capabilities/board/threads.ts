import { type ProjectionContext, t3 } from './context.js';
import { entity, known, pullId, threadId, timestamp, unknown } from './values.js';
export function populateThreads(context: ProjectionContext) {
  const { tables, input, ensureIssue } = context;
  // Associations use explicit provider/factory evidence. T3 status never grants execution authority.
  const threadFacts = input.threads?.facts,
    threadAt = timestamp(input.threads?.observedAt);
  if (!threadFacts) return;
  for (const t of threadFacts.threads) {
    const id = threadId(threadFacts.environmentId, t.threadId);
    const issues = [...new Set((t.associations ?? []).map((a) => ensureIssue(a.issue)))];
    const pulls = t.pullRequests
      .filter((p) => p.repository === 'rafaeltab/wallpaperdb')
      .map((p) => pullId(p.number))
      .filter((p) => tables.pullRequests[p]);
    const path = `${encodeURIComponent(threadFacts.environmentId)}/${encodeURIComponent(t.threadId)}`;
    tables.threads[id] = entity({
      id,
      metadata: threadAt
        ? known(
            {
              title: t.title,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
              status: t.status,
              environmentId: threadFacts.environmentId,
              threadId: t.threadId,
              webUrl: input.threads?.browserOrigin
                ? `${input.threads.browserOrigin}/${path}`
                : null,
              nativeUrl: `t3code://threads/${path}`,
            },
            t3,
            threadAt
          )
        : unknown(t3),
      association:
        t.associationState === 'evidenced'
          ? {
              state: 'confirmed' as const,
              issueIds: issues,
              pullRequestIds: pulls,
              evidence: (t.associations ?? []).some((a) => a.evidence === 'factory-binding')
                ? ('factory-binding' as const)
                : ('closing-reference' as const),
            }
          : {
              state:
                t.associationState === 'conflicting'
                  ? ('ambiguous' as const)
                  : t.associationState === 'absent'
                    ? ('absent' as const)
                    : ('unknown' as const),
              reasons: [],
            },
    });
  }
  for (const failure of input.planningSafety?.notice?.failures ?? []) {
    if (!failure.threadId) continue;
    const id = threadId(threadFacts.environmentId, failure.threadId);
    tables.threads[id] ??= entity({
      id,
      metadata: unknown(t3),
      association: {
        state: 'unknown' as const,
        reasons: [
          {
            code: 'planning-context',
            message:
              'Retained planning failure references this thread; issue associations are unavailable.',
          },
        ],
      },
    });
  }
}
