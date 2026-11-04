import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  Scheduler,
  SchedulerLive,
  ScheduleStore,
  JobPool,
  Plan,
  PlanningSource,
} from '../src/capabilities/plan/index.js';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
import type { Status } from '../src/capabilities/job/index.js';
import { readFile, writeFile, readdir, rename, unlink, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import {
  Job,
  JobLive,
  JobStore,
  Issues,
  Execution,
  Time,
  ContinuationAdmission,
} from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
import { fileStore } from '../src/adapters/store/index.js';
import { t3Execution, t3Restacker } from '../src/adapters/t3/index.js';
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
  'valid-after-maintenance',
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
    const valid = kind === 'valid' || kind === 'valid-after-maintenance';
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
        landing: { pr: 103, merge: landed, head: f.d },
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
      if (kind === 'valid-after-maintenance') {
        if (!issues.reconcile) throw new Error('Missing maintenance reconciliation');
        await Effect.runPromise(issues.reconcile());
      }
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
      expect(observed).toMatchObject({ kind: 'found', ready: valid });
      if (kind !== 'head-drift')
        expect(observed).toMatchObject({ commit: joined, reviewedCommit: f.c });
      if (valid) {
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
      expect((await Effect.runPromise(issues.inspect(5))).blockersReady).toBe(valid);
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

it.each([
  { name: 'maintainer', author: { login: 'rafaeltab' }, retainBody: true },
  { name: 'agent', author: { login: 'zero-two-rafaeltab' }, retainBody: true },
  { name: 'outside contributor', author: { login: 'outside-contributor' }, retainBody: false },
  { name: 'unknown author', author: null, retainBody: false },
])(
  'passes only trusted-author comments and PR bodies into recovery for $name',
  async ({ author, retainBody }) => {
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
      config.join.issueAuthors = { 4: author, 571: author };
      config.join.issueBodyContext = {
        4: '\nRetain the accepted issue behavior',
        571: '\nRetain the accepted parent behavior',
      };
      config.join.prs[104].body = 'Retain the accepted PR behavior';
      config.join.prs[104].author = author;
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
      expect(prompt.includes('Retain the accepted PR behavior')).toBe(retainBody);
      expect.soft(prompt.includes('Retain the accepted issue behavior')).toBe(retainBody);
      expect.soft(prompt.includes('Retain the accepted parent behavior')).toBe(retainBody);
      expect((await Effect.runPromise(f.reopen().inspect(5))).blockersReady).toBe(true);
    } finally {
      await f.close();
    }
  }
);

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
      if (kind === 'missing-object') {
        await expect(check).rejects.toMatchObject({ _tag: 'Unavailable' });
        const agent = t3Restacker(
          { binary: f.host.binary, project: f.host.repository, projectId: 'project-id' },
          {
            id: saved.operation,
            issue: 4,
            pr: 'https://github.com/rafaeltab/wallpaperdb/pull/104',
            oldHead: f.c,
            parent: f.host.base,
            onto: f.d,
            context: '',
          },
          { read: async () => null, write: async () => false }
        );
        const failure = await Effect.runPromise(Effect.flip(agent.resolve()));
        expect(failure).toMatchObject({ _tag: 'Unavailable', cause: { code: 128 } });
      } else {
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

async function saveLanding(
  f: Pick<Awaited<ReturnType<typeof fixture>>, 'host' | 'git'>,
  patch: object
) {
  const next = { ...JSON.parse(await readFile(f.host.configFile, 'utf8')), ...patch };
  if (next.landing) {
    const merges = {
      101: { merge: next.landing.merge, head: next.landing.head },
      ...next.landing.merges,
    };
    next.landing = { ...next.landing, pr: 101 };
    next.defaultBranch = { name: 'main', tip: f.git('rev-parse', 'main') };
    next.issueStates = { ...next.issueStates };
    next.landedPrerequisites = { ...next.landedPrerequisites };
    next.mergedPrerequisites = { ...next.mergedPrerequisites };
    for (const [key, value] of Object.entries(merges)) {
      const fact = JSON.parse(JSON.stringify(value));
      const number = Number(key);
      const issue = number - 100;
      next.issueStates[issue] = next.landing.issueState ?? 'CLOSED';
      next.landedPrerequisites[issue] = [number];
      next.mergedPrerequisites[key] = {
        merged: true,
        head: { sha: fact.head },
        merge_commit_sha: fact.merge,
        html_url: `https://github.com/rafaeltab/wallpaperdb/pull/${key}`,
        base: { ref: 'main', repo: { full_name: 'rafaeltab/wallpaperdb' } },
      };
    }
  }
  await f.host.save(next);
}
async function landedFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = await fixture(options);
  const { host, git } = f;
  const initial = JSON.parse(await readFile(host.configFile, 'utf8'));
  const a = git('rev-parse', 'A');
  const b = git('rev-parse', 'B');
  git('switch', 'main');
  await writeFile(join(host.repository, 'unrelated.txt'), 'default advance');
  git('add', '.');
  git('commit', '-m', 'unrelated');
  git('cherry-pick', a);
  const merged = git('rev-parse', 'HEAD');
  git('push', 'origin', 'main');
  git('switch', '--detach', host.base);
  const joinState = {
    ...initial.join,
    prs: { ...initial.join.prs, 101: { branch: 'A', base: 'main', state: 'MERGED' } },
  };
  await saveLanding(f, {
    join: joinState,
    landing: { merge: merged, head: a },
    restack: options.restack,
    joinWriter: options.writer,
  });
  const config = {
    project: host.repository,
    base: host.base,
    prerequisites: [
      { issue: 1, pr: 101, commit: a, parent: host.base },
      { issue: 2, pr: 102, commit: b, parent: a },
      { issue: 3, pr: 103, commit: f.d, parent: b },
      { issue: 4, pr: 104, commit: f.c, parent: a },
    ],
    joins: {
      directory: join(host.directory, 'joins'),
      binary: host.binary,
      projectId: 'project-id',
    },
  };
  return { ...f, a, b, merged, config, issues: githubIssues(config), joinState, initial };
}
it('maintains issue-only descendants after a rebase merge without replaying landed A', async () => {
  const f = await landedFixture();
  const { host, git, merged } = f;
  try {
    if (!f.issues.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(f.issues.reconcile());
    const head = git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
    expect(git('log', '--format=%s', `${merged}..${head}`)).toBe('C\nD\nB');
    expect(git('ls-tree', '--name-only', head)).toBe('A.txt\nB.txt\nC.txt\nD.txt\nunrelated.txt');
    expect(git('rev-list', '--merges', `${host.base}..${head}`)).toBe('');
    expect(git('rev-parse', 'A')).toBe(f.a);
    const live = JSON.parse(await readFile(join(host.directory, 'join-live.json'), 'utf8'));
    expect(live.prs['102'].base).toBe('main');
    expect(live.prs['103'].base).toBe('B');
    expect(live.prs['104'].base).toBe('D');
    expect(live.members).toEqual(
      [102, 103, 104].map((number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`)
    );
    const reopened = githubIssues(f.config);
    if (!reopened.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(reopened.reconcile());
    expect(git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(head);
    console.log(
      JSON.stringify({
        provenance:
          'Production Issues reconciliation, real isolated Git/worktrees/bare remote and durable operation files. Controlled authenticated GitHub/T3/CI protocols; acceptance and original reviews are operator assertions. No live model or real repository writes.',
        landed: merged,
        downstream: head,
        history: git('log', '--format=%s', `${merged}..${head}`),
        prBases: ['main', 'B', 'D'],
        nativeMembers: [102, 103, 104],
      })
    );
  } finally {
    await f.close();
  }
});
it.each(['closed', 'divergent'] as const)(
  'preserves a %s descendant and reports manual recovery after landing',
  async (kind) => {
    const f = await landedFixture();
    try {
      if (kind === 'closed') Object.assign(f.joinState.prs[104], { state: 'CLOSED' });
      else f.git('push', '--force', 'origin', `${f.d}:refs/heads/C`);
      await saveLanding(f, { join: f.joinState, landing: { merge: f.merged, head: f.a } });
      if (!f.issues.reconcile || !f.issues.recoveries) throw new Error('Missing reconciliation');
      await Effect.runPromise(f.issues.reconcile());
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0]).toBe(f.b);
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(
        kind === 'closed' ? f.c : f.d
      );
      expect(await Effect.runPromise(f.issues.recoveries())).toContainEqual(
        expect.objectContaining({
          issue: 4,
          active: false,
          progress: expect.stringContaining('manual recovery'),
        })
      );
      expect(
        (await f.host.calls()).filter((call) => call.args[0] === 'pr' && call.args[1] === 'edit')
      ).toHaveLength(0);
    } finally {
      await f.close();
    }
  }
);
it.each(['CI', 'writer'] as const)(
  'keeps landing maintenance incomplete while %s is pending',
  async (kind) => {
    const f = await landedFixture(kind === 'CI' ? { ciFails: true } : { writer: true });
    try {
      if (!f.issues.reconcile) throw new Error('Missing reconciliation');
      await Effect.runPromise(f.issues.reconcile());
      const intent = {
        id: 'B',
        issue: 2,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
        branch: 'B',
        base: f.a,
        prBase: 'A',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      expect(await Effect.runPromise(f.issues.pullRequest(intent))).not.toMatchObject({
        reviewedCommit: f.b,
        ready: true,
      });
      if (kind === 'writer')
        expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0]).toBe(f.b);
    } finally {
      await f.close();
    }
  }
);
it.each(['SIMPLE', 'COMPLEX'] as const)(
  'maintains landed stacks through %s conflict recovery and current CI',
  async (outcome) => {
    const f = await landedFixture({ conflict: true, restack: { outcome, review: true } });
    try {
      if (!f.issues.reconcile) throw new Error('Missing reconciliation');
      await Effect.runPromise(f.issues.reconcile());
      await Effect.runPromise(f.issues.reconcile());
      expect(await Effect.runPromise(f.issues.recoveries?.() ?? Effect.succeed([]))).toContainEqual(
        expect.objectContaining({
          classification: outcome,
          active: false,
          progress: 'Verified; downstream readiness may proceed',
        })
      );
      const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
      expect(f.git('rev-list', '--merges', `${f.merged}..${head}`)).toBe('');
      expect(f.git('log', '--format=%s', `${f.merged}..${head}`)).toBe('C\nD\nB');
    } finally {
      await f.close();
    }
  }
);

it('reserves the released recovery slot before a COMPLEX review send alongside unrelated work', async () => {
  const f = await fixture({
    conflict: true,
    restack: { outcome: 'COMPLEX', review: true, question: 'Wait' },
  });
  const store = controlledScheduleStore();
  let unrelated: Status = { kind: 'empty' };
  const pool: JobPool = {
    job: () =>
      Effect.succeed({
        status: () => Effect.succeed(unrelated),
        start: (command) =>
          Effect.sync(() => {
            unrelated = {
              kind: 'job',
              intent: {
                ...command,
                id: 'unrelated',
                issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/99',
                branch: 'unrelated',
                createdAt: 0,
                expectedStage: 'implementation',
              },
              elapsedMs: 0,
              execution: { kind: 'absent' },
            };
            return unrelated;
          }),
        resume: () => Effect.succeed({ kind: 'rejected' as const }),
        cancel: () => Effect.succeed({ kind: 'rejected' as const }),
      }),
  };
  const issues: Issues = {
    ...f.issues,
    inspect: (number) =>
      number === 99
        ? Effect.succeed({
            open: true,
            author: 'rafaeltab',
            labels: ['ready-for-agent'],
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/99',
            blockers: [],
            blockersReady: true,
          })
        : f.issues.inspect(number),
  };
  const input = () => ({
    issues: [],
    job: { kind: 'empty' as const },
    scheduleRevision: Effect.runSync(store.read()).revision,
    admissions: [],
    paused: false,
    capacity: { concurrency: 1, admission: -1 },
  });
  const runtime = ManagedRuntime.make(
    SchedulerLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ScheduleStore, store),
          Layer.succeed(JobPool, pool),
          Layer.succeed(Issues, issues),
          Layer.succeed(Plan, {
            preview: () =>
              Effect.succeed({ kind: 'stale', selected: [], rejected: [], input: input() }),
          }),
          Layer.succeed(PlanningSource, {
            read: () =>
              Effect.sync(() => {
                expect(unrelated.kind === 'job' && unrelated.delivery?.ready).toBe(true);
                return input();
              }),
          })
        )
      )
    )
  );
  try {
    await Effect.runPromise(
      store.save({ revision: 0, concurrency: 1, allowance: -1, paused: false, admissions: [] })
    );
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.issues.reconcile?.() ?? Effect.void);
    expect(await Effect.runPromise(f.issues.recoveries?.() ?? Effect.succeed([]))).toEqual([
      expect.objectContaining({ active: false }),
    ]);
    const scheduler = await runtime.runPromise(Scheduler);
    expect(
      (await runtime.runPromise(scheduler.start({ issue: 99, base: f.host.base, context: '' })))
        .kind
    ).toBe('job');
    const path = join(f.host.directory, 'restacker.json');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    saved.thread.status = 'completed';
    saved.thread.pendingRequestCount = 0;
    saved.messages = [
      {
        role: 'assistant',
        runId: 'resolve-run',
        text: JSON.stringify({
          operation: saved.operation,
          commit: saved.head,
          outcome: '<RESTACK>COMPLEX</RESTACK>',
        }),
      },
    ];
    await writeFile(path, JSON.stringify(saved));
    await runtime.runPromise(scheduler.tick(f.host.base));
    expect((await f.host.calls()).filter((call) => call.args[1] === 'send')).toHaveLength(0);
    const root = join(f.host.directory, 'joins');
    const operation = (await readdir(root)).find((name) => /^[a-f0-9]{64}$/.test(name));
    if (!operation) throw new Error('Missing operation');
    const claims = await readdir(join(root, operation, 'recovery'));
    const reviewClaim = join(root, operation, 'recovery', claims[0], 'review-delivery.json');
    await expect(readFile(reviewClaim)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await runtime.runPromise(scheduler.status())).recoveries).toEqual([
      expect.objectContaining({ active: false }),
    ]);
    const current = await Effect.runPromise(
      pool.job(99).pipe(Effect.flatMap((job) => job.status()))
    );
    if (current.kind !== 'job') throw new Error('Missing admitted job');
    unrelated = {
      ...current,
      delivery: { stage: 'publication', commit: f.host.base, ready: true, landed: false },
    };
    await runtime.runPromise(scheduler.tick(f.host.base));
    expect((await f.host.calls()).filter((call) => call.args[1] === 'send')).toHaveLength(1);
    expect(JSON.parse(await readFile(reviewClaim, 'utf8')).commit).toBe(saved.head);
    expect(
      JSON.parse(await readFile(join(f.host.directory, 'review-capacity-observed.json'), 'utf8'))
    ).toContainEqual(
      expect.objectContaining({
        issue: 4,
        active: true,
        progress: 'Independent review capacity reserved',
      })
    );
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

it('removes every already-landed layer when several rebase merges precede observation', async () => {
  const f = await landedFixture();
  try {
    f.git('switch', 'main');
    f.git('cherry-pick', f.b);
    const mergedB = f.git('rev-parse', 'HEAD');
    f.git('push', 'origin', 'main');
    f.git('switch', '--detach', f.host.base);
    Object.assign(f.joinState.prs[102], { base: 'main', state: 'MERGED' });
    await saveLanding(f, {
      join: f.joinState,
      landing: { merge: f.merged, head: f.a, merges: { 102: { merge: mergedB, head: f.b } } },
    });
    if (!f.issues.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(f.issues.reconcile());
    const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
    expect(f.git('log', '--format=%s', `${mergedB}..${head}`)).toBe('C\nD');
    const live = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(live.members).toEqual(
      [103, 104].map((number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`)
    );
    expect(live.prs[103].base).toBe('main');
  } finally {
    await f.close();
  }
});
it('retargets the final PR to default with its pinned boundary and dissolves its native stack', async () => {
  const f = await landedFixture({ cCommits: 2 });
  try {
    f.joinState.prs[104].base = 'main';
    f.joinState.members = [101, 104].map(
      (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
    );
    await saveLanding(f, { join: f.joinState, landing: { merge: f.merged, head: f.a } });
    const issues = githubIssues({
      ...f.config,
      prerequisites: f.config.prerequisites.filter((item) => [1, 4].includes(item.issue)),
    });
    if (!issues.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(issues.reconcile());
    const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
    expect(f.git('log', '--format=%s', `${f.merged}..${head}`)).toBe('C2\nC');
    const state = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(state.prs[104].base).toBe('main');
    expect(state.members).toEqual([]);
  } finally {
    await f.close();
  }
});
it('keeps missing closing-link automation pending after retargeting to default', async () => {
  const f = await landedFixture();
  try {
    await saveLanding(f, {
      join: f.joinState,
      landing: { merge: f.merged, head: f.a },
      missingClosingLink: true,
    });
    if (!f.issues.reconcile || !f.issues.recoveries) throw new Error('Missing reconciliation');
    await Effect.runPromise(f.issues.reconcile());
    expect(await Effect.runPromise(f.issues.recoveries())).toContainEqual(
      expect.objectContaining({
        issue: 2,
        active: false,
        progress: expect.stringContaining('linked closing issue'),
      })
    );
    expect(
      await readdir(join(f.host.directory, 'joins')).then(async (keys) =>
        Promise.all(
          keys
            .filter((key) => /^[a-f0-9]{64}$/.test(key))
            .map((key) => readdir(join(f.host.directory, 'joins', key)))
        )
      )
    ).not.toContainEqual(expect.arrayContaining(['complete.json']));
  } finally {
    await f.close();
  }
});
it('reconciles a lost retarget response from durable landing intent after reopening', async () => {
  const f = await landedFixture({ lose: 'base' });
  try {
    if (!f.issues.reconcile) throw new Error('Missing reconciliation');
    await expect(Effect.runPromise(f.issues.reconcile())).rejects.toMatchObject({
      operation: 'reconcile-prerequisite-joins',
    });
    const reopened = githubIssues(f.config);
    if (!reopened.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(reopened.reconcile());
    const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
    expect(f.git('log', '--format=%s', `${f.merged}..${head}`)).toBe('C\nD\nB');
    const live = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
    expect(live.prs[102].base).toBe('main');
    expect(live.members).toEqual(
      [102, 103, 104].map((number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`)
    );
  } finally {
    await f.close();
  }
});
it.each([false, true])(
  'retains issue boundaries and original review through successive default landings with pending CI %s',
  async (pendingCI) => {
    const f = await landedFixture();
    const intent = (issue: number, branch: string, base: string, prBase: string) => ({
      id: branch,
      issue,
      issueUrl: `https://github.com/rafaeltab/wallpaperdb/issues/${issue}`,
      branch,
      base,
      prBase,
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    });
    try {
      if (!f.issues.reconcile) throw new Error('Missing reconciliation');
      const owning = join(f.host.directory, 'owning-C-successive');
      if (!pendingCI) f.git('worktree', 'add', owning, 'C');
      await Effect.runPromise(f.issues.reconcile());
      const assertions: import('../src/adapters/github/index.js').VerifiedPrerequisite[] =
        f.config.prerequisites.slice(0, 1);
      for (const command of [
        intent(2, 'B', f.a, 'A'),
        intent(3, 'D', f.b, 'B'),
        intent(4, 'C', f.a, 'A'),
      ]) {
        const observed = await Effect.runPromise(f.issues.pullRequest(command));
        if (observed.kind !== 'found' || !observed.parent)
          throw new Error('Missing replay association');
        assertions.push({
          issue: command.issue,
          pr: command.issue + 100,
          commit: observed.commit,
          parent: observed.parent,
          reviewedCommit: observed.reviewedCommit,
          prBase: observed.base,
          branch: command.branch,
        });
      }
      const b = assertions.find((item) => item.issue === 2);
      if (!b) throw new Error('Missing B');
      f.git('switch', 'main');
      await writeFile(join(f.host.repository, 'next.txt'), 'next default advance');
      f.git('add', '.');
      f.git('commit', '-m', 'next');
      f.git('cherry-pick', b.commit);
      const mergedB = f.git('rev-parse', 'HEAD');
      f.git('push', 'origin', 'main');
      f.git('switch', '--detach', f.host.base);
      const live = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
      Object.assign(live.prs[102], { base: 'main', state: 'MERGED' });
      live.prs[103].base = 'main';
      if (pendingCI) live.newCI = 'FAILURE';
      await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(live));
      await saveLanding(f, {
        join: live,
        landing: {
          merge: f.merged,
          head: f.a,
          merges: { 102: { merge: mergedB, head: b.commit } },
        },
      });
      const current = githubIssues({ ...f.config, prerequisites: assertions });
      if (!current.reconcile) throw new Error('Missing reconciliation');
      expect(await Effect.runPromise(current.recoveries?.() ?? Effect.succeed([]))).toEqual([]);
      expect(await Effect.runPromise(current.pullRequest(intent(3, 'D', f.b, 'B')))).toMatchObject({
        ready: false,
        maintenancePending: true,
        manualRecovery: false,
      });
      await Effect.runPromise(current.reconcile());
      if (pendingCI) {
        expect(
          await Effect.runPromise(current.pullRequest(intent(3, 'D', f.b, 'B')))
        ).toMatchObject({ ready: false, maintenancePending: true, manualRecovery: false });
        expect(await Effect.runPromise(current.recoveries?.() ?? Effect.succeed([]))).toEqual([]);
        const pending = JSON.parse(
          await readFile(join(f.host.directory, 'join-live.json'), 'utf8')
        );
        pending.newCI = 'SUCCESS';
        await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(pending));
        await Effect.runPromise(current.reconcile());
      }
      const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
      expect(f.git('log', '--format=%s', `${mergedB}..${head}`)).toBe('C\nD');
      if (!pendingCI) {
        const command = intent(4, 'C', f.a, 'A');
        const failed = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
        failed.newCI = 'FAILURE';
        await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(failed));
        const observed = await Effect.runPromise(current.pullRequest(command));
        if (
          observed.kind !== 'found' ||
          !observed.parent ||
          !observed.base ||
          !observed.previousHead
        )
          throw new Error('Missing current comparison');
        expect(await Effect.runPromise(current.repairReplay!(command, head))).toBe(true);
        const execution = t3Execution({
          project: f.host.repository,
          projectId: 'project-id',
          binary: f.host.binary,
        });
        const store = fileStore(join(f.host.directory, 'successive-stage'));
        await Effect.runPromise(
          store.saveStage({
            index: 3,
            stage: 'babysitting',
            threadId: 'owner-C',
            commit: head,
            previousRunId: 'published',
            ordinal: 4,
            comparison: {
              base: observed.parent,
              prBase: observed.base,
              previousHead: observed.previousHead,
              owningHeads: observed.owningHeads,
            },
          })
        );
        const request = await Effect.runPromise(store.readStage(3));
        if (!request) throw new Error('Missing durable request');
        if (!request.comparison) throw new Error('Missing persisted comparison');
        await expect(
          Effect.runPromise(
            store.saveStage({
              ...request,
              index: 4,
              comparison: { ...request.comparison, owningHeads: ['not-a-sha'] },
            })
          )
        ).rejects.toMatchObject({ _tag: 'Unavailable' });
        expect(await Effect.runPromise(store.claimStage(3))).toBe(true);
        expect(await Effect.runPromise(store.claimStage(3))).toBe(false);
        const resource = {
          threadId: 'owner-C',
          title: 'Factory C',
          projectId: 'project-id',
          providerInstanceId: 'codex',
          model: 'gpt-6.1-sol',
          branch: 'C',
          worktreePath: owning,
          status: 'completed',
          latestRunId: 'published',
          runCount: 3,
          pendingRequestCount: 0,
        };
        const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
        await f.host.save({ ...config, joinWriter: false });
        const git = (...args: string[]) =>
          execFileSync('git', ['-C', owning, ...args], { encoding: 'utf8' }).trim();
        const prior = assertions.find((a) => a.issue === 4)?.commit;
        if (!prior) throw new Error('Missing earlier replay');
        for (const [candidate, allowed, dirty] of [
          [f.a, false, false],
          [f.c, false, true],
          [f.c, true, false],
          [prior, true, false],
        ] as const) {
          git('reset', '--hard', candidate);
          if (dirty) await writeFile(join(owning, 'dirty.txt'), 'dirty');
          await writeFile(join(f.host.directory, 'resource.json'), JSON.stringify(resource));
          if (allowed) {
            expect(await Effect.runPromise(execution.observe(command, request))).toMatchObject({
              kind: 'found',
            });
            if (candidate === prior)
              await expect(Effect.runPromise(execution.observe(command))).rejects.toMatchObject({
                _tag: 'Unavailable',
              });
            await Effect.runPromise(execution.sendStage(command, request));
            expect(
              (await Effect.runPromise(execution.inspectStage(command, request)))?.accepted
            ).not.toBe(true);
          } else
            await expect(
              Effect.runPromise(execution.sendStage(command, request))
            ).rejects.toMatchObject({ _tag: 'Unavailable' });
          if (dirty) await unlink(join(owning, 'dirty.txt'));
        }
        expect(
          (await f.host.calls()).filter((c) => c.args[1] === 'send' && !c.args.includes('--help'))
        ).toHaveLength(2);
      }

      expect(await Effect.runPromise(current.pullRequest(intent(2, 'B', f.a, 'A')))).toMatchObject({
        landed: true,
        reviewedCommit: f.b,
        commit: b.commit,
      });
    } finally {
      await f.close();
    }
  }
);
it.each(['valid', 'conflicting', 'retired-target'] as const)(
  'retains equivalent same-head certificates after a fast-forward landing, case=%s',
  async (kind) => {
    const conflicting = kind === 'conflicting';
    const f = await landedFixture();
    const command = (issue: number, branch: string, base: string, prBase: string) => ({
      id: branch,
      issue,
      issueUrl: `https://github.com/rafaeltab/wallpaperdb/issues/${issue}`,
      branch,
      base,
      prBase,
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    });
    try {
      if (!f.issues.reconcile) throw new Error('Missing reconciliation');
      await Effect.runPromise(f.issues.reconcile());
      const assertions: import('../src/adapters/github/index.js').VerifiedPrerequisite[] =
        f.config.prerequisites.slice(0, 1);
      for (const intent of [
        command(2, 'B', f.a, 'A'),
        command(3, 'D', f.b, 'B'),
        command(4, 'C', f.a, 'A'),
      ]) {
        const observed = await Effect.runPromise(f.issues.pullRequest(intent));
        if (observed.kind !== 'found' || !observed.parent)
          throw new Error('Missing initial replay');
        assertions.push({
          issue: intent.issue,
          pr: intent.issue + 100,
          commit: observed.commit,
          parent: observed.parent,
          reviewedCommit: observed.reviewedCommit,
          prBase: observed.base,
          branch: intent.branch,
        });
      }
      const b = assertions.find((item) => item.issue === 2);
      const c = assertions.find((item) => item.issue === 4);
      if (!b || !c) throw new Error('Missing replay assertions');
      f.git('switch', 'main');
      f.git('merge', '--ff-only', b.commit);
      f.git('push', 'origin', 'main');
      f.git('switch', '--detach', f.host.base);
      f.git('push', 'origin', '--delete', 'B');
      const path = join(f.host.directory, 'join-live.json');
      const live = JSON.parse(await readFile(path, 'utf8'));
      Object.assign(live.prs[102], { base: 'main', state: 'MERGED', head: b.commit });
      live.prs[103].base = 'main';
      await writeFile(path, JSON.stringify(live));
      await saveLanding(f, {
        join: live,
        landing: {
          merge: f.merged,
          head: f.a,
          merges: { 102: { merge: b.commit, head: b.commit } },
        },
      });
      const current = githubIssues({ ...f.config, prerequisites: assertions });
      if (!current.reconcile) throw new Error('Missing current reconciliation');
      await Effect.runPromise(current.reconcile());
      if (kind === 'retired-target') {
        const d = assertions.find((item) => item.issue === 3);
        if (!d) throw new Error('Missing D replay');
        f.git('switch', 'main');
        f.git('merge', '--ff-only', d.commit);
        f.git('push', 'origin', 'main');
        f.git('switch', '--detach', f.host.base);
        f.git('push', 'origin', '--delete', 'D');
        const state = JSON.parse(await readFile(path, 'utf8'));
        Object.assign(state.prs[103], { base: 'main', state: 'MERGED', head: d.commit });
        state.prs[104].base = 'main';
        await writeFile(path, JSON.stringify(state));
        await saveLanding(f, {
          join: state,
          landing: {
            merge: f.merged,
            head: f.a,
            merges: {
              102: { merge: b.commit, head: b.commit },
              103: { merge: d.commit, head: d.commit },
            },
          },
        });
        await Effect.runPromise(current.reconcile());
      }
      if (conflicting) {
        const root = join(f.host.directory, 'joins');
        for (const key of await readdir(root)) {
          if (!/^[a-f0-9]{64}$/.test(key)) continue;
          const path = join(root, key, 'intent.json');
          const saved = JSON.parse(await readFile(path, 'utf8'));
          if (!saved.members.includes(102)) continue;
          const replay = saved.replay.find((item: { issue: number }) => item.issue === 4);
          replay.reviewedCommit = f.b;
          await writeFile(path, JSON.stringify(saved));
        }
      }
      const observed = await Effect.runPromise(current.pullRequest(command(4, 'C', f.a, 'A')));
      expect(observed).toMatchObject({ ready: !conflicting, commit: c.commit });
      if (!conflicting) expect(observed).toMatchObject({ reviewedCommit: f.c });
      const recoveries = await Effect.runPromise(current.recoveries!());
      if (conflicting)
        expect(recoveries).toContainEqual(
          expect.objectContaining({
            issue: 4,
            active: false,
            progress: 'Replay association is uncertain; manual recovery required',
          })
        );
      else
        expect(recoveries).not.toContainEqual(
          expect.objectContaining({
            issue: 4,
            progress: expect.stringContaining('manual recovery'),
          })
        );
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(c.commit);
      const after = JSON.parse(await readFile(path, 'utf8'));
      expect(after.members).toEqual(
        [103, 104].map((number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`)
      );
    } finally {
      await f.close();
    }
  }
);

it('surfaces a concurrent expected-head lease conflict during landing maintenance without overwriting the external tip', async () => {
  const f = await landedFixture();
  try {
    const hook = join(f.host.repository, '.git', 'hooks', 'pre-push');
    await writeFile(
      hook,
      `#!/bin/sh
while read local_ref local_sha remote_ref remote_sha; do
 if [ "$remote_ref" = "refs/heads/C" ]; then
  git --git-dir='${join(f.host.directory, 'remote.git')}' update-ref refs/heads/C ${f.d}
 fi
done
`
    );
    await chmod(hook, 0o700);
    if (!f.issues.reconcile || !f.issues.recoveries) throw new Error('Missing reconciliation');
    await expect(Effect.runPromise(f.issues.reconcile())).rejects.toMatchObject({
      operation: 'reconcile-prerequisite-joins',
    });
    const reopened = githubIssues({ ...f.config, prerequisites: [] });
    if (!reopened.reconcile || !reopened.recoveries) throw new Error('Missing reconciliation');
    await Effect.runPromise(reopened.reconcile());
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.d);
    expect(await Effect.runPromise(reopened.recoveries())).toContainEqual(
      expect.objectContaining({ active: false, progress: expect.stringContaining('head-conflict') })
    );
  } finally {
    await f.close();
  }
});
it('bounds landing facts to the affected family despite retained unrelated landings', async () => {
  const f = await landedFixture();
  try {
    const history = f.git('rev-parse', 'main^');
    f.git('branch', 'history', history);
    f.git('push', 'origin', 'history');
    const prerequisites = [...f.config.prerequisites];
    const prs = { ...f.joinState.prs };
    const merges: Record<number, { merge: string; head: string }> = {};
    for (let index = 0; index < 101; index++) {
      const issue = 200 + index;
      const pr = 100 + issue;
      prerequisites.push({ issue, pr, commit: history, parent: f.host.base });
      prs[pr] = { branch: 'history', base: 'main', state: 'MERGED' };
      merges[pr] = { merge: history, head: history };
    }
    await saveLanding(f, {
      join: { ...f.joinState, prs },
      landing: { merge: f.merged, head: f.a, merges },
    });
    const config = { ...f.config, prerequisites };
    for (let i = 0; i < 2; i++) {
      const issues = githubIssues(config);
      await Effect.runPromise(issues.reconcile!());
      expect(
        await Effect.runPromise(
          issues.pullRequest({
            id: 'C-history',
            issue: 4,
            issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
            base: f.host.base,
            branch: 'C',
            context: '',
            createdAt: 0,
            expectedStage: 'implementation',
          })
        )
      ).toMatchObject({ ready: true, reviewedCommit: f.c });
    }
    const root = join(f.host.directory, 'joins');
    const key = (await readdir(root)).find((name) => /^[a-f0-9]{64}$/.test(name));
    if (!key) throw new Error('Missing maintenance boundary');
    const boundary = JSON.parse(await readFile(join(root, key, 'boundary.json'), 'utf8'));
    expect(boundary.pin).toBe(f.host.base);
    expect(boundary.landed.map((fact: { issue: number }) => fact.issue)).toEqual([1]);
  } finally {
    await f.close();
  }
});

it('parks an oversized affected family without blocking reconciliation of retained publications', async () => {
  const f = await landedFixture();
  try {
    const prerequisites: import('../src/adapters/github/index.js').VerifiedPrerequisite[] = [
      ...f.config.prerequisites,
    ];
    const prs: Record<string, { branch: string; base: string; state?: string }> = {
      ...f.joinState.prs,
    };
    const branches: string[] = [];
    let parent = f.c;
    let previousBranch = 'C';
    for (let index = 0; index < 97; index++) {
      const branch = `extra-${index}`;
      f.git('switch', '-c', branch, parent);
      await writeFile(join(f.host.repository, 'extra.txt'), String(index));
      f.git('add', '.');
      f.git('commit', '-m', branch);
      const head = f.git('rev-parse', 'HEAD');
      prerequisites.push({ issue: 200 + index, pr: 300 + index, commit: head, parent });
      prs[String(300 + index)] = { branch, base: previousBranch };
      branches.push(branch);
      previousBranch = branch;
      parent = head;
    }
    f.git('push', 'origin', ...branches);
    f.git('switch', '--detach', f.host.base);
    await saveLanding(f, {
      join: { ...f.joinState, prs },
      landing: { merge: f.merged, head: f.a },
    });
    const config = { ...f.config, prerequisites };
    for (const issues of [githubIssues(config), githubIssues(config)]) {
      if (!issues.reconcile || !issues.recoveries) throw new Error('Missing reconciliation');
      await Effect.runPromise(issues.reconcile());
      expect(await Effect.runPromise(issues.recoveries())).toContainEqual(
        expect.objectContaining({
          active: false,
          progress: expect.stringContaining('100-layer maintenance limit'),
        })
      );
    }
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(f.c);
    expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/extra-96').split(/\s/)[0]).toBe(
      parent
    );
    expect(
      (await f.host.calls()).filter((call) => call.args[0] === 'pr' && call.args[1] === 'edit')
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});
it.each(['closed', 'head', 'base', 'base-default', 'base-default-parents'] as const)(
  'surfaces post-maintenance %s changes while retaining healthy issue review associations',
  async (kind) => {
    const f = await landedFixture();
    const intent = (issue: number, branch: string, base: string, prBase: string) => ({
      id: branch,
      issue,
      issueUrl: `https://github.com/rafaeltab/wallpaperdb/issues/${issue}`,
      branch,
      base,
      prBase,
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    });
    const bIntent = intent(2, 'B', f.a, 'A');
    const dIntent = intent(3, 'D', f.b, 'B');
    const cIntent = intent(4, 'C', f.a, 'A');
    const commands = [bIntent, dIntent, cIntent];
    try {
      if (!f.issues.reconcile) throw new Error('Missing reconciliation');
      await Effect.runPromise(f.issues.reconcile());
      const assertions: import('../src/adapters/github/index.js').VerifiedPrerequisite[] =
        f.config.prerequisites.slice(0, 1);
      const observed = [];
      for (const command of commands) {
        const pr = await Effect.runPromise(f.issues.pullRequest(command));
        if (pr.kind !== 'found') throw new Error('Missing maintained publication');
        expect(pr.ready).toBe(true);
        observed.push(pr);
        assertions.push({
          issue: command.issue,
          pr: command.issue + 100,
          commit: pr.commit,
          reviewedCommit: pr.reviewedCommit,
          parent: pr.parent,
          prBase: pr.base,
          branch: command.branch,
        });
      }
      const live = JSON.parse(await readFile(join(f.host.directory, 'join-live.json'), 'utf8'));
      if (kind === 'closed') live.prs[104].state = 'CLOSED';
      if (kind === 'base') live.prs[104].base = 'A';
      if (kind.startsWith('base-default')) live.prs[104].base = 'main';
      if (kind === 'head') f.git('push', '--force', 'origin', `${f.d}:refs/heads/C`);
      await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(live));
      const issues = githubIssues({ ...f.config, prerequisites: assertions });
      if (!issues.reconcile || !issues.recoveries) throw new Error('Missing reconciliation');
      const before = (await f.host.calls()).filter(
        (call) => call.args[0] === 'pr' && call.args[1] === 'edit'
      ).length;
      await Effect.runPromise(issues.reconcile());
      expect(await Effect.runPromise(issues.pullRequest(bIntent))).toMatchObject({
        ready: true,
        reviewedCommit: f.b,
        commit: observed[0]?.commit,
      });
      expect(await Effect.runPromise(issues.pullRequest(dIntent))).toMatchObject({
        ready: true,
        reviewedCommit: f.d,
        commit: observed[1]?.commit,
      });
      expect(await Effect.runPromise(issues.pullRequest(cIntent))).toMatchObject({
        ready: false,
        landed: false,
        manualRecovery: true,
      });
      expect(await Effect.runPromise(issues.recoveries())).toContainEqual(
        expect.objectContaining({
          issue: 4,
          active: false,
          progress: expect.stringContaining('manual recovery'),
        })
      );
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0]).toBe(
        observed[0]?.commit
      );
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(
        kind === 'head' ? f.d : observed[2]?.commit
      );
      expect(
        (await f.host.calls()).filter((call) => call.args[0] === 'pr' && call.args[1] === 'edit')
      ).toHaveLength(before);
      if (kind.startsWith('base-default')) {
        live.prs[104].base = 'D';
        await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(live));
        expect(await Effect.runPromise(issues.pullRequest(cIntent))).toMatchObject({ ready: true });
        live.prs[104].base = 'main';
        await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(live));
        expect(await Effect.runPromise(issues.pullRequest(cIntent))).toMatchObject({
          ready: false,
          manualRecovery: true,
        });
        await Effect.runPromise(issues.recoveries());
      }
      if (kind === 'base' || kind.startsWith('base-default')) {
        const b = observed[0];
        const d = observed[1];
        if (!b || !d) throw new Error('Missing maintained parents');
        f.git('switch', 'main');
        f.git('cherry-pick', b.commit);
        const mergedB = f.git('rev-parse', 'HEAD');
        const merges: Record<string, { merge: string; head: string }> = {
          102: { merge: mergedB, head: b.commit },
        };
        Object.assign(live.prs[102], { state: 'MERGED', base: 'main' });
        if (kind === 'base-default-parents') {
          f.git('cherry-pick', d.commit);
          merges['103'] = { merge: f.git('rev-parse', 'HEAD'), head: d.commit };
          Object.assign(live.prs[103], { state: 'MERGED', base: 'main' });
        }
        f.git('push', 'origin', 'main');
        f.git('switch', '--detach', f.host.base);
        await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(live));
        await saveLanding(f, { join: live, landing: { merge: f.merged, head: f.a, merges } });
        await Effect.runPromise(issues.reconcile());
        expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/D').split(/\s/)[0]).toBe(
          d.commit
        );
        expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(
          observed[2]?.commit
        );
        expect(
          (await f.host.calls()).filter((call) => call.args[0] === 'pr' && call.args[1] === 'edit')
        ).toHaveLength(before);
        expect(await Effect.runPromise(issues.pullRequest(cIntent))).toMatchObject({
          ready: false,
          manualRecovery: true,
        });
        expect(await Effect.runPromise(issues.recoveries())).toContainEqual(
          expect.objectContaining({
            issue: 4,
            active: false,
            progress: expect.stringContaining('manual recovery'),
          })
        );
      }
    } finally {
      await f.close();
    }
  }
);
it.each([false, true])(
  'preserves unpinned operator PR boundaries after landing with automatic retarget %s',
  async (retargeted) => {
    const f = await landedFixture();
    try {
      if (retargeted) {
        f.joinState.prs[102].base = 'main';
        f.joinState.prs[104].base = 'main';
        await saveLanding(f, { join: f.joinState, landing: { merge: f.merged, head: f.a } });
      }
      const issues = githubIssues({
        ...f.config,
        prerequisites: f.config.prerequisites.map(({ issue, pr, commit }) => ({
          issue,
          pr,
          commit,
        })),
      });
      if (!issues.reconcile) throw new Error('Missing reconciliation');
      await Effect.runPromise(issues.reconcile());
      const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
      expect(f.git('log', '--format=%s', `${f.merged}..${head}`)).toBe('C\nD\nB');
      expect(f.git('rev-list', '--merges', `${f.merged}..${head}`)).toBe('');
    } finally {
      await f.close();
    }
  }
);
it.each([false, true])(
  'distinguishes automatic retarget from a known pre-landing external edit across reopen %s',
  async (knownExternal) => {
    const f = await fixture();
    try {
      const initial = JSON.parse(await readFile(f.host.configFile, 'utf8'));
      const state = initial.join;
      const a = f.git('rev-parse', 'A');
      const b = f.git('rev-parse', 'B');
      const config = {
        project: f.host.repository,
        base: f.host.base,
        prerequisites: [
          { issue: 1, pr: 101, commit: a, parent: f.host.base, prBase: 'main', branch: 'A' },
          { issue: 2, pr: 102, commit: b, parent: a, prBase: 'A', branch: 'B' },
          { issue: 3, pr: 103, commit: f.d, parent: b, prBase: 'B', branch: 'D' },
          { issue: 4, pr: 104, commit: f.c, parent: a, prBase: 'A', branch: 'C' },
        ],
        joins: {
          directory: join(f.host.directory, 'joins'),
          binary: f.host.binary,
          projectId: 'project-id',
        },
      };
      if (knownExternal) state.prs[102].base = 'main';
      await saveLanding(f, { join: state });
      const observing = githubIssues(config);
      if (!observing.reconcile) throw new Error('Missing reconciliation');
      await Effect.runPromise(observing.reconcile());
      f.git('switch', 'main');
      await writeFile(join(f.host.repository, 'advance.txt'), 'default advance');
      f.git('add', '.');
      f.git('commit', '-m', 'advance');
      f.git('cherry-pick', a);
      const merged = f.git('rev-parse', 'HEAD');
      f.git('push', 'origin', 'main');
      f.git('switch', '--detach', f.host.base);
      Object.assign(state.prs[101], { base: 'main', state: 'MERGED' });
      state.prs[102].base = 'main';
      await writeFile(join(f.host.directory, 'join-live.json'), JSON.stringify(state));
      await saveLanding(f, { join: state, landing: { merge: merged, head: a } });
      const reopened = githubIssues(config);
      if (!reopened.reconcile || !reopened.recoveries) throw new Error('Missing reconciliation');
      await Effect.runPromise(reopened.reconcile());
      const bHead = f.git('ls-remote', '--heads', 'origin', 'refs/heads/B').split(/\s/)[0];
      if (knownExternal) {
        expect(bHead).toBe(b);
        expect(await Effect.runPromise(reopened.recoveries())).toContainEqual(
          expect.objectContaining({
            issue: 2,
            active: false,
            progress: expect.stringContaining('manual recovery'),
          })
        );
        expect(
          (await f.host.calls()).filter((call) => call.args[0] === 'pr' && call.args[1] === 'edit')
        ).toHaveLength(0);
      } else {
        expect(bHead).not.toBe(b);
        const head = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0];
        expect(f.git('log', '--format=%s', `${merged}..${head}`)).toBe('C\nD\nB');
        expect(await Effect.runPromise(reopened.recoveries())).toEqual([]);
      }
    } finally {
      await f.close();
    }
  }
);

