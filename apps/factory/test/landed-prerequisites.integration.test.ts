import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Job, JobLive, JobStore, Issues, Execution, Time } from '../src/capabilities/job/index.js';
import {
  Scheduler,
  SchedulerLive,
  Plan,
  PlanningSource,
  ScheduleStore,
  JobPool,
} from '../src/capabilities/plan/index.js';
import { githubIssues } from '../src/adapters/github/index.js';
import { t3Execution } from '../src/adapters/t3/index.js';
import { fileStore, fileScheduleStore } from '../src/adapters/store/index.js';
import { protocol } from './fixtures/setup.js';

async function fixture() {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = join(host.directory, 'origin.git');
  git('init', '--bare', origin);
  git('-C', host.repository, 'remote', 'add', 'origin', origin);
  git('-C', host.repository, 'push', 'origin', 'HEAD:refs/heads/main');
  git('--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const publisher = join(host.directory, 'publisher');
  git('clone', origin, publisher);
  await writeFile(join(publisher, 'landed-A.txt'), 'required landed A');
  git('-C', publisher, 'add', '.');
  git(
    '-C',
    publisher,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'landed A'
  );
  const landed = git('-C', publisher, 'rev-parse', 'HEAD');
  git('-C', publisher, 'push', 'origin', 'main');
  const observation = {
    lost: false,
    blockers: [{ number: 573, state: 'closed' }],
    issueStates: { 573: 'CLOSED' },
    defaultBranch: { name: 'main', tip: landed },
    landedPrerequisites: { 573: [591] },
    mergedPrerequisites: {
      591: {
        merged: true,
        merge_commit_sha: landed,
        head: { sha: landed },
        base: { ref: 'main', repo: { full_name: 'rafaeltab/wallpaperdb' } },
        html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/591',
      },
    },
  };
  await host.save(observation);
  return {
    host,
    git,
    landed,
    publisher,
    origin,
    observation,
    close: async () => {
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    },
  };
}

it('launches a new dependent with remotely landed code after the configured base becomes stale', async () => {
  const f = await fixture();
  const issues = githubIssues({ project: f.host.repository, base: f.host.base, prerequisites: [] });
  const worker = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(JobStore, fileStore(join(f.host.directory, 'job'))),
          Layer.succeed(Issues, issues),
          Layer.succeed(Time, { now: () => Effect.succeed(1) }),
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
  let runtime: ManagedRuntime.ManagedRuntime<Scheduler, never> | undefined;
  try {
    expect(() =>
      f.git('-C', f.host.repository, 'cat-file', '-e', `${f.landed}^{commit}`)
    ).toThrow();
    await writeFile(join(f.host.repository, '.git', 'FETCH_HEAD'), 'operator fetch marker\n');
    const job = await worker.runPromise(Job);
    runtime = ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Issues, issues),
            Layer.succeed(JobPool, { job: () => Effect.succeed(job) }),
            Layer.succeed(ScheduleStore, fileScheduleStore(join(f.host.directory, 'schedule'))),
            Layer.succeed(Plan, { preview: () => Effect.die('Manual admission does not plan') }),
            Layer.succeed(PlanningSource, {
              read: () => Effect.die('Manual admission does not discover'),
            })
          )
        )
      )
    );
    const scheduler = await runtime.runPromise(Scheduler);
    const started = await runtime.runPromise(
      scheduler.start({ issue: 574, base: f.host.base, context: 'Only B' })
    );
    if (started.kind !== 'job' || started.execution.kind !== 'found')
      throw new Error(JSON.stringify(started));
    expect(await readFile(join(started.execution.worktree, 'landed-A.txt'), 'utf8')).toBe(
      'required landed A'
    );
    expect(started.intent).toMatchObject({ base: f.landed, prBase: 'main', context: 'Only B' });
    expect(await readFile(join(f.host.repository, '.git', 'FETCH_HEAD'), 'utf8')).toBe(
      'operator fetch marker\n'
    );
    expect(f.git('-C', f.host.repository, 'rev-parse', 'refs/remotes/origin/main')).toBe(
      f.host.base
    );
    expect(f.git('-C', f.host.repository, 'rev-parse', 'HEAD')).toBe(f.host.base);
    expect(f.git('-C', started.execution.worktree, 'rev-parse', 'HEAD')).toBe(f.landed);
    expect(
      f.git('-C', f.host.repository, 'rev-list', '--merges', `${f.host.base}..${f.landed}`)
    ).toBe('');
  } finally {
    await runtime?.dispose();
    await worker.dispose();
    await f.close();
  }
});

