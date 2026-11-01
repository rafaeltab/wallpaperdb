import { execFileSync } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Job, JobLive, JobStore, Issues, Execution, Time } from '../src/capabilities/job/index.js';
import { fileStore } from '../src/adapters/store/index.js';
import { t3Execution } from '../src/adapters/t3/index.js';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { protocol } from './fixtures/setup.js';

async function fixture(
  options: {
    conflict?: boolean;
    duplicate?: boolean;
    multiple?: boolean;
    groups?: boolean;
    descendant?: boolean;
    merge?: boolean;
    writer?: boolean | 'completed';
    owningWorktree?: 'clean' | 'dirty';
    ciFails?: boolean;
    lose?: 'base' | 'group' | 'evidence';
    staleHead?: boolean;
    corruptGrouping?: boolean;
  } = {}
) {
  const host = await protocol();
  const previous = process.env.PATH;
  const fixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = `${host.directory}:${previous}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  const commit = async (name: string) => {
    await writeFile(
      join(
        host.repository,
        (options.conflict || options.duplicate) && ['D', 'C'].includes(name)
          ? 'shared.txt'
          : `${name}.txt`
      ),
      options.duplicate && ['D', 'C'].includes(name) ? 'same' : name
    );
    git('add', '.');
    git('commit', '-m', name);
    return git('rev-parse', 'HEAD');
  };
  const rootBranch = git('branch', '--show-current');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  execFileSync('git', ['init', '--bare', join(host.directory, 'remote.git')]);
  git('remote', 'add', 'origin', join(host.directory, 'remote.git'));
  git('switch', '-c', 'A');
  const a = await commit('A');
  git('switch', '-c', 'B');
  const b = await commit('B');
  git('switch', '-c', 'D');
  let d = await commit('D');
  if (options.merge) {
    git('switch', '-c', 'side', a);
    await commit('M');
    git('switch', 'D');
    git('merge', '--no-ff', 'side', '-m', 'merge');
    d = git('rev-parse', 'HEAD');
  }
  git('switch', '-c', 'C', a);
  let c = await commit('C');
  if (options.multiple) c = await commit('C2');
  git('push', 'origin', 'A', 'B', 'C', 'D');
  if (options.descendant) git('branch', 'F', c);
  git('switch', '--detach', host.base);
  if (options.owningWorktree) {
    const path = join(host.directory, 'owning-C');
    git('worktree', 'add', path, 'C');
    if (options.owningWorktree === 'dirty')
      await writeFile(join(path, 'C.txt'), 'uncommitted writer change');
  }
  if (options.staleHead) {
    const hook = join(host.repository, '.git', 'hooks', 'pre-push');
    await writeFile(
      hook,
      `#!/bin/sh
git --git-dir='${join(host.directory, 'remote.git')}' update-ref refs/heads/C ${d}
`
    );
    await chmod(hook, 0o700);
  }
  await host.save({
    lost: false,
    joinWriter: options.descendant ? true : options.writer,
    joinWriterBranch: options.descendant ? 'F' : 'C',
    join: {
      lose: options.lose,
      originalHeads: { 101: a, 102: b, 103: d, 104: c },
      groups: options.groups
        ? [
            { number: 9, pull_requests: [{ number: 101 }, { number: 104 }] },
            { number: 10, pull_requests: [{ number: 102 }, { number: 103 }] },
          ]
        : undefined,
      newCI: options.ciFails ? 'FAILURE' : 'SUCCESS',
      corruptGrouping: options.corruptGrouping,
      evidence: `https://github.com/rafaeltab/wallpaperdb/pull/103 ${d}\nhttps://github.com/rafaeltab/wallpaperdb/pull/104 ${c}`,
      prs: {
        101: { branch: 'A', base: rootBranch },
        102: { branch: 'B', base: 'A' },
        103: { branch: 'D', base: 'B' },
        104: { branch: 'C', base: 'A' },
      },
      members: [101, 102, 103].map(
        (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
      ),
    },
  });
  const issues = githubIssues({
    project: host.repository,
    base: host.base,
    prerequisites: [
      { issue: 3, pr: 103, commit: d },
      { issue: 4, pr: 104, commit: c },
    ],
    joins: {
      directory: join(host.directory, 'joins'),
      binary: host.binary,
      projectId: 'project-id',
    },
  });
  return {
    host,
    git,
    d,
    c,
    issues,
    reopen: () =>
      githubIssues({
        project: host.repository,
        base: host.base,
        prerequisites: [
          { issue: 3, pr: 103, commit: d },
          { issue: 4, pr: 104, commit: c },
        ],
        joins: {
          directory: join(host.directory, 'joins'),
          binary: host.binary,
          projectId: 'project-id',
        },
      }),
    close: async () => {
      process.env.PATH = previous;
      if (fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = fixture;
      await host.cleanup();
    },
  };
}