it.each([
  { completed: false, legacy: false },
  { completed: true, legacy: false },
  { completed: true, legacy: true },
  { completed: true, legacy: true, missingBoundary: true },
  { completed: true, legacy: false, unchanged: true },
])('reconciles an owned CI repair after replay %j', async (options) => {
  const { completed, legacy } = options;
  const f = await fixture({ ciFails: !completed });
  try {
    await Effect.runPromise(f.issues.prepare!(5));
    if (legacy) {
      const root = join(f.host.directory, 'joins');
      const key = (await readdir(root)).find((value) => /^[a-f0-9]{64}$/.test(value));
      if (!key) throw new Error('Missing legacy journal');
      const name = join(root, key, 'intent.json');
      const operation = JSON.parse(await readFile(name, 'utf8'));
      delete operation.boundary;
      await writeFile(name, JSON.stringify(operation));
      if ('missingBoundary' in options) await unlink(join(root, key, 'boundary.json'));
    }
    const path = join(f.host.directory, 'join-live.json');
    let live = JSON.parse(await readFile(path, 'utf8'));
    live.newCI = 'FAILURE';
    await writeFile(path, JSON.stringify(live));
    const intent = {
      id: 'C-job',
      issue: 4,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
      base: f.host.base,
      branch: 'C',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    const observed = await Effect.runPromise(f.issues.pullRequest(intent));
    expect(observed).toMatchObject({
      kind: 'found',
      ci: { failed: true },
      reviewedCommit: f.c,
      ready: false,
    });
    if (observed.kind !== 'found' || !f.issues.repairReplay)
      throw new Error('Missing owned repair');
    expect(await Effect.runPromise(f.issues.repairReplay(intent, 'a'.repeat(40)))).toBe(false);
    await saveLanding(f, {
      ...JSON.parse(await readFile(f.host.configFile, 'utf8')),
      joinWriter: true,
    });
    expect(await Effect.runPromise(f.issues.repairReplay(intent, observed.commit))).toBe(false);
    await saveLanding(f, {
      ...JSON.parse(await readFile(f.host.configFile, 'utf8')),
      joinWriter: 'completed',
    });
    expect(await Effect.runPromise(f.issues.repairReplay(intent, observed.commit))).toBe(true);
    f.git('switch', '--detach', observed.commit);
    await writeFile(join(f.host.repository, 'repair.txt'), 'fixed CI');
    f.git('add', '.');
    f.git('commit', '-m', 'repair C');
    const repaired = f.git('rev-parse', 'HEAD');
    f.git(
      'push',
      `--force-with-lease=refs/heads/C:${observed.commit}`,
      'origin',
      `${repaired}:refs/heads/C`
    );
    expect(await Effect.runPromise(f.issues.repairReplay(intent, observed.commit, repaired))).toBe(
      false
    );
    live = JSON.parse(await readFile(path, 'utf8'));
    live.newCI = 'SUCCESS';
    await writeFile(path, JSON.stringify(live));
    expect(await Effect.runPromise(f.issues.repairReplay(intent, observed.commit, repaired))).toBe(
      true
    );
    expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
      commit: repaired,
      maintenancePending: true,
      ready: false,
      reviewedCommit: f.c,
    });
    await Effect.runPromise(f.reopen().reconcile!());
    expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
      commit: repaired,
      ready: true,
      reviewedCommit: f.c,
    });
    expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
      blockersReady: true,
      prerequisite: { base: repaired },
    });
    expect(f.git('show', `${repaired}:repair.txt`)).toBe('fixed CI');
    if ('unchanged' in options) {
      for (let cycle = 0; cycle < 2; cycle++) {
        const failed = JSON.parse(await readFile(path, 'utf8'));
        failed.newCI = 'FAILURE';
        await writeFile(path, JSON.stringify(failed));
        expect(await Effect.runPromise(f.reopen().repairReplay!(intent, repaired))).toBe(true);
        failed.newCI = 'SUCCESS';
        await writeFile(path, JSON.stringify(failed));
        expect(await Effect.runPromise(f.reopen().repairReplay!(intent, repaired, repaired))).toBe(
          true
        );
        await Effect.runPromise(f.reopen().reconcile!());
        expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
          commit: repaired,
          ready: true,
          reviewedCommit: f.c,
        });
        expect(await Effect.runPromise(f.reopen().repairReplay!(intent, repaired, repaired))).toBe(
          true
        );
      }
    }

    expect(await Effect.runPromise(f.issues.repairReplay(intent, observed.commit, repaired))).toBe(
      true
    );
  } finally {
    await f.close();
  }
});

