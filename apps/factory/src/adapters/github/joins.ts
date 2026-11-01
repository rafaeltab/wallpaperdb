import { createHash } from 'node:crypto';
import { mkdir, open, readFile, link, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { command } from '../../platform/index.js';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const layer = z.object({
  issue: z.number().int().positive(),
  pr: z.number().int().positive(),
  commit: sha,
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

/** Journal publication uses hard links and fsync, so competing processes adopt
 * the same immutable intent. Every external change is reconciled from it. */
async function publish(directory: string, name: string, value: unknown) {
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(join(directory, '.write-'));
  const path = join(temporary, 'value');
  const file = await open(path, 'wx');
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  let created = false;
  try {
    await link(path, join(directory, name));
    created = true;
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause;
  } finally {
    await unlink(path);
  }
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
    const worktrees = await git(['worktree', 'list', '--porcelain'], signal);
    for (const block of worktrees.split('\n\n')) {
      if (!layers.some((item) => block.includes(`branch refs/heads/${item.branch}\n`))) continue;
      const path = block.split('\n')[0]?.slice('worktree '.length);
      if (!path || (await command('git', ['status', '--porcelain'], path, signal)).trim())
        return false;
    }
    return true;
  };
  const acquire = async (key: string) => {
    for (let index = 0; ; index++) {
      const name = `writer-${index}.json`;
      const existing = await read(config.directory, name);
      if (existing) {
        const owner = z.object({ key: z.string() }).parse(existing).key;
        if (owner === key) return true;
        if (await read(join(config.directory, owner), 'complete.json')) continue;
        return false;
      }
      await publish(config.directory, name, { key });
      const winner = z.object({ key: z.string() }).parse(await read(config.directory, name));
      return winner.key === key;
    }
  };
  const state = async (numbers: readonly number[]) => ({
    operation: await load(numbers),
    blocked: await read(directory(numbers), 'blocked.json'),
  });
  const prepare = async (numbers: readonly number[], candidates: unknown, signal?: AbortSignal) => {
    const dir = directory(numbers);
    if (!(await acquire(id(numbers)))) return;
    if (await read(dir, 'blocked.json')) return;
    let operation = await load(numbers);
    if (!operation) {
      await publish(dir, 'seed.json', candidates);
      const layers = z
        .array(layer)
        .min(2)
        .max(100)
        .parse(await read(dir, 'seed.json'));
      if (!(await writers(layers, signal))) return;
      const ranked = await Promise.all(
        layers.map(async (item) => ({
          item,
          depth: Number(await git(['rev-list', '--count', `${base}..${item.commit}`], signal)),
        }))
      );
      ranked.sort((a, b) => b.depth - a.depth || a.item.issue - b.item.issue);
      const first = ranked[0];
      if (!first) return;
      let onto = first.item.commit;
      let target = first.item.branch;
      const replay: Intent['replay'] = [];
      for (const { item } of ranked.slice(1)) {
        // The PR's old parent boundary is captured before any refs change.
        const parent = await git(['merge-base', item.parent, item.commit], signal);
        if (await git(['rev-list', '--merges', `${parent}..${item.commit}`], signal)) return;
        if (await isAncestor(item.commit, onto)) continue;
        if (!(await isAncestor(parent, onto))) return;
        await mkdir(dir, { recursive: true });
        const path = await mkdtemp(join(dir, 'replay-'));
        await git(['worktree', 'add', '--detach', path, item.commit], signal);
        try {
          await command('git', ['rebase', '--onto', onto, parent], path, signal);
        } catch (cause) {
          await publish(dir, 'blocked.json', {
            kind: 'conflict',
            issue: item.issue,
            oldHead: item.commit,
            oldParent: parent,
            onto,
            worktree: path,
          });
          return;
        }
        const next = (await command('git', ['rev-parse', 'HEAD'], path, signal)).trim();
        const tree = (await command('git', ['rev-parse', 'HEAD^{tree}'], path, signal)).trim();
        replay.push({ ...item, parent, next, onto, target, tree });
        onto = next;
        target = item.branch;
      }
      if (!replay.length) return;
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
      await publish(dir, 'intent.json', { layers, replay, groups, members });
      operation = await load(numbers);
    }
    if (!operation || !(await writers(operation.layers, signal))) return;
    // No automatic resolution of a recorded conflict or uncertain validation.
    if (await read(dir, 'blocked.json')) return;
    for (const item of operation.replay) {
      const receipt = await read(dir, `ci-${item.next}.json`);
      if (receipt) {
        z.object({ commit: z.literal(item.next), tree: z.literal(item.tree) }).parse(receipt);
        continue;
      }
      if (
        !(await publish(dir, `ci-claim-${item.next}.json`, { commit: item.next, tree: item.tree }))
      )
        return;
      const path = await mkdtemp(join(dir, 'validation-'));
      await git(['worktree', 'add', '--detach', path, item.next], signal);
      try {
        await command(
          'timeout',
          ['3600', 'make', 'install'],
          path,
          signal,
          undefined,
          undefined,
          3610000
        );
        await command(
          'timeout',
          ['3600', 'make', 'ci', 'SHELL=/bin/sh', 'CI_CONCURRENCY=1'],
          path,
          signal,
          {
            TURBO_EXPERIMENTAL_OTEL_ENDPOINT: undefined,
            TURBO_EXPERIMENTAL_OTEL_PROTOCOL: undefined,
          },
          undefined,
          3610000
        );
        if ((await command('git', ['rev-parse', 'HEAD^{tree}'], path, signal)).trim() !== item.tree)
          throw new Error('Validation tree changed');
        await publish(dir, `ci-${item.next}.json`, { commit: item.next, tree: item.tree });
      } catch (cause) {
        await publish(dir, 'blocked.json', {
          kind: 'ci-failed',
          commit: item.next,
          tree: item.tree,
        });
        throw cause;
      }
    }
    if (!(await writers(operation.layers, signal))) return;
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
        return;
      }
    }
    for (const item of operation.replay) {
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
      if ((await remote(item.branch, signal)) !== item.next) return;
      const current = z
        .object({ headRefOid: sha, baseRefName: z.string() })
        .parse(
          await gh(
            [
              'pr',
              'view',
              String(item.pr),
              '--repo',
              'rafaeltab/wallpaperdb',
              '--json',
              'headRefOid,baseRefName',
            ],
            signal
          )
        );
      if (
        current.headRefOid !== item.next ||
        ![item.prBase, item.target].includes(current.baseRefName)
      )
        return;
      if (current.baseRefName !== item.target)
        await gh(
          ['pr', 'edit', String(item.pr), '--repo', 'rafaeltab/wallpaperdb', '--base', item.target],
          signal
        );
    }
    const observedGroups = async () => {
      const result: z.infer<typeof group>[] = [];
      for (const number of operation.members) {
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
    const matches = (value: z.infer<typeof group>) =>
      JSON.stringify(value.pull_requests.map((item) => item.number)) ===
      JSON.stringify(operation.members);
    let groups = await observedGroups();
    if (!groups.some(matches)) {
      // Reconcile existing grouping before a possibly non-idempotent creation.
      // Do not dissolve a group changed externally since the recorded intent.
      for (const value of groups) {
        const old = operation.groups.find((item) => item.number === value.number);
        if (!old || JSON.stringify(old) !== JSON.stringify(value)) return;
      }
      for (const value of groups) {
        await gh(
          ['api', '--method', 'POST', `repos/rafaeltab/wallpaperdb/stacks/${value.number}/unstack`],
          signal
        );
      }
      if ((await observedGroups()).length) return;
      if (!(await publish(dir, 'group-claim.json', { members: operation.members }))) return;
      await command(
        'gh',
        [
          'stack',
          'link',
          '--remote',
          'origin',
          ...operation.members.map(
            (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
          ),
        ],
        project,
        signal
      );
      groups = await observedGroups();
      if (!groups.some(matches)) return;
    }
    for (const item of operation.replay) {
      const current = z
        .object({ headRefOid: sha, baseRefName: z.string() })
        .parse(
          await gh(
            [
              'pr',
              'view',
              String(item.pr),
              '--repo',
              'rafaeltab/wallpaperdb',
              '--json',
              'headRefOid,baseRefName',
            ],
            signal
          )
        );
      if (current.headRefOid !== item.next || current.baseRefName !== item.target) return;
      const recorded = z
        .object({
          body: z.string(),
          comments: z
            .array(
              z.object({ body: z.string(), author: z.object({ login: z.string() }).nullable() })
            )
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
      if (body.includes(item.next) && body.includes(item.url)) continue;
      if (!(await publish(dir, `evidence-claim-${item.pr}.json`, { commit: item.next }))) return;
      await command(
        'gh',
        [
          'issue',
          'comment',
          String(item.issue),
          '--repo',
          'rafaeltab/wallpaperdb',
          '--body',
          `Automatic issue-only join: ${item.url} at ${item.next}, tree ${item.tree}, parent ${item.onto}. CI passed on this replayed tree. Acceptance and original independent reviews are retained from ${item.commit}; this is not a fresh review.`,
        ],
        project,
        signal
      );
    }
    await publish(dir, 'complete.json', { commit: operation.replay.at(-1)?.next });
  };
  async function isAncestor(parent: string, child: string) {
    try {
      await git(['merge-base', '--is-ancestor', parent, child]);
      return true;
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 1) return false;
      throw cause;
    }
  }
  const evidence = async (numbers: readonly number[]) => {
    const operation = await load(numbers);
    if (!operation || !(await read(directory(numbers), 'complete.json'))) return [];
    for (const item of operation.replay) {
      z.object({ commit: z.literal(item.next), tree: z.literal(item.tree) }).parse(
        await read(directory(numbers), `ci-${item.next}.json`)
      );
      if ((await git(['rev-parse', `${item.next}^{tree}`])) !== item.tree)
        throw new Error('Mismatched replay tree');
    }
    return operation.replay;
  };
  return { prepare, evidence, state };
}
