import { z } from 'zod';
import { passingChecks, normalizeChecks } from './checks.js';
import { command } from '../../platform/index.js';
export interface VerifiedPrerequisite {
  readonly issue: number;
  readonly pr: number;
  readonly commit: string;
}
const issue = z.object({
  number: z.number(),
  state: z.enum(['OPEN', 'CLOSED']),
  body: z.string(),
  comments: z
    .array(z.object({ author: z.object({ login: z.string() }).nullable(), body: z.string() }))
    .optional(),
});
const pr = z.object({
  url: z.string(),
  headRefOid: z.string(),
  headRefName: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  mergeable: z.string(),
  statusCheckRollup: z.array(
    z.union([
      z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
      z.object({ context: z.string(), state: z.string() }),
    ])
  ),
});
/** Acceptance and independent review are asserted by the owning completed job or
 * operator configuration. Revalidate their exact PR, CI and linear ancestry here. */
export async function prerequisiteReadiness(
  config: { project: string; base: string; prerequisites: readonly VerifiedPrerequisite[] },
  numbers: readonly number[],
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
) {
  if (numbers.length > 100) return { blockersReady: false };
  const verified = [];
  for (const number of numbers) {
    const observed = issue.parse(
      await gh(
        [
          'issue',
          'view',
          String(number),
          '--repo',
          'rafaeltab/wallpaperdb',
          '--json',
          'number,state,author,url,body,labels,comments',
        ],
        signal
      )
    );
    if (observed.number !== number) throw new Error('Mismatched prerequisite');
    if (observed.state === 'CLOSED') continue;
    const assertion = config.prerequisites.find((item) => item.issue === number);
    if (!assertion) return { blockersReady: false };
    const current = pr.parse(
      await gh(
        [
          'pr',
          'view',
          String(assertion.pr),
          '--repo',
          'rafaeltab/wallpaperdb',
          '--json',
          'url,headRefOid,headRefName,state,mergeable,statusCheckRollup',
        ],
        signal
      )
    );
    const evidence = issueEvidence(observed);
    if (!valid(assertion, current, evidence)) return { blockersReady: false };
    verified.push({ ...assertion, branch: current.headRefName, url: current.url });
  }
  return selectBase(config, verified, signal);
}
async function selectBase(
  config: { project: string; base: string },
  verified: readonly (VerifiedPrerequisite & { branch: string; url: string })[],
  signal?: AbortSignal
) {
  // No merge or replay is authorized in this slice. A single existing tip must
  // contain the configured baseline and every prerequisite commit.
  for (const candidate of verified) {
    let contains = true;
    for (const commit of [config.base, ...verified.map((item) => item.commit)])
      if (!(await ancestor(config.project, commit, candidate.commit, signal))) contains = false;
    if (contains)
      return {
        blockersReady: true,
        prerequisite: {
          base: candidate.commit,
          prBase: candidate.branch,
          evidence: JSON.stringify(verified),
        },
      };
  }
  // A configured stack base may already contain all the prerequisites.
  for (const item of verified)
    if (!(await ancestor(config.project, item.commit, config.base, signal)))
      return { blockersReady: false };
  return { blockersReady: true };
}
function valid(assertion: VerifiedPrerequisite, current: z.infer<typeof pr>, body: string) {
  const checks = normalizeChecks(current.statusCheckRollup);
  return (
    /^[a-f0-9]{40}$/.test(assertion.commit) &&
    current.headRefOid === assertion.commit &&
    current.state !== 'CLOSED' &&
    current.mergeable === 'MERGEABLE' &&
    current.url === `https://github.com/rafaeltab/wallpaperdb/pull/${assertion.pr}` &&
    /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(current.headRefName) &&
    recordedEvidence(body, current.url, assertion.commit) &&
    passingChecks(checks)
  );
}
async function ancestor(project: string, parent: string, child: string, signal?: AbortSignal) {
  try {
    await command('git', ['merge-base', '--is-ancestor', parent, child], project, signal);
    return true;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 1) return false;
    throw cause;
  }
}

function recordedEvidence(body: string, url: string, commit: string) {
  return body.includes(url) && body.includes(commit);
}
function issueEvidence(observed: z.infer<typeof issue>) {
  return [
    observed.body,
    ...(observed.comments ?? []).filter(trustedComment).map((comment) => comment.body),
  ].join('\n');
}
function trustedComment(comment: { author: { login: string } | null }) {
  return comment.author && ['rafaeltab', 'zero-two-rafaeltab'].includes(comment.author.login);
}
