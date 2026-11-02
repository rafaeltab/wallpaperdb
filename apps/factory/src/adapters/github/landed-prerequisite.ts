import { z } from 'zod';
import { command } from '../../platform/index.js';
import { ancestor } from './ancestry.js';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const snapshot = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: z.literal('rafaeltab/wallpaperdb'),
      defaultBranchRef: z.object({
        name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/),
        target: z.object({ oid: sha }),
      }),
      issue: z.object({
        number: z.number().int().positive(),
        state: z.enum(['OPEN', 'CLOSED']),
        closedByPullRequestsReferences: z.object({
          nodes: z
            .array(z.object({ number: z.number().int().positive(), url: z.string() }))
            .max(100),
          pageInfo: z.object({ hasNextPage: z.boolean() }),
        }),
      }),
    }),
  }),
});
const merged = z.object({
  merged: z.boolean(),
  merge_commit_sha: sha.nullable(),
  html_url: z.string(),
  base: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }) }),
});
export interface LandedPrerequisite {
  readonly issue: number;
  readonly pr: number;
  readonly commit: string;
  readonly url: string;
  readonly branch: string;
  readonly tip: string;
}
/** Closure alone is not delivery. Bind a unique closing PR's merge result to
 * the authenticated current default tip, then acquire only its Git objects. */
export async function landedPrerequisite(
  project: string,
  number: number,
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
): Promise<LandedPrerequisite | null> {
  const repository = snapshot.parse(
    await gh(
      [
        'api',
        'graphql',
        '-f',
        `query=query { repository(owner:"rafaeltab",name:"wallpaperdb") { nameWithOwner defaultBranchRef { name target { ... on Commit { oid } } } issue(number:${number}) { number state closedByPullRequestsReferences(first:100) { nodes { number url } pageInfo { hasNextPage } } } } }`,
      ],
      signal
    )
  ).data.repository;
  const issue = repository.issue;
  if (issue.number !== number) throw new Error('Mismatched landed prerequisite');
  if (issue.state !== 'CLOSED' || issue.closedByPullRequestsReferences.pageInfo.hasNextPage)
    return null;
  const target = repository.defaultBranchRef;
  const landing = await closingPullRequest(
    issue.closedByPullRequestsReferences.nodes,
    target.name,
    gh,
    signal
  );
  if (!landing) return null;
  // Explicit object fetch avoids FETCH_HEAD, tracking ref and working branch
  // races with other admissions. No checkout, reset or operator pin is changed.
  await command(
    'git',
    ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', target.target.oid],
    project,
    signal
  );
  if (!(await ancestor(project, landing.commit, target.target.oid, signal))) return null;
  return {
    issue: number,
    pr: landing.pr,
    commit: landing.commit,
    url: `https://github.com/rafaeltab/wallpaperdb/pull/${landing.pr}`,
    branch: target.name,
    tip: target.target.oid,
  };
}
function landedAssociation(pr: z.infer<typeof merged>, url: string, branch: string) {
  return (
    pr.merged &&
    pr.html_url === url &&
    pr.base.repo.full_name === 'rafaeltab/wallpaperdb' &&
    pr.base.ref === branch
  );
}

async function closingPullRequest(
  references: readonly { number: number; url: string }[],
  branch: string,
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
) {
  const delivered: { pr: number; commit: string }[] = [];
  for (const reference of references) {
    const url = `https://github.com/rafaeltab/wallpaperdb/pull/${reference.number}`;
    if (reference.url !== url) throw new Error('Mismatched closing PR');
    const pr = merged.parse(
      await gh(['api', `repos/rafaeltab/wallpaperdb/pulls/${reference.number}`], signal)
    );
    if (pr.merge_commit_sha && landedAssociation(pr, url, branch))
      delivered.push({ pr: reference.number, commit: pr.merge_commit_sha });
  }
  return delivered.length === 1 ? delivered[0] : null;
}
