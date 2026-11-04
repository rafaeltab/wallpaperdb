import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { protocol } from './fixtures/setup.js';
it('translates external issue observations and rejects unverified or malformed dependency evidence', async () => {
  const host = await protocol();
  const path = process.env.PATH;
  const fixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = host.directory + ':' + path;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = githubIssues({ project: host.repository, base: host.base, prerequisites: [] });
    expect(await Effect.runPromise(adapter.inspect(576))).toEqual({
      open: true,
      author: 'rafaeltab',
      labels: ['ready-for-agent'],
      blockers: [],
      blockersReady: true,
      url: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
      title: 'Controlled issue',
    });
    await host.save({ blockers: [{ number: 573, state: 'open' }] });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({ body: '## Blocked by\nhttps://github.com/rafaeltab/wallpaperdb/issues/573' });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    for (const body of ['Blocked by: #573', '## Blocked by\n- #573', 'Blocked by: #573, #574']) {
      await host.save({ body });
      expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    }
    await host.save({ blockers: [{ number: 573, state: 'open' }], body: 'Blocked by: #573, #574' });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({
      blockers: [573, 574],
      blockersReady: false,
    });
    await host.save({ body: 'Parent: #573' });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: true });
    const verified = githubIssues({
      project: host.repository,
      base: host.base,
      prerequisites: [{ issue: 573, pr: 591, commit: host.base }],
    });
    await host.save({ blockers: [{ number: 573, state: 'open' }], prHead: host.base });
    expect(await Effect.runPromise(verified.inspect(576))).toMatchObject({ blockersReady: true });
    await host.save({
      body: `Blocked by: #573\nParent: #571\nhttps://github.com/rafaeltab/wallpaperdb/pull/591 ${host.base}`,
      prHead: host.base,
    });
    expect(await Effect.runPromise(verified.inspect(576))).toMatchObject({ blockersReady: true });
    await host.save({ blockers: [{ number: 573, state: 'open' }], prHead: 'b'.repeat(40) });
    expect(await Effect.runPromise(verified.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({
      blockers: [{ number: 573, state: 'closed' }],
      issueStates: { 573: 'CLOSED' },
      defaultBranch: { name: 'main', tip: host.base },
    });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({
      blockers: Array.from({ length: 101 }, (_, index) => ({ number: index + 1, state: 'open' })),
    });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({ githubMalformed: true });
    await expect(Effect.runPromise(adapter.inspect(576))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
  } finally {
    process.env.PATH = path;
    if (fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = fixture;
    await host.cleanup();
  }
});

it('selects a verified child base and blocks divergent joins using real Git ancestry', async () => {
  const host = await protocol();
  const path = process.env.PATH;
  const previous = process.env.FACTORY_FIXTURE;
  process.env.PATH = host.directory + ':' + path;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const { execFileSync } = await import('node:child_process');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'A'
    );
    const a = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'fork', host.base);
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'divergent'
    );
    const divergent = git('rev-parse', 'HEAD');
    const adapter = githubIssues({
      project: host.repository,
      base: host.base,
      prerequisites: [
        { issue: 573, pr: 591, commit: a },
        { issue: 574, pr: 592, commit: divergent },
      ],
    });
    await host.save({
      blockers: [{ number: 573, state: 'open' }],
      prerequisiteHeads: { 591: a, 592: divergent },
    });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({
      blockersReady: true,
      prerequisite: { base: a, prBase: 'factory/pr-591' },
    });
    await host.save({
      blockers: [
        { number: 573, state: 'open' },
        { number: 574, state: 'open' },
      ],
      prerequisiteHeads: { 591: a, 592: divergent },
    });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({
      blockers: [{ number: 573, state: 'open' }],
      prerequisiteHeads: { 591: a },
      prerequisiteCI: 'FAILURE',
    });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
  } finally {
    process.env.PATH = path;
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});
it('continues observing an eligible issue with more than 100 retained ready publications', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({ prHead: host.base, base: host.base });
    const adapter = githubIssues({
      project: host.repository,
      base: host.base,
      prerequisites: [],
      readyPrerequisites: () =>
        Effect.succeed(
          Array.from({ length: 101 }, (_, index) => ({
            issue: index + 1,
            pr: index + 101,
            commit: host.base,
          }))
        ),
      joins: { directory: `${host.directory}/joins`, binary: host.binary, projectId: 'project-id' },
    });
    if (!adapter.reconcile) throw new Error('Missing reconciliation');
    await Effect.runPromise(adapter.reconcile());
    expect(await Effect.runPromise(adapter.inspect(585))).toMatchObject({
      open: true,
      blockersReady: true,
    });
    expect(
      (await host.calls()).filter((call) => call.args[0] === 'pr' && call.args[1] === 'view')
    ).toHaveLength(101);
  } finally {
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
