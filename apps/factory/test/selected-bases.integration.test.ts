import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { joinFixture } from './fixtures/join.js';
import { protocol } from './fixtures/setup.js';

it('uses freshly fetched origin/main for empty inclusion despite an unrelated configured pin', async () => {
  const host = await protocol();
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  try {
    git('remote', 'add', 'origin', host.repository);
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'new main'
    );
    const current = git('rev-parse', 'HEAD');
    const issues = githubIssues({
      project: host.repository,
      base: 'f'.repeat(40),
      prBase: 'historical/pin',
      prerequisites: [],
      read: host.readGitHub,
    });
    expect(
      await Effect.runPromise(issues.inspect(580, { includeCodeFromIssues: [] }))
    ).toMatchObject({ blockersReady: true, prerequisite: { base: current, prBase: 'main' } });
    git('remote', 'remove', 'origin');
    await expect(
      Effect.runPromise(issues.inspect(580, { includeCodeFromIssues: [] }))
    ).rejects.toMatchObject({ _tag: 'Unavailable' });
  } finally {
    await host.cleanup();
  }
});

it('prepares exactly the selected divergent verified issue code without an existing containing branch', async () => {
  const f = await joinFixture({ inProcess: true });
  try {
    f.git('push', 'origin', `${f.host.base}:refs/heads/main`);
    const issues = f.issues;
    const candidate = { includeCodeFromIssues: [3, 4] };
    const before = await Effect.runPromise(issues.inspect(5, candidate));
    expect(before).toMatchObject({
      blockersReady: false,
      joinRequired: true,
      selectionBase: f.host.base,
    });
    if (!issues.prepare) throw new Error('Missing production preparation');
    await Effect.runPromise(
      issues.prepare(5, () => Effect.succeed(true), {
        ...candidate,
        selectionBase: before.selectionBase,
      })
    );
    const after = await Effect.runPromise(
      issues.inspect(5, { ...candidate, selectionBase: before.selectionBase })
    );
    expect(after.blockersReady).toBe(true);
    expect(after.prerequisite?.prBase).toBe('C');
    if (!after.prerequisite) throw new Error('Missing selected comparison');
    expect(f.git('show', `${after.prerequisite.base}:D.txt`)).toBe('D');
    expect(f.git('show', `${after.prerequisite.base}:C.txt`)).toBe('C');
  } finally {
    await f.close();
  }
});

it('uses one verified inclusion even when it is not an explicit blocker, and rejects unavailable code', async () => {
  const host = await protocol();
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  try {
    git('remote', 'add', 'origin', host.repository);
    git('switch', '-c', 'included');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'verified inclusion'
    );
    const included = git('rev-parse', 'HEAD');
    await host.save({ prerequisiteHeads: { 591: included } });
    const configuration = {
      project: host.repository,
      base: 'f'.repeat(40),
      prerequisites: [{ issue: 573, pr: 591, commit: included }],
      read: host.readGitHub,
    };
    const issues = githubIssues(configuration);
    expect(
      await Effect.runPromise(issues.inspect(580, { includeCodeFromIssues: [573] }))
    ).toMatchObject({
      blockersReady: true,
      selectionBase: host.base,
      prerequisite: { base: included, prBase: 'factory/pr-591' },
    });
    expect(
      await Effect.runPromise(issues.inspect(580, { includeCodeFromIssues: [574] }))
    ).toMatchObject({ blockersReady: false });
    const ambiguous = githubIssues({
      ...configuration,
      prerequisites: [...configuration.prerequisites, { issue: 573, pr: 592, commit: included }],
    });
    expect(
      await Effect.runPromise(ambiguous.inspect(580, { includeCodeFromIssues: [573] }))
    ).toMatchObject({ blockersReady: false });
  } finally {
    await host.cleanup();
  }
});

it('fetches verified included code that is not yet present in the execution repository', async () => {
  const host = await protocol();
  const consumer = join(host.directory, 'consumer');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['clone', '--no-local', host.repository, consumer]);
    git('switch', '-c', 'remote-inclusion');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'remote-only verified code'
    );
    const included = git('rev-parse', 'HEAD');
    expect(() =>
      execFileSync('git', ['-C', consumer, 'cat-file', '-e', included], { stdio: 'pipe' })
    ).toThrow();
    await host.save({ prerequisiteHeads: { 591: included } });
    const issues = githubIssues({
      project: consumer,
      base: host.base,
      prerequisites: [{ issue: 573, pr: 591, commit: included }],
      read: host.readGitHub,
    });
    expect(
      await Effect.runPromise(issues.inspect(580, { includeCodeFromIssues: [573] }))
    ).toMatchObject({
      blockersReady: true,
      prerequisite: { base: included, prBase: 'factory/pr-591' },
    });
  } finally {
    await host.cleanup();
  }
});
