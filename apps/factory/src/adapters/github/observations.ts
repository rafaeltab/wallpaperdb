import { Effect } from 'effect';
import { z } from 'zod';
import type {
  ObservationSource,
  IssueObservation,
  PullObservation,
} from '../../capabilities/observe/index.js';
import { Unavailable } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
import { blockerNumbers } from './implementation.js';
const number = z.number().int().positive();
const page = z.object({ hasNextPage: z.literal(false) });
const connection = <T extends z.ZodTypeAny>(node: T) =>
  z.object({ nodes: z.array(node), pageInfo: page });
const ref = z.object({ number, url: z.string().url() });
const pull = ref.extend({
  __typename: z.literal('PullRequest'),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  headRefOid: z.string().regex(/^[a-f0-9]{40}$/),
  headRefName: z.string(),
  baseRefOid: z.string().regex(/^[a-f0-9]{40}$/),
  baseRefName: z.string(),
  reviews: connection(
    z.object({ state: z.string(), commit: z.object({ oid: z.string() }).nullable() })
  ),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  closingIssuesReferences: connection(ref),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          oid: z.string(),
          statusCheckRollup: z.object({ state: z.string() }).nullable(),
        }),
      })
    ),
  }),
});
const schema = z.object({
  data: z.object({
    repository: z.object({
      issue: z.object({
        number,
        url: z.string().url(),
        title: z.string(),
        body: z.string(),
        state: z.enum(['OPEN', 'CLOSED']),
        parent: ref.nullable(),
        author: z.object({ login: z.string() }),
        labels: connection(z.object({ name: z.string() })),
        assignees: connection(z.object({ login: z.string() })),
        comments: z.object({ totalCount: z.number().int().nonnegative() }),
        projectItems: connection(
          z.object({
            project: z.object({
              title: z.string(),
              number: z.number(),
              owner: z.object({ login: z.string() }),
            }),
            priority: z.object({ name: z.string() }).nullable(),
            size: z.object({ name: z.string() }).nullable(),
            fieldValueByName: z.object({ name: z.string() }).nullable(),
          })
        ),
        closedByPullRequestsReferences: connection(pull),
        timelineItems: connection(
          z.object({ source: z.union([pull, z.object({ __typename: z.literal('Issue') })]) })
        ),
      }),
    }),
  }),
});
const pullFields = `__typename number url state headRefOid headRefName baseRefOid baseRefName reviewDecision reviews(first:100) { nodes { state commit { oid } } pageInfo { hasNextPage } } closingIssuesReferences(first:100) { nodes { number url } pageInfo { hasNextPage } } commits(last:1) { nodes { commit { oid statusCheckRollup { state } } } }`;
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
      `query=query { repository(owner:"rafaeltab",name:"wallpaperdb") { issue(number:${n}) { number url title body state author { login } parent { number url } labels(first:100) { nodes { name } pageInfo { hasNextPage } } assignees(first:100) { nodes { login } pageInfo { hasNextPage } } comments { totalCount } projectItems(first:100) { nodes { project { title number owner { ... on User { login } ... on Organization { login } } } priority:fieldValueByName(name:"Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } } size:fieldValueByName(name:"Size") { ... on ProjectV2ItemFieldSingleSelectValue { name } } fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } pageInfo { hasNextPage } } closedByPullRequestsReferences(first:100,includeClosedPrs:true) { nodes { ${pullFields} } pageInfo { hasNextPage } } timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT]) { nodes { ... on CrossReferencedEvent { source { ... on PullRequest { ${pullFields} } ... on Issue { __typename } } } } pageInfo { hasNextPage } } } } }`,
    ]),
    gh([
      'api',
      `repos/rafaeltab/wallpaperdb/issues/${n}/dependencies/blocked_by`,
      '--paginate',
      '--slurp',
    ]),
  ]);
  const issue = schema.parse(raw).data.repository.issue;
  if (issue.number !== n || issue.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${n}`)
    throw new Error('Mismatched observation');
  if (
    issue.parent &&
    issue.parent.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${issue.parent.number}`
  )
    throw new Error('Unsupported foreign parent');
  const native = z
    .array(z.array(z.object({ number, html_url: z.string().url() })))
    .parse(deps)
    .flat();
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
  const linked = new Map<number, PullObservation>();
  for (const pr of issue.closedByPullRequestsReferences.nodes) {
    if (pr.url !== `https://github.com/rafaeltab/wallpaperdb/pull/${pr.number}`)
      throw new Error('Unsupported foreign linked PR');
    const value = translatePull(pr);
    linked.set(pr.number, { ...value, linkedIssues: [...new Set([...value.linkedIssues, n])] });
  }
  for (const { source: pr } of issue.timelineItems.nodes) {
    if (
      pr.__typename !== 'PullRequest' ||
      pr.url !== `https://github.com/rafaeltab/wallpaperdb/pull/${pr.number}`
    )
      continue;
    const previous = linked.get(pr.number);
    linked.set(pr.number, { ...(previous ?? translatePull(pr)), crossReferencedIssues: [n] });
  }
  const prs = [...linked.values()];
  const projectItem = issue.projectItems.nodes.find(
    (p) => p.project.number === 7 && p.project.owner.login === 'rafaeltab'
  );
  const metadata: IssueObservation = {
    number: n,
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
    pullRequests: [...new Set(prs.map((p) => p.number))],
  };
  return { metadata, pullRequests: prs };
}
export function githubObservations(
  project: string,
  admitted: () => Effect.Effect<readonly number[], Unavailable>
): ObservationSource {
  return {
    read: () =>
      Effect.gen(function* () {
        const retained = yield* admitted();
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const candidates = z
              .array(z.object({ number }))
              .parse(
                JSON.parse(
                  await command(
                    'gh',
                    [
                      'issue',
                      'list',
                      '--repo',
                      'rafaeltab/wallpaperdb',
                      '--state',
                      'open',
                      '--label',
                      'ready-for-agent',
                      '--limit',
                      '1000',
                      '--json',
                      'number',
                    ],
                    project,
                    signal
                  )
                )
              );
            if (candidates.length >= 1000) throw new Error('Discovery exceeds supported bound');
            const pages = z
              .array(
                z.object({
                  data: z.object({
                    repository: z.object({
                      pullRequests: z.object({
                        nodes: z.array(pull),
                        pageInfo: z.object({
                          hasNextPage: z.boolean(),
                          endCursor: z.string().nullable(),
                        }),
                      }),
                    }),
                  }),
                })
              )
              .parse(
                JSON.parse(
                  await command(
                    'gh',
                    [
                      'api',
                      'graphql',
                      '--paginate',
                      '--slurp',
                      '-f',
                      `query=query($endCursor:String) { repository(owner:"rafaeltab",name:"wallpaperdb") { pullRequests(first:100,states:OPEN,after:$endCursor) { nodes { ${pullFields} } pageInfo { hasNextPage endCursor } } } }`,
                    ],
                    project,
                    signal
                  )
                )
              );
            if (
              !pages.length ||
              pages.at(-1)?.data.repository.pullRequests.pageInfo.hasNextPage ||
              pages.some(
                (p, index) =>
                  index < pages.length - 1 &&
                  (!p.data.repository.pullRequests.pageInfo.hasNextPage ||
                    !p.data.repository.pullRequests.pageInfo.endCursor)
              )
            )
              throw new Error('Incomplete open PR index');
            const queue = [...new Set([...candidates.map((i) => i.number), ...retained])];
            const seen = new Set<number>();
            const issues: IssueObservation[] = [];
            const pulls = new Map<number, PullObservation>();
            for (const pr of pages.flatMap((p) => p.data.repository.pullRequests.nodes)) {
              if (
                pr.url !== `https://github.com/rafaeltab/wallpaperdb/pull/${pr.number}` ||
                pr.state !== 'OPEN'
              )
                throw new Error('Mismatched open PR');
              pulls.set(pr.number, translatePull(pr));
            }
            while (queue.length) {
              const batch = [...new Set(queue.splice(0, 4))].filter((n) => !seen.has(n));
              for (const n of batch) seen.add(n);
              if (seen.size > 1000) throw new Error('Context exceeds supported bound');
              const values = await Promise.all(
                batch.map((n) =>
                  observeIssue(
                    project,
                    n,
                    candidates.some((i) => i.number === n),
                    signal
                  )
                )
              );
              for (const value of values) {
                issues.push(value.metadata);
                for (const pr of value.pullRequests) {
                  const previous = pulls.get(pr.number);
                  pulls.set(pr.number, {
                    ...pr,
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
            return { issues, pullRequests: [...pulls.values()] };
          },
          catch: (cause) => new Unavailable({ operation: 'github-observations', cause }),
        }).pipe(Effect.tapError(Effect.logError), Effect.withSpan('factory.github.observations'));
      }),
  };
}

function translatePull(pr: z.infer<typeof pull>): PullObservation {
  const commit = pr.commits.nodes[0]?.commit;
  const ci = commit?.oid === pr.headRefOid ? commit.statusCheckRollup?.state : undefined;
  return {
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
