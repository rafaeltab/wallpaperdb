import { execFileSync } from 'node:child_process';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Job, JobLive, JobStore, Issues, Execution, Time } from '../src/capabilities/job/index.js';
import { fileStore } from '../src/adapters/store/index.js';
import { t3Execution } from '../src/adapters/t3/index.js';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { protocol } from './fixtures/setup.js';

async function fixture(pin = false, retarget = false, multipleClosed = false) {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('branch', 'primary', host.base);
  git('switch', '-c', 'A');
  const commit = async (name: string) => {
    await writeFile(join(host.repository, `${name}.txt`), name);
    git('add', '.');
    git('commit', '-m', name);
    return git('rev-parse', 'HEAD');
  };
  const original = await commit('A');
  git('switch', '-c', 'B');
  const b = await commit('B');
  git('switch', '-c', 'C', original);
  const c = await commit('C');
  git('switch', 'primary');
  const upstream = await commit('upstream');
  if (multipleClosed) git('branch', 'upstream-closed', upstream);
  git('cherry-pick', original);
  if (retarget) {
    await writeFile(join(host.repository, 'A.txt'), 'A landed');
    git('add', '.');
    git('commit', '--amend', '--no-edit');
  }
  const landed = git('rev-parse', 'HEAD');
  expect(landed).not.toBe(original);
  let base = host.base;
  let target = 'primary';
  if (pin) {
    git('switch', '-c', 'operator/base');
    base = await commit('operator');
    target = 'operator/base';
  }
  const origin = join(host.directory, 'origin.git');
  execFileSync('git', ['init', '--bare', origin], { stdio: 'pipe' });
  git('remote', 'add', 'origin', origin);
  git('push', 'origin', 'A', 'B', 'C', 'primary');
  if (pin) git('push', 'origin', 'operator/base');
  if (multipleClosed) git('push', 'origin', 'upstream-closed');
  git('switch', '--detach', host.base);
  const state = {
    evidence: `https://github.com/rafaeltab/wallpaperdb/pull/102 ${b}\nhttps://github.com/rafaeltab/wallpaperdb/pull/103 ${c}`,
    originalHeads: { 101: original, 102: b, 103: c, ...(multipleClosed ? { 199: upstream } : {}) },
    prs: {
      ...(multipleClosed
        ? { 199: { branch: 'upstream-closed', base: 'primary', state: 'MERGED' } }
        : {}),
      101: { branch: 'A', base: 'primary', state: 'MERGED' },
      102: { branch: 'B', base: retarget ? 'primary' : 'A' },
      103: { branch: 'C', base: retarget ? 'primary' : 'A' },
    },
    members: (multipleClosed ? [199, 101, 102] : [101, 102]).map(
      (n) => `https://github.com/rafaeltab/wallpaperdb/pull/${n}`
    ),
    blockers: [
      ...(multipleClosed ? [{ number: 9, state: 'closed' }] : []),
      { number: 1, state: 'closed' },
      { number: 2, state: 'open' },
      { number: 3, state: 'open' },
    ],
    newCI: 'SUCCESS',
  };
  let config = {
    lost: false,
    issueStates: { 1: 'CLOSED', ...(multipleClosed ? { 9: 'CLOSED' } : {}) },
    defaultBranch: { name: 'primary', tip: landed },
    landedPrerequisites: { 1: [101], ...(multipleClosed ? { 9: [199] } : {}) },
    mergedPrerequisites: {
      ...(multipleClosed
        ? {
            199: {
              merged: true,
              merge_commit_sha: upstream,
              head: { sha: upstream },
              html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/199',
              base: { ref: 'primary', repo: { full_name: 'rafaeltab/wallpaperdb' } },
            },
          }
        : {}),
      101: {
        merged: true,
        merge_commit_sha: landed,
        head: { sha: original },
        html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/101',
        base: { ref: 'primary', repo: { full_name: 'rafaeltab/wallpaperdb' } },
      },
    },
    join: state,
  };
  await host.save(config);
  const issues = (selectedBase = base, selectedTarget = target) =>
    githubIssues({
      project: host.repository,
      base: selectedBase,
      prBase: selectedTarget,
      prerequisites: [
        { issue: 2, pr: 102, commit: b },
        { issue: 3, pr: 103, commit: c },
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
    commit,
    base,
    target,
    landed,
    original,
    b,
    c,
    issues,
    get observation() {
      return config;
    },
    mutate: async (patch: Partial<typeof state>) => {
      const path = join(host.directory, 'join-live.json');
      let current = config.join;
      try {
        current = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        current = config.join;
      }
      const next = { ...current, ...patch };
      await writeFile(`${path}.next`, JSON.stringify(next));
      await rename(`${path}.next`, path);
    },
    set: async (patch: Partial<typeof config>) => {
      config = { ...config, ...patch };
      await host.save(config);
    },
    close: async () => {
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    },
  };
}

it.each([false, true])(
  'retains rebased landed A and the operator pin while joining open B/C, pinned=%s',
  async (pin) => {
    const f = await fixture(pin);
    try {
      const issues = f.issues();
      if (!issues.prepare) throw new Error('Missing preparation');
      await Effect.runPromise(issues.prepare(4));
      const ready = await Effect.runPromise(issues.inspect(4));
      expect(ready.blockersReady).toBe(true);
      const head = ready.prerequisite?.base;
      if (!head) throw new Error('Missing joined head');
      expect(f.git('show', `${head}:A.txt`)).toBe('A');
      expect(f.git('show', `${head}:B.txt`)).toBe('B');
      expect(f.git('show', `${head}:C.txt`)).toBe('C');
      expect(f.git('merge-base', '--is-ancestor', f.landed, head)).toBe('');
      expect(f.git('merge-base', '--is-ancestor', f.base, head)).toBe('');
      expect(f.git('log', '--format=%s', `${pin ? f.base : f.landed}..${head}`)).toBe('C\nB');
      expect(() => f.git('merge-base', '--is-ancestor', f.original, head)).toThrow();
      const bhead = f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0];
      if (!bhead) throw new Error('Missing B head');
      expect(f.git('diff', '--name-only', `${pin ? f.base : f.landed}..${bhead}`)).toBe('B.txt');
      expect(f.git('diff', '--name-only', `${bhead}..${head}`)).toBe('C.txt');
      expect(f.git('show', `${head}:upstream.txt`)).toBe('upstream');

      expect(f.git('rev-list', '--merges', `${f.host.base}..${head}`)).toBe('');
      const state = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
      expect(state.prs['102'].base).toBe(f.target);
      expect(state.prs['103'].base).toBe('B');
      expect(state.members).toEqual(
        [101, 102, 103].map((n) => `https://github.com/rafaeltab/wallpaperdb/pull/${n}`)
      );
      if (pin) {
        expect(f.git('show', `${head}:operator.txt`)).toBe('operator');
        const runtime = ManagedRuntime.make(
          JobLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(JobStore, fileStore(join(f.host.directory, 'dependent-state'))),
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
          const started = await runtime.runPromise(
            job.start({
              issue: 4,
              base: head,
              prBase: 'C',
              context: 'Mixed join dependent',
              prerequisiteEvidence: ready.prerequisite?.evidence,
            })
          );
          if (started.kind !== 'job' || started.execution.kind !== 'found')
            throw new Error('Missing dependent worktree');
          expect(started.intent.base).toBe(head);
          expect(started.intent.prBase).toBe('C');
          for (const name of ['A', 'B', 'C', 'operator', 'upstream'])
            expect(await readFile(join(started.execution.worktree, `${name}.txt`), 'utf8')).toBe(
              name
            );
          console.log(
            JSON.stringify({
              demo: 'mixed-join-dependent',
              provenance:
                'Production Issues/Job/store/T3 adapters with real isolated Git/worktrees and a local bare remote. Controlled GitHub/T3/CI protocols, operator acceptance/review assertions; no live model, GitHub fixture writes or project-stack changes.',
              head,
              tree: f.git('rev-parse', `${head}^{tree}`),
              worker: started.execution.worktree,
              target: started.intent.prBase,
            })
          );
        } finally {
          await runtime.dispose();
        }
      }
      console.log(
        JSON.stringify({
          pin,
          head,
          landed: f.landed,
          originalClosedHead: f.original,
          history: f.git('log', '--format=%s', `${pin ? f.base : f.landed}..${head}`),
          targets: state.prs,
        })
      );
    } finally {
      await f.close();
    }
  }
);

it.each([
  'missing-reference',
  'wrong-result',
  'missing-original-head',
  'wrong-original-head',
] as const)('does not publish a mixed join with %s', async (kind) => {
  const f = await fixture();
  try {
    const pr = f.observation.mergedPrerequisites[101];
    await f.set({
      ...f.observation,
      ...(kind === 'missing-reference' ? { landedPrerequisites: { 1: [] } } : {}),
      mergedPrerequisites: {
        101: {
          ...pr,
          ...(kind === 'wrong-result' ? { merge_commit_sha: f.original } : {}),
          ...(kind === 'missing-original-head' ? { head: undefined } : {}),
          ...(kind === 'wrong-original-head' ? { head: { sha: f.host.base } } : {}),
        },
      },
    });
    const issues = f.issues();
    if (!issues.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(issues.prepare(4));
    expect(await Effect.runPromise(issues.inspect(4))).toMatchObject({ blockersReady: false });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0]).toBe(f.b);
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
  } finally {
    await f.close();
  }
});