it('replays only C onto A-B-D, verifies CI and retargets C before admitting E', async () => {
  const f = await fixture();
  const { host, git, d, c, issues } = f;
  try {
    expect(await Effect.runPromise(issues.inspect(5))).toMatchObject({
      blockersReady: false,
      joinRequired: true,
    });
    if (!issues.prepare) throw new Error('Missing join preparation');
    await Effect.runPromise(issues.prepare(5));
    const ready = await Effect.runPromise(issues.inspect(5));
    expect(ready.blockersReady).toBe(true);
    await Effect.runPromise(issues.prepare(5));
    expect(ready.prerequisite?.prBase).toBe('C');
    expect(
      await Effect.runPromise(
        issues.pullRequest({
          id: 'C-job',
          issue: 4,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
          base: host.base,
          prBase: 'A',
          branch: 'C',
          context: '',
          createdAt: 0,
          expectedStage: 'implementation',
        })
      )
    ).toMatchObject({
      kind: 'found',
      ready: true,
      commit: ready.prerequisite?.base,
      reviewedCommit: c,
    });

    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing join head');
    expect(git('ls-tree', '--name-only', head)).toBe('A.txt\nB.txt\nC.txt\nD.txt');
    expect(git('log', '--format=%s', `${host.base}..${head}`)).toBe('C\nD\nB\nA');
    expect(git('diff', '--name-only', `${d}..${head}`)).toBe('C.txt');
    expect(git('rev-list', '--merges', `${host.base}..${head}`)).toBe('');
    expect(git('ls-remote', '--heads', 'origin', 'refs/heads/D').split(/\s/)[0]).toBe(d);
    const metadata = JSON.parse(await readFile(join(host.directory, 'join-live.json'), 'utf8'));
    expect(metadata.prs['104'].base).toBe('D');
    expect(metadata.prs['103'].base).toBe('B');
    expect(metadata.members).toEqual(
      [101, 102, 103, 104].map(
        (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
      )
    );
    const runtime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JobStore, fileStore(join(host.directory, 'E-state'))),
            Layer.succeed(Issues, issues),
            Layer.succeed(Time, { now: () => Effect.succeed(5) }),
            Layer.succeed(
              Execution,
              t3Execution({
                project: host.repository,
                projectId: 'project-id',
                binary: host.binary,
              })
            )
          )
        )
      )
    );
    let worker: string | undefined;
    try {
      const job = await runtime.runPromise(Job);
      const e = await runtime.runPromise(
        job.start({
          issue: 5,
          base: head,
          prBase: 'C',
          prerequisiteEvidence: ready.prerequisite?.evidence,
          context: 'Join demo E',
        })
      );
      if (e.kind !== 'job' || e.execution.kind !== 'found') throw new Error('Missing E worker');
      worker = e.execution.worktree;
      for (const name of ['A', 'B', 'C', 'D'])
        expect(await readFile(join(worker, `${name}.txt`), 'utf8')).toBe(name);
      expect(e.intent.prBase).toBe('C');
    } finally {
      await runtime.dispose();
    }
    console.log(
      JSON.stringify({
        provenance:
          'Production GitHub Issues public port and real isolated Git/worktrees/bare remote. Controlled GitHub/T3 and CI execution protocols; original acceptance/review are operator assertions. No live model or project stack changes.',
        head,
        worker,
        files: git('ls-tree', '--name-only', head),
        history: git('log', '--format=%s', `${host.base}..${head}`),
        prBase: ready.prerequisite?.prBase,
      })
    );
  } finally {
    await f.close();
  }
});