it.each([
  'unmerged',
  'feature-target',
  'other-repository',
  'missing-commit',
  'ambiguous',
  'truncated',
] as const)('does not turn an unverifiable closed blocker into readiness: %s', async (kind) => {
  const f = await fixture();
  try {
    const pr = f.observation.mergedPrerequisites[591];
    const changed = {
      ...pr,
      ...(kind === 'unmerged' ? { merged: false } : {}),
      ...(kind === 'feature-target' ? { base: { ...pr.base, ref: 'feature' } } : {}),
      ...(kind === 'other-repository'
        ? { base: { ...pr.base, repo: { full_name: 'outside/repository' } } }
        : {}),
      ...(kind === 'missing-commit' ? { merge_commit_sha: null } : {}),
    };
    await f.host.save({
      ...f.observation,
      landedPrerequisites: { 573: kind === 'ambiguous' ? [591, 592] : [591] },
      mergedPrerequisites: {
        591: changed,
        592: { ...pr, html_url: 'https://github.com/rafaeltab/wallpaperdb/pull/592' },
      },
      landingTruncated: kind === 'truncated',
    });
    const issues = githubIssues({
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [],
    });
    expect(await Effect.runPromise(issues.inspect(574))).toMatchObject({ blockersReady: false });
  } finally {
    await f.close();
  }
});

it('keeps arbitrary closure blocked and missing landing observations visibly unavailable', async () => {
  const f = await fixture();
  try {
    const issues = githubIssues({
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [],
    });
    await f.host.save({ ...f.observation, landedPrerequisites: {} });
    expect(await Effect.runPromise(issues.inspect(574))).toMatchObject({ blockersReady: false });
    await f.host.save({ ...f.observation, defaultBranch: {} });
    await expect(Effect.runPromise(issues.inspect(574))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
  } finally {
    await f.close();
  }
});

it('refuses to replace a divergent operator pin with the new default tip', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.host.repository, 'operator.txt'), 'Keep operator code');
    f.git('-C', f.host.repository, 'add', '.');
    f.git(
      '-C',
      f.host.repository,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'operator pin'
    );
    const pin = f.git('-C', f.host.repository, 'rev-parse', 'HEAD');
    const issues = githubIssues({ project: f.host.repository, base: pin, prerequisites: [] });
    expect(await Effect.runPromise(issues.inspect(574))).toMatchObject({ blockersReady: false });
    expect(f.git('-C', f.host.repository, 'rev-parse', 'HEAD')).toBe(pin);
    expect(await readFile(join(f.host.repository, 'operator.txt'), 'utf8')).toBe(
      'Keep operator code'
    );
  } finally {
    await f.close();
  }
});

it('rejects a merge result that is not an ancestor of the authenticated default tip', async () => {
  const f = await fixture();
  try {
    f.git(
      '-C',
      f.host.repository,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'not landed'
    );
    const unrelated = f.git('-C', f.host.repository, 'rev-parse', 'HEAD');
    await f.host.save({
      ...f.observation,
      mergedPrerequisites: {
        591: { ...f.observation.mergedPrerequisites[591], merge_commit_sha: unrelated },
      },
    });
    const issues = githubIssues({
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [],
    });
    expect(await Effect.runPromise(issues.inspect(574))).toMatchObject({ blockersReady: false });
  } finally {
    await f.close();
  }
});

