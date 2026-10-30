import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
it('requires a unique matching PR and mandatory current checks while ignoring advisory failures', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  const intent: Intent = {
    id: '1',
    issue: 577,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
    base: host.base,
    context: '',
    branch: 'factory/job-1',
    createdAt: 1,
    expectedStage: 'implementation',
  };
  const adapter = githubIssues({ project: host.repository, base: host.base, prerequisites: [] });
  const checks = ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map((name) => ({
    name,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
  }));
  const pr = {
    url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
    headRefName: intent.branch,
    baseRefName: 'main',
    headRefOid: host.base,
    baseRefOid: host.base,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: checks,
  };
  try {
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toEqual({ kind: 'absent' });
    await host.save({ prs: [pr] });
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({
      kind: 'found',
      ready: true,
      landed: false,
    });
    for (const patch of [
      {
        statusCheckRollup: [
          ...checks,
          { name: 'Build, Lint, and Test', status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
      },
      { isDraft: true },
      { state: 'MERGED' },
      { mergeable: 'CONFLICTING' },
      { statusCheckRollup: [] },
      { statusCheckRollup: checks.slice(1) },
      { statusCheckRollup: checks.map((check) => ({ ...check, conclusion: 'FAILURE' })) },
      { statusCheckRollup: [...checks, { context: 'codecov/patch', state: 'FAILURE' }] },
    ]) {
      await host.save({ prs: [{ ...pr, ...patch }] });
      expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({
        ready: false,
        landed: false,
      });
    }
    await host.save({
      prs: [
        {
          ...pr,
          statusCheckRollup: [
            ...checks,
            { name: 'Advisory mutation pilot', status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        },
      ],
    });
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({ ready: true });
    for (const prs of [
      [pr, pr],
      [{ ...pr, baseRefName: 'wrong' }],
      [{ ...pr, headRefName: 'wrong' }],
    ]) {
      await host.save({ prs });
      expect(await Effect.runPromise(adapter.pullRequest(intent))).toEqual({ kind: 'ambiguous' });
    }
  } finally {
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
it('preserves current-head readiness after an independent target-branch advance', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  const intent: Intent = {
    id: 'base-advance',
    issue: 577,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
    base: host.base,
    context: '',
    branch: 'factory/job-base-advance',
    createdAt: 1,
    expectedStage: 'implementation',
  };
  const adapter = githubIssues({ project: host.repository, base: host.base, prerequisites: [] });
  const pr = {
    url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
    headRefName: intent.branch,
    baseRefName: 'main',
    headRefOid: host.base,
    baseRefOid: host.base,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
      (name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })
    ),
  };
  try {
    await host.save({ prs: [pr] });
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({
      kind: 'found',
      commit: host.base,
      ready: true,
      landed: false,
    });
    const liveBase = 'c'.repeat(40);
    await host.save({ prs: [{ ...pr, baseRefOid: liveBase }] });
    const observed = await Effect.runPromise(adapter.pullRequest(intent));
    process.stdout.write(
      'Independent base advance: ' +
        JSON.stringify({ pinnedComparison: intent.base, liveBase, observed }) +
        '\n'
    );
    expect(observed).toMatchObject({
      kind: 'found',
      url: pr.url,
      commit: host.base,
      ready: true,
      landed: false,
    });
    await host.save({ prs: [{ ...pr, baseRefOid: liveBase, mergeable: 'CONFLICTING' }] });
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({
      kind: 'found',
      ready: false,
    });

    const current = {
      ...pr,
      statusCheckRollup: pr.statusCheckRollup.map((check) => ({
        ...check,
        detailsUrl: 'https://github.com/rafaeltab/wallpaperdb/actions/runs/123/job/456',
        status: 'IN_PROGRESS',
        conclusion: null,
      })),
    };
    const jobs = {
      total_count: 1,
      jobs: [
        {
          id: 456,
          run_id: 123,
          head_sha: host.base,
          status: 'in_progress',
          conclusion: null,
          steps: [
            {
              number: 1,
              status: 'in_progress',
              conclusion: null,
              started_at: '2026-10-30T00:00:00Z',
              completed_at: null,
            },
          ],
        },
      ],
    };
    await host.save({ prs: [current], jobs });
    const beforeStep = await Effect.runPromise(adapter.pullRequest(intent));
    expect(beforeStep).toMatchObject({ ready: false, ci: { failed: false } });
    await host.save({
      prs: [current],
      jobs: {
        ...jobs,
        jobs: [
          {
            ...jobs.jobs[0],
            steps: [
              {
                number: 1,
                status: 'completed',
                conclusion: 'success',
                started_at: '2026-10-30T00:00:00Z',
                completed_at: '2026-10-30T00:20:00Z',
              },
            ],
          },
        ],
      },
    });
    const afterStep = await Effect.runPromise(adapter.pullRequest(intent));
    if (beforeStep.kind !== 'found' || afterStep.kind !== 'found')
      throw new Error('Expected current CI');
    expect(afterStep.ci?.progress).not.toBe(beforeStep.ci?.progress);
    for (const patch of [{ head_sha: 'f'.repeat(40) }, { run_id: 999 }]) {
      await host.save({ prs: [current], jobs: { ...jobs, jobs: [{ ...jobs.jobs[0], ...patch }] } });
      await expect(Effect.runPromise(adapter.pullRequest(intent))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
    }
  } finally {
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
