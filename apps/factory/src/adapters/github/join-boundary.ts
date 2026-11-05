import { z } from 'zod';
import { command } from '../../platform/index.js';
import { ancestor } from './ancestry.js';
import { landedPrerequisite } from './landed-prerequisite.js';
import { joinBoundarySchema as joinBoundary } from '../../platform/index.js';
export { joinBoundary };
export type JoinBoundary = z.infer<typeof joinBoundary>;
type Gh = (args: string[], signal?: AbortSignal) => Promise<unknown>;
export const requiredCommits = (boundary: JoinBoundary) => [
  boundary.pin,
  ...boundary.landed.map((item) => item.commit),
];
export async function containsRequired(
  project: string,
  head: string,
  boundary: JoinBoundary,
  signal?: AbortSignal
) {
  for (const commit of requiredCommits(boundary))
    if (!(await ancestor(project, commit, head, signal))) return false;
  return true;
}
export async function boundaryFactsValid(
  project: string,
  pin: string,
  boundary: JoinBoundary,
  gh: Gh,
  signal?: AbortSignal
) {
  if (boundary.pin !== pin || !(await containsRequired(project, boundary.base, boundary, signal)))
    return false;
  if (!(await landingFactsValid(project, boundary, gh, signal))) return false;
  return true;
}
export async function boundaryStillValid(
  project: string,
  pin: string,
  boundary: JoinBoundary,
  gh: Gh,
  signal?: AbortSignal
) {
  if (!(await boundaryFactsValid(project, pin, boundary, gh, signal))) return false;
  const text = await command(
    'git',
    ['ls-remote', '--heads', 'origin', `refs/heads/${boundary.prBase}`],
    project,
    signal
  );
  const current = text.trim().split(/\s/)[0];
  if (!current) return false;
  return ancestor(project, boundary.base, current, signal);
}
/** Old closed-PR parents identify an issue-only suffix; only its verified merge
 * result supplies the prerequisite code in the new tree. The operator pin is
 * always an exact ancestry requirement, never replaced by this correspondence. */
export async function landedParentCovered(
  project: string,
  parent: string,
  heads: readonly string[],
  boundary: JoinBoundary,
  signal?: AbortSignal
) {
  for (const fact of boundary.landed) {
    if (!fact.originalHead || !(await ancestor(project, parent, fact.originalHead, signal)))
      continue;
    for (const head of heads) if (await ancestor(project, fact.commit, head, signal)) return true;
  }
  return false;
}

/** Capture the issue suffix without replaying an authenticated closed prefix.
 * The caller retains the original PR comparison in its immutable layer seed. */
export async function openReplayParent(
  project: string,
  comparison: string,
  head: string,
  boundary: JoinBoundary,
  signal?: AbortSignal
) {
  let parent = (await command('git', ['merge-base', comparison, head], project, signal)).trim();
  for (const fact of boundary.landed) {
    if (!fact.originalHead) continue;
    if (!(await ancestor(project, parent, fact.originalHead, signal))) continue;
    if (await ancestor(project, fact.originalHead, head, signal)) parent = fact.originalHead;
  }
  return parent;
}

/** Legacy landing observations may prove code inclusion without an old PR head.
 * Such observations cannot authorize replay of a branch predating the landing. */
export async function closedParentsKnown(
  project: string,
  heads: readonly string[],
  boundary: JoinBoundary,
  signal?: AbortSignal
) {
  for (const fact of boundary.landed) {
    if (fact.originalHead) continue;
    for (const head of heads)
      if (!(await ancestor(project, fact.commit, head, signal))) return false;
  }
  return true;
}

async function landingFactsValid(
  project: string,
  boundary: JoinBoundary,
  gh: Gh,
  signal?: AbortSignal
) {
  for (const fact of boundary.landed) {
    const current = await landedPrerequisite(project, fact.issue, gh, signal);
    if (!sameLanding(current, fact)) return false;
  }
  return true;
}
function sameLanding(
  current: JoinBoundary['landed'][number] | null,
  expected: JoinBoundary['landed'][number]
) {
  return (
    !!current &&
    current.pr === expected.pr &&
    current.commit === expected.commit &&
    current.originalHead === expected.originalHead
  );
}