it('retains conflicting branches and exposes a durable blocked outcome without publication', async () => {
  const f = await fixture({ conflict: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      joinRequired: false,
      blockedReason: expect.stringContaining('conflict'),
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    expect((await f.host.calls()).some((call) => isGroupCreation(call))).toBe(false);
  } finally {
    await f.close();
  }
});

it('waits for an active prerequisite writer before replay or CI', async () => {
  const f = await fixture({ writer: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({ blockersReady: false });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    expect((await f.host.calls()).some((call) => isGroupCreation(call))).toBe(false);
  } finally {
    await f.close();
  }
});

it('keeps E blocked until the exact replayed head passes CI across adapter reopen', async () => {
  const f = await fixture({ ciFails: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      joinRequired: true,
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/D').split(/\s/)[0]).toBe(f.d);
    const path = join(f.host.directory, 'join-live.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    state.newCI = 'SUCCESS';
    await writeFile(path, JSON.stringify(state));
    const reopened = f.reopen();
    if (!reopened.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(reopened.reconcile());
    expect(await Effect.runPromise(reopened.inspect(5))).toMatchObject({ blockersReady: true });
  } finally {
    await f.close();
  }
});

it.each(['base', 'group', 'evidence'] as const)(
  'reconciles a lost %s response from durable intent without duplicating grouping or evidence',
  async (lose) => {
    const f = await fixture({ lose });
    try {
      if (!f.issues.prepare) throw new Error('Missing preparation');
      await expect(Effect.runPromise(f.issues.prepare(5))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
      expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
        blockersReady: false,
        joinRequired: true,
      });
      const reopened = f.reopen();
      if (!reopened.prepare) throw new Error('Missing preparation');
      await Effect.runPromise(reopened.prepare(5));
      expect(await Effect.runPromise(reopened.inspect(5))).toMatchObject({
        blockersReady: true,
        prerequisite: { prBase: 'C' },
      });
      const calls = await f.host.calls();
      expect(calls.filter((call) => isGroupCreation(call))).toHaveLength(1);
      expect(
        calls.filter((call) => call.args[0] === 'issue' && call.args[1] === 'comment')
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  }
);

it('preserves an externally changed remote head and exposes a blocked lease outcome', async () => {
  const f = await fixture({ staleHead: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await expect(Effect.runPromise(f.issues.prepare(5))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      blockedReason: expect.stringContaining('head-conflict'),
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.d);
    expect((await f.host.calls()).some((call) => isGroupCreation(call))).toBe(false);
  } finally {
    await f.close();
  }
});

it('waits for a dirty owning worktree while allowing a completed T3 writer', async () => {
  const f = await fixture({ writer: 'completed', owningWorktree: 'dirty' });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({ blockersReady: false });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    expect(await readFile(join(f.host.directory, 'owning-C', 'C.txt'), 'utf8')).toBe(
      'uncommitted writer change'
    );
  } finally {
    await f.close();
  }
});

it('joins after a completed writer leaves a clean owning worktree', async () => {
  const f = await fixture({ writer: 'completed', owningWorktree: 'clean' });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({ blockersReady: true });
  } finally {
    await f.close();
  }
});

it('does not admit E until native grouping is independently read back, retaining an uncertain creation as pending', async () => {
  const f = await fixture({ corruptGrouping: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      joinRequired: true,
    });
    const reopened = f.reopen();
    if (!reopened.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(reopened.prepare(5));
    expect(await Effect.runPromise(reopened.inspect(5))).toMatchObject({ blockersReady: false });
    expect((await f.host.calls()).filter((call) => isGroupCreation(call))).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it('rejects a nonlinear prerequisite before rewriting or publishing any branch', async () => {
  const f = await fixture({ merge: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({
      blockersReady: false,
      blockedReason: expect.stringContaining('nonlinear-prerequisite'),
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
  } finally {
    await f.close();
  }
});

it('continues a disjoint join while another prerequisite path remains conflicted', async () => {
  const f = await fixture({ conflict: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    f.git('switch', '-c', 'D2', 'A');
    await writeFile(join(f.host.repository, 'D2.txt'), 'D2');
    f.git('add', '.');
    f.git('commit', '-m', 'D2');
    const d = f.git('rev-parse', 'HEAD');
    f.git('switch', '-c', 'C2', 'A');
    await writeFile(join(f.host.repository, 'C2.txt'), 'C2');
    f.git('add', '.');
    f.git('commit', '-m', 'C2');
    const c = f.git('rev-parse', 'HEAD');
    f.git('push', 'origin', 'D2', 'C2');
    f.git('switch', '--detach', f.host.base);
    await writeFile(
      join(f.host.directory, 'join-live.json'),
      JSON.stringify({
        evidence: `https://github.com/rafaeltab/wallpaperdb/pull/106 ${d}\nhttps://github.com/rafaeltab/wallpaperdb/pull/107 ${c}`,
        originalHeads: { 106: d, 107: c },
        prs: { 106: { branch: 'D2', base: 'A' }, 107: { branch: 'C2', base: 'A' } },
        members: [],
        blockers: [
          { number: 6, state: 'open' },
          { number: 7, state: 'open' },
        ],
      })
    );
    const second = githubIssues({
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [
        { issue: 6, pr: 106, commit: d },
        { issue: 7, pr: 107, commit: c },
      ],
      joins: {
        directory: join(f.host.directory, 'joins'),
        binary: f.host.binary,
        projectId: 'project-id',
      },
    });
    if (!second.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(second.prepare(8));
    expect(await Effect.runPromise(second.inspect(8))).toMatchObject({
      blockersReady: true,
      prerequisite: { prBase: 'C2' },
    });
  } finally {
    await f.close();
  }
});

function isGroupCreation(call: { args: string[] }) {
  return call.args.includes('POST') && call.args.includes('repos/rafaeltab/wallpaperdb/stacks');
}

it('preserves every issue-only commit when replaying a multi-commit prerequisite', async () => {
  const f = await fixture({ multiple: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    const ready = await Effect.runPromise(f.issues.inspect(5));
    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing verified join');
    expect(f.git('log', '--format=%s', `${f.d}..${head}`)).toBe('C2\nC');
    expect(f.git('diff', '--name-only', `${f.d}..${head}`)).toBe('C.txt\nC2.txt');
    expect(f.git('rev-list', '--merges', `${f.host.base}..${head}`)).toBe('');
  } finally {
    await f.close();
  }
});

it('keeps an empty issue comparison blocked rather than publishing duplicate prerequisite contents', async () => {
  const f = await fixture({ duplicate: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({
      blockersReady: false,
      blockedReason: expect.stringContaining('empty-replay'),
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
  } finally {
    await f.close();
  }
});

it('combines separate A-C and B-D native groups in valid A-B-D-C order', async () => {
  const f = await fixture({ groups: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({ blockersReady: true });
    const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(metadata.members).toEqual(
      [101, 102, 103, 104].map(
        (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
      )
    );
    expect(metadata.prs['103'].base).toBe('B');
  } finally {
    await f.close();
  }
});

it('waits for an active descendant writer before rewriting its prerequisite', async () => {
  const f = await fixture({ descendant: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.issues.inspect(5))).toMatchObject({ blockersReady: false });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
  } finally {
    await f.close();
  }
});
