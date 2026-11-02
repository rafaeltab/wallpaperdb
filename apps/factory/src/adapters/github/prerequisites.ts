import { z } from 'zod';
import { passingChecks, normalizeChecks } from './checks.js';
import { ancestor } from './ancestry.js';
import { containsRequired, type JoinBoundary } from './join-boundary.js';
import { landedPrerequisite, type LandedPrerequisite } from './landed-prerequisite.js';
export interface VerifiedPrerequisite {
  readonly issue: number;
  readonly pr: number;
  readonly commit: string;
  readonly reviewedCommit?: string;
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
  baseRefName: z.string().optional(),
  baseRefOid: z.string().optional(),
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
interface Readiness {
  blockersReady: boolean;
  prerequisite?: { base: string; prBase: string; evidence: string };
  joinRequired?: boolean;
  joinBoundary?: JoinBoundary;
  blockedReason?: string;
  join?: readonly (VerifiedPrerequisite & {
    branch: string;
    url: string;
    parent?: string;
    prBase?: string;
  })[];
}
export async function prerequisiteReadiness(
  config: {
    project: string;
    base: string;
    prBase?: string;
    prerequisites: readonly VerifiedPrerequisite[];
  },
  numbers: readonly number[],
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
  candidate?: { readonly base: string; readonly prBase?: string }
): Promise<Readiness> {
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
  const readiness = await selectBase(config, verified, landed, signal);
  return candidateReadiness(config, readiness, [...verified, ...landed], candidate, signal);
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
        'url,headRefOid,headRefName,baseRefName,baseRefOid,state,mergeable,statusCheckRollup',
      ],
      signal
    )
  );
  if (!valid(assertion, current, evidence)) return null;
  return {
    ...assertion,
    branch: current.headRefName,
    url: current.url,
    parent: current.baseRefOid,
    prBase: current.baseRefName,
  };
}
async function selectBase(
  config: { project: string; base: string; prBase?: string },
  verified: readonly (VerifiedPrerequisite & {
    branch: string;
    url: string;
    parent?: string;
    prBase?: string;
  })[],
  landed: readonly LandedPrerequisite[],
  signal?: AbortSignal
) {
  // Prefer a containing tip. A divergent join must retain the exact operator
  // pin and verified landing facts separately from replayable open PR layers.
  const required = [...verified, ...landed];
  const candidates = [...verified, ...landed.map((item) => ({ ...item, commit: item.tip }))];
  for (const candidate of candidates) {
    if (await containsAll(config, [{ commit: config.base }, ...required], candidate.commit, signal))
      return {
        blockersReady: true,
        prerequisite: {
          base: candidate.commit,
          prBase: candidate.branch,
          evidence: JSON.stringify(required),
        },
      };
  }
  if (await containsAll(config, required, config.base, signal))
    return configuredReadiness(config, required);
  return joinReadiness(config, verified, landed, signal);
}
async function joinReadiness(
  config: { project: string; base: string; prBase?: string },
  verified: NonNullable<Readiness['join']>,
  landed: readonly LandedPrerequisite[],
  signal?: AbortSignal
) {
  const boundary: JoinBoundary = {
    base: config.base,
    prBase: config.prBase ?? 'main',
    pin: config.base,
    landed: [...landed],
  };
  for (const candidate of [
    ...landed.map((item) => ({ commit: item.tip, branch: item.branch })),
    ...verified,
  ]) {
    if (!(await containsRequired(config.project, candidate.commit, boundary, signal))) continue;
    // Default/pin are fallback replay boundaries. Existing containing open
    // anchors remain eligible without forcing unrelated default advancement.
    if (landed.some((item) => item.tip === candidate.commit)) {
      boundary.base = candidate.commit;
      boundary.prBase = candidate.branch;
    }
    return { blockersReady: false, joinRequired: true, join: verified, joinBoundary: boundary };
  }
  if (await containsRequired(config.project, config.base, boundary, signal))
    return { blockersReady: false, joinRequired: true, join: verified, joinBoundary: boundary };
  return {
    blockersReady: false,
    blockedReason: 'No verified join boundary contains the operator pin and landed prerequisites',
  };
}
async function containsAll(
  config: { project: string },
  required: readonly { commit: string }[],
  head: string,
  signal?: AbortSignal
) {
  for (const item of required)
    if (!(await ancestor(config.project, item.commit, head, signal))) return false;
  return true;
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
    evidenceReady(body, current.url, assertion.commit, checks)
  );
}
function evidenceReady(
  body: string,
  url: string,
  commit: string,
  checks: ReturnType<typeof normalizeChecks>
) {
  return recordedEvidence(body, url, commit) && passingChecks(checks);
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

async function candidateReadiness(
  config: { project: string; base: string },
  readiness: Readiness,
  required: readonly { commit: string }[],
  candidate: { base: string; prBase?: string } | undefined,
  signal?: AbortSignal
) {
  if (!candidate || !readiness.blockersReady || !readiness.prerequisite) return readiness;
  if (!(await validCandidate(config, required, readiness.prerequisite, candidate, signal)))
    return { ...readiness, blockersReady: false, prerequisite: undefined };
  return { ...readiness, prerequisite: { ...readiness.prerequisite, base: candidate.base } };
}
async function validCandidate(
  config: { project: string; base: string },
  required: readonly { commit: string }[],
  current: { base: string; prBase: string },
  candidate: { base: string; prBase?: string },
  signal?: AbortSignal
) {
  if (!/^[a-f0-9]{40}$/.test(candidate.base)) return false;
  if (candidate.prBase !== undefined && candidate.prBase !== current.prBase) return false;
  if (!(await ancestor(config.project, config.base, candidate.base, signal))) return false;
  for (const item of required)
    if (!(await ancestor(config.project, item.commit, candidate.base, signal))) return false;
  // Only retain a comparison on the currently certified lineage. A changed or
  // divergent proof is not permission to rebase or rewrite the reservation.
  return ancestor(config.project, candidate.base, current.base, signal);
}