it.each([true, false])(
  'requires mixed open and landed prerequisites to coexist in a selected tip: %s',
  async (containsA) => {
    const f = await fixture();
    try {
      f.git('-C', f.publisher, 'checkout', '-b', 'B', containsA ? f.landed : f.host.base);
      await writeFile(join(f.publisher, 'B.txt'), 'open B');
      f.git('-C', f.publisher, 'add', '.');
      f.git(
        '-C',
        f.publisher,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'B'
      );
      const b = f.git('-C', f.publisher, 'rev-parse', 'HEAD');
      f.git('-C', f.publisher, 'push', 'origin', 'B');
      f.git('-C', f.host.repository, 'fetch', '--no-tags', '--no-write-fetch-head', 'origin', b);
      // Unrelated main advancement does not invalidate B's inclusion of landed A.
      f.git('-C', f.publisher, 'checkout', 'main');
      f.git(
        '-C',
        f.publisher,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'main advances'
      );
      const tip = f.git('-C', f.publisher, 'rev-parse', 'HEAD');
      f.git('-C', f.publisher, 'push', 'origin', 'main');
      await f.host.save({
        ...f.observation,
        defaultBranch: { name: 'main', tip },
        blockers: [
          { number: 573, state: 'closed' },
          { number: 574, state: 'open' },
        ],
        prerequisiteHeads: { 592: b },
      });
      const issues = githubIssues({
        project: f.host.repository,
        base: f.host.base,
        prerequisites: [{ issue: 574, pr: 592, commit: b }],
      });
      const result = await Effect.runPromise(issues.inspect(575));
      expect(result.blockersReady).toBe(containsA);
      if (containsA)
        expect(result).toMatchObject({ prerequisite: { base: b, prBase: 'factory/pr-592' } });
      await f.host.save({
        ...f.observation,
        defaultBranch: { name: 'main', tip },
        blockers: [
          { number: 573, state: 'closed' },
          { number: 574, state: 'open' },
        ],
        prerequisiteHeads: { 592: b },
        prerequisiteCI: 'FAILURE',
      });
      expect(await Effect.runPromise(issues.inspect(575))).toMatchObject({ blockersReady: false });
    } finally {
      await f.close();
    }
  }
);

it('reports missing Git objects as unavailable when the authenticated tip cannot be fetched', async () => {
  const f = await fixture();
  try {
    f.git('-C', f.host.repository, 'remote', 'remove', 'origin');
    const issues = githubIssues({
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [],
    });
    await expect(Effect.runPromise(issues.inspect(574))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    expect(f.git('-C', f.host.repository, 'rev-parse', 'HEAD')).toBe(f.host.base);
  } finally {
    await f.close();
  }
});

it('binds a valid operator pin already containing landed code instead of reverting to a caller base', async () => {
  const f = await fixture();
  try {
    f.git(
      '-C',
      f.host.repository,
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      'origin',
      f.landed
    );
    f.git('-C', f.host.repository, 'checkout', '--detach', f.landed);
    f.git(
      '-C',
      f.host.repository,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'operator pin including A'
    );
    const pin = f.git('-C', f.host.repository, 'rev-parse', 'HEAD');
    const issues = githubIssues({
      project: f.host.repository,
      base: pin,
      prBase: 'operator/base',
      prerequisites: [],
    });
    expect(await Effect.runPromise(issues.inspect(574))).toMatchObject({
      blockersReady: true,
      prerequisite: { base: pin, prBase: 'operator/base' },
    });
    expect(f.git('-C', f.host.repository, 'rev-parse', 'HEAD')).toBe(pin);
  } finally {
    await f.close();
  }
});

it('uses the default-branch merge result after rebasing changed the original PR commit IDs', async () => {
  const f = await fixture();
  try {
    await f.host.save({
      ...f.observation,
      mergedPrerequisites: {
        591: { ...f.observation.mergedPrerequisites[591], head: { sha: 'f'.repeat(40) } },
      },
    });
    const issues = githubIssues({
      project: f.host.repository,
      base: f.host.base,
      prerequisites: [],
    });
    expect(await Effect.runPromise(issues.inspect(574))).toMatchObject({
      blockersReady: true,
      prerequisite: { base: f.landed, prBase: 'main' },
    });
  } finally {
    await f.close();
  }
});
