import { createHash } from 'node:crypto';
import { mkdir, open, readFile, link, unlink, mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { command } from '../../platform/index.js';
import { normalizeChecks, passingChecks } from './checks.js';
import { landedPrerequisite } from './landed-prerequisite.js';
import {
  joinBoundary,
  type JoinBoundary,
  containsRequired,
  boundaryStillValid,
  boundaryFactsValid,
  landedParentCovered,
  openReplayParent,
  closedParentsKnown,
} from './join-boundary.js';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const layer = z.object({
  issue: z.number().int().positive(),
  pr: z.number().int().positive(),
  commit: sha,
  reviewedCommit: sha.optional(),
  branch: z.string(),
  url: z.string(),
  parent: sha,
  prBase: z.string(),
});
type Layer = z.infer<typeof layer>;
const group = z.object({
  number: z.number().int().positive(),
  pull_requests: z.array(z.object({ number: z.number().int().positive() })),
});
const intent = z.object({
  boundary: joinBoundary.optional(),
  groups: z.array(group),
  members: z.array(z.number().int().positive()),
  numbers: z.array(z.number().int().positive()).max(100),
  layers: z.array(layer),
  replay: z.array(layer.extend({ next: sha, onto: sha, target: z.string(), tree: sha })),
});
type Intent = z.infer<typeof intent>;
export interface JoinConfiguration {
  readonly directory: string;
  readonly binary: string;
  readonly projectId: string;
}
type Gh = (args: string[], signal?: AbortSignal) => Promise<unknown>;

const errno = (cause: unknown, expected: string) =>
  z.object({ code: z.literal(expected) }).safeParse(cause).success;
async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncNewParents(directory: string, stop: string) {
  let current = directory;
  while (current !== stop) {
    await syncDirectory(current);
    current = dirname(current);
  }
  await syncDirectory(stop);
}
async function writeDurable(path: string, value: unknown) {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function linkOnce(source: string, target: string) {
  return link(source, target)
    .then(() => true)
    .catch((cause) => {
      if (errno(cause, 'EEXIST')) return false;
      throw cause;
    });
}
/** Atomic immutable journal records precede every external publication. */
async function publish(directory: string, name: string, value: unknown) {
  const createdDirectory = await mkdir(directory, { recursive: true });
  if (createdDirectory) await syncNewParents(directory, dirname(createdDirectory));
  const temporary = await mkdtemp(join(directory, '.write-'));
  const path = join(temporary, 'value');
  await writeDurable(path, value);
  const created = await linkOnce(path, join(directory, name));
  await unlink(path);
  await rmdir(temporary);
  await syncDirectory(directory);
  return created;
}
async function read(directory: string, name: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(join(directory, name), 'utf8'));
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
    throw cause;
  }
}
const id = (numbers: readonly number[]) =>
  createHash('sha256')
    .update(JSON.stringify([...numbers].sort((a, b) => a - b)))
    .digest('hex');

