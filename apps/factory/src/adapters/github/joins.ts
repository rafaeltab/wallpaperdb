import { createHash } from 'node:crypto';
import { mkdir, open, readFile, link, unlink, mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { command } from '../../platform/index.js';
import { normalizeChecks, passingChecks } from './checks.js';

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
      if (
        layers.some((item) => item.branch === detail.branch) &&
        (!['completed', 'idle'].includes(detail.status) || detail.pendingRequestCount !== 0)
      )
        return false;
    }
    return await cleanWorktrees(layers, signal);
  };
  const cleanWorktrees = async (layers: readonly Layer[], signal?: AbortSignal) => {
    const worktrees = await git(['worktree', 'list', '--porcelain'], signal);
    for (const block of worktrees.split('\n\n')) {
      if (!layers.some((item) => block.split('\n').includes(`branch refs/heads/${item.branch}`)))
        continue;
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
    if (await isAncestor(item.commit, onto, signal)) return 'contained' as const;
    if (!(await isAncestor(parent, onto, signal))) return;
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
  const combine = async (
    ranked: readonly { item: Layer; depth: number }[],
    dir: string,
    signal?: AbortSignal
  ) => {
    const first = ranked[0];
    if (!first) return;
    let onto = first.item.commit;
    let target = first.item.branch;
    const replay: Intent['replay'] = [];
    for (const { item } of ranked.slice(1)) {
      const result = await replayLayer(item, onto, target, dir, signal);
      if (result === 'contained') continue;
      if (!result) return;
      replay.push(result);
      onto = result.next;
      target = item.branch;
    }
    return replay;
  };
  const invalidLayers = async (layers: readonly Layer[], signal?: AbortSignal) => {
    for (const item of layers) {
      if (!(await isAncestor(base, item.commit, signal))) return 'baseline-not-contained';
      if (await git(['rev-list', '--merges', `${base}..${item.commit}`], signal))
        return 'nonlinear-prerequisite';
    }
    return undefined;
  };
  const build = async (numbers: readonly number[], candidates: unknown, signal?: AbortSignal) => {
    const dir = directory(numbers);
    await publish(dir, 'seed.json', candidates);
    const layers = z
      .array(layer)
      .min(2)
      .max(100)
      .parse(await read(dir, 'seed.json'));
    const invalid = await invalidLayers(layers, signal);
    if (invalid) {
      await publish(dir, 'blocked.json', { kind: invalid });
      return;
    }
    if (!(await writers(layers, signal))) return;
    const ranked = await Promise.all(
      layers.map(async (item) => ({
        item,
        depth: Number(await git(['rev-list', '--count', `${base}..${item.commit}`], signal)),
      }))
    );
    ranked.sort((a, b) => b.depth - a.depth || a.item.issue - b.item.issue);
    const replay = await combine(ranked, dir, signal);
    if (!replay?.length) return;
    const groups: z.infer<typeof group>[] = [];
    for (const { item } of ranked) {
      const observed = z
        .array(group)
        .parse(
          await gh(['api', `repos/rafaeltab/wallpaperdb/stacks?pull_request=${item.pr}`], signal)
        );
      for (const value of observed)
        if (!groups.some((known) => known.number === value.number)) groups.push(value);
    }
    const replayed = new Set(replay.map((item) => item.pr));
    const members = [
      ...new Set([
        ...groups.flatMap((value) => value.pull_requests.map((item) => item.number)),
        ...layers.map((item) => item.pr),
      ]),
    ].filter((number) => !replayed.has(number));
    members.push(...replay.map((item) => item.pr));
    await publish(dir, 'intent.json', { numbers, layers, replay, groups, members });
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
    const current = z
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
        `Automatic issue-only join: ${item.url} at ${item.next}, tree ${item.tree}, parent ${item.onto}. CI passed on this replayed tree. Original independent review commit ${item.reviewedCommit ?? item.commit}; prior published head ${item.commit}. This is a CI-verified replay, not a fresh review.`,
      ],
      project,
      signal
    );
    return true;
  };
  const validateOperation = async (operation: Intent, dir: string, signal?: AbortSignal) => {
    for (const item of operation.replay) if (!(await validate(item, dir, signal))) return false;
    if (!(await writers(operation.layers, signal))) return false;
    if (!(await verifyHeads(operation, dir, signal))) return false;
    return true;
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
    signal?: AbortSignal
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
    if (!operation) operation = (await build(numbers, candidates, signal)) ?? null;
    return operation;
  };
  const prepare = async (numbers: readonly number[], candidates: unknown, signal?: AbortSignal) => {
    const dir = directory(numbers);
    const operation = await operationFor(numbers, candidates, signal);
    if (!operation || !(await writers(operation.layers, signal))) return;
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
      const current = z
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
      if (current.headRefOid !== item.next || current.baseRefName !== item.target) return false;
    }
    const groups = await groupsFor(operation.members, signal);
    return groups.some((value) =>
      containsMembers(
        value.pull_requests.map((item) => item.number),
        operation.members
      )
    );
  };
  const evidence = async (numbers: readonly number[], signal?: AbortSignal) => {
    const operation = await load(numbers);
    if (!operation || !(await read(directory(numbers), 'complete.json'))) return [];
    if (!(await metadataMatches(operation, signal))) return [];
    for (const item of operation.replay) {
      z.object({ commit: z.literal(item.next), tree: z.literal(item.tree) }).parse(
        await read(directory(numbers), `ci-${item.next}.json`)
      );
      if ((await git(['rev-parse', `${item.next}^{tree}`], signal)) !== item.tree)
        throw new Error('Mismatched replay tree');
    }
    return operation.replay;
  };
  const completedReplay = async (key: string, issue: number, signal?: AbortSignal) => {
    const saved = await read(join(config.directory, key), 'intent.json');
    if (!saved || !(await read(join(config.directory, key), 'complete.json'))) return null;
    const operation = intent.parse(saved);
    const item = operation.replay.find((value) => value.issue === issue);
    if (!item || !(await metadataMatches(operation, signal))) return null;
    z.object({ commit: z.literal(item.next), tree: z.literal(item.tree) }).parse(
      await read(join(config.directory, key), `ci-${item.next}.json`)
    );
    return item;
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
