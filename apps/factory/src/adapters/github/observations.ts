import { Effect } from 'effect';
import { z } from 'zod';
import type {
  ObservationSource,
  IssueObservation,
  PullObservation,
  Facts,
} from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
type GitHubRead = (args: string[], signal?: AbortSignal) => Promise<unknown>;
import { blockerNumbers } from './implementation.js';
import { projectSynchronization, type ProjectSynchronizationOptions } from './project-sync.js';
const number = z.number().int().positive();
const page = z.object({ hasNextPage: z.literal(false) });
const connection = <T extends z.ZodTypeAny>(node: T) =>
  z.object({ nodes: z.array(node), pageInfo: page });
const ref = z.object({ number, url: z.string().url() });
const user = z.object({
  id: z.string(),
  login: z.string(),
  name: z.string().nullable().default(null),
  avatarUrl: z.string().url().nullable(),
  url: z.string().url(),
});
const label = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().regex(/^[a-f0-9]{6}$/i),
});
const choice = z.object({ name: z.string(), optionId: z.string().optional() });
const check = z.object({
  __typename: z.string(),
  id: z.string(),
  name: z.string().optional(),
  context: z.string().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});
const userFields = 'id login name avatarUrl url';
const labelFields = 'id name color';
const pull = ref.extend({
  title: z.string().optional(),
  isDraft: z.boolean().optional(),
  updatedAt: z.string().optional(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']).optional(),
  labels: connection(label).optional(),
  reviewRequests: connection(
    z.object({ requestedReviewer: z.object({ __typename: z.string() }).passthrough().nullable() })
  ).optional(),
  __typename: z.literal('PullRequest'),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  headRefOid: z.string().regex(/^[a-f0-9]{40}$/),
  headRefName: z.string(),
  baseRefOid: z.string().regex(/^[a-f0-9]{40}$/),
  baseRefName: z.string(),
  reviews: connection(
    z.object({
      state: z.string(),
      commit: z.object({ oid: z.string() }).nullable(),
      author: user.nullable().optional(),
      submittedAt: z.string().nullable().optional(),
    })
  ),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  closingIssuesReferences: connection(ref),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          oid: z.string(),
          statusCheckRollup: z
            .object({ state: z.string(), contexts: connection(check).optional() })
            .nullable(),
        }),
      })
    ),
  }),
});
const associationPull = ref.extend({
  __typename: z.literal('PullRequest'),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
});
type AssociatedPull = z.infer<typeof associationPull> & {
  linkedIssues: readonly number[];
  crossReferencedIssues: readonly number[];
};
// Rich PR connections beneath issue timelines multiply GraphQL cost. Hydrate each PR once.
const associationFields = '__typename number url state';
const schema = z.object({
  data: z.object({
    repository: z.object({
      issue: z.object({
        number,
        url: z.string().url(),
        title: z.string(),
        updatedAt: z.string().optional(),
        body: z.string(),
        state: z.enum(['OPEN', 'CLOSED']),
        parent: ref.nullable(),
        author: z.object({ login: z.string() }),
        labels: connection(
          z.object({ name: z.string(), id: z.string().optional(), color: z.string().optional() })
        ),
        assignees: connection(
          z.object({
            login: z.string(),
            id: z.string().optional(),
            name: z.string().nullable().optional(),
            avatarUrl: z.string().nullable().optional(),
            url: z.string().optional(),
          })
        ),
        comments: z.object({ totalCount: z.number().int().nonnegative() }),
        projectItems: connection(
          z.object({
            project: z.object({
              title: z.string(),
              id: z.string().optional(),
              number: z.number(),
              owner: z.object({ login: z.string() }),
            }),
            priority: choice.nullable(),
            size: choice.nullable(),
            fieldValueByName: choice.nullable(),
          })
        ),
        closedByPullRequestsReferences: connection(associationPull),
        timelineItems: connection(
          z.object({
            source: z.union([associationPull, z.object({ __typename: z.literal('Issue') })]),
          })
        ),
      }),
    }),
  }),
});
const issueMetadata = schema.shape.data.shape.repository.shape.issue.omit({
  closedByPullRequestsReferences: true,
  timelineItems: true,
});
const issuePresentationFields = `author { login } parent { number url } labels(first:100) { nodes { ${labelFields} } pageInfo { hasNextPage } } assignees(first:100) { nodes { ${userFields} } pageInfo { hasNextPage } } comments { totalCount } projectItems(first:100) { nodes { project { id title number owner { ... on User { login } ... on Organization { login } } } priority:fieldValueByName(name:"Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } size:fieldValueByName(name:"Size") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } } pageInfo { hasNextPage } }`;
const issueFields = `number url title updatedAt body state ${issuePresentationFields}`;
function translateIssue(
  issue: z.infer<typeof issueMetadata>,
  candidate: boolean,
  blockers: readonly number[],
  parents: readonly number[],
  pullRequests: readonly number[],
  nativeBlockers: readonly number[]
): IssueObservation {
  const projectItem = issue.projectItems.nodes.find(
    (p) => p.project.number === 7 && p.project.owner.login === 'rafaeltab'
  );
  return {
    author: issue.author.login,
    updatedAt: issue.updatedAt,
    labelDetails: issue.labels.nodes.every((l) => l.id && l.color)
      ? issue.labels.nodes.map((l) => label.parse(l))
      : undefined,
    assigneeDetails: issue.assignees.nodes.every((a) => a.id && a.url)
      ? issue.assignees.nodes.map((a) => user.parse(a))
      : undefined,
    projectDetails: projectItem?.project.id
      ? {
          projectId: projectItem.project.id,
          status: selectedChoice(projectItem.fieldValueByName),
          priority: selectedChoice(projectItem.priority, ['P0', 'P1', 'P2', 'P3', 'P4']),
          size: selectedChoice(projectItem.size, ['XS', 'S', 'M', 'L', 'XL']),
        }
      : issue.projectItems.nodes.length === 0
        ? { projectId: null, status: null, priority: null, size: null }
        : undefined,
    nativeParent: issue.parent?.number ?? null,
    nativeBlockers: nativeBlockers,
    number: issue.number,
    url: issue.url,
    title: issue.title,
    open: issue.state === 'OPEN',
    candidate,
    labels: issue.labels.nodes.map((l) => l.name),
    assignees: issue.assignees.nodes.map((a) => a.login),
    projectStatus: projectItem?.fieldValueByName?.name ?? null,
    projectPriority: projectItem?.priority?.name ?? null,
    projectSize: projectItem?.size?.name ?? null,
    commentCount: issue.comments.totalCount,
    blockers,
    parents,
    pullRequests: pullRequests,
  };
}
const pullMetadataFields = '__typename number url title isDraft updatedAt';
const pullRuntimeFields = `number url labels(first:100) { nodes { ${labelFields} } pageInfo { hasNextPage } } closingIssuesReferences(first:100) { nodes { number url } pageInfo { hasNextPage } } mergeable reviewRequests(first:100) { nodes { requestedReviewer { __typename ... on User { ${userFields} } ... on Team { id } } } pageInfo { hasNextPage } } state headRefOid headRefName baseRefOid baseRefName reviewDecision reviews(first:100) { nodes { state submittedAt author { login avatarUrl url ... on User { id name } ... on Bot { id } } commit { oid } } pageInfo { hasNextPage } } commits(last:1) { nodes { commit { oid statusCheckRollup { state contexts(first:100) { nodes { __typename ... on CheckRun { id name status conclusion detailsUrl startedAt completedAt } ... on StatusContext { id context state targetUrl } } pageInfo { hasNextPage } } } } } }`;