it('keeps an incompatible operator pin blocked instead of replacing it with landed code', async () => {
  const f = await fixture();
  try {
    f.git('switch', '-c', 'bad-pin', f.host.base);
    const pin = await f.commit('unrelated-operator');
    f.git('push', 'origin', 'bad-pin');
    f.git('switch', '--detach', f.host.base);
    const issues = f.issues(pin, 'bad-pin');
    if (!issues.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(issues.prepare(4));
    expect(await Effect.runPromise(issues.inspect(4))).toMatchObject({ blockersReady: false });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
  } finally {
    await f.close();
  }
});

it.each([false, true])(
  'rechecks landing and pin facts during pending CI and after adapter reopen, pinned=%s',
  async (pin) => {
    const f = await fixture(pin);
    try {
      await f.mutate({ newCI: 'FAILURE' });
      const issues = f.issues();
      if (!issues.prepare) throw new Error('Missing prepare');
      await Effect.runPromise(issues.prepare(4));
      expect(await Effect.runPromise(issues.inspect(4))).toMatchObject({ blockersReady: false });
      if (pin)
        f.git(
          '--git-dir',
          join(f.host.directory, 'origin.git'),
          'update-ref',
          'refs/heads/operator/base',
          f.landed
        );
      else await f.set({ ...f.observation, defaultBranch: { name: 'primary', tip: f.host.base } });
      await f.mutate({ newCI: 'SUCCESS' });
      const reopened = f.issues();
      if (!reopened.reconcile) throw new Error('Missing reconcile');
      await Effect.runPromise(reopened.reconcile());
      expect(await Effect.runPromise(reopened.inspect(4))).toMatchObject({ blockersReady: false });
      const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
      expect(metadata.members).toHaveLength(2);
    } finally {
      await f.close();
    }
  }
);

it('recovers a mixed join after CI without losing its landed boundary or pin', async () => {
  const f = await fixture(true);
  try {
    await f.mutate({ newCI: 'FAILURE' });
    const initial = f.issues();
    if (!initial.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(initial.prepare(4));
    expect(await Effect.runPromise(initial.inspect(4))).toMatchObject({ blockersReady: false });
    await f.mutate({ newCI: 'SUCCESS' });
    const reopened = f.issues();
    if (!reopened.reconcile) throw new Error('Missing reconcile');
    await Effect.runPromise(reopened.reconcile());
    const ready = await Effect.runPromise(reopened.inspect(4));
    expect(ready.blockersReady).toBe(true);
    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing joined head');
    for (const name of ['A', 'B', 'C', 'operator', 'upstream'])
      expect(f.git('show', `${head}:${name}.txt`)).toBe(name);
    expect(f.git('merge-base', '--is-ancestor', f.base, head)).toBe('');
    expect(f.git('merge-base', '--is-ancestor', f.landed, head)).toBe('');
    expect(f.git('log', '--format=%s', `${f.base}..${head}`)).toBe('C\nB');
    const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(metadata.prs['102'].base).toBe('operator/base');
    expect(metadata.prs['103'].base).toBe('B');
    expect(metadata.members).toEqual(
      [101, 102, 103].map((n) => `https://github.com/rafaeltab/wallpaperdb/pull/${n}`)
    );
  } finally {
    await f.close();
  }
});

it('replays a single open suffix over its verified closed landing and containing pin', async () => {
  const f = await fixture(true);
  try {
    await f.mutate({
      blockers: [
        { number: 1, state: 'closed' },
        { number: 2, state: 'open' },
      ],
    });
    const issues = f.issues();
    if (!issues.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(issues.prepare(4));
    const ready = await Effect.runPromise(issues.inspect(4));
    expect(ready.blockersReady).toBe(true);
    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing joined head');
    for (const name of ['A', 'B', 'operator', 'upstream'])
      expect(f.git('show', `${head}:${name}.txt`)).toBe(name);
    expect(f.git('merge-base', '--is-ancestor', f.base, head)).toBe('');
    expect(f.git('merge-base', '--is-ancestor', f.landed, head)).toBe('');
    expect(f.git('log', '--format=%s', `${f.base}..${head}`)).toBe('B');
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(metadata.prs['102'].base).toBe('operator/base');
    expect(metadata.members).toEqual(
      [101, 102].map((n) => `https://github.com/rafaeltab/wallpaperdb/pull/${n}`)
    );
  } finally {
    await f.close();
  }
});

it('keeps missing operator-pin objects visibly unavailable without publishing', async () => {
  const f = await fixture();
  try {
    const issues = f.issues('f'.repeat(40), 'unknown-pin');
    await expect(Effect.runPromise(issues.inspect(4))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0]).toBe(f.b);
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
  } finally {
    await f.close();
  }
});

it('does not replay closed changes when open PR comparisons already target the default landing', async () => {
  const f = await fixture(false, true);
  try {
    const issues = f.issues();
    if (!issues.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(issues.prepare(4));
    const ready = await Effect.runPromise(issues.inspect(4));
    expect(ready.blockersReady).toBe(true);
    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing joined head');
    expect(f.git('show', `${head}:A.txt`)).toBe('A landed');
    for (const name of ['B', 'C', 'upstream'])
      expect(f.git('show', `${head}:${name}.txt`)).toBe(name);
    expect(f.git('log', '--format=%s', `${f.landed}..${head}`)).toBe('C\nB');
    expect(f.git('merge-base', '--is-ancestor', f.landed, head)).toBe('');
    const bhead = f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0];
    if (!bhead) throw new Error('Missing B head');
    expect(f.git('diff', '--name-only', `${f.landed}..${bhead}`)).toBe('B.txt');
    expect(f.git('diff', '--name-only', `${bhead}..${head}`)).toBe('C.txt');
    const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(metadata.prs['102'].base).toBe('primary');
    expect(metadata.prs['103'].base).toBe('B');
  } finally {
    await f.close();
  }
});

it('retains multiple closed native members in ancestry order when the pin already contains them', async () => {
  const f = await fixture(true, false, true);
  try {
    const issues = f.issues();
    if (!issues.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(issues.prepare(4));
    const ready = await Effect.runPromise(issues.inspect(4));
    expect(ready.blockersReady).toBe(true);
    const head = ready.prerequisite?.base;
    if (!head) throw new Error('Missing joined head');
    expect(f.git('merge-base', '--is-ancestor', f.base, head)).toBe('');
    expect(f.git('log', '--format=%s', `${f.base}..${head}`)).toBe('C\nB');
    const metadata = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(metadata.members).toEqual(
      [199, 101, 102, 103].map((n) => `https://github.com/rafaeltab/wallpaperdb/pull/${n}`)
    );
    expect(metadata.prs['199'].base).toBe('primary');
    expect(metadata.prs['101'].base).toBe('primary');
    expect(metadata.prs['102'].base).toBe('operator/base');
    expect(metadata.prs['103'].base).toBe('B');
  } finally {
    await f.close();
  }
});

it.each([
  'valid',
  'missing-proof',
  'wrong-head-proof',
  'closed-unmerged',
  'non-containing-result',
  'failed-ci',
  'corrupt-group',
  'changed-pin',
  'unchanged-target-unproved',
] as const)('validates a landed earlier member of a completed mixed replay: %s', async (kind) => {
  const f = await fixture();
  try {
    const initial = f.issues();
    if (!initial.prepare) throw new Error('Missing prepare');
    await Effect.runPromise(initial.prepare(4));
    const joined = (await Effect.runPromise(initial.inspect(4))).prerequisite?.base;
    if (!joined) throw new Error('Missing completed mixed join');
    const b = f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0];
    if (!b) throw new Error('Missing replayed B');
    const tree = f.git('rev-parse', `${joined}^{tree}`);
    f.git('switch', 'primary');
    f.git('merge', '--ff-only', b);
    let merged = b;
    if (kind === 'non-containing-result') {
      await f.commit('different-result');
      merged = f.git('rev-parse', 'HEAD');
    }
    f.git('push', 'origin', 'primary');
    f.git('switch', '--detach', f.host.base);
    f.git('push', 'origin', '--delete', 'B');
    const path = join(f.host.directory, 'join-live.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    state.prs['102'] = {
      ...state.prs['102'],
      head: b,
      state: kind === 'closed-unmerged' ? 'CLOSED' : 'MERGED',
      base: 'primary',
    };
    state.prs['103'].base = kind === 'unchanged-target-unproved' ? 'B' : 'primary';
    if (kind === 'failed-ci') state.newCI = 'FAILURE';
    if (kind === 'corrupt-group') state.groups = [];
    await writeFile(path, JSON.stringify(state));
    const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
    await f.host.save({
      ...config,
      issueStates: { ...config.issueStates, 2: 'CLOSED' },
      defaultBranch: { name: 'primary', tip: merged },
      landedPrerequisites: {
        ...config.landedPrerequisites,
        2: ['missing-proof', 'unchanged-target-unproved'].includes(kind) ? [] : [102],
      },
      mergedPrerequisites: {
        ...config.mergedPrerequisites,
        102: {
          merged: kind !== 'closed-unmerged',
          merge_commit_sha: merged,
          head: { sha: kind === 'wrong-head-proof' ? f.b : b },
          html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/102',
          base: { ref: 'primary', repo: { full_name: 'rafaeltab/wallpaperdb' } },
        },
      },
    });
    const issues = kind === 'changed-pin' ? f.issues(f.landed) : f.issues();
    const observed = await Effect.runPromise(
      issues.pullRequest({
        id: 'C',
        issue: 3,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/3',
        base: f.host.base,
        prBase: 'A',
        branch: 'C',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation',
      })
    );
    expect(observed).toMatchObject({
      kind: 'found',
      commit: joined,
      reviewedCommit: f.c,
      ready: kind === 'valid',
    });
    expect((await Effect.runPromise(issues.inspect(4))).blockersReady).toBe(kind === 'valid');
    expect(f.git('rev-parse', `${joined}^{tree}`)).toBe(tree);
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/B')).toBe('');
    if (kind === 'valid') {
      expect(f.git('show', `${joined}:A.txt`)).toBe('A');
      expect(f.git('show', `${joined}:B.txt`)).toBe('B');
      expect(f.git('show', `${joined}:C.txt`)).toBe('C');
      expect(f.git('diff', '--name-only', `${merged}..${joined}`)).toBe('C.txt');
      expect(f.git('merge-base', '--is-ancestor', merged, joined)).toBe('');
    }
  } finally {
    await f.close();
  }
});