it('restacks descendants of an accepted middle replay repair without losing the repair or replaying landed A', async () => {
  const f = await landedFixture();
  try {
    await Effect.runPromise(f.issues.reconcile!());
    const intent = {
      id: 'B-job',
      issue: 2,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
      base: f.host.base,
      branch: 'B',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    const pr = await Effect.runPromise(f.issues.pullRequest(intent));
    if (pr.kind !== 'found') throw new Error('Missing B');
    expect(await Effect.runPromise(f.issues.repairReplay!(intent, pr.commit))).toBe(true);
    f.git('switch', '--detach', pr.commit);
    await writeFile(join(f.host.repository, 'fix-B.txt'), 'fixed B');
    f.git('add', '.');
    f.git('commit', '-m', 'repair B');
    const repaired = f.git('rev-parse', 'HEAD');
    f.git(
      'push',
      `--force-with-lease=refs/heads/B:${pr.commit}`,
      'origin',
      `${repaired}:refs/heads/B`
    );
    expect(await Effect.runPromise(f.issues.repairReplay!(intent, pr.commit, repaired))).toBe(true);
    await Effect.runPromise(f.issues.reconcile!());
    const child = await Effect.runPromise(
      f.issues.pullRequest({ ...intent, issue: 4, branch: 'C' })
    );
    expect(child).toMatchObject({ ready: true, reviewedCommit: f.c });
    if (child.kind !== 'found') throw new Error('Missing C');
    expect(f.git('show', `${child.commit}:fix-B.txt`)).toBe('fixed B');
    expect(f.git('merge-base', '--is-ancestor', repaired, child.commit)).toBe('');
    expect(f.git('rev-list', '--merges', `${f.merged}..${child.commit}`)).toBe('');
    expect(f.git('log', '--format=%s', `${f.merged}..${child.commit}`)).toBe('C\nD\nrepair B\nB');
  } finally {
    await f.close();
  }
});

it.each(['SIMPLE', 'COMPLEX'] as const)(
  'recovers %s conflicts in descendants of a CI repair',
  async (outcome) => {
    const f = await landedFixture({ conflict: true, restack: { outcome, review: true } });
    try {
      for (let i = 0; i < 3; i++) await Effect.runPromise(f.issues.reconcile!());
      const intent = {
        id: 'B-job',
        issue: 2,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
        base: f.host.base,
        branch: 'B',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const pr = await Effect.runPromise(f.issues.pullRequest(intent));
      if (pr.kind !== 'found') throw new Error('Missing B');
      expect(await Effect.runPromise(f.issues.repairReplay!(intent, pr.commit))).toBe(true);
      f.git('switch', '--detach', pr.commit);
      await writeFile(join(f.host.repository, 'shared.txt'), 'B repaired behavior');
      f.git('add', '.');
      f.git('commit', '-m', 'repair B');
      const repaired = f.git('rev-parse', 'HEAD');
      f.git(
        'push',
        `--force-with-lease=refs/heads/B:${pr.commit}`,
        'origin',
        `${repaired}:refs/heads/B`
      );
      const results = [];
      for (let i = 0; i < 8; i++) {
        results.push(await Effect.runPromise(f.issues.repairReplay!(intent, pr.commit, repaired)));
        const recovering = await Effect.runPromise(f.issues.recoveries!());
        if (i === 0)
          expect(recovering).toContainEqual(expect.objectContaining({ issue: 3, active: true }));
        if (i === 0) {
          const root = join(f.host.directory, 'joins');
          const scratch = (await readdir(root)).find((name) => name.startsWith('repair-replay-'));
          if (!scratch) throw new Error('Missing active scratch');
          const path = join(root, scratch, 'owner.json');
          const saved = await readFile(path, 'utf8');
          const deliveries = async () =>
            (await f.host.calls()).filter(
              (call) => call.args[0] === 'thread' && ['start', 'send'].includes(call.args[1] ?? '')
            ).length;
          const before = await deliveries();
          await unlink(path);
          expect(
            await Effect.runPromise(f.reopen().repairReplay!(intent, pr.commit, repaired))
          ).toBe(false);
          await writeFile(path, JSON.stringify({ ...JSON.parse(saved), head: f.host.base }));
          expect(
            await Effect.runPromise(f.reopen().repairReplay!(intent, pr.commit, repaired))
          ).toBe(false);
          expect(await deliveries()).toBe(before);
          await writeFile(path, saved);
        }
      }
      expect(results.at(-1)).toBe(true);
      await Effect.runPromise(f.issues.reconcile!());
      const child = await Effect.runPromise(
        f.issues.pullRequest({ ...intent, issue: 4, branch: 'C' })
      );
      expect(child).toMatchObject({ ready: true, reviewedCommit: f.c });
      if (child.kind !== 'found') throw new Error('Missing C');
      expect(f.git('merge-base', '--is-ancestor', repaired, child.commit)).toBe('');
      expect(
        (await Effect.runPromise(f.issues.recoveries!())).every((value) => value.active !== true)
      ).toBe(true);
      const childIntent = { ...intent, issue: 4, branch: 'C' };
      expect(await Effect.runPromise(f.reopen().repairReplay!(childIntent, child.commit))).toBe(
        true
      );
      expect(
        (await Effect.runPromise(f.reopen().recoveries!())).filter((value) => value.active)
      ).toEqual([]);
      const root = join(f.host.directory, 'joins');
      const scratch = (await readdir(root)).find((name) => name.startsWith('repair-replay-'));
      if (!scratch) throw new Error('Missing repair scratch');
      const ownerPath = join(root, scratch, 'owner.json');
      const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
      const parent = join(root, owner.parent);
      const successor = JSON.parse(
        await readFile(join(parent, `repair-${owner.generation}.json`), 'utf8')
      );
      const completion = join(parent, `complete-${successor.generation}.json`);
      await rename(completion, `${completion}.pending`);
      expect(await Effect.runPromise(f.reopen().recoveries!())).toContainEqual(
        expect.objectContaining({ issue: 4, active: true })
      );
      await rename(`${completion}.pending`, completion);
      await rename(ownerPath, `${ownerPath}.legacy`);
      expect(await Effect.runPromise(f.reopen().recoveries!())).toContainEqual(
        expect.objectContaining({ issue: 4, active: true })
      );
      await rename(`${ownerPath}.legacy`, ownerPath);
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(childIntent, child.commit, child.commit))
      ).toBe(true);
      await Effect.runPromise(f.reopen().reconcile!());
      expect(await Effect.runPromise(f.reopen().repairReplay!(childIntent, child.commit))).toBe(
        true
      );
      expect(
        (await Effect.runPromise(f.reopen().recoveries!())).filter((value) => value.active)
      ).toEqual([]);
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(childIntent, child.commit, child.commit))
      ).toBe(true);
      await Effect.runPromise(f.reopen().reconcile!());
      const generations = (await readdir(root)).filter(
        (name) => name.startsWith('repair-replay-') && name.endsWith(`-${child.commit}`)
      );
      expect(generations).toHaveLength(2);
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'reconciles legacy landing facts only with authenticated closed proof, verified=%s',
  async (verified) => {
    const f = await landedFixture();
    try {
      await Effect.runPromise(f.issues.reconcile!());
      const root = join(f.host.directory, 'joins');
      const key = (await readdir(root)).find((value) => /^[a-f0-9]{64}$/.test(value));
      if (!key) throw new Error('Missing landing journal');
      const name = join(root, key, 'intent.json');
      const operation = JSON.parse(await readFile(name, 'utf8'));
      delete operation.boundary;
      await writeFile(name, JSON.stringify(operation));
      await unlink(join(root, key, 'boundary.json'));
      if (!verified) {
        const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
        config.landedPrerequisites[1] = [];
        await f.host.save(config);
      }
      const intent = {
        id: 'C',
        issue: 4,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
        branch: 'C',
        base: f.host.base,
        prBase: 'D',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const before = f.git('ls-remote', '--heads', 'origin', 'refs/heads/C');
      const current = githubIssues(f.config);
      expect(await Effect.runPromise(current.pullRequest(intent))).toMatchObject({
        ready: verified,
        reviewedCommit: f.c,
      });
      await Effect.runPromise(current.reconcile!());
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C')).toBe(before);
      expect(await Effect.runPromise(githubIssues(f.config).pullRequest(intent))).toMatchObject({
        ready: verified,
      });
    } finally {
      await f.close();
    }
  }
);

it.each(['branch:C', 'group:9'])(
  'respects the current successor writer before repair of %s',
  async (resource) => {
    const f = await fixture({ groups: true });
    try {
      await Effect.runPromise(f.issues.prepare!(5));
      const root = join(f.host.directory, 'joins');
      const original = (await readdir(root)).find((n) => /^[a-f0-9]{64}$/.test(n));
      if (!original) throw new Error('Missing completed operation');
      const successor = createHash('sha256')
        .update(JSON.stringify([4, 6]))
        .digest('hex');
      await mkdir(join(root, successor));
      await writeFile(join(root, successor, 'request.json'), JSON.stringify({ numbers: [4, 6] }));
      const claims = join(root, 'writers', createHash('sha256').update(resource).digest('hex'));
      await writeFile(join(claims, 'writer-1.json'), JSON.stringify({ key: successor }));
      const state = join(f.host.directory, 'join-live.json');
      const live = JSON.parse(await readFile(state, 'utf8'));
      live.newCI = 'FAILURE';
      await writeFile(state, JSON.stringify(live));
      const intent = {
        id: 'C-job',
        issue: 4,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
        base: f.host.base,
        branch: 'C',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const observed = await Effect.runPromise(f.issues.pullRequest(intent));
      if (observed.kind !== 'found') throw new Error('Missing replay');
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, observed.commit))).toBe(
        false
      );
      expect(
        (await readdir(join(root, original))).filter((n) => n.startsWith('repair-request-'))
      ).toEqual([]);
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(
        observed.commit
      );
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'holds repair ownership through restart and generation completion, pending=%s',
  async (pending) => {
    const f = await fixture({ ciFails: pending, groups: true });
    try {
      await Effect.runPromise(f.issues.prepare!(5));
      const root = join(f.host.directory, 'joins');
      const original = (await readdir(root)).find((n) => /^[a-f0-9]{64}$/.test(n));
      if (!original) throw new Error('Missing operation');
      const saved = JSON.parse(await readFile(join(root, original, 'intent.json'), 'utf8'));
      const state = join(f.host.directory, 'join-live.json');
      const fail = JSON.parse(await readFile(state, 'utf8'));
      fail.newCI = 'FAILURE';
      await writeFile(state, JSON.stringify(fail));
      const intent = {
        id: 'C-job',
        issue: 4,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
        base: f.host.base,
        branch: 'C',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const observed = await Effect.runPromise(f.issues.pullRequest(intent));
      if (observed.kind !== 'found') throw new Error('Missing replay');
      expect(await Effect.runPromise(f.issues.repairReplay!(intent, observed.commit))).toBe(true);
      const claims = join(root, 'writers', createHash('sha256').update('branch:C').digest('hex'));
      const owner = async () => {
        const names = (await readdir(claims))
          .filter((n) => /^writer-\d+.json$/.test(n))
          .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
        return JSON.parse(await readFile(join(claims, names.at(-1)!), 'utf8')).key;
      };
      const active = await owner();
      expect(active).not.toBe(original);
      for (const group of saved.groups) {
        const dir = join(
          root,
          'writers',
          createHash('sha256').update(`group:${group.number}`).digest('hex')
        );
        const records = await readdir(dir);
        const owners = await Promise.all(
          records.map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')).key)
        );
        expect(owners.at(-1)).toBe(active);
      }
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, observed.commit))).toBe(true);
      expect(await owner()).toBe(active);
      expect(
        (await readdir(join(root, original))).filter((n) => n.startsWith('repair-request-'))
      ).toHaveLength(1);
      const numbers = [6, 7];
      const competitor = createHash('sha256').update(JSON.stringify(numbers)).digest('hex');
      await mkdir(join(root, competitor));
      await writeFile(join(root, competitor, 'request.json'), JSON.stringify({ numbers }));
      await writeFile(join(root, competitor, 'seed.json'), JSON.stringify(saved.layers));
      await Effect.runPromise(f.reopen().reconcile!());
      expect(await owner()).toBe(active);
      f.git('switch', '--detach', observed.commit);
      await writeFile(join(f.host.repository, 'repair.txt'), 'fixed');
      f.git('add', '.');
      f.git('commit', '-m', 'repair');
      const fixed = f.git('rev-parse', 'HEAD');
      f.git(
        'push',
        `--force-with-lease=refs/heads/C:${observed.commit}`,
        'origin',
        `${fixed}:refs/heads/C`
      );
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(intent, observed.commit, fixed))
      ).toBe(false);
      expect(await owner()).toBe(active);
      const pass = JSON.parse(await readFile(state, 'utf8'));
      pass.newCI = 'SUCCESS';
      await writeFile(state, JSON.stringify(pass));
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(intent, observed.commit, fixed))
      ).toBe(true);
      expect(await owner()).toBe(active);
      await Effect.runPromise(f.reopen().reconcile!());
      await Effect.runPromise(f.reopen().reconcile!());
      expect(await owner()).toBe(competitor);
      const failedAgain = JSON.parse(await readFile(state, 'utf8'));
      failedAgain.newCI = 'FAILURE';
      await writeFile(state, JSON.stringify(failedAgain));
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, fixed))).toBe(false);
      expect(await owner()).toBe(competitor);
      expect(f.git('ls-remote', '--heads', 'origin', 'refs/heads/C').split(/\s/)[0]).toBe(fixed);
      expect(await readFile(join(f.host.repository, 'repair.txt'), 'utf8')).toBe('fixed');
    } finally {
      await f.close();
    }
  }
);

