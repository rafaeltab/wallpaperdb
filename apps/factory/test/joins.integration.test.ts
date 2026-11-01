import { execFileSync } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { protocol } from './fixtures/setup.js';

async function fixture(
  options: {
    conflict?: boolean;
    writer?: boolean;
    ciFails?: boolean;
    lose?: 'base' | 'group' | 'evidence';
    staleHead?: boolean;
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
        options.conflict && ['D', 'C'].includes(name) ? 'shared.txt' : `${name}.txt`
      ),
      name
    );
    git('add', '.');
    git('commit', '-m', name);
    return git('rev-parse', 'HEAD');
  };
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  execFileSync('git', ['init', '--bare', join(host.directory, 'remote.git')]);
  git('remote', 'add', 'origin', join(host.directory, 'remote.git'));
  git('switch', '-c', 'A');
  const a = await commit('A');
  git('switch', '-c', 'B');
  await commit('B');
  git('switch', '-c', 'D');
  const d = await commit('D');
  git('switch', '-c', 'C', a);
  const c = await commit('C');
  git('push', 'origin', 'A', 'B', 'C', 'D');
  git('switch', '--detach', host.base);
  const make = join(host.directory, 'make');
  await writeFile(
    make,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + join(host.directory, 'ci-calls') + '"\n'
  );
  await chmod(make, 0o700);
  if (options.staleHead)
    await writeFile(
      make,
      `#!/bin/sh
if [ "$1" = ci ]; then git --git-dir='${join(host.directory, 'remote.git')}' update-ref refs/heads/C ${d}; fi
`
    );
  if (options.ciFails) await writeFile(make, '#!/bin/sh\nexit 1\n');
  await host.save({
    lost: false,
    joinWriter: options.writer,
    join: {
      lose: options.lose,
      evidence: `https://github.com/rafaeltab/wallpaperdb/pull/103 ${d}\nhttps://github.com/rafaeltab/wallpaperdb/pull/104 ${c}`,
      prs: { 103: { branch: 'D', base: 'B' }, 104: { branch: 'C', base: 'A' } },
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
    make,
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
  const { host, git, d, issues } = f;
  try {
    expect(await Effect.runPromise(issues.inspect(5))).toMatchObject({
      blockersReady: false,
      joinRequired: true,
    });
    if (!issues.prepare) throw new Error('Missing join preparation');
    await Effect.runPromise(issues.prepare(5));
    const ready = await Effect.runPromise(issues.inspect(5));
    expect(ready.blockersReady).toBe(true);
    expect(ready.prerequisite?.prBase).toBe('C');
    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing join head');
    expect(git('ls-tree', '--name-only', head)).toBe('A.txt\nB.txt\nC.txt\nD.txt');
    expect(git('log', '--format=%s', `${host.base}..${head}`)).toBe('C\nD\nB\nA');
    expect(git('diff', '--name-only', `${d}..${head}`)).toBe('C.txt');
    expect(git('rev-list', '--merges', `${host.base}..${head}`)).toBe('');
    expect(git('ls-remote', '--heads', 'origin', 'refs/heads/D').split(/\s/)[0]).toBe(d);
    expect(await readFile(join(host.directory, 'join-live.json'), 'utf8')).toContain('"base":"D"');
    expect(await readFile(join(host.directory, 'ci-calls'), 'utf8')).toBe(
      'install\nci SHELL=/bin/sh CI_CONCURRENCY=1\n'
    );
    console.log(
      JSON.stringify({
        provenance:
          'Production GitHub Issues public port and real isolated Git/worktrees/bare remote. Controlled GitHub/T3 and CI execution protocols; original acceptance/review are operator assertions. No live model or project stack changes.',
        head,
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
    expect((await f.host.calls()).some((call) => call.args[0] === 'stack')).toBe(false);
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
    expect((await f.host.calls()).some((call) => call.args[0] === 'stack')).toBe(false);
  } finally {
    await f.close();
  }
});

it('keeps failed replay CI blocked across adapter reopen and preserves remote heads', async () => {
  const f = await fixture({ ciFails: true });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await expect(Effect.runPromise(f.issues.prepare(5))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      blockedReason: expect.stringContaining('ci-failed'),
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
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
      expect(calls.filter((call) => call.args[0] === 'stack')).toHaveLength(1);
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
    await Effect.runPromise(f.issues.prepare(5));
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      blockedReason: expect.stringContaining('head-conflict'),
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.d);
    expect((await f.host.calls()).some((call) => call.args[0] === 'stack')).toBe(false);
  } finally {
    await f.close();
  }
});
