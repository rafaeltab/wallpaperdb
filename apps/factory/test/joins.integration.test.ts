import { readFile, writeFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Job, JobLive, JobStore, Issues, Execution, Time } from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
import { fileStore } from '../src/adapters/store/index.js';
import { t3Execution } from '../src/adapters/t3/index.js';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { joinFixture as fixture } from './fixtures/join.js';

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

it('inspects a reserved comparison without preparing a pending join', async () => {
  const f = await fixture();
  try {
    expect(
      await Effect.runPromise(f.issues.inspect(5, { base: f.host.base, prBase: 'main' }))
    ).toMatchObject({ blockersReady: false, joinRequired: true });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    const writes = (await f.host.calls()).filter(
      ({ args }) =>
        (args[0] === 'pr' && args[1] === 'edit') ||
        (args[0] === 'api' && args.includes('POST')) ||
        (args[0] === 'issue' && args[1] === 'comment') ||
        (args[0] === 'thread' && args[1] === 'start')
    );
    expect(writes).toEqual([]);
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
      joinRequired: true,
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

it.each([false, true])(
  'joins a longer C path without depending on native blocker order, reversed=%s',
  async (reverse) => {
    const f = await fixture({ cCommits: 3, reverse });
    try {
      if (!f.issues.prepare) throw new Error('Missing preparation');
      await Effect.runPromise(f.issues.prepare(5));
      const ready = await Effect.runPromise(f.issues.inspect(5));
      expect(ready.blockersReady).toBe(true);
      const head = ready.prerequisite?.base;
      if (!head) throw new Error('Missing verified join');
      expect(f.git('log', '--format=%s', `${f.host.base}..${head}`)).toBe('C3\nC2\nC\nD\nB\nA');
      expect(f.git('diff', '--name-only', `${f.d}..${head}`)).toBe('C.txt\nC2.txt\nC3.txt');
      expect(f.git('rev-list', '--merges', `${f.host.base}..${head}`)).toBe('');
      const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
      expect(metadata.prs['104'].base).toBe('D');
      expect(metadata.members).toEqual(
        [101, 102, 103, 104].map(
          (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
        )
      );
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'recovers an older open-only join journal without inventing closed facts, closed=%s',
  async (closed) => {
    const f = await fixture({ ciFails: true });
    try {
      if (!f.issues.prepare) throw new Error('Missing prepare');
      await Effect.runPromise(f.issues.prepare(5));
      const root = join(f.host.directory, 'joins');
      const key = (await readdir(root)).find((name) => /^[a-f0-9]{64}$/.test(name));
      if (!key) throw new Error('Missing join journal');
      const path = join(root, key, 'intent.json');
      const saved = JSON.parse(await readFile(path, 'utf8'));
      // Controlled persisted state from the older journal format, not a production migration.
      delete saved.boundary;
      await writeFile(path, JSON.stringify(saved));
      const statePath = join(f.host.directory, 'join-live.json');
      const before = JSON.parse(await readFile(statePath, 'utf8'));
      await writeFile(statePath, JSON.stringify({ ...before, newCI: 'SUCCESS' }));
      if (closed) {
        const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
        await f.host.save({
          ...config,
          issueStates: { 4: 'CLOSED' },
          defaultBranch: { name: 'main', tip: f.host.base },
          landedPrerequisites: { 4: [] },
        });
      }
      const reopened = f.reopen();
      if (!reopened.reconcile) throw new Error('Missing reconcile');
      await Effect.runPromise(reopened.reconcile());
      const readiness = await Effect.runPromise(reopened.inspect(5));
      expect(readiness.blockersReady).toBe(!closed);
      const after = JSON.parse(await readFile(statePath, 'utf8'));
      if (closed) expect(after.members).toEqual(before.members);
      else {
        const head = readiness.prerequisite?.base;
        if (!head) throw new Error('Missing joined head');
        expect(f.git('ls-tree', '--name-only', head)).toBe('A.txt\nB.txt\nC.txt\nD.txt');
        expect(after.prs['104'].base).toBe('D');
      }
    } finally {
      await f.close();
    }
  }
);

it.each([
  'valid',
  'arbitrary-target',
  'head-drift',
  'closed-unmerged',
  'missing-proof',
  'wrong-head-proof',
  'non-containing-landing',
  'failed-ci',
  'corrupt-group',
  'changed-pin',
  'unknown-default',
] as const)(
  'retains completed review provenance while separately checking an anchor landing: %s',
  async (kind) => {
    const f = await fixture();
    try {
      if (!f.issues.prepare) throw new Error('Missing prepare');
      await Effect.runPromise(f.issues.prepare(5));
      const before = await Effect.runPromise(f.issues.inspect(5));
      const joined = before.prerequisite?.base;
      if (!joined) throw new Error('Missing completed join');
      const tree = f.git('rev-parse', `${joined}^{tree}`);
      const path = join(f.host.directory, 'join-live.json');
      const state = JSON.parse(await readFile(path, 'utf8'));
      // Real isolated default landing and deletion; no real project PR or worker.
      f.git('switch', 'main');
      f.git('merge', '--ff-only', 'D');
      let landed = f.d;
      if (kind === 'non-containing-landing') {
        f.git('switch', '--detach', f.d);
        f.git('commit', '--allow-empty', '-m', 'different landing result');
        landed = f.git('rev-parse', 'HEAD');
        f.git('branch', '-f', 'main', landed);
      }
      f.git('switch', '--detach', f.host.base);
      f.git('push', 'origin', 'main');
      f.git('push', 'origin', '--delete', 'D');
      state.prs['103'] = {
        ...state.prs['103'],
        state: kind === 'closed-unmerged' ? 'CLOSED' : 'MERGED',
        head: f.d,
        base: 'main',
      };
      state.prs['104'].base = 'main';
      if (kind === 'arbitrary-target') {
        f.git('branch', 'other', f.d);
        f.git('push', 'origin', 'other');
        state.prs['104'].base = 'other';
      }
      if (kind === 'head-drift') {
        f.git('switch', '--detach', joined);
        await writeFile(join(f.host.repository, 'external.txt'), 'external change');
        f.git('add', '.');
        f.git('commit', '-m', 'external change');
        f.git('push', 'origin', 'HEAD:refs/heads/C');
      }
      if (kind === 'failed-ci') state.newCI = 'FAILURE';
      if (kind === 'corrupt-group') {
        state.members = [];
        state.groups = [];
      }
      await writeFile(path, JSON.stringify(state));
      const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
      await f.host.save({
        ...config,
        issueStates: { 3: 'CLOSED' },
        defaultBranch: { name: 'main', tip: kind === 'unknown-default' ? 'f'.repeat(40) : landed },
        landedPrerequisites: { 3: kind === 'missing-proof' ? [] : [103] },
        mergedPrerequisites: {
          103: {
            merged: kind !== 'closed-unmerged',
            merge_commit_sha: landed,
            head: { sha: kind === 'wrong-head-proof' ? f.c : f.d },
            html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/103',
            base: { ref: 'main', repo: { full_name: 'rafaeltab/wallpaperdb' } },
          },
        },
      });
      const issues =
        kind === 'changed-pin'
          ? githubIssues({
              project: f.host.repository,
              base: f.d,
              prerequisites: [
                { issue: 3, pr: 103, commit: f.d },
                { issue: 4, pr: 104, commit: f.c },
              ],
              joins: {
                directory: join(f.host.directory, 'joins'),
                binary: f.host.binary,
                projectId: 'project-id',
              },
            })
          : f.reopen();
      if (kind === 'unknown-default') {
        await expect(Effect.runPromise(issues.inspect(5))).rejects.toMatchObject({
          _tag: 'Unavailable',
        });
        expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(joined);
        return;
      }
      const observed = await Effect.runPromise(
        issues.pullRequest({
          id: 'C-job',
          issue: 4,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
          base: f.host.base,
          prBase: 'A',
          branch: 'C',
          context: '',
          createdAt: 0,
          expectedStage: 'implementation',
        })
      );
      expect(observed).toMatchObject({ kind: 'found', ready: kind === 'valid' });
      if (kind !== 'head-drift')
        expect(observed).toMatchObject({ commit: joined, reviewedCommit: f.c });
      if (kind === 'valid') {
        expect(await Effect.runPromise(issues.inspect(5))).toMatchObject({
          blockersReady: true,
          prerequisite: { base: joined, prBase: 'C' },
        });
        expect(f.git('rev-parse', `${joined}^{tree}`)).toBe(tree);
        expect(f.git('ls-tree', '--name-only', joined)).toBe('A.txt\nB.txt\nC.txt\nD.txt');
        expect(f.git('diff', '--name-only', `${landed}..${joined}`)).toBe('C.txt');
        const runtime = ManagedRuntime.make(
          JobLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(JobStore, fileStore(join(f.host.directory, 'next-dependent'))),
                Layer.succeed(Issues, issues),
                Layer.succeed(Time, { now: () => Effect.succeed(5) }),
                Layer.succeed(
                  Execution,
                  t3Execution({
                    project: f.host.repository,
                    projectId: 'project-id',
                    binary: f.host.binary,
                  })
                )
              )
            )
          )
        );
        try {
          const job = await runtime.runPromise(Job);
          const next = await runtime.runPromise(
            job.start({
              issue: 5,
              base: joined,
              prBase: 'C',
              context: 'Verified completed join after anchor landing',
            })
          );
          if (next.kind !== 'job' || next.execution.kind !== 'found')
            throw new Error('Missing next dependent');
          expect(next.intent.base).toBe(joined);
          for (const name of ['A', 'B', 'C', 'D'])
            expect(await readFile(join(next.execution.worktree, `${name}.txt`), 'utf8')).toBe(name);
        } finally {
          await runtime.dispose();
        }
      }
      expect((await Effect.runPromise(issues.inspect(5))).blockersReady).toBe(kind === 'valid');
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/D')).toBe('');
    } finally {
      await f.close();
    }
  }
);

it.each([
  'valid',
  'rollback',
  'drift',
  'failed-ci',
  'corrupt-group',
  'changed-pin',
  'ambiguous-review',
  'ambiguous-owner',
  'wrong-tree',
] as const)('selects current completed provenance after successive joins: %s', async (kind) => {
  const f = await fixture();
  try {
    if (!f.issues.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(f.issues.prepare(5));
    const first = (await Effect.runPromise(f.issues.inspect(5))).prerequisite?.base;
    if (!first) throw new Error('Missing first join');
    f.git('switch', '-c', 'G', f.d);
    await writeFile(join(f.host.repository, 'G.txt'), 'G');
    f.git('add', '.');
    f.git('commit', '-m', 'G');
    const g = f.git('rev-parse', 'HEAD');
    f.git('push', 'origin', 'G');
    f.git('switch', '--detach', f.host.base);
    const path = join(f.host.directory, 'join-live.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    state.prs['106'] = { branch: 'G', base: 'D' };
    state.originalHeads['106'] = g;
    state.evidence += `\nhttps://github.com/rafaeltab/wallpaperdb/pull/106 ${g}`;
    state.blockers = [
      { number: 6, state: 'open' },
      { number: 4, state: 'open' },
    ];
    await writeFile(path, JSON.stringify(state));
    const config = {
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [
        { issue: 6, pr: 106, commit: g },
        { issue: 4, pr: 104, commit: first, reviewedCommit: f.c },
      ],
      joins: {
        directory: join(f.host.directory, 'joins'),
        binary: f.host.binary,
        projectId: 'project-id',
      },
    };
    const second = githubIssues(config);
    if (!second.prepare) throw new Error('Missing second prepare');
    await Effect.runPromise(second.prepare(7));
    const next = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
    if (!next) throw new Error('Missing next head');
    expect(next).not.toBe(first);
    expect(f.git('log', '--format=%s', `${g}..${next}`)).toBe('C');
    const journals = (await readdir(join(f.host.directory, 'joins'))).filter((x) =>
      /^[a-f0-9]{64}$/.test(x)
    );
    expect(journals).toHaveLength(2);
    const live = JSON.parse(await readFile(path, 'utf8'));
    // Conflicting recovered journal facts must never be selected by directory order.
    const records = await Promise.all(
      journals.map(async (key) => ({
        key,
        value: JSON.parse(
          await readFile(join(f.host.directory, 'joins', key, 'intent.json'), 'utf8')
        ),
      }))
    );
    const latest = records.find((r) =>
      r.value.replay.some((r: { next: string }) => r.next === next)
    );
    const older = records.find((r) => r !== latest);
    if (!latest || !older) throw new Error('Missing completed histories');
    if (kind === 'wrong-tree') {
      latest.value.replay.find((r: { issue: number }) => r.issue === 4).tree = 'f'.repeat(40);
      await writeFile(
        join(f.host.directory, 'joins', latest.key, 'intent.json'),
        JSON.stringify(latest.value)
      );
    }
    if (kind === 'ambiguous-review' || kind === 'ambiguous-owner') {
      const replay = { ...latest.value.replay.find((r: { issue: number }) => r.issue === 4) };
      if (kind === 'ambiguous-review') replay.reviewedCommit = f.d;
      else {
        replay.pr = 204;
        replay.url = 'https://github.com/rafaeltab/wallpaperdb/pull/204';
        live.prs['204'] = { ...live.prs['104'] };
      }
      older.value.replay = [replay];
      await writeFile(
        join(f.host.directory, 'joins', older.key, 'intent.json'),
        JSON.stringify(older.value)
      );
      await writeFile(
        join(f.host.directory, 'joins', older.key, `ci-${next}.json`),
        JSON.stringify({ commit: next, tree: replay.tree })
      );
    }

    if (kind === 'rollback') {
      live.prs['104'].base = 'D';
      f.git('push', `--force-with-lease=refs/heads/C:${next}`, 'origin', `${first}:refs/heads/C`);
    }
    if (kind === 'drift') {
      f.git('switch', '--detach', next);
      await writeFile(join(f.host.repository, 'external.txt'), 'external');
      f.git('add', '.');
      f.git('commit', '-m', 'external');
      f.git('push', 'origin', 'HEAD:refs/heads/C');
    }
    if (kind === 'failed-ci') live.newCI = 'FAILURE';
    if (kind === 'corrupt-group') live.groups = [];
    await writeFile(path, JSON.stringify(live));
    const current = githubIssues({ ...config, base: kind === 'changed-pin' ? g : config.base });
    if (kind === 'wrong-tree') {
      await expect(
        Effect.runPromise(
          current.pullRequest({
            id: 'C',
            issue: 4,
            issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
            base: f.host.base,
            prBase: 'A',
            branch: 'C',
            context: '',
            createdAt: 0,
            expectedStage: 'implementation',
          })
        )
      ).rejects.toMatchObject({ _tag: 'Unavailable' });
      return;
    }
    const observed = await Effect.runPromise(
      current.pullRequest({
        id: 'C',
        issue: 4,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
        base: f.host.base,
        prBase: 'A',
        branch: 'C',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation',
      })
    );
    expect(observed).toMatchObject({ kind: 'found', ready: kind === 'valid' });
    if (!['rollback', 'drift', 'ambiguous-review', 'ambiguous-owner'].includes(kind))
      expect(observed).toMatchObject({ commit: next, reviewedCommit: f.c });
    if (kind === 'valid')
      expect(await Effect.runPromise(current.inspect(7))).toMatchObject({
        blockersReady: true,
        prerequisite: { base: next, prBase: 'C' },
      });
  } finally {
    await f.close();
  }
});

it.each([
  { outcome: 'SIMPLE' as const, review: false, ready: true },
  { outcome: 'COMPLEX' as const, review: true, ready: true },
  { outcome: 'COMPLEX' as const, review: true, repair: true, ready: true },
  { outcome: 'SIMPLE' as const, staleRun: true, ready: false },
  { outcome: 'SIMPLE' as const, responseThreadId: 'different-thread', ready: false },
  { outcome: 'COMPLEX' as const, review: false, ready: false },
  { outcome: undefined, review: false, ready: false },
  { outcome: 'SIMPLE' as const, review: false, stale: true, ready: false },
])('recovers a real isolated conflict with bound classification %j', async (scenario) => {
  const f = await fixture({
    conflict: true,
    substantial: scenario.outcome === 'COMPLEX',
    restack: scenario,
  });
  try {
    if (!f.issues.prepare) throw new Error('Missing preparation');
    await Effect.runPromise(f.issues.prepare(5));
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    const ready = await Effect.runPromise(f.reopen().inspect(5));
    expect(ready.blockersReady).toBe(scenario.ready);
    const recovery = await Effect.runPromise(f.issues.recoveries?.() ?? Effect.succeed([]));
    expect(recovery).toEqual([
      expect.objectContaining(
        'responseThreadId' in scenario
          ? { issue: 4, progress: 'Recovery launch pending reconciliation' }
          : { issue: 4, threadId: 'restacker' }
      ),
    ]);
    if (scenario.ready) {
      const head = ready.prerequisite?.base;
      expect(f.git('show', `${head}:shared.txt`)).toContain('resolved');
      expect(f.git('log', '--format=%s', `${f.d}..${head}`)).toBe(
        'repair' in scenario && scenario.repair ? 'Repair C conflict after review\nC' : 'C'
      );
      expect(f.git('rev-list', '--merges', `${f.host.base}..${head}`)).toBe('');
      console.log(
        JSON.stringify({
          classification: scenario.outcome,
          ready: true,
          head,
          provenance:
            'Production Issues/T3/Git adapters, real isolated Git and bare remote; controlled GitHub/T3/model/review/CI protocol. No live project publication.',
        })
      );
    } else expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    const calls = await f.host.calls();
    const launches = calls.filter(
      (call) => call.args[1] === 'start' && call.args.includes('--branch')
    );
    expect(launches).toHaveLength(1);
    expect(launches[0].args.join(' ')).toContain('parent');
    expect(launches[0].args.join(' ')).toContain('/issues/4');
    expect(launches[0].args.join(' ')).toContain('/pull/104');
  } finally {
    await f.close();
  }
});

it('reconciles a lost recovery launch response without a second worker', async () => {
  const f = await fixture({ conflict: true, restack: { outcome: 'SIMPLE', loseLaunch: true } });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await expect(Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void)).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    await Effect.runPromise(f.reopen().reconcile?.() ?? Effect.void);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    expect((await f.host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it('keeps a classified SIMPLE resolution incomplete until CI verifies its published head', async () => {
  const f = await fixture({ conflict: true, ciFails: true, restack: { outcome: 'SIMPLE' } });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    const pending = await Effect.runPromise(f.reopen().inspect(5));
    expect(pending.blockersReady).toBe(false);
    expect(pending.recovery?.classification).toBe('SIMPLE');
    const current = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
    expect(current).not.toBe(f.c);
    const path = join(f.host.directory, 'join-live.json');
    const live = JSON.parse(await readFile(path, 'utf8'));
    live.newCI = 'SUCCESS';
    await writeFile(path, JSON.stringify(live));
    await Effect.runPromise(f.reopen().reconcile?.() ?? Effect.void);
    expect((await Effect.runPromise(f.reopen().inspect(5))).prerequisite?.base).toBe(current);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
  } finally {
    await f.close();
  }
});

it('exposes the current structured T3 question without establishing readiness', async () => {
  const f = await fixture({
    conflict: true,
    restack: { mcp: true, question: 'May I change this requirement?' },
  });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: false,
      recovery: { question: 'May I change this requirement?', threadId: 'restacker' },
    });
    expect(await Effect.runPromise(f.reopen().recoveries?.() ?? Effect.succeed([]))).toEqual([
      expect.objectContaining({ active: false, question: 'May I change this requirement?' }),
    ]);
  } finally {
    await f.close();
  }
});

it.each(['SIMPLE', 'COMPLEX'] as const)(
  'preserves the owning job readiness after verified %s recovery',
  async (classification) => {
    const f = await fixture({ conflict: true, restack: { outcome: classification, review: true } });
    const store = controlledStore();
    const intent = {
      id: 'owner-C',
      issue: 4,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
      base: f.host.base,
      context: '',
      branch: 'C',
      createdAt: 0,
      expectedStage: 'implementation' as const,
      prBase: 'A',
    };
    try {
      await Effect.runPromise(store.reserve(intent));
      for (const [index, stage] of (
        ['implementation', 'review', 'publication', 'ci'] as const
      ).entries())
        await Effect.runPromise(
          store.saveStage({
            index,
            stage,
            threadId: 'owner',
            commit: f.c,
            previousRunId: index === 3 ? 'publication' : 'previous',
          })
        );
      const instance = ManagedRuntime.make(
        JobLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(JobStore, store),
              Layer.succeed(Issues, f.issues),
              Layer.succeed(Time, { now: () => Effect.succeed(1) }),
              Layer.succeed(Execution, {
                launch: () => Effect.succeed({ kind: 'submitted' }),
                sendStage: () => Effect.void,
                interrupt: () => Effect.void,
                observe: () =>
                  Effect.succeed({
                    kind: 'found',
                    threadId: 'owner',
                    status: 'completed',
                    worktree: f.host.repository,
                    branch: 'C',
                    model: 'gpt-6.1-sol',
                  }),
                inspectStage: () =>
                  Effect.succeed({
                    runId: 'publication',
                    ordinal: 3,
                    commit: f.c,
                    accepted: true,
                    linked: ['https://github.com/rafaeltab/wallpaperdb/pull/104'],
                  }),
              })
            )
          )
        )
      );
      const job = await instance.runPromise(Job);
      try {
        expect((await instance.runPromise(job.status())).kind).toBe('job');
        for (let i = 0; i < 3; i++) await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
        const after = await instance.runPromise(job.status());
        if (after.kind !== 'job') throw new Error('Missing owning job');
        expect(after.delivery).toMatchObject({ ready: true, active: false, reviewedCommit: f.c });
        expect((await Effect.runPromise(f.issues.inspect(5))).blockersReady).toBe(true);
      } finally {
        await instance.dispose();
      }
    } finally {
      await f.close();
    }
  }
);

it('resumes a later conflict using the earlier durable replay head across committer-date changes', async () => {
  const f = await fixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
  const previousDate = process.env.GIT_COMMITTER_DATE;
  try {
    f.git('switch', '-c', 'X', 'A');
    await writeFile(join(f.host.repository, 'X.txt'), 'X');
    f.git('add', '.');
    f.git('commit', '-m', 'X');
    const x = f.git('rev-parse', 'HEAD');
    f.git('push', 'origin', 'X');
    f.git('switch', '--detach', f.host.base);
    const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
    config.join.blockers = [
      { number: 3, state: 'open' },
      { number: 6, state: 'open' },
      { number: 4, state: 'open' },
    ];
    config.join.prs['106'] = { branch: 'X', base: 'A' };
    config.join.originalHeads['106'] = x;
    config.join.evidence += `\nhttps://github.com/rafaeltab/wallpaperdb/pull/106 ${x}`;
    await writeFile(f.host.configFile, JSON.stringify(config));
    const reopen = () =>
      githubIssues({
        project: f.host.repository,
        base: f.host.base,
        prerequisites: [
          { issue: 3, pr: 103, commit: f.d },
          { issue: 6, pr: 106, commit: x },
          { issue: 4, pr: 104, commit: f.c },
        ],
        joins: {
          directory: join(f.host.directory, 'joins'),
          binary: f.host.binary,
          projectId: 'project-id',
        },
      });
    process.env.GIT_COMMITTER_DATE = '2026-11-02T00:00:01Z';
    await Effect.runPromise(reopen().prepare?.(5) ?? Effect.void);
    expect((await Effect.runPromise(reopen().inspect(5))).blockersReady).toBe(false);
    process.env.GIT_COMMITTER_DATE = '2026-11-02T00:00:05Z';
    await Effect.runPromise(reopen().prepare?.(5) ?? Effect.void);
    const result = await Effect.runPromise(reopen().inspect(5));
    expect(result.blockersReady).toBe(true);
    expect(f.git('log', '--format=%s', `${f.d}..${result.prerequisite?.base}`)).toBe('C\nX');
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/D').split(/\s/)[0]).toBe(f.d);
  } finally {
    if (previousDate === undefined) delete process.env.GIT_COMMITTER_DATE;
    else process.env.GIT_COMMITTER_DATE = previousDate;
    await f.close();
  }
});

it('resumes a predecessor-format durable conflict record', async () => {
  const f = await fixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    const directory = join(f.host.directory, 'joins');
    const operation = (await readdir(directory)).find((name) => /^[a-f0-9]{64}$/.test(name));
    if (!operation) throw new Error('Missing operation');
    await rename(
      join(directory, operation, 'conflict-4.json'),
      join(directory, operation, 'blocked.json')
    );
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    expect((await f.host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it('passes retained owning scope and its exact thread into the isolated recovery context', async () => {
  const f = await fixture({
    conflict: true,
    context: 'Keep the accepted pixel format; no new test seams.',
    owningThreadId: 'owner-C',
    restack: { outcome: 'SIMPLE' },
  });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    const launch = (await f.host.calls()).find((call) => call.args[1] === 'start');
    expect(launch?.args[3]).toContain('Keep the accepted pixel format; no new test seams.');
    expect(launch?.args[3]).toContain('owner-C');
    expect(launch?.args[3]).toContain('parent');
  } finally {
    await f.close();
  }
});

it('passes only trusted-author comments from the issue, parent and PR into recovery', async () => {
  const f = await fixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
  const comments = (source: string) => [
    { author: { login: 'rafaeltab' }, body: `maintainer-${source}` },
    { author: { login: 'zero-two-rafaeltab' }, body: `agent-${source}` },
    { author: { login: 'outside-contributor' }, body: `untrusted-${source}` },
    { author: null, body: `unknown-author-${source}` },
  ];
  try {
    const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
    config.join.issueComments = { 4: comments('issue'), 571: comments('parent') };
    config.join.prs[104].body = 'Retain the accepted PR behavior';
    config.join.prs[104].comments = comments('pr');
    await f.host.save(config);
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    const launch = (await f.host.calls()).find((call) => call.args[1] === 'start');
    expect(launch).toBeDefined();
    const prompt = launch?.args[3] ?? '';
    for (const source of ['issue', 'parent', 'pr']) {
      expect(prompt).toContain(`maintainer-${source}`);
      expect(prompt).toContain(`agent-${source}`);
      expect(prompt).not.toContain(`untrusted-${source}`);
      expect(prompt).not.toContain(`unknown-author-${source}`);
    }
    expect(prompt).toContain('Retain the accepted PR behavior');
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
  } finally {
    await f.close();
  }
});

it('reconciles the original join request when explicit blockers include a closed issue', async () => {
  const f = await fixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
  try {
    const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
    config.join.blockers = [
      { number: 3, state: 'open' },
      { number: 4, state: 'open' },
      { number: 9, state: 'closed' },
    ];
    const landed = f.git('rev-parse', 'A');
    f.git('push', 'origin', 'A:main');
    config.join.closedIssues = [9];
    config.issueStates = { 9: 'CLOSED' };
    config.defaultBranch = { name: 'main', tip: landed };
    config.landedPrerequisites = { 9: [101] };
    config.mergedPrerequisites = {
      101: {
        merged: true,
        merge_commit_sha: landed,
        head: { sha: landed },
        html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/101',
        base: { ref: 'main', repo: { full_name: 'rafaeltab/wallpaperdb' } },
      },
    };
    config.join.prs[101].state = 'MERGED';
    await f.host.save(config);
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().reconcile?.() ?? Effect.void);
    expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    expect((await f.host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it.each(['unrelated', 'valid', 'missing-object'] as const)(
  'observes a completed clean recovery with %s ancestry through Issues',
  async (kind) => {
    const f = await fixture({ conflict: true, restack: { outcome: 'SIMPLE', question: 'Wait' } });
    try {
      await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
      await Effect.runPromise(f.issues.reconcile?.() ?? Effect.void);
      const path = join(f.host.directory, 'restacker.json');
      const saved = JSON.parse(await readFile(path, 'utf8'));
      if (kind === 'unrelated') {
        f.git('-C', saved.thread.worktreePath, 'reset', '--hard', f.c);
        saved.head = f.c;
      }
      if (kind === 'missing-object') {
        const refs = f.git('rev-parse', '--git-common-dir');
        // Remove the required onto object only in this isolated fixture repository.
        const object = join(f.host.repository, refs, 'objects', f.d.slice(0, 2), f.d.slice(2));
        await unlink(object);
      }
      saved.thread.status = 'completed';
      saved.thread.pendingRequestCount = 0;
      saved.messages = [
        {
          role: 'assistant',
          runId: 'resolve-run',
          text: JSON.stringify({
            operation: saved.operation,
            commit: saved.head,
            outcome: '<RESTACK>SIMPLE</RESTACK>',
          }),
        },
      ];
      await writeFile(path, JSON.stringify(saved));
      const check = Effect.runPromise(f.reopen().reconcile?.() ?? Effect.void);
      if (kind === 'missing-object')
        await expect(check).rejects.toMatchObject({ _tag: 'Unavailable' });
      else {
        await check;
        expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(
          kind === 'valid'
        );
      }
    } finally {
      await f.close();
    }
  }
);