it.each(['review', 'publication', 'ci'] as const)(
  'retains certified replay ancestry for the subsequent %s stage',
  async (stage) => {
    const f = await fixture();
    try {
      const a = f.git('rev-parse', 'A');
      f.git('switch', '-c', 'replacement', f.host.base);
      await writeFile(join(f.host.repository, 'upstream.txt'), 'upstream');
      f.git('add', '.');
      f.git('commit', '-m', 'upstream');
      f.git('cherry-pick', a);
      const parent = f.git('rev-parse', 'HEAD');
      f.git('cherry-pick', f.c);
      const replay = f.git('rev-parse', 'HEAD');
      const owning = join(f.host.directory, 'owning');
      f.git('worktree', 'add', owning, '-b', 'owned-C', replay);
      const intent = {
        id: 'C',
        issue: 4,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
        base: a,
        prBase: 'A',
        branch: 'owned-C',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const request = {
        index: 5,
        stage,
        threadId: 'owner-C',
        commit: replay,
        previousRunId: 'repair',
        ordinal: 5,
        comparison: { base: parent, prBase: 'main', previousHead: f.c, owningHeads: [f.c, replay] },
      };
      const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
      await f.host.save({ ...config, joinWriter: false });
      await writeFile(
        join(f.host.directory, 'resource.json'),
        JSON.stringify({
          threadId: 'owner-C',
          title: 'Factory C',
          projectId: 'project-id',
          providerInstanceId: 'codex',
          model: 'gpt-6.1-sol',
          branch: 'owned-C',
          worktreePath: owning,
          status: 'completed',
          latestRunId: 'repair',
          runCount: 4,
          pendingRequestCount: 0,
        })
      );
      const execution = t3Execution({
        project: f.host.repository,
        projectId: 'project-id',
        binary: f.host.binary,
      });
      for (const context of [
        undefined,
        { ...request, threadId: 'unrelated' },
        { ...request, stage: 'implementation' as const },
      ])
        await expect(Effect.runPromise(execution.observe(intent, context))).rejects.toMatchObject({
          _tag: 'Unavailable',
        });
      expect(
        await Effect.runPromise(execution.observe(intent, { ...request, stage: 'babysitting' }))
      ).toMatchObject({ kind: 'found' });
      expect(await Effect.runPromise(execution.observe(intent, request))).toMatchObject({
        kind: 'found',
      });
      if (stage !== 'ci') {
        await writeFile(join(owning, 'dirty.txt'), 'dirty');
        await expect(Effect.runPromise(execution.sendStage(intent, request))).rejects.toMatchObject(
          { _tag: 'Unavailable' }
        );
        await unlink(join(owning, 'dirty.txt'));
        await Effect.runPromise(execution.sendStage(intent, request));
        expect(
          (await f.host.calls()).filter(
            (call) => call.args[1] === 'send' && !call.args.includes('--help')
          )
        ).toHaveLength(1);
      }
    } finally {
      await f.close();
    }
  }
);

it.each([
  { retired: false, pending: false },
  { retired: true, pending: false },
  { retired: false, pending: true },
  { retired: true, pending: true },
])(
  'admits owned CI repair across authenticated target retirement: %j',
  async ({ retired, pending }) => {
    const f = await fixture({ groups: true });
    try {
      await Effect.runPromise(f.issues.prepare!(5));
      const intent = {
        id: 'C-job',
        issue: 4,
        issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/4',
        base: f.host.base,
        prBase: 'A',
        branch: 'C',
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const before = await Effect.runPromise(f.issues.pullRequest(intent));
      if (before.kind !== 'found') throw new Error('Missing replay');
      const path = join(f.host.directory, 'join-live.json');
      const live = JSON.parse(await readFile(path, 'utf8'));
      if (pending) {
        live.newCI = 'FAILURE';
        await writeFile(path, JSON.stringify(live));
        expect(await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit))).toBe(true);
        live.newCI = 'SUCCESS';
        await writeFile(path, JSON.stringify(live));
      }
      if (retired) {
        f.git('switch', 'main');
        f.git('merge', '--ff-only', 'D');
        f.git('switch', '--detach', f.host.base);
        f.git('push', 'origin', 'main');
        f.git('push', 'origin', '--delete', 'D');
        Object.assign(live.prs[103], { state: 'MERGED', head: f.d, base: 'main' });
        live.prs[104].base = 'main';
        await writeFile(path, JSON.stringify(live));
        const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
        await f.host.save({
          ...config,
          issueStates: { 3: 'CLOSED' },
          landing: { pr: 103, merge: f.d, head: f.d },
          defaultBranch: { name: 'main', tip: f.d },
          landedPrerequisites: { 3: [103] },
          mergedPrerequisites: {
            103: {
              merged: true,
              merge_commit_sha: f.d,
              head: { sha: f.d },
              html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/103',
              base: { ref: 'main', repo: { full_name: 'rafaeltab/wallpaperdb' } },
            },
          },
        });
      }
      if (retired && pending) {
        const root = join(f.host.directory, 'joins');
        const original = (await readdir(root)).find((value) => /^[a-f0-9]{64}$/.test(value));
        if (!original) throw new Error('Missing operation');
        const certificatePath = join(root, original, 'complete.json');
        const certificate = await readFile(certificatePath);
        await unlink(certificatePath);
        expect(await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit))).toBe(
          false
        );
        await writeFile(certificatePath, certificate);
      }
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        ready: !pending,
        commit: before.commit,
        reviewedCommit: f.c,
      });
      expect(await Effect.runPromise(f.reopen().recoveries!())).not.toContainEqual(
        expect.objectContaining({ progress: expect.stringContaining('manual recovery') })
      );
      live.newCI = 'FAILURE';
      await writeFile(path, JSON.stringify(live));
      const observed = await Effect.runPromise(f.reopen().pullRequest(intent));
      expect(observed).toMatchObject({ ready: false, ci: { failed: true } });
      if (observed.kind !== 'found') throw new Error('Missing current publication');
      expect(observed.manualRecovery).not.toBe(true);
      const root = join(f.host.directory, 'joins');
      const original = (await readdir(root)).find((value) => /^[a-f0-9]{64}$/.test(value));
      if (!original) throw new Error('Missing operation');
      if (retired) {
        const successor = createHash('sha256')
          .update(JSON.stringify([4, 6]))
          .digest('hex');
        await mkdir(join(root, successor));
        await writeFile(join(root, successor, 'request.json'), JSON.stringify({ numbers: [4, 6] }));
        for (const resource of ['branch:C', 'group:9']) {
          const claims = join(root, 'writers', createHash('sha256').update(resource).digest('hex'));
          const ordinals = (await readdir(claims))
            .filter((name) => /^writer-\d+.json$/.test(name))
            .map((name) => Number(name.match(/\d+/)?.[0]));
          const name = join(claims, `writer-${Math.max(...ordinals) + 1}.json`);
          await writeFile(name, JSON.stringify({ key: successor }));
          expect(await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit))).toBe(
            false
          );
          expect(
            (await readdir(join(root, original))).filter((value) => value.startsWith('comparison-'))
          ).toEqual([]);
          await unlink(name);
        }
      }
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit))).toBe(true);
      if (retired) {
        const bindingPath = join(root, original, 'comparison-initial.json');
        const bindingBytes = await readFile(bindingPath, 'utf8');
        const binding = JSON.parse(bindingBytes);
        binding.current.replay[0].target = 'untrusted-target';
        await writeFile(bindingPath, JSON.stringify(binding));
        await expect(Effect.runPromise(f.reopen().pullRequest(intent))).rejects.toMatchObject({
          _tag: 'Unavailable',
        });
        await writeFile(bindingPath, bindingBytes);
      }
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit))).toBe(true);
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        commit: before.commit,
        maintenancePending: true,
      });
      if (pending) {
        const recovered = JSON.parse(await readFile(path, 'utf8'));
        recovered.newCI = 'SUCCESS';
        await writeFile(path, JSON.stringify(recovered));
        expect(
          await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit, before.commit))
        ).toBe(true);
        await Effect.runPromise(f.reopen().reconcile!());
        expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
          ready: true,
          commit: before.commit,
          reviewedCommit: f.c,
        });
        recovered.newCI = 'FAILURE';
        await writeFile(path, JSON.stringify(recovered));
        expect(await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit))).toBe(true);
      }
      f.git('switch', '--detach', before.commit);
      await writeFile(join(f.host.repository, 'repair.txt'), 'repaired after target retirement');
      f.git('add', '.');
      f.git('commit', '-m', 'repair C');
      const repaired = f.git('rev-parse', 'HEAD');
      f.git(
        'push',
        `--force-with-lease=refs/heads/C:${before.commit}`,
        'origin',
        `${repaired}:refs/heads/C`
      );
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit, repaired))
      ).toBe(false);
      const passed = JSON.parse(await readFile(path, 'utf8'));
      passed.newCI = 'SUCCESS';
      await writeFile(path, JSON.stringify(passed));
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit, repaired))
      ).toBe(true);
      await Effect.runPromise(f.reopen().reconcile!());
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        ready: true,
        commit: repaired,
        reviewedCommit: f.c,
      });
      expect(await Effect.runPromise(f.reopen().inspect(5))).toMatchObject({
        blockersReady: true,
        prerequisite: { base: repaired },
      });
      expect(
        await Effect.runPromise(f.reopen().repairReplay!(intent, before.commit, repaired))
      ).toBe(true);
      expect(f.git('show', `${repaired}:repair.txt`)).toBe('repaired after target retirement');
    } finally {
      await f.close();
    }
  }
);