export async function observeIssue(
  project: string,
  n: number,
  candidate: boolean,
  signal: AbortSignal,
  read?: (args: string[], signal?: AbortSignal) => Promise<unknown>
) {
  const gh = (args: string[]) =>
    read ? read(args, signal) : command('gh', args, project, signal).then(JSON.parse);
  const [raw, deps] = await Promise.all([
    gh([
      'api',
      'graphql',
      '-f',
      `query=query { repository(owner:"rafaeltab",name:"wallpaperdb") { issue(number:${n}) { ${issueFields} closedByPullRequestsReferences(first:100,includeClosedPrs:true) { nodes { ${associationFields} } pageInfo { hasNextPage } } timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT]) { nodes { ... on CrossReferencedEvent { source { ... on PullRequest { ${associationFields} } ... on Issue { __typename } } } } pageInfo { hasNextPage } } } } }`,
    ]),
    gh([
      'api',
      `repos/rafaeltab/wallpaperdb/issues/${n}/dependencies/blocked_by`,
      '--paginate',
      '--slurp',
    ]),
  ]);
  const native = z
    .array(z.array(z.object({ number, html_url: z.string().url() })))
    .parse(deps)
    .flat();
  return observedIssue(schema.parse(raw).data.repository.issue, n, candidate, native);
}
function observedIssue(
  issue: z.infer<typeof schema>['data']['repository']['issue'],
  n: number,
  candidate: boolean,
  native: readonly { number: number; html_url: string }[]
) {
  if (issue.number !== n || issue.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${n}`)
    throw new Error('Mismatched observation');
  if (
    issue.parent &&
    issue.parent.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${issue.parent.number}`
  )
    throw new Error('Unsupported foreign parent');
  if (
    native.some((i) => i.html_url !== `https://github.com/rafaeltab/wallpaperdb/issues/${i.number}`)
  )
    throw new Error('Unsupported foreign blocker');
  const blockers = blockerNumbers(native, issue.body);
  const parents = [
    ...new Set([
      ...(issue.parent ? [issue.parent.number] : []),
      ...[
        ...issue.body.matchAll(
          /(?:^#{1,6} +Parent[^\n]*\n(?:\s*\n)*|^Parent:\s*)(?:https:\/\/github.com\/rafaeltab\/wallpaperdb\/issues\/|#)(\d+)/gim
        ),
      ].map((m) => Number(m[1])),
    ]),
  ];
  const linked = new Map<number, AssociatedPull>();
  for (const pr of issue.closedByPullRequestsReferences.nodes) {
    if (pr.url !== `https://github.com/rafaeltab/wallpaperdb/pull/${pr.number}`)
      throw new Error('Unsupported foreign linked PR');
    linked.set(pr.number, { ...pr, linkedIssues: [n], crossReferencedIssues: [] });
  }
  for (const { source: pr } of issue.timelineItems.nodes) {
    if (
      pr.__typename !== 'PullRequest' ||
      pr.url !== `https://github.com/rafaeltab/wallpaperdb/pull/${pr.number}`
    )
      continue;
    const previous = linked.get(pr.number);
    linked.set(pr.number, {
      ...(previous ?? { ...pr, linkedIssues: [], crossReferencedIssues: [] }),
      crossReferencedIssues: [n],
    });
  }
  const prs = [...linked.values()];
  const metadata = translateIssue(
    issue,
    candidate,
    blockers,
    parents,
    prs.map((p) => p.number),
    native.map((b) => b.number)
  );
  return { metadata, pullRequests: prs };
}
type EvaluateIssue = (
  number: number
) => Effect.Effect<
  { allowed: boolean; blockersReady: boolean; verifiedAt: number; evidence?: string },
  Unavailable
>;
export function githubObservations(
  project: string,
  admitted: () => Effect.Effect<readonly number[], Unavailable>,
  evaluate?: EvaluateIssue | Effect.Effect<EvaluateIssue, Unavailable>,
  read?: GitHubRead,
  synchronization: ProjectSynchronizationOptions = {}
): ObservationSource {
  const gh =
    read ??
    ((args: string[], signal?: AbortSignal) =>
      command('gh', args, project, signal).then(JSON.parse));
  const synchronizationCache = projectSynchronization(synchronization);
  return {
    read: () =>
      Effect.gen(function* () {
        const retained = yield* admitted();
        const facts: Facts = yield* Effect.tryPromise({
          try: async (signal) => {
            const snapshot = await synchronizationCache.begin(gh, signal);
            const issuePointers = snapshot.members.filter(
              (item) => item.__typename === 'Issue' && item.state === 'OPEN'
            );
            if (issuePointers.length > 1000) throw new Error('Issue index exceeds supported bound');
            const issueFieldsWithContext = `number url parent { number url } comments { totalCount } blockedBy(first:100) { nodes { number url } pageInfo { hasNextPage } } closedByPullRequestsReferences(first:100,includeClosedPrs:true) { nodes { ${associationFields} } pageInfo { hasNextPage } } timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT]) { nodes { ... on CrossReferencedEvent { source { ... on PullRequest { ${associationFields} } ... on Issue { __typename } } } } pageInfo { hasNextPage } }`;
            const rawIssues = await snapshot.hydrate(
              'Issue',
              issuePointers.map((item) => item.number),
              issueFields
            );
            // Hierarchy and shared label, user and project definitions can change without either marker.
            for (const [n, value] of await snapshot.hydrate(
              'Issue',
              issuePointers.map((item) => item.number),
              `number url ${issuePresentationFields}`,
              true
            ))
              rawIssues.set(n, {
                ...z.record(z.unknown()).parse(rawIssues.get(n)),
                ...z.record(z.unknown()).parse(value),
              });
            const refreshRelationships = async (numbers: readonly number[]) => {
              const relations = await snapshot.hydrate(
                'Issue',
                numbers,
                issueFieldsWithContext,
                true
              );
              for (const [n, value] of relations)
                rawIssues.set(n, {
                  ...z.record(z.unknown()).parse(rawIssues.get(n)),
                  ...z.record(z.unknown()).parse(value),
                });
            };
            const decodeIssue = (n: number) => {
              const raw = rawIssues.get(n);
              const parsed = schema.parse({ data: { repository: { issue: raw } } }).data.repository
                .issue;
              const native = z.object({ blockedBy: connection(ref) }).parse(raw).blockedBy.nodes;
              return observedIssue(
                parsed,
                n,
                parsed.state === 'OPEN' &&
                  parsed.labels.nodes.some((l) => l.name === 'ready-for-agent'),
                native.map((b) => ({ number: b.number, html_url: b.url }))
              );
            };
            const index = issuePointers.map((item) => {
              const parsed = issueMetadata.parse(rawIssues.get(item.number));
              if (
                parsed.number !== item.number ||
                parsed.url !== item.url ||
                (parsed.parent &&
                  parsed.parent.url !==
                    `https://github.com/rafaeltab/wallpaperdb/issues/${parsed.parent.number}`)
              )
                throw new Error('Invalid issue index identity');
              return translateIssue(
                parsed,
                parsed.labels.nodes.some((l) => l.name === 'ready-for-agent'),
                [],
                parsed.parent ? [parsed.parent.number] : [],
                [],
                []
              );
            });
            const candidates = index.filter((item) => item.candidate);
            const queue = [...new Set([...candidates.map((i) => i.number), ...retained])];
            const seen = new Set<number>();
            const issues: IssueObservation[] = index.filter(
              (i) => !i.candidate && !retained.includes(i.number)
            );
            const pulls = new Map<number, PullObservation>();
            // Reviews, mergeability, heads and checks are independently mutable. Refresh
            // every relevant PR in bounded batches, regardless of project timestamps.
            const collectPulls = async (numbers: readonly number[]) => {
              const metadata = await snapshot.hydrate('PullRequest', numbers, pullMetadataFields);
              const values = await snapshot.hydrate(
                'PullRequest',
                numbers,
                pullRuntimeFields,
                true
              );
              for (const [n, raw] of values) {
                const parsed = pull.parse({
                  ...z.record(z.unknown()).parse(metadata.get(n)),
                  ...z.record(z.unknown()).parse(raw),
                });
                if (
                  parsed.number !== n ||
                  parsed.url !== `https://github.com/rafaeltab/wallpaperdb/pull/${n}`
                )
                  throw new Error('Invalid related PR identity');
                pulls.set(n, translatePull(parsed));
              }
            };
            await collectPulls(
              snapshot.members
                .filter((item) => item.__typename === 'PullRequest' && item.state === 'OPEN')
                .map((item) => item.number)
            );
            for (const [n, pr] of pulls) {
              if (pr.state !== 'OPEN') pulls.delete(n);
              else queue.push(...pr.linkedIssues);
            }
            while (queue.length) {
              const batch = [...new Set(queue.splice(0, 20))].filter((n) => !seen.has(n));
              for (const n of batch) seen.add(n);
              if (seen.size > 1000) throw new Error('Context exceeds supported bound');
              const missing = batch.filter((n) => !rawIssues.has(n));
              for (const [n, raw] of await snapshot.hydrate('Issue', missing, issueFields))
                rawIssues.set(n, raw);
              await refreshRelationships(batch);
              const values = batch.map(decodeIssue);
              await collectPulls(
                [
                  ...new Set(values.flatMap((value) => value.pullRequests.map((pr) => pr.number))),
                ].filter((n) => !pulls.has(n))
              );
              for (const value of values) {
                const existing = issues.findIndex((i) => i.number === value.metadata.number);
                if (existing >= 0) issues.splice(existing, 1);
                issues.push(value.metadata);
                for (const pr of value.pullRequests) {
                  const previous = pulls.get(pr.number);
                  if (!previous || previous.state !== pr.state)
                    throw new Error('Inconsistent related PR observation');
                  pulls.set(pr.number, {
                    ...previous,
                    linkedIssues: [...new Set([...previous.linkedIssues, ...pr.linkedIssues])],
                    crossReferencedIssues: [
                      ...new Set([
                        ...(previous?.crossReferencedIssues ?? []),
                        ...pr.crossReferencedIssues,
                      ]),
                    ],
                  });
                }
                queue.push(...value.metadata.blockers, ...value.metadata.parents);
              }
            }
            const facts = {
              issues: issues.sort((a, b) => a.number - b.number),
              pullRequests: await checkRequirements(gh, [...pulls.values()], signal),
              verifiedPrBases: await verifiedBases(gh, [...pulls.values()], signal),
            };
            snapshot.commit();
            return facts;
          },
          catch: (cause) => new Unavailable({ operation: 'github-observations', cause }),
        }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.github.observations'));
        const inspect =
          typeof evaluate === 'function' ? evaluate : evaluate ? yield* evaluate : undefined;
        if (!inspect) return facts;
        const issues = yield* Effect.all(
          facts.issues.map((issue) =>
            !issue.candidate
              ? Effect.succeed(issue)
              : inspect(issue.number).pipe(
                  Effect.flatMap((value) =>
                    Effect.try({
                      try: () => {
                        const evidence = z
                          .array(
                            z.object({
                              issue: number,
                              pr: number,
                              commit: z.string(),
                              parent: z.string().optional(),
                              prBase: z.string().optional(),
                              tip: z.string().optional(),
                              originalHead: z.string().optional(),
                            })
                          )
                          .parse(JSON.parse(value.evidence ?? '[]'));
                        return {
                          ...issue,
                          evaluation: {
                            allowed: value.allowed,
                            blockersReady: value.blockersReady,
                            verifiedAt: value.verifiedAt,
                            prerequisites: evidence.map((e) => ({
                              ...e,
                              commit: e.originalHead ?? e.commit,
                              basis: e.tip
                                ? ('verified-landed' as const)
                                : ('verified-unmerged' as const),
                            })),
                          },
                        };
                      },
                      catch: (cause) =>
                        new Unavailable({ operation: 'observation-verification', cause }),
                    })
                  ),
                  Effect.catch((error) => Effect.logError(error).pipe(Effect.as(issue)))
                )
          ),
          { concurrency: 4 }
        );
        return { ...facts, issues };
      }),
  };
}

function translatePull(pr: z.infer<typeof pull>): PullObservation {
  const commit = pr.commits.nodes[0]?.commit;
  const ci = commit?.oid === pr.headRefOid ? commit.statusCheckRollup?.state : undefined;
  return {
    title: pr.title,
    draft: pr.isDraft,
    updatedAt: pr.updatedAt,
    mergeability: pr.mergeable,
    labelDetails: pr.labels?.nodes,
    checkRuns:
      commit?.oid === pr.headRefOid
        ? commit.statusCheckRollup?.contexts?.nodes.map((c) => ({
            id: c.id,
            name: c.name ?? c.context ?? 'Unknown check',
            state: checkState(c.conclusion ?? c.state ?? c.status),
            url: c.detailsUrl ?? c.targetUrl ?? null,
            head: commit.oid,
            startedAt: c.startedAt ?? null,
            completedAt: c.completedAt ?? null,
          }))
        : undefined,
    reviewersComplete: pr.reviewRequests
      ? pr.reviews.nodes.every((r) => !!r.author) &&
        pr.reviewRequests.nodes.every((r) => user.safeParse(r.requestedReviewer).success)
      : undefined,
    reviewers: pr.reviewRequests
      ? [
          ...pr.reviews.nodes.flatMap((r) =>
            r.author
              ? [
                  {
                    user: r.author,
                    state: reviewState(r.state),
                    submittedAt: r.submittedAt ?? null,
                    head: r.commit?.oid ?? null,
                  },
                ]
              : []
          ),
          ...pr.reviewRequests.nodes.flatMap((r) => {
            const parsed = user.safeParse(r.requestedReviewer);
            return parsed.success
              ? [{ user: parsed.data, state: 'requested' as const, submittedAt: null, head: null }]
              : [];
          }),
        ]
      : undefined,
    number: pr.number,
    url: pr.url,
    state: pr.state,
    head: pr.headRefOid,
    headBranch: pr.headRefName,
    base: pr.baseRefOid,
    baseBranch: pr.baseRefName,
    crossReferencedIssues: [],
    linkedIssues: pr.closingIssuesReferences.nodes
      .filter((i) => i.url === `https://github.com/rafaeltab/wallpaperdb/issues/${i.number}`)
      .map((i) => i.number),
    review:
      pr.reviewDecision === 'APPROVED' &&
      !pr.reviews.nodes.some((r) => r.state === 'APPROVED' && r.commit?.oid === pr.headRefOid)
        ? 'UNKNOWN'
        : (pr.reviewDecision ?? 'UNKNOWN'),
    ci:
      ci === 'SUCCESS'
        ? 'SUCCESS'
        : ci === 'FAILURE' || ci === 'ERROR'
          ? 'FAILURE'
          : ci === 'PENDING' || ci === 'EXPECTED'
            ? 'PENDING'
            : 'UNKNOWN',
    evidenceHead: pr.headRefOid,
  };
}

function selectedChoice(value: z.infer<typeof choice> | null, order: string[] = []) {
  if (!value?.optionId) return null;
  const rank = order.indexOf(value.name);
  return { id: value.optionId, name: value.name, rank: rank < 0 ? null : rank };
}
function checkState(
  value: string | null | undefined
): NonNullable<PullObservation['checkRuns']>[number]['state'] {
  switch (value) {
    case 'SUCCESS':
      return 'passed';
    case 'FAILURE':
    case 'ERROR':
    case 'TIMED_OUT':
    case 'CANCELLED':
    case 'ACTION_REQUIRED':
      return 'failed';
    case 'IN_PROGRESS':
    case 'PENDING':
      return 'running';
    case 'QUEUED':
    case 'WAITING':
    case 'REQUESTED':
    case 'EXPECTED':
      return 'queued';
    case 'SKIPPED':
      return 'skipped';
    case 'NEUTRAL':
      return 'neutral';
    default:
      return 'unknown';
  }
}
function reviewState(value: string): NonNullable<PullObservation['reviewers']>[number]['state'] {
  switch (value) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes-requested';
    case 'DISMISSED':
      return 'dismissed';
    default:
      return 'commented';
  }
}

async function verifiedBases(
  read: GitHubRead,
  pulls: readonly PullObservation[],
  signal: AbortSignal
) {
  const edges: { base: number; tip: number }[] = [];
  for (const tip of pulls.filter((p) => p.state === 'OPEN')) {
    const matches = pulls.filter(
      (p) =>
        p.state === 'OPEN' &&
        p.number !== tip.number &&
        p.headBranch === tip.baseBranch &&
        p.head === tip.base
    );
    if (matches.length !== 1) continue;
    const base = matches[0];
    const comparison = z
      .object({ status: z.string(), merge_base_commit: z.object({ sha: z.string() }) })
      .parse(
        await read(
          ['api', `repos/rafaeltab/wallpaperdb/compare/${base.head}...${tip.head}`],
          signal
        )
      );
    if (
      ['ahead', 'identical'].includes(comparison.status) &&
      comparison.merge_base_commit.sha === base.head
    )
      edges.push({ base: base.number, tip: tip.number });
  }
  return edges;
}

async function checkRequirements(
  read: GitHubRead,
  pulls: readonly PullObservation[],
  signal: AbortSignal
): Promise<readonly PullObservation[]> {
  const entries = pulls.flatMap((pr) =>
    (pr.checkRuns ?? []).map((check) => ({ pr: pr.number, check }))
  );
  const requirements = new Map<string, boolean>();
  for (let offset = 0; offset < entries.length; offset += 100) {
    const batch = entries.slice(offset, offset + 100);
    const fields = batch
      .map(
        (entry, index) =>
          `c${index}:node(id:${JSON.stringify(entry.check.id)}) { ... on CheckRun { isRequired(pullRequestNumber:${entry.pr}) } ... on StatusContext { isRequired(pullRequestNumber:${entry.pr}) } }`
      )
      .join(' ');
    const result = z
      .object({ data: z.record(z.object({ isRequired: z.boolean() }).nullable()) })
      .parse(await read(['api', 'graphql', '-f', `query=query { ${fields} }`], signal));
    for (const [index, entry] of batch.entries()) {
      const value = result.data[`c${index}`];
      if (value) requirements.set(`${entry.pr}/${entry.check.id}`, value.isRequired);
    }
  }
  return pulls.map((pr) => ({
    ...pr,
    checkRuns: pr.checkRuns?.map((check) => ({
      ...check,
      requirement: requirements.has(`${pr.number}/${check.id}`)
        ? requirements.get(`${pr.number}/${check.id}`)
          ? ('required' as const)
          : ('optional' as const)
        : ('unknown' as const),
    })),
  }));
}