export function prerequisiteJoin(project: string, base: string, config: JoinConfiguration, gh: Gh) {
  const git = (args: string[], signal?: AbortSignal) =>
    command('git', args, project, signal).then((text) => text.trim());
  const directory = (numbers: readonly number[]) => join(config.directory, id(numbers));
  const load = async (numbers: readonly number[]) => {
    const value = await read(directory(numbers), 'intent.json');
    return value === null ? null : intent.parse(value);
  };
  const remote = async (branch: string, signal?: AbortSignal) => {
    const value = await git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], signal);
    return value.split(/\s/)[0];
  };
  const containsPrerequisite = async (
    layers: readonly Layer[],
    head: string,
    signal?: AbortSignal
  ) => {
    for (const item of layers) if (await isAncestor(item.commit, head, signal)) return true;
    return false;
  };
  const affectedBranch = async (
    layers: readonly Layer[],
    branch: string | null,
    signal?: AbortSignal
  ) => {
    if (!branch) return false;
    if (layers.some((item) => item.branch === branch)) return true;
    const head = await git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], signal);
    return containsPrerequisite(layers, head, signal);
  };
  const writers = async (layers: readonly Layer[], signal?: AbortSignal) => {
    const listed = z
      .array(z.object({ threadId: z.string() }))
      .parse(
        JSON.parse(
          await command(
            config.binary,
            ['thread', 'list', config.projectId, '--json'],
            project,
            signal
          )
        )
      );
    for (const entry of listed) {
      const detail = z
        .object({
          thread: z.object({
            projectId: z.string(),
            branch: z.string().nullable(),
            status: z.string(),
            pendingRequestCount: z.number(),
          }),
        })
        .parse(
          JSON.parse(
            await command(
              config.binary,
              ['thread', 'show', entry.threadId, '--json'],
              project,
              signal
            )
          )
        ).thread;
      if (detail.projectId !== config.projectId) throw new Error('Mismatched writer project');
      if (!idleWriter(detail) && (await affectedBranch(layers, detail.branch, signal)))
        return false;
    }
    return await cleanWorktrees(layers, signal);
  };
  const cleanWorktrees = async (layers: readonly Layer[], signal?: AbortSignal) => {
    const worktrees = await git(['worktree', 'list', '--porcelain'], signal);
    for (const block of worktrees.split('\n\n')) {
      const head = block.match(/^HEAD ([a-f0-9]{40})$/m)?.[1];
      if (!head || !(await containsPrerequisite(layers, head, signal))) continue;
      const path = block.split('\n')[0]?.slice('worktree '.length);
      if (!path || (await command('git', ['status', '--porcelain'], path, signal)).trim())
        return false;
    }
    return true;
  };
  const released = async (key: string) =>
    !!(await read(join(config.directory, key), 'complete.json'));
  const ownerState = async (existing: unknown, key: string) => {
    const owner = z.object({ key: z.string() }).parse(existing).key;
    if (owner === key) return 'owned';
    return (await released(owner)) ? 'released' : 'busy';
  };
  const claimResource = async (key: string, resource: string) => {
    const claims = join(
      config.directory,
      'writers',
      createHash('sha256').update(resource).digest('hex')
    );
    for (let index = 0; ; index++) {
      const name = `writer-${index}.json`;
      const existing = await read(claims, name);
      if (existing) {
        const ownership = await ownerState(existing, key);
        if (ownership === 'released') continue;
        return ownership === 'owned';
      }
      await publish(claims, name, { key });
      const winner = z.object({ key: z.string() }).parse(await read(claims, name));
      return winner.key === key;
    }
  };
  const acquire = async (key: string, resources: readonly string[]) => {
    for (const resource of [...resources].sort())
      if (!(await claimResource(key, resource))) return false;
    return true;
  };
  const state = async (numbers: readonly number[]) => ({
    operation: await load(numbers),
    blocked: await read(directory(numbers), 'blocked.json'),
  });
  const attemptRebase = async (
    item: Layer,
    onto: string,
    parent: string,
    path: string,
    dir: string,
    signal?: AbortSignal
  ) => {
    try {
      await command('git', ['rebase', '--onto', onto, parent], path, signal);
    } catch (cause) {
      const conflicts = (
        await command('git', ['diff', '--name-only', '--diff-filter=U'], path, signal)
      ).trim();
      if (!conflicts) throw cause;
      await publish(dir, 'blocked.json', {
        kind: 'conflict',
        files: conflicts,
        issue: item.issue,
        oldHead: item.commit,
        oldParent: parent,
        onto,
        worktree: path,
      });
      return false;
    }
    return true;
  };
  const replayLayer = async (
    item: Layer,
    onto: string,
    target: string,
    dir: string,
    signal?: AbortSignal
  ) => {
    // The PR's old parent boundary is captured before any refs change.
    const parent = await git(['merge-base', item.parent, item.commit], signal);
    if (await git(['rev-list', '--merges', `${parent}..${item.commit}`], signal)) return;
    await mkdir(dir, { recursive: true });
    const path = await mkdtemp(join(dir, 'replay-'));
    await git(['worktree', 'add', '--detach', path, item.commit], signal);
    if (!(await attemptRebase(item, onto, parent, path, dir, signal))) return;
    const next = (await command('git', ['rev-parse', 'HEAD'], path, signal)).trim();
    if (!(await git(['diff', '--name-only', onto, next], signal))) {
      await publish(dir, 'blocked.json', {
        kind: 'empty-replay',
        issue: item.issue,
        oldHead: item.commit,
        oldParent: parent,
        onto,
        worktree: path,
      });
      return;
    }
    const tree = (await command('git', ['rev-parse', 'HEAD^{tree}'], path, signal)).trim();
    return { ...item, parent, next, onto, target, tree };
  };
  const coveredBy = async (commit: string, heads: readonly string[], signal?: AbortSignal) => {
    for (const head of heads) if (await isAncestor(commit, head, signal)) return true;
    return false;
  };
  const nextLayer = async (
    remaining: readonly Layer[],
    covered: readonly string[],
    boundary: JoinBoundary,
    signal?: AbortSignal
  ) => {
    for (const item of remaining) {
      if (await coveredBy(item.commit, covered, signal)) return { item, alreadyIncluded: true };
      if (
        (await coveredBy(item.parent, covered, signal)) ||
        (await landedParentCovered(project, item.parent, covered, boundary, signal))
      )
        return { item, alreadyIncluded: false };
    }
    return null;
  };
  const orderFrom = async (
    layers: readonly Layer[],
    covered: string[],
    boundary: JoinBoundary,
    signal?: AbortSignal
  ) => {
    const order: Layer[] = [];
    let remaining = [...layers];
    while (remaining.length) {
      const next = await nextLayer(remaining, covered, boundary, signal);
      if (!next) return null;
      remaining = remaining.filter((item) => item.issue !== next.item.issue);
      if (next.alreadyIncluded) continue;
      order.push(next.item);
      covered.push(next.item.commit);
    }
    return order;
  };
  const replayOrder = async (
    layers: readonly Layer[],
    boundary: JoinBoundary,
    signal?: AbortSignal
  ) => {
    const sources = await Promise.all(
      layers.map(async (item) => ({
        ...item,
        parent: await openReplayParent(project, item.parent, item.commit, boundary, signal),
      }))
    );
    for (const anchor of sources) {
      if (!(await containsRequired(project, anchor.commit, boundary, signal))) continue;
      const order = await orderFrom(sources, [anchor.commit], boundary, signal);
      if (order)
        return { order, boundary: { ...boundary, base: anchor.commit, prBase: anchor.branch } };
    }
    if (!(await containsRequired(project, boundary.base, boundary, signal))) return null;
    const order = await orderFrom(sources, [boundary.base], boundary, signal);
    return order ? { order, boundary } : null;
  };
  const combine = async (
    order: readonly Layer[],
    boundary: JoinBoundary,
    dir: string,
    signal?: AbortSignal
  ) => {
    let onto = boundary.base;
    let target = boundary.prBase;
    const replay: Intent['replay'] = [];
    for (const item of order) {
      const result = await replayLayer(item, onto, target, dir, signal);
      if (!result) return;
      replay.push(result);
      onto = result.next;
      target = item.branch;
    }
    return replay;
  };
  const invalidLayers = async (
    layers: readonly Layer[],
    boundary: JoinBoundary,
    signal?: AbortSignal
  ) => {
    for (const item of layers) {
      const common = boundary.landed.length
        ? await openReplayParent(project, item.parent, item.commit, boundary, signal)
        : await git(['merge-base', base, item.commit], signal);
      if (await git(['rev-list', '--merges', `${common}..${item.commit}`], signal))
        return 'nonlinear-prerequisite';
    }
    return undefined;
  };
  const memberFollows = async (
    previous: { head: string; branch: string; closed: boolean },
    node: { head: string; parent: string; closed: boolean },
    boundary: JoinBoundary,
    signal?: AbortSignal
  ) => {
    if (node.closed) return previous.closed && (await isAncestor(previous.head, node.head, signal));
    if (node.parent === previous.branch) return isAncestor(previous.head, node.head, signal);
    return (
      node.parent === boundary.prBase &&
      (await isAncestor(previous.head, boundary.base, signal)) &&
      (await isAncestor(boundary.base, node.head, signal))
    );
  };
  const orderedMembers = async (
    members: readonly number[],
    replay: Intent['replay'],
    boundary: JoinBoundary,
    dir: string,
    signal?: AbortSignal
  ) => {
    const nodes = await Promise.all(
      members.map(async (number) => {
        const current = z
          .object({ headRefName: z.string(), headRefOid: sha, baseRefName: z.string() })
          .parse(
            await gh(
              [
                'pr',
                'view',
                String(number),
                '--repo',
                'rafaeltab/wallpaperdb',
                '--json',
                'headRefName,headRefOid,baseRefName',
              ],
              signal
            )
          );
        const changed = replay.find((item) => item.pr === number);
        const closed = boundary.landed.find((item) => item.pr === number);
        const head = changed?.next ?? closed?.commit ?? current.headRefOid;
        return {
          number,
          closed: !!closed,
          branch: current.headRefName,
          head,
          parent: changed?.target ?? current.baseRefName,
          depth: Number(await git(['rev-list', '--count', head], signal)),
        };
      })
    );
    nodes.sort((first, second) => first.depth - second.depth || first.number - second.number);
    for (let index = 1; index < nodes.length; index++) {
      const previous = nodes[index - 1];
      const node = nodes[index];
      if (!previous || !node) throw new Error('Missing native join member');
      if (!(await memberFollows(previous, node, boundary, signal))) {
        await publish(dir, 'blocked.json', { kind: 'grouping-needs-dependent-replay', members });
        return null;
      }
    }
    return nodes.map((node) => node.number);
  };
  const prepareReplay = async (
    layers: readonly Layer[],
    boundary: JoinBoundary,
    dir: string,
    signal?: AbortSignal
  ) => {
    if (
      !(await closedParentsKnown(
        project,
        layers.map((item) => item.commit),
        boundary,
        signal
      ))
    ) {
      await publish(dir, 'blocked.json', { kind: 'unverifiable-closed-parent' });
      return;
    }
    const invalid = await invalidLayers(layers, boundary, signal);
    if (invalid) {
      await publish(dir, 'blocked.json', { kind: invalid });
      return;
    }
    if (!(await writers(layers, signal))) return;
    const plan = await replayOrder(layers, boundary, signal);
    if (!plan) {
      await publish(dir, 'blocked.json', { kind: 'missing-parent-boundary' });
      return;
    }
    const replay = await combine(plan.order, plan.boundary, dir, signal);
    if (!replay?.length) return;
    return { replay, boundary: plan.boundary };
  };
  const build = async (
    numbers: readonly number[],
    candidates: unknown,
    signal?: AbortSignal,
    requirements?: JoinBoundary
  ) => {
    const dir = directory(numbers);
    await publish(
      dir,
      'boundary.json',
      requirements ?? { base, prBase: 'main', pin: base, landed: [] }
    );
    const boundary = joinBoundary.parse(await read(dir, 'boundary.json'));
    await publish(dir, 'seed.json', candidates);
    const layers = z
      .array(layer)
      .min(1)
      .max(100)
      .parse(await read(dir, 'seed.json'));
    const prepared = await prepareReplay(layers, boundary, dir, signal);
    if (!prepared) return;
    const { replay, boundary: selectedBoundary } = prepared;
    const groups = await groupsFor(
      layers.map((item) => item.pr),
      signal
    );
    const replayed = new Set(replay.map((item) => item.pr));
    const members = [
      ...new Set([
        ...groups.flatMap((value) => value.pull_requests.map((item) => item.number)),
        ...layers.map((item) => item.pr),
      ]),
    ].filter((number) => !replayed.has(number));
    members.push(...replay.map((item) => item.pr));
    const ordered = await orderedMembers(members, replay, selectedBoundary, dir, signal);
    if (!ordered) return;
    await publish(dir, 'intent.json', {
      numbers,
      layers,
      replay,
      groups,
      members: ordered,
      boundary: selectedBoundary,
    });
    return await load(numbers);
  };
  const validate = async (item: Intent['replay'][number], dir: string, signal?: AbortSignal) => {
    const observed = z
      .object({
        headRefOid: sha,
        statusCheckRollup: z.array(
          z.union([
            z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
            z.object({ context: z.string(), state: z.string() }),
          ])
        ),
      })
      .parse(
        await gh(
          [
            'pr',
            'view',
            String(item.pr),
            '--repo',
            'rafaeltab/wallpaperdb',
            '--json',
            'headRefOid,statusCheckRollup',
          ],
          signal
        )
      );
    if (observed.headRefOid !== item.next) return false;
    if (!passingChecks(normalizeChecks(observed.statusCheckRollup))) return false;
    await publish(dir, `ci-${item.next}.json`, { commit: item.next, tree: item.tree });
    return true;
  };
  const verifyHeads = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    for (const item of operation.layers) {
      const changed = operation.replay.find((replay) => replay.pr === item.pr);
      const head = await remote(item.branch, signal);
      if (head !== item.commit && head !== changed?.next) {
        await publish(dir, 'blocked.json', {
          kind: 'head-conflict',
          issue: item.issue,
          expected: item.commit,
          actual: head,
        });
        return false;
      }
    }
    return true;
  };
  const prState = async (item: Intent['replay'][number], signal?: AbortSignal) => {
    return z
      .object({ headRefOid: sha, baseRefName: z.string(), state: z.string() })
      .parse(
        await gh(
          [
            'pr',
            'view',
            String(item.pr),
            '--repo',
            'rafaeltab/wallpaperdb',
            '--json',
            'headRefOid,baseRefName,state',
          ],
          signal
        )
      );
  };
  const publishLayer = async (item: Intent['replay'][number], signal?: AbortSignal) => {
    const before = await prState(item, signal);
    if (!allowedPublication(before, item)) return false;
    if ((await remote(item.branch, signal)) !== item.next) {
      await git(
        [
          'push',
          `--force-with-lease=refs/heads/${item.branch}:${item.commit}`,
          'origin',
          `${item.next}:refs/heads/${item.branch}`,
        ],
        signal
      );
    }
    if ((await remote(item.branch, signal)) !== item.next) return false;
    const current = await prState(item, signal);
    if (current.headRefOid !== item.next || !allowedPublication(current, item)) return false;
    if (current.baseRefName !== item.target)
      await gh(
        ['pr', 'edit', String(item.pr), '--repo', 'rafaeltab/wallpaperdb', '--base', item.target],
        signal
      );
    return true;
  };
  const groupsFor = async (numbers: readonly number[], signal?: AbortSignal) => {
    const result: z.infer<typeof group>[] = [];
    for (const number of numbers) {
      const values = z
        .array(group)
        .parse(
          await gh(['api', `repos/rafaeltab/wallpaperdb/stacks?pull_request=${number}`], signal)
        );
      for (const value of values)
        if (!result.some((known) => known.number === value.number)) result.push(value);
    }
    return result;
  };
  const dissolve = async (groups: Intent['groups'], operation: Intent, signal?: AbortSignal) => {
    for (const value of groups) {
      const old = operation.groups.find((item) => item.number === value.number);
      if (!old || JSON.stringify(old) !== JSON.stringify(value)) return false;
    }
    for (const value of groups) {
      await gh(
        ['api', '--method', 'POST', `repos/rafaeltab/wallpaperdb/stacks/${value.number}/unstack`],
        signal
      );
    }
    return true;
  };
  const regroup = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    const matches = (value: z.infer<typeof group>) =>
      JSON.stringify(value.pull_requests.map((item) => item.number)) ===
      JSON.stringify(operation.members);
    let groups = await groupsFor(operation.members, signal);
    if (!groups.some(matches)) {
      // Reconcile existing grouping before a possibly non-idempotent creation.
      // Do not dissolve a group changed externally since the recorded intent.
      if (!(await dissolve(groups, operation, signal))) return false;
      if ((await groupsFor(operation.members, signal)).length) return false;
      if (!(await publish(dir, 'group-claim.json', { members: operation.members }))) return false;
      await gh(
        [
          'api',
          '--method',
          'POST',
          'repos/rafaeltab/wallpaperdb/stacks',
          ...operation.members.flatMap((number) => ['-F', `pull_requests[]=${number}`]),
        ],
        signal
      );
      groups = await groupsFor(operation.members, signal);
      if (!groups.some(matches)) return false;
    }
    return true;
  };
  const recordEvidence = async (
    item: Intent['replay'][number],
    dir: string,
    signal?: AbortSignal
  ) => {
    const current = await prState(item, signal);
    if (current.headRefOid !== item.next || current.baseRefName !== item.target) return false;
    const recorded = z
      .object({
        body: z.string(),
        comments: z
          .array(z.object({ body: z.string(), author: z.object({ login: z.string() }).nullable() }))
          .optional(),
      })
      .parse(
        await gh(
          [
            'issue',
            'view',
            String(item.issue),
            '--repo',
            'rafaeltab/wallpaperdb',
            '--json',
            'body,comments',
          ],
          signal
        )
      );
    const body = [
      recorded.body,
      ...(recorded.comments ?? [])
        .filter(
          (comment) =>
            comment.author && ['rafaeltab', 'zero-two-rafaeltab'].includes(comment.author.login)
        )
        .map((comment) => comment.body),
    ].join('\n');
    if (body.includes(item.next) && body.includes(item.url)) return true;
    if (!(await publish(dir, `evidence-claim-${item.pr}.json`, { commit: item.next })))
      return false;
    await command(
      'gh',
      [
        'issue',
        'comment',
        String(item.issue),
        '--repo',
        'rafaeltab/wallpaperdb',
        '--body',
        `Automatic issue-only join: ${item.url} at ${item.next}, tree ${item.tree}, parent ${item.onto}. CI passed on this replayed tree. Original independent review commit ${reviewOrigin(item)}; prior published head ${item.commit}. This is a CI-verified replay, not a fresh review.`,
      ],
      project,
      signal
    );
    return true;
  };
  const factsValid = async (operation: Intent, signal?: AbortSignal) => {
    if (operation.boundary)
      return boundaryStillValid(project, base, operation.boundary, gh, signal);
    // Legacy intents cannot acquire new closure assumptions during recovery.
    for (const number of operation.numbers) {
      const state = z
        .object({ state: z.string() })
        .parse(
          await gh(
            ['issue', 'view', String(number), '--repo', 'rafaeltab/wallpaperdb', '--json', 'state'],
            signal
          )
        );
      if (state.state !== 'OPEN') return false;
    }
    return true;
  };
  const containsLayers = async (operation: Intent, tip: string, signal?: AbortSignal) => {
    for (const item of operation.layers) {
      const changed = operation.replay.find((value) => value.issue === item.issue);
      if (!(await isAncestor(changed?.next ?? item.commit, tip, signal))) return false;
    }
    return true;
  };
  const finalContainsFacts = async (operation: Intent, signal?: AbortSignal) => {
    const tip = replayTip(operation);
    if (!tip) return false;
    const boundary = operation.boundary ?? { base, prBase: 'main', pin: base, landed: [] };
    if (!(await containsRequired(project, tip, boundary, signal))) return false;
    return containsLayers(operation, tip, signal);
  };
  const operationFactsValid = async (operation: Intent, signal?: AbortSignal) =>
    (await factsValid(operation, signal)) && (await finalContainsFacts(operation, signal));
  const publicationSafe = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    if (!(await operationFactsValid(operation, signal))) return false;
    if (!(await writers(operation.layers, signal))) return false;
    return verifyHeads(operation, dir, signal);
  };
  const validateOperation = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    if (!(await operationFactsValid(operation, signal))) return false;
    for (const item of operation.replay) if (!(await validate(item, dir, signal))) return false;
    return publicationSafe(operation, dir, signal);
  };
  const publishComparisons = async (operation: Intent, signal?: AbortSignal) => {
    for (const item of operation.replay) if (!(await publishLayer(item, signal))) return false;
    return true;
  };
  const refreshAssertions = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    for (const item of operation.replay)
      if (!(await recordEvidence(item, dir, signal))) return false;
    return true;
  };
  const deliver = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    if (!(await regroup(operation, dir, signal))) return;
    if (!(await refreshAssertions(operation, dir, signal))) return;
    await publish(dir, 'complete.json', { commit: replayTip(operation) });
  };
  const operationFor = async (
    numbers: readonly number[],
    candidates: unknown,
    signal?: AbortSignal,
    requirements?: JoinBoundary
  ) => {
    const dir = directory(numbers);
    if (await read(dir, 'blocked.json')) return null;
    let operation = await load(numbers);
    const layers = operation?.layers ?? z.array(layer).parse(candidates);
    if (
      !(await acquire(
        id(numbers),
        layers.map((item) => `branch:${item.branch}`)
      ))
    )
      return null;
    if (!operation) operation = (await build(numbers, candidates, signal, requirements)) ?? null;
    return operation;
  };
  const prepare = async (
    numbers: readonly number[],
    candidates: unknown,
    signal?: AbortSignal,
    requirements?: JoinBoundary
  ) => {
    const dir = directory(numbers);
    const operation = await operationFor(numbers, candidates, signal, requirements);
    if (!operation || !(await publicationSafe(operation, dir, signal))) return;
    if (
      !(await acquire(
        id(numbers),
        operation.groups.map((group) => `group:${group.number}`)
      ))
    )
      return;

    if (!(await verifyHeads(operation, dir, signal))) return;
    if (!(await publishComparisons(operation, signal))) return;
    if (!(await validateOperation(operation, dir, signal))) return;
    await deliver(operation, dir, signal);
  };
  async function isAncestor(parent: string, child: string, signal?: AbortSignal) {
    try {
      await git(['merge-base', '--is-ancestor', parent, child], signal);
      return true;
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 1) return false;
      throw cause;
    }
  }
  const metadataMatches = async (operation: Intent, signal?: AbortSignal) => {
    for (const item of operation.replay) {
      const current = await prState(item, signal);
      if (current.headRefOid !== item.next || current.baseRefName !== item.target) return false;
    }
    return groupingMatches(operation, signal);
  };
  const groupingMatches = async (operation: Intent, signal?: AbortSignal) => {
    const groups = await groupsFor(operation.members, signal);
    return groups.some((value) =>
      containsMembers(
        value.pull_requests.map((item) => item.number),
        operation.members
      )
    );
  };
  const authenticatedTarget = async (
    operation: Intent,
    item: Intent['replay'][number],
    target: string,
    signal?: AbortSignal
  ) => {
    const parents = [
      ...operation.layers,
      ...operation.replay.map((value) => ({ ...value, commit: value.next })),
    ];
    const parent = parents.find(
      (value) => value.branch === item.target && value.commit === item.onto
    );
    if (!parent) return false;
    const landed = await landedPrerequisite(project, parent.issue, gh, signal);
    if (
      !landed ||
      landed.pr !== parent.pr ||
      landed.originalHead !== parent.commit ||
      landed.branch !== target
    )
      return false;
    return isAncestor(landed.commit, item.next, signal);
  };
  const currentComparison = async (
    operation: Intent,
    item: Intent['replay'][number],
    signal?: AbortSignal
  ) => {
    const current = await prState(item, signal);
    if (current.state !== 'OPEN' || current.headRefOid !== item.next) return false;
    if (current.baseRefName !== item.target)
      return authenticatedTarget(operation, item, current.baseRefName, signal);
    const head = await remote(item.target, signal);
    return !!head && (await isAncestor(item.onto, head, signal));
  };
  const completedFactsValid = async (operation: Intent, signal?: AbortSignal) => {
    if (!operation.boundary) return false;
    if (!(await boundaryFactsValid(project, base, operation.boundary, gh, signal))) return false;
    return finalContainsFacts(operation, signal);
  };
  // Completed history is immutable. Its current comparison can change only
  // with authenticated landing evidence; the preparation guards stay strict.
  const completedComparisonsValid = async (operation: Intent, signal?: AbortSignal) => {
    if (
      (await operationFactsValid(operation, signal)) &&
      (await metadataMatches(operation, signal))
    )
      return true;
    if (!(await completedFactsValid(operation, signal))) return false;
    for (const item of operation.replay)
      if (!(await currentComparison(operation, item, signal))) return false;
    return groupingMatches(operation, signal);
  };
  const verifyReplayTree = async (
    item: Intent['replay'][number],
    dir: string,
    signal?: AbortSignal
  ) => {
    z.object({ commit: z.literal(item.next), tree: z.literal(item.tree) }).parse(
      await read(dir, `ci-${item.next}.json`)
    );
    if ((await git(['rev-parse', `${item.next}^{tree}`], signal)) !== item.tree)
      throw new Error('Mismatched replay tree');
  };
  const evidence = async (numbers: readonly number[], signal?: AbortSignal) => {
    const operation = await load(numbers);
    if (!operation || !(await read(directory(numbers), 'complete.json'))) return [];
    if (!(await completedComparisonsValid(operation, signal))) return [];
    for (const item of operation.replay) await verifyReplayTree(item, directory(numbers), signal);
    return operation.replay;
  };
  const completedReplay = async (key: string, issue: number, signal?: AbortSignal) => {
    const saved = await read(join(config.directory, key), 'intent.json');
    if (!saved || !(await read(join(config.directory, key), 'complete.json'))) return null;
    const operation = intent.parse(saved);
    const item = operation.replay.find((value) => value.issue === issue);
    if (!item) return null;
    await verifyReplayTree(item, join(config.directory, key), signal);
    const current = await prState(item, signal);
    return {
      ...item,
      comparison: current.baseRefName,
      comparisonReady: await completedComparisonsValid(operation, signal),
    };
  };
  const operationDirectories = async () => {
    let entries: string[];
    try {
      entries = await readdir(config.directory);
    } catch (cause) {
      if (errno(cause, 'ENOENT')) return [];
      throw cause;
    }
    return entries;
  };
  const replayFor = async (issue: number, signal?: AbortSignal) => {
    const entries = await operationDirectories();
    for (const key of entries.filter((value) => /^[a-f0-9]{64}$/.test(value))) {
      const item = await completedReplay(key, issue, signal);
      if (item) return item;
    }
    return null;
  };
  const reconcile = async (signal?: AbortSignal) => {
    for (const key of await operationDirectories()) {
      if (!/^[a-f0-9]{64}$/.test(key)) continue;
      const saved = await read(join(config.directory, key), 'intent.json');
      if (!saved || (await read(join(config.directory, key), 'complete.json'))) continue;
      const operation = intent.parse(saved);
      await prepare(operation.numbers, null, signal);
    }
  };
  return { prepare, evidence, state, replayFor, reconcile };
}

function replayTip(operation: Intent) {
  return operation.replay.at(-1)?.next;
}

function containsMembers(actual: readonly number[], expected: readonly number[]) {
  return expected.every(
    (number, index) =>
      actual.indexOf(number) >= index &&
      (index === 0 || actual.indexOf(number) > actual.indexOf(expected[index - 1] ?? 0))
  );
}

function allowedPublication(
  current: { state: string; headRefOid: string; baseRefName: string },
  item: Intent['replay'][number]
) {
  return (
    current.state === 'OPEN' &&
    [item.commit, item.next].includes(current.headRefOid) &&
    [item.prBase, item.target].includes(current.baseRefName)
  );
}

function idleWriter(detail: { status: string; pendingRequestCount: number }) {
  return ['completed', 'idle'].includes(detail.status) && detail.pendingRequestCount === 0;
}

function reviewOrigin(item: Layer) {
  return item.reviewedCommit ?? item.commit;
}
