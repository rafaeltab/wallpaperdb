import { z } from 'zod';
import { passingChecks, normalizeChecks } from './checks.js';
import { ancestor } from './ancestry.js';
import { landedPrerequisite, type LandedPrerequisite } from './landed-prerequisite.js';
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
  config: {
    project: string;
    base: string;
    prBase?: string;
    prerequisites: readonly VerifiedPrerequisite[];
  },
  numbers: readonly number[],
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
) {
  if (numbers.length > 100) return { blockersReady: false };
  const verified = [];
  const landed: LandedPrerequisite[] = [];
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
    if (observed.state === 'CLOSED') {
      const delivery = await landedPrerequisite(config.project, number, gh, signal);
      if (!delivery) return { blockersReady: false };
      landed.push(delivery);
      continue;
    }
    const accepted = await openPrerequisite(config, number, issueEvidence(observed), gh, signal);
    if (!accepted) return { blockersReady: false };
    verified.push(accepted);
  }
  return selectBase(config, verified, landed, signal);
}
async function openPrerequisite(
  config: { prerequisites: readonly VerifiedPrerequisite[] },
  number: number,
  evidence: string,
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
) {
  const assertion = config.prerequisites.find((item) => item.issue === number);
  if (!assertion) return null;
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
  if (!valid(assertion, current, evidence)) return null;
  return { ...assertion, branch: current.headRefName, url: current.url };
}
async function selectBase(
  config: { project: string; base: string; prBase?: string },
  verified: readonly (VerifiedPrerequisite & { branch: string; url: string })[],
  landed: readonly LandedPrerequisite[],
  signal?: AbortSignal
) {
  // No merge or replay is authorized in this slice. A single existing tip must
  // contain the configured baseline and every prerequisite commit.
  const required = [...verified, ...landed];
  const candidates = [...verified, ...landed.map((item) => ({ ...item, commit: item.tip }))];
  for (const candidate of candidates) {
    let contains = true;
    for (const commit of [config.base, ...required.map((item) => item.commit)])
      if (!(await ancestor(config.project, commit, candidate.commit, signal))) contains = false;
    if (contains)
      return {
        blockersReady: true,
        prerequisite: {
          base: candidate.commit,
          prBase: candidate.branch,
          evidence: JSON.stringify(required),
        },
      };
  }
  // A configured stack base may already contain all the prerequisites.
  for (const item of required)
    if (!(await ancestor(config.project, item.commit, config.base, signal)))
      return { blockersReady: false };
  return configuredReadiness(config, required);
}
function configuredReadiness(
  config: { base: string; prBase?: string },
  required: readonly { issue: number; commit: string }[]
) {
  return required.length
    ? {
        blockersReady: true,
        prerequisite: {
          base: config.base,
          prBase: config.prBase ?? 'main',
          evidence: JSON.stringify(required),
        },
      }
    : { blockersReady: true };
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