it.each(['C', 'B'])(
  'retains a locally reviewed correction and reconciles its published replay head on %s',
  async (branch) => {
    const f = await landedFixture();
    try {
      await Effect.runPromise(f.issues.reconcile!());
      const intent = {
        id: `${branch}-job`,
        issue: branch === 'C' ? 4 : 2,
        issueUrl: `https://github.com/rafaeltab/wallpaperdb/issues/${branch === 'C' ? 4 : 2}`,
        base: f.host.base,
        branch,
        context: '',
        createdAt: 0,
        expectedStage: 'implementation' as const,
      };
      const livePath = join(f.host.directory, 'join-live.json');
      const changeCI = async (value: string) => {
        const live = JSON.parse(await readFile(livePath, 'utf8'));
        live.newCI = value;
        await writeFile(livePath, JSON.stringify(live));
      };
      const start = await Effect.runPromise(f.issues.pullRequest(intent));
      if (start.kind !== 'found') throw new Error('Missing replay');
      await changeCI('FAILURE');
      expect(await Effect.runPromise(f.issues.repairReplay!(intent, start.commit))).toBe(true);
      f.git('switch', '--detach', start.commit);
      await writeFile(join(f.host.repository, 'fixed.txt'), 'CI correction');
      f.git('add', '.');
      f.git('commit', '-m', 'CI correction');
      const h1 = f.git('rev-parse', 'HEAD');
      f.git(
        'push',
        `--force-with-lease=refs/heads/${branch}:${start.commit}`,
        'origin',
        `${h1}:refs/heads/${branch}`
      );
      await changeCI('SUCCESS');
      expect(await Effect.runPromise(f.issues.repairReplay!(intent, start.commit, h1))).toBe(true);
      await Effect.runPromise(f.reopen().reconcile!());
      await writeFile(join(f.host.repository, 'review.txt'), 'authorized correction');
      f.git('add', '.');
      f.git('commit', '-m', 'review correction');
      const h2 = f.git('rev-parse', 'HEAD');
      const owning = join(f.host.directory, 'review-owner');
      f.git('worktree', 'add', owning, branch);
      execFileSync('git', ['-C', owning, 'reset', '--hard', h2]);
      const execution = t3Execution({
        binary: f.host.binary,
        project: f.host.repository,
        projectId: 'project-id',
      });
      const authority = async (stage: 'review' | 'publication', commit = h2, attempt = 0) => {
        const index = (stage === 'review' ? 5 : 6) + attempt;
        const runId = `${stage}-run-${attempt}`;
        const request: import('../src/capabilities/job/index.js').StageRequest = {
          stage,
          index,
          ordinal: index,
          previousRunId: attempt
            ? `${stage}-run-${attempt - 1}`
            : stage === 'review'
              ? 'babysitting-run'
              : 'review-run-0',
          threadId: 'review-owner',
          commit: stage === 'review' ? h1 : commit,
          comparison: {
            base: start.parent!,
            prBase: start.base!,
            previousHead: stage === 'publication' ? h1 : (start.previousHead ?? start.commit),
          },
        };
        const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
        await f.host.save({
          ...config,
          joinWriter: false,
          messages: [
            {
              role: 'assistant',
              runId,
              text: JSON.stringify({
                jobId: intent.id,
                stage,
                base: start.parent,
                commit,
                outcome: stage === 'review' ? '<REVIEW>COMPLETE</REVIEW>' : '<PR>CREATED</PR>',
                tests: true,
                coverage: true,
                crap: true,
                reviews: true,
              }),
            },
          ],
        });
        await writeFile(
          join(f.host.directory, 'resource.json'),
          JSON.stringify({
            threadId: request.threadId,
            title: `Factory ${intent.id}`,
            projectId: 'project-id',
            providerInstanceId: 'codex',
            model: 'gpt-6.1-sol',
            branch,
            worktreePath: owning,
            status: 'completed',
            latestRunId: runId,
            runCount: index,
            pendingRequestCount: 0,
            pullRequests: [{ url: start.url }],
          })
        );
        const evidence = await Effect.runPromise(execution.inspectStage(intent, request));
        if (!evidence?.accepted) throw new Error('Missing actual clean T3 receipt');
        return { request, evidence };
      };
      const reviewed = await authority('review');
      await writeFile(join(owning, 'dirty-proof.txt'), 'dirty');
      expect(
        (await Effect.runPromise(execution.inspectStage(intent, reviewed.request)))?.accepted
      ).not.toBe(true);
      await unlink(join(owning, 'dirty-proof.txt'));
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h1, h2, {
            ...reviewed,
            evidence: { ...reviewed.evidence, ordinal: reviewed.evidence.ordinal + 1 },
          })
        )
      ).toBe(false);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h1, h2, {
            ...reviewed,
            evidence: { ...reviewed.evidence, runId: reviewed.request.previousRunId! },
          })
        )
      ).toBe(false);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h1, h2, {
            ...reviewed,
            evidence: { ...reviewed.evidence, accepted: false },
          })
        )
      ).toBe(false);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h1, h2, {
            ...reviewed,
            request: {
              ...reviewed.request,
              comparison: { ...reviewed.request.comparison!, base: f.host.base },
            },
          })
        )
      ).toBe(false);
      const oldConfig = JSON.parse(await readFile(f.host.configFile, 'utf8'));
      await f.host.save({ ...oldConfig, joinWriter: true, joinWriterBranch: branch });
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, h1, h2, reviewed))).toBe(
        false
      );
      await f.host.save(oldConfig);
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, h1, h2, reviewed))).toBe(
        true
      );
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h1, h2, await authority('review', h2, 1))
        )
      ).toBe(true);
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, h1, h2, reviewed))).toBe(
        true
      );

      expect(f.git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`).split(/\s/)[0]).toBe(
        h1
      );
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        commit: h1,
        ready: false,
        maintenancePending: true,
        manualRecovery: false,
      });
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h2, h2, await authority('publication'))
        )
      ).toBe(false);
      f.git(
        'push',
        `--force-with-lease=refs/heads/${branch}:${h1}`,
        'origin',
        `${h2}:refs/heads/${branch}`
      );
      await changeCI('FAILURE');
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        commit: h2,
        ready: false,
        maintenancePending: true,
        manualRecovery: false,
      });
      const published = await authority('publication');
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h2, h2, {
            ...published,
            request: {
              ...published.request,
              comparison: undefined,
            },
          })
        )
      ).toBe(false);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h2, h2, {
            ...published,
            request: {
              ...published.request,
              comparison: { ...published.request.comparison!, previousHead: start.commit },
            },
          })
        )
      ).toBe(false);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h2, h2, {
            ...published,
            evidence: { ...published.evidence, linked: [] },
          })
        )
      ).toBe(false);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h2, h2, await authority('publication'))
        )
      ).toBe(true);
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        commit: h2,
        ready: false,
        manualRecovery: false,
      });
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, h2))).toBe(true);
      await changeCI('SUCCESS');
      expect(await Effect.runPromise(f.reopen().repairReplay!(intent, h2, h2))).toBe(true);
      await Effect.runPromise(f.reopen().reconcile!());
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        commit: h2,
        ready: true,
        reviewedCommit: branch === 'C' ? f.c : f.b,
      });
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(intent, h2, h2, await authority('publication'))
        )
      ).toBe(true);
      const assertions: import('../src/adapters/github/index.js').VerifiedPrerequisite[] =
        f.config.prerequisites.slice(0, 1);
      for (const [issue, name] of [
        [2, 'B'],
        [3, 'D'],
        [4, 'C'],
      ] as const) {
        const observed = await Effect.runPromise(
          f.reopen().pullRequest({ ...intent, issue, branch: name })
        );
        if (observed.kind !== 'found' || !observed.ready || !observed.parent)
          throw new Error('Missing verified current publication');
        assertions.push({
          issue,
          pr: 100 + issue,
          commit: observed.commit,
          reviewedCommit: observed.reviewedCommit,
          parent: observed.parent,
          prBase: observed.base,
        });
      }
      const ready = await Effect.runPromise(
        githubIssues({ ...f.config, prerequisites: assertions }).inspect(5)
      );
      expect(ready.blockersReady).toBe(true);
      const tip = ready.prerequisite?.base;
      if (!tip) throw new Error('Missing descendants');
      expect(f.git('show', `${tip}:review.txt`)).toBe('authorized correction');
      expect(f.git('merge-base', '--is-ancestor', h2, tip)).toBe('');
      expect(f.git('rev-list', '--merges', `${f.host.base}..${tip}`)).toBe('');
      if (branch === 'B') expect(f.git('log', '--format=%s', `${h2}..${tip}`)).toBe('C\nD');
      await writeFile(join(f.host.repository, 'external.txt'), 'unreviewed');
      f.git('add', '.');
      f.git('commit', '-m', 'external');
      const unknown = f.git('rev-parse', 'HEAD');
      f.git(
        'push',
        `--force-with-lease=refs/heads/${branch}:${h2}`,
        'origin',
        `${unknown}:refs/heads/${branch}`
      );
      execFileSync('git', ['-C', owning, 'reset', '--hard', unknown]);
      expect(
        await Effect.runPromise(
          f.reopen().repairReplay!(
            intent,
            unknown,
            unknown,
            await authority('publication', unknown)
          )
        )
      ).toBe(false);
      expect(await Effect.runPromise(f.reopen().pullRequest(intent))).toMatchObject({
        ready: false,
        manualRecovery: true,
      });
    } finally {
      await f.close();
    }
  }
);

it('finishes scheduler admission when an admitted repair waits for COMPLEX descendant review', async () => {
  const f = await landedFixture({ conflict: true, restack: { outcome: 'COMPLEX', review: true } });
  let jobRuntime:
    | ManagedRuntime.ManagedRuntime<Job, import('../src/capabilities/job/index.js').Unavailable>
    | undefined;
  let schedulerRuntime: ManagedRuntime.ManagedRuntime<Scheduler, never> | undefined;
  try {
    for (let i = 0; i < 3; i++) await Effect.runPromise(f.issues.reconcile!());
    const intent = {
      id: 'B-capacity',
      issue: 2,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
      base: f.host.base,
      branch: 'B',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    const pr = await Effect.runPromise(f.issues.pullRequest(intent));
    if (pr.kind !== 'found' || !pr.parent || !pr.base) throw new Error('Missing verified B');
    expect(await Effect.runPromise(f.issues.repairReplay!(intent, pr.commit))).toBe(true);
    f.git('switch', '--detach', pr.commit);
    await writeFile(join(f.host.repository, 'shared.txt'), 'B repaired behavior');
    f.git('add', '.');
    f.git('commit', '-m', 'repair B with descendant conflict');
    const repaired = f.git('rev-parse', 'HEAD');
    f.git(
      'push',
      `--force-with-lease=refs/heads/B:${pr.commit}`,
      'origin',
      `${repaired}:refs/heads/B`
    );
    const owning = join(f.host.directory, 'B-capacity-owner');
    f.git('worktree', 'add', owning, 'B');
    execFileSync('git', ['-C', owning, 'reset', '--hard', repaired]);
    const config = JSON.parse(await readFile(f.host.configFile, 'utf8'));
    await f.host.save({
      ...config,
      joinWriter: false,
      restack: { outcome: 'COMPLEX', review: true, question: 'Wait' },
      messages: [
        {
          role: 'assistant',
          runId: 'repair-run',
          text: JSON.stringify({
            delivery: `${intent.id}:4`,
            jobId: intent.id,
            stage: 'babysitting',
            base: pr.parent,
            commit: repaired,
            outcome: '<PR>READY</PR>',
            tests: true,
            coverage: true,
            crap: true,
            reviews: true,
          }),
        },
      ],
    });
    await writeFile(
      join(f.host.directory, 'resource.json'),
      JSON.stringify({
        threadId: 'B-capacity-owner',
        title: `Factory ${intent.id}`,
        projectId: 'project-id',
        providerInstanceId: 'codex',
        model: 'gpt-6.1-sol',
        branch: 'B',
        worktreePath: owning,
        status: 'completed',
        latestRunId: 'repair-run',
        runCount: 5,
        pendingRequestCount: 0,
        pullRequests: [{ url: pr.url }],
      })
    );
    const parentConfig = join(f.host.directory, 'parent-protocol.json');
    const parentProtocol = {
      ...JSON.parse(await readFile(f.host.configFile, 'utf8')),
      restack: undefined,
    };
    await writeFile(parentConfig, JSON.stringify(parentProtocol));
    const parentBinary = join(f.host.directory, 'parent-t3');
    await writeFile(
      parentBinary,
      `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [${JSON.stringify(f.host.binary)}, ...process.argv.slice(2)], { env: { ...process.env, FACTORY_FIXTURE: ${JSON.stringify(parentConfig)} }, stdio: 'inherit' });
