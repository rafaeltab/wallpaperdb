import { z } from 'zod';
import { command } from '../../platform/index.js';
import { type JoinBoundary, containsRequired, boundaryStillValid } from './join-boundary.js';
import { landedPrerequisite } from './landed-prerequisite.js';
type Gh = (args: string[], signal?: AbortSignal) => Promise<unknown>;
type Candidate = { base: string; prBase: string };
export async function refreshBoundary(
  project: string,
  pin: string,
  previous: JoinBoundary | undefined,
  numbers: readonly number[],
  candidates: readonly Candidate[],
  gh: Gh,
  signal?: AbortSignal
): Promise<JoinBoundary | null> {
  if (previous && previous.pin !== pin) return null;
  const landed = await closedFacts(project, previous, numbers, gh, signal);
  if (!landed) return null;
  const boundary = { base: pin, prBase: 'main', pin, landed };
  const prior = previous ? await currentCandidate(project, previous.prBase, signal) : null;
  const choices = [
    ...landed.map((fact) => ({ base: fact.tip, prBase: fact.branch })),
    ...candidates,
    ...(prior ? [prior] : []),
  ];
  return selectBoundary(project, pin, boundary, choices, gh, signal);
}
async function selectBoundary(
  project: string,
  pin: string,
  boundary: JoinBoundary,
  choices: readonly Candidate[],
  gh: Gh,
  signal?: AbortSignal
) {
  for (const candidate of choices) {
    if (!(await containsRequired(project, candidate.base, boundary, signal))) continue;
    const selected = { ...boundary, ...candidate };
    if (await boundaryStillValid(project, pin, selected, gh, signal)) return selected;
  }
  return null;
}
async function closedFacts(
  project: string,
  previous: JoinBoundary | undefined,
  numbers: readonly number[],
  gh: Gh,
  signal?: AbortSignal
) {
  const facts: JoinBoundary['landed'] = [];
  const issues = [
    ...new Set([
      ...numbers.filter((number) => number > 0),
      ...(previous?.landed.map((fact) => fact.issue) ?? []),
    ]),
  ];
  for (const issue of issues) {
    const fact = await closedFact(
      project,
      issue,
      previous?.landed.find((value) => value.issue === issue),
      gh,
      signal
    );
    if (fact === false) return null;
    if (fact) facts.push(fact);
  }
  return facts;
}
async function closedFact(
  project: string,
  issue: number,
  old: JoinBoundary['landed'][number] | undefined,
  gh: Gh,
  signal?: AbortSignal
) {
  const state = z
    .object({ state: z.enum(['OPEN', 'CLOSED']) })
    .parse(
      await gh(
        ['issue', 'view', String(issue), '--repo', 'rafaeltab/wallpaperdb', '--json', 'state'],
        signal
      )
    );
  if (state.state === 'OPEN') return old ? false : undefined;
  const fact = await landedPrerequisite(project, issue, gh, signal);
  if (!fact || !sameFact(old, fact)) return false;
  return fact;
}

function sameFact(
  old: JoinBoundary['landed'][number] | undefined,
  current: JoinBoundary['landed'][number]
) {
  if (!old) return true;
  return (
    old.pr === current.pr &&
    old.commit === current.commit &&
    old.originalHead === current.originalHead
  );
}
async function currentCandidate(project: string, branch: string, signal?: AbortSignal) {
  const text = await command(
    'git',
    ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
    project,
    signal
  );
  const base = text.trim().split(/\s/)[0];
  if (!base) return null;
  await command(
    'git',
    ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', base],
    project,
    signal
  );
  return { base, prBase: branch };
}

export function retainedBoundary(
  boundaries: readonly JoinBoundary[]
): JoinBoundary | null | undefined {
  const first = boundaries[0];
  if (!first) return undefined;
  const landed: JoinBoundary['landed'] = [];
  for (const boundary of boundaries) {
    if (boundary.pin !== first.pin || !mergeFacts(landed, boundary.landed)) return null;
  }
  return { ...first, landed };
}
function mergeFacts(into: JoinBoundary['landed'], facts: JoinBoundary['landed']) {
  for (const fact of facts) {
    const existing = into.find((value) => value.issue === fact.issue);
    if (!sameFact(existing, fact)) return false;
    if (!existing) into.push(fact);
  }
  return true;
}