process.exit(result.status ?? 1);
`
    );
    await chmod(parentBinary, 0o700);
    const execution = t3Execution({
      project: f.host.repository,
      projectId: 'project-id',
      binary: parentBinary,
    });
    const request: import('../src/capabilities/job/index.js').StageRequest = {
      stage: 'babysitting',
      index: 4,
      ordinal: 5,
      threadId: 'B-capacity-owner',
      previousRunId: 'ci-run',
      commit: pr.commit,
      comparison: { base: pr.parent, prBase: pr.base, previousHead: pr.commit },
    };
    expect(await Effect.runPromise(execution.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      commit: repaired,
    });
    const jobStore = fileStore(join(f.host.directory, 'B-capacity-state'));
    await Effect.runPromise(jobStore.reserve(intent));
    const names = ['implementation', 'review', 'publication', 'ci', 'babysitting'] as const;
    for (let index = 0; index < names.length; index++)
      await Effect.runPromise(
        jobStore.saveStage(index === 4 ? request : { ...request, stage: names[index], index })
      );
    await Effect.runPromise(jobStore.claimStage(4));
    let observedJob: import('../src/capabilities/job/index.js').Job;
    let admissionPolicy: import('../src/capabilities/job/index.js').RecoveryAdmission = () =>
      Effect.succeed(false);
    let depth = 0;
    let maximumDepth = 0;
    const issues = githubIssues({
      ...f.config,
      admitRecovery: (issue) => admissionPolicy(issue),
      readyPrerequisites: () => observedJob.status().pipe(Effect.as([])),
    });
    jobRuntime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ContinuationAdmission, {
              authorize: (issue, receipt) => admissionPolicy(issue, receipt),
            }),
            Layer.succeed(JobStore, jobStore),
            Layer.succeed(Issues, issues),
            Layer.succeed(Execution, execution),
            Layer.succeed(Time, { now: () => Effect.succeed(100) })
          )
        )
      )
    );
    const parent = await jobRuntime.runPromise(Job);
    observedJob = {
      ...parent,
      status: () =>
        Effect.gen(function* () {
          depth++;
          maximumDepth = Math.max(maximumDepth, depth);
          expect(depth).toBeLessThan(3);
          return yield* parent.status();
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              depth--;
            })
          )
        ),
    };
    let unrelated: Status = {
      kind: 'job',
      intent: { ...intent, id: 'unrelated', issue: 99, branch: 'unrelated' },
      execution: { kind: 'absent' },
      elapsedMs: 0,
    };
    const unrelatedJob: import('../src/capabilities/job/index.js').Job = {
      status: () => Effect.succeed(unrelated),
      start: () => Effect.die('Retained unrelated work must not launch again'),
      resume: () => Effect.succeed({ kind: 'rejected' as const }),
      cancel: () => Effect.succeed({ kind: 'rejected' as const }),
    };
    const schedule = controlledScheduleStore();
    const admission = { issue: 2, base: intent.base, context: '' };
    await Effect.runPromise(
      schedule.save({
        revision: 0,
        concurrency: -1,
        allowance: 1,
        paused: true,
        admissions: [admission],
      })
    );
    schedulerRuntime = ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ScheduleStore, schedule),
            Layer.succeed(JobPool, {
              job: (number) => Effect.succeed(number === 99 ? unrelatedJob : observedJob),
            }),
            Layer.succeed(Issues, issues),
            Layer.succeed(Plan, { preview: () => Effect.die('Paused scheduler must not plan') }),
            Layer.succeed(PlanningSource, {
              read: () => Effect.die('Paused scheduler must not discover'),
            })
          )
        )
      )
    );
    const scheduler = await schedulerRuntime.runPromise(Scheduler);
    admissionPolicy = scheduler.authorizeRecovery;
    await schedulerRuntime.runPromise(scheduler.tick(f.host.base));
    const path = join(f.host.directory, 'restacker.json');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    expect(saved.thread.pendingRequestCount).toBe(1);
    saved.thread.status = 'completed';
    saved.thread.pendingRequestCount = 0;
    saved.messages = [
      {
        role: 'assistant',
        runId: 'resolve-run',
        text: JSON.stringify({
          operation: saved.operation,
          commit: saved.head,
          outcome: '<RESTACK>COMPLEX</RESTACK>',
        }),
      },
    ];
    await writeFile(path, JSON.stringify(saved));
    const retained = await Effect.runPromise(schedule.read());
    const unrelatedAdmission = { issue: 99, base: intent.base, context: '' };
    await Effect.runPromise(
      schedule.save({
        ...retained,
        revision: retained.revision + 1,
        concurrency: 1,
        allowance: 2,
        admissions: [admission, unrelatedAdmission],
      })
    );
    await schedulerRuntime.runPromise(scheduler.status());
    expect(
      (await f.host.calls()).filter(
        (call) => call.args[1] === 'send' && call.args[3]?.includes(saved.operation)
      )
    ).toHaveLength(0);
    expect(await Effect.runPromise(issues.recoveries!())).toContainEqual(
      expect.objectContaining({ issue: 4, active: false })
    );
    if (unrelated.kind !== 'job') throw new Error('Missing unrelated job');
    unrelated = {
      ...unrelated,
      delivery: { stage: 'publication', commit: intent.base, ready: true, landed: false },
    };
    await schedulerRuntime.runPromise(scheduler.status());
    const sends = (await f.host.calls()).filter(
      (call) =>
        call.args[1] === 'send' &&
        call.args[2] === saved.thread.threadId &&
        call.args[3]?.includes(saved.operation)
    );
    expect(sends).toHaveLength(1);
    expect(maximumDepth).toBeLessThan(3);
    expect((await Effect.runPromise(schedule.read())).admissions).toEqual([
      admission,
      unrelatedAdmission,
    ]);
    expect(await Effect.runPromise(jobStore.readStage(4))).toEqual(request);
    expect(await Effect.runPromise(jobStore.readStage(5))).toBeNull();
  } finally {
    await schedulerRuntime?.dispose();
    await jobRuntime?.dispose();
    await f.close();
  }
});
